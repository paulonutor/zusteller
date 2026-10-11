use super::State;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const LABEL: &str = "gmail-activity";
const ACTION: &str = "zusteller://gmail-activity-action";
const RESULT: &str = "zusteller://gmail-activity-result";

#[derive(Default)]
pub struct Activity(Mutex<Option<Value>>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Refresh,
    Reset,
    Connect,
    Disconnect,
    CancelConnect,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    request_id: String,
    action: Action,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    request_id: String,
    error: Option<String>,
}

#[tauri::command]
pub async fn open_mail_activity<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::App("index.html?view=activity".into()),
    )
    .title(if app.state::<State>().privacy_enabled() {
        "Gmail Activity · Privacy mode"
    } else {
        "Gmail Activity"
    })
    .inner_size(820.0, 660.0)
    .min_inner_size(480.0, 420.0)
    .disable_drag_drop_handler()
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_mail_activity<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    require_window(&window, LABEL)?;
    window.close().map_err(|e| e.to_string())
}

// The main frontend owns connection lifecycle and polling. This independent
// snapshot lets the auxiliary window observe it without starting another provider.
#[tauri::command]
pub fn gmail_activity_snapshot(state: tauri::State<'_, State>) -> Value {
    state
        .activity
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .unwrap_or_else(|| json!({"status":{"state":"idle"},"busy":false}))
}

#[tauri::command]
pub fn gmail_activity_publish<R: Runtime>(
    window: WebviewWindow<R>,
    state: tauri::State<'_, State>,
    snapshot: Value,
) -> Result<(), String> {
    require_window(&window, "main")?;
    *state.activity.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(snapshot);
    Ok(())
}

#[tauri::command]
pub fn gmail_activity_action<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    request_id: String,
    action: Action,
) -> Result<(), String> {
    require_window(&window, LABEL)?;
    if app.get_webview_window("main").is_none() {
        return Err("The main window is closed. Reopen Zusteller to manage Gmail.".into());
    }
    app.emit_to("main", ACTION, Request { request_id, action })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn gmail_activity_result<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    request_id: String,
    error: Option<String>,
) -> Result<(), String> {
    require_window(&window, "main")?;
    app.emit_to(LABEL, RESULT, Response { request_id, error })
        .map_err(|e| e.to_string())
}

fn require_window<R: Runtime>(window: &WebviewWindow<R>, label: &str) -> Result<(), String> {
    if window.label() == label {
        Ok(())
    } else {
        Err("This command is unavailable in this window".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[test]
    fn activity_window_is_reused_and_snapshots_do_not_wait_for_the_mail_worker() {
        let app = mock_builder()
            .manage(State::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        let main = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .unwrap();
        tauri::async_runtime::block_on(open_mail_activity(app.handle().clone())).unwrap();
        let activity = app.get_webview_window(LABEL).unwrap();
        tauri::async_runtime::block_on(open_mail_activity(app.handle().clone())).unwrap();
        assert_eq!(app.webview_windows().len(), 2);
        let state = app.state::<State>();
        let _busy_worker = state.gmail.lock().unwrap();
        let snapshot = json!({"status":{"state":"syncing"},"busy":false});
        gmail_activity_publish(main.clone(), state.clone(), snapshot.clone()).unwrap();
        assert_eq!(gmail_activity_snapshot(state.clone()), snapshot);
        assert!(gmail_activity_publish(activity.clone(), state.clone(), json!({})).is_err());
        assert!(close_mail_activity(main).is_err());
        close_mail_activity(activity).unwrap();
    }

    #[test]
    fn only_the_activity_window_can_request_actions_and_only_main_can_answer() {
        let app = mock_builder()
            .manage(State::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        let main = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .unwrap();
        tauri::async_runtime::block_on(open_mail_activity(app.handle().clone())).unwrap();
        let activity = app.get_webview_window(LABEL).unwrap();
        assert!(gmail_activity_action(
            app.handle().clone(),
            main.clone(),
            "one".into(),
            Action::Refresh
        )
        .is_err());
        gmail_activity_action(
            app.handle().clone(),
            activity.clone(),
            "one".into(),
            Action::Refresh,
        )
        .unwrap();
        assert!(gmail_activity_result(app.handle().clone(), activity, "one".into(), None).is_err());
        gmail_activity_result(app.handle().clone(), main, "one".into(), None).unwrap();
        assert!(serde_json::from_str::<Action>("\"send\"").is_err());
    }
}
