use super::{Error, Result};
use base64::{
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
    Engine,
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub fn decode(data: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(data)
        .or_else(|_| URL_SAFE.decode(data))
        .map_err(|_| Error::new("invalid", "Invalid Gmail message encoding"))
}
fn header(part: &Value, name: &str) -> String {
    let raw = array(&part["headers"])
        .iter()
        .find(|h| text(h, "name").eq_ignore_ascii_case(name))
        .map(|h| text(h, "value"))
        .unwrap_or("");
    let line = format!("{name}: {raw}");
    mailparse::parse_header(line.as_bytes())
        .map(|(h, _)| h.get_value())
        .unwrap_or_else(|_| raw.into())
}
fn addresses(value: &str) -> Vec<Value> {
    let mut out = Vec::new();
    if let Ok(addresses) = mailparse::addrparse(value) {
        for address in addresses.iter() {
            let singles = match address {
                mailparse::MailAddr::Single(s) => vec![s],
                mailparse::MailAddr::Group(g) => g.addrs.iter().collect(),
            };
            for s in singles {
                out.push(json!({"email": s.addr, "name": s.display_name}));
            }
        }
    }
    out
}
fn walk(
    part: &Value,
    plain: &mut Vec<String>,
    html: &mut Vec<String>,
    attachments: &mut Vec<Value>,
    bodies: bool,
) -> Result<()> {
    let filename = header(part, "Content-Disposition");
    let is_attachment = !text(part, "filename").is_empty()
        || filename.to_ascii_lowercase().starts_with("attachment");
    if is_attachment {
        attachments.push(json!({"id": if text(&part["body"], "attachmentId").is_empty() { text(part, "partId") } else { text(&part["body"], "attachmentId") },
            "filename": if text(part, "filename").is_empty() { "attachment" } else { text(part, "filename") }, "mimeType": text(part, "mimeType"), "size": part["body"]["size"].as_u64().unwrap_or(0),
            "partId": text(part, "partId"), "_data":part["body"]["data"]}));
    } else if bodies
        && ["text/plain", "text/html"].contains(&text(part, "mimeType"))
        && part["body"]["data"].is_string()
    {
        let bytes = decode(text(&part["body"], "data"))?;
        let content_type = header(part, "Content-Type");
        let charset = mailparse::parse_content_type(&content_type).charset;
        let encoding =
            encoding_rs::Encoding::for_label(charset.as_bytes()).unwrap_or(encoding_rs::UTF_8);
        let body = encoding.decode(&bytes).0.into_owned();
        if text(part, "mimeType") == "text/html" {
            html.push(body);
        } else {
            plain.push(body);
        }
    }
    for child in array(&part["parts"]) {
        walk(child, plain, html, attachments, bodies)?;
    }
    Ok(())
}
pub fn normalize(account: &str, source: &Value, bodies: bool) -> Result<Value> {
    let mut messages = Vec::new();
    for m in array(&source["messages"]) {
        let payload = &m["payload"];
        let mut plain = Vec::new();
        let mut html = Vec::new();
        let mut attachments = Vec::new();
        walk(payload, &mut plain, &mut html, &mut attachments, bodies)?;
        let millis = text(m, "internalDate").parse::<i64>().unwrap_or(0);
        let sent = chrono::DateTime::from_timestamp_millis(millis)
            .ok_or_else(|| Error::new("invalid", "Invalid Gmail message date"))?
            .to_rfc3339();
        let labels = array(&m["labelIds"]).to_vec();
        let has = |s: &str| labels.iter().any(|l| l == s);
        messages.push(json!({"id": text(m,"id"), "threadId": text(source,"id"), "accountId":account,
            "from": addresses(&header(payload,"From")).first().cloned().unwrap_or(json!({"email":"unknown"})),
            "to": addresses(&header(payload,"To")), "cc": addresses(&header(payload,"Cc")),
            "subject": header(payload,"Subject"), "sentAt":sent,
            "plainText": if plain.is_empty() { Value::Null } else { json!(plain.join("\n")) },
            "html": if html.is_empty() { Value::Null } else { json!(html.join("\n")) },
            "isRead":!has("UNREAD"), "isStarred":has("STARRED"), "labelIds":labels, "attachments":attachments}));
    }
    messages.sort_by(|a, b| text(a, "sentAt").cmp(text(b, "sentAt")));
    if messages.is_empty() {
        return Err(Error::new("not_found", "Gmail conversation is empty"));
    }
    let mut labels = BTreeSet::new();
    let mut participants = Vec::new();
    let mut seen = BTreeSet::new();
    for m in &messages {
        for l in array(&m["labelIds"]) {
            if let Some(s) = l.as_str() {
                labels.insert(s.to_string());
            }
        }
        let from = m["from"].clone();
        if seen.insert(text(&from, "email").to_lowercase()) {
            participants.push(from);
        }
    }
    let last = messages.last().unwrap();
    Ok(
        json!({"id":text(source,"id"), "accountId":account, "subject":messages[0]["subject"], "participants":participants,
        "snippet":html_escape::decode_html_entities(if text(source,"snippet").is_empty() {text(array(&source["messages"]).last().unwrap(),"snippet")} else {text(source,"snippet")}), "messageCount":messages.len(), "lastMessageAt":last["sentAt"],
        "isRead":messages.iter().all(|m| m["isRead"] == true), "isStarred":messages.iter().any(|m| m["isStarred"] == true),
        "labelIds":labels.into_iter().collect::<Vec<_>>(), "hasAttachments":messages.iter().any(|m| !array(&m["attachments"]).is_empty()), "messages":messages}),
    )
}

pub fn matches(thread: &Value, query: &Value) -> bool {
    let labels = array(&thread["labelIds"]);
    let has = |s: &str| labels.iter().any(|l| l == s);
    if thread["hidden"] == true {
        return false;
    }
    match text(query, "mailbox") {
        "trash" => has("TRASH"),
        "junk" => has("SPAM") && !has("TRASH"),
        _ if has("SPAM") || has("TRASH") => false,
        "inbox" => has("INBOX"),
        "sent" => has("SENT"),
        "starred" => thread["isStarred"] == true,
        _ => text(query, "labelId").is_empty() || has(text(query, "labelId")),
    }
}

pub fn apply(mut thread: Value, overlay: &Value) -> Value {
    for key in ["isRead", "isStarred", "hidden"] {
        if overlay[key].is_boolean() {
            thread[key] = overlay[key].clone();
        }
    }
    let update_labels = |value: &mut Value| {
        let mut labels: BTreeSet<String> = array(&value["labelIds"])
            .iter()
            .filter_map(|l| l.as_str().map(String::from))
            .collect();
        if let Some(changes) = overlay["labels"].as_object() {
            for (key, on) in changes {
                if on == true {
                    labels.insert(key.clone());
                } else {
                    labels.remove(key);
                }
            }
        }
        for (key, label, inverse) in [("isRead", "UNREAD", true), ("isStarred", "STARRED", false)] {
            if let Some(on) = overlay[key].as_bool() {
                if on != inverse {
                    labels.insert(label.into());
                } else {
                    labels.remove(label);
                }
            }
        }
        value["labelIds"] = json!(labels.into_iter().collect::<Vec<_>>());
    };
    update_labels(&mut thread);
    if let Some(messages) = thread["messages"].as_array_mut() {
        for m in messages {
            for key in ["isRead", "isStarred"] {
                if overlay[key].is_boolean() {
                    m[key] = overlay[key].clone();
                }
            }
            update_labels(m);
        }
    }
    thread
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixed_message_labels_and_local_field_overrides() {
        let source = json!({"id":"t", "snippet":"hello", "messages":[
            {"id":"m1","internalDate":"1000","labelIds":["INBOX","UNREAD"],"payload":{"headers":[{"name":"From","value":"=?UTF-8?B?SsO2cmc=?= <j@example.com>"}],"mimeType":"text/plain","body":{"data":"aGVsbG8"}}},
            {"id":"m2","internalDate":"2000","labelIds":["STARRED","SENT"],"payload":{}}]});
        let t = normalize("a", &source, true).unwrap();
        assert_eq!(t["isRead"], false);
        assert_eq!(t["isStarred"], true);
        assert_eq!(t["participants"][0]["name"], "Jörg");
        assert_eq!(t["messages"][0]["plainText"], "hello");
        let changed = apply(
            t,
            &json!({"isRead":true,"labels":{"INBOX":false,"TRASH":true}}),
        );
        assert!(matches(&changed, &json!({"mailbox":"trash"})));
        assert!(!matches(&changed, &json!({"mailbox":"inbox"})));
        assert_eq!(changed["isStarred"], true);
        assert_eq!(changed["messages"][0]["isRead"], true);
    }
}

#[cfg(test)]
mod mime_tests {
    use super::*;
    #[test]
    fn decodes_alternatives_charsets_addresses_and_attachment_metadata() {
        let source = json!({"id":"t", "messages":[{"id":"m", "snippet":"A &amp; B", "internalDate":"1000", "payload":{
            "mimeType":"multipart/mixed", "headers":[{"name":"Subject","value":"=?UTF-8?Q?Gr=C3=BC=C3=9Fe?="},
                {"name":"To","value":"Team: Alice <alice@example.com>, Bob <bob@example.com>;"}],
            "parts":[{"mimeType":"multipart/alternative", "parts":[
                {"mimeType":"text/plain", "headers":[{"name":"Content-Type","value":"text/plain; charset=iso-8859-1"}],"body":{"data":URL_SAFE_NO_PAD.encode(b"Gr\xfc\xdfe")}},
                {"mimeType":"text/html", "body":{"data":URL_SAFE_NO_PAD.encode(b"<p>Hello</p><script>hostile()</script>")}}
            ]},{"partId":"2","filename":"report.pdf","mimeType":"application/pdf","body":{"attachmentId":"attachment","size":123}}]
        }}]});
        let t = normalize("a", &source, true).unwrap();
        assert_eq!(t["subject"], "Grüße");
        assert_eq!(t["snippet"], "A & B");
        assert_eq!(t["messages"][0]["to"].as_array().unwrap().len(), 2);
        assert_eq!(t["messages"][0]["plainText"], "Grüße");
        // Sanitization belongs to the established safe-html renderer, never to a second mapper.
        assert!(text(&t["messages"][0], "html").contains("<script>"));
        assert_eq!(t["messages"][0]["attachments"][0]["id"], "attachment");
        assert_eq!(t["hasAttachments"], true);
        let metadata = normalize("a", &source, false).unwrap();
        assert_eq!(metadata["messages"][0]["html"], Value::Null);
    }
}
