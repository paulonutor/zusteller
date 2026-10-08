// zusteller Wails v3 host. Thin by design: it only loads the shared frontend
// (../../frontend) and exposes what frontend/src/platform/PlatformService needs.
package main

import (
	"embed"
	"io/fs"
	"log"
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"zusteller/hosts/wails/internal/platform"
)

// appdist holds the production build of ../../frontend (`task build:frontend`
// writes it here; it is a build artifact, not a copy of the source). In dev,
// FRONTEND_DEVSERVER_URL (set by `task dev`) makes Wails proxy to Vite and this
// embed is ignored.
//
//go:embed all:appdist
var embedded embed.FS

type dockAdapter struct{ d *dock.DockService }

func (a dockAdapter) SetBadge(l string) error { return a.d.SetBadge(l) }
func (a dockAdapter) RemoveBadge() error      { return a.d.RemoveBadge() }

type notifAdapter struct {
	n *notifications.NotificationService
}

func (a notifAdapter) Notify(id, title, body string) error {
	if ok, err := a.n.CheckNotificationAuthorization(); err == nil && !ok {
		if _, err := a.n.RequestNotificationAuthorization(); err != nil {
			return err
		}
	}
	return a.n.SendNotification(notifications.NotificationOptions{ID: id, Title: title, Body: body})
}

type browserAdapter struct{ app *application.App }

func (a browserAdapter) OpenURL(u string) error { return a.app.Browser.OpenURL(u) }

// inAppBundle reports whether we run from a macOS .app bundle. The notifications
// service refuses to start without a bundle identifier, so under `go run` it is skipped.
func inAppBundle() bool {
	exe, err := os.Executable()
	return err == nil && strings.Contains(exe, ".app/Contents/MacOS/")
}

func main() {
	assets, err := fs.Sub(embedded, "appdist")
	if err != nil {
		log.Fatal(err)
	}

	dockSvc := dock.New()
	hostPlatform := &platform.Service{Dock: dockAdapter{dockSvc}}
	services := []application.Service{
		application.NewService(dockSvc),
		application.NewService(hostPlatform),
	}
	if inAppBundle() {
		notifSvc := notifications.New()
		hostPlatform.Notifier = notifAdapter{notifSvc}
		services = append(services, application.NewService(notifSvc))
	} else {
		log.Println("notifications disabled: not running from an .app bundle (no bundle identifier)")
	}

	app := application.New(application.Options{
		Name:        "zusteller",
		Description: "Lightweight mail client",
		// Only the PlatformService is bound to JS. The dock/notification
		// services are used from Go and intentionally NOT exposed to the page.
		Services: services,
		Assets: application.AssetOptions{
			// Also serves /wails/runtime.js, which the frontend adapter loads.
			Handler: application.BundledAssetFileServer(assets),
		},
		Mac: application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	hostPlatform.Opener = browserAdapter{app}

	app.Menu.Set(buildMenu(app))

	opts := platform.ParseWindowOptions(os.Getenv)
	mac := application.MacWindow{
		// Hidden titlebar, full-size content, genuine traffic lights, inset further (Unified toolbar style).
		TitleBar: application.MacTitleBarHiddenInsetUnified,
		Backdrop: application.MacBackdropNormal,
	}
	// Opaque by default. Vibrancy is an opt-in experiment (see README): translucent backdrop +
	// transparent window; the webview itself only turns transparent with -tags private_mac_apis.
	background := application.NewRGBA(28, 28, 30, 255)
	if opts.Vibrancy {
		background = application.NewRGBA(0, 0, 0, 0)
		mac.Backdrop = application.MacBackdropTranslucent
		if opts.Glass {
			mac.Backdrop = application.MacBackdropLiquidGlass
		}
	}
	switch opts.Appearance {
	case "dark":
		mac.Appearance = application.NSAppearanceNameDarkAqua
	case "light":
		mac.Appearance = application.NSAppearanceNameAqua
	}

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "zusteller",
		Width:            1280,
		Height:           800,
		MinWidth:         900,
		MinHeight:        600,
		URL:              opts.URL,
		BackgroundColour: background,
		Mac:              mac,
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
