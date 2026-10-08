package platform

import (
	"context"
	"time"
)

// WatchAccent polls get every interval and calls emit with the new colour whenever it changes
// (not for the initial value: the page asks for that itself). Errors are skipped. It returns when
// ctx is done. macOS offers no reliable in-process callback for accent changes that works without
// Cocoa blocks, and reading the colour is cheap, so the host just checks periodically.
func WatchAccent(ctx context.Context, interval time.Duration, get func() (string, error), emit func(string)) {
	last, _ := get()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c, err := get()
			if err != nil || c == last {
				continue
			}
			last = c
			emit(c)
		}
	}
}
