package platform

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestWatchAccentEmitsOnlyOnChange(t *testing.T) {
	seq := []string{"#0a84ff", "#0a84ff", "#a550a7", "#a550a7", "#f74f9e"}
	i := 0
	ctx, cancel := context.WithCancel(context.Background())
	got := make(chan string, 4)
	get := func() (string, error) {
		if i >= len(seq) {
			cancel()
			return "", errors.New("done")
		}
		c := seq[i]
		i++
		return c, nil
	}
	done := make(chan struct{})
	go func() {
		WatchAccent(ctx, time.Millisecond, get, func(c string) { got <- c })
		close(done)
	}()
	<-done
	close(got)
	var all []string
	for c := range got {
		all = append(all, c)
	}
	if len(all) != 2 || all[0] != "#a550a7" || all[1] != "#f74f9e" {
		t.Fatalf("emitted %v", all)
	}
}
