//! `model.json`: which provider runs an edit (docs/specs/model.md, LF-20). Sushi never writes it.

use serde::Deserialize;
use std::{fs, io, path::Path};

pub const FILE: &str = "model.json";
const REASONING: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];
const TIERS: [&str; 4] = ["default", "flex", "fast", "ultrafast"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    provider: String,
    openrouter: Option<OpenRouterFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenRouterFile {
    key: String,
    model: String,
    reasoning: Option<String>,
    tier: Option<String>,
}

/// What an edit runs on. The key never leaves the native side (MD-5).
#[derive(Debug, PartialEq)]
pub enum Choice {
    Ollama,
    OpenRouter(OpenRouter),
}

#[derive(Debug, PartialEq)]
pub struct OpenRouter {
    pub key: String,
    pub model: String,
    pub reasoning: Option<String>,
    pub tier: Option<String>,
}

impl OpenRouter {
    /// The model as the hint names it: the part of the ID after the last `/` (MD-8).
    pub fn name(&self) -> &str {
        self.model.rsplit('/').next().unwrap_or(&self.model)
    }
}

fn one_of(field: &str, value: &Option<String>, allowed: &[&str]) -> Result<(), String> {
    match value {
        Some(v) if !allowed.contains(&v.as_str()) => Err(format!(
            "{FILE}: openrouter.{field} must be one of {}.",
            allowed.join(", ")
        )),
        _ => Ok(()),
    }
}

/// Reads `model.json` from the settings folder; a missing file means Ollama (MD-1).
pub fn load(dir: &Path) -> Result<Choice, String> {
    let data = match fs::read(dir.join(FILE)) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Choice::Ollama),
        other => other.map_err(|e| format!("{FILE}: {e}"))?,
    };
    let file: File = serde_json::from_slice(&data).map_err(|e| format!("{FILE}: {e}"))?;
    let section = file.openrouter.map(|s| -> Result<OpenRouter, String> {
        for (field, value) in [("key", &s.key), ("model", &s.model)] {
            if value.trim().is_empty() {
                return Err(format!("{FILE}: openrouter.{field} is empty."));
            }
        }
        one_of("reasoning", &s.reasoning, &REASONING)?;
        one_of("tier", &s.tier, &TIERS)?;
        Ok(OpenRouter {
            key: s.key.trim().to_string(),
            model: s.model.trim().to_string(),
            reasoning: s.reasoning,
            tier: s.tier,
        })
    });
    match file.provider.as_str() {
        "ollama" => section.transpose().map(|_| Choice::Ollama),
        "openrouter" => match section {
            Some(section) => section.map(Choice::OpenRouter),
            None => Err(format!(
                "{FILE}: the openrouter section is missing for provider openrouter."
            )),
        },
        _ => Err(format!("{FILE}: provider must be ollama or openrouter.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = include_str!("../../docs/specs/examples/model.json");

    fn with(contents: Option<&str>) -> Result<Choice, String> {
        let dir = tempfile::tempdir().unwrap();
        if let Some(contents) = contents {
            fs::write(dir.path().join(FILE), contents).unwrap();
        }
        load(dir.path())
    }

    #[test]
    fn reads_the_choice() {
        assert_eq!(with(None), Ok(Choice::Ollama), "no file: Ollama");
        assert_eq!(with(Some(r#"{"provider": "ollama"}"#)), Ok(Choice::Ollama));
        let Ok(Choice::OpenRouter(chosen)) = with(Some(EXAMPLE)) else {
            panic!("the example chooses OpenRouter")
        };
        assert_eq!(chosen.model, "openai/gpt-6-luna");
        assert_eq!(chosen.name(), "gpt-6-luna");
        assert_eq!(chosen.reasoning.as_deref(), Some("high"));
        assert_eq!(chosen.tier.as_deref(), Some("fast"));
        // Switching back keeps the section for later.
        let kept = EXAMPLE.replace(r#""provider": "openrouter""#, r#""provider": "ollama""#);
        assert_eq!(with(Some(&kept)), Ok(Choice::Ollama));
        let minimal = r#"{"provider": "openrouter", "openrouter": {"key": " k ", "model": "m"}}"#;
        assert_eq!(
            with(Some(minimal)),
            Ok(Choice::OpenRouter(OpenRouter {
                key: "k".into(),
                model: "m".into(),
                reasoning: None,
                tier: None
            }))
        );
    }

    #[test]
    fn rejects_invalid_files() {
        let error = |contents: &str| with(Some(contents)).unwrap_err();
        assert_eq!(
            error(r#"{"provider": "openrouter"}"#),
            "model.json: the openrouter section is missing for provider openrouter."
        );
        assert_eq!(
            error(r#"{"provider": "openai"}"#),
            "model.json: provider must be ollama or openrouter."
        );
        let section = |fields: &str| {
            error(&format!(
                r#"{{"provider": "openrouter", "openrouter": {{{fields}}}}}"#
            ))
        };
        assert_eq!(
            section(r#""key": " ", "model": "m""#),
            "model.json: openrouter.key is empty."
        );
        assert_eq!(
            section(r#""key": "k", "model": """#),
            "model.json: openrouter.model is empty."
        );
        assert_eq!(
            section(r#""key": "k", "model": "m", "tier": "priority""#),
            "model.json: openrouter.tier must be one of default, flex, fast, ultrafast."
        );
        assert_eq!(
            section(r#""key": "k", "model": "m", "reasoning": "max""#),
            "model.json: openrouter.reasoning must be one of none, minimal, low, medium, high, xhigh."
        );
        assert!(section(r#""key": "k", "model": "m", "temperature": 0"#)
            .starts_with("model.json: unknown field `temperature`"));
        assert!(error("{").starts_with("model.json: EOF while parsing"));
        // An invalid section is an error even while Ollama is chosen: it would fail on the switch.
        assert_eq!(
            error(r#"{"provider": "ollama", "openrouter": {"key": "", "model": "m"}}"#),
            "model.json: openrouter.key is empty."
        );
    }
}
