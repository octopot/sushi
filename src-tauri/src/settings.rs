use crate::files::{self, FileName};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{self, Write},
    path::Path,
    process::Command,
};
use tauri::{AppHandle, Manager};

pub(crate) const RULES: &str = include_str!("../../docs/specs/examples/rules.json");
pub(crate) const DICTIONARY: &str = include_str!("../../docs/specs/examples/dictionary.json");

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct Rule {
    pub(crate) id: String,
    pub(crate) name: String,
    /// A model edit. Exactly one of `instruction` and `prefix` is present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub(crate) instruction: Option<String>,
    /// A local edit that prepends this text to the whole prompt, kept verbatim (it may end with a space).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub(crate) prefix: Option<String>,
    pub(crate) aliases: Vec<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct Term {
    pub(crate) from: String,
    pub(crate) to: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Rules {
    rules: Vec<Rule>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Dictionary {
    terms: Vec<Term>,
}

/// What the panel reads on every show. The two files are independent (LF-4): the one that is
/// invalid comes as null, so the page keeps what it last read for it, and `error` names the first
/// problem.
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Settings {
    rules: Option<Vec<Rule>>,
    terms: Option<Vec<Term>>,
    error: Option<String>,
}

pub(crate) fn validate_rules(rules: &[Rule]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for (i, r) in rules.iter().enumerate() {
        let kind: Vec<&String> = [&r.instruction, &r.prefix].into_iter().flatten().collect();
        if kind.len() != 1 {
            return Err(format!(
                "rules.json: entry {} needs exactly one of 'instruction' or 'prefix'.",
                i + 1
            ));
        }
        if [&r.id, &r.name, kind[0]]
            .into_iter()
            .chain(&r.aliases)
            .any(|s| s.trim().is_empty())
        {
            return Err(format!(
                "rules.json: entry {} contains an empty field.",
                i + 1
            ));
        }
        if !ids.insert(&r.id) {
            return Err(format!("rules.json: duplicate rule ID '{}'.", r.id));
        }
    }
    Ok(())
}

pub(crate) fn validate_terms(terms: &[Term]) -> Result<(), String> {
    let mut sources = HashSet::new();
    for (i, t) in terms.iter().enumerate() {
        if t.from.trim().is_empty() || t.to.trim().is_empty() {
            return Err(format!(
                "dictionary.json: entry {} needs both 'from' and 'to'.",
                i + 1
            ));
        }
        if !sources.insert(t.from.trim().to_lowercase()) {
            return Err(format!("dictionary.json: duplicate source '{}'.", t.from));
        }
    }
    Ok(())
}

/// Reads the actions out of the bytes of `rules.json`, checked as Sushi uses them.
pub(crate) fn parse_rules(bytes: &[u8]) -> Result<Vec<Rule>, String> {
    let rules: Rules = serde_json::from_slice(bytes).map_err(|e| format!("rules.json: {e}"))?;
    validate_rules(&rules.rules)?;
    Ok(rules.rules)
}

/// Reads the terms out of the bytes of `dictionary.json`, checked the same way.
pub(crate) fn parse_terms(bytes: &[u8]) -> Result<Vec<Term>, String> {
    let dictionary: Dictionary =
        serde_json::from_slice(bytes).map_err(|e| format!("dictionary.json: {e}"))?;
    validate_terms(&dictionary.terms)?;
    Ok(dictionary.terms)
}

/// Checks `rules.json` as Sushi would read it, without seeding anything; the number of actions.
pub(crate) fn check_rules(bytes: &[u8]) -> Result<usize, String> {
    parse_rules(bytes).map(|r| r.len())
}

/// Checks `dictionary.json` the same way; the number of terms.
pub(crate) fn check_terms(bytes: &[u8]) -> Result<usize, String> {
    parse_terms(bytes).map(|t| t.len())
}

/// JSON with a space after `:` and `,`, as the examples are written.
struct Spaced;

impl serde_json::ser::Formatter for Spaced {
    fn begin_object_key<W: ?Sized + Write>(&mut self, w: &mut W, first: bool) -> io::Result<()> {
        if first {
            Ok(())
        } else {
            w.write_all(b", ")
        }
    }
    fn begin_object_value<W: ?Sized + Write>(&mut self, w: &mut W) -> io::Result<()> {
        w.write_all(b": ")
    }
    fn begin_array_value<W: ?Sized + Write>(&mut self, w: &mut W, first: bool) -> io::Result<()> {
        if first {
            Ok(())
        } else {
            w.write_all(b", ")
        }
    }
}

/// One entry per line under its key, as the shipped examples are, so a hand edit and a diff
/// stay readable.
fn render<T: Serialize>(key: &str, entries: &[T]) -> Vec<u8> {
    let mut out = format!("{{\n  \"{key}\": [");
    for (i, entry) in entries.iter().enumerate() {
        let mut line = Vec::new();
        let mut ser = serde_json::Serializer::with_formatter(&mut line, Spaced);
        entry
            .serialize(&mut ser)
            .expect("a rule or a term serializes");
        out.push_str(if i == 0 { "\n    " } else { ",\n    " });
        out.push_str(&String::from_utf8_lossy(&line));
    }
    out.push_str(if entries.is_empty() {
        "]\n}\n"
    } else {
        "\n  ]\n}\n"
    });
    out.into_bytes()
}

/// The bytes Sushi writes for these actions, after the same check a read makes.
pub(crate) fn render_rules(rules: &[Rule]) -> Result<Vec<u8>, String> {
    validate_rules(rules)?;
    Ok(render("rules", rules))
}

/// The bytes Sushi writes for these terms, after the same check a read makes.
pub(crate) fn render_terms(terms: &[Term]) -> Result<Vec<u8>, String> {
    validate_terms(terms)?;
    Ok(render("terms", terms))
}

/// Writes a whole file at once: a reader sees the old text or the new one, never a part.
pub(crate) fn replace(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().expect("a folder"))?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map(|_| ()).map_err(|e| e.error)
}

pub(crate) fn create_once(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().expect("settings directory"))?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    match tmp.persist_noclobber(path) {
        Ok(_) => Ok(()),
        Err(e) if e.error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e.error),
    }
}

/// The bytes of a file Sushi seeds on first use (LF-3). Existing files always win, so edits
/// survive; a missing file is created from its example, through the one writer (files.rs).
pub(crate) fn read_seeded(dir: &Path, name: FileName, example: &str) -> Result<Vec<u8>, String> {
    let path = dir.join(name.as_str());
    match fs::read(&path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            files::seed(dir, name, example.as_bytes()).and_then(|()| fs::read(&path))
        }
        other => other,
    }
    .map_err(|e| format!("{}: {e}", name.as_str()))
}

pub(crate) fn load_rules(dir: &Path) -> Result<Vec<Rule>, String> {
    parse_rules(&read_seeded(dir, FileName::Rules, RULES)?)
}

pub(crate) fn load_terms(dir: &Path) -> Result<Vec<Term>, String> {
    parse_terms(&read_seeded(dir, FileName::Dictionary, DICTIONARY)?)
}

fn load(dir: &Path) -> Settings {
    let rules = load_rules(dir);
    let terms = load_terms(dir);
    let error = rules.as_ref().err().or(terms.as_ref().err()).cloned();
    Settings {
        rules: rules.ok(),
        terms: terms.ok(),
        error,
    }
}

#[tauri::command]
pub async fn settings_load(app: AppHandle) -> Result<Settings, String> {
    Ok(load(&app.path().app_data_dir().map_err(|e| e.to_string())?))
}

#[tauri::command]
pub async fn dictionary_open(app: AppHandle) -> Result<(), String> {
    if crate::staged() {
        return Ok(());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("dictionary.json");
    if !fs::symlink_metadata(&path)
        .map_err(|e| format!("dictionary.json: {e}"))?
        .is_file()
    {
        return Err("dictionary.json must be a regular file.".into());
    }
    let output = Command::new("/usr/bin/open")
        .arg("-t")
        .arg(path)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Could not open dictionary.json: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error(dir: &Path) -> String {
        load(dir).error.expect("settings should be rejected")
    }

    #[test]
    fn first_run_seeds_examples() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("fresh");
        let loaded = load(&dir);
        assert_eq!(loaded.error, None);
        let settings = (loaded.rules.unwrap(), loaded.terms.unwrap());
        assert_eq!(fs::read_to_string(dir.join("rules.json")).unwrap(), RULES);
        assert_eq!(
            fs::read_to_string(dir.join("dictionary.json")).unwrap(),
            DICTIONARY
        );
        assert!(settings.0.iter().any(|r| r.id == "shorten"));
        let goal = &settings.0[0];
        assert_eq!(goal.id, "goal");
        assert_eq!(
            goal.prefix.as_deref(),
            Some("/goal "),
            "the trailing space is kept"
        );
        assert!(goal.instruction.is_none());
        let json = serde_json::to_value(goal).unwrap();
        assert!(json.get("instruction").is_none());
        assert_eq!(settings.1[0].to, "MacWhisper");
    }

    #[test]
    fn existing_files_win_and_reload_sees_edits() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let rules = r#"{"rules":[]}"#;
        fs::write(dir.join("rules.json"), rules).unwrap();
        let settings = load(dir);
        assert!(settings.rules.unwrap().is_empty());
        assert_eq!(fs::read_to_string(dir.join("rules.json")).unwrap(), rules);
        assert_eq!(settings.terms.unwrap().len(), 1);
        fs::write(
            dir.join("dictionary.json"),
            r#"{"terms":[{"from":"sushi","to":"Sushi"}]}"#,
        )
        .unwrap();
        assert_eq!(load(dir).terms.unwrap()[0].to, "Sushi");
    }

    #[test]
    fn invalid_entries_name_file_and_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        assert_eq!(load(dir).error, None);
        let dictionary = dir.join("dictionary.json");
        for (bad, message) in [
            (
                r#"{"terms":[{"from":"x","to":" "}]}"#,
                "dictionary.json: entry 1",
            ),
            (
                r#"{"terms":[{"from":"Voice","to":"A"},{"from":" voice ","to":"B"}]}"#,
                "dictionary.json: duplicate source ' voice '",
            ),
            (r#"{"terms":42}"#, "dictionary.json: "),
        ] {
            fs::write(&dictionary, bad).unwrap();
            assert!(error(dir).starts_with(message), "{bad}");
            assert_eq!(fs::read_to_string(&dictionary).unwrap(), bad);
        }
        fs::remove_file(&dictionary).unwrap();
        let rule = r#"{"id":"a","name":"A","instruction":"I","aliases":[]}"#;
        fs::write(
            dir.join("rules.json"),
            format!(r#"{{"rules":[{rule},{rule}]}}"#),
        )
        .unwrap();
        assert_eq!(error(dir), "rules.json: duplicate rule ID 'a'.");
        fs::write(
            dir.join("rules.json"),
            r#"{"rules":[{"id":"a","name":"A","instruction":"I","aliases":[""]}]}"#,
        )
        .unwrap();
        assert_eq!(error(dir), "rules.json: entry 1 contains an empty field.");
        for bad in [
            r#"{"rules":[{"id":"a","name":"A","aliases":[]}]}"#,
            r#"{"rules":[{"id":"a","name":"A","instruction":"I","prefix":"/goal ","aliases":[]}]}"#,
        ] {
            fs::write(dir.join("rules.json"), bad).unwrap();
            assert_eq!(
                error(dir),
                "rules.json: entry 1 needs exactly one of 'instruction' or 'prefix'.",
                "{bad}"
            );
        }
        fs::write(
            dir.join("rules.json"),
            r#"{"rules":[{"id":"a","name":"A","prefix":" ","aliases":[]}]}"#,
        )
        .unwrap();
        assert_eq!(error(dir), "rules.json: entry 1 contains an empty field.");
    }

    #[test]
    fn rules_and_the_dictionary_are_read_independently() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        fs::write(dir.join("dictionary.json"), r#"{"terms":42}"#).unwrap();
        let loaded = load(dir);
        assert!(
            loaded.rules.is_some(),
            "a broken dictionary keeps the actions"
        );
        assert!(loaded.terms.is_none());
        assert!(loaded.error.unwrap().starts_with("dictionary.json: "));
        fs::write(dir.join("dictionary.json"), DICTIONARY).unwrap();
        fs::write(dir.join("rules.json"), r#"{"rules":[{}]}"#).unwrap();
        let loaded = load(dir);
        assert!(loaded.rules.is_none());
        assert_eq!(loaded.terms.unwrap().len(), 1, "and the other way round");
        assert!(loaded.error.unwrap().starts_with("rules.json: "));
        let json = serde_json::to_value(load(dir)).unwrap();
        assert_eq!(json["rules"], serde_json::Value::Null);
    }

    #[test]
    fn writes_what_it_reads_one_entry_per_line() {
        let rules = parse_rules(RULES.as_bytes()).unwrap();
        assert_eq!(
            String::from_utf8(render_rules(&rules).unwrap()).unwrap(),
            RULES
        );
        let terms = parse_terms(DICTIONARY.as_bytes()).unwrap();
        assert_eq!(parse_terms(&render_terms(&terms).unwrap()).unwrap(), terms);
        assert_eq!(render_rules(&[]).unwrap(), b"{\n  \"rules\": []\n}\n");
        let mut bad = rules.clone();
        bad[1].name = " ".into();
        assert_eq!(
            render_rules(&bad).unwrap_err(),
            "rules.json: entry 2 contains an empty field."
        );
    }
}
