use super::{Error, Result};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

// New Cloud projects allow 6,000 units/user/minute. Leave room for other clients:
// 80 units/second plus an 800-unit burst uses at most 5,600 units in any minute.
const UNITS_PER_SECOND: f64 = 80.0;
const BURST: f64 = 800.0;
// Keep two full thread reads available while background metadata is being fetched.
const INTERACTIVE_RESERVE: f64 = 240.0;

pub struct Quota(Mutex<Budget>);
struct Budget {
    units: f64,
    updated: Instant,
    cooldown: Option<Instant>,
}

impl Default for Quota {
    fn default() -> Self {
        Self(Mutex::new(Budget {
            units: BURST,
            updated: Instant::now(),
            cooldown: None,
        }))
    }
}

impl Quota {
    pub fn background_wait(&self, path: &str) -> Result<Duration> {
        self.background_wait_cost(cost(path))
    }

    pub fn background_wait_cost(&self, cost: f64) -> Result<Duration> {
        // A 401 can trigger one retry. Keep the foreground reserve even then.
        self.0
            .lock()
            .map_err(|_| Error::new("invalid", "Gmail request budget is unavailable"))?
            .wait_for(Instant::now(), 2.0 * cost + INTERACTIVE_RESERVE)
    }

    /// Pacing for row metadata: wait until the batch fits and the interactive reserve remains.
    pub fn metadata_wait(&self, cost: f64) -> Result<Duration> {
        self.0
            .lock()
            .map_err(|_| Error::new("invalid", "Gmail request budget is unavailable"))?
            .wait_for(Instant::now(), 2.0 * cost + INTERACTIVE_RESERVE)
    }

    #[cfg(test)]
    pub fn acquire(&self, path: &str) -> Result<()> {
        self.acquire_cost(cost(path))
    }

    pub fn acquire_cost(&self, cost: f64) -> Result<()> {
        loop {
            let wait = self
                .0
                .lock()
                .map_err(|_| Error::new("invalid", "Gmail request budget is unavailable"))?
                .reserve(Instant::now(), cost)?;
            if wait.is_zero() {
                return Ok(());
            }
            // Release the lock while waiting so a concurrent rate-limit response can
            // stop every worker. Recheck both the budget and cooldown before sending.
            std::thread::sleep(wait);
        }
    }

    pub fn limited(&self, error: &mut Error) {
        let seconds = error.retry_after.unwrap_or(60).max(60);
        error.retry_after = Some(seconds);
        if let Ok(mut budget) = self.0.lock() {
            let deadline = Instant::now() + Duration::from_secs(seconds);
            budget.cooldown = Some(budget.cooldown.map_or(deadline, |old| old.max(deadline)));
        }
    }
}

impl Budget {
    fn reserve(&mut self, now: Instant, cost: f64) -> Result<Duration> {
        let wait = self.wait_for(now, cost)?;
        if wait.is_zero() {
            self.units -= cost;
        }
        Ok(wait)
    }

    fn wait_for(&mut self, now: Instant, cost: f64) -> Result<Duration> {
        if let Some(deadline) = self.cooldown.filter(|deadline| *deadline > now) {
            let mut error = Error::new("rate_limit", "Gmail rate limit reached. Sync will retry.");
            error.retry_after = Some((deadline - now).as_secs_f64().ceil() as u64);
            return Err(error);
        }
        self.units =
            (self.units + (now - self.updated).as_secs_f64() * UNITS_PER_SECOND).min(BURST);
        self.updated = now;
        if self.units >= cost {
            Ok(Duration::ZERO)
        } else {
            Ok(Duration::from_secs_f64(
                (cost - self.units) / UNITS_PER_SECOND,
            ))
        }
    }
}

pub fn cost(path: &str) -> f64 {
    match path {
        "profile" | "labels" => 1.0,
        "history" => 2.0,
        "threads" => 10.0,
        _ if path.starts_with("labels/") => 1.0,
        _ if path.starts_with("messages/") => 20.0,
        _ => 40.0,
    }
}

/// Full bodies have a different cost than metadata, even at the same endpoint.
pub fn request_cost(path: &str, params: &[(&str, String)]) -> f64 {
    if params
        .iter()
        .any(|(key, value)| *key == "format" && ["full", "raw", "html"].contains(&value.as_str()))
    {
        if path.starts_with("threads/") {
            return 120.0;
        }
        if path.starts_with("messages/") && !path.contains("/attachments/") {
            return 60.0;
        }
    }
    cost(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_retry_preserves_two_full_conversation_reads() {
        let now = Instant::now();
        let mut budget = Budget {
            units: BURST,
            updated: now,
            cooldown: None,
        };
        let batch = 2.0 * request_cost("threads/t", &[("format", "full".into())]);
        assert!(budget
            .wait_for(now, 2.0 * batch + INTERACTIVE_RESERVE)
            .unwrap()
            .is_zero());
        assert!(budget.reserve(now, batch).unwrap().is_zero());
        assert!(budget.reserve(now, batch).unwrap().is_zero());
        for _ in 0..2 {
            assert!(budget
                .reserve(now, request_cost("threads/t", &[("format", "full".into())]))
                .unwrap()
                .is_zero());
        }
        assert!(
            budget
                .wait_for(now, 2.0 * batch + INTERACTIVE_RESERVE)
                .unwrap()
                > Duration::ZERO
        );
    }

    #[test]
    fn full_body_costs_and_rolling_minute_bound_match_gmail() {
        assert_eq!(
            request_cost("threads/t", &[("format", "full".into())]),
            120.0
        );
        assert_eq!(
            request_cost("threads/t", &[("format", "metadata".into())]),
            40.0
        );
        assert_eq!(
            request_cost("messages/m", &[("format", "raw".into())]),
            60.0
        );
        assert_eq!(request_cost("messages/m/attachments/a", &[]), 20.0);
        assert!(BURST + 60.0 * UNITS_PER_SECOND < 6000.0);
    }

    #[test]
    fn cooldown_blocks_even_cheap_requests_until_the_deadline() {
        let now = Instant::now();
        let mut budget = Budget {
            units: BURST,
            updated: now,
            cooldown: Some(now + Duration::from_secs(60)),
        };
        let error = budget
            .reserve(now + Duration::from_millis(500), 1.0)
            .unwrap_err();
        assert_eq!(error.code, "rate_limit");
        assert_eq!(error.retry_after, Some(60));
        assert!(budget
            .reserve(now + Duration::from_secs(60), 1.0)
            .unwrap()
            .is_zero());
    }

    #[test]
    fn retry_after_is_honored_and_later_errors_cannot_shorten_cooldown() {
        let quota = Quota::default();
        let mut error = Error::new("rate_limit", "Slow down");
        error.retry_after = Some(120);
        quota.limited(&mut error);
        let deadline = quota.0.lock().unwrap().cooldown.unwrap();
        error.retry_after = None;
        quota.limited(&mut error);
        assert_eq!(error.retry_after, Some(60));
        assert_eq!(quota.0.lock().unwrap().cooldown, Some(deadline));
        assert_eq!(quota.acquire("labels").unwrap_err().retry_after, Some(120));
    }
}
