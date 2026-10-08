package platform

import "testing"

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestParseWindowOptions(t *testing.T) {
	o := ParseWindowOptions(env(nil))
	if !o.Vibrancy || o.Glass || o.Appearance != "" || o.URL != "/?vibrancy=1" {
		t.Fatalf("vibrancy must be the default: %+v", o)
	}
	o = ParseWindowOptions(env(map[string]string{"ZUSTELLER_VIBRANCY": "0"}))
	if o.Vibrancy || o.URL != "/" {
		t.Fatalf("opt-out wrong: %+v", o)
	}
	o = ParseWindowOptions(env(map[string]string{"ZUSTELLER_VIBRANCY": "1", "ZUSTELLER_BACKDROP": "Glass", "ZUSTELLER_APPEARANCE": "DARK"}))
	if !o.Vibrancy || !o.Glass || o.Appearance != "dark" || o.URL != "/?vibrancy=1" {
		t.Fatalf("vibrancy options wrong: %+v", o)
	}
	// Glass is meaningless without vibrancy; junk appearance is ignored.
	o = ParseWindowOptions(env(map[string]string{"ZUSTELLER_VIBRANCY": "0", "ZUSTELLER_BACKDROP": "glass", "ZUSTELLER_APPEARANCE": "purple"}))
	if o.Glass || o.Appearance != "" {
		t.Fatalf("expected glass off and appearance ignored: %+v", o)
	}
}
