//! A disposable, durable metadata index. SQLite never runs on the Gmail worker.
use super::{diagnostics::Diagnostics, model::text, store::Store, Result};
use serde_json::Value;
use std::{
    collections::{BTreeSet, HashMap},
    path::PathBuf,
    sync::{mpsc, Arc},
};

type Key = (String, String);
enum Write {
    Put(Key, Value),
    Invalidate(String, BTreeSet<String>, bool, Option<String>),
    Remove(String),
    Stop,
    #[cfg(test)]
    Barrier(mpsc::Sender<()>),
}

pub struct Metadata {
    pub rows: HashMap<Key, Value>,
    writes: mpsc::Sender<Write>,
    loaded: mpsc::Receiver<(Key, Value)>,
    // Prevent a delayed startup snapshot from resurrecting changed/deleted rows.
    changed: BTreeSet<Key>,
    cleared: BTreeSet<String>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Metadata {
    pub fn start(
        path: PathBuf,
        histories: Vec<(String, Option<String>)>,
        diagnostics: Arc<Diagnostics>,
    ) -> Self {
        let (writes, commands) = mpsc::channel();
        let (snapshots, loaded) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = (|| -> Result<()> {
                let mut store = Store::open(&path)?;
                // A crash between the main cache commit and an asynchronous
                // invalidation must not allow stale index rows on restart.
                for account in store.accounts()? {
                    let id = text(&account, "id");
                    if !histories.iter().any(|(a, _)| a == id) {
                        store.remove(id)?;
                    }
                }
                for (account, history) in histories {
                    let previous = store.accounts()?.iter().any(|a| text(a, "id") == account);
                    if !previous || store.history(&account)? != history {
                        store
                            .0
                            .execute("DELETE FROM cache WHERE account=?1", [&account])?;
                        store.add_account(&serde_json::json!({"id":account}))?;
                        store.0.execute(
                            "UPDATE account SET history=?2 WHERE id=?1",
                            rusqlite::params![account, history],
                        )?;
                    }
                }
                {
                    let mut stmt = store
                        .0
                        .prepare("SELECT account,value FROM cache WHERE key LIKE 'thread:%'")?;
                    let rows = stmt
                        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
                    for row in rows {
                        let (account, raw) = row?;
                        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                            let key = (account, text(&value, "id").to_owned());
                            if snapshots.send((key, value)).is_err() {
                                return Ok(());
                            }
                        }
                    }
                }
                drop(snapshots);
                for command in commands {
                    match command {
                        Write::Put((account, id), value) => {
                            store.add_account(&serde_json::json!({"id":account}))?;
                            store.put(&account, &format!("thread:{id}"), &value)?
                        }
                        Write::Invalidate(account, ids, all, history) => {
                            let tx = store.0.transaction()?;
                            if all {
                                tx.execute("DELETE FROM cache WHERE account=?1", [&account])?;
                            } else {
                                for id in ids {
                                    tx.execute(
                                        "DELETE FROM cache WHERE account=?1 AND key=?2",
                                        rusqlite::params![account, format!("thread:{id}")],
                                    )?;
                                }
                            }
                            tx.execute(
                                "UPDATE account SET history=?2 WHERE id=?1",
                                rusqlite::params![account, history],
                            )?;
                            tx.commit()?;
                        }
                        Write::Remove(account) => {
                            store
                                .0
                                .execute("DELETE FROM cache WHERE account=?1", [&account])?;
                        }
                        Write::Stop => break,
                        #[cfg(test)]
                        Write::Barrier(done) => {
                            let _ = done.send(());
                        }
                    }
                }
                Ok(())
            })();
            if result.is_err() {
                diagnostics.event("metadata", "storage_unavailable", None);
            }
        });
        Self {
            rows: HashMap::new(),
            writes,
            loaded,
            changed: BTreeSet::new(),
            cleared: BTreeSet::new(),
            worker: Some(worker),
        }
    }
    pub fn poll(&mut self) {
        // Bound the work per interaction, even during a large startup snapshot.
        for (key, value) in self.loaded.try_iter().take(128) {
            if !self.cleared.contains(&key.0) && !self.changed.contains(&key) {
                self.rows.entry(key).or_insert(value);
            }
        }
    }
    pub fn put(&mut self, account: &str, id: &str, value: Value) {
        let key = (account.to_owned(), id.to_owned());
        self.changed.insert(key.clone());
        self.rows.insert(key.clone(), value.clone());
        let _ = self.writes.send(Write::Put(key, value));
    }
    pub fn invalidate(
        &mut self,
        account: &str,
        ids: &BTreeSet<String>,
        all: bool,
        history: Option<String>,
    ) {
        self.rows
            .retain(|(a, id), _| a != account || (!all && !ids.contains(id)));
        if all {
            self.cleared.insert(account.to_owned());
        } else {
            self.changed
                .extend(ids.iter().map(|id| (account.to_owned(), id.clone())));
        }
        let _ = self
            .writes
            .send(Write::Invalidate(account.into(), ids.clone(), all, history));
    }
    pub fn remove(&mut self, account: &str) {
        self.invalidate(account, &BTreeSet::new(), true, None);
        let _ = self.writes.send(Write::Remove(account.into()));
    }
    #[cfg(test)]
    pub fn flush(&self) {
        let (send, receive) = mpsc::channel();
        self.writes.send(Write::Barrier(send)).unwrap();
        receive
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
    }
}

impl Drop for Metadata {
    fn drop(&mut self) {
        // Shutdown drains earlier writes. Normal reads/writes never join the actor.
        let _ = self.writes.send(Write::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn startup_snapshot_cannot_resurrect_invalidated_rows_and_restart_checks_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("metadata.sqlite");
        let histories = vec![("a".to_owned(), Some("10".to_owned()))];
        let mut index = Metadata::start(path.clone(), histories.clone(), Arc::default());
        index.put("a", "t", json!({"id":"t","subject":"old"}));
        index.flush();
        drop(index);
        let mut index = Metadata::start(path.clone(), histories.clone(), Arc::default());
        index.flush();
        index.invalidate("a", &["t".to_owned()].into(), false, Some("11".into()));
        index.poll();
        assert!(index.rows.is_empty());
        index.put("a", "u", json!({"id":"u"}));
        drop(index);
        // Simulate a main-cache commit newer than the persisted index cursor.
        let mut index =
            Metadata::start(path, vec![("a".into(), Some("12".into()))], Arc::default());
        index.flush();
        index.poll();
        assert!(index.rows.is_empty());
    }

    #[test]
    fn account_removal_deletes_persisted_metadata_and_old_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("metadata.sqlite");
        let mut index = Metadata::start(path.clone(), vec![("a".into(), None)], Arc::default());
        index.put("a", "t", json!({"id":"t"}));
        index.remove("a");
        index.poll();
        assert!(index.rows.is_empty());
        drop(index);
        let mut index = Metadata::start(path, vec![("a".into(), None)], Arc::default());
        index.flush();
        index.poll();
        assert!(index.rows.is_empty());
    }
}
