use super::{
    api::Gmail,
    batch,
    model::{self, array, text},
    quota, Error, Result,
};
use serde_json::Value;
use std::{
    collections::{BTreeSet, VecDeque},
    time::Duration,
};

pub enum Step {
    Pending(Duration),
    Done(bool),
}

enum Phase {
    Profile,
    Recent,
    History,
    Metadata,
    Commit,
    Finished,
}

// A pass holds its uncommitted changes here, rather than holding the Gmail mutex.
// Each step fetches one page or bounded metadata batch; quota waits happen outside the worker.
pub struct Sync {
    account: String,
    generation: u64,
    phase: Phase,
    cursor: String,
    history: String,
    page_token: String,
    changed: BTreeSet<String>,
    pending: VecDeque<String>,
    changes: Vec<(String, Option<Value>)>,
    bootstrap: bool,
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
            pending: VecDeque::new(),
            changes: Vec::new(),
            bootstrap,
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
        if matches!(self.phase, Phase::Metadata) {
            return self.metadata(gmail);
        }
        let (path, params) = match self.phase {
            Phase::Profile => ("profile", vec![]),
            Phase::Recent => (
                "threads",
                vec![
                    ("maxResults", "100".into()),
                    ("includeSpamTrash", "true".into()),
                ],
            ),
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
                gmail
                    .store
                    .sync(&self.account, &self.history, &self.changes)?;
                self.phase = Phase::Finished;
                return Ok(Step::Done(self.bootstrap || !self.changes.is_empty()));
            }
            Phase::Metadata => unreachable!(),
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
                self.phase = Phase::Recent;
            }
            Phase::Recent => {
                let page = response?;
                for thread in array(&page["threads"]) {
                    let id = text(thread, "id");
                    if !id.is_empty() && self.changed.insert(id.into()) {
                        self.pending.push_back(id.into());
                    }
                }
                // Revalidate older cached conversations after history expiry.
                let mut stmt = gmail
                    .store
                    .0
                    .prepare("SELECT key FROM cache WHERE account=?1 AND key LIKE 'thread:%'")?;
                let keys = stmt.query_map([&self.account], |r| r.get::<_, String>(0))?;
                for key in keys {
                    let id = key?.trim_start_matches("thread:").to_string();
                    if self.changed.insert(id.clone()) {
                        self.pending.push_back(id);
                    }
                }
                self.changed.clear();
                self.metadata_phase();
            }
            Phase::History => {
                let page = match response {
                    Err(error) if error.code == "not_found" => {
                        self.bootstrap = true;
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
                    self.fetch_metadata();
                }
            }
            _ => unreachable!(),
        }
        Ok(Step::Pending(Duration::ZERO))
    }

    fn metadata(&mut self, gmail: &mut Gmail) -> Result<Step> {
        let ids: Vec<_> = self
            .pending
            .iter()
            .take(batch::METADATA_LIMIT)
            .cloned()
            .collect();
        let reads: Vec<_> = ids
            .iter()
            .map(|id| {
                batch::Read::new(
                    format!("threads/{}", super::api::segment(id)),
                    super::api::summary_params(),
                )
            })
            .collect();
        let wait = gmail
            .quota
            .background_wait_cost(reads.iter().map(|r| quota::cost(&r.path)).sum())?;
        if !wait.is_zero() {
            if !self.waiting {
                gmail.diagnostics.event("sync", "waiting_for_quota", None);
                self.waiting = true;
            }
            return Ok(Step::Pending(wait));
        }
        self.waiting = false;
        for (id, response) in ids.into_iter().zip(gmail.get_many(&self.account, &reads)?) {
            let value = match response {
                Ok(raw) => Some(model::normalize(&self.account, &raw, false)?),
                Err(error) if error.code == "not_found" => None,
                Err(error) => return Err(error),
            };
            self.changes.push((id, value));
            self.pending.pop_front();
        }
        if self.pending.is_empty() {
            self.phase = Phase::Commit;
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

    fn fetch_metadata(&mut self) {
        self.pending = std::mem::take(&mut self.changed).into_iter().collect();
        self.metadata_phase();
    }

    fn metadata_phase(&mut self) {
        self.phase = if self.pending.is_empty() {
            Phase::Commit
        } else {
            Phase::Metadata
        };
    }
}
