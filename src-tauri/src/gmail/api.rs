use super::{
    auth,
    batch::{self, Read as BatchRead},
    diagnostics::Diagnostics,
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
    sync::Arc,
    time::Instant,
};

const BASE: &str = "https://gmail.googleapis.com/gmail/v1/users/me/";
const MAX_RESPONSE: u64 = 24 * 1024 * 1024;
pub struct Gmail {
    pub store: Store,
    pub diagnostics: Arc<Diagnostics>,
    access: HashMap<String, auth::Access>,
    client: Client,
    base: String,
    pub(super) quota: Quota,
    pub(super) generation: u64,
    summaries: HashMap<(String, String), Value>,
}
impl Gmail {
    pub fn new(store: Store) -> Result<Self> {
        Ok(Self {
            store,
            diagnostics: Arc::new(Diagnostics::default()),
            access: HashMap::new(),
            client: auth::client()?,
            base: BASE.into(),
            quota: Quota::default(),
            generation: 0,
            summaries: HashMap::new(),
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
            &self.diagnostics,
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
        self.generation += 1;
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
    pub(super) fn get(
        &mut self,
        account: &str,
        path: &str,
        params: &[(&str, String)],
    ) -> Result<Value> {
        let token = self.token(account)?;
        match request(
            &self.quota,
            &self.diagnostics,
            &self.client,
            &self.base,
            &token,
            path,
            params,
        ) {
            Err(e) if e.code == "auth" => {
                self.access.remove(account);
                let token = self.token(account)?;
                request(
                    &self.quota,
                    &self.diagnostics,
                    &self.client,
                    &self.base,
                    &token,
                    path,
                    params,
                )
            }
            other => other,
        }
    }
    pub(super) fn get_many(
        &mut self,
        account: &str,
        reads: &[BatchRead],
    ) -> Result<Vec<Result<Value>>> {
        if reads.len() == 1 {
            return Ok(vec![self.get(account, &reads[0].path, &reads[0].params)]);
        }
        let token = self.token(account)?;
        let responses = batch::request(
            &self.quota,
            &self.diagnostics,
            &self.client,
            &self.base,
            &token,
            reads,
        );
        let mut responses = match responses {
            Err(error) if error.code == "auth" => {
                self.access.remove(account);
                let token = self.token(account)?;
                return batch::request(
                    &self.quota,
                    &self.diagnostics,
                    &self.client,
                    &self.base,
                    &token,
                    reads,
                );
            }
            other => other?,
        };
        // Retry only expired-token parts, once. Never replay successful reads or
        // retry during a shared rate-limit cooldown.
        if responses
            .iter()
            .any(|r| matches!(r, Err(e) if e.code == "rate_limit"))
        {
            return Ok(responses);
        }
        let expired: Vec<_> = responses
            .iter()
            .enumerate()
            .filter_map(|(i, r)| matches!(r, Err(e) if e.code == "auth").then_some(i))
            .collect();
        if !expired.is_empty() {
            self.access.remove(account);
            let token = self.token(account)?;
            let retry: Vec<_> = expired.iter().map(|&i| reads[i].clone()).collect();
            let retried = batch::request(
                &self.quota,
                &self.diagnostics,
                &self.client,
                &self.base,
                &token,
                &retry,
            )?;
            for (i, response) in expired.into_iter().zip(retried) {
                responses[i] = response;
            }
        }
        Ok(responses)
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
        let fetched: Result<Vec<Value>> = (|| {
            let mut values = Vec::new();
            for chunk in ids.chunks(batch::LABEL_LIMIT) {
                let reads: Vec<_> = chunk
                    .iter()
                    .map(|id| BatchRead::new(format!("labels/{}", segment(id)), vec![]))
                    .collect();
                for value in self.get_many(account, &reads)? {
                    values.push(value?);
                }
            }
            Ok(values)
        })();
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
            if let Some(before) = self.cached_summary(account, &id)? {
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
            ("maxResults", "500".into()),
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
        // Finish the ID list before loading any row details. Do not cache unread bodies.
        let mut refs = Vec::new();
        let mut seen = BTreeSet::new();
        let mut tokens = BTreeSet::new();
        loop {
            let page = match self.get(account, "threads", &params) {
                Ok(page) => page,
                Err(e) if e.code == "offline" || e.code == "rate_limit" => {
                    let mut page = cached(&self.store, account, &key, e)?;
                    page["stale"] = json!(true);
                    return self.page_overlay(account, page, query);
                }
                Err(e) => return Err(e),
            };
            for thread in array(&page["threads"]) {
                let id = text(thread, "id");
                if !id.is_empty() && seen.insert(id.to_string()) {
                    refs.push(thread.clone());
                }
            }
            let token = text(&page, "nextPageToken");
            if token.is_empty() {
                break;
            }
            if !tokens.insert(token.to_string()) {
                return Err(Error::new("invalid", "Google repeated a list page token"));
            }
            params.retain(|(name, _)| *name != "pageToken");
            params.push(("pageToken", token.into()));
        }
        let page = json!({"threads":refs,"nextCursor":null,"stale":false});
        self.store.put(account, &key, &page)?;
        self.store.evict(account)?;
        self.page_overlay(account, page, query)
    }

    fn cached_summary(&self, account: &str, id: &str) -> Result<Option<Value>> {
        Ok(self
            .known_summary(account, id)?
            .filter(|v| v["metadataPending"] != true))
    }

    fn known_summary(&self, account: &str, id: &str) -> Result<Option<Value>> {
        if let Some(value) = self.summaries.get(&(account.into(), id.into())) {
            return Ok(Some(value.clone()));
        }
        if let Some(value) = self.store.get(account, &format!("thread:{id}"))? {
            if value["metadataPending"] != true {
                return Ok(Some(value));
            }
        }
        let overlay = self.store.overlay(account, id)?;
        Ok(overlay["source"]
            .as_object()
            .map(|_| overlay["source"].clone()))
    }

    pub(super) fn invalidate_summaries(
        &mut self,
        account: &str,
        ids: &BTreeSet<String>,
        all: bool,
    ) {
        self.summaries
            .retain(|(a, id), _| a != account || (!all && !ids.contains(id)));
    }

    fn listed_summary(&self, account: &str, id: &str) -> Result<Option<Value>> {
        let mut stmt = self
            .store
            .0
            .prepare("SELECT key,value FROM cache WHERE account=?1 AND key LIKE 'page:%'")?;
        let rows = stmt.query_map([account], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (key, value) = row?;
            let query: Value = serde_json::from_str(&key[5..])
                .map_err(|_| Error::new("invalid", "Local list cache is invalid"))?;
            let page: Value = serde_json::from_str(&value)
                .map_err(|_| Error::new("invalid", "Local list cache is invalid"))?;
            if let Some(reference) = array(&page["threads"]).iter().find(|r| text(r, "id") == id) {
                return Ok(Some(pending_summary(account, reference, &query)));
            }
        }
        Ok(None)
    }

    /// How long uncached rows must wait for quota before `summaries` can run without sleeping.
    pub fn summaries_wait(&mut self, account: &str, ids: &[String]) -> Result<std::time::Duration> {
        let mut missing = BTreeSet::new();
        for id in ids {
            if self.cached_summary(account, id)?.is_none() {
                missing.insert(id);
            }
        }
        if missing.is_empty() {
            return Ok(std::time::Duration::ZERO);
        }
        self.quota
            .metadata_wait(missing.len() as f64 * super::quota::cost("threads/x"))
    }

    pub fn summaries(&mut self, account: &str, ids: &[String]) -> Result<Value> {
        let mut missing = Vec::new();
        for id in ids {
            if self.cached_summary(account, id)?.is_none() && !missing.contains(id) {
                missing.push(id.clone());
            }
        }
        let reused = ids.len().saturating_sub(missing.len());
        if reused > 0 {
            self.diagnostics.event("cache", "reused", Some(reused));
        }
        for chunk in missing.chunks(batch::METADATA_LIMIT) {
            let reads: Vec<_> = chunk
                .iter()
                .map(|id| BatchRead::new(format!("threads/{}", segment(id)), summary_params()))
                .collect();
            for (id, response) in chunk.iter().zip(self.get_many(account, &reads)?) {
                let mut value = model::normalize(account, &response?, false)?;
                value.as_object_mut().unwrap().remove("messages");
                // Row metadata lives only in memory. Persistent mail is opened-only.
                if self.summaries.len() >= 2000 {
                    self.summaries.clear();
                }
                self.summaries.insert((account.into(), id.clone()), value);
            }
        }
        ids.iter()
            .map(|id| {
                let value = self.cached_summary(account, id)?.ok_or_else(|| {
                    Error::new("not_found", "Conversation metadata is unavailable")
                })?;
                Ok(model::apply(value, &self.store.overlay(account, id)?))
            })
            .collect::<Result<Vec<_>>>()
            .map(|values| json!(values))
    }

    fn page_overlay(&self, account: &str, mut page: Value, query: &Value) -> Result<Value> {
        let mut items = Vec::new();
        let mut seen = BTreeSet::new();
        let mut reused = 0;
        let refs = if page["threads"].is_array() {
            &page["threads"]
        } else {
            &page["items"]
        };
        for reference in array(refs) {
            let id = text(reference, "id");
            let cached = self.cached_summary(account, id)?;
            reused += usize::from(cached.is_some());
            let thread = cached.unwrap_or_else(|| pending_summary(account, reference, query));
            let changed = model::apply(thread, &self.store.overlay(account, id)?);
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
                if let Some(thread) = self.known_summary(account, &id)? {
                    let changed = model::apply(thread, &overlay);
                    if model::matches(&changed, query) {
                        items.push(changed);
                    }
                }
            }
        }
        // Preserve Gmail list order while rows have unknown dates.
        if reused > 0 {
            self.diagnostics.event("cache", "reused", Some(reused));
        }
        page.as_object_mut().unwrap().remove("threads");
        page["items"] = json!(items);
        Ok(page)
    }
    pub fn thread(&mut self, account: &str, id: &str) -> Result<Value> {
        let key = format!("body:{id}");
        let mut thread = if let Some(value) = self.store.get(account, &key)? {
            self.diagnostics.event("cache", "reused", Some(1));
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
            let mut summary = value.clone();
            summary.as_object_mut().unwrap().remove("messages");
            self.store.put(account, &format!("thread:{id}"), &summary)?;
            self.summaries.insert((account.into(), id.into()), summary);
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
            let source = match self.known_summary(account, id)? {
                Some(value) => Some(value),
                None => self.listed_summary(account, id)?,
            }
            .ok_or_else(|| {
                Error::new(
                    "not_found",
                    "Load this conversation before changing it locally",
                )
            })?;
            let mut overlay = self.store.overlay(account, id)?;
            // Local moves need their original membership after restart. Keep this
            // small snapshot with the explicit simulation, not the message cache.
            overlay["source"] = source.clone();
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
    #[cfg(test)]
    fn sync(&mut self, account: &str) -> Result<bool> {
        let mut pass = super::sync::Sync::new(self, account)?;
        loop {
            match pass.step(self)? {
                super::sync::Step::Done(changed) => return Ok(changed),
                super::sync::Step::Pending(wait) => std::thread::sleep(wait),
            }
        }
    }
    pub fn disconnect(&mut self, account: &str) -> Result<Value> {
        self.invalidate_summaries(account, &BTreeSet::new(), true);
        auth::remove(account)?;
        self.access.remove(account);
        self.store.remove(account)?;
        self.generation += 1;
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
fn pending_summary(account: &str, reference: &Value, query: &Value) -> Value {
    let label = text(query, "labelId");
    let mailbox_label = match text(query, "mailbox") {
        "inbox" => "INBOX",
        "starred" => "STARRED",
        "sent" => "SENT",
        "junk" => "SPAM",
        "trash" => "TRASH",
        _ => "",
    };
    let labels: Vec<_> = [label, mailbox_label]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect();
    json!({"id":text(reference,"id"),"accountId":account,"subject":"","participants":[],
        "snippet":text(reference,"snippet"),"messageCount":0,"lastMessageAt":"","isRead":true,
        "isStarred":mailbox_label=="STARRED","labelIds":labels,"hasAttachments":false,"metadataPending":true})
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
pub(super) fn segment(id: &str) -> String {
    url::form_urlencoded::byte_serialize(id.as_bytes()).collect()
}
fn request(
    quota: &Quota,
    diagnostics: &Diagnostics,
    client: &Client,
    base: &str,
    token: &str,
    path: &str,
    params: &[(&str, String)],
) -> Result<Value> {
    let started = Instant::now();
    if let Err(error) = quota.acquire(path) {
        let result = Err(error);
        diagnostics.request(
            path,
            None,
            &result,
            (started.elapsed(), started.elapsed()),
            None,
            false,
        );
        return result;
    }
    let wait = started.elapsed();
    let mut http_status = None;
    let mut reason = None;
    let result = (|| {
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
        http_status = Some(status.as_u16());
        if !status.is_success() {
            let mut body = Vec::new();
            let _ = response.by_ref().take(64 * 1024).read_to_end(&mut body);
            let (mut error, recognized) = response_error(
                status.as_u16(),
                &body,
                response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok()),
            );
            reason = recognized;
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
    })();
    diagnostics.request(
        path,
        http_status,
        &result,
        (started.elapsed(), wait),
        reason.as_deref(),
        true,
    );
    result
}

pub(super) fn response_error(
    status: u16,
    body: &[u8],
    retry_after: Option<&str>,
) -> (Error, Option<String>) {
    let mut error = match status {
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
    let mut reason = None;
    if [403, 429].contains(&status) {
        if let Ok(value) = serde_json::from_slice::<Value>(body) {
            if let Some(value) = array(&value["error"]["errors"]).iter().find(|e| {
                [
                    "rateLimitExceeded",
                    "userRateLimitExceeded",
                    "dailyLimitExceeded",
                ]
                .contains(&text(e, "reason"))
            }) {
                reason = Some(text(value, "reason").to_string());
                error = Error::new("rate_limit", "Gmail rate limit reached. Sync will retry.");
            }
        }
    }
    error.retry_after = retry_after.and_then(|v| {
        v.parse().ok().or_else(|| {
            let target = chrono::DateTime::parse_from_rfc2822(v).ok()?.timestamp();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs() as i64;
            Some(target.saturating_sub(now).max(0) as u64)
        })
    });
    (error, reason)
}

pub(super) fn summary_params() -> Vec<(&'static str, String)> {
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
                let request = read_http(&mut socket);
                requests.push(request.lines().next().unwrap().to_string());
                let batch = request.starts_with("POST /batch ");
                let targets: Vec<_> = request
                    .lines()
                    .filter(|line| line.starts_with("GET "))
                    .map(|line| line.split_whitespace().nth(1).unwrap())
                    .collect();
                let mut parts = Vec::new();
                for (i, target) in targets.into_iter().enumerate() {
                    let path = url::Url::parse(&format!("http://localhost{target}"))
                        .unwrap()
                        .path()
                        .to_string();
                    let id = path.rsplit('/').next().unwrap();
                    let index = replies
                        .iter()
                        .position(|(_, v)| v["id"] == id)
                        .or_else(|| {
                            (id == "deleted")
                                .then(|| replies.iter().position(|(code, _)| *code == 404))
                                .flatten()
                        })
                        .unwrap_or(0);
                    let (status, value) = replies.remove(index);
                    if batch {
                        parts.push(format!("--fixture\r\nContent-Type: application/http\r\nContent-ID: <response-item-{i}>\r\n\r\nHTTP/1.1 {status} Test\r\nContent-Type: application/json\r\n{headers}\r\n{value}\r\n"));
                    } else {
                        let body = value.to_string();
                        write!(socket,"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
                    }
                }
                if batch {
                    // Reverse parts to exercise Content-ID correlation in every fixture.
                    parts.reverse();
                    let body = format!("{}--fixture--\r\n", parts.concat());
                    write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: multipart/mixed; boundary=fixture\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
                }
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
    fn read_http(socket: &mut std::net::TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut chunk = [0; 8192];
        loop {
            let n = socket.read(&mut chunk).unwrap();
            assert!(n > 0, "Incomplete fixture request");
            bytes.extend_from_slice(&chunk[..n]);
            assert!(bytes.len() < 256 * 1024);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]);
                let size = headers
                    .lines()
                    .find_map(|line| {
                        line.split_once(':')
                            .filter(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                            .map(|(_, v)| v.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if bytes.len() >= end + 4 + size {
                    break;
                }
            }
        }
        String::from_utf8(bytes).unwrap()
    }

    fn mail(id: &str) -> Value {
        json!({"id":id,"messages":[{"id":"m","internalDate":"1000","labelIds":["INBOX","UNREAD"],"snippet":"A &amp; B","payload":{"headers":[{"name":"Subject","value":"Hello"}]}}]})
    }
    #[test]
    fn lists_drain_all_pages_and_deduplicate_without_fetching_metadata() {
        let (mut g, server, dir) = fixture(vec![
            (
                200,
                json!({"threads":[{"id":"a","snippet":"Preview"},{"id":"b"}],"nextPageToken":"next"}),
            ),
            (200, json!({"threads":[{"id":"b"},{"id":"c"}]})),
        ]);
        let page = g
            .threads(
                "a",
                &json!({"accountId":"a","labelId":"custom","search":"from:alice","limit":30}),
            )
            .unwrap();
        assert_eq!(
            array(&page["items"])
                .iter()
                .map(|v| text(v, "id"))
                .collect::<Vec<_>>(),
            ["a", "b", "c"]
        );
        assert_eq!(page["items"][0]["snippet"], "Preview");
        assert!(array(&page["items"])
            .iter()
            .all(|v| v["metadataPending"] == true));
        assert!(page["nextCursor"].is_null());
        assert!(g.store.get("a", "thread:a").unwrap().is_none());
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests.iter().all(|r| r.starts_with("GET /threads?")
            && r.contains("maxResults=500")
            && r.contains("labelIds=custom")
            && r.contains("from%3Aalice")));
        assert!(requests[1].contains("pageToken=next"));
        assert_eq!(
            serde_json::to_value(g.diagnostics.snapshot()).unwrap()["quotaUnits"],
            20
        );
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn visible_metadata_is_batched_reused_in_memory_and_persisted_only_on_open() {
        let (mut g, server, dir) =
            fixture(vec![(200, mail("t")), (200, mail("u")), (200, mail("t"))]);
        let ids = vec!["t".into(), "u".into()];
        let rows = g.summaries("a", &ids).unwrap();
        assert_eq!(rows[0]["subject"], "Hello");
        assert!(g.store.get("a", "thread:t").unwrap().is_none());
        assert!(g.store.get("a", "body:t").unwrap().is_none());
        assert_eq!(g.summaries("a", &ids).unwrap(), rows);
        g.thread("a", "t").unwrap();
        assert!(g.store.get("a", "body:t").unwrap().is_some());
        assert!(g.store.get("a", "thread:t").unwrap().unwrap()["messages"].is_null());
        assert!(g.store.get("a", "thread:u").unwrap().is_none());
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("POST /batch "));
        assert!(requests[1].contains("format=full") && !requests[1].contains("fields="));
        drop(g);
        let mut reopened = Gmail::new(Store::open(&dir.join("cache.sqlite")).unwrap()).unwrap();
        assert_eq!(reopened.thread("a", "t").unwrap()["subject"], "Hello");
        assert_eq!(
            reopened.summaries("a", &["t".into()]).unwrap()[0]["subject"],
            "Hello"
        );
        assert_eq!(
            serde_json::to_value(reopened.diagnostics.snapshot()).unwrap()["requests"],
            0
        );
        drop(reopened);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn label_counts_batch_and_partial_failure_preserves_cached_counts() {
        let labels = json!([{"id":"INBOX"},{"id":"UNREAD"},{"id":"custom"}]);
        let inbox = json!({"id":"INBOX","threadsUnread":7});
        let unread = json!({"id":"UNREAD","threadsUnread":9});
        let custom = json!({"id":"custom","threadsUnread":2,"type":"user"});
        let (mut g, server, dir) = fixture(vec![
            (200, inbox.clone()),
            (200, unread.clone()),
            (200, custom.clone()),
            (200, inbox),
            (200, unread),
            (429, json!({})),
        ]);
        g.store.put("a", "labels", &labels).unwrap();
        let counts = g.counts("a").unwrap();
        assert_eq!(counts["mailboxes"]["inbox"], 7);
        assert_eq!(counts["mailboxes"]["all"], 9);
        assert_eq!(counts["labels"]["custom"], 2);
        assert_eq!(g.counts("a").unwrap(), counts);
        assert_eq!(g.quota.acquire("profile").unwrap_err().code, "rate_limit");
        assert_eq!(server.join().unwrap().len(), 2);
        let log = serde_json::to_value(g.diagnostics.snapshot()).unwrap();
        assert_eq!(log["requests"], 6);
        assert_eq!(log["quotaUnits"], 6);
        assert_eq!(log["rateLimits"], 1);
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn bootstrap_only_captures_the_history_baseline() {
        let (mut g, server, dir) = fixture(vec![(200, json!({"historyId":"20"}))]);
        assert!(g.sync("a").unwrap());
        assert_eq!(g.store.history("a").unwrap().as_deref(), Some("20"));
        assert_eq!(server.join().unwrap().len(), 1);
        assert_eq!(
            serde_json::to_value(g.diagnostics.snapshot()).unwrap()["quotaUnits"],
            1
        );
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn first_baseline_preserves_fresh_visible_metadata() {
        let (mut g, server, dir) =
            fixture(vec![(200, mail("t")), (200, json!({"historyId":"20"}))]);
        let ids = vec!["t".into()];
        let visible = g.summaries("a", &ids).unwrap();
        assert!(g.sync("a").unwrap());
        assert_eq!(g.summaries("a", &ids).unwrap(), visible);
        assert_eq!(server.join().unwrap().len(), 2);
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sync_worker_yields_to_queued_interaction_after_inflight_request() {
        use super::super::{scheduler, sync_work, with_worker, State};
        use std::sync::{mpsc, Mutex};
        use tauri::{
            test::{mock_builder, mock_context, noop_assets},
            Manager,
        };

        let (mut g, empty_server, dir) = fixture(vec![]);
        empty_server.join().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        g.base = format!("http://{}/", listener.local_addr().unwrap());
        let (requested, received) = mpsc::channel();
        let (respond, response_allowed) = mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            assert!(read_http(&mut socket).starts_with("GET /history?"));
            requested.send(()).unwrap();
            response_allowed
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            let body=json!({"historyId":"11","history":[{"messages":[{"threadId":"t"},{"threadId":"u"}]}]}).to_string();
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        let cached = model::normalize("a", &mail("t"), true).unwrap();
        g.store
            .sync("a", "10", &[("t".into(), Some(cached.clone()))])
            .unwrap();
        g.store.put("a", "body:t", &cached).unwrap();
        let state = State {
            diagnostics: g.diagnostics.clone(),
            gmail: Arc::new(Mutex::new(Some(g))),
            scheduler: Arc::new(scheduler::Scheduler::default()),
            ..State::default()
        };
        let app = mock_builder()
            .manage(state)
            .build(mock_context(noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        let sync = tauri::async_runtime::spawn(async move {
            sync_work(handle.clone(), &handle.state::<State>(), "a".into()).await
        });
        received.recv_timeout(Duration::from_secs(5)).unwrap();
        let state = app.state::<State>();
        // Queue an interaction while the history HTTP request is still in flight.
        let ticket = state.scheduler.foreground();
        respond.send(()).unwrap();
        {
            let _permit = ticket.enter();
            with_worker(app.handle(), &state.gmail, &state.diagnostics, |g| {
                assert_eq!(g.store.history("a")?.as_deref(), Some("10"));
                assert_eq!(g.thread("a", "t")?["isRead"], false);
                g.action(
                    "a",
                    &json!({"action":"markRead","threadIds":["t"],"value":true}),
                )?;
                // Background metadata has not started before this interaction.
                let log = serde_json::to_value(g.diagnostics.snapshot()).unwrap();
                assert_eq!(log["requests"], 1);
                Ok(())
            })
            .unwrap();
        }
        drop(ticket);
        assert!(tauri::async_runtime::block_on(sync).unwrap().unwrap());
        assert!(!state.syncing.load(std::sync::atomic::Ordering::SeqCst));
        let worker = state.gmail.lock().unwrap();
        let g = worker.as_ref().unwrap();
        assert_eq!(g.store.history("a").unwrap().as_deref(), Some("11"));
        assert_eq!(g.store.overlay("a", "t").unwrap()["isRead"], true);
        drop(worker);
        drop(state);
        drop(app);
        server.join().unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sync_steps_leave_cached_reads_available_then_invalidate_only_changed_threads() {
        use super::super::sync::{Step, Sync};
        let (mut g, server, dir) = fixture(vec![(
            200,
            json!({"historyId":"11","history":[{"messages":[{"threadId":"t"},{"threadId":"unknown"}]}]}),
        )]);
        for id in ["t", "unchanged"] {
            let value = model::normalize("a", &mail(id), true).unwrap();
            g.store.put("a", &format!("body:{id}"), &value).unwrap();
            g.store.put("a", &format!("thread:{id}"), &value).unwrap();
        }
        g.store.sync("a", "10", &[]).unwrap();
        let mut pass = Sync::new(&g, "a").unwrap();
        assert!(matches!(pass.step(&mut g).unwrap(), Step::Pending(_)));
        assert_eq!(g.store.history("a").unwrap().as_deref(), Some("10"));
        assert_eq!(g.thread("a", "t").unwrap()["subject"], "Hello");
        g.action(
            "a",
            &json!({"action":"markRead","threadIds":["t"],"value":true}),
        )
        .unwrap();
        assert!(matches!(pass.step(&mut g).unwrap(), Step::Done(true)));
        assert!(g.store.get("a", "body:t").unwrap().is_none());
        assert_eq!(
            g.store.get("a", "thread:t").unwrap().unwrap()["metadataPending"],
            true
        );
        assert_eq!(g.thread("a", "unchanged").unwrap()["subject"], "Hello");
        assert!(g.store.get("a", "thread:unknown").unwrap().is_none());
        assert_eq!(g.store.overlay("a", "t").unwrap()["isRead"], true);
        assert_eq!(server.join().unwrap().len(), 1);
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn connection_change_cancels_sync_before_it_can_commit_old_data() {
        use super::super::sync::{Step, Sync};
        let (mut g, server, dir) = fixture(vec![(
            200,
            json!({"historyId":"11","history":[{"messages":[{"threadId":"t"}]}]}),
        )]);
        g.store.sync("a", "10", &[]).unwrap();
        let mut pass = Sync::new(&g, "a").unwrap();
        assert!(matches!(pass.step(&mut g).unwrap(), Step::Pending(_)));
        g.generation += 1;
        assert_eq!(pass.step(&mut g).err().unwrap().code, "cancelled");
        assert_eq!(g.store.history("a").unwrap().as_deref(), Some("10"));
        assert_eq!(server.join().unwrap().len(), 1);
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn repeated_list_page_tokens_fail_without_replacing_the_cached_complete_list() {
        let (mut g, server, dir) = fixture(vec![
            (
                200,
                json!({"threads":[{"id":"t"}],"nextPageToken":"repeat"}),
            ),
            (
                200,
                json!({"threads":[{"id":"z"}],"nextPageToken":"repeat"}),
            ),
        ]);
        let query = json!({"accountId":"a","mailbox":"inbox"});
        let key = format!("page:{query}");
        g.store
            .put("a", &key, &json!({"threads":[{"id":"old"}]}))
            .unwrap();
        assert_eq!(g.threads("a", &query).unwrap_err().code, "invalid");
        assert_eq!(
            g.store.get("a", &key).unwrap().unwrap()["threads"][0]["id"],
            "old"
        );
        assert_eq!(server.join().unwrap().len(), 2);
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sync_pages_invalidate_changes_without_fetching_or_erasing_partial_deletions() {
        let (mut g, server, dir) = fixture(vec![
            (
                200,
                json!({"history":[{"labelsAdded":[{"message":{"threadId":"t"}}]}],"nextPageToken":"page2","historyId":"11"}),
            ),
            (
                200,
                json!({"history":[{"messagesDeleted":[{"message":{"threadId":"deleted"}}]}],"historyId":"12"}),
            ),
        ]);
        g.store.sync("a", "10", &[]).unwrap();
        g.store
            .write_overlays("a", &[("deleted".into(), json!({"isRead":true}))])
            .unwrap();
        assert!(g.sync("a").unwrap());
        assert_eq!(g.store.history("a").unwrap().as_deref(), Some("12"));
        // Deleting one message does not mean the entire conversation was deleted.
        assert_eq!(g.store.overlay("a", "deleted").unwrap()["isRead"], true);
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].contains("pageToken=page2"));
        assert_eq!(
            serde_json::to_value(g.diagnostics.snapshot()).unwrap()["quotaUnits"],
            4
        );
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
    fn expired_cursor_invalidates_old_mail_without_fetching_replacements() {
        let (mut g, server, dir) =
            fixture(vec![(404, json!({})), (200, json!({"historyId":"20"}))]);
        g.store.sync("a", "old", &[]).unwrap();
        let value = model::normalize("a", &mail("old"), true).unwrap();
        g.store.put("a", "body:old", &value).unwrap();
        g.store.put("a", "thread:old", &value).unwrap();
        assert!(g.sync("a").unwrap());
        assert_eq!(g.store.history("a").unwrap().as_deref(), Some("20"));
        assert!(g.store.get("a", "body:old").unwrap().is_none());
        assert_eq!(
            g.store.get("a", "thread:old").unwrap().unwrap()["metadataPending"],
            true
        );
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].contains("/profile"));
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn local_actions_on_unloaded_ids_fetch_no_metadata_and_survive_restart() {
        let (mut g, server, dir) = fixture(vec![(200, json!({"threads":[{"id":"t"},{"id":"u"}]}))]);
        g.threads("a", &json!({"accountId":"a","mailbox":"inbox"}))
            .unwrap();
        g.action("a", &json!({"action":"trash","threadIds":["t","u"]}))
            .unwrap();
        assert!(g.store.get("a", "body:t").unwrap().is_none());
        assert!(g.store.get("a", "thread:t").unwrap().is_none());
        assert_eq!(server.join().unwrap().len(), 1);
        drop(g);
        let mut reopened = Gmail::new(Store::open(&dir.join("cache.sqlite")).unwrap()).unwrap();
        let moved = reopened
            .page_overlay("a", json!({"threads":[]}), &json!({"mailbox":"trash"}))
            .unwrap();
        assert_eq!(array(&moved["items"]).len(), 2);
        assert_eq!(moved["items"][0]["metadataPending"], true);
        reopened
            .action("a", &json!({"action":"restore","threadIds":["t"]}))
            .unwrap();
        assert_eq!(
            array(
                &reopened
                    .page_overlay("a", json!({"threads":[]}), &json!({"mailbox":"inbox"}))
                    .unwrap()["items"]
            )
            .len(),
            1
        );
        assert_eq!(
            serde_json::to_value(reopened.diagnostics.snapshot()).unwrap()["requests"],
            0
        );
        drop(reopened);
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
    fn opened_bodies_and_completed_id_lists_work_offline() {
        let (mut g, server, dir) = fixture(vec![
            (
                200,
                json!({"threads":[{"id":"t","snippet":"Preview"}],"nextPageToken":"older"}),
            ),
            (200, json!({"threads":[{"id":"u"}]})),
            (200, mail("t")),
        ]);
        let query = json!({"accountId":"a","mailbox":"inbox","search":"from:alice@example.com"});
        let page = g.threads("a", &query).unwrap();
        assert_eq!(array(&page["items"]).len(), 2);
        assert_eq!(page["items"][0]["metadataPending"], true);
        assert_eq!(g.thread("a", "t").unwrap()["subject"], "Hello");
        assert_eq!(server.join().unwrap().len(), 3);
        let offline = g.threads("a", &query).unwrap();
        assert_eq!(offline["stale"], true);
        assert_eq!(offline["items"][0]["subject"], "Hello");
        assert_eq!(offline["items"][1]["metadataPending"], true);
        assert_eq!(g.thread("a", "t").unwrap()["subject"], "Hello");
        drop(g);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn changed_mail_is_refetched_only_when_opened_and_unchanged_mail_is_reused() {
        let mut updated = mail("t");
        updated["messages"][0]["payload"]["headers"][0]["value"] = json!("Updated");
        let (mut g, server, dir) = fixture(vec![
            (200, mail("t")),
            (200, json!({"historyId":"11"})),
            (
                200,
                json!({"historyId":"12","history":[{"messagesAdded":[{"message":{"threadId":"t"}}]}]}),
            ),
            (200, updated),
        ]);
        g.store.sync("a", "10", &[]).unwrap();
        g.thread("a", "t").unwrap();
        assert!(!g.sync("a").unwrap());
        assert_eq!(g.thread("a", "t").unwrap()["subject"], "Hello");
        assert!(g.sync("a").unwrap());
        assert!(g.store.get("a", "body:t").unwrap().is_none());
        assert_eq!(g.thread("a", "t").unwrap()["subject"], "Updated");
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 4);
        assert!(requests[1..3]
            .iter()
            .all(|r| r.starts_with("GET /history?")));
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
            let log = serde_json::to_value(g.diagnostics.snapshot()).unwrap();
            assert_eq!(log["entries"][0]["status"], status);
            assert_eq!(log["entries"][0]["reason"], "userRateLimitExceeded");
            assert_eq!(log["rateLimits"], 1);
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
            assert_eq!(
                serde_json::to_value(g.diagnostics.snapshot()).unwrap()["requests"],
                1
            );
            assert_eq!(server.join().unwrap().len(), 1);
            drop(g);
            std::fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn later_list_page_rate_limit_preserves_the_complete_cached_list_and_local_overlay() {
        let (mut g, server, dir) = fixture(vec![
            (
                200,
                json!({"threads":[{"id":"new"}],"nextPageToken":"second"}),
            ),
            (429, json!({})),
        ]);
        let query = json!({"accountId":"a","mailbox":"inbox"});
        let thread = model::normalize("a", &mail("t"), false).unwrap();
        g.store.put("a", "thread:t", &thread).unwrap();
        g.store
            .put(
                "a",
                &format!("page:{query}"),
                &json!({"threads":[{"id":"t"}],"nextCursor":null}),
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
        assert!(page["nextCursor"].is_null());
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
