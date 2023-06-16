//! An edit through a hosted provider, and the check of a pasted key (docs/specs/model.md, MD-4 to
//! MD-7, MD-13). One request per edit: Sushi's system instruction and one user message with the
//! instruction and the target text, nothing else of the prompt.

use crate::model::Settings;
use crate::providers::Provider;
use reqwest::{Client, RequestBuilder, StatusCode};
use serde_json::{json, Value};
use std::{
    sync::{LazyLock, Mutex},
    time::Duration,
};

/// Every failure a local edit could fix ends with this phrase; the page turns it into a button (MD-6).
pub const EDIT_WITH_OLLAMA: &str = " Edit with Ollama";
/// Put before [`EDIT_WITH_OLLAMA`] when a new key would fix it; the page turns it into a button.
pub const CONNECT_AGAIN: &str = " Connect again ·";
pub const CUT_OFF: &str = "The model reached its context limit. Select a shorter passage.";
const ANTHROPIC_VERSION: &str = "2026-10-21";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
/// Models that take `fallbacks: "default"`: another model finishes an edit this one declines.
const FALLBACK_MODELS: [&str; 5] = [
    "claude-fable-5-2",
    "claude-fable-5-1",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5-5",
];

pub static CLIENT: LazyLock<Result<Client, String>> = LazyLock::new(|| {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
});

pub fn client() -> Result<&'static Client, String> {
    CLIENT.as_ref().map_err(Clone::clone)
}

/// Why a hosted edit failed, before it becomes the message of MD-6.
#[derive(Debug, PartialEq)]
pub enum Failure {
    Unreachable,
    NotConnected,
    RejectedKey,
    NoCredits,
    Busy,
    Overloaded,
    Declined,
    Other(String),
}

/// How the last hosted edit ended, by kind: a problem report says whether the provider answered
/// without asking it again (RP-6). Kept in memory only.
static LAST: Mutex<Option<(Provider, &'static str)>> = Mutex::new(None);

pub fn last_outcome() -> Option<(Provider, &'static str)> {
    LAST.lock().ok().and_then(|last| *last)
}

pub fn remember(provider: Provider, outcome: &'static str) {
    if let Ok(mut last) = LAST.lock() {
        *last = Some((provider, outcome));
    }
}

impl Failure {
    /// The kind a report names, never the provider's text.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Unreachable => "not reachable",
            Self::NotConnected => "not connected",
            Self::RejectedKey => "the key was not accepted",
            Self::NoCredits => "out of credits",
            Self::Busy => "busy",
            Self::Overloaded => "overloaded",
            Self::Declined => "declined the text",
            Self::Other(text) if text == CUT_OFF => "answered, cut off",
            Self::Other(_) => "an error",
        }
    }

    /// The message the hint shows; the key never appears in it (MD-5).
    pub fn message(self, provider: Provider, key: &str) -> String {
        let name = provider.name();
        let text = match self {
            Self::Unreachable => format!("{name} is not reachable."),
            Self::NotConnected => format!("{name} is not connected.{CONNECT_AGAIN}"),
            Self::RejectedKey => format!("{name} did not accept the key.{CONNECT_AGAIN}"),
            Self::NoCredits => format!("{name}: the account is out of credits."),
            Self::Busy => format!("{name} is busy right now."),
            Self::Overloaded => format!("{name} is overloaded right now."),
            Self::Declined => format!("{name} declined to edit this text."),
            Self::Other(detail) => {
                let detail = if key.is_empty() {
                    detail
                } else {
                    detail.replace(key, "…")
                };
                let detail: String = detail
                    .trim()
                    .trim_end_matches('.')
                    .chars()
                    .take(200)
                    .collect();
                format!("{name}: {detail}.")
            }
        };
        text + EDIT_WITH_OLLAMA
    }
}

fn detail(body: &Value) -> Option<String> {
    let message = body.pointer("/error/message").and_then(Value::as_str)?;
    let message = message.trim();
    (!message.is_empty()).then(|| message.to_string())
}

/// Maps an error status and its body, the same way for every provider unless it says otherwise.
fn classify(provider: Provider, status: StatusCode, body: &Value) -> Failure {
    let code = body.pointer("/error/code").and_then(Value::as_str);
    let kind = body.pointer("/error/type").and_then(Value::as_str);
    let message = detail(body).unwrap_or_default().to_lowercase();
    match (provider, status.as_u16()) {
        (_, 401) => Failure::RejectedKey,
        (_, 402) => Failure::NoCredits,
        (Provider::OpenAi, 429) if code == Some("insufficient_quota") => Failure::NoCredits,
        (Provider::Anthropic, 400) if message.contains("credit balance") => Failure::NoCredits,
        (_, 429) => Failure::Busy,
        (Provider::Anthropic, 529) => Failure::Overloaded,
        _ if kind == Some("overloaded_error") => Failure::Overloaded,
        (_, code) => Failure::Other(detail(body).unwrap_or_else(|| format!("error {code}"))),
    }
}

/// The request of one edit, without the key: kept apart so a test can read it.
pub fn body(provider: Provider, settings: &Settings, system: &str, content: &str) -> Value {
    let messages = json!([
        {"role": "system", "content": system},
        {"role": "user", "content": content}
    ]);
    match provider {
        Provider::OpenRouter => {
            let s = settings.openrouter();
            let mut body = json!({
                "model": s.model,
                "messages": messages,
                // The model may think, but its reasoning never comes back.
                "reasoning": {"exclude": true},
                // Only providers that do not train on the request; they may still retain it (MD-4).
                "provider": {"data_collection": "deny"},
            });
            if let Some(effort) = s.reasoning {
                body["reasoning"]["effort"] = json!(effort);
            }
            if let Some(tier) = s.tier {
                body["service_tier"] = json!(tier);
            }
            body
        }
        Provider::OpenAi => {
            let s = settings.openai();
            // `store: false`: OpenAI keeps no copy of the request for its dashboard or evals.
            let mut body = json!({"model": s.model, "messages": messages, "store": false});
            if let Some(effort) = s.reasoning {
                body["reasoning_effort"] = json!(effort);
            }
            body
        }
        Provider::Anthropic => {
            let s = settings.anthropic();
            let model = s.model.unwrap_or_default();
            let mut body = json!({
                "model": model,
                "max_tokens": 16000,
                "system": system,
                "messages": [{"role": "user", "content": content}],
            });
            if let Some(effort) = s.effort {
                body["output_config"] = json!({"effort": effort});
            }
            if FALLBACK_MODELS.contains(&model.as_str()) {
                body["fallbacks"] = json!("default");
            }
            body
        }
    }
}

fn authorize(
    provider: Provider,
    request: RequestBuilder,
    key: &str,
    body: &Value,
) -> RequestBuilder {
    match provider {
        // Name the app in the user's OpenRouter activity.
        Provider::OpenRouter => request
            .bearer_auth(key)
            .header("X-Title", "Sushi")
            .header("HTTP-Referer", "https://sushi.octolab.org/"),
        Provider::OpenAi => request.bearer_auth(key),
        Provider::Anthropic => {
            let request = request
                .header("x-api-key", key)
                .header("anthropic-version", ANTHROPIC_VERSION);
            if body.get("fallbacks").is_some() {
                request.header("anthropic-beta", FALLBACK_BETA)
            } else {
                request
            }
        }
    }
}

/// The text of a successful reply, or why there is none.
fn reply(provider: Provider, body: &Value) -> Result<String, Failure> {
    let text = match provider {
        Provider::OpenRouter | Provider::OpenAi => {
            let choice = body.pointer("/choices/0");
            if choice
                .and_then(|c| c.get("finish_reason"))
                .and_then(Value::as_str)
                == Some("length")
            {
                return Err(Failure::Other(CUT_OFF.into()));
            }
            choice
                .and_then(|c| c.pointer("/message/content"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        }
        Provider::Anthropic => {
            match body.get("stop_reason").and_then(Value::as_str) {
                Some("max_tokens") => return Err(Failure::Other(CUT_OFF.into())),
                Some("refusal") => return Err(Failure::Declined),
                _ => (),
            }
            // After a fallback, the answer is the text that follows the last switch.
            let blocks = body
                .get("content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let start = blocks
                .iter()
                .rposition(|b| b.get("type").and_then(Value::as_str) == Some("fallback"))
                .map_or(0, |i| i + 1);
            blocks[start..]
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect()
        }
    };
    if text.trim().is_empty() {
        Err(Failure::Other(
            "the model returned an empty response".into(),
        ))
    } else {
        Ok(text)
    }
}

/// A reply's text and the model that answered, when the provider names it: after a fallback it is
/// not the one requested (MD-8).
#[derive(Debug, PartialEq)]
pub struct Answer {
    pub text: String,
    pub model: Option<String>,
}

/// Sends one edit and returns the reply (MD-4).
pub async fn edit(
    api: &str,
    provider: Provider,
    settings: &Settings,
    key: &str,
    system: &str,
    content: &str,
) -> Result<Answer, String> {
    let result = send(api, provider, settings, key, system, content).await;
    remember(
        provider,
        result.as_ref().map_or_else(Failure::kind, |_| "answered"),
    );
    finish(provider, key, result)
}

/// The same request for a problem report's questions: it leaves the outcome of the last edit as
/// it was, since that is what the report describes (RP-6).
pub async fn ask(
    api: &str,
    provider: Provider,
    settings: &Settings,
    key: &str,
    system: &str,
    content: &str,
) -> Result<Answer, String> {
    let result = send(api, provider, settings, key, system, content).await;
    finish(provider, key, result)
}

fn finish(
    provider: Provider,
    key: &str,
    result: Result<Answer, Failure>,
) -> Result<Answer, String> {
    result.map_err(|failure| match failure {
        // A cut-off reply is not the provider's fault; Ollama has the same limit (MD-7).
        Failure::Other(text) if text == CUT_OFF => text,
        failure => failure.message(provider, key),
    })
}

async fn send(
    api: &str,
    provider: Provider,
    settings: &Settings,
    key: &str,
    system: &str,
    content: &str,
) -> Result<Answer, Failure> {
    let client = client().map_err(Failure::Other)?;
    let body = body(provider, settings, system, content);
    let path = match provider {
        Provider::Anthropic => "messages",
        _ => "chat/completions",
    };
    let request = authorize(provider, client.post(format!("{api}/{path}")), key, &body);
    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|_| Failure::Unreachable)?;
    let status = response.status();
    let text = response.text().await.map_err(|_| Failure::Unreachable)?;
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(classify(provider, status, &value));
    }
    if value.get("error").is_some() {
        return Err(classify(provider, StatusCode::BAD_GATEWAY, &value));
    }
    let model = value
        .get("model")
        .and_then(Value::as_str)
        .map(|m| m.rsplit('/').next().unwrap_or(m).to_string())
        .filter(|m| !m.is_empty());
    Ok(Answer {
        text: reply(provider, &value)?,
        model,
    })
}

/// Checks a pasted key with a request that costs nothing (MD-13).
pub async fn check_key(api: &str, provider: Provider, key: &str) -> Result<(), String> {
    let name = provider.name();
    let client = client()?;
    let request = authorize(
        provider,
        client.get(format!("{api}/models")),
        key,
        &Value::Null,
    );
    let response = request
        .send()
        .await
        .map_err(|_| format!("Could not check the key: {name} is not reachable."))?;
    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err(format!(
            "{name} did not accept this key. Copy it again from the keys page."
        )),
        code => Err(format!(
            "Could not check the key: {name} answered with error {code}."
        )),
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::model::{Anthropic, OpenAi, OpenRouter};
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        sync::mpsc,
    };

    const KEY: &str = "sk-test-secret-0123";

    /// Answers one request with `status` and `body`, and hands back what it received.
    pub fn serve_once(
        status: u16,
        body: &'static str,
    ) -> (String, mpsc::Receiver<(String, String)>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let api = format!("http://{}/v1", listener.local_addr().unwrap());
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

    fn settings(provider: Provider) -> Settings {
        let mut settings = Settings::default();
        settings.choose(Some(provider));
        settings
    }

    async fn run(
        provider: Provider,
        status: u16,
        body: &'static str,
    ) -> (Result<String, String>, String, Value) {
        let (api, received) = serve_once(status, body);
        let result = edit(
            &api,
            provider,
            &settings(provider),
            KEY,
            "SYSTEM",
            "Instruction: x\n\n<text>\ny\n</text>",
        )
        .await;
        let (head, sent) = received.recv().unwrap();
        (
            result.map(|answer| answer.text),
            head.to_ascii_lowercase(),
            serde_json::from_str(&sent).unwrap(),
        )
    }

    const USER: &str = "Instruction: x\n\n<text>\ny\n</text>";

    #[tokio::test]
    async fn openrouter_request() {
        let (reply, head, body) = run(
            Provider::OpenRouter,
            200,
            r#"{"choices":[{"message":{"role":"assistant","content":"Shorter."},"finish_reason":"stop"}]}"#,
        )
        .await;
        assert_eq!(reply.as_deref(), Ok("Shorter."));
        assert!(head.starts_with("post /v1/chat/completions "));
        assert!(head.contains(&format!("authorization: bearer {}", KEY.to_lowercase())));
        assert!(head.contains("x-title: sushi"));
        assert!(head.contains("http-referer: https://sushi.octolab.org/"));
        assert_eq!(
            body,
            json!({
                "model": "openai/gpt-6-luna",
                "messages": [
                    {"role": "system", "content": "SYSTEM"},
                    {"role": "user", "content": USER}
                ],
                "reasoning": {"effort": "high", "exclude": true},
                "service_tier": "fast",
                "provider": {"data_collection": "deny"}
            }),
            "nothing else of the prompt goes out, and no temperature"
        );
        // A section without reasoning and tier sends neither, and still hides the reasoning.
        let mut written = Settings::default();
        written.choose(Some(Provider::OpenRouter));
        written.openrouter = Some(OpenRouter {
            model: Some("m/x".into()),
            ..Default::default()
        });
        let body = super::body(Provider::OpenRouter, &written, "S", "C");
        assert_eq!(body["reasoning"], json!({"exclude": true}));
        assert!(body.get("service_tier").is_none());
    }

    #[tokio::test]
    async fn openai_request() {
        let (reply, head, body) = run(
            Provider::OpenAi,
            200,
            r#"{"choices":[{"message":{"role":"assistant","content":"Shorter."},"finish_reason":"stop"}]}"#,
        )
        .await;
        assert_eq!(reply.as_deref(), Ok("Shorter."));
        assert!(head.starts_with("post /v1/chat/completions "));
        assert!(head.contains(&format!("authorization: bearer {}", KEY.to_lowercase())));
        assert!(
            !head.contains("x-title"),
            "nothing about Sushi goes to OpenAI"
        );
        assert_eq!(
            body,
            json!({
                "model": "gpt-6-luna",
                "messages": [
                    {"role": "system", "content": "SYSTEM"},
                    {"role": "user", "content": USER}
                ],
                "reasoning_effort": "high",
                "store": false
            })
        );
        let mut custom = Settings::default();
        custom.openai = Some(OpenAi {
            model: Some("gpt-x".into()),
            reasoning: None,
        });
        assert!(super::body(Provider::OpenAi, &custom, "S", "C")
            .get("reasoning_effort")
            .is_none());
    }

    #[tokio::test]
    async fn anthropic_request() {
        let (reply, head, body) = run(
            Provider::Anthropic,
            200,
            r#"{"content":[{"type":"thinking","thinking":""},{"type":"text","text":"Shorter."}],"stop_reason":"end_turn"}"#,
        )
        .await;
        assert_eq!(reply.as_deref(), Ok("Shorter."));
        assert!(head.starts_with("post /v1/messages "));
        assert!(head.contains(&format!("x-api-key: {}", KEY.to_lowercase())));
        assert!(head.contains("anthropic-version: 2026-10-21"));
        assert!(head.contains("anthropic-beta: server-side-fallback-2026-07-01"));
        assert!(!head.contains("authorization"));
        assert_eq!(
            body,
            json!({
                "model": "claude-opus-5-5",
                "max_tokens": 16000,
                "system": "SYSTEM",
                "messages": [{"role": "user", "content": USER}],
                "output_config": {"effort": "low"},
                "fallbacks": "default"
            }),
            "no temperature: version 2026-10-21 rejects it"
        );
        // A model without server-side fallbacks gets neither the field nor the beta.
        let mut haiku = Settings::default();
        haiku.anthropic = Some(Anthropic {
            model: Some("claude-haiku-5-5".into()),
            effort: None,
        });
        let body = super::body(Provider::Anthropic, &haiku, "S", "C");
        assert!(body.get("fallbacks").is_none() && body.get("output_config").is_none());
        // After a fallback the reply is the text that follows the switch.
        let (reply, _, _) = run(
            Provider::Anthropic,
            200,
            r#"{"content":[{"type":"text","text":"Half"},{"type":"fallback","from":{"model":"a"},"to":{"model":"b"}},{"type":"text","text":"Whole."}],"stop_reason":"end_turn"}"#,
        )
        .await;
        assert_eq!(reply.as_deref(), Ok("Whole."));
        // The model that answered names itself; after a fallback it is not the one requested.
        let (api, _received) = serve_once(
            200,
            r#"{"model":"claude-opus-4-8","content":[{"type":"text","text":"Ok."}],"stop_reason":"end_turn"}"#,
        );
        let answer = edit(
            &api,
            Provider::Anthropic,
            &settings(Provider::Anthropic),
            KEY,
            "S",
            "C",
        )
        .await
        .unwrap();
        assert_eq!(answer.model.as_deref(), Some("claude-opus-4-8"));
        let (api, _received) = serve_once(
            200,
            r#"{"model":"openai/gpt-6-luna","choices":[{"message":{"content":"Ok."}}]}"#,
        );
        let answer = edit(
            &api,
            Provider::OpenRouter,
            &settings(Provider::OpenRouter),
            KEY,
            "S",
            "C",
        )
        .await
        .unwrap();
        assert_eq!(answer.model.as_deref(), Some("gpt-6-luna"));
        assert_eq!(last_outcome(), Some((Provider::OpenRouter, "answered")));
    }

    #[tokio::test]
    async fn maps_failures() {
        let cases: Vec<(Provider, u16, &'static str, String)> = vec![
            (
                Provider::OpenRouter,
                401,
                r#"{"error":{"code":401,"message":"User not found."}}"#,
                "OpenRouter did not accept the key. Connect again · Edit with Ollama".into(),
            ),
            (
                Provider::OpenRouter,
                403,
                r#"{"error":{"code":403,"message":"Blocked by a guardrail"}}"#,
                "OpenRouter: Blocked by a guardrail. Edit with Ollama".into(),
            ),
            (
                Provider::OpenRouter,
                402,
                r#"{"error":{"message":"Insufficient credits"}}"#,
                "OpenRouter: the account is out of credits. Edit with Ollama".into(),
            ),
            (
                Provider::OpenRouter,
                429,
                "",
                "OpenRouter is busy right now. Edit with Ollama".into(),
            ),
            (
                Provider::OpenRouter,
                400,
                r#"{"error":{"message":"openai/gpt-7 is not a valid model ID."}}"#,
                "OpenRouter: openai/gpt-7 is not a valid model ID. Edit with Ollama".into(),
            ),
            (
                Provider::OpenRouter,
                502,
                "<html>Bad gateway</html>",
                "OpenRouter: error 502. Edit with Ollama".into(),
            ),
            (
                Provider::OpenRouter,
                200,
                r#"{"choices":[{"message":{"content":"  "}}]}"#,
                "OpenRouter: the model returned an empty response. Edit with Ollama".into(),
            ),
            (
                Provider::OpenRouter,
                200,
                r#"{"choices":[{"message":{"content":"Half"},"finish_reason":"length"}]}"#,
                CUT_OFF.into(),
            ),
            (
                Provider::OpenAi,
                401,
                r#"{"error":{"message":"Incorrect API key provided","code":"invalid_api_key"}}"#,
                "OpenAI did not accept the key. Connect again · Edit with Ollama".into(),
            ),
            (
                Provider::OpenAi,
                429,
                r#"{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}"#,
                "OpenAI: the account is out of credits. Edit with Ollama".into(),
            ),
            (
                Provider::OpenAi,
                429,
                r#"{"error":{"message":"Rate limit reached","code":"rate_limit_exceeded"}}"#,
                "OpenAI is busy right now. Edit with Ollama".into(),
            ),
            (
                Provider::OpenAi,
                500,
                r#"{"error":{"message":"The server had an error"}}"#,
                "OpenAI: The server had an error. Edit with Ollama".into(),
            ),
            (
                Provider::Anthropic,
                401,
                r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#,
                "Claude did not accept the key. Connect again · Edit with Ollama".into(),
            ),
            (
                Provider::Anthropic,
                400,
                r#"{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}"#,
                "Claude: the account is out of credits. Edit with Ollama".into(),
            ),
            (
                Provider::Anthropic,
                402,
                r#"{"type":"error","error":{"type":"billing_error","message":"Payment required"}}"#,
                "Claude: the account is out of credits. Edit with Ollama".into(),
            ),
            (
                Provider::Anthropic,
                429,
                r#"{"type":"error","error":{"type":"rate_limit_error","message":"Slow down"}}"#,
                "Claude is busy right now. Edit with Ollama".into(),
            ),
            (
                Provider::Anthropic,
                529,
                r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
                "Claude is overloaded right now. Edit with Ollama".into(),
            ),
            (
                Provider::Anthropic,
                200,
                r#"{"content":[],"stop_reason":"refusal"}"#,
                "Claude declined to edit this text. Edit with Ollama".into(),
            ),
            (
                Provider::Anthropic,
                200,
                r#"{"content":[{"type":"text","text":"Half"}],"stop_reason":"max_tokens"}"#,
                CUT_OFF.into(),
            ),
        ];
        for (provider, status, body, expected) in cases {
            let (result, _, _) = run(provider, status, body).await;
            assert_eq!(result, Err(expected), "{provider:?} {status} {body}");
        }
        // Nothing listens on a closed port.
        let closed = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        for provider in [Provider::OpenRouter, Provider::OpenAi, Provider::Anthropic] {
            assert_eq!(
                edit(
                    &format!("http://{closed}"),
                    provider,
                    &settings(provider),
                    KEY,
                    "S",
                    "C"
                )
                .await,
                Err(format!(
                    "{} is not reachable. Edit with Ollama",
                    provider.name()
                ))
            );
        }
    }

    #[tokio::test]
    async fn errors_never_carry_the_key() {
        let (api, _received) = serve_once(
            400,
            r#"{"error":{"message":"Key sk-test-secret-0123 is malformed"}}"#,
        );
        let error = edit(
            &api,
            Provider::OpenAi,
            &settings(Provider::OpenAi),
            KEY,
            "S",
            "C",
        )
        .await
        .unwrap_err();
        assert_eq!(error, "OpenAI: Key … is malformed. Edit with Ollama");
        let long = Failure::Other("x".repeat(500)).message(Provider::OpenRouter, "k");
        assert_eq!(
            long.len(),
            "OpenRouter: ".len() + 200 + ".".len() + EDIT_WITH_OLLAMA.len()
        );
    }

    #[tokio::test]
    async fn checks_a_pasted_key() {
        let (api, received) = serve_once(200, r#"{"data":[]}"#);
        assert_eq!(check_key(&api, Provider::Anthropic, KEY).await, Ok(()));
        let head = received.recv().unwrap().0.to_ascii_lowercase();
        assert!(head.starts_with("get /v1/models "));
        assert!(head.contains("x-api-key: ") && head.contains("anthropic-version: "));
        let (api, received) = serve_once(200, r#"{"data":[]}"#);
        assert_eq!(check_key(&api, Provider::OpenAi, KEY).await, Ok(()));
        assert!(received
            .recv()
            .unwrap()
            .0
            .to_ascii_lowercase()
            .contains("authorization: bearer"));
        let (api, _r) = serve_once(401, "{}");
        assert_eq!(
            check_key(&api, Provider::OpenAi, KEY).await,
            Err("OpenAI did not accept this key. Copy it again from the keys page.".into())
        );
        let (api, _r) = serve_once(500, "{}");
        assert_eq!(
            check_key(&api, Provider::Anthropic, KEY).await,
            Err("Could not check the key: Claude answered with error 500.".into())
        );
    }

    async fn live(provider: Provider, variable: &str) {
        let key = std::env::var(variable).unwrap_or_else(|_| panic!("{variable}"));
        let started = std::time::Instant::now();
        let reply = edit(
            provider.api(),
            provider,
            &settings(provider),
            &key,
            crate::rewrite::SYSTEM,
            "Instruction: Make the text concise. Keep all essential conditions.\n\n<text>\nPlease make sure that it follows the system appearance by default and also remembers whatever the user chose last time.\n</text>",
        )
        .await
        .unwrap()
        .text;
        println!(
            "{provider:?} {:.1} s: {reply}",
            started.elapsed().as_secs_f64()
        );
        assert!(reply.len() < 120);
        check_key(provider.api(), provider, &key).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "sends a synthetic edit to OpenRouter; needs OPENROUTER_TOKEN"]
    async fn live_openrouter() {
        live(Provider::OpenRouter, "OPENROUTER_TOKEN").await;
    }

    #[tokio::test]
    #[ignore = "sends a synthetic edit to OpenAI; needs OPENAI_API_KEY"]
    async fn live_openai() {
        live(Provider::OpenAi, "OPENAI_API_KEY").await;
    }

    #[tokio::test]
    #[ignore = "sends a synthetic edit to Anthropic; needs ANTHROPIC_API_KEY"]
    async fn live_anthropic() {
        live(Provider::Anthropic, "ANTHROPIC_API_KEY").await;
    }
}
