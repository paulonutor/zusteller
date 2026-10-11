mod api;
mod auth;
mod model;
mod quota;
mod store;

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub code: String,
    pub message: String,
    pub retry_after: Option<u64>,
}
pub type Result<T> = std::result::Result<T, Error>;
impl Error {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retry_after: None,
        }
    }
}

#[derive(Default)]
pub struct State {
    gmail: Arc<Mutex<Option<api::Gmail>>>,
    connecting: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
}

async fn work<R: tauri::Runtime, T: Send + 'static>(
    app: tauri::AppHandle<R>,
    state: Arc<Mutex<Option<api::Gmail>>>,
    task: impl FnOnce(&mut api::Gmail) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state
            .lock()
            .map_err(|_| Error::new("invalid", "Gmail worker is unavailable"))?;
        if guard.is_none() {
            let path = app
                .path()
                .app_data_dir()
                .map_err(|_| Error::new("invalid", "App data directory is unavailable"))?
                .join("gmail/cache.sqlite");
            *guard = Some(api::Gmail::new(store::Store::open(&path)?)?);
        }
        task(guard.as_mut().unwrap())
    })
    .await
    .map_err(|_| Error::new("invalid", "Gmail worker failed"))?
}

#[tauri::command]
pub async fn gmail_connect(app: tauri::AppHandle, state: tauri::State<'_, State>) -> Result<Value> {
    if !cfg!(target_os = "macos") {
        return Err(Error::new(
            "invalid",
            "Gmail preview currently requires macOS Keychain",
        ));
    }
    if state.connecting.swap(true, Ordering::SeqCst) {
        return Err(Error::new(
            "invalid",
            "A Google sign-in is already in progress",
        ));
    }
    state.cancelled.store(false, Ordering::SeqCst);
    let connecting = state.connecting.clone();
    let cancelled = state.cancelled.clone();
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let file = handle
            .dialog()
            .file()
            .set_title("Choose Google Desktop OAuth client JSON")
            .add_filter("Google OAuth client", &["json"])
            .blocking_pick_file()
            .ok_or_else(|| Error::new("cancelled", "Gmail connection cancelled"))?;
        let path = file
            .into_path()
            .map_err(|_| Error::new("invalid", "Choose a local OAuth client file"))?;
        auth::authorize(&handle, &path, &cancelled)
    })
    .await
    .map_err(|_| Error::new("invalid", "Google sign-in worker failed"));
    let result = match result {
        Ok(Ok((grant, access))) if !state.cancelled.load(Ordering::SeqCst) => {
            let cancelled = state.cancelled.clone();
            work(app, state.gmail.clone(), move |g| {
                g.install(grant, access, &cancelled)
            })
            .await
        }
        Ok(Ok(_)) => Err(Error::new("cancelled", "Gmail connection cancelled")),
        Ok(Err(e)) | Err(e) => Err(e),
    };
    connecting.store(false, Ordering::SeqCst);
    result
}
#[tauri::command]
pub fn gmail_cancel_connect(state: tauri::State<'_, State>) {
    state.cancelled.store(true, Ordering::SeqCst);
}

/// Narrow provider commands. No arbitrary URLs, OAuth tokens or filesystem paths cross IPC.
#[tauri::command]
pub async fn gmail_read<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, State>,
    operation: String,
    account_id: Option<String>,
    input: Option<Value>,
) -> Result<Value> {
    let account = account_id.unwrap_or_default();
    let input = input.unwrap_or(json!({}));
    work(app, state.gmail.clone(), move |g| {
        if operation == "accounts" {
            return Ok(json!(g.store.accounts()?));
        }
        if !g
            .store
            .accounts()?
            .iter()
            .any(|a| model::text(a, "id") == account)
        {
            return Err(Error::new("not_found", "Gmail account is not connected"));
        }
        match operation.as_str() {
            "labels" => g.labels(&account),
            "counts" => g.counts(&account),
            "threads" => g.threads(&account, &input),
            "thread" => g.thread(&account, model::text(&input, "threadId")),
            "action" => g.action(&account, &input),
            "reset" => {
                g.store.reset(&account)?;
                Ok(Value::Null)
            }
            "disconnect" => g.disconnect(&account),
            "sync" => Ok(json!(g.sync(&account)?)),
            _ => Err(Error::new("invalid", "Unknown Gmail operation")),
        }
    })
    .await
}

#[tauri::command]
pub async fn gmail_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    account_id: String,
    thread_id: String,
    message_id: String,
    attachment_id: String,
    filename: String,
) -> Result<()> {
    let bytes = work(app.clone(), state.gmail.clone(), move |g| {
        g.attachment(&account_id, &message_id, &attachment_id, &thread_id)
    })
    .await?;
    // Native Save As keeps untrusted attachment filenames from choosing a path.
    tauri::async_runtime::spawn_blocking(move || {
        let name = std::path::Path::new(&filename)
            .file_name()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("attachment");
        if let Some(file) = app
            .dialog()
            .file()
            .set_title("Save attachment")
            .set_file_name(name)
            .blocking_save_file()
        {
            let path = file
                .into_path()
                .map_err(|_| Error::new("invalid", "Choose a local destination"))?;
            std::fs::write(path, bytes)
                .map_err(|_| Error::new("invalid", "Could not save the attachment"))?;
        }
        Ok(())
    })
    .await
    .map_err(|_| Error::new("invalid", "Attachment worker failed"))?
}

#[cfg(test)]
mod ipc_tests {
    use super::*;
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets};

    #[test]
    fn frontend_command_payloads_run_through_tauri_without_desktop_interaction() {
        let dir = std::env::temp_dir().join(format!(
            "zusteller-gmail-ipc-test-{}",
            rand::random::<u64>()
        ));
        let store = store::Store::open(&dir.join("cache.sqlite")).unwrap();
        store.add_account(&json!({"id":"fixture@example.com","email":"fixture@example.com","displayName":"Fixture"})).unwrap();
        let raw = json!({"id":"t","messages":[{"id":"m","internalDate":"1000","labelIds":["INBOX","UNREAD"],"payload":{"mimeType":"text/plain","body":{"data":"aGVsbG8"}}}]});
        let thread = model::normalize("fixture@example.com", &raw, true).unwrap();
        store
            .put("fixture@example.com", "thread:t", &thread)
            .unwrap();
        store.put("fixture@example.com", "body:t", &thread).unwrap();
        let state = State {
            gmail: Arc::new(Mutex::new(Some(api::Gmail::new(store).unwrap()))),
            ..State::default()
        };
        let app = mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![gmail_read])
            .build(mock_context(noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let call = |body: Value| {
            get_ipc_response(
                &webview,
                tauri::webview::InvokeRequest {
                    cmd: "gmail_read".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: if cfg!(windows) {
                        "http://tauri.localhost"
                    } else {
                        "tauri://localhost"
                    }
                    .parse()
                    .unwrap(),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
            )
            .map(|r| r.deserialize::<Value>().unwrap())
        };
        assert_eq!(
            call(json!({"operation":"accounts"})).unwrap()[0]["email"],
            "fixture@example.com"
        );
        assert_eq!(call(json!({"operation":"thread","accountId":"fixture@example.com","input":{"threadId":"t"}})).unwrap()["isRead"],false);
        call(json!({"operation":"action","accountId":"fixture@example.com","input":{"action":"markRead","threadIds":["t"],"value":true}})).unwrap();
        let local=call(json!({"operation":"thread","accountId":"fixture@example.com","input":{"threadId":"t"}})).unwrap();
        assert_eq!(local["isRead"], true);
        assert_eq!(local["messages"][0]["plainText"], "hello");
        assert!(!local.to_string().contains("token"));
        call(json!({"operation":"reset","accountId":"fixture@example.com"})).unwrap();
        assert_eq!(call(json!({"operation":"thread","accountId":"fixture@example.com","input":{"threadId":"t"}})).unwrap()["isRead"],false);
        let error =
            call(json!({"operation":"send","accountId":"fixture@example.com"})).unwrap_err();
        assert_eq!(error["code"], "invalid");
        drop(webview);
        drop(app);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
