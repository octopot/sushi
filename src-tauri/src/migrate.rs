//! Brings the settings, the library and the draft over from Susi, the app's name before v0.2.0.
//! v0.3.0: remove this module together with the `susi.draft.v3` fallback in `src/main.ts`.

use std::{
    ffi::CString,
    fs, io,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime},
};

extern "C" {
    fn sushi_quit_app(bundle_id: *const libc::c_char, timeout: f64) -> bool;
}

/// Written into the new settings folder once both folders are copied; its presence ends the migration.
const MARKER: &str = ".migrated-from-susi";

/// The identifier this build had before the rename: `me.octopot.sushi` → `me.octopot.susi`.
/// Builds with their own identifier (`….rehearsal`) migrate from their own predecessor.
pub(crate) fn previous_identifier(identifier: &str) -> Option<String> {
    identifier
        .contains("sushi")
        .then(|| identifier.replacen("sushi", "susi", 1))
}

struct Folders {
    old_support: PathBuf,
    old_webkit: PathBuf,
    new_support: PathBuf,
    new_webkit: PathBuf,
}

impl Folders {
    fn new(library: &Path, old: &str, new: &str) -> Self {
        let support = library.join("Application Support");
        let webkit = library.join("WebKit");
        Folders {
            old_support: support.join(old),
            old_webkit: webkit.join(old),
            new_support: support.join(new),
            new_webkit: webkit.join(new),
        }
    }
}

/// Runs before the webview exists, so WebKit has not opened the new folder yet.
/// Returns a note for the user when the data could not be brought over; the old folders stay.
pub(crate) fn run(identifier: &str) -> Option<String> {
    let old = previous_identifier(identifier)?;
    let home = std::env::var_os("HOME")?;
    let folders = Folders::new(&Path::new(&home).join("Library"), &old, identifier);
    if !pending(&folders) {
        return None;
    }
    let id = CString::new(old.as_str()).ok()?;
    if !unsafe { sushi_quit_app(id.as_ptr(), 5.0) } {
        return Some(
            "Susi is still running. Quit it, then reopen Sushi to bring over your settings and draft."
                .into(),
        );
    }
    if !settled(&folders.old_webkit, Duration::from_secs(5)) {
        return Some(
            "Susi is still saving its draft. Reopen Sushi in a moment to bring it over.".into(),
        );
    }
    match migrate(&folders) {
        Ok(()) => None,
        Err(error) => Some(format!(
            "Could not bring over the settings and draft from Susi: {error}. They are still in {}.",
            folders.old_support.display()
        )),
    }
}

fn pending(folders: &Folders) -> bool {
    !folders.new_support.join(MARKER).exists()
        && (folders.old_support.is_dir() || folders.old_webkit.is_dir())
}

/// The WebKit folder first: the marker goes into the settings folder only after both copies.
fn migrate(folders: &Folders) -> io::Result<()> {
    if folders.old_webkit.is_dir() {
        replace_with_copy(&folders.old_webkit, &folders.new_webkit)?;
    }
    if folders.old_support.is_dir() {
        replace_with_copy(&folders.old_support, &folders.new_support)?;
    } else {
        fs::create_dir_all(&folders.new_support)?;
    }
    fs::write(folders.new_support.join(MARKER), b"")
}

/// Copies `from` next to `to` and swaps it in. A folder already at `to` (a run of this build
/// before the migration, or an interrupted one) is moved aside, never deleted.
fn replace_with_copy(from: &Path, to: &Path) -> io::Result<()> {
    let staging = sibling(to, "migrating");
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    if let Err(error) = copy_tree(from, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if to.exists() {
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        fs::rename(to, sibling(to, &format!("before-migration-{stamp}")))?;
    }
    fs::rename(&staging, to)
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{suffix}"));
    path.with_file_name(name)
}

fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_symlink() {
            std::os::unix::fs::symlink(fs::read_link(entry.path())?, &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// WebKit's network process writes localStorage and may finish after Susi has quit:
/// wait until no write-ahead log under `dir` changes between two looks.
fn settled(dir: &Path, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let mut last = logs(dir);
    loop {
        thread::sleep(Duration::from_millis(300));
        let now = logs(dir);
        if now == last {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        last = now;
    }
}

fn logs(dir: &Path) -> Vec<(PathBuf, u64, Option<SystemTime>)> {
    let mut found = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(path) = stack.pop() {
        let Ok(entries) = fs::read_dir(&path) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => stack.push(path),
                Ok(_) if path.to_string_lossy().ends_with("-wal") => {
                    let meta = entry.metadata().ok();
                    let len = meta.as_ref().map_or(0, |m| m.len());
                    found.push((path, len, meta.and_then(|m| m.modified().ok())));
                }
                _ => (),
            }
        }
    }
    found.sort();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    fn susi(library: &Path) -> Folders {
        let folders = Folders::new(library, "me.octopot.susi", "me.octopot.sushi");
        write(&folders.old_support.join("rules.json"), "rules");
        write(
            &folders.old_support.join("Input/.templates/brief.md"),
            "brief",
        );
        write(&folders.old_webkit.join("WebsiteData/Default/salt"), "salt");
        write(
            &folders
                .old_webkit
                .join("WebsiteData/Default/h/h/LocalStorage/localstorage.sqlite3"),
            "draft",
        );
        folders
    }

    #[test]
    fn the_previous_identifier_follows_the_rename() {
        assert_eq!(
            previous_identifier("me.octopot.sushi").as_deref(),
            Some("me.octopot.susi")
        );
        assert_eq!(
            previous_identifier("me.octopot.sushi.rehearsal").as_deref(),
            Some("me.octopot.susi.rehearsal")
        );
        assert_eq!(previous_identifier("me.octopot.other"), None);
    }

    #[test]
    fn both_folders_are_copied_and_the_old_ones_stay() {
        let dir = tempfile::tempdir().unwrap();
        let folders = susi(dir.path());
        assert!(pending(&folders));
        migrate(&folders).unwrap();
        assert_eq!(read(&folders.new_support.join("rules.json")), "rules");
        assert_eq!(
            read(&folders.new_support.join("Input/.templates/brief.md")),
            "brief"
        );
        assert_eq!(
            read(&folders.new_webkit.join("WebsiteData/Default/salt")),
            "salt"
        );
        assert_eq!(
            read(
                &folders
                    .new_webkit
                    .join("WebsiteData/Default/h/h/LocalStorage/localstorage.sqlite3")
            ),
            "draft"
        );
        assert_eq!(read(&folders.old_support.join("rules.json")), "rules");
        assert!(folders.new_support.join(MARKER).exists());
        assert!(!pending(&folders), "the marker ends the migration");
    }

    #[test]
    fn a_folder_without_the_marker_is_moved_aside_not_trusted() {
        let dir = tempfile::tempdir().unwrap();
        let folders = susi(dir.path());
        write(
            &folders.new_webkit.join("WebsiteData/Default/salt"),
            "fresh",
        );
        write(&folders.new_support.join("rules.json"), "seeded");
        assert!(pending(&folders));
        migrate(&folders).unwrap();
        assert_eq!(
            read(&folders.new_webkit.join("WebsiteData/Default/salt")),
            "salt"
        );
        assert_eq!(read(&folders.new_support.join("rules.json")), "rules");
        let aside: Vec<_> = fs::read_dir(dir.path().join("WebKit"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("me.octopot.sushi.before-migration-"))
            .collect();
        assert_eq!(aside.len(), 1, "the earlier folder is kept: {aside:?}");
    }

    #[test]
    fn a_failed_copy_keeps_the_old_data_and_sets_no_marker() {
        let dir = tempfile::tempdir().unwrap();
        let folders = susi(dir.path());
        // An unreadable file stops the copy halfway through the WebKit folder.
        let unreadable = folders.old_webkit.join("WebsiteData/Default/salt");
        let mut permissions = fs::metadata(&unreadable).unwrap().permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o000);
        fs::set_permissions(&unreadable, permissions).unwrap();
        assert!(migrate(&folders).is_err());
        assert!(!dir
            .path()
            .join("WebKit/me.octopot.sushi.migrating")
            .exists());
        assert!(!folders.new_support.join(MARKER).exists());
        assert!(pending(&folders), "the next launch tries again");
        let mut permissions = fs::metadata(&unreadable).unwrap().permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o644);
        fs::set_permissions(&unreadable, permissions).unwrap();
        assert_eq!(read(&unreadable), "salt");
    }

    #[test]
    fn nothing_to_bring_over_on_a_fresh_install() {
        let dir = tempfile::tempdir().unwrap();
        let folders = Folders::new(dir.path(), "me.octopot.susi", "me.octopot.sushi");
        assert!(!pending(&folders));
    }

    #[test]
    fn a_quiet_folder_is_settled_at_once() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("a/b/localstorage.sqlite3-wal"), "log");
        assert!(settled(dir.path(), Duration::from_secs(2)));
        assert!(settled(&dir.path().join("missing"), Duration::from_secs(2)));
    }
}
