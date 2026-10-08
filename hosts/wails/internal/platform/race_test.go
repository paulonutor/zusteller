package platform

import (
	"sync"
	"testing"
)

type idRecorder struct {
	mu  sync.Mutex
	ids map[string]bool
}

func (r *idRecorder) Notify(id, _, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ids[id] = true
	return nil
}

// Wails invokes bound methods from separate goroutines; run with -race.
func TestShowNotificationConcurrentUniqueIDs(t *testing.T) {
	rec := &idRecorder{ids: map[string]bool{}}
	s := &Service{Notifier: rec}
	const n = 200
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = s.ShowNotification("t", "b")
		}()
	}
	wg.Wait()
	if len(rec.ids) != n {
		t.Fatalf("expected %d unique ids, got %d", n, len(rec.ids))
	}
}
