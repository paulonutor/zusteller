use super::{Error, Result};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

// New Cloud projects allow 6,000 units/user/minute. Leave room for other clients:
// 80 units/second plus a 400-unit burst uses at most 5,200 units in any minute.
const UNITS_PER_SECOND: f64 = 80.0;
const BURST: f64 = 400.0;
// Keep two full thread reads available while background metadata is being fetched.
const INTERACTIVE_RESERVE: f64 = 80.0;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_pacing_preserves_budget_for_interactive_reads() {
        let now = Instant::now();
        let mut budget = Budget {
            units: BURST,
            updated: now,
            cooldown: None,
        };
        for _ in 0..7 {
            assert!(budget
                .wait_for(now, 2.0 * cost("threads/t") + INTERACTIVE_RESERVE)
                .unwrap()
                .is_zero());
            assert!(budget.reserve(now, cost("threads/t")).unwrap().is_zero());
        }
        assert_eq!(
            budget.wait_for(now, 80.0 + INTERACTIVE_RESERVE).unwrap(),
            Duration::from_millis(500)
        );
        // Even if the last background request needed an authentication retry,
        // two interactive reads can still start immediately.
        assert!(budget.reserve(now, cost("threads/t")).unwrap().is_zero());
        // Checking background availability does not spend the remaining tokens.
        assert!(budget
            .reserve(now, cost("threads/opened"))
            .unwrap()
            .is_zero());
        assert!(budget
            .reserve(now, cost("threads/another"))
            .unwrap()
            .is_zero());
        assert_eq!(budget.units, 0.0);
    }

    #[test]
    fn four_thread_batch_and_full_auth_retry_preserve_two_interactive_reads() {
        let now = Instant::now();
        let mut budget = Budget {
            units: BURST,
            updated: now,
            cooldown: None,
        };
        let batch_cost = 4.0 * cost("threads/t");
        assert!(budget
            .wait_for(now, 2.0 * batch_cost + INTERACTIVE_RESERVE)
            .unwrap()
            .is_zero());
        assert!(budget.reserve(now, batch_cost).unwrap().is_zero());
        assert_eq!(
            budget
                .wait_for(now, 2.0 * batch_cost + INTERACTIVE_RESERVE)
                .unwrap(),
            Duration::from_secs(2)
        );
        // A retry may use its reserved budget without waiting. Two foreground
        // opens still fit immediately after both attempts.
        assert!(budget.reserve(now, batch_cost).unwrap().is_zero());
        assert!(budget
            .reserve(now, cost("threads/first"))
            .unwrap()
            .is_zero());
        assert!(budget
            .reserve(now, cost("threads/second"))
            .unwrap()
            .is_zero());
        assert_eq!(budget.units, 0.0);
    }

    #[test]
    fn metadata_bursts_are_bounded_and_tokens_refill_without_accumulating() {
        let now = Instant::now();
        let mut budget = Budget {
            units: BURST,
            updated: now,
            cooldown: None,
        };
        for _ in 0..10 {
            assert!(budget.reserve(now, cost("threads/t")).unwrap().is_zero());
        }
        assert_eq!(
            budget.reserve(now, 40.0).unwrap(),
            Duration::from_millis(500)
        );
        assert!(budget
            .reserve(now + Duration::from_millis(500), 40.0)
            .unwrap()
            .is_zero());
        assert_eq!(
            budget
                .reserve(now + Duration::from_millis(500), 40.0)
                .unwrap(),
            Duration::from_millis(500)
        );
        assert!(budget
            .reserve(now + Duration::from_secs(60), 40.0)
            .unwrap()
            .is_zero());
        assert_eq!(budget.units, BURST - 40.0);
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
