// Package platform holds the host-side half of the frontend's PlatformService
// (frontend/src/platform/PlatformService.ts). It has no Wails imports so it can
// be unit-tested on any OS; main.go adapts the Wails services to the small
// interfaces below.
package platform

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync/atomic"
)

// Dock is the badge capability (Wails dock service).
type Dock interface {
	SetBadge(label string) error
	RemoveBadge() error
}

// Notifier posts a user notification (Wails notifications service).
type Notifier interface {
	Notify(id, title, body string) error
}

// Opener opens a URL in the user's default handler (Wails Browser manager).
type Opener interface {
	OpenURL(url string) error
}

// Appearance pins the native window appearance at runtime ("light" | "dark"; "system" follows the OS).
type Appearance interface {
	SetAppearance(theme string) error
	// AccentColor is the user's system accent colour as "#rrggbb".
	AccentColor() (string, error)
}

// Service is bound to the frontend. Only methods PlatformService needs.
type Service struct {
	Dock       Dock
	Notifier   Notifier
	Opener     Opener
	Appearance Appearance

	nextID atomic.Int64
}

// ValidateExternalURL allows only http, https and mailto.
func ValidateExternalURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		if u.Host == "" {
			return "", errors.New("URL has no host")
		}
	case "mailto":
		if u.Opaque == "" && u.Path == "" {
			return "", errors.New("mailto URL has no recipient")
		}
	default:
		return "", fmt.Errorf("refusing to open %q URL", u.Scheme)
	}
	return u.String(), nil
}

// OpenExternal opens an http(s)/mailto URL in the default handler.
func (s *Service) OpenExternal(rawURL string) error {
	safe, err := ValidateExternalURL(rawURL)
	if err != nil {
		return err
	}
	return s.Opener.OpenURL(safe)
}

// SetBadge shows count on the Dock icon; count <= 0 removes the badge.
func (s *Service) SetBadge(count int) error {
	if count <= 0 {
		return s.Dock.RemoveBadge()
	}
	return s.Dock.SetBadge(fmt.Sprint(count))
}

// ShowNotification posts a notification (needs a signed, bundled app on macOS).
func (s *Service) ShowNotification(title, body string) error {
	if s.Notifier == nil {
		return errors.New("notifications unavailable: not running from a bundled app")
	}
	return s.Notifier.Notify(fmt.Sprintf("zusteller-%d", s.nextID.Add(1)), title, body)
}

// SetWindowTheme pins the native window appearance ("light", "dark" or "system") so the native
// material stays in step with the app theme.
func (s *Service) SetWindowTheme(theme string) error {
	switch theme {
	case "light", "dark", "system":
	default:
		return fmt.Errorf("unknown window theme %q", theme)
	}
	if s.Appearance == nil {
		return errors.New("window theme unavailable on this platform")
	}
	return s.Appearance.SetAppearance(theme)
}

// AccentColor returns the macOS accent colour as "#rrggbb". WKWebView reports default blue for the
// CSS system accent whatever the user picked, so the page asks the host instead.
func (s *Service) AccentColor() (string, error) {
	if s.Appearance == nil {
		return "", errors.New("accent colour unavailable on this platform")
	}
	return s.Appearance.AccentColor()
}
