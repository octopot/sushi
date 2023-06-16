//! Signing in to OpenRouter in the browser with OAuth PKCE (docs/specs/model.md, MD-14): the user
//! approves on openrouter.ai, the browser comes back to a one-time address on this Mac, and Sushi
//! exchanges the code for a key on the user's own account. The user copies no key.

use serde_json::{json, Value};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

/// How long Sushi waits for the browser; closing the tab ends the wait here (MD-14).
pub const WAIT: Duration = Duration::from_secs(300);
pub const AUTH: &str = "https://openrouter.ai/auth";

extern "C" {
    fn CC_SHA256(data: *const u8, len: u32, md: *mut u8) -> *mut u8;
    fn arc4random_buf(buf: *mut u8, nbytes: usize);
}

pub(crate) fn sha256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    unsafe { CC_SHA256(data.as_ptr(), data.len() as u32, out.as_mut_ptr()) };
    out
}

/// Base64 with the URL alphabet and no padding (RFC 4648 §5), as PKCE wants.
pub fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..=chunk.len() {
            out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

pub fn random(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    unsafe { arc4random_buf(buffer.as_mut_ptr(), buffer.len()) };
    base64url(&buffer)
}

/// The verifier stays in Sushi; the challenge goes to the browser.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    pub fn new() -> Self {
        Self::from_verifier(random(32))
    }
    pub fn from_verifier(verifier: String) -> Self {
        let challenge = base64url(&sha256(verifier.as_bytes()));
        Self {
            verifier,
            challenge,
        }
    }
}

fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn decode(text: &str) -> String {
    let hex = |b: u8| (b as char).to_digit(16);
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let pair = (bytes[i] == b'%')
            .then(|| Some((hex(*bytes.get(i + 1)?)?, hex(*bytes.get(i + 2)?)?)))
            .flatten();
        match (bytes[i], pair) {
            (b'%', Some((high, low))) => {
                out.push((high * 16 + low) as u8);
                i += 3;
                continue;
            }
            (b'+', _) => out.push(b' '),
            (b, _) => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The page the browser opens: sign in and approve a key for Sushi.
pub fn auth_url(callback: &str, challenge: &str) -> String {
    format!(
        "{AUTH}?callback_url={}&code_challenge={challenge}&code_challenge_method=S256",
        encode(callback)
    )
}

/// One parameter of a request line's query, decoded.
fn query(target: &str, name: &str) -> Option<String> {
    let (_, query) = target.split_once('?')?;
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        (key == name).then(|| decode(value))
    })
}

const PAGE: &str = "<!doctype html><meta charset=utf-8><title>Sushi</title>\
<body style=\"font: 15px -apple-system, sans-serif; margin: 4em auto; max-width: 30em\"><h1>{title}</h1><p>{text}</p>";

fn page(title: &str, text: &str) -> String {
    let body = PAGE.replace("{title}", title).replace("{text}", text);
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    )
}

/// Reads until the request line is complete: TCP may deliver it in several pieces, and a code cut
/// in half would fail the exchange. `None` for a connection that closes first or sends 8 KB
/// without a line end.
async fn request_line(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut head = Vec::new();
    let mut chunk = [0u8; 1024];
    while !head.windows(2).any(|w| w == b"\r\n") {
        if head.len() > 8192 {
            return None;
        }
        let count = stream.read(&mut chunk).await.ok()?;
        if count == 0 {
            return None;
        }
        head.extend_from_slice(&chunk[..count]);
    }
    Some(String::from_utf8_lossy(&head).into_owned())
}

/// Waits for the browser at `/callback/<nonce>` and returns the code. Requests for other paths
/// (a favicon, a guess at the port) get a 404 and do not end the wait.
pub async fn wait_for_code(
    listener: TcpListener,
    nonce: &str,
    wait: Duration,
) -> Result<String, String> {
    let path = format!("/callback/{nonce}");
    let accept = async {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                continue;
            };
            let Ok(Some(head)) =
                tokio::time::timeout(Duration::from_secs(5), request_line(&mut stream)).await
            else {
                continue;
            };
            let target = head
                .lines()
                .next()
                .and_then(|line| line.strip_prefix("GET "))
                .and_then(|rest| rest.split(' ').next())
                .unwrap_or("")
                .to_string();
            if target.split('?').next() != Some(path.as_str()) {
                let _ = stream
                    .write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await;
                continue;
            }
            let result = match query(&target, "code").filter(|c| !c.is_empty()) {
                Some(code) => {
                    let _ = stream
                        .write_all(
                            page(
                                "Sushi is connecting to OpenRouter",
                                "You can close this tab and go back to Sushi.",
                            )
                            .as_bytes(),
                        )
                        .await;
                    Ok(code)
                }
                None => {
                    let _ = stream
                        .write_all(
                            page(
                                "OpenRouter did not approve the key",
                                "Sushi keeps the model it used before. You can close this tab.",
                            )
                            .as_bytes(),
                        )
                        .await;
                    Err("OpenRouter did not approve a key for Sushi.".to_string())
                }
            };
            return result;
        }
    };
    tokio::time::timeout(wait, accept)
        .await
        .unwrap_or_else(|_| Err("The browser did not come back to Sushi in 5 minutes.".into()))
}

/// Exchanges the code for a key (POST /api/v1/auth/keys).
pub async fn exchange(api: &str, code: &str, verifier: &str) -> Result<String, String> {
    let client = crate::hosted::client()?;
    let response = client
        .post(format!("{api}/auth/keys"))
        .json(&json!({"code": code, "code_verifier": verifier, "code_challenge_method": "S256"}))
        .send()
        .await
        .map_err(|_| "OpenRouter is not reachable, so the sign-in could not finish.".to_string())?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    match body.get("key").and_then(Value::as_str) {
        Some(key) if status.is_success() && crate::keychain::plausible(key) => Ok(key.to_string()),
        _ => Err(format!(
            "OpenRouter did not give a key for this sign-in (error {}).",
            status.as_u16()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_the_challenge_of_rfc_7636() {
        // The example of RFC 7636, appendix B.
        let pkce = Pkce::from_verifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into());
        assert_eq!(
            pkce.challenge,
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let fresh = Pkce::new();
        assert_eq!(fresh.verifier.len(), 43);
        assert_ne!(fresh.verifier, Pkce::new().verifier);
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
    }

    #[test]
    fn builds_the_address_and_reads_the_callback() {
        assert_eq!(
            auth_url("http://127.0.0.1:5123/callback/n", "abc"),
            "https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A5123%2Fcallback%2Fn&code_challenge=abc&code_challenge_method=S256"
        );
        assert_eq!(
            query("/callback/n?code=a%2Bb-c", "code").as_deref(),
            Some("a+b-c")
        );
        assert_eq!(query("/callback/n?error=denied", "code"), None);
        assert_eq!(decode("%E2%9C%93%"), "✓%");
        assert_eq!(decode("%Ж1"), "%Ж1", "no panic on a multibyte character");
    }

    async fn get(port: u16, path: &str) -> String {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        stream
            .write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).await.unwrap();
        reply
    }

    #[tokio::test]
    async fn waits_for_its_own_callback() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiting =
            tokio::spawn(
                async move { wait_for_code(listener, "nonce", Duration::from_secs(5)).await },
            );
        assert!(get(port, "/favicon.ico").await.starts_with("HTTP/1.1 404"));
        assert!(get(port, "/callback/other?code=x")
            .await
            .starts_with("HTTP/1.1 404"));
        let page = get(port, "/callback/nonce?code=the-code").await;
        assert!(page.contains("close this tab"));
        assert_eq!(waiting.await.unwrap(), Ok("the-code".into()));

        // A request line that arrives in two pieces still gives the whole code.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiting =
            tokio::spawn(async move { wait_for_code(listener, "n", Duration::from_secs(5)).await });
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        stream.write_all(b"GET /callback/n?code=abc").await.unwrap();
        stream.flush().await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        stream
            .write_all(b"def HTTP/1.1\r\nHost: x\r\n\r\n")
            .await
            .unwrap();
        assert_eq!(waiting.await.unwrap(), Ok("abcdef".into()));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiting =
            tokio::spawn(async move { wait_for_code(listener, "n", Duration::from_secs(5)).await });
        get(port, "/callback/n?error=access_denied").await;
        assert_eq!(
            waiting.await.unwrap(),
            Err("OpenRouter did not approve a key for Sushi.".into())
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        assert_eq!(
            wait_for_code(listener, "n", Duration::from_millis(50)).await,
            Err("The browser did not come back to Sushi in 5 minutes.".into())
        );
    }

    #[tokio::test]
    async fn exchanges_the_code_for_a_key() {
        let (api, received) =
            crate::hosted::tests::serve_once(200, r#"{"key":"sk-or-v1-fresh","user_id":"u"}"#);
        assert_eq!(
            exchange(&api, "c0de", "verifier").await.as_deref(),
            Ok("sk-or-v1-fresh")
        );
        let (head, body) = received.recv().unwrap();
        assert!(head.starts_with("POST /v1/auth/keys "));
        assert_eq!(
            serde_json::from_str::<Value>(&body).unwrap(),
            json!({"code": "c0de", "code_verifier": "verifier", "code_challenge_method": "S256"})
        );
        let (api, _r) =
            crate::hosted::tests::serve_once(400, r#"{"error":{"message":"Invalid code"}}"#);
        assert_eq!(
            exchange(&api, "c", "v").await,
            Err("OpenRouter did not give a key for this sign-in (error 400).".into())
        );
    }
}
