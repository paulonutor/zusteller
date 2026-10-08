//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

// mode: 0 = follow system, 1 = light (Aqua), 2 = dark (DarkAqua).
static void zustellerSetAppearance(int mode) {
	dispatch_async(dispatch_get_main_queue(), ^{
		NSAppearance *a = nil;
		if (mode == 1) a = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
		if (mode == 2) a = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
		[NSApp setAppearance:a];
	});
}
*/
import "C"

import "zusteller/hosts/wails/internal/platform"

func newAppearance() platform.Appearance { return appAppearance{} }

// appAppearance sets NSApp.appearance, which the (single) window inherits. Wails beta.28 only
// accepts an appearance at window creation, so the runtime switch lives here.
type appAppearance struct{}

func (appAppearance) SetAppearance(theme string) error {
	switch theme {
	case "light":
		C.zustellerSetAppearance(1)
	case "dark":
		C.zustellerSetAppearance(2)
	default:
		C.zustellerSetAppearance(0)
	}
	return nil
}
