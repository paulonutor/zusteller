use super::{quota, Result};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAX_ENTRIES: usize = 200;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    timestamp: u64,
    operation: &'static str,
    outcome: String,
    status: Option<u16>,
    duration_ms: u64,
    wait_ms: u64,
    quota_units: u64,
    reason: Option<String>,
    retry_after: Option<u64>,
    count: Option<usize>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    entries: VecDeque<Entry>,
    requests: u64,
    quota_units: u64,
    rate_limits: u64,
    cache_hits: u64,
}

#[derive(Default)]
pub struct Diagnostics(Mutex<Snapshot>);

impl Diagnostics {
    pub fn snapshot(&self) -> Snapshot {
        let log = self.0.lock().unwrap_or_else(|e| e.into_inner());
        Snapshot {
            entries: log.entries.clone(),
            requests: log.requests,
            quota_units: log.quota_units,
            rate_limits: log.rate_limits,
            cache_hits: log.cache_hits,
        }
    }

    fn push(&self, entry: Entry) {
        let mut log = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if entry.quota_units > 0 {
            log.requests += 1;
            log.quota_units += entry.quota_units;
            if entry.outcome == "rate_limit" {
                log.rate_limits += 1;
            }
        }
        if entry.operation == "cache" {
            log.cache_hits += entry.count.unwrap_or(0) as u64;
        }
        log.entries.push_back(entry);
        if log.entries.len() > MAX_ENTRIES {
            log.entries.pop_front();
        }
    }

    pub fn event(&self, operation: &'static str, outcome: &'static str, count: Option<usize>) {
        let mut entry = Entry::new(operation, outcome.into());
        entry.count = count;
        self.push(entry);
    }

    pub fn request(
        &self,
        path: &str,
        status: Option<u16>,
        result: &Result<serde_json::Value>,
        timing: (Duration, Duration),
        reason: Option<&str>,
        sent: bool,
    ) {
        // Classify the route, never retain URLs, IDs, query parameters or payloads.
        let operation = match path {
            "profile" => "getProfile",
            "history" => "history.list",
            "labels" => "labels.list",
            "threads" => "threads.list",
            _ if path.starts_with("labels/") => "labels.get",
            _ if path.starts_with("messages/") => "attachments.get",
            _ => "threads.get",
        };
        let error = result.as_ref().err();
        let mut entry = Entry::new(operation, error.map_or("ok", |e| e.code.as_str()).into());
        entry.status = status;
        entry.duration_ms = timing.0.as_millis() as u64;
        entry.wait_ms = timing.1.as_millis() as u64;
        entry.quota_units = if sent { quota::cost(path) as u64 } else { 0 };
        // Google reasons are untrusted strings. Retain only documented categories,
        // never arbitrary response text in the diagnostics window or copied log.
        entry.reason = reason.map(|reason| match reason {
            "userRateLimitExceeded"
            | "rateLimitExceeded"
            | "quotaExceeded"
            | "dailyLimitExceeded"
            | "authError"
            | "insufficientPermissions"
            | "forbidden"
            | "notFound"
            | "backendError" => reason.to_owned(),
            _ => "other".to_owned(),
        });
        entry.retry_after = error.and_then(|e| e.retry_after);
        self.push(entry);
    }
}

impl Entry {
    fn new(operation: &'static str, outcome: String) -> Self {
        Self {
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            operation,
            outcome,
            status: None,
            duration_ms: 0,
            wait_ms: 0,
            quota_units: 0,
            reason: None,
            retry_after: None,
            count: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retention_is_bounded_while_session_totals_are_preserved() {
        let log = Diagnostics::default();
        for _ in 0..250 {
            log.request(
                "threads/private-id",
                Some(200),
                &Ok(serde_json::Value::Null),
                (Duration::ZERO, Duration::ZERO),
                None,
                true,
            );
        }
        let snapshot = log.snapshot();
        assert_eq!(snapshot.entries.len(), MAX_ENTRIES);
        assert_eq!(snapshot.requests, 250);
        assert_eq!(snapshot.quota_units, 10_000);
        let text = serde_json::to_string(&snapshot).unwrap();
        assert!(text.contains("threads.get"));
        assert!(!text.contains("private-id"));
    }

    #[test]
    fn cooldown_skips_do_not_count_as_google_requests() {
        let log = Diagnostics::default();
        let mut error = super::super::Error::new("rate_limit", "Private response text");
        error.retry_after = Some(60);
        log.request(
            "history",
            None,
            &Err(error),
            (Duration::ZERO, Duration::ZERO),
            None,
            false,
        );
        log.event("cache", "reused", Some(25));
        let snapshot = log.snapshot();
        assert_eq!(snapshot.requests, 0);
        assert_eq!(snapshot.cache_hits, 25);
        let text = serde_json::to_string(&snapshot).unwrap();
        assert!(!text.contains("Private response text"));
        assert!(text.contains("retryAfter"));
    }

    #[test]
    fn unknown_google_reasons_cannot_expose_response_text() {
        let log = Diagnostics::default();
        log.request(
            "threads/private-id",
            Some(403),
            &Err(super::super::Error::new("permission", "Private body")),
            (Duration::ZERO, Duration::ZERO),
            Some("private@example.com"),
            true,
        );
        let output = serde_json::to_string(&log.snapshot()).unwrap();
        assert!(!output.contains("private"));
        assert!(!output.contains("Private body"));
        assert!(output.contains("other"));
    }
}
