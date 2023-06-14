use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{self, Write},
    path::Path,
    process::Command,
};
use tauri::{AppHandle, Manager};

const RULES: &str = include_str!("../../docs/specs/examples/rules.json");
const DICTIONARY: &str = include_str!("../../docs/specs/examples/dictionary.json");

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    id: String,
    name: String,
    /// A model edit. Exactly one of `instruction` and `prefix` is present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    instruction: Option<String>,
    /// A local edit that prepends this text to the whole prompt, kept verbatim (it may end with a space).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prefix: Option<String>,
    aliases: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Term {
    from: String,
    to: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Rules {
    rules: Vec<Rule>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Dictionary {
    terms: Vec<Term>,
}

#[derive(Serialize)]
pub struct Settings {
    rules: Vec<Rule>,
    terms: Vec<Term>,
}

fn validate_rules(rules: &[Rule]) -> Result<(), String> {
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

fn validate_terms(terms: &[Term]) -> Result<(), String> {
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

// Existing files always win, so edits survive. A missing file is seeded from its example.
fn read_json<T: DeserializeOwned>(dir: &Path, name: &str, example: &str) -> Result<T, String> {
    let path = dir.join(name);
    let data = match fs::read(&path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => fs::create_dir_all(dir)
            .and_then(|()| create_once(&path, example.as_bytes()))
            .and_then(|()| fs::read(&path)),
        other => other,
    }
    .map_err(|e| format!("{name}: {e}"))?;
    serde_json::from_slice(&data).map_err(|e| format!("{name}: {e}"))
}

fn load(dir: &Path) -> Result<Settings, String> {
    let rules: Rules = read_json(dir, "rules.json", RULES)?;
    let dictionary: Dictionary = read_json(dir, "dictionary.json", DICTIONARY)?;
    validate_rules(&rules.rules)?;
    validate_terms(&dictionary.terms)?;
    Ok(Settings {
        rules: rules.rules,
        terms: dictionary.terms,
    })
}

#[tauri::command]
pub async fn settings_load(app: AppHandle) -> Result<Settings, String> {
    load(&app.path().app_data_dir().map_err(|e| e.to_string())?)
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
        load(dir).err().expect("settings should be rejected")
    }

    #[test]
    fn first_run_seeds_examples() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("fresh");
        let settings = load(&dir).unwrap();
        assert_eq!(fs::read_to_string(dir.join("rules.json")).unwrap(), RULES);
        assert_eq!(
            fs::read_to_string(dir.join("dictionary.json")).unwrap(),
            DICTIONARY
        );
        assert!(settings.rules.iter().any(|r| r.id == "shorten"));
        let goal = &settings.rules[0];
        assert_eq!(goal.id, "goal");
        assert_eq!(
            goal.prefix.as_deref(),
            Some("/goal "),
            "the trailing space is kept"
        );
        assert!(goal.instruction.is_none());
        let json = serde_json::to_value(goal).unwrap();
        assert!(json.get("instruction").is_none());
        assert_eq!(settings.terms[0].to, "MacWhisper");
    }

    #[test]
    fn existing_files_win_and_reload_sees_edits() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let rules = r#"{"rules":[]}"#;
        fs::write(dir.join("rules.json"), rules).unwrap();
        let settings = load(dir).unwrap();
        assert!(settings.rules.is_empty());
        assert_eq!(fs::read_to_string(dir.join("rules.json")).unwrap(), rules);
        assert_eq!(settings.terms.len(), 1);
        fs::write(
            dir.join("dictionary.json"),
            r#"{"terms":[{"from":"sushi","to":"Sushi"}]}"#,
        )
        .unwrap();
        assert_eq!(load(dir).unwrap().terms[0].to, "Sushi");
    }

    #[test]
    fn invalid_entries_name_file_and_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        load(dir).unwrap();
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
}
