use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{self, BufRead, BufReader, Read},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    title: Option<String>,
    updated_at: Option<u64>,
}

/// A library collection: the prompts in the folder itself, or the templates in its `.templates`.
#[derive(Deserialize, Clone, Copy, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Documents,
    Templates,
}

pub(crate) const PATH_FILE: &str = "library-path.txt";

/// The folder `library-path.txt` names, from its bytes: one absolute path, a line break allowed.
pub(crate) fn parse_path(bytes: &[u8]) -> Result<PathBuf, String> {
    let value = std::str::from_utf8(bytes)
        .map_err(|_| "Enter an absolute library directory in library-path.txt.".to_string())?;
    let dir = PathBuf::from(value.trim_end_matches(['\r', '\n']));
    if !dir.is_absolute() {
        return Err("Enter an absolute library directory in library-path.txt.".into());
    }
    Ok(dir)
}

/// The folder the environment sets, which wins over the file (LF-11).
pub(crate) fn environment() -> Option<PathBuf> {
    env::var_os("SUSHI_LIBRARY_DIR")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
}

/// Where the library comes from (LF-11): the folder, and `environment`, `custom` or `default`.
pub(crate) fn source(data: &Path) -> Result<(PathBuf, &'static str), String> {
    if let Some(path) = environment() {
        return Ok((path, "environment"));
    }
    match fs::read(data.join(PATH_FILE)) {
        Ok(bytes) => Ok((parse_path(&bytes)?, "custom")),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok((data.join("Input"), "default")),
        // The same words as the settings window's file state (files.rs).
        Err(err) => Err(format!("{PATH_FILE}: {err}")),
    }
}

/// How many templates a library folder lists: a folder without `.templates` yet has none
/// (Sushi creates it with its examples on the first look); None when it cannot be read.
pub(crate) fn count_templates(dir: &Path) -> Option<usize> {
    let templates = dir.join(".templates");
    match fs::symlink_metadata(&templates) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => fs::read_dir(dir).ok().map(|_| 0),
        _ => count(&templates),
    }
}

fn directory(app: &AppHandle, kind: Kind) -> Result<PathBuf, String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let (base, _) = source(&data)?;
    Ok(match kind {
        Kind::Documents => base,
        Kind::Templates => base.join(".templates"),
    })
}

/// How many prompts a folder lists, by the rules of LF-12, without creating or reading anything
/// but the folder itself; `None` when it cannot be read.
pub(crate) fn count(dir: &Path) -> Option<usize> {
    let items = fs::read_dir(dir).ok()?;
    Some(
        items
            .flatten()
            .filter(|item| item.file_type().is_ok_and(|kind| kind.is_file()))
            .filter(|item| {
                let path = item.path();
                path.extension().and_then(|s| s.to_str()) == Some("md")
                    && path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .is_some_and(valid_stem)
            })
            .count(),
    )
}

fn list(dir: &Path, templates: bool) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    fs::create_dir_all(dir)?;
    for item in fs::read_dir(dir)? {
        let Ok(item) = item else { continue };
        let path = item.path();
        if !item.file_type().is_ok_and(|kind| kind.is_file())
            || path.extension().and_then(|s| s.to_str()) != Some("md")
        {
            continue;
        }
        if let Some(name) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .filter(|s| valid_stem(s))
        {
            let modified = item.metadata().and_then(|m| m.modified()).ok();
            entries.push(Entry {
                name: name.into(),
                title: if templates {
                    template_title(dir, name).ok().flatten()
                } else {
                    None
                },
                updated_at: modified
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64),
            });
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn valid_stem(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
}

fn open_file(dir: &Path, name: &str) -> io::Result<fs::File> {
    if !valid_stem(name) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid filename.",
        ));
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(dir.join(format!("{name}.md")))?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Choose a regular Markdown file.",
        ));
    }
    Ok(file)
}

fn read(dir: &Path, name: &str) -> io::Result<String> {
    let mut file = open_file(dir, name)?;
    let mut text = String::new();
    file.read_to_string(&mut text)?;
    Ok(text)
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TemplateHeader {
    title: String,
}

const HEADER_LIMIT: u64 = 16 * 1024;
const TEMPLATES: [(&str, &str); 3] = [
    (
        "task-brief.md",
        include_str!("../../docs/specs/examples/task-brief.md"),
    ),
    (
        "bug-report.md",
        include_str!("../../docs/specs/examples/bug-report.md"),
    ),
    (
        "release-review.md",
        include_str!("../../docs/specs/examples/release-review.md"),
    ),
];

fn ensure_templates(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let marker = dir.join(".initialized-v1");
    if !marker.try_exists()? {
        for (name, text) in TEMPLATES {
            crate::settings::create_once(&dir.join(name), text.as_bytes())?;
        }
        crate::settings::create_once(&marker, b"1\n")?;
    }
    Ok(())
}

fn mentions_title(yaml: &[u8]) -> bool {
    yaml.split(|b| *b == b'\n').any(|line| {
        let line = line.trim_ascii_start();
        [b"title:".as_slice(), b"'title':", b"\"title\":"]
            .iter()
            .any(|key| line.starts_with(key))
    })
}

// Limit metadata reads even if a legacy Markdown file has no line breaks.
fn header(reader: impl Read) -> io::Result<Option<(TemplateHeader, usize)>> {
    let mut limited = BufReader::new(reader.take(HEADER_LIMIT + 1));
    let mut line = Vec::new();
    let mut size = limited.read_until(b'\n', &mut line)?;
    let delimiter = |line: &[u8]| matches!(line, b"---\n" | b"---\r\n" | b"---");
    if !delimiter(&line) {
        return Ok(None);
    }
    let mut yaml = Vec::new();
    loop {
        line.clear();
        let len = limited.read_until(b'\n', &mut line)?;
        size += len;
        if len == 0 || size as u64 > HEADER_LIMIT {
            // A plain Markdown template can start with a horizontal rule.
            if mentions_title(&yaml) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Unclosed or oversized template frontmatter.",
                ));
            }
            return Ok(None);
        }
        if delimiter(&line) {
            break;
        }
        yaml.extend_from_slice(&line);
    }
    // Old Markdown may use horizontal rules around arbitrary prose, including text
    // that resembles broken YAML. Only an explicit title introduces our metadata.
    let value: serde_yaml_ng::Value = match serde_yaml_ng::from_slice(&yaml) {
        Ok(value) => value,
        Err(error) if mentions_title(&yaml) => {
            return Err(io::Error::new(io::ErrorKind::InvalidData, error))
        }
        Err(_) => return Ok(None),
    };
    if value.get("title").is_none() {
        return Ok(None);
    }
    let meta: TemplateHeader = serde_yaml_ng::from_value(value)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    if meta.title.trim().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Template title cannot be empty.",
        ));
    }
    Ok(Some((meta, size)))
}

fn template_title(dir: &Path, name: &str) -> io::Result<Option<String>> {
    Ok(header(open_file(dir, name)?)?.map(|(meta, _)| meta.title))
}

fn section(text: &str, templates: bool) -> io::Result<&str> {
    let offset = if templates {
        header(text.as_bytes())?.map_or(0, |(_, len)| len)
    } else {
        0
    };
    Ok(&text[offset..])
}

#[tauri::command]
pub async fn library_list(app: AppHandle, kind: Kind) -> Result<Vec<Entry>, String> {
    let templates = kind == Kind::Templates;
    let dir = directory(&app, kind)?;
    if templates {
        ensure_templates(&dir).map_err(|e| e.to_string())?;
    }
    list(&dir, templates).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn library_read(app: AppHandle, kind: Kind, name: String) -> Result<String, String> {
    let templates = kind == Kind::Templates;
    let text = read(&directory(&app, kind)?, &name)
        .map_err(|e| format!("Could not read '{name}': {e}"))?;
    section(&text, templates)
        .map(String::from)
        .map_err(|e| format!("{name}.md: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn templates_read_titles_and_preserve_legacy_markdown() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        ensure_templates(dir).unwrap();
        let seeded = list(dir, true).unwrap();
        let titles: Vec<_> = seeded.iter().filter_map(|e| e.title.as_deref()).collect();
        assert_eq!(titles, ["Bug report", "Release review", "Task brief"]);
        let raw = "---\r\ntitle: 'Brief: design'\r\n---\r\n# Body\n";
        fs::write(dir.join("custom.md"), raw).unwrap();
        assert_eq!(section(raw, true).unwrap(), "# Body\n");
        assert_eq!(section(raw, false).unwrap(), raw);
        assert_eq!(section("---\nPlain note", true).unwrap(), "---\nPlain note");
        let legacy = "---\nA: [broken YAML\n---\nBody";
        assert_eq!(section(legacy, true).unwrap(), legacy);
        let map = "---\nlegacy: value\n---\nBody";
        assert_eq!(section(map, true).unwrap(), map);
        assert!(section("---\ntitle: [broken\n---\nBody", true).is_err());
        assert!(section("---\ntitle: []\n---\nbody", true).is_err());
        fs::remove_file(dir.join("task-brief.md")).unwrap();
        ensure_templates(dir).unwrap();
        assert!(!dir.join("task-brief.md").exists());
        // Users initialized before new examples shipped get nothing new.
        let old = tempfile::tempdir().unwrap();
        fs::write(old.path().join(".initialized-v1"), "1\n").unwrap();
        ensure_templates(old.path()).unwrap();
        assert!(list(old.path(), true).unwrap().is_empty());
    }

    #[test]
    fn reads_markdown_and_rejects_unsafe_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        fs::write(dir.join("Пример.md"), "# Текст\n").unwrap();
        assert_eq!(read(dir, "Пример").unwrap(), "# Текст\n");
        let entries = list(dir, false).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "Пример");
        assert!(entries[0].updated_at.is_some());
        assert!(read(dir, "../outside").is_err());
        std::os::unix::fs::symlink(dir.join("Пример.md"), dir.join("link.md")).unwrap();
        fs::write(dir.join("binary.md"), [0xff]).unwrap();
        assert_eq!(list(dir, false).unwrap().len(), 2);
        assert!(read(dir, "link").is_err());
        assert!(read(dir, "binary").is_err());
    }
}
