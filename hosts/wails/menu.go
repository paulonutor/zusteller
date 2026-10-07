package main

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// MailActionEvent is the Wails event name the frontend listens to. The payload
// is a single string (see mailActions below).
const MailActionEvent = "zusteller:mail-action"

// Payload values. All but "find" are src/features/mail/actions.ts MailActionId
// values; "find" has no MailActionId (it should focus the search field).
// "star" is a toggle request: the frontend decides star vs. unstar from the
// current selection (resolveActions), exactly as the keyboard shortcut does.
const (
	actionArchive    = "archive"
	actionTrash      = "trash"
	actionMarkRead   = "markRead"
	actionMarkUnread = "markUnread"
	actionStar       = "star"
	actionFind       = "find"
)

// buildMenu creates App / Edit / View / Window menus. Mail items deliberately
// carry NO plain-key accelerators (E, #, S, ...): a native key equivalent would
// swallow the keystroke before it reaches text inputs. The frontend keeps its
// own plain-key shortcuts (shortcuts.ts). Only Find uses the macOS-standard Cmd+F.
func buildMenu(app *application.App) *application.Menu {
	emit := func(id string) func(*application.Context) {
		return func(*application.Context) { app.Event.Emit(MailActionEvent, id) }
	}

	menu := app.Menu.New()
	if runtime.GOOS == "darwin" {
		menu.AddRole(application.AppMenu)
	}

	menu.AddRole(application.EditMenu)

	mail := menu.AddSubmenu("Mailbox")
	mail.Add("Archive").OnClick(emit(actionArchive))
	mail.Add("Move to Trash").OnClick(emit(actionTrash))
	mail.AddSeparator()
	mail.Add("Mark as Read").OnClick(emit(actionMarkRead))
	mail.Add("Mark as Unread").OnClick(emit(actionMarkUnread))
	mail.Add("Star").OnClick(emit(actionStar))
	mail.AddSeparator()
	mail.Add("Find").SetAccelerator("CmdOrCtrl+f").OnClick(emit(actionFind))

	menu.AddRole(application.ViewMenu)
	menu.AddRole(application.WindowMenu)
	return menu
}
