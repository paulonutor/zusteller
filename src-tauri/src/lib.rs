use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime,
};
use tauri_plugin_notification::NotificationExt;

/// Event the frontend listens to. Payload is the menu item id (see MENU_* below).
const MENU_EVENT: &str = "zusteller://menu";

/// Menu item ids sent to the frontend as the event payload.
const MAIL_ITEMS: [(&str, &str, Option<&str>); 6] = [
    ("mail.archive", "Archive", None),
    ("mail.trash", "Move to Trash", None),
    ("mail.markRead", "Mark as Read", None),
    ("mail.markUnread", "Mark as Unread", None),
    ("mail.star", "Add / Remove Star", None),
    // Cmd+F is the standard macOS Find shortcut. The other mail items get no
    // accelerator: the frontend owns its plain-key shortcuts (and ignores them
    // while typing), a menu accelerator would fire even inside text fields.
    ("mail.find", "Find", Some("CmdOrCtrl+F")),
];

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "zusteller")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let mut mail = SubmenuBuilder::new(app, "Mail");
    for (id, label, accel) in MAIL_ITEMS {
        let mut item = MenuItemBuilder::with_id(id, label);
        if let Some(a) = accel {
            item = item.accelerator(a);
        }
        mail = mail.item(&item.build(app)?);
    }
    let mail_menu = mail.build()?;

    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &mail_menu, &view_menu, &window_menu])
        .build()
}

/// Show a native notification. Requests permission on first use.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: Option<String>) -> Result<(), String> {
    let n = app.notification();
    let granted = match n.permission_state().map_err(|e| e.to_string())? {
        tauri::plugin::PermissionState::Granted => true,
        _ => matches!(
            n.request_permission().map_err(|e| e.to_string())?,
            tauri::plugin::PermissionState::Granted
        ),
    };
    if !granted {
        return Ok(()); // user declined; not an error for the UI
    }
    let mut b = n.builder().title(title);
    if let Some(body) = body {
        b = b.body(body);
    }
    b.show().map_err(|e| e.to_string())
}

/// Dock badge. `None`/0 clears it. macOS (and Linux/iOS) only; no-op error elsewhere.
#[tauri::command]
fn set_badge(app: AppHandle, count: Option<i64>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let count = count.filter(|c| *c > 0);
    window.set_badge_count(count).map_err(|e| e.to_string())
}

/// Pin the window (and so the native vibrancy material) to light/dark, or follow the system with
/// `None`. The page's own theme and the native material must agree, otherwise text loses contrast.
#[tauri::command]
fn set_window_theme(app: AppHandle, theme: Option<String>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let theme = match theme.as_deref() {
        Some("dark") => Some(tauri::Theme::Dark),
        Some("light") => Some(tauri::Theme::Light),
        _ => None,
    };
    window.set_theme(theme).map_err(|e| e.to_string())
}

/// Event emitted (payload `#rrggbb`) when the system accent colour changes.
const ACCENT_EVENT: &str = "zusteller://accent";

/// The user's macOS accent colour as `#rrggbb` (sRGB). WKWebView resolves the CSS system accent to
/// default blue regardless of System Settings, so the page asks the host.
#[tauri::command]
fn accent_color() -> Result<String, String> {
    read_accent()
}

fn read_accent() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSColor, NSColorSpace};
        let c =
            { NSColor::controlAccentColor().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()) }
                .ok_or_else(|| "accent colour unavailable".to_string())?;
        let ch = |v: f64| (v * 255.0).round() as u8;
        Ok(format!(
            "#{:02x}{:02x}{:02x}",
            ch(c.redComponent()),
            ch(c.greenComponent()),
            ch(c.blueComponent())
        ))
    }
    #[cfg(not(target_os = "macos"))]
    Err("accent colour unavailable on this platform".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            notify,
            set_badge,
            set_window_theme,
            accent_color
        ])
        .setup(|app| {
            // No cheap in-process callback for accent changes: check once a second, emit on change.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last = read_accent().ok();
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    if let Ok(now) = read_accent() {
                        if last.as_deref() != Some(now.as_str()) {
                            let _ = handle.emit(ACCENT_EVENT, now.clone());
                            last = Some(now);
                        }
                    }
                }
            });
            Ok(())
        })
        .menu(|app| build_menu(app))
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id.starts_with("mail.") {
                let _ = app.emit(MENU_EVENT, id);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running zusteller");
}
