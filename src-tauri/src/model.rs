//! `model.json`: which provider runs an edit and how (docs/specs/model.md; local-files.md, LF-20).
//! Optional: without it edits run on Ollama. Sushi writes it when the user connects, switches or
//! disconnects a provider in the Model menu; the keys live in the keychain (MD-11).

use crate::files::{self, Change, FileName, Refusal};
use crate::keychain::Keychain;
use crate::providers::Provider;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const FILE: &str = "model.json";
/// The values the validator, the settings window and docs/specs/files.cue allow; a test of
/// `make config-vet` compares them with the schema.
pub const PROVIDERS: [&str; 4] = ["ollama", "openrouter", "openai", "anthropic"];
pub const REASONING: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];
pub const TIERS: [&str; 4] = ["default", "flex", "fast", "ultrafast"];
pub const EFFORT: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct OpenRouter {
    /// Only in files from v0.2.1: moved to the keychain at launch (MD-12). Until then a save
    /// keeps it, so the key leaves the file only once the keychain holds it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct OpenAi {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct Anthropic {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
}

/// The file as it is written; a section that is missing takes the provider's defaults.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openrouter: Option<OpenRouter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openai: Option<OpenAi>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anthropic: Option<Anthropic>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: "ollama".into(),
            openrouter: None,
            openai: None,
            anthropic: None,
        }
    }
}

fn one_of(path: &str, value: &Option<String>, allowed: &[&str]) -> Result<(), String> {
    match value {
        Some(v) if !allowed.contains(&v.as_str()) => Err(format!(
            "{FILE}: {path} must be one of {}.",
            allowed.join(", ")
        )),
        _ => Ok(()),
    }
}

fn not_blank(path: &str, value: &Option<String>) -> Result<(), String> {
    match value {
        Some(v) if v.trim().is_empty() => Err(format!("{FILE}: {path} is empty.")),
        _ => Ok(()),
    }
}

impl Settings {
    /// The active provider: `None` is Ollama (MD-1).
    pub fn active(&self) -> Option<Provider> {
        Provider::from_id(&self.provider)
    }

    pub fn choose(&mut self, provider: Option<Provider>) {
        self.provider = provider.map_or("ollama", Provider::id).into();
        // Connecting writes the defaults, so the file shows what an edit sends (MD-10).
        match provider {
            Some(Provider::OpenRouter) if self.openrouter.is_none() => {
                self.openrouter = Some(OpenRouter::default().filled())
            }
            Some(Provider::OpenAi) if self.openai.is_none() => {
                self.openai = Some(OpenAi::default().filled())
            }
            Some(Provider::Anthropic) if self.anthropic.is_none() => {
                self.anthropic = Some(Anthropic::default().filled())
            }
            _ => (),
        }
    }

    /// Drops a key of v0.2.1: a new key in the keychain replaces it, or the user disconnected.
    /// Returns whether there was one.
    pub fn forget_key(&mut self) -> bool {
        self.openrouter
            .as_mut()
            .and_then(|s| s.key.take())
            .is_some()
    }

    pub fn openrouter(&self) -> OpenRouter {
        self.openrouter.clone().unwrap_or_default().filled()
    }
    pub fn openai(&self) -> OpenAi {
        self.openai.clone().unwrap_or_default().filled()
    }
    pub fn anthropic(&self) -> Anthropic {
        self.anthropic.clone().unwrap_or_default().filled()
    }

    /// The model of `provider` as the hint and the menu name it (MD-8).
    pub fn model_name(&self, provider: Provider) -> String {
        let id = match provider {
            Provider::OpenRouter => self.openrouter().model,
            Provider::OpenAi => self.openai().model,
            Provider::Anthropic => self.anthropic().model,
        }
        .unwrap_or_default();
        id.rsplit('/').next().unwrap_or(&id).to_string()
    }

    /// What `provider` says, as written.
    pub fn provider(&self) -> &str {
        &self.provider
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        if !PROVIDERS.contains(&self.provider.as_str()) {
            return Err(format!(
                "{FILE}: provider must be ollama, openrouter, openai or anthropic."
            ));
        }
        if let Some(s) = &self.openrouter {
            not_blank("openrouter.key", &s.key)?;
            not_blank("openrouter.model", &s.model)?;
            one_of("openrouter.reasoning", &s.reasoning, &REASONING)?;
            one_of("openrouter.tier", &s.tier, &TIERS)?;
        }
        if let Some(s) = &self.openai {
            not_blank("openai.model", &s.model)?;
            one_of("openai.reasoning", &s.reasoning, &REASONING)?;
        }
        if let Some(s) = &self.anthropic {
            not_blank("anthropic.model", &s.model)?;
            one_of("anthropic.effort", &s.effort, &EFFORT)?;
        }
        Ok(())
    }
}

/// Defaults of a section the user has not written (MD-10).
impl OpenRouter {
    pub fn filled(self) -> Self {
        if self.model.is_some() {
            return self;
        }
        Self {
            model: Some("openai/gpt-6-luna".into()),
            reasoning: self.reasoning.or(Some("high".into())),
            tier: self.tier.or(Some("fast".into())),
            ..self
        }
    }
}
impl OpenAi {
    pub fn filled(self) -> Self {
        if self.model.is_some() {
            return self;
        }
        Self {
            model: Some("gpt-6-luna".into()),
            reasoning: self.reasoning.or(Some("high".into())),
        }
    }
}
impl Anthropic {
    pub fn filled(self) -> Self {
        if self.model.is_some() {
            return self;
        }
        Self {
            model: Some("claude-opus-5-5".into()),
            effort: self.effort.or(Some("low".into())),
        }
    }
}

/// Reads `model.json` from its bytes; None is a missing file, which means Ollama (MD-1).
pub fn parse(bytes: Option<&[u8]>) -> Result<Settings, String> {
    let Some(data) = bytes else {
        return Ok(Settings::default());
    };
    let settings: Settings = serde_json::from_slice(data).map_err(|e| format!("{FILE}: {e}"))?;
    settings.validate()?;
    Ok(settings)
}

/// Reads `model.json`; a missing file means Ollama (MD-1).
pub fn load(dir: &Path) -> Result<Settings, String> {
    let data = match std::fs::read(dir.join(FILE)) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        other => Some(other.map_err(|e| format!("{FILE}: {e}"))?),
    };
    parse(data.as_deref())
}

/// The bytes Sushi writes, after the same check a read makes.
pub fn render(settings: &Settings) -> Result<Vec<u8>, String> {
    settings.validate()?;
    let mut text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    text.push('\n');
    Ok(text.into_bytes())
}

/// What a change of `model.json` left behind: the bytes it replaced, for a rollback, and the
/// revision it wrote.
pub struct Modified {
    pub before: Option<Vec<u8>>,
    pub revision: String,
    /// What the file holds when the lock is released: the reply of a save describes this.
    pub after: files::Written,
}

/// Changes `model.json` under its lock (files.rs): reads it, lets `f` change the settings and
/// writes them when `f` says it changed something. A file that does not validate is never
/// replaced with what Sushi read before; nor is one that changed since `expected`.
pub fn modify(
    dir: &Path,
    expected: Option<&str>,
    f: impl FnOnce(&mut Settings) -> Result<bool, String>,
) -> Result<Modified, Refusal> {
    let (before, revision, after) =
        files::update_written(dir, FileName::Model, expected, |bytes| {
            let mut settings = parse(bytes).map_err(Refusal::Invalid)?;
            let before = bytes.map(<[u8]>::to_vec);
            if !f(&mut settings).map_err(Refusal::Invalid)? {
                return Ok((Change::Keep, before));
            }
            let new = render(&settings).map_err(Refusal::Invalid)?;
            Ok((Change::Write(new), before))
        })?;
    Ok(Modified {
        before,
        revision,
        after,
    })
}

/// Writes the whole file at once, after validating it; a key of v0.2.1 stays until
/// [`move_key`] or [`Settings::forget_key`]. Sushi itself changes the file with [`modify`].
#[cfg(test)]
pub fn save(dir: &Path, settings: &Settings) -> Result<(), String> {
    let new = render(settings)?;
    files::update(dir, FileName::Model, None, |_| Ok((Change::Write(new), ())))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// A key left in the file by v0.2.1 moves to the keychain, and leaves the file only once it is
/// stored there; `reasoning` and `tier` stay (MD-12). The keychain is written without the
/// file's lock, so the file loses the key only if it still holds that same key. Returns the
/// settings as they are now.
pub fn move_key(dir: &Path, keychain: &Keychain) -> Result<Settings, String> {
    let settings = load(dir)?;
    let Some(written) = settings.openrouter.as_ref().and_then(|s| s.key.clone()) else {
        return Ok(settings);
    };
    let provider = Provider::OpenRouter;
    keychain.store(provider.id(), &provider.label(), written.trim())?;
    modify(dir, None, |now| {
        let section = now
            .openrouter
            .as_mut()
            .filter(|s| s.key.as_ref() == Some(&written));
        Ok(section.map(|s| s.key = None).is_some())
    })
    .map_err(|e| e.to_string())?;
    load(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const EXAMPLE: &str = include_str!("../../docs/specs/examples/model.json");

    fn with(contents: Option<&str>) -> Result<Settings, String> {
        let dir = tempfile::tempdir().unwrap();
        if let Some(contents) = contents {
            fs::write(dir.path().join(FILE), contents).unwrap();
        }
        load(dir.path())
    }

    #[test]
    fn reads_the_choice() {
        let none = with(None).unwrap();
        assert_eq!(none.active(), None, "no file: Ollama");
        assert_eq!(
            with(Some(r#"{"provider": "ollama"}"#)).unwrap().active(),
            None
        );
        let example = with(Some(EXAMPLE)).unwrap();
        assert_eq!(example.active(), Some(Provider::OpenRouter));
        let openrouter = example.openrouter();
        assert_eq!(openrouter.model.as_deref(), Some("openai/gpt-6-luna"));
        assert_eq!(example.model_name(Provider::OpenRouter), "gpt-6-luna");
        assert_eq!(openrouter.reasoning.as_deref(), Some("high"));
        assert_eq!(openrouter.tier.as_deref(), Some("fast"));
        assert_eq!(openrouter.key, None, "the example has no key");
        // Switching back keeps the sections for later.
        let kept = EXAMPLE.replace(r#""provider": "openrouter""#, r#""provider": "ollama""#);
        let kept = with(Some(&kept)).unwrap();
        assert_eq!(kept.active(), None);
        assert_eq!(kept.openrouter(), openrouter);
        // A section the user wrote is taken as it is: no reasoning means none is sent.
        let written = with(Some(
            r#"{"provider": "openrouter", "openrouter": {"model": "m/x"}}"#,
        ))
        .unwrap();
        assert_eq!(
            written.openrouter(),
            OpenRouter {
                model: Some("m/x".into()),
                ..Default::default()
            }
        );
        // Without a section each provider has its defaults (MD-10).
        let bare = with(Some(r#"{"provider": "anthropic"}"#)).unwrap();
        assert_eq!(bare.active(), Some(Provider::Anthropic));
        assert_eq!(bare.model_name(Provider::Anthropic), "claude-opus-5-5");
        assert_eq!(bare.anthropic().effort.as_deref(), Some("low"));
        assert_eq!(bare.model_name(Provider::OpenAi), "gpt-6-luna");
        assert_eq!(bare.openrouter().tier.as_deref(), Some("fast"));
    }

    #[test]
    fn rejects_invalid_files() {
        let error = |contents: &str| with(Some(contents)).unwrap_err();
        assert_eq!(
            error(r#"{"provider": "mistral"}"#),
            "model.json: provider must be ollama, openrouter, openai or anthropic."
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
            section(r#""model": """#),
            "model.json: openrouter.model is empty."
        );
        assert_eq!(
            section(r#""model": "m", "tier": "priority""#),
            "model.json: openrouter.tier must be one of default, flex, fast, ultrafast."
        );
        assert_eq!(
            section(r#""model": "m", "reasoning": "max""#),
            "model.json: openrouter.reasoning must be one of none, minimal, low, medium, high, xhigh."
        );
        assert!(section(r#""model": "m", "temperature": 0"#)
            .starts_with("model.json: unknown field `temperature`"));
        assert_eq!(
            error(r#"{"provider": "openai", "openai": {"reasoning": "max"}}"#),
            "model.json: openai.reasoning must be one of none, minimal, low, medium, high, xhigh."
        );
        assert_eq!(
            error(r#"{"provider": "anthropic", "anthropic": {"effort": "none"}}"#),
            "model.json: anthropic.effort must be one of low, medium, high, xhigh, max."
        );
        assert!(error(r#"{"provider": "openai", "openai": {"key": "k"}}"#)
            .starts_with("model.json: unknown field `key`"));
        assert!(error("{").starts_with("model.json: EOF while parsing"));
        // An invalid section is an error even while Ollama is chosen: it would fail on the switch.
        assert_eq!(
            error(r#"{"provider": "ollama", "openrouter": {"model": ""}}"#),
            "model.json: openrouter.model is empty."
        );
    }

    #[test]
    fn choosing_writes_the_defaults_and_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let mut settings = load(dir.path()).unwrap();
        settings.choose(Some(Provider::OpenAi));
        save(dir.path(), &settings).unwrap();
        let text = fs::read_to_string(dir.path().join(FILE)).unwrap();
        assert_eq!(
            text,
            "{\n  \"provider\": \"openai\",\n  \"openai\": {\n    \"model\": \"gpt-6-luna\",\n    \"reasoning\": \"high\"\n  }\n}\n"
        );
        let mut settings = load(dir.path()).unwrap();
        settings.choose(None);
        save(dir.path(), &settings).unwrap();
        let back = load(dir.path()).unwrap();
        assert_eq!(back.active(), None);
        assert_eq!(back.openai, settings.openai, "the section stays for later");
    }

    #[test]
    fn a_key_from_v0_2_1_moves_to_the_keychain() {
        let scratch = crate::keychain::tests::scratch();
        let dir = tempfile::tempdir().unwrap();
        let old = r#"{"provider": "openrouter", "openrouter": {"key": " sk-or-v1-old ", "model": "openai/gpt-6-luna", "reasoning": "high", "tier": "fast"}}"#;
        fs::write(dir.path().join(FILE), old).unwrap();
        let moved = move_key(dir.path(), &scratch.keychain).unwrap();
        assert_eq!(
            scratch.keychain.read("openrouter").as_deref(),
            Some("sk-or-v1-old")
        );
        let text = fs::read_to_string(dir.path().join(FILE)).unwrap();
        assert!(!text.contains("sk-or"), "{text}");
        assert!(text.contains("\"reasoning\": \"high\"") && text.contains("\"tier\": \"fast\""));
        assert_eq!(moved.active(), Some(Provider::OpenRouter));
        // A key that cannot be stored stays in the file.
        let broken = crate::keychain::Keychain {
            file: Some(dir.path().join("missing.keychain-db")),
        };
        fs::write(dir.path().join(FILE), old).unwrap();
        assert!(move_key(dir.path(), &broken).is_err());
        assert_eq!(fs::read_to_string(dir.path().join(FILE)).unwrap(), old);
        // …and switching the provider meanwhile keeps it there.
        let mut settings = load(dir.path()).unwrap();
        settings.choose(None);
        save(dir.path(), &settings).unwrap();
        let mut kept = load(dir.path()).unwrap();
        assert_eq!(
            kept.openrouter.clone().unwrap().key.as_deref(),
            Some(" sk-or-v1-old ")
        );
        // Connecting again or disconnecting drops it, so it can no longer win over the keychain.
        assert!(kept.forget_key());
        assert!(!kept.forget_key());
        save(dir.path(), &kept).unwrap();
        assert!(!fs::read_to_string(dir.path().join(FILE))
            .unwrap()
            .contains("sk-or"));
    }

    #[test]
    fn a_save_validates_before_it_writes() {
        let dir = tempfile::tempdir().unwrap();
        let mut settings = load(dir.path()).unwrap();
        settings.openai = Some(OpenAi {
            reasoning: Some("max".into()),
            ..Default::default()
        });
        assert_eq!(
            save(dir.path(), &settings).unwrap_err(),
            "model.json: openai.reasoning must be one of none, minimal, low, medium, high, xhigh."
        );
        assert!(!dir.path().join(FILE).exists(), "nothing is written");
        // A change based on a revision the file no longer has is refused.
        fs::write(dir.path().join(FILE), r#"{"provider": "ollama"}"#).unwrap();
        let stale = modify(dir.path(), Some("absent"), |s| {
            s.choose(Some(Provider::OpenAi));
            Ok(true)
        });
        assert!(matches!(stale, Err(Refusal::Changed)));
        assert_eq!(
            fs::read_to_string(dir.path().join(FILE)).unwrap(),
            r#"{"provider": "ollama"}"#
        );
    }
}
