package main

import (
	"reflect"
	"testing"
)

// Wails binds every exported method of a registered service except these hooks.
var wailsSkipped = map[string]bool{
	"ServiceName": true, "ServiceStartup": true, "ServiceShutdown": true, "ServeHTTP": true,
}

func TestLifecycleBindsNothingToThePage(t *testing.T) {
	typ := reflect.TypeOf(&lifecycle{})
	for i := 0; i < typ.NumMethod(); i++ {
		if name := typ.Method(i).Name; !wailsSkipped[name] {
			t.Errorf("lifecycle exposes bindable method %q", name)
		}
	}
}
