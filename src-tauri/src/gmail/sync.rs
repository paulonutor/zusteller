use super::{
    api::Gmail,
    model::{array, text},
    Error, Result,
};
use serde_json::Value;
use std::{collections::BTreeSet, time::Duration};

pub enum Step {
    Pending(Duration),
    Done(bool),
}

enum Phase {
    Profile,
    History,
    Commit,
    Finished,
}

// A pass holds its uncommitted changes here, rather than holding the Gmail mutex.
// Each step reads one history page; mail is fetched only when viewed.
pub struct Sync {
    account: String,
    generation: u64,
    phase: Phase,
    cursor: String,
    history: String,
    page_token: String,
    changed: BTreeSet<String>,
    bootstrap: bool,
    invalidate_all: bool,
    waiting: bool,
}

impl Sync {
    pub fn new(gmail: &Gmail, account: &str) -> Result<Self> {
        if !gmail
            .store
            .accounts()?
            .iter()
            .any(|a| text(a, "id") == account)
        {
            return Err(Error::new("not_found", "Gmail account is not connected"));
        }
        let cursor = gmail.store.history(account)?;
        let bootstrap = cursor.is_none();
        // A first connection has no older mail to invalidate. Preserve row metadata
        // just loaded by the foreground while the initial baseline is established.
        let invalidate_all = bootstrap && gmail.store.0.query_row(
            "SELECT EXISTS(SELECT 1 FROM cache WHERE account=?1 AND (key LIKE 'thread:%' OR key LIKE 'body:%'))",
            [account], |r| r.get::<_,bool>(0),
        )?;
        gmail.diagnostics.event("sync", "started", None);
        Ok(Self {
            account: account.into(),
            generation: gmail.generation,
            phase: if bootstrap {
                Phase::Profile
            } else {
                Phase::History
            },
            cursor: cursor.unwrap_or_default(),
            history: String::new(),
            page_token: String::new(),
            changed: BTreeSet::new(),
            bootstrap,
            invalidate_all,
            waiting: false,
        })
    }

    pub fn step(&mut self, gmail: &mut Gmail) -> Result<Step> {
        let result = self.advance(gmail);
        match &result {
            Ok(Step::Done(_)) => gmail.diagnostics.event("sync", "finished", None),
            Err(_) => {
                self.phase = Phase::Finished;
                gmail.diagnostics.event("sync", "failed", None);
            }
            _ => {}
        }
        result
    }

    fn advance(&mut self, gmail: &mut Gmail) -> Result<Step> {
        if gmail.generation != self.generation
            || !gmail
                .store
                .accounts()?
                .iter()
                .any(|a| text(a, "id") == self.account)
        {
            return Err(Error::new(
                "cancelled",
                "Gmail sync cancelled after the connection changed",
            ));
        }
        let (path, params) = match self.phase {
            Phase::Profile => ("profile", vec![]),
            Phase::History => {
                let mut params = vec![
                    ("startHistoryId", self.cursor.clone()),
                    ("maxResults", "500".into()),
                ];
                if !self.page_token.is_empty() {
                    params.push(("pageToken", self.page_token.clone()));
                }
                ("history", params)
            }
            Phase::Commit => {
                gmail.store.invalidate(
                    &self.account,
                    &self.history,
                    &self.changed,
                    self.invalidate_all,
                )?;
                gmail.invalidate_summaries(&self.account, &self.changed, self.invalidate_all);
                self.phase = Phase::Finished;
                return Ok(Step::Done(self.bootstrap || !self.changed.is_empty()));
            }
            Phase::Finished => return Err(Error::new("invalid", "Gmail sync has already ended")),
        };
        let wait = gmail.quota.background_wait(path)?;
        if !wait.is_zero() {
            if !self.waiting {
                gmail.diagnostics.event("sync", "waiting_for_quota", None);
                self.waiting = true;
            }
            return Ok(Step::Pending(wait));
        }
        self.waiting = false;
        let response = gmail.get(&self.account, path, &params);
        match self.phase {
            Phase::Profile => {
                let profile = response?;
                // Capture the baseline before reading mail. Changes during reads
                // remain in history for the next pass.
                self.history = text(&profile, "historyId").into();
                self.require_history()?;
                self.phase = Phase::Commit;
            }
            Phase::History => {
                let page = match response {
                    Err(error) if error.code == "not_found" => {
                        self.bootstrap = true;
                        self.invalidate_all = true;
                        self.changed.clear();
                        self.phase = Phase::Profile;
                        return Ok(Step::Pending(Duration::ZERO));
                    }
                    other => other?,
                };
                for record in array(&page["history"]) {
                    for message in array(&record["messages"]) {
                        self.add_changed(message);
                    }
                    for field in [
                        "messagesAdded",
                        "messagesDeleted",
                        "labelsAdded",
                        "labelsRemoved",
                    ] {
                        for item in array(&record[field]) {
                            self.add_changed(&item["message"]);
                        }
                    }
                }
                self.page_token = text(&page, "nextPageToken").into();
                if self.page_token.is_empty() {
                    self.history = text(&page, "historyId").into();
                    self.require_history()?;
                    self.phase = Phase::Commit;
                }
            }
            _ => unreachable!(),
        }
        Ok(Step::Pending(Duration::ZERO))
    }

    fn require_history(&self) -> Result<()> {
        if self.history.is_empty() {
            return Err(Error::new("invalid", "Google returned no sync cursor"));
        }
        Ok(())
    }

    fn add_changed(&mut self, message: &Value) {
        let id = text(message, "threadId");
        if !id.is_empty() {
            self.changed.insert(id.into());
        }
    }
}
