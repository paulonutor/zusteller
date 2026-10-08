package platform

import "strings"

// WindowOptions is the host-neutral result of reading the startup environment. main.go maps it to
// Wails window options; keeping the parsing here makes it testable without cgo/GTK.
type WindowOptions struct {
	// Vibrancy requests a translucent native backdrop AND tells the page (via ?vibrancy=1) to stop
	// painting opaque colour over it. On macOS the webview only becomes transparent when the binary
	// is built with `-tags private_mac_apis` (a private API; experiment only).
	Vibrancy bool
	// Glass prefers Apple's Liquid Glass backdrop (macOS 15+, falls back to translucent).
	Glass bool
	// Appearance pins the native appearance ("dark" | "light"); empty follows the system. Wails
	// beta.28 can only set it at window creation, so it cannot track the in-app theme at runtime.
	Appearance string
	// URL is the page to load.
	URL string
}

// ParseWindowOptions reads ZUSTELLER_VIBRANCY=1, ZUSTELLER_BACKDROP=glass and
// ZUSTELLER_APPEARANCE=dark|light.
func ParseWindowOptions(getenv func(string) string) WindowOptions {
	o := WindowOptions{URL: "/"}
	o.Vibrancy = getenv("ZUSTELLER_VIBRANCY") == "1"
	o.Glass = o.Vibrancy && strings.EqualFold(getenv("ZUSTELLER_BACKDROP"), "glass")
	switch a := strings.ToLower(getenv("ZUSTELLER_APPEARANCE")); a {
	case "dark", "light":
		o.Appearance = a
	}
	if o.Vibrancy {
		o.URL = "/?vibrancy=1"
	}
	return o
}
