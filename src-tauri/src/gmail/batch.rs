use super::{api, diagnostics::Diagnostics, quota, Error, Result};
use mailparse::MailHeaderMap;
use reqwest::blocking::Client;
use serde_json::Value;
use std::{io::Read as _, time::Instant};

// Four thread reads cost 160 units. Even a full authentication retry fits
// the 400-unit burst while preserving 80 units for interactive reads.
pub const METADATA_LIMIT: usize = 4;
pub const LABEL_LIMIT: usize = 50;
const MAX_RESPONSE: u64 = 24 * 1024 * 1024;

#[derive(Clone)]
pub struct Read {
    pub path: String,
    pub params: Vec<(&'static str, String)>,
}
impl Read {
    pub fn new(path: String, params: Vec<(&'static str, String)>) -> Self {
        Self { path, params }
    }
}

struct Part {
    status: u16,
    retry_after: Option<String>,
    body: Vec<u8>,
}

pub fn request(
    quota: &quota::Quota,
    diagnostics: &Diagnostics,
    client: &Client,
    base: &str,
    token: &str,
    reads: &[Read],
) -> Result<Vec<Result<Value>>> {
    let cost: f64 = reads.iter().map(|r| quota::cost(&r.path)).sum();
    if reads.is_empty() || reads.len() > LABEL_LIMIT || cost > 400.0 {
        return Err(Error::new("invalid", "Invalid Gmail batch size"));
    }
    let started = Instant::now();
    if let Err(error) = quota.acquire_cost(cost) {
        for read in reads {
            diagnostics.request(
                &read.path,
                None,
                &Err(error.clone()),
                (started.elapsed(), started.elapsed()),
                None,
                false,
            );
        }
        return Err(error);
    }
    let wait = started.elapsed();
    let mut status = None;
    let mut reason = None;
    let result = (|| {
        let mut endpoint =
            url::Url::parse(base).map_err(|_| Error::new("invalid", "Invalid Gmail endpoint"))?;
        // Gmail's discovery document specifies rootUrl + batchPath = /batch.
        endpoint.set_path("/batch");
        endpoint.set_query(None);
        let boundary = format!("zusteller_{:x}", rand::random::<u64>());
        let body = encode(base, reads, &boundary)?;
        diagnostics.event("batch", "sent", Some(reads.len()));
        let mut response = client
            .post(endpoint)
            .bearer_auth(token)
            .header(
                "Content-Type",
                format!("multipart/mixed; boundary={boundary}"),
            )
            .body(body)
            .send()
            .map_err(|_| {
                Error::new(
                    "offline",
                    "Gmail is offline. Cached mail is still available.",
                )
            })?;
        status = Some(response.status().as_u16());
        if !response.status().is_success() {
            let mut bytes = Vec::new();
            let _ = response.by_ref().take(64 * 1024).read_to_end(&mut bytes);
            let (mut error, recognized) = api::response_error(
                status.unwrap(),
                &bytes,
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
            return Err(Error::new("invalid", "Gmail batch response is too large"));
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let mut bytes = Vec::new();
        response
            .by_ref()
            .take(MAX_RESPONSE + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| Error::new("offline", "Gmail batch response was interrupted"))?;
        if bytes.len() as u64 > MAX_RESPONSE {
            return Err(Error::new("invalid", "Gmail batch response is too large"));
        }
        decode(&content_type, &bytes, reads.len())
    })();
    match result {
        Ok(parts) => Ok(parts
            .into_iter()
            .zip(reads)
            .map(|(part, read)| {
                let mut reason = None;
                let result = if (200..300).contains(&part.status) {
                    serde_json::from_slice(&part.body)
                        .map_err(|_| Error::new("invalid", "Invalid Gmail response"))
                } else {
                    let (mut error, recognized) = api::response_error(
                        part.status,
                        &part.body[..part.body.len().min(64 * 1024)],
                        part.retry_after.as_deref(),
                    );
                    reason = recognized;
                    if error.code == "rate_limit" {
                        quota.limited(&mut error);
                    }
                    Err(error)
                };
                diagnostics.request(
                    &read.path,
                    Some(part.status),
                    &result,
                    (started.elapsed(), wait),
                    reason.as_deref(),
                    true,
                );
                result
            })
            .collect()),
        Err(error) => {
            for read in reads {
                diagnostics.request(
                    &read.path,
                    status,
                    &Err(error.clone()),
                    (started.elapsed(), wait),
                    reason.as_deref(),
                    true,
                );
            }
            Err(error)
        }
    }
}

fn encode(base: &str, reads: &[Read], boundary: &str) -> Result<String> {
    let base =
        url::Url::parse(base).map_err(|_| Error::new("invalid", "Invalid Gmail endpoint"))?;
    let mut body = String::new();
    for (i, read) in reads.iter().enumerate() {
        let mut url = base
            .join(&read.path)
            .map_err(|_| Error::new("invalid", "Invalid Gmail request path"))?;
        if !read.params.is_empty() {
            url.query_pairs_mut()
                .extend_pairs(read.params.iter().map(|(k, v)| (*k, v)));
        }
        let query = url.query().map(|q| format!("?{q}")).unwrap_or_default();
        body.push_str(&format!("--{boundary}\r\nContent-Type: application/http\r\nContent-ID: <item-{i}>\r\n\r\nGET {}{query} HTTP/1.1\r\nAccept: application/json\r\n\r\n", url.path()));
    }
    body.push_str(&format!("--{boundary}--\r\n"));
    Ok(body)
}

fn decode(content_type: &str, bytes: &[u8], count: usize) -> Result<Vec<Part>> {
    let invalid = || Error::new("invalid", "Invalid Gmail batch response");
    // Reuse the existing MIME parser; do not split on strings that may appear
    // inside JSON. Content IDs correlate every part, rejecting omissions/duplicates.
    let mut mime = format!("Content-Type: {content_type}\r\n\r\n").into_bytes();
    mime.extend_from_slice(bytes);
    let parsed = mailparse::parse_mail(&mime).map_err(|_| invalid())?;
    if parsed.ctype.mimetype != "multipart/mixed" || parsed.subparts.len() != count {
        return Err(invalid());
    }
    let boundary = parsed.ctype.params.get("boundary").ok_or_else(invalid)?;
    let closing = format!("--{boundary}--");
    if !bytes
        .split(|&b| b == b'\n')
        .any(|line| line.strip_suffix(b"\r").unwrap_or(line) == closing.as_bytes())
    {
        return Err(invalid());
    }
    let mut parts: Vec<Option<Part>> = (0..count).map(|_| None).collect();
    for part in parsed.subparts {
        if part.ctype.mimetype != "application/http" {
            return Err(invalid());
        }
        let id = part
            .headers
            .get_first_value("Content-ID")
            .ok_or_else(invalid)?;
        let index: usize = id
            .trim()
            .strip_prefix("<response-item-")
            .and_then(|v| v.strip_suffix('>'))
            .and_then(|v| v.parse().ok())
            .filter(|&i| i < count)
            .ok_or_else(invalid)?;
        if parts[index].is_some() {
            return Err(invalid());
        }
        let raw = part.get_body_raw().map_err(|_| invalid())?;
        let line_end = raw
            .windows(2)
            .position(|v| v == b"\r\n")
            .ok_or_else(invalid)?;
        let line = std::str::from_utf8(&raw[..line_end]).map_err(|_| invalid())?;
        let mut fields = line.split_whitespace();
        if fields.next() != Some("HTTP/1.1") {
            return Err(invalid());
        }
        let status = fields
            .next()
            .and_then(|v| v.parse::<u16>().ok())
            .filter(|s| (100..600).contains(s))
            .ok_or_else(invalid)?;
        let tail = &raw[line_end + 2..];
        let (headers, offset) = mailparse::parse_headers(tail).map_err(|_| invalid())?;
        parts[index] = Some(Part {
            status,
            retry_after: headers.get_first_value("Retry-After"),
            body: tail[offset..].to_vec(),
        });
    }
    parts.into_iter().map(|p| p.ok_or_else(invalid)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(id: usize, status: u16, body: &str, headers: &str) -> String {
        format!("--reply\r\nContent-Type: application/http\r\nContent-ID: <response-item-{id}>\r\n\r\nHTTP/1.1 {status} Test\r\nContent-Type: application/json\r\n{headers}\r\n{body}\r\n")
    }

    #[test]
    fn nested_gets_encode_query_and_ids_without_credentials_or_absolute_urls() {
        let reads = vec![
            Read::new(
                format!("threads/{}", api::segment("a/b")),
                vec![("fields", "id,messages(id)".into())],
            ),
            Read::new("labels/INBOX".into(), vec![]),
        ];
        let body = encode(
            "https://gmail.googleapis.com/gmail/v1/users/me/",
            &reads,
            "test",
        )
        .unwrap();
        assert!(body.contains(
            "GET /gmail/v1/users/me/threads/a%2Fb?fields=id%2Cmessages%28id%29 HTTP/1.1"
        ));
        assert!(body.contains("GET /gmail/v1/users/me/labels/INBOX HTTP/1.1"));
        assert!(!body.contains("https://"));
        assert!(!body.contains("Authorization"));
        assert_eq!(body.matches("Content-ID:").count(), 2);
    }

    #[test]
    fn multipart_responses_correlate_reordered_ids_and_retain_individual_status_and_retry() {
        let body = format!(
            "{}{}--reply--\r\n",
            part(
                1,
                429,
                r#"{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}"#,
                "Retry-After: 120\r\n"
            ),
            part(0, 200, r#"{"id":"a"}"#, "")
        );
        let parts = decode("multipart/mixed; boundary=\"reply\"", body.as_bytes(), 2).unwrap();
        assert_eq!(parts[0].status, 200);
        assert_eq!(
            serde_json::from_slice::<Value>(&parts[0].body).unwrap()["id"],
            "a"
        );
        assert_eq!(parts[1].status, 429);
        assert_eq!(parts[1].retry_after.as_deref(), Some("120"));
    }

    #[test]
    fn missing_duplicate_unknown_or_malformed_parts_are_rejected() {
        let good = part(0, 200, "{}", "");
        for body in [
            format!("{good}--reply--\r\n"),
            format!("{good}{good}--reply--\r\n"),
            format!("{good}{}--reply--\r\n", part(2, 200, "{}", "")),
            format!(
                "{good}{}--reply--\r\n",
                part(1, 200, "{}", "").replace("HTTP/1.1 200", "invalid")
            ),
        ] {
            assert_eq!(
                decode("multipart/mixed; boundary=reply", body.as_bytes(), 2)
                    .err()
                    .unwrap()
                    .code,
                "invalid"
            );
        }
        assert!(decode("application/json", b"{}", 1).is_err());
        let truncated = format!("{good}{}", part(1, 200, "{}", ""));
        assert!(decode("multipart/mixed; boundary=reply", truncated.as_bytes(), 2).is_err());
    }

    #[test]
    fn inner_and_outer_rate_limits_stop_all_later_requests_and_account_each_call() {
        use std::{
            io::{Read as _, Write},
            net::TcpListener,
            time::Duration,
        };
        for outer in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let base = format!(
                "http://{}/gmail/v1/users/me/",
                listener.local_addr().unwrap()
            );
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut chunk = [0; 4096];
                loop {
                    let n = socket.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                    if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let length: usize = headers
                            .lines()
                            .find_map(|line| {
                                line.split_once(':')
                                    .filter(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                                    .map(|(_, v)| v.trim().parse().unwrap())
                            })
                            .unwrap();
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let received = String::from_utf8(bytes).unwrap();
                assert!(received.starts_with("POST /batch HTTP/1.1"));
                assert!(
                    received.contains("Authorization: Bearer fixture-only")
                        || received.contains("authorization: Bearer fixture-only")
                );
                assert_eq!(
                    received.matches("GET /gmail/v1/users/me/threads/").count(),
                    2
                );
                let reason = r#"{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}"#;
                let (status, content_type, body) = if outer {
                    (429, "application/json", reason.to_string())
                } else {
                    (
                        200,
                        "multipart/mixed; boundary=reply",
                        format!(
                            "{}{}--reply--\r\n",
                            part(1, 429, reason, "Retry-After: 120\r\n"),
                            part(0, 200, "{}", "")
                        ),
                    )
                };
                write!(socket, "HTTP/1.1 {status} Test\r\nContent-Type: {content_type}\r\nRetry-After: 120\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            let quota = quota::Quota::default();
            let diagnostics = Diagnostics::default();
            let reads = vec![
                Read::new("threads/a".into(), vec![]),
                Read::new("threads/b".into(), vec![]),
            ];
            let client = Client::new();
            let result = request(&quota, &diagnostics, &client, &base, "fixture-only", &reads);
            if outer {
                assert_eq!(result.unwrap_err().retry_after, Some(120));
            } else {
                let responses = result.unwrap();
                assert!(responses[0].is_ok());
                assert_eq!(responses[1].as_ref().unwrap_err().retry_after, Some(120));
            }
            assert_eq!(quota.acquire("profile").unwrap_err().code, "rate_limit");
            let log = serde_json::to_value(diagnostics.snapshot()).unwrap();
            assert_eq!(log["requests"], 2);
            assert_eq!(log["quotaUnits"], 80);
            assert_eq!(log["rateLimits"], if outer { 2 } else { 1 });
            assert_eq!(log["entries"][0]["operation"], "batch");
            server.join().unwrap();
        }
    }
}
