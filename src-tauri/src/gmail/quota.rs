use super::{Error, Result};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

// New Cloud projects allow 6,000 units/user/minute. Leave room for other clients:
// 80 units/second plus a 400-unit burst uses at most 5,200 units in any minute.
const UNITS_PER_SECOND: f64 = 80.0;
const BURST: f64 = 400.0;

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
    pub fn acquire(&self, path: &str) -> Result<()> {
        loop {
            let wait = self
                .0
                .lock()
                .map_err(|_| Error::new("invalid", "Gmail request budget is unavailable"))?
                .reserve(Instant::now(), cost(path))?;
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
        if let Some(deadline) = self.cooldown.filter(|deadline| *deadline > now) {
            let mut error = Error::new("rate_limit", "Gmail rate limit reached. Sync will retry.");
            error.retry_after = Some((deadline - now).as_secs_f64().ceil() as u64);
            return Err(error);
        }
        self.units =
            (self.units + (now - self.updated).as_secs_f64() * UNITS_PER_SECOND).min(BURST);
        self.updated = now;
        if self.units >= cost {
            self.units -= cost;
            Ok(Duration::ZERO)
        } else {
            Ok(Duration::from_secs_f64(
                (cost - self.units) / UNITS_PER_SECOND,
            ))
        }
    }
}

fn cost(path: &str) -> f64 {
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
