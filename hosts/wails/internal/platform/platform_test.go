package platform

import "testing"

type fakes struct {
	badge, opened []string
	removed       int
	notified      [][3]string
}

func (f *fakes) SetBadge(l string) error { f.badge = append(f.badge, l); return nil }
func (f *fakes) RemoveBadge() error      { f.removed++; return nil }
func (f *fakes) OpenURL(u string) error  { f.opened = append(f.opened, u); return nil }
func (f *fakes) Notify(id, t, b string) error {
	f.notified = append(f.notified, [3]string{id, t, b})
	return nil
}

func TestOpenExternalSchemes(t *testing.T) {
	f := &fakes{}
	s := &Service{Dock: f, Notifier: f, Opener: f}
	for _, ok := range []string{"https://example.com/a?b=1", "http://example.com", "mailto:a@b.de"} {
		if err := s.OpenExternal(ok); err != nil {
			t.Errorf("%s should be allowed: %v", ok, err)
		}
	}
	for _, bad := range []string{"javascript:alert(1)", "file:///etc/passwd", "ftp://x", "data:text/html,x", "https://", "mailto:", "//evil", ""} {
		if err := s.OpenExternal(bad); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
	if len(f.opened) != 3 {
		t.Fatalf("opened %v", f.opened)
	}
}

func TestBadgeAndNotification(t *testing.T) {
	f := &fakes{}
	s := &Service{Dock: f, Notifier: f, Opener: f}
	_ = s.SetBadge(3)
	_ = s.SetBadge(0)
	_ = s.SetBadge(-1)
	if len(f.badge) != 1 || f.badge[0] != "3" || f.removed != 2 {
		t.Fatalf("badge %v removed %d", f.badge, f.removed)
	}
	_ = s.ShowNotification("Hi", "there")
	_ = s.ShowNotification("Hi2", "")
	if len(f.notified) != 2 || f.notified[0][0] == f.notified[1][0] {
		t.Fatalf("notified %v", f.notified)
	}
}
