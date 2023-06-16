// The commit of a build and what reruns build.rs when it changes (docs/specs/build-info.md, BI-2).
// build.rs includes this file, and the crate's tests compile it as a module, so the rules are
// tested on a real repository. No `use` here: the text is pasted into build.rs.

/// Runs git in `dir`; `None` when git or the repository is missing. The output is trimmed.
#[allow(dead_code)]
fn git_in(dir: &std::path::Path, args: &[&str]) -> Option<String> {
    git_raw(dir, args).map(|out| out.trim().to_string())
}

/// The output as git wrote it: a file name may start or end with a space.
#[allow(dead_code)]
fn git_raw(dir: &std::path::Path, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(args)
        // `git status` may refresh .git/index otherwise, and a changed index reruns build.rs.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .current_dir(dir)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// A path inside the git folder, as git resolves it (worktrees included).
#[allow(dead_code)]
fn git_path_in(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
    let path = std::path::PathBuf::from(git_in(dir, &["rev-parse", "--git-path", name])?);
    Some(if path.is_absolute() {
        path
    } else {
        dir.join(path)
    })
}

/// Every path whose change must rerun build.rs. A new commit moves HEAD or the branch it
/// names, and staging changes the index. A branch kept only in packed-refs gets its loose file on
/// the next commit, possibly in a folder that does not exist yet (`refs/heads/fix` for `fix/foo`),
/// so `refs/heads` is watched as a whole: Cargo scans a watched folder recursively. An edit of a
/// tracked file changes none of these, so every tracked file is watched too, a deleted one as well.
#[allow(dead_code)]
fn watched_in(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut names = vec![
        "HEAD".to_string(),
        "index".to_string(),
        "packed-refs".to_string(),
    ];
    if let Some(branch) = git_in(dir, &["symbolic-ref", "-q", "HEAD"]) {
        if branch.starts_with("refs/heads/") {
            names.push("refs/heads".to_string());
        }
        names.push(branch);
    }
    let mut paths: Vec<std::path::PathBuf> = names
        .iter()
        .filter_map(|name| git_path_in(dir, name))
        .filter(|path| path.exists())
        .collect();
    if let (Some(top), Some(files)) = (
        git_in(dir, &["rev-parse", "--show-toplevel"]),
        git_raw(dir, &["ls-files", "-z", "--full-name", ":/"]),
    ) {
        paths.extend(
            // NUL-separated: git quotes a path with non-ASCII characters in its plain output.
            files
                .split('\0')
                .filter(|file| !file.is_empty())
                // A deleted one stays listed: Cargo reruns the script while a watched path is
                // missing, and once more when it comes back, without scanning any folder.
                .map(|file| std::path::Path::new(&top).join(file)),
        );
    }
    paths
}

/// The commit, with `-dirty` when a tracked file differs from it; untracked files do not count.
#[allow(dead_code)]
fn commit_in(dir: &std::path::Path) -> Option<String> {
    let head = git_in(dir, &["rev-parse", "HEAD"])?;
    let status = git_in(dir, &["status", "--porcelain", "--untracked-files=no"])?;
    Some(if status.is_empty() {
        head
    } else {
        head + "-dirty"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::Path, process::Command};

    fn run(dir: &Path, args: &[&str]) {
        // The developer's own git config stays out: no signing key, hooks or templates.
        let status = Command::new("git")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .args(["-c", "user.name=t", "-c", "user.email=t@example.com"])
            .args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"])
            .args(args)
            .current_dir(dir)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    /// Whether build.rs would rerun when `path` appears or changes: it is watched, or lies in a
    /// watched folder, which Cargo scans recursively.
    fn covered(watched: &[std::path::PathBuf], path: &Path) -> bool {
        let path = path.canonicalize().unwrap();
        watched.iter().any(|w| {
            let w = w.canonicalize().unwrap();
            path == w || (w.is_dir() && path.starts_with(&w))
        })
    }

    #[test]
    fn a_new_commit_of_a_packed_nested_branch_reruns_the_build() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        run(dir, &["init", "-q", "-b", "fix/foo"]);
        // Git's default, whatever the developer's own config says: non-ASCII paths come quoted.
        run(dir, &["config", "core.quotePath", "true"]);
        fs::write(dir.join("tracked.txt"), "a\n").unwrap();
        fs::write(dir.join("тест.md"), "a\n").unwrap();
        run(dir, &["add", "tracked.txt", "тест.md"]);
        run(dir, &["commit", "-q", "-m", "a"]);
        run(dir, &["pack-refs", "--all"]);
        let loose = dir.join(".git/refs/heads/fix/foo");
        assert!(
            !loose.exists() && !dir.join(".git/refs/heads/fix").exists(),
            "packed"
        );
        let first = commit_in(dir).unwrap();
        let watched = watched_in(dir);

        // A commit that touches no tracked file creates the loose ref, and nothing else watched
        // needs to change; it must still be covered.
        run(dir, &["commit", "-q", "--allow-empty", "-m", "b"]);
        assert!(loose.exists());
        assert!(covered(&watched, &loose), "{watched:?}");
        assert_ne!(commit_in(dir).unwrap(), first);

        // An edit of a tracked file marks the build dirty, and the file is watched.
        fs::write(dir.join("tracked.txt"), "b\n").unwrap();
        assert!(commit_in(dir).unwrap().ends_with("-dirty"));
        assert!(covered(&watched_in(dir), &dir.join("tracked.txt")));
        assert!(
            covered(&watched_in(dir), &dir.join("тест.md")),
            "a non-ASCII name too"
        );
        run(dir, &["checkout", "-q", "--", "tracked.txt"]);
        // A name that starts with a space keeps it.
        fs::write(dir.join(" lead.md"), "a\n").unwrap();
        run(dir, &["add", " lead.md"]);
        run(dir, &["commit", "-q", "-m", "c"]);
        // The file itself, not a folder that happens to hold it.
        let lead = dir.join(" lead.md").canonicalize().unwrap();
        assert!(
            watched_in(dir)
                .iter()
                .any(|w| w.canonicalize().ok().as_deref() == Some(lead.as_path())),
            "a leading space"
        );
        // A deleted tracked file: the build is dirty, and bringing it back is noticed.
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join("notes/kept.md"), "a\n").unwrap();
        run(dir, &["add", "notes/kept.md"]);
        run(dir, &["commit", "-q", "-m", "d"]);
        fs::remove_dir_all(dir.join("notes")).unwrap();
        assert!(commit_in(dir).unwrap().ends_with("-dirty"));
        let while_deleted = watched_in(dir);
        // The missing file itself, and no folder but refs/heads: a watched folder is scanned on
        // every build, build output included.
        assert!(while_deleted.iter().any(|p| p.ends_with("notes/kept.md")));
        let folders: Vec<_> = while_deleted.iter().filter(|p| p.is_dir()).collect();
        assert_eq!(folders.len(), 1, "{folders:?}");
        assert!(folders[0].ends_with("refs/heads"));
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join("notes/kept.md"), "a\n").unwrap();
        assert!(
            covered(&while_deleted, &dir.join("notes/kept.md")),
            "{while_deleted:?}"
        );
        assert!(!commit_in(dir).unwrap().ends_with("-dirty"));
        // Untracked files do not count.
        run(dir, &["checkout", "-q", "--", "tracked.txt"]);
        fs::write(dir.join("untracked.txt"), "x\n").unwrap();
        assert!(!commit_in(dir).unwrap().ends_with("-dirty"));
    }

    #[test]
    fn without_a_repository_there_is_no_commit() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(commit_in(tmp.path()), None);
        assert!(watched_in(tmp.path()).is_empty());
    }
}
