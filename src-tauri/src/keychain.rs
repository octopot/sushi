//! Keys of connected providers in the login keychain (docs/specs/model.md, MD-11).
//!
//! Every item is created and read through `/usr/bin/security`, so its access list trusts that
//! tool (`identifier "com.apple.security" and anchor apple`), not Sushi's own signature. An
//! ad-hoc signed Sushi gets a new signature with every build; an item that trusted Sushi would
//! ask for the login password after each `brew upgrade`. The key goes to `security` on its
//! standard input, never on a command line other processes can see.

use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

const SECURITY: &str = "/usr/bin/security";
pub const SERVICE: &str = "me.octopot.sushi";

/// The login keychain, or a file for the tests.
#[derive(Clone, Debug, Default)]
pub struct Keychain {
    pub file: Option<PathBuf>,
}

/// Keys are tokens: letters, digits and `-_.~+/=`. Anything else is not a key, and could not
/// pass through the line `security -i` reads.
pub fn plausible(key: &str) -> bool {
    (8..=512).contains(&key.len())
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.~+/=".contains(c))
}

impl Keychain {
    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(SECURITY);
        command.args(args);
        if let Some(file) = &self.file {
            command.arg(file);
        }
        command.stdin(Stdio::null()).stderr(Stdio::null());
        command
    }

    /// Stores or replaces the key of `account` and reads it back: `security -i` exits with 0
    /// even when a command fails.
    pub fn store(&self, account: &str, label: &str, key: &str) -> Result<(), String> {
        if !plausible(key) {
            return Err("This does not look like an API key.".into());
        }
        let mut line =
            format!("add-generic-password -U -s {SERVICE} -a {account} -l \"{label}\" -w {key}");
        if let Some(file) = &self.file {
            line.push_str(&format!(" \"{}\"", file.display()));
        }
        line.push('\n');
        let mut child = Command::new(SECURITY)
            .arg("-i")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not open the keychain.".to_string())?;
        if let Some(mut input) = child.stdin.take() {
            let _ = input.write_all(line.as_bytes());
        }
        let _ = child.wait();
        match self.read(account) {
            Some(stored) if stored == key => Ok(()),
            _ => Err("Could not save the key in the keychain.".into()),
        }
    }

    pub fn read(&self, account: &str) -> Option<String> {
        let output = self
            .command(&["find-generic-password", "-s", SERVICE, "-a", account, "-w"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let key = String::from_utf8(output.stdout).ok()?;
        let key = key.trim_end_matches('\n').to_string();
        (!key.is_empty()).then_some(key)
    }

    /// Whether an item exists, without reading the key.
    pub fn has(&self, account: &str) -> bool {
        self.command(&["find-generic-password", "-s", SERVICE, "-a", account])
            .stdout(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    }

    pub fn forget(&self, account: &str) -> Result<(), String> {
        let status = self
            .command(&["delete-generic-password", "-s", SERVICE, "-a", account])
            .stdout(Stdio::null())
            .status()
            .map_err(|_| "Could not open the keychain.".to_string())?;
        // 44: no such item, which is what forgetting wants.
        if status.success() || status.code() == Some(44) {
            Ok(())
        } else {
            Err("Could not remove the key from the keychain.".into())
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A keychain file of its own, unlocked, removed when dropped.
    pub struct Scratch {
        _dir: tempfile::TempDir,
        pub keychain: Keychain,
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            if let Some(file) = &self.keychain.file {
                let _ = Command::new(SECURITY)
                    .args(["delete-keychain"])
                    .arg(file)
                    .status();
            }
        }
    }

    pub fn scratch() -> Scratch {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.keychain-db");
        for args in [
            ["create-keychain", "-p", "x"],
            ["unlock-keychain", "-p", "x"],
        ] {
            assert!(Command::new(SECURITY)
                .args(args)
                .arg(&file)
                .status()
                .unwrap()
                .success());
        }
        Scratch {
            _dir: dir,
            keychain: Keychain { file: Some(file) },
        }
    }

    #[test]
    fn stores_reads_and_forgets_a_key() {
        let scratch = scratch();
        let keychain = &scratch.keychain;
        assert!(!keychain.has("openrouter"));
        assert_eq!(keychain.read("openrouter"), None);
        keychain
            .store("openrouter", "Sushi: OpenRouter", "sk-or-v1-abc_DEF-123")
            .unwrap();
        assert!(keychain.has("openrouter"));
        assert_eq!(
            keychain.read("openrouter").as_deref(),
            Some("sk-or-v1-abc_DEF-123")
        );
        // Connecting again replaces the key.
        keychain
            .store("openrouter", "Sushi: OpenRouter", "sk-or-v1-new")
            .unwrap();
        assert_eq!(keychain.read("openrouter").as_deref(), Some("sk-or-v1-new"));
        assert!(!keychain.has("openai"), "one item per provider");
        keychain.forget("openrouter").unwrap();
        assert!(!keychain.has("openrouter"));
        keychain.forget("openrouter").unwrap();
    }

    #[test]
    fn the_item_trusts_the_security_tool_not_sushi() {
        let scratch = scratch();
        let keychain = &scratch.keychain;
        keychain
            .store("anthropic", "Sushi: Claude", "sk-ant-api03-x_y")
            .unwrap();
        let dump = Command::new(SECURITY)
            .arg("dump-keychain")
            .arg("-a")
            .arg(keychain.file.as_ref().unwrap())
            .output()
            .unwrap();
        let dump = String::from_utf8_lossy(&dump.stdout);
        assert!(
            dump.contains("identifier \"com.apple.security\" and anchor apple"),
            "{dump}"
        );
        assert!(!dump.contains("me.octopot.sushi\" and"), "{dump}");
    }

    #[test]
    fn refuses_what_is_not_a_key() {
        let scratch = scratch();
        for bad in [
            "short",
            "has space key 123",
            "quote\"key-123456",
            "new\nline-12345",
        ] {
            assert!(scratch.keychain.store("openai", "x", bad).is_err(), "{bad}");
        }
        assert!(!scratch.keychain.has("openai"));
    }
}
