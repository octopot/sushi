//! An edit through OpenRouter (docs/specs/model.md, MD-4 to MD-7).

use crate::model::OpenRouter;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::json;
use std::{sync::LazyLock, time::Duration};

pub const API: &str = "https://openrouter.ai/api/v1";
/// Every OpenRouter failure ends with this phrase; the page turns it into a button (MD-6).
pub const EDIT_WITH_OLLAMA: &str = " Edit with Ollama";
pub const UNREACHABLE: &str = "OpenRouter is not reachable.";
pub const REJECTED_KEY: &str = "OpenRouter did not accept the key in model.json.";
pub const NO_CREDITS: &str = "OpenRouter: the account is out of credits.";
pub const BUSY: &str = "OpenRouter is busy right now.";
const CUT_OFF: &str = "The model reached its context limit. Select a shorter passage.";

static CLIENT: LazyLock<Result<Client, String>> = LazyLock::new(|| {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
});

#[derive(Deserialize)]
struct Reply {
    choices: Option<Vec<Choice>>,
    error: Option<Problem>,
}
#[derive(Deserialize)]
struct Choice {
    message: Option<Message>,
    finish_reason: Option<String>,
}
#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}
#[derive(Deserialize)]
struct Problem {
    message: Option<String>,
}

/// A failure the page offers to repeat with Ollama. The key never appears in it (MD-5).
fn failure(status: Option<StatusCode>, detail: Option<&str>, key: &str) -> String {
    let message = match status.map(|s| s.as_u16()) {
        None => UNREACHABLE.to_string(),
        Some(401 | 403) => REJECTED_KEY.to_string(),
        Some(402) => NO_CREDITS.to_string(),
        Some(429) => BUSY.to_string(),
        Some(code) => {
            let detail = detail
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map_or_else(|| format!("error {code}"), str::to_string)
                .replace(key, "…");
            let detail: String = detail.trim_end_matches('.').chars().take(200).collect();
            format!("OpenRouter: {detail}.")
        }
    };
    message + EDIT_WITH_OLLAMA
}

/// Sends one edit: Sushi's system instruction and the user message, nothing else (MD-4).
pub async fn edit(
    api: &str,
    settings: &OpenRouter,
    system: &str,
    content: &str,
) -> Result<String, String> {
    let client = CLIENT.as_ref().map_err(Clone::clone)?;
    let mut body = json!({
        "model": settings.model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content}
        ],
        "reasoning": {"exclude": true},
        "provider": {"data_collection": "deny"},
    });
    if let Some(effort) = &settings.reasoning {
        body["reasoning"]["effort"] = json!(effort);
    }
    if let Some(tier) = &settings.tier {
        body["service_tier"] = json!(tier);
    }
    let response = client
        .post(format!("{api}/chat/completions"))
        .bearer_auth(&settings.key)
        .header("X-Title", "Sushi")
        .header("HTTP-Referer", "https://sushi.octolab.org/")
        .json(&body)
        .send()
        .await
        .map_err(|_| failure(None, None, &settings.key))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|_| failure(None, None, &settings.key))?;
    let reply: Option<Reply> = serde_json::from_str(&text).ok();
    let problem = reply
        .as_ref()
        .and_then(|r| r.error.as_ref())
        .and_then(|e| e.message.as_deref());
    if !status.is_success() || problem.is_some() {
        let status = if status.is_success() {
            StatusCode::BAD_GATEWAY
        } else {
            status
        };
        return Err(failure(Some(status), problem, &settings.key));
    }
    let choice = reply
        .and_then(|r| r.choices)
        .and_then(|c| c.into_iter().next());
    if choice.as_ref().and_then(|c| c.finish_reason.as_deref()) == Some("length") {
        return Err(CUT_OFF.into());
    }
    choice
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            failure(
                Some(StatusCode::BAD_GATEWAY),
                Some("the model returned an empty response"),
                &settings.key,
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        sync::mpsc,
    };

    fn settings(reasoning: Option<&str>, tier: Option<&str>) -> OpenRouter {
        OpenRouter {
            key: "sk-or-v1-secret".into(),
            model: "openai/gpt-6-luna".into(),
            reasoning: reasoning.map(Into::into),
            tier: tier.map(Into::into),
        }
    }

    /// Answers one request with `status` and `body`, and hands back what it received.
    fn serve_once(status: u16, body: &'static str) -> (String, mpsc::Receiver<(String, String)>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let api = format!("http://{}/api/v1", listener.local_addr().unwrap());
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                head.push_str(&line);
            }
            let length = head
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            let mut request = vec![0; length];
            reader.read_exact(&mut request).unwrap();
            let mut stream = stream;
            write!(
                stream,
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            send.send((head, String::from_utf8(request).unwrap()))
                .unwrap();
        });
        (api, receive)
    }

    #[tokio::test]
    async fn sends_the_request_and_reads_the_reply() {
        let (api, received) = serve_once(
            200,
            r#"{"choices":[{"message":{"role":"assistant","content":"Shorter."},"finish_reason":"stop"}]}"#,
        );
        let reply = edit(
            &api,
            &settings(Some("high"), Some("fast")),
            "SYSTEM",
            "Instruction: x\n\n<text>\ny\n</text>",
        )
        .await;
        assert_eq!(reply.as_deref(), Ok("Shorter."));
        let (head, body) = received.recv().unwrap();
        assert!(head.starts_with("POST /api/v1/chat/completions "));
        let head = head.to_ascii_lowercase();
        assert!(head.contains("authorization: bearer sk-or-v1-secret"));
        assert!(head.contains("x-title: sushi"));
        assert!(head.contains("http-referer: https://sushi.octolab.org/"));
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            body,
            json!({
                "model": "openai/gpt-6-luna",
                "messages": [
                    {"role": "system", "content": "SYSTEM"},
                    {"role": "user", "content": "Instruction: x\n\n<text>\ny\n</text>"}
                ],
                "reasoning": {"effort": "high", "exclude": true},
                "service_tier": "fast",
                "provider": {"data_collection": "deny"}
            }),
            "nothing else of the prompt goes out, and no temperature"
        );

        // Without reasoning and tier in the file, the reasoning still never comes back.
        let (api, received) = serve_once(200, r#"{"choices":[{"message":{"content":"ok"}}]}"#);
        edit(&api, &settings(None, None), "S", "C").await.unwrap();
        let body: serde_json::Value = serde_json::from_str(&received.recv().unwrap().1).unwrap();
        assert_eq!(body["reasoning"], json!({"exclude": true}));
        assert!(body.get("service_tier").is_none());
    }

    #[tokio::test]
    async fn maps_failures() {
        let cases: [(u16, &'static str, String); 7] = [
            (
                401,
                r#"{"error":{"code":401,"message":"User not found."}}"#,
                format!("{REJECTED_KEY}{EDIT_WITH_OLLAMA}"),
            ),
            (403, "{}", format!("{REJECTED_KEY}{EDIT_WITH_OLLAMA}")),
            (
                402,
                r#"{"error":{"code":402,"message":"Insufficient credits"}}"#,
                format!("{NO_CREDITS}{EDIT_WITH_OLLAMA}"),
            ),
            (429, "", format!("{BUSY}{EDIT_WITH_OLLAMA}")),
            (
                400,
                r#"{"error":{"code":400,"message":"openai/gpt-7 is not a valid model ID."}}"#,
                "OpenRouter: openai/gpt-7 is not a valid model ID. Edit with Ollama".into(),
            ),
            (
                502,
                "<html>Bad gateway</html>",
                "OpenRouter: error 502. Edit with Ollama".into(),
            ),
            (
                200,
                r#"{"choices":[{"message":{"content":"  "}}]}"#,
                "OpenRouter: the model returned an empty response. Edit with Ollama".into(),
            ),
        ];
        for (status, body, expected) in cases {
            let (api, _received) = serve_once(status, body);
            assert_eq!(
                edit(&api, &settings(None, None), "S", "C").await,
                Err(expected),
                "{status} {body}"
            );
        }
        let (api, _received) = serve_once(
            200,
            r#"{"choices":[{"message":{"content":"Half"},"finish_reason":"length"}]}"#,
        );
        assert_eq!(
            edit(&api, &settings(None, None), "S", "C").await,
            Err(CUT_OFF.into())
        );
        // Nothing listens on a closed port.
        let closed = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        assert_eq!(
            edit(&format!("http://{closed}"), &settings(None, None), "S", "C").await,
            Err(format!("{UNREACHABLE}{EDIT_WITH_OLLAMA}"))
        );
    }

    #[tokio::test]
    async fn errors_never_carry_the_key() {
        let (api, _received) = serve_once(
            400,
            r#"{"error":{"message":"Key sk-or-v1-secret is malformed"}}"#,
        );
        let error = edit(&api, &settings(None, None), "S", "C")
            .await
            .unwrap_err();
        assert_eq!(error, "OpenRouter: Key … is malformed. Edit with Ollama");
        let long = failure(Some(StatusCode::BAD_REQUEST), Some(&"x".repeat(500)), "k");
        assert_eq!(
            long.len(),
            "OpenRouter: ".len() + 200 + ".".len() + EDIT_WITH_OLLAMA.len()
        );
    }

    #[tokio::test]
    #[ignore = "sends a synthetic edit to OpenRouter; needs OPENROUTER_TOKEN"]
    async fn live_edit() {
        let key = std::env::var("OPENROUTER_TOKEN").expect("OPENROUTER_TOKEN");
        let settings = OpenRouter {
            key,
            ..settings(Some("high"), Some("fast"))
        };
        let started = std::time::Instant::now();
        let reply = edit(
            API,
            &settings,
            crate::rewrite::SYSTEM,
            "Instruction: Make the text concise. Keep all essential conditions.\n\n<text>\nPlease make sure that it follows the system appearance by default and also remembers whatever the user chose last time.\n</text>",
        )
        .await
        .unwrap();
        println!("{:.1} s: {reply}", started.elapsed().as_secs_f64());
        assert!(reply.len() < 120);
    }
}
