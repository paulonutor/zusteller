use std::sync::{Arc, Condvar, Mutex};

// Register foreground work before spawning it, so sync also yields to requests
// that are still waiting for a blocking thread. One permit owns the Gmail worker.
#[derive(Default)]
pub struct Scheduler {
    queue: Mutex<Queue>,
    ready: Condvar,
}

#[derive(Default)]
struct Queue {
    active: bool,
    foreground: usize,
}

pub struct Ticket {
    scheduler: Arc<Scheduler>,
}

pub struct Permit<'a>(&'a Scheduler);

impl Scheduler {
    pub fn foreground(self: &Arc<Self>) -> Ticket {
        self.queue
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .foreground += 1;
        Ticket {
            scheduler: self.clone(),
        }
    }

    pub fn background(&self) -> Permit<'_> {
        let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        while queue.active || queue.foreground > 0 {
            queue = self.ready.wait(queue).unwrap_or_else(|e| e.into_inner());
        }
        queue.active = true;
        Permit(self)
    }
}

impl Ticket {
    pub fn enter(&self) -> Permit<'_> {
        let mut queue = self
            .scheduler
            .queue
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        while queue.active {
            queue = self
                .scheduler
                .ready
                .wait(queue)
                .unwrap_or_else(|e| e.into_inner());
        }
        queue.active = true;
        // Keep this ticket registered until drop, including while it is active.
        Permit(&self.scheduler)
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        self.scheduler
            .queue
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .foreground -= 1;
        self.scheduler.ready.notify_all();
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.0
            .queue
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active = false;
        self.0.ready.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn queued_interaction_precedes_the_next_sync_step() {
        let scheduler = Arc::new(Scheduler::default());
        let current_sync = scheduler.background();
        let ticket = scheduler.foreground();
        let (events, received) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let foreground = std::thread::spawn(move || {
            let _permit = ticket.enter();
            events.send("interactive").unwrap();
            released.recv().unwrap();
        });
        let background_scheduler = scheduler.clone();
        let background = std::thread::spawn(move || {
            let _permit = background_scheduler.background();
            "sync"
        });
        drop(current_sync);
        assert_eq!(
            received.recv_timeout(Duration::from_secs(5)).unwrap(),
            "interactive"
        );
        assert!(!background.is_finished());
        release.send(()).unwrap();
        foreground.join().unwrap();
        assert_eq!(background.join().unwrap(), "sync");
    }

    #[test]
    fn cancelled_ticket_does_not_block_background_work() {
        let scheduler = Arc::new(Scheduler::default());
        drop(scheduler.foreground());
        let _permit = scheduler.background();
    }
}
