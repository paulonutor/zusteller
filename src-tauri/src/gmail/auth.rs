use super::{Error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri_plugin_opener::OpenerExt;

pub const SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SERVICE: &str = "de.onutor.zusteller.gmail";

#[derive(Clone, Deserialize, Serialize)]
pub struct Credentials {
    pub client_id: String,
    pub client_secret: String,
}
#[derive(Deserialize)]
struct ClientFile {
    installed: Credentials,
}
#[derive(Deserialize, Serialize)]
pub struct Grant {
    pub credentials: Credentials,
    pub refresh_token: String,
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
    scope: Option<String>,
}
pub struct Access {
    pub token: String,
    pub expires: Instant,
}

fn random() -> String {
    let mut bytes = [0; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| Error::new("invalid", "Could not create Gmail connection"))
}

fn exchange(client: &Client, params: &[(&str, &str)]) -> Result<TokenResponse> {
    exchange_at(client, TOKEN_URL, params)
}
fn exchange_at(client: &Client, endpoint: &str, params: &[(&str, &str)]) -> Result<TokenResponse> {
    let response = client
        .post(endpoint)
        .form(params)
        .send()
        .map_err(|_| Error::new("offline", "Could not reach Google. Check your connection."))?;
    if !response.status().is_success() {
        // Never include OAuth response bodies, codes, credentials or tokens in errors.
        return Err(Error::new(
            "auth",
            "Google access expired or was denied. Connect Gmail again.",
        ));
    }
    response
        .json()
        .map_err(|_| Error::new("auth", "Google returned an invalid authorization response"))
}

fn access(response: &TokenResponse) -> Access {
    Access {
        token: response.access_token.clone(),
        expires: Instant::now() + Duration::from_secs(response.expires_in.saturating_sub(60)),
    }
}

pub fn refresh(grant: &Grant) -> Result<Access> {
    refresh_at(grant, TOKEN_URL)
}
fn refresh_at(grant: &Grant, endpoint: &str) -> Result<Access> {
    let response = exchange_at(
        &client()?,
        endpoint,
        &[
            ("client_id", &grant.credentials.client_id),
            ("client_secret", &grant.credentials.client_secret),
            ("refresh_token", &grant.refresh_token),
            ("grant_type", "refresh_token"),
        ],
    )?;
    Ok(access(&response))
}

pub fn load(account: &str) -> Result<Grant> {
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|_| Error::new("auth", "macOS Keychain is unavailable"))?;
    let value = entry.get_password().map_err(|error| {
        if matches!(error, keyring::Error::NoEntry) {
            return Error::new(
                "auth",
                "No saved Gmail credentials in Keychain. Connect again.",
            );
        }
        Error::new(
            "auth",
            "Could not read Gmail credentials from Keychain. Connect again.",
        )
    })?;
    serde_json::from_str(&value).map_err(|_| {
        Error::new(
            "auth",
            "Saved Gmail credentials are invalid. Connect again.",
        )
    })
}
pub fn save(account: &str, grant: &Grant) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|_| Error::new("auth", "macOS Keychain is unavailable"))?;
    save_entry(&entry, grant)
}
fn save_entry(entry: &keyring::Entry, grant: &Grant) -> Result<()> {
    entry
        .set_password(
            &serde_json::to_string(grant)
                .map_err(|_| Error::new("auth", "Could not save Gmail credentials"))?,
        )
        .map_err(|_| {
            Error::new(
                "auth",
                "Could not save Gmail credentials in Keychain. Connection was not saved.",
            )
        })
}
pub fn remove(account: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|_| Error::new("auth", "macOS Keychain is unavailable"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(Error::new(
            "auth",
            "Could not remove Gmail credentials from Keychain",
        )),
    }
}

pub fn authorize(
    app: &tauri::AppHandle,
    path: &std::path::Path,
    cancelled: &AtomicBool,
) -> Result<(Grant, Access)> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|f| f.take(64 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|_| Error::new("invalid", "Could not read the OAuth client file"))?;
    if bytes.len() > 64 * 1024 {
        return Err(Error::new("invalid", "OAuth client file is too large"));
    }
    let file: ClientFile = serde_json::from_slice(&bytes).map_err(|_| {
        Error::new(
            "invalid",
            "Choose a Google Desktop app OAuth client JSON file",
        )
    })?;
    if !file
        .installed
        .client_id
        .ends_with(".apps.googleusercontent.com")
        || file.installed.client_secret.is_empty()
    {
        return Err(Error::new(
            "invalid",
            "Invalid Google Desktop app OAuth client",
        ));
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| Error::new("auth", "Could not open the sign-in callback"))?;
    listener
        .set_nonblocking(true)
        .map_err(|_| Error::new("auth", "Could not open the sign-in callback"))?;
    let redirect = format!(
        "http://127.0.0.1:{}/oauth/callback",
        listener.local_addr().unwrap().port()
    );
    let verifier = random();
    let state = random();
    let challenge = pkce_challenge(&verifier);
    let mut url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", file.installed.client_id.as_str()),
        ("redirect_uri", &redirect),
        ("response_type", "code"),
        ("scope", SCOPE),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("code_challenge_method", "S256"),
        ("code_challenge", &challenge),
        ("state", &state),
    ]);
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| Error::new("auth", "Could not open your browser for Google sign-in"))?;
    let code = receive_callback(listener, &state, cancelled, Duration::from_secs(180))?;
    if cancelled.load(Ordering::SeqCst) {
        return Err(Error::new("cancelled", "Gmail connection cancelled"));
    }
    let response = exchange(
        &client()?,
        &[
            ("client_id", &file.installed.client_id),
            ("client_secret", &file.installed.client_secret),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
            ("grant_type", "authorization_code"),
        ],
    )?;
    if response
        .scope
        .as_ref()
        .is_some_and(|s| !s.split_whitespace().any(|s| s == SCOPE))
    {
        return Err(Error::new(
            "auth",
            "Google did not grant read-only Gmail access",
        ));
    }
    let refresh_token = response.refresh_token.clone().ok_or_else(|| {
        Error::new(
            "auth",
            "Google did not issue a refresh token. Try connecting again.",
        )
    })?;
    Ok((
        Grant {
            credentials: file.installed,
            refresh_token,
        },
        access(&response),
    ))
}

fn callback(url: &url::Url, expected: &str) -> Result<String> {
    let pairs: std::collections::HashMap<_, _> = url.query_pairs().collect();
    if pairs.get("state").map(|s| s.as_ref()) != Some(expected) {
        return Err(Error::new(
            "auth",
            "Google sign-in state did not match. Try again.",
        ));
    }
    if pairs.contains_key("error") {
        return Err(Error::new("auth", "Google sign-in was denied"));
    }
    pairs
        .get("code")
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| Error::new("auth", "Google sign-in returned no code"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checks_state_and_denial_without_exposing_values() {
        let u = url::Url::parse("http://127.0.0.1/oauth/callback?state=wrong&code=secret").unwrap();
        let e = callback(&u, "expected").unwrap_err();
        assert!(!e.message.contains("secret"));
        assert!(e.message.contains("state"));
        let u = url::Url::parse("http://127.0.0.1/oauth/callback?state=ok&error=access_denied")
            .unwrap();
        assert!(callback(&u, "ok").is_err());
        let u = url::Url::parse("http://127.0.0.1/oauth/callback?state=ok&code=received").unwrap();
        assert_eq!(callback(&u, "ok").unwrap(), "received");
    }
}

#[cfg(test)]
mod keychain_tests {
    use super::*;
    #[test]
    fn keychain_failure_is_redacted_and_never_falls_back_to_disk() {
        let entry =
            keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        let mock: &keyring::mock::MockCredential = entry.get_credential().downcast_ref().unwrap();
        mock.set_error(keyring::Error::Invalid(
            "private-value".into(),
            "private-token".into(),
        ));
        let grant = Grant {
            credentials: Credentials {
                client_id: "client".into(),
                client_secret: "private-secret".into(),
            },
            refresh_token: "private-refresh".into(),
        };
        let error = save_entry(&entry, &grant).unwrap_err();
        let serialized = serde_json::to_string(&error).unwrap();
        assert!(!serialized.contains("private"));
        assert!(entry.get_password().is_err());
        save_entry(&entry, &grant).unwrap();
        let loaded: Grant = serde_json::from_str(&entry.get_password().unwrap()).unwrap();
        assert_eq!(loaded.refresh_token, "private-refresh");
        entry.delete_credential().unwrap();
        assert!(entry.get_password().is_err());
    }
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn receive_callback(
    listener: TcpListener,
    state: &str,
    cancelled: &AtomicBool,
    timeout: Duration,
) -> Result<String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| Error::new("auth", "Could not open the sign-in callback"))?;
    let deadline = Instant::now() + timeout;
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(Error::new("cancelled", "Gmail connection cancelled"));
        }
        if Instant::now() >= deadline {
            return Err(Error::new("auth", "Google sign-in timed out. Try again."));
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
                stream.set_write_timeout(Some(Duration::from_secs(2))).ok();
                let mut bytes = Vec::new();
                let mut buffer = [0; 1024];
                while bytes.len() < 8192 && !bytes.windows(2).any(|w| w == b"\r\n") {
                    match stream.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => bytes.extend_from_slice(&buffer[..n]),
                    }
                }
                let request = String::from_utf8_lossy(&bytes);
                let first = request.lines().next().unwrap_or("");
                let target = first
                    .strip_prefix("GET ")
                    .and_then(|s| s.split_once(' ').map(|p| p.0));
                let parsed =
                    target.and_then(|s| url::Url::parse(&format!("http://127.0.0.1{s}")).ok());
                let result = parsed
                    .as_ref()
                    .filter(|u| u.path() == "/oauth/callback")
                    .map(|u| callback(u, &state));
                let body = if matches!(result, Some(Ok(_))) {
                    "Google sign-in received. Return to Zusteller."
                } else {
                    "Sign-in callback rejected. Return to Zusteller."
                };
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                if let Some(result) = result {
                    return result;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(_) => return Err(Error::new("auth", "Google sign-in callback failed")),
        }
    }
}

#[cfg(test)]
mod protocol_tests {
    use super::*;
    use std::net::TcpStream;

    #[test]
    fn pkce_matches_the_standard_s256_vector() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn loopback_receives_a_split_callback_and_releases_the_port() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let browser = std::thread::spawn(move || {
            let mut s = TcpStream::connect(address).unwrap();
            s.write_all(b"GET /oauth/callback?state=expected&code=")
                .unwrap();
            std::thread::sleep(Duration::from_millis(10));
            s.write_all(b"received HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .unwrap();
            let mut response = String::new();
            s.read_to_string(&mut response).unwrap();
            assert!(response.contains("Return to Zusteller"));
            assert!(!response.contains("received HTTP"));
        });
        assert_eq!(
            receive_callback(
                listener,
                "expected",
                &AtomicBool::new(false),
                Duration::from_secs(3)
            )
            .unwrap(),
            "received"
        );
        browser.join().unwrap();
        assert!(TcpStream::connect(address).is_err());
    }
    #[test]
    fn cancellation_and_timeout_close_the_callback_listener() {
        for cancelled in [true, false] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let error = receive_callback(
                listener,
                "expected",
                &AtomicBool::new(cancelled),
                Duration::ZERO,
            )
            .unwrap_err();
            assert_eq!(error.code, if cancelled { "cancelled" } else { "auth" });
            assert!(TcpStream::connect(address).is_err());
        }
    }
    fn token_endpoint(
        status: u16,
        response: serde_json::Value,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/token", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            use std::io::BufRead;
            let (mut s, _) = listener.accept().unwrap();
            s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut r = std::io::BufReader::new(&mut s);
            let mut first = String::new();
            r.read_line(&mut first).unwrap();
            assert!(first.starts_with("POST /token "));
            let mut length = 0;
            loop {
                let mut line = String::new();
                r.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    if name.eq_ignore_ascii_case("content-length") {
                        length = value.trim().parse().unwrap();
                    }
                }
            }
            let mut body = vec![0; length];
            r.read_exact(&mut body).unwrap();
            drop(r);
            let json = response.to_string();
            write!(s,"HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{json}",json.len()).unwrap();
            String::from_utf8(body).unwrap()
        });
        (endpoint, server)
    }
    #[test]
    fn refresh_exchanges_the_native_grant_without_exposing_tokens() {
        let (endpoint, server) = token_endpoint(
            200,
            serde_json::json!({"access_token":"fixture-access", "expires_in":3600}),
        );
        let grant = Grant {
            credentials: Credentials {
                client_id: "fixture-client".into(),
                client_secret: "fixture-secret".into(),
            },
            refresh_token: "fixture-refresh".into(),
        };
        let access = refresh_at(&grant, &endpoint).unwrap();
        assert_eq!(access.token, "fixture-access");
        assert!(access.expires > Instant::now());
        let body = server.join().unwrap();
        let params: std::collections::HashMap<_, _> =
            url::form_urlencoded::parse(body.as_bytes()).collect();
        assert_eq!(params.get("grant_type").unwrap(), "refresh_token");
        assert_eq!(params.get("refresh_token").unwrap(), "fixture-refresh");
    }
    #[test]
    fn revoked_refresh_is_a_redacted_reauthentication_error() {
        let (endpoint, server) = token_endpoint(
            400,
            serde_json::json!({"error":"invalid_grant","error_description":"private-value"}),
        );
        let grant = Grant {
            credentials: Credentials {
                client_id: "fixture-client".into(),
                client_secret: "fixture-secret".into(),
            },
            refresh_token: "fixture-refresh".into(),
        };
        let error = match refresh_at(&grant, &endpoint) {
            Err(e) => e,
            Ok(_) => panic!("revoked grant was accepted"),
        };
        assert_eq!(error.code, "auth");
        assert!(!error.message.contains("private"));
        server.join().unwrap();
    }
}
