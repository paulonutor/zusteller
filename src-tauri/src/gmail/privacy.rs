//! Startup-only masking at the native IPC boundary. Originals stay in the
//! native worker/cache; unknown output fields are deliberately discarded.
use super::{
    model::{array, text},
    Error, Result,
};
use serde_json::{json, Value};
use std::collections::HashMap;

/// Keychain authorization dialogs can display a real account name. Disable
/// interaction for this process before any window or Gmail worker is created.
pub fn suppress_credential_dialogs() -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "Security", kind = "framework")]
        extern "C" {
            fn SecKeychainSetUserInteractionAllowed(state: u8) -> i32;
        }
        // The Security framework takes a Boolean and returns OSStatus. A denied
        // credential read will then produce our redacted authentication error.
        if unsafe { SecKeychainSetUserInteractionAllowed(0) } != 0 {
            return Err(Error::new(
                "invalid",
                "Could not disable credential dialogs in privacy mode",
            ));
        }
    }
    Ok(())
}

#[derive(Default)]
pub struct Privacy {
    pub enabled: bool,
    aliases: HashMap<(&'static str, String), String>,
    originals: HashMap<(&'static str, String), String>,
}

impl Privacy {
    /// Explain known failure categories using fixed text. Never forward arbitrary
    /// provider, Keychain or response text through a protected window.
    pub fn error(&self, mut error: Error) -> Error {
        if self.enabled {
            error.message = match (error.code.as_str(), error.message.as_str()) {
                ("auth", "Could not read Gmail credentials from Keychain. Connect again.")
                | ("auth", "macOS Keychain is unavailable") =>
                    "Privacy mode could not read Gmail credentials from macOS Keychain. Quit Zusteller, launch without --privacy and allow Keychain access, then restart in privacy mode.",
                ("auth", "No saved Gmail credentials in Keychain. Connect again.")
                | ("auth", "Saved Gmail credentials are invalid. Connect again.") =>
                    "No usable Gmail credentials are saved. Connect Gmail in a normal session, then restart in privacy mode.",
                ("auth", _) =>
                    "Gmail authorization needs renewal. Reconnect Gmail in a normal session, then restart in privacy mode.",
                ("offline", _) => "Could not reach Gmail. Check your connection and try again.",
                ("rate_limit", _) => "Gmail rate limit reached. Requests are paused until the retry time shown in Gmail activity.",
                ("permission", _) => "Google denied Gmail access. Check the app's Gmail API permissions in a normal session.",
                ("not_found", _) => "This Gmail account or conversation is unavailable.",
                _ => "Gmail request failed in privacy mode. Open Gmail activity for request status.",
            }.into();
        }
        error
    }
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            ..Self::default()
        }
    }

    fn alias(&mut self, kind: &'static str, original: &str) -> String {
        let key = (kind, original.to_owned());
        if let Some(alias) = self.aliases.get(&key) {
            return alias.clone();
        }
        let alias = format!("private-{kind}-{}", self.aliases.len() + 1);
        self.aliases.insert(key, alias.clone());
        self.originals
            .insert((kind, alias.clone()), original.to_owned());
        alias
    }

    fn original(&self, kind: &'static str, alias: &str) -> Result<String> {
        self.originals
            .get(&(kind, alias.to_owned()))
            .cloned()
            .ok_or_else(|| Error::new("invalid", "Unknown privacy alias"))
    }

    fn label(&mut self, id: &str) -> String {
        if system_label(id) {
            id.to_owned()
        } else {
            self.alias("label", id)
        }
    }

    pub fn input(
        &self,
        operation: &str,
        account: String,
        mut input: Value,
    ) -> Result<(String, Value)> {
        if !self.enabled {
            return Ok((account, input));
        }
        if matches!(operation, "disconnect" | "reset") {
            return Err(Error::new(
                "invalid",
                "Account changes are disabled in privacy mode",
            ));
        }
        if !text(&input, "search").is_empty() {
            return Err(Error::new(
                "invalid",
                "Search is disabled in privacy mode because displayed text is synthetic",
            ));
        }
        let account = if operation == "accounts" {
            String::new()
        } else {
            self.original("account", &account)?
        };
        if input.get("accountId").is_some() {
            input["accountId"] = json!(account);
        }
        for (field, kind) in [
            ("threadId", "thread"),
            ("cursor", "cursor"),
            ("labelId", "label"),
        ] {
            let id = text(&input, field);
            if !id.is_empty() {
                input[field] = json!(if kind == "label" && system_label(id) {
                    id.to_owned()
                } else {
                    self.original(kind, id)?
                });
            }
        }
        if let Some(ids) = input["threadIds"].as_array() {
            let ids = ids
                .iter()
                .map(|id| self.original("thread", id.as_str().unwrap_or("")))
                .collect::<Result<Vec<_>>>()?;
            input["threadIds"] = json!(ids);
        }
        Ok((account, input))
    }

    fn address(&mut self, address: &Value) -> Value {
        let id = self.alias("person", &text(address, "email").to_lowercase());
        json!({"name":format!("Person {}", id.rsplit('-').next().unwrap()), "email":format!("{id}@example.invalid")})
    }

    fn addresses(&mut self, addresses: &Value) -> Value {
        json!(array(addresses)
            .iter()
            .map(|a| self.address(a))
            .collect::<Vec<_>>())
    }

    fn labels(&mut self, labels: &Value) -> Value {
        json!(array(labels)
            .iter()
            .map(|l| self.label(l.as_str().unwrap_or("")))
            .collect::<Vec<_>>())
    }

    fn thread(&mut self, source: &Value, body: bool) -> Value {
        let id = self.alias("thread", text(source, "id"));
        let subject = format!("Private conversation {}", id.rsplit('-').next().unwrap());
        let mut out = json!({"id":id,"accountId":self.alias("account",text(source,"accountId")),
            "subject":subject,"snippet":"Synthetic preview. Original email content is hidden.",
            "participants":self.addresses(&source["participants"]),"labelIds":self.labels(&source["labelIds"]),
            "messageCount":source["messageCount"].as_u64().unwrap_or(0),"lastMessageAt":"2026-01-01T12:00:00Z",
            "isRead":source["isRead"]==true,"isStarred":source["isStarred"]==true,
            "hasAttachments":source["hasAttachments"]==true,"metadataPending":source["metadataPending"]==true});
        if body {
            out["messages"] = json!(array(&source["messages"]).iter().map(|m| {
                let attachments = array(&m["attachments"]).iter().map(|a| json!({
                    "id":self.alias("attachment",text(a,"id")),"filename":"Private attachment.bin",
                    "mimeType":"application/octet-stream","size":a["size"].as_u64().unwrap_or(0)
                })).collect::<Vec<_>>();
                json!({"id":self.alias("message",text(m,"id")),"threadId":id,
                    "accountId":out["accountId"],"subject":subject,"from":self.address(&m["from"]),
                    "to":self.addresses(&m["to"]),"cc":self.addresses(&m["cc"]),
                    "sentAt":"2026-01-01T12:00:00Z","isRead":m["isRead"]==true,"isStarred":m["isStarred"]==true,
                    "labelIds":self.labels(&m["labelIds"]),"attachments":attachments,
                    "plainText":"This is a synthetic message for private testing. The original email remains in the native cache.",
                    "html":if m["html"].is_string() { json!("<h2>Private test message</h2><p>This synthetic content replaces the original email, including links and images.</p><blockquote>Private quoted message.</blockquote>") } else { Value::Null }})
            }).collect::<Vec<_>>());
        }
        out
    }

    pub fn output(&mut self, operation: &str, source: Value) -> Result<Value> {
        if !self.enabled {
            return Ok(source);
        }
        Ok(match operation {
            "accounts" => json!(array(&source).iter().map(|a| {
                let id = self.alias("account",text(a,"id"));
                json!({"id":id,"email":format!("{id}@example.invalid"),"displayName":"Privacy mode","privacyProtected":true})
            }).collect::<Vec<_>>()),
            "labels" => json!(array(&source).iter().map(|l| {
                let id = self.label(text(l,"id"));
                json!({"id":id,"accountId":self.alias("account",text(l,"accountId")),
                    "name":if system_label(text(l,"id")) { id.clone() } else { format!("Label {}", id.rsplit('-').next().unwrap()) },
                    "type":if system_label(text(l,"id")) { "system" } else { "user" }})
            }).collect::<Vec<_>>()),
            "counts" => {
                let mut out = json!({"mailboxes":{},"labels":{},"estimated":source["estimated"]==true});
                for name in ["inbox","starred","sent","junk","trash","all"] { out["mailboxes"][name] = json!(source["mailboxes"][name].as_u64().unwrap_or(0)); }
                if let Some(labels) = source["labels"].as_object() {
                    for (id,count) in labels { let id = self.label(id); out["labels"][id] = json!(count.as_u64().unwrap_or(0)); }
                }
                out
            },
            "threads" => json!({"items":array(&source["items"]).iter().map(|t| self.thread(t,false)).collect::<Vec<_>>(),
                "nextCursor":if text(&source,"nextCursor").is_empty() { Value::Null } else { json!(self.alias("cursor",text(&source,"nextCursor"))) },"stale":source["stale"]==true}),
            "summaries" => json!(array(&source).iter().map(|t| self.thread(t,false)).collect::<Vec<_>>()),
            "thread" => self.thread(&source,true),
            "sync" => json!(source==true),
            "action" => Value::Null,
            _ => return Err(Error::new("invalid","Unsupported operation in privacy mode")),
        })
    }
}

fn system_label(id: &str) -> bool {
    matches!(
        id,
        "INBOX"
            | "SENT"
            | "DRAFT"
            | "SPAM"
            | "TRASH"
            | "UNREAD"
            | "STARRED"
            | "IMPORTANT"
            | "CHAT"
            | "CATEGORY_PERSONAL"
            | "CATEGORY_SOCIAL"
            | "CATEGORY_PROMOTIONS"
            | "CATEGORY_UPDATES"
            | "CATEGORY_FORUMS"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sensitive_thread() -> Value {
        json!({"id":"SECRET-thread","accountId":"SECRET-account","subject":"SECRET-subject",
            "snippet":"SECRET-snippet","participants":[{"name":"SECRET-name","email":"SECRET-address","avatarUrl":"SECRET-avatar"}],
            "lastMessageAt":"SECRET-date","messageCount":2,"isRead":false,"isStarred":true,
            "labelIds":["INBOX","SECRET-label"],"hasAttachments":true,"unknown":"SECRET-unknown",
            "messages":[{"id":"SECRET-message","from":{"email":"SECRET-address"},"to":[{"email":"SECRET-recipient"}],
                "cc":[{"email":"SECRET-cc"}],"plainText":"SECRET-body","html":"<img src='SECRET-url'>SECRET-html",
                "sentAt":"SECRET-date","labelIds":["SECRET-label"],"isRead":false,"isStarred":true,
                "attachments":[{"id":"SECRET-attachment","filename":"SECRET-filename","mimeType":"SECRET-mime",
                    "size":12,"partId":"SECRET-part","_data":"SECRET-inline-data","unknown":"SECRET-unknown"}],
                "unknown":"SECRET-unknown"}]})
    }

    #[test]
    fn masks_every_content_channel_and_discards_unknown_fields() {
        let mut p = Privacy::new(true);
        let account = p.output("accounts",json!([{"id":"SECRET-account","email":"SECRET-address","displayName":"SECRET-name","avatarUrl":"SECRET-url","unknown":"SECRET-unknown"}])).unwrap();
        let labels = p.output("labels",json!([{"id":"SECRET-label","accountId":"SECRET-account","name":"SECRET-label-name","type":"user","color":"SECRET-color"}])).unwrap();
        let thread = p.output("thread", sensitive_thread()).unwrap();
        for output in [&account, &labels, &thread] {
            assert!(!output.to_string().contains("SECRET"));
        }
        assert_eq!(thread["accountId"], account[0]["id"]);
        assert_eq!(thread["labelIds"][1], labels[0]["id"]);
        assert_eq!(thread["messages"][0]["threadId"], thread["id"]);
        assert_eq!(thread["participants"][0], thread["messages"][0]["from"]);
        assert_eq!(thread["messages"][0]["attachments"][0]["size"], 12);
        assert_eq!(thread["isStarred"], true);
        assert_eq!(thread["messageCount"], 2);
        assert_eq!(p.output("thread", sensitive_thread()).unwrap(), thread);
    }

    #[test]
    fn pagination_counts_and_input_aliases_round_trip_without_raw_ids() {
        let mut p = Privacy::new(true);
        let account = p
            .output("accounts", json!([{"id":"SECRET-account"}]))
            .unwrap()[0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let page = p
            .output(
                "threads",
                json!({"items":[sensitive_thread()],"nextCursor":"SECRET-cursor","stale":true}),
            )
            .unwrap();
        let counts = p
            .output(
                "counts",
                json!({"mailboxes":{"inbox":7},"labels":{"SECRET-label":3},"unknown":"SECRET"}),
            )
            .unwrap();
        let label = page["items"][0]["labelIds"][1].as_str().unwrap();
        assert_eq!(counts["labels"][label], 3);
        assert_eq!(counts["mailboxes"]["inbox"], 7);
        assert!(!counts.to_string().contains("SECRET"));
        let (original, input) = p
            .input(
                "threads",
                account.clone(),
                json!({"accountId":account,"labelId":label,"cursor":page["nextCursor"]}),
            )
            .unwrap();
        assert_eq!(original, "SECRET-account");
        assert_eq!(input["accountId"], original);
        assert_eq!(input["labelId"], "SECRET-label");
        assert_eq!(input["cursor"], "SECRET-cursor");
        let (_, input) = p
            .input(
                "action",
                account.clone(),
                json!({"threadIds":[page["items"][0]["id"]],"labelId":"INBOX"}),
            )
            .unwrap();
        assert_eq!(input["threadIds"][0], "SECRET-thread");
        assert_eq!(input["labelId"], "INBOX");
        assert!(p
            .input(
                "thread",
                "SECRET-account".into(),
                json!({"threadId":"SECRET-thread"})
            )
            .is_err());
        assert!(p
            .input(
                "thread",
                account.clone(),
                json!({"threadId":"private-thread-unknown"})
            )
            .is_err());
        for operation in ["disconnect", "reset"] {
            assert!(p.input(operation, account.clone(), json!({})).is_err());
        }
        assert!(p
            .input("threads", account, json!({"search":"synthetic text"}))
            .is_err());
        assert!(p.output("future_operation", sensitive_thread()).is_err());
    }

    #[test]
    fn normal_mode_preserves_original_data_and_inputs() {
        let mut p = Privacy::default();
        let original = sensitive_thread();
        assert_eq!(p.output("thread", original.clone()).unwrap(), original);
        assert_eq!(
            p.input("thread", "a".into(), json!({"threadId":"t"}))
                .unwrap(),
            ("a".into(), json!({"threadId":"t"}))
        );
    }

    #[test]
    fn protected_errors_explain_credentials_and_quota_without_leaking_text() {
        let p = Privacy::new(true);
        let blocked = p.error(Error::new(
            "auth",
            "Could not read Gmail credentials from Keychain. Connect again.",
        ));
        assert!(blocked.message.contains("Keychain"));
        assert!(blocked.message.contains("launch without --privacy"));
        let missing = p.error(Error::new(
            "auth",
            "No saved Gmail credentials in Keychain. Connect again.",
        ));
        assert!(missing
            .message
            .contains("Connect Gmail in a normal session"));
        for code in [
            "auth",
            "offline",
            "rate_limit",
            "permission",
            "not_found",
            "invalid",
        ] {
            let mut error = Error::new(code, "SECRET-address@example.com SECRET-body");
            error.retry_after = Some(60);
            let safe = p.error(error);
            assert!(!safe.message.contains("SECRET"));
            assert_eq!(safe.code, code);
            assert_eq!(safe.retry_after, Some(60));
        }
        let original = Error::new("offline", "Original error");
        assert_eq!(Privacy::default().error(original).message, "Original error");
    }
}
