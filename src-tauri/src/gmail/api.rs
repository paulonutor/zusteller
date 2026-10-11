use super::{
    auth,
    model::{self, array, text},
    quota::Quota,
    store::Store,
    Error, Result,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    io::Read,
    time::Instant,
};

const BASE: &str = "https://gmail.googleapis.com/gmail/v1/users/me/";
const MAX_RESPONSE: u64 = 24 * 1024 * 1024;
pub struct Gmail {
    pub store: Store,
    access: HashMap<String, auth::Access>,
    client: Client,
    base: String,
    quota: Quota,
}
impl Gmail {
    pub fn new(store: Store) -> Result<Self> {
        Ok(Self {
            store,
            access: HashMap::new(),
            client: auth::client()?,
            base: BASE.into(),
            quota: Quota::default(),
        })
    }
    pub fn install(
        &mut self,
        grant: auth::Grant,
        access: auth::Access,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<Value> {
        let profile = request(
            &self.quota,
            &self.client,
            &self.base,
            &access.token,
            "profile",
            &[],
        )?;
        let email = text(&profile, "emailAddress");
        if email.is_empty() {
            return Err(Error::new("auth", "Google did not return a Gmail account"));
        }
        let account = json!({"id":email,"email":email,"displayName":email});
        if self
            .store
            .accounts()?
            .iter()
            .any(|a| text(a, "id") != email)
        {
            return Err(Error::new(
                "invalid",
                "Disconnect the current account before connecting a different Gmail account",
            ));
        }
        if cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(Error::new("cancelled", "Gmail connection cancelled"));
        }
        auth::save(email, &grant)?;
        self.store.add_account(&account)?;
        self.access.insert(email.to_string(), access);
        Ok(account)
    }
    fn token(&mut self, account: &str) -> Result<String> {
        if !self
            .store
            .accounts()?
            .iter()
            .any(|a| text(a, "id") == account)
        {
            return Err(Error::new("not_found", "Gmail account is not connected"));
        }
        if !self
            .access
            .get(account)
            .is_some_and(|a| a.expires > Instant::now())
        {
            self.access
                .insert(account.into(), auth::refresh(&auth::load(account)?)?);
        }
        Ok(self.access[account].token.clone())
    }
    fn get(&mut self, account: &str, path: &str, params: &[(&str, String)]) -> Result<Value> {
        let token = self.token(account)?;
        match request(&self.quota, &self.client, &self.base, &token, path, params) {
            Err(e) if e.code == "auth" => {
                self.access.remove(account);
                let token = self.token(account)?;
                request(&self.quota, &self.client, &self.base, &token, path, params)
            }
            other => other,
        }
    }
    pub fn labels(&mut self, account: &str) -> Result<Value> {
        let labels = match self.get(account, "labels", &[]) {
            Ok(v) => v,
            Err(e) if e.code == "offline" || e.code == "rate_limit" => {
                return cached(&self.store, account, "labels", e)
            }
            Err(e) => return Err(e),
        };
        let values:Vec<Value>=array(&labels["labels"]).iter().map(|l|json!({"id":text(l,"id"),"accountId":account,"name":text(l,"name"),"type":text(l,"type"),"color":l["color"]["backgroundColor"]})).collect();
        let value = json!(values);
        self.store.put(account, "labels", &value)?;
        Ok(value)
    }
    pub fn counts(&mut self, account: &str) -> Result<Value> {
        // labels.get counts use Gmail's membership, which differs from a union-of-labels preview.
        // Mark these as estimates, especially after local simulations.
        let labels = match self.store.get(account, "labels")? {
            Some(v) => v,
            None => self.labels(account)?,
        };
        let ids: Vec<String> = array(&labels)
            .iter()
            .map(|l| text(l, "id").into())
            .collect();
        let token = match self.token(account) {
            Ok(t) => t,
            Err(e) => return Err(e),
        };
        let fetched = parallel(&ids, |id| {
            request(
                &self.quota,
                &self.client,
                &self.base,
                &token,
                &format!("labels/{}", segment(id)),
                &[],
            )
        });
        let fetched = match fetched {
            Ok(v) => v,
            Err(e) if e.code == "offline" || e.code == "rate_limit" => {
                return self.counts_overlay(account, cached(&self.store, account, "counts", e)?)
            }
            Err(e) => return Err(e),
        };
        let mut counts = json!({"mailboxes":{"inbox":0,"starred":0,"sent":0,"junk":0,"trash":0,"all":0},"labels":{},"estimated":true});
        for l in fetched {
            let id = text(&l, "id");
            let count = l["threadsUnread"].as_u64().unwrap_or(0);
            if let Some(mailbox) = mailbox_for(id) {
                counts["mailboxes"][mailbox] = json!(count);
            }
            if text(&l, "type") == "user" {
                counts["labels"][id] = json!(count);
            }
            if id == "UNREAD" {
                counts["mailboxes"]["all"] = json!(count);
            }
        }
        self.store.put(account, "counts", &counts)?;
        self.counts_overlay(account, counts)
    }
    fn counts_overlay(&self, account: &str, mut counts: Value) -> Result<Value> {
        for (id, overlay) in self.store.overlays(account)? {
            if let Some(before) = self.store.get(account, &format!("thread:{id}"))? {
                let after = model::apply(before.clone(), &overlay);
                let views: Vec<(String, Value, bool)> =
                    ["inbox", "starred", "sent", "junk", "trash", "all"]
                        .into_iter()
                        .map(|name| (name.into(), json!({"mailbox":name}), true))
                        .chain(
                            counts["labels"]
                                .as_object()
                                .into_iter()
                                .flat_map(|m| m.keys())
                                .map(|id| (id.clone(), json!({"labelId":id}), false)),
                        )
                        .collect();
                for (name, query, mailbox) in views {
                    let unread =
                        |t: &Value| i64::from(t["isRead"] == false && model::matches(t, &query));
                    let field = if mailbox { "mailboxes" } else { "labels" };
                    let value = counts[field][&name].as_i64().unwrap_or(0) + unread(&after)
                        - unread(&before);
                    counts[field][name] = json!(value.max(0));
                }
            }
        }
        Ok(counts)
    }
    pub fn threads(&mut self, account: &str, query: &Value) -> Result<Value> {
        self.store.evict(account)?;
        let key = format!("page:{}", query);
        let mut params = vec![
            (
                "maxResults",
                query["limit"]
                    .as_u64()
                    .unwrap_or(25)
                    .clamp(1, 50)
                    .to_string(),
            ),
            ("includeSpamTrash", "true".into()),
        ];
        let mailbox = text(query, "mailbox");
        let label = if !text(query, "labelId").is_empty() {
            text(query, "labelId")
        } else {
            match mailbox {
                "inbox" => "INBOX",
                "starred" => "STARRED",
                "sent" => "SENT",
                "junk" => "SPAM",
                "trash" => "TRASH",
                _ => "",
            }
        };
        if !label.is_empty() {
            params.push(("labelIds", label.into()));
        }
        let search = text(query, "search");
        let exclude = if mailbox == "trash" {
            ""
        } else if mailbox == "junk" {
            "-in:trash"
        } else {
            "-in:spam -in:trash"
        };
        params.push(("q", format!("{search} {exclude}").trim().into()));
        if !text(query, "cursor").is_empty() {
            params.push(("pageToken", text(query, "cursor").into()));
        }
        let page = match self.get(account, "threads", &params) {
            Ok(page) => page,
            Err(e) if e.code == "offline" || e.code == "rate_limit" => {
                let mut page = cached(&self.store, account, &key, e)?;
                page["stale"] = json!(true);
                return self.page_overlay(account, page, query);
            }
            Err(e) => return Err(e),
        };
        let ids: Vec<String> = array(&page["threads"])
            .iter()
            .map(|t| text(t, "id").into())
            .collect();
        // History sync maintains metadata. List invalidations after opening or
        // changing a thread locally must not download every summary again.
        let mut summaries = HashMap::new();
        let mut missing = Vec::new();
        for id in &ids {
            match self.store.get(account, &format!("thread:{id}"))? {
                Some(thread) => {
                    summaries.insert(id.clone(), thread);
                }
                None => missing.push(id.clone()),
            }
        }
        let token = self.token(account)?;
        let fetched = parallel(&missing, |id| {
            let raw = request(
                &self.quota,
                &self.client,
                &self.base,
                &token,
                &format!("threads/{}", segment(id)),
                &summary_params(),
            )?;
            model::normalize(account, &raw, false)
        });
        let fetched = match fetched {
            Ok(threads) => threads,
            Err(e) if e.code == "offline" || e.code == "rate_limit" => {
                let mut page = cached(&self.store, account, &key, e)?;
                page["stale"] = json!(true);
                return self.page_overlay(account, page, query);
            }
            Err(e) => return Err(e),
        };
        for thread in fetched {
            summaries.insert(text(&thread, "id").to_string(), thread);
        }
        let items: Vec<Value> = ids.iter().filter_map(|id| summaries.remove(id)).collect();
        for thread in &items {
            self.store
                .put(account, &format!("thread:{}", text(thread, "id")), thread)?;
        }
        let page = json!({"items":items,"nextCursor":page["nextPageToken"],"stale":false});
        self.store.put(account, &key, &page)?;
        self.store.evict(account)?;
        self.page_overlay(account, page, query)
    }
    fn page_overlay(&self, account: &str, mut page: Value, query: &Value) -> Result<Value> {
        let mut items = Vec::new();
        let mut seen = BTreeSet::new();
        for thread in array(&page["items"]) {
            let id = text(thread, "id");
            let changed = model::apply(thread.clone(), &self.store.overlay(account, id)?);
            seen.insert(id.to_string());
            if model::matches(&changed, query) {
                items.push(changed);
            }
        }
        // Local moves can add conversations Gmail would not return in the destination mailbox.
        // Search remains Google's search; do not invent local matches for Gmail query syntax.
        if text(query, "cursor").is_empty() && text(query, "search").is_empty() {
            for (id, overlay) in self.store.overlays(account)? {
                if seen.contains(&id) {
                    continue;
                }
                if let Some(thread) = self.store.get(account, &format!("thread:{id}"))? {
                    let changed = model::apply(thread, &overlay);
                    if model::matches(&changed, query) {
                        items.push(changed);
                    }
                }
            }
        }
        items.sort_by(|a, b| text(b, "lastMessageAt").cmp(text(a, "lastMessageAt")));
        page["items"] = json!(items);
        Ok(page)
    }
    pub fn thread(&mut self, account: &str, id: &str) -> Result<Value> {
        let key = format!("body:{id}");
        let mut thread = if let Some(value) = self.store.get(account, &key)? {
            value
        } else {
            let raw = self.get(
                account,
                &format!("threads/{}", segment(id)),
                &[("format", "full".into())],
            )?;
            let mut value = model::normalize(account, &raw, true)?;
            // Resolve only small raster CID images. Do not eagerly download file attachments.
            for message in array(&raw["messages"]) {
                let mid = text(message, "id");
                let mut inline = Vec::new();
                collect_inline(&message["payload"], &mut inline);
                let mut replacements = Vec::new();
                let mut budget = 1024 * 1024usize;
                for (cid, mime, body) in inline {
                    let size = body["size"].as_u64().unwrap_or(u64::MAX) as usize;
                    if size > budget {
                        continue;
                    }
                    let data = if body["data"].is_string() {
                        model::decode(text(&body, "data"))?
                    } else if body["attachmentId"].is_string() {
                        let attachment = self.get(
                            account,
                            &format!(
                                "messages/{}/attachments/{}",
                                segment(mid),
                                segment(text(&body, "attachmentId"))
                            ),
                            &[],
                        )?;
                        model::decode(text(&attachment, "data"))?
                    } else {
                        continue;
                    };
                    if data.len() > budget {
                        continue;
                    }
                    budget -= data.len();
                    replacements.push((
                        format!("cid:{cid}"),
                        format!("data:{mime};base64,{}", STANDARD.encode(data)),
                    ));
                }
                if let Some(m) = value["messages"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|m| text(m, "id") == mid)
                {
                    if let Some(body) = m["html"].as_str() {
                        let mut body = body.to_string();
                        for (from, to) in replacements {
                            body = body.replace(&from, &to);
                        }
                        m["html"] = json!(body);
                    }
                }
            }
            if value.to_string().len() > 16 * 1024 * 1024 {
                return Err(Error::new(
                    "invalid",
                    "Conversation is too large for this preview",
                ));
            }
            self.store.put(account, &key, &value)?;
            self.store.evict(account)?;
            value
        };
        thread = model::apply(thread, &self.store.overlay(account, id)?);
        if thread["hidden"] == true {
            return Err(Error::new(
                "not_found",
                "Conversation is hidden locally. Reset local changes to restore it.",
            ));
        }
        Ok(thread)
    }
    pub fn action(&mut self, account: &str, input: &Value) -> Result<Value> {
        let action = text(input, "action");
        let label = text(input, "labelId");
        if ["addLabel", "removeLabel", "moveToLabel"].contains(&action) {
            let labels = self.store.get(account, "labels")?.unwrap_or(json!([]));
            if !array(&labels)
                .iter()
                .any(|l| text(l, "id") == label && text(l, "type") == "user")
            {
                return Err(Error::new("invalid", "Unknown user label"));
            }
        }
        let mut changes = Vec::new();
        for id in array(&input["threadIds"]) {
            let id = id
                .as_str()
                .ok_or_else(|| Error::new("invalid", "Invalid conversation id"))?;
            let source = self
                .store
                .get(account, &format!("thread:{id}"))?
                .ok_or_else(|| {
                    Error::new(
                        "not_found",
                        "Load this conversation before changing it locally",
                    )
                })?;
            let mut overlay = self.store.overlay(account, id)?;
            let current = model::apply(source, &overlay);
            let mut set = |name: &str, on: bool| {
                if !overlay["labels"].is_object() {
                    overlay["labels"] = json!({});
                }
                overlay["labels"][name] = json!(on);
            };
            match action {
                "markRead" => overlay["isRead"] = input["value"].clone(),
                "setStarred" => overlay["isStarred"] = input["value"].clone(),
                "archive" => set("INBOX", false),
                "trash" => {
                    set("TRASH", true);
                    set("INBOX", false);
                    set("SPAM", false);
                }
                "restore" => {
                    set("TRASH", false);
                    set("SPAM", false);
                    set("INBOX", true);
                }
                "markJunk" => {
                    set("SPAM", true);
                    set("INBOX", false);
                    set("TRASH", false);
                }
                "notJunk" => {
                    if array(&current["labelIds"]).iter().any(|l| l == "SPAM") {
                        set("SPAM", false);
                        set("INBOX", true);
                    }
                }
                "addLabel" => set(label, true),
                "removeLabel" => set(label, false),
                "moveToLabel" => {
                    set(label, true);
                    set("INBOX", false);
                }
                "deleteForever" => {
                    if !array(&current["labelIds"])
                        .iter()
                        .any(|l| l == "SPAM" || l == "TRASH")
                    {
                        return Err(Error::new(
                            "invalid",
                            "Only Junk or Trash conversations can be hidden locally",
                        ));
                    }
                    overlay["hidden"] = json!(true);
                }
                _ => return Err(Error::new("invalid", "Unknown local mail action")),
            }
            changes.push((id.to_string(), overlay));
        }
        self.store.write_overlays(account, &changes)?;
        Ok(Value::Null)
    }
    pub fn sync(&mut self, account: &str) -> Result<bool> {
        let cursor = self.store.history(account)?;
        let Some(cursor) = cursor else {
            return self.bootstrap(account);
        };
        let mut page_token = String::new();
        let mut changed = BTreeSet::new();
        let history;
        loop {
            let mut params = vec![
                ("startHistoryId", cursor.clone()),
                ("maxResults", "500".into()),
            ];
            if !page_token.is_empty() {
                params.push(("pageToken", page_token));
            }
            let page = match self.get(account, "history", &params) {
                Err(e) if e.code == "not_found" => return self.bootstrap(account),
                other => other?,
            };
            for record in array(&page["history"]) {
                for m in array(&record["messages"]) {
                    if !text(m, "threadId").is_empty() {
                        changed.insert(text(m, "threadId").to_string());
                    }
                }
                for field in [
                    "messagesAdded",
                    "messagesDeleted",
                    "labelsAdded",
                    "labelsRemoved",
                ] {
                    for item in array(&record[field]) {
                        let id = text(&item["message"], "threadId");
                        if !id.is_empty() {
                            changed.insert(id.into());
                        }
                    }
                }
            }
            page_token = text(&page, "nextPageToken").into();
            if page_token.is_empty() {
                history = text(&page, "historyId").to_string();
                break;
            }
        }
        if history.is_empty() {
            return Err(Error::new("invalid", "Google returned no sync cursor"));
        }
        let ids: Vec<String> = changed.into_iter().collect();
        let token = self.token(account)?;
        let changes = parallel(&ids, |id| {
            match request(
                &self.quota,
                &self.client,
                &self.base,
                &token,
                &format!("threads/{}", segment(id)),
                &summary_params(),
            ) {
                Ok(raw) => Ok((id.clone(), Some(model::normalize(account, &raw, false)?))),
                Err(e) if e.code == "not_found" => Ok((id.clone(), None)),
                Err(e) => Err(e),
            }
        })?;
        self.store.sync(account, &history, &changes)?;
        Ok(!changes.is_empty())
    }
    fn bootstrap(&mut self, account: &str) -> Result<bool> {
        let profile = self.get(account, "profile", &[])?;
        let baseline = text(&profile, "historyId");
        if baseline.is_empty() {
            return Err(Error::new("invalid", "Google returned no sync cursor"));
        }
        // Capture history BEFORE reading a recent window. Changes during reads remain in history.
        let page = self.get(
            account,
            "threads",
            &[
                ("maxResults", "100".into()),
                ("includeSpamTrash", "true".into()),
            ],
        )?;
        let ids: Vec<String> = array(&page["threads"])
            .iter()
            .map(|t| text(t, "id").into())
            .collect();
        let token = self.token(account)?;
        let mut changes = parallel(&ids, |id| {
            match request(
                &self.quota,
                &self.client,
                &self.base,
                &token,
                &format!("threads/{}", segment(id)),
                &summary_params(),
            ) {
                Ok(raw) => Ok((id.clone(), Some(model::normalize(account, &raw, false)?))),
                Err(e) if e.code == "not_found" => Ok((id.clone(), None)),
                Err(e) => Err(e),
            }
        })?;
        // Revalidate previously cached/overridden older threads after history expiry.
        let mut stmt = self
            .store
            .0
            .prepare("SELECT key FROM cache WHERE account=?1 AND key LIKE 'thread:%'")?;
        let old: Vec<String> = stmt
            .query_map([account], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<_, _>>()?;
        drop(stmt);
        for key in old {
            let id = key.trim_start_matches("thread:");
            if ids.iter().any(|i| i == id) {
                continue;
            }
            match self.get(
                account,
                &format!("threads/{}", segment(id)),
                &summary_params(),
            ) {
                Ok(raw) => changes.push((id.into(), Some(model::normalize(account, &raw, false)?))),
                Err(e) if e.code == "not_found" => changes.push((id.into(), None)),
                Err(e) => return Err(e),
            }
        }
        self.store.sync(account, baseline, &changes)?;
        Ok(true)
    }
    pub fn disconnect(&mut self, account: &str) -> Result<Value> {
        auth::remove(account)?;
        self.access.remove(account);
        self.store.remove(account)?;
        Ok(Value::Null)
    }
    pub fn attachment(
        &mut self,
        account: &str,
        message: &str,
        attachment: &str,
        thread: &str,
    ) -> Result<Vec<u8>> {
        let cached = self
            .store
            .get(account, &format!("body:{thread}"))?
            .ok_or_else(|| {
                Error::new(
                    "invalid",
                    "Open the message before downloading its attachment",
                )
            })?;
        let m = array(&cached["messages"])
            .iter()
            .find(|m| text(m, "id") == message)
            .ok_or_else(|| Error::new("invalid", "Unknown message"))?;
        let a = array(&m["attachments"])
            .iter()
            .find(|a| text(a, "id") == attachment)
            .ok_or_else(|| Error::new("invalid", "Unknown attachment"))?;
        if a["size"].as_u64().unwrap_or(u64::MAX) > 15 * 1024 * 1024 {
            return Err(Error::new(
                "invalid",
                "Attachments over 15 MiB are not supported in this preview",
            ));
        }
        if let Some(data) = a["_data"].as_str() {
            let bytes = model::decode(data)?;
            if bytes.len() > 15 * 1024 * 1024 {
                return Err(Error::new("invalid", "Attachment is too large"));
            }
            return Ok(bytes);
        }
        let raw = self.get(
            account,
            &format!(
                "messages/{}/attachments/{}",
                segment(message),
                segment(attachment)
            ),
            &[],
        )?;
        let bytes = model::decode(text(&raw, "data"))?;
        if bytes.len() > 15 * 1024 * 1024 {
            return Err(Error::new("invalid", "Attachment is too large"));
        }
        Ok(bytes)
    }
}
fn collect_inline(part: &Value, out: &mut Vec<(String, String, Value)>) {
    let mime = text(part, "mimeType");
    if [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/avif",
    ]
    .contains(&mime)
    {
        if let Some(cid) = array(&part["headers"])
            .iter()
            .find(|h| text(h, "name").eq_ignore_ascii_case("Content-ID"))
        {
            out.push((
                text(cid, "value").trim_matches(['<', '>']).to_string(),
                mime.into(),
                part["body"].clone(),
            ));
        }
    }
    for child in array(&part["parts"]) {
        collect_inline(child, out);
    }
}
fn cached(store: &Store, account: &str, key: &str, error: Error) -> Result<Value> {
    store.get(account, key)?.ok_or(error)
}
fn mailbox_for(id: &str) -> Option<&'static str> {
    match id {
        "INBOX" => Some("inbox"),
        "STARRED" => Some("starred"),
        "SENT" => Some("sent"),
        "SPAM" => Some("junk"),
        "TRASH" => Some("trash"),
        _ => None,
    }
}
fn segment(id: &str) -> String {
    url::form_urlencoded::byte_serialize(id.as_bytes()).collect()
}
// Bounded network concurrency; credentials remain entirely inside Rust.
fn parallel<T: Send, F: Fn(&String) -> Result<T> + Sync>(
    ids: &[String],
    fetch: F,
) -> Result<Vec<T>> {
    let mut values = Vec::new();
    for chunk in ids.chunks(5) {
        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|id| {
                    let fetch = &fetch;
                    scope.spawn(move || fetch(id))
                })
                .collect();
            handles
                .into_iter()
                .map(|h| {
                    h.join().unwrap_or_else(|_| {
                        Err(Error::new("invalid", "Gmail request worker failed"))
                    })
                })
                .collect::<Vec<_>>()
        });
        for result in results {
            values.push(result?);
        }
    }
    Ok(values)
}
fn request(
    quota: &Quota,
    client: &Client,
    base: &str,
    token: &str,
    path: &str,
    params: &[(&str, String)],
) -> Result<Value> {
    quota.acquire(path)?;
    let mut response = client
        .get(format!("{base}{path}"))
        .bearer_auth(token)
        .query(params)
        .send()
        .map_err(|_| {
            Error::new(
                "offline",
                "Gmail is offline. Cached mail is still available.",
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        let mut error = match status.as_u16() {
            401 => Error::new("auth", "Google access expired. Connect Gmail again."),
            404 => Error::new("not_found", "Gmail item was not found"),
            403 => Error::new(
                "permission",
                "Google denied access. Check Gmail API and test-user configuration.",
            ),
            429 => Error::new("rate_limit", "Gmail rate limit reached. Sync will retry."),
            500..=599 => Error::new("offline", "Google is unavailable. Sync will retry."),
            _ => Error::new("invalid", "Gmail rejected the request"),
        };
        if status.as_u16() == 403 {
            let mut body = Vec::new();
            if response
                .by_ref()
                .take(64 * 1024)
                .read_to_end(&mut body)
                .is_ok()
            {
                if let Ok(value) = serde_json::from_slice::<Value>(&body) {
                    if array(&value["error"]["errors"]).iter().any(|e| {
                        [
                            "rateLimitExceeded",
                            "userRateLimitExceeded",
                            "dailyLimitExceeded",
                        ]
                        .contains(&text(e, "reason"))
                    }) {
                        error =
                            Error::new("rate_limit", "Gmail rate limit reached. Sync will retry.");
                    }
                }
            }
        }
        error.retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| {
                v.parse().ok().or_else(|| {
                    let target = chrono::DateTime::parse_from_rfc2822(v).ok()?.timestamp();
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .ok()?
                        .as_secs() as i64;
                    Some(target.saturating_sub(now).max(0) as u64)
                })
            });
        if error.code == "rate_limit" {
            quota.limited(&mut error);
        }
        return Err(error);
    }
    if response.content_length().is_some_and(|n| n > MAX_RESPONSE) {
        return Err(Error::new("invalid", "Gmail response is too large"));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(MAX_RESPONSE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::new("offline", "Gmail response was interrupted"))?;
    if bytes.len() as u64 > MAX_RESPONSE {
        return Err(Error::new("invalid", "Gmail response is too large"));
    }
    serde_json::from_slice(&bytes).map_err(|_| Error::new("invalid", "Invalid Gmail response"))
}

fn summary_params() -> Vec<(&'static str, String)> {
    let fields = "partId,mimeType,filename,headers,body(size,attachmentId)";
    let mut payload = fields.to_string();
    for _ in 0..12 {
        payload = format!("{fields},parts({payload})");
    }
    vec![
        ("format", "full".into()),
        (
            "fields",
            format!("id,snippet,messages(id,snippet,internalDate,labelIds,payload({payload}))"),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Duration,
    };

    fn fixture(
        replies: Vec<(u16, Value)>,
    ) -> (
        Gmail,
        std::thread::JoinHandle<Vec<String>>,
        std::path::PathBuf,
    ) {
        fixture_with_headers(replies, "")
    }

    fn fixture_with_headers(
        replies: Vec<(u16, Value)>,
        headers: &str,
    ) -> (
        Gmail,
        std::thread::JoinHandle<Vec<String>>,
        std::path::PathBuf,
    ) {
        let headers = headers.to_string();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            let mut replies = replies;
            while !replies.is_empty() {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = [0; 8192];
                let n = socket.read(&mut bytes).unwrap();
                let request = String::from_utf8_lossy(&bytes[..n]);
                requests.push(request.lines().next().unwrap().to_string());
                let target = request
                    .lines()
                    .next()
                    .unwrap()
                    .split_whitespace()
                    .nth(1)
                    .unwrap();
                let path = url::Url::parse(&format!("http://localhost{target}"))
                    .unwrap()
                    .path()
                    .to_string();
                let index = if path.ends_with("/threads/t") {
                    replies
                        .iter()
                        .position(|(_, v)| v["id"] == "t")
                        .unwrap_or(0)
                } else if path.ends_with("/threads/deleted") {
                    replies
                        .iter()
                        .position(|(code, _)| *code == 404)
                        .unwrap_or(0)
                } else {
                    0
                };
                let (status, value) = replies.remove(index);

                let body = value.to_string();
                write!(socket,"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
            requests
        });
        let dir = std::env::temp_dir().join(format!(
            "zusteller-gmail-api-test-{}",
            rand::random::<u64>()
        ));
        let mut gmail = Gmail::new(Store::open(&dir.join("cache.sqlite")).unwrap()).unwrap();
        gmail.base = base;
        gmail.store.add_account(&json!({"id":"a"})).unwrap();
        gmail.access.insert(
            "a".into(),
            auth::Access {
                token: "fixture-only".into(),
                expires: Instant::now() + Duration::from_secs(3600),
            },
        );
        (gmail, server, dir)
    }
    fn mail(id: &str) -> Value {
        json!({"id":id,"messages":[{"id":"m","internalDate":"1000","labelIds":["INBOX","UNREAD"],"snippet":"A &amp; B","payload":{"headers":[{"name":"Subject","value":"Hello"}]}}]})
    }

    #[test]
    fn sync_pages_are_atomic_and_deletion_cleans_local_overrides() {
        let (mut g, server, dir) = fixture(vec![
            (
                200,
                json!({"history":[{"messages":[{"threadId":"t"}]}],"nextPageToken":"page2","historyId":"11"}),
            ),
            (
                200,
                json!({"history":[{"messagesDeleted":[{"message":{"threadId":"deleted"}}]}],"historyId":"12"}),
            ),
            (
                404,
                json!({"error":"private content must not reach errors"}),
            ),
            (200, mail("t")),
        ]);
        g.store.sync("a", "10", &[]).unwrap();
        g.store
            .write_overlays(
                "a",
                &[
                    ("deleted".into(), json!({"isRead":true})),
                    ("t".into(), json!({"isStarred":true})),
                ],
            )
            .unwrap();
        assert!(g.sync("a").unwrap());
        assert_eq!(g.store.history("a").unwrap().as_deref(), Some("12"));
        assert_eq!(g.store.overlay("a", "deleted").unwrap(), json!({}));
        assert_eq!(g.store.overlay("a", "t").unwrap()["isStarred"], true);
        let requests = server.join().unwrap();
        assert!(requests[1].contains("pageToken=page2"));
        assert!(requests.iter().all(|r| r.starts_with("GET ")));
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_history_page_leaves_cursor_and_cached_mail_unchanged() {
        let (mut g, server, dir) = fixture(vec![
            (
                200,
                json!({"history":[{"messages":[{"threadId":"t"}]}],"nextPageToken":"page2","historyId":"11"}),
            ),
            (503, json!({"error":"secret"})),
        ]);
        g.store
            .sync(
                "a",
                "10",
                &[("t".into(), Some(json!({"subject":"Original"})))],
            )
            .unwrap();
        let e = g.sync("a").unwrap_err();
        assert_eq!(e.code, "offline");
        assert!(!e.message.contains("secret"));
        assert_eq!(g.store.history("a").unwrap().as_deref(), Some("10"));
        assert_eq!(
            g.store.get("a", "thread:t").unwrap().unwrap()["subject"],
            "Original"
        );
        server.join().unwrap();
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn expired_cursor_bootstraps_from_a_pre_read_baseline() {
        let (mut g, server, dir) = fixture(vec![
            (404, json!({})),
            (200, json!({"historyId":"20"})),
            (200, json!({"threads":[{"id":"t"}]})),
            (200, mail("t")),
        ]);
        g.store.sync("a", "old", &[]).unwrap();
        assert!(g.sync("a").unwrap());
        assert_eq!(g.store.history("a").unwrap().as_deref(), Some("20"));
        let requests = server.join().unwrap();
        assert!(requests[1].contains("/profile"));
        assert!(requests[2].contains("/threads?"));
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn local_actions_change_destination_membership_and_counts_without_network() {
        let (mut g, server, dir) = fixture(vec![]);
        let thread = model::normalize("a", &mail("t"), false).unwrap();
        g.store.put("a", "thread:t", &thread).unwrap();
        let counts =
            json!({"mailboxes":{"inbox":1,"trash":0,"all":1},"labels":{},"estimated":true});
        g.action("a", &json!({"action":"trash","threadIds":["t"]}))
            .unwrap();
        let changed = g.counts_overlay("a", counts).unwrap();
        assert_eq!(changed["mailboxes"]["inbox"], 0);
        assert_eq!(changed["mailboxes"]["trash"], 1);
        let page = g
            .page_overlay("a", json!({"items":[]}), &json!({"mailbox":"trash"}))
            .unwrap();
        assert_eq!(page["items"][0]["id"], "t");
        g.store.reset("a").unwrap();
        assert_eq!(
            g.page_overlay("a", json!({"items":[thread]}), &json!({"mailbox":"inbox"}))
                .unwrap()["items"][0]["id"],
            "t"
        );
        assert!(server.join().unwrap().is_empty());
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn read_search_pagination_and_opened_bodies_work_then_fall_back_offline() {
        let raw = mail("t");
        let (mut g, server, dir) = fixture(vec![
            (
                200,
                json!({"labels":[{"id":"INBOX","name":"INBOX","type":"system"}]}),
            ),
            (200, json!({"threads":[{"id":"t"}],"nextPageToken":"older"})),
            (200, raw.clone()),
            (200, raw),
        ]);
        assert_eq!(g.labels("a").unwrap()[0]["type"], "system");
        let query =
            json!({"accountId":"a","mailbox":"inbox","search":"from:alice@example.com","limit":25});
        let page = g.threads("a", &query).unwrap();
        assert_eq!(page["nextCursor"], "older");
        assert_eq!(page["items"][0]["snippet"], "A & B");
        assert_eq!(g.thread("a", "t").unwrap()["subject"], "Hello");
        let requests = server.join().unwrap();
        assert!(requests[1].contains("from%3Aalice%40example.com"));
        assert!(requests[2].contains("fields="));
        assert!(requests[2].contains("body%28size%2CattachmentId%29"));
        assert!(requests.iter().all(|r| r.starts_with("GET ")));
        assert_eq!(g.threads("a", &query).unwrap()["stale"], true);
        assert_eq!(g.thread("a", "t").unwrap()["subject"], "Hello");
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn list_refreshes_reuse_metadata_and_history_sync_updates_it() {
        let mut updated = mail("t");
        updated["messages"][0]["payload"]["headers"][0]["value"] = json!("Updated");
        let (mut g, server, dir) = fixture(vec![
            (200, json!({"threads":[{"id":"t"}]})),
            (
                200,
                json!({"history":[{"messages":[{"threadId":"t"}]}],"historyId":"11"}),
            ),
            (200, updated),
            (200, json!({"threads":[{"id":"t"}]})),
        ]);
        g.store
            .sync(
                "a",
                "10",
                &[(
                    "t".into(),
                    Some(model::normalize("a", &mail("t"), false).unwrap()),
                )],
            )
            .unwrap();
        let query = json!({"accountId":"a","mailbox":"inbox"});
        g.action(
            "a",
            &json!({"action":"setStarred","threadIds":["t"],"value":true}),
        )
        .unwrap();
        let page = g.threads("a", &query).unwrap();
        assert_eq!(page["items"][0]["subject"], "Hello");
        assert_eq!(page["items"][0]["isStarred"], true);
        assert!(g.sync("a").unwrap());
        let page = g.threads("a", &query).unwrap();
        assert_eq!(page["items"][0]["subject"], "Updated");
        assert_eq!(page["items"][0]["isStarred"], true);
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 4);
        assert_eq!(
            requests
                .iter()
                .filter(|r| r.contains("/threads/t?"))
                .count(),
            1
        );
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rate_limit_cooldown_is_shared_across_reads_sync_and_downloads() {
        for status in [403, 429] {
            let (mut g, server, dir) = fixture_with_headers(
                vec![(
                    status,
                    json!({"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}),
                )],
                "Retry-After: 120\r\n",
            );
            let error = g.labels("a").unwrap_err();
            assert_eq!(error.code, "rate_limit");
            assert_eq!(error.retry_after, Some(120));
            assert_eq!(g.sync("a").unwrap_err().code, "rate_limit");
            assert_eq!(g.thread("a", "uncached").unwrap_err().code, "rate_limit");
            g.store
                .put(
                    "a",
                    "body:t",
                    &json!({"messages":[{"id":"m","attachments":[{"id":"file","size":5}]}]}),
                )
                .unwrap();
            assert_eq!(
                g.attachment("a", "m", "file", "t").unwrap_err().code,
                "rate_limit"
            );
            g.store.put("a", "labels", &json!([])).unwrap();
            assert_eq!(g.labels("a").unwrap(), json!([]));
            assert_eq!(server.join().unwrap().len(), 1);
            drop(g);
            std::fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn metadata_rate_limit_preserves_the_cached_page_and_local_overlay() {
        let (mut g, server, dir) = fixture(vec![
            (200, json!({"threads":[{"id":"new"}]})),
            (429, json!({})),
        ]);
        let query = json!({"accountId":"a","mailbox":"inbox"});
        let thread = model::normalize("a", &mail("t"), false).unwrap();
        g.store.put("a", "thread:t", &thread).unwrap();
        g.store
            .put(
                "a",
                &format!("page:{query}"),
                &json!({"items":[thread],"nextCursor":"older"}),
            )
            .unwrap();
        g.action(
            "a",
            &json!({"action":"setStarred","threadIds":["t"],"value":true}),
        )
        .unwrap();
        let page = g.threads("a", &query).unwrap();
        assert_eq!(page["stale"], true);
        assert_eq!(page["items"][0]["id"], "t");
        assert_eq!(page["items"][0]["isStarred"], true);
        assert_eq!(page["nextCursor"], "older");
        assert_eq!(server.join().unwrap().len(), 2);
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn attachment_download_is_explicit_scoped_and_size_limited() {
        let (mut g, server, dir) = fixture(vec![(200, json!({"data":"aGVsbG8"}))]);
        g.store.put("a","body:t",&json!({"messages":[{"id":"m","attachments":[{"id":"file","size":5},{"id":"large","size":16*1024*1024}]}]})).unwrap();
        assert!(g.attachment("a", "m", "unknown", "t").is_err());
        assert!(g.attachment("a", "m", "large", "t").is_err());
        assert_eq!(g.attachment("a", "m", "file", "t").unwrap(), b"hello");
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].contains("/messages/m/attachments/file"));
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
