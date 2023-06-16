//! The one place that writes the settings files (SUSI-12): a lock per file, a revision made from
//! the bytes a reader saw, and a read–check–write that refuses when the file changed since then.
//! The window, the Model menu, the connect and disconnect flows, the move of the v0.2.1 key, the
//! reset and the first-run seeding all write here. No caller holds a lock across a network call,
//! a browser sign-in or a modal alert. The promise holds against Sushi's own writers; an editor
//! that writes between the check and the rename can still lose.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write as _},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// The settings files Sushi reads from its folder.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum FileName {
    #[serde(rename = "hotkey.json")]
    Hotkey,
    #[serde(rename = "model.json")]
    Model,
    #[serde(rename = "rules.json")]
    Rules,
    #[serde(rename = "dictionary.json")]
    Dictionary,
    #[serde(rename = "library-path.txt")]
    LibraryPath,
    #[serde(rename = "diagnostics.json")]
    Diagnostics,
}

impl FileName {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hotkey => "hotkey.json",
            Self::Model => "model.json",
            Self::Rules => "rules.json",
            Self::Dictionary => "dictionary.json",
            Self::LibraryPath => "library-path.txt",
            Self::Diagnostics => "diagnostics.json",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Absent,
    Invalid,
    Unreadable,
    Linked,
}

/// One settings file as it is on disk right now.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct FileState {
    pub name: FileName,
    pub status: Status,
    /// Made from the same bytes the values were parsed from; `absent` for a missing file.
    pub revision: String,
    pub message: Option<String>,
    /// The controls of this file can write: it is ok or absent.
    pub writable: bool,
}

pub const ABSENT: &str = "absent";
const UNREADABLE: &str = "unreadable";

/// The file as one read saw it: its bytes, when it could be read, and its state.
pub struct Snapshot {
    pub bytes: Option<Vec<u8>>,
    pub state: FileState,
}

/// The revision of a file's bytes: SHA-256 in hex, or `absent`.
pub fn revision(bytes: Option<&[u8]>) -> String {
    match bytes {
        Some(bytes) => crate::signin::sha256(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
        None => ABSENT.into(),
    }
}

enum Raw {
    Absent,
    Unreadable(String),
    Bytes { bytes: Vec<u8>, linked: bool },
}

/// Reads a file without following the decision about links: a link is read and marked.
fn raw(path: &Path, name: FileName) -> Raw {
    let linked = match fs::symlink_metadata(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Raw::Absent,
        Err(e) => return Raw::Unreadable(format!("{}: {e}", name.as_str())),
        Ok(meta) => meta.file_type().is_symlink(),
    };
    match fs::read(path) {
        Ok(bytes) => Raw::Bytes { bytes, linked },
        Err(e) => Raw::Unreadable(format!("{}: {e}", name.as_str())),
    }
}

fn linked_message(name: FileName) -> String {
    format!(
        "{} is a symbolic link: Sushi reads it and does not write through it. Edit it where it points.",
        name.as_str()
    )
}

/// Reads `name` in `dir` and checks it with the validator Sushi uses for it.
pub fn read(dir: &Path, name: FileName, check: impl Fn(&[u8]) -> Result<(), String>) -> Snapshot {
    let state = |status, revision: String, message: Option<String>| FileState {
        name,
        status,
        revision,
        message,
        writable: matches!(status, Status::Ok | Status::Absent),
    };
    match raw(&dir.join(name.as_str()), name) {
        Raw::Absent => known(name, &Written::default(), check),
        Raw::Unreadable(message) => Snapshot {
            bytes: None,
            state: state(Status::Unreadable, UNREADABLE.into(), Some(message)),
        },
        Raw::Bytes { bytes, linked } => known(
            name,
            &Written {
                bytes: Some(bytes),
                linked,
            },
            check,
        ),
    }
}

/// The bytes a transaction left on disk, as it left them (None: no file). The reply of a save
/// describes these, never a read made after the lock was released: a file another writer
/// changed since then is the next save's `changed`, not the page's new base.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Written {
    pub bytes: Option<Vec<u8>>,
    pub linked: bool,
}

/// The snapshot of known bytes, as [`read`] would have made it from them.
pub fn known(
    name: FileName,
    written: &Written,
    check: impl Fn(&[u8]) -> Result<(), String>,
) -> Snapshot {
    let state = |status, revision: String, message: Option<String>| FileState {
        name,
        status,
        revision,
        message,
        writable: matches!(status, Status::Ok | Status::Absent),
    };
    match &written.bytes {
        None => Snapshot {
            bytes: None,
            state: state(Status::Absent, ABSENT.into(), None),
        },
        Some(bytes) => {
            let (bytes, linked) = (bytes.clone(), written.linked);
            let revision = revision(Some(&bytes));
            let checked = check(&bytes);
            let state = match (linked, checked) {
                (true, Ok(())) => state(Status::Linked, revision, Some(linked_message(name))),
                (true, Err(error)) => state(
                    Status::Linked,
                    revision,
                    Some(format!(
                        "{} Its contents are not valid: {error}",
                        linked_message(name)
                    )),
                ),
                (false, Ok(())) => state(Status::Ok, revision, None),
                (false, Err(error)) => state(Status::Invalid, revision, Some(error)),
            };
            Snapshot {
                bytes: Some(bytes),
                state,
            }
        }
    }
}

/// Why a write did not happen.
#[derive(Clone, Debug, PartialEq)]
pub enum Refusal {
    /// The file is not the one the caller read: nothing was written.
    Changed,
    /// The validator refused the new contents: nothing was written.
    Invalid(String),
    /// The file could not be read or written, or is a link.
    Failed(String),
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Changed => f.write_str("The file changed on disk."),
            Self::Invalid(why) | Self::Failed(why) => f.write_str(why),
        }
    }
}

/// What a transaction does with the file.
pub enum Change {
    Keep,
    Write(Vec<u8>),
    Remove,
}

static LOCKS: Mutex<Vec<(PathBuf, Arc<Mutex<()>>)>> = Mutex::new(Vec::new());

/// The lock of one file, by its full path: tests in temporary folders never wait for each other.
fn lock(path: &Path) -> Arc<Mutex<()>> {
    let mut locks = LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, lock)) = locks.iter().find(|(p, _)| p == path) {
        return lock.clone();
    }
    let lock = Arc::new(Mutex::new(()));
    locks.push((path.to_path_buf(), lock.clone()));
    lock
}

/// Writes a whole file at once, 0600: a reader sees the old text or the new one, never a part.
fn replace(dir: &Path, path: &Path, bytes: &[u8]) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map(|_| ()).map_err(|e| e.error)
}

/// Read–check–write under the file's lock. `expected` is the revision the caller read, or None
/// for a writer that decides from what it reads here (`f` sees the current bytes, None when the
/// file is absent). Returns what `f` returned and the revision of the file afterwards.
pub fn update<T>(
    dir: &Path,
    name: FileName,
    expected: Option<&str>,
    f: impl FnOnce(Option<&[u8]>) -> Result<(Change, T), Refusal>,
) -> Result<(T, String), Refusal> {
    update_written(dir, name, expected, f).map(|(value, revision, _)| (value, revision))
}

/// [`update`], with the bytes the file holds when the lock is released.
pub fn update_written<T>(
    dir: &Path,
    name: FileName,
    expected: Option<&str>,
    f: impl FnOnce(Option<&[u8]>) -> Result<(Change, T), Refusal>,
) -> Result<(T, String, Written), Refusal> {
    let path = dir.join(name.as_str());
    let lock = lock(&path);
    let _held = lock.lock().unwrap_or_else(|e| e.into_inner());
    let (bytes, linked) = match raw(&path, name) {
        Raw::Absent => (None, false),
        Raw::Unreadable(why) => return Err(Refusal::Failed(why)),
        Raw::Bytes { bytes, linked } => (Some(bytes), linked),
    };
    let current = revision(bytes.as_deref());
    if expected.is_some_and(|e| e != current) {
        return Err(Refusal::Changed);
    }
    let (change, value) = f(bytes.as_deref())?;
    if linked && !matches!(change, Change::Keep) {
        return Err(Refusal::Failed(linked_message(name)));
    }
    let failed = |e: io::Error| Refusal::Failed(format!("Could not save {}: {e}", name.as_str()));
    let (after, left) = match change {
        Change::Keep => (current, bytes),
        Change::Write(new) => {
            replace(dir, &path, &new).map_err(failed)?;
            (revision(Some(&new)), Some(new))
        }
        Change::Remove => {
            match fs::remove_file(&path) {
                Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(failed(e)),
                _ => (),
            }
            (ABSENT.into(), None)
        }
    };
    let linked = linked && left.is_some();
    Ok((
        value,
        after,
        Written {
            bytes: left,
            linked,
        },
    ))
}

/// Creates a missing file from its example (LF-3); an existing file always wins.
pub fn seed(dir: &Path, name: FileName, example: &[u8]) -> io::Result<()> {
    let path = dir.join(name.as_str());
    let lock = lock(&path);
    let _held = lock.lock().unwrap_or_else(|e| e.into_inner());
    if fs::symlink_metadata(&path).is_ok() {
        return Ok(());
    }
    fs::create_dir_all(dir)?;
    crate::settings::create_once(&path, example)
}

/// `20261124T101500Z` for the name of a file kept aside.
fn stamp() -> String {
    let now = crate::diagnostics::now();
    let seconds = now.split('.').next().unwrap_or(&now);
    seconds.replace(['-', ':'], "") + "Z"
}

/// Starts an invalid file over: its bytes go to `<stem>.invalid-<UTC time>.<ext>` next
/// to it (0600) first, then `default` replaces it, or the file goes when there is none. Only for
/// a file the validator rejects; a link or an unreadable file is never touched.
pub fn reset(
    dir: &Path,
    name: FileName,
    expected: &str,
    check: impl Fn(&[u8]) -> Result<(), String>,
    default: Option<&[u8]>,
) -> Result<(PathBuf, Written), Refusal> {
    let (aside, _, written) = update_written(dir, name, Some(expected), |bytes| {
        let bytes = bytes.ok_or_else(|| {
            Refusal::Failed(format!(
                "{} does not exist: nothing to start over.",
                name.as_str()
            ))
        })?;
        if check(bytes).is_ok() {
            return Err(Refusal::Failed(format!(
                "{} is valid: Sushi starts over only from a file it cannot use.",
                name.as_str()
            )));
        }
        let aside = keep_aside(dir, name, bytes)
            .map_err(|e| Refusal::Failed(format!("Could not keep {} aside: {e}", name.as_str())))?;
        Ok((
            default.map_or(Change::Remove, |d| Change::Write(d.to_vec())),
            aside,
        ))
    })?;
    Ok((aside, written))
}

fn keep_aside(dir: &Path, name: FileName, bytes: &[u8]) -> io::Result<PathBuf> {
    let file = Path::new(name.as_str());
    let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = file.extension().and_then(|s| s.to_str()).unwrap_or("txt");
    let stamp = stamp();
    for attempt in 1..100 {
        let suffix = if attempt == 1 {
            String::new()
        } else {
            format!("-{attempt}")
        };
        let path = dir.join(format!("{stem}.invalid-{stamp}{suffix}.{ext}"));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
        {
            Ok(mut out) => {
                out.write_all(bytes)?;
                out.sync_all()?;
                return Ok(path);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "too many copies kept aside",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn json(bytes: &[u8]) -> Result<(), String> {
        serde_json::from_slice::<serde_json::Value>(bytes)
            .map(|_| ())
            .map_err(|e| format!("rules.json: {e}"))
    }

    #[test]
    fn a_revision_is_made_from_the_bytes() {
        assert_eq!(revision(None), "absent");
        assert_eq!(
            revision(Some(b"")),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_ne!(revision(Some(b"{}")), revision(Some(b"{} ")));
    }

    #[test]
    fn reads_every_status() {
        let dir = tempfile::tempdir().unwrap();
        let name = FileName::Rules;
        let absent = read(dir.path(), name, json).state;
        assert_eq!(
            (absent.status, absent.revision.as_str()),
            (Status::Absent, "absent")
        );
        assert!(absent.writable);
        fs::write(dir.path().join("rules.json"), "{}").unwrap();
        let ok = read(dir.path(), name, json).state;
        assert_eq!(ok.status, Status::Ok);
        assert_eq!(ok.revision, revision(Some(b"{}")));
        fs::write(dir.path().join("rules.json"), "{").unwrap();
        let invalid = read(dir.path(), name, json).state;
        assert_eq!(invalid.status, Status::Invalid);
        assert!(invalid.message.unwrap().starts_with("rules.json: EOF"));
        assert!(!invalid.writable);
        fs::set_permissions(
            dir.path().join("rules.json"),
            fs::Permissions::from_mode(0o000),
        )
        .unwrap();
        let unreadable = read(dir.path(), name, json).state;
        fs::set_permissions(
            dir.path().join("rules.json"),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        assert_eq!(unreadable.status, Status::Unreadable);
        assert!(!unreadable.writable);
        fs::remove_file(dir.path().join("rules.json")).unwrap();
        fs::create_dir(dir.path().join("rules.json")).unwrap();
        assert_eq!(
            read(dir.path(), name, json).state.status,
            Status::Unreadable
        );
    }

    #[test]
    fn refuses_a_write_after_a_change_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("rules.json");
        let seen = read(dir.path(), FileName::Rules, json).state.revision;
        let ((), after) = update(dir.path(), FileName::Rules, Some(&seen), |bytes| {
            assert_eq!(bytes, None);
            Ok((Change::Write(b"{\"a\":1}".to_vec()), ()))
        })
        .unwrap();
        assert_eq!(after, revision(Some(b"{\"a\":1}")));
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        // Someone edits the file by hand; a write based on the old revision is refused.
        fs::write(&file, "{\"a\":2}").unwrap();
        let refused = update(dir.path(), FileName::Rules, Some(&after), |_| {
            Ok((Change::Write(b"{\"a\":3}".to_vec()), ()))
        });
        assert_eq!(refused, Err(Refusal::Changed));
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\"a\":2}");
        // A writer without a revision decides from what it reads under the lock.
        update(dir.path(), FileName::Rules, None, |bytes| {
            assert_eq!(bytes, Some(&b"{\"a\":2}"[..]));
            Ok((Change::Remove, ()))
        })
        .unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn a_linked_file_is_read_and_not_written() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("elsewhere.json");
        fs::write(&target, "{}").unwrap();
        std::os::unix::fs::symlink(&target, dir.path().join("rules.json")).unwrap();
        let snapshot = read(dir.path(), FileName::Rules, json);
        assert_eq!(snapshot.state.status, Status::Linked);
        assert_eq!(snapshot.bytes.as_deref(), Some(&b"{}"[..]));
        assert!(!snapshot.state.writable);
        assert!(snapshot.state.message.unwrap().contains("symbolic link"));
        // Invalid contents behind a link: still linked, and the validator's message follows.
        fs::write(&target, "{").unwrap();
        let broken = read(dir.path(), FileName::Rules, json).state;
        assert_eq!(broken.status, Status::Linked);
        let message = broken.message.unwrap();
        assert!(
            message
                .contains("Edit it where it points. Its contents are not valid: rules.json: EOF"),
            "{message}"
        );
        fs::write(&target, "{}").unwrap();
        let refused = update(
            dir.path(),
            FileName::Rules,
            Some(&snapshot.state.revision),
            |_| Ok((Change::Write(b"{\"a\":1}".to_vec()), ())),
        );
        assert!(matches!(refused, Err(Refusal::Failed(_))), "{refused:?}");
        assert!(fs::symlink_metadata(dir.path().join("rules.json"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "{}");
        // Seeding never replaces it either.
        seed(dir.path(), FileName::Rules, b"seed").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "{}");
    }

    #[test]
    fn a_reset_keeps_the_broken_bytes_aside() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("rules.json");
        fs::write(&file, "{ broken").unwrap();
        let seen = read(dir.path(), FileName::Rules, json).state.revision;
        let aside = reset(dir.path(), FileName::Rules, &seen, json, Some(b"{}"))
            .unwrap()
            .0;
        let name = aside.file_name().unwrap().to_str().unwrap().to_string();
        assert!(
            name.starts_with("rules.invalid-") && name.ends_with("Z.json"),
            "{name}"
        );
        assert_eq!(fs::read_to_string(&aside).unwrap(), "{ broken");
        assert_eq!(
            fs::metadata(&aside).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read_to_string(&file).unwrap(), "{}");
        // A valid file is not reset; an optional file resets to no file.
        let now = read(dir.path(), FileName::Rules, json).state.revision;
        assert!(reset(dir.path(), FileName::Rules, &now, json, None).is_err());
        fs::write(&file, "nope").unwrap();
        let seen = read(dir.path(), FileName::Rules, json).state.revision;
        let second = reset(dir.path(), FileName::Rules, &seen, json, None)
            .unwrap()
            .0;
        assert!(!file.exists());
        assert_ne!(second, aside);
        // A stale revision changes nothing.
        fs::write(&file, "bad").unwrap();
        assert_eq!(
            reset(dir.path(), FileName::Rules, &seen, json, None),
            Err(Refusal::Changed)
        );
        assert_eq!(fs::read_to_string(&file).unwrap(), "bad");
    }
}
