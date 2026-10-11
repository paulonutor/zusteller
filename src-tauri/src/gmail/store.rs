use super::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;

pub struct Store(pub Connection);
impl From<rusqlite::Error> for Error {
    fn from(_: rusqlite::Error) -> Self {
        Error::new("invalid", "Could not access the local Gmail cache")
    }
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|_| Error::new("invalid", "Could not create the Gmail cache directory"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                    .map_err(|_| Error::new("invalid", "Could not protect the Gmail cache"))?;
            }
        }
        let db = Connection::open(path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| Error::new("invalid", "Could not protect the Gmail cache"))?;
        }
        Self::init(db)
    }
    fn init(db: Connection) -> Result<Self> {
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > 1 {
            return Err(Error::new(
                "invalid",
                "Gmail cache was created by a newer app",
            ));
        }
        db.execute_batch("PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY, value TEXT NOT NULL, history TEXT);
            CREATE TABLE IF NOT EXISTS cache (account TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, touched INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY(account,key));
            CREATE TABLE IF NOT EXISTS overlay (account TEXT NOT NULL, thread TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(account,thread));
            PRAGMA user_version=1;")?;
        Ok(Self(db))
    }
    pub fn accounts(&self) -> Result<Vec<Value>> {
        let mut stmt = self.0.prepare("SELECT value FROM account ORDER BY id")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| parse(&r?)).collect()
    }
    pub fn add_account(&self, account: &Value) -> Result<()> {
        self.0.execute("INSERT INTO account(id,value) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET value=excluded.value",params![account["id"].as_str(),account.to_string()])?;
        Ok(())
    }
    pub fn get(&self, account: &str, key: &str) -> Result<Option<Value>> {
        let raw: Option<String> = self
            .0
            .query_row(
                "SELECT value FROM cache WHERE account=?1 AND key=?2",
                params![account, key],
                |r| r.get(0),
            )
            .optional()?;
        raw.map(|s| parse(&s)).transpose()
    }
    pub fn put(&self, account: &str, key: &str, value: &Value) -> Result<()> {
        self.0.execute(
            "INSERT OR REPLACE INTO cache(account,key,value,touched) VALUES (?1,?2,?3,unixepoch())",
            params![account, key, value.to_string()],
        )?;
        Ok(())
    }
    pub fn overlays(&self, account: &str) -> Result<Vec<(String, Value)>> {
        let mut stmt = self
            .0
            .prepare("SELECT thread,value FROM overlay WHERE account=?1")?;
        let rows = stmt.query_map([account], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        rows.map(|r| {
            let (id, s) = r?;
            Ok((id, parse(&s)?))
        })
        .collect()
    }
    pub fn overlay(&self, account: &str, id: &str) -> Result<Value> {
        let raw: Option<String> = self
            .0
            .query_row(
                "SELECT value FROM overlay WHERE account=?1 AND thread=?2",
                params![account, id],
                |r| r.get(0),
            )
            .optional()?;
        raw.map(|s| parse(&s))
            .transpose()
            .map(|v| v.unwrap_or(json!({})))
    }
    pub fn write_overlays(&mut self, account: &str, changes: &[(String, Value)]) -> Result<()> {
        let tx = self.0.transaction()?;
        for (id, value) in changes {
            tx.execute(
                "INSERT OR REPLACE INTO overlay(account,thread,value) VALUES (?1,?2,?3)",
                params![account, id, value.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn reset(&self, account: &str) -> Result<()> {
        self.0
            .execute("DELETE FROM overlay WHERE account=?1", [account])?;
        Ok(())
    }
    pub fn remove(&mut self, account: &str) -> Result<()> {
        let tx = self.0.transaction()?;
        for table in ["cache", "overlay"] {
            tx.execute(&format!("DELETE FROM {table} WHERE account=?1"), [account])?;
        }
        tx.execute("DELETE FROM account WHERE id=?1", [account])?;
        tx.commit()?;
        self.0.execute_batch("VACUUM")?;
        Ok(())
    }
    pub fn history(&self, account: &str) -> Result<Option<String>> {
        Ok(self
            .0
            .query_row("SELECT history FROM account WHERE id=?1", [account], |r| {
                r.get(0)
            })?)
    }
    // Commit all history changes and the cursor together. Failed fetches never advance it.
    pub fn sync(
        &mut self,
        account: &str,
        history: &str,
        changes: &[(String, Option<Value>)],
    ) -> Result<()> {
        let tx = self.0.transaction()?;
        for (id, value) in changes {
            let key = format!("thread:{id}");
            tx.execute(
                "DELETE FROM cache WHERE account=?1 AND key=?2",
                params![account, format!("body:{id}")],
            )?;
            if let Some(value) = value {
                tx.execute("INSERT OR REPLACE INTO cache(account,key,value,touched) VALUES (?1,?2,?3,unixepoch())",params![account,key,value.to_string()])?;
            } else {
                tx.execute(
                    "DELETE FROM cache WHERE account=?1 AND key=?2",
                    params![account, key],
                )?;
                tx.execute(
                    "DELETE FROM overlay WHERE account=?1 AND thread=?2",
                    params![account, id],
                )?;
            }
        }
        if !changes.is_empty() {
            tx.execute(
                "DELETE FROM cache WHERE account=?1 AND key LIKE 'page:%'",
                [account],
            )?;
        }
        tx.execute(
            "UPDATE account SET history=?2 WHERE id=?1",
            params![account, history],
        )?;
        tx.commit()?;
        self.evict(account)?;
        Ok(())
    }
    pub fn evict(&self, account: &str) -> Result<()> {
        // Overrides survive eviction. Cache is bounded to 32 MiB/account and 30 days.
        self.0.execute(
            "DELETE FROM cache WHERE account=?1 AND touched < unixepoch()-2592000",
            [account],
        )?;
        self.0.execute("DELETE FROM cache WHERE account=?1 AND key IN (
            SELECT key FROM (SELECT key, SUM(length(CAST(value AS BLOB))) OVER (ORDER BY touched DESC, key) AS bytes,
            ROW_NUMBER() OVER (ORDER BY touched DESC, key) AS n FROM cache WHERE account=?1) WHERE bytes>33554432 OR n>2000)",[account])?;
        Ok(())
    }
}
fn parse(s: &str) -> Result<Value> {
    serde_json::from_str(s).map_err(|_| Error::new("invalid", "Local Gmail cache is invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlays_are_account_scoped_and_survive_remote_updates_and_restart() {
        let path = std::env::temp_dir()
            .join(format!("zusteller-gmail-test-{}", rand::random::<u64>()))
            .join("cache.sqlite");
        {
            let mut s = Store::open(&path).unwrap();
            s.add_account(&json!({"id":"a"})).unwrap();
            s.add_account(&json!({"id":"b"})).unwrap();
            s.write_overlays("a", &[("t".into(), json!({"isRead":true}))])
                .unwrap();
            s.sync("a", "123", &[("t".into(), Some(json!({"isRead":false})))])
                .unwrap();
            assert_eq!(s.overlay("a", "t").unwrap()["isRead"], true);
            assert_eq!(s.overlay("b", "t").unwrap(), json!({}));
        }
        let mut s = Store::open(&path).unwrap();
        assert_eq!(s.history("a").unwrap().as_deref(), Some("123"));
        assert_eq!(s.overlay("a", "t").unwrap()["isRead"], true);
        s.sync("a", "124", &[("t".into(), None)]).unwrap();
        assert_eq!(s.overlay("a", "t").unwrap(), json!({}));
        s.remove("a").unwrap();
        assert_eq!(s.accounts().unwrap().len(), 1);
        drop(s);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

#[cfg(test)]
mod transaction_tests {
    use super::*;
    #[test]
    fn interrupted_sync_rolls_back_cursor_deletions_and_insertions() {
        let mut s = Store::init(Connection::open_in_memory().unwrap()).unwrap();
        s.add_account(&json!({"id":"a"})).unwrap();
        s.sync(
            "a",
            "1",
            &[("old".into(), Some(json!({"subject":"Original"})))],
        )
        .unwrap();
        s.0.execute_batch("CREATE TRIGGER fail_insert BEFORE INSERT ON cache WHEN NEW.key='thread:bad' BEGIN SELECT RAISE(ABORT,'failure'); END;").unwrap();
        assert!(s
            .sync(
                "a",
                "2",
                &[("old".into(), None), ("bad".into(), Some(json!({})))]
            )
            .is_err());
        assert_eq!(s.history("a").unwrap().as_deref(), Some("1"));
        assert!(s.get("a", "thread:old").unwrap().is_some());
    }
    #[test]
    fn size_eviction_keeps_simulated_actions_and_schema_is_versioned() {
        let mut s = Store::init(Connection::open_in_memory().unwrap()).unwrap();
        s.add_account(&json!({"id":"a"})).unwrap();
        s.write_overlays("a", &[("t".into(), json!({"isRead":true}))])
            .unwrap();
        s.put("a", "body:t", &json!("x".repeat(34 * 1024 * 1024)))
            .unwrap();
        s.evict("a").unwrap();
        assert!(s.get("a", "body:t").unwrap().is_none());
        assert_eq!(s.overlay("a", "t").unwrap()["isRead"], true);
        let version: i64 =
            s.0.query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
        assert_eq!(version, 1);
    }
}
