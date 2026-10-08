//go:build !darwin

package main

import "zusteller/hosts/wails/internal/platform"

// No native material to keep in step with the app theme outside macOS.
func newAppearance() platform.Appearance { return nil }
