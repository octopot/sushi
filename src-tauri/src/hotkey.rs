//! The key that shows and hides the panel: Caps Lock, or a combination from `hotkey.json`.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::Path,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{menu::CheckMenuItem, menu::MenuItem, AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

extern "C" {
    fn sushi_caps_take() -> libc::c_int;
    fn sushi_caps_release();
}

pub(crate) const FILE: &str = "hotkey.json";
const EXAMPLE: &str = include_str!("../../docs/specs/examples/hotkey.json");
/// Caps Lock arrives as this key while Sushi maps it.
const CAPS_KEY: &str = "F18";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Hotkey {
    /// Caps Lock shows and hides the panel while Sushi runs.
    caps_lock: bool,
    /// Used when `caps_lock` is off or Caps Lock is taken, e.g. `Control+Shift+Space`.
    shortcut: String,
}

impl Default for Hotkey {
    fn default() -> Self {
        serde_json::from_str(EXAMPLE).expect("the example hotkey.json is valid")
    }
}

pub(crate) fn load(dir: &Path) -> Result<Hotkey, String> {
    let hotkey: Hotkey = crate::settings::read_json(dir, FILE, EXAMPLE)?;
    let shortcut = Shortcut::from_str(&hotkey.shortcut).map_err(|e| {
        format!("{FILE}: 'shortcut' is not a key combination ({e}), e.g. \"Control+Shift+Space\".")
    })?;
    if shortcut.mods.is_empty() {
        return Err(format!(
            "{FILE}: 'shortcut' needs at least one of Control, Option, Shift or Command."
        ));
    }
    Ok(hotkey)
}

fn save(dir: &Path, hotkey: &Hotkey) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    let mut text = serde_json::to_string_pretty(hotkey)?;
    text.push('\n');
    tmp.write_all(text.as_bytes())?;
    tmp.as_file().sync_all()?;
    tmp.persist(dir.join(FILE)).map(|_| ()).map_err(|e| e.error)
}

/// `Control+Shift+Space` → `⌃⇧Space`, in the order macOS menus use.
pub(crate) fn symbols(shortcut: &str) -> String {
    let mut mods = [false; 4];
    let mut key = String::new();
    for part in shortcut.split('+').map(str::trim) {
        match part.to_ascii_lowercase().as_str() {
            "control" | "ctrl" => mods[0] = true,
            "option" | "alt" => mods[1] = true,
            "shift" => mods[2] = true,
            "command" | "cmd" | "super" | "meta" | "commandorcontrol" | "cmdorctrl" => {
                mods[3] = true
            }
            _ => {
                let short = part
                    .strip_prefix("Key")
                    .or_else(|| part.strip_prefix("Digit"))
                    .filter(|k| k.len() == 1)
                    .unwrap_or(part);
                let mut chars = short.chars();
                key = chars
                    .next()
                    .map(|c| c.to_uppercase().chain(chars).collect())
                    .unwrap_or_default();
            }
        }
    }
    ["⌃", "⌥", "⇧", "⌘"]
        .iter()
        .zip(mods)
        .filter(|(_, on)| *on)
        .map(|(s, _)| *s)
        .chain([key.as_str()])
        .collect()
}

/// What the menu shows and how the panel is called right now.
pub(crate) struct Menu {
    pub(crate) label: MenuItem<Wry>,
    pub(crate) caps_lock: CheckMenuItem<Wry>,
}

#[derive(Default)]
pub(crate) struct State {
    menu: Mutex<Option<Menu>>,
}

static HELD: AtomicBool = AtomicBool::new(false);

/// A held key repeats; only the first press of each hold toggles the panel.
pub(crate) fn pressed(state: ShortcutState) -> bool {
    match state {
        ShortcutState::Pressed => !HELD.swap(true, Ordering::Relaxed),
        ShortcutState::Released => {
            HELD.store(false, Ordering::Relaxed);
            false
        }
    }
}

pub(crate) fn attach(app: &AppHandle, menu: Menu) {
    *app.state::<State>().menu.lock().unwrap() = Some(menu);
}

/// Reads `hotkey.json`, takes Caps Lock or registers the combination, and updates the menu.
/// Problems become notes for the panel; the panel stays reachable whenever any key registers.
pub(crate) fn apply(app: &AppHandle) -> Vec<String> {
    let mut notes = Vec::new();
    let dir = app.path().app_data_dir().ok();
    let hotkey = match dir.as_deref().map(load) {
        Some(Ok(hotkey)) => hotkey,
        Some(Err(error)) => {
            notes.push(error);
            Hotkey::default()
        }
        None => Hotkey::default(),
    };
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let mut caps = false;
    if hotkey.caps_lock {
        match unsafe { sushi_caps_take() } {
            0 => caps = true,
            1 => notes.push(format!(
                "Caps Lock switches input sources on this Mac, so {} shows Sushi.",
                symbols(&hotkey.shortcut)
            )),
            _ => notes.push(format!(
                "Another app already remaps Caps Lock, so {} shows Sushi.",
                symbols(&hotkey.shortcut)
            )),
        }
    } else {
        unsafe { sushi_caps_release() };
    }
    let (key, label) = if caps {
        (CAPS_KEY.to_string(), "Caps Lock".to_string())
    } else {
        (hotkey.shortcut.clone(), symbols(&hotkey.shortcut))
    };
    if let Err(error) = shortcuts.register(key.as_str()) {
        notes.push(format!("Could not register {label}: {error}"));
        if caps {
            unsafe { sushi_caps_release() };
        }
    }
    if let Some(menu) = app.state::<State>().menu.lock().unwrap().as_ref() {
        let _ = menu.label.set_text(format!("Shows Sushi: {label}"));
        let _ = menu.caps_lock.set_checked(hotkey.caps_lock);
    }
    notes
}

/// The menu's Caps Lock switch: flips `capsLock` in `hotkey.json` and applies it.
pub(crate) fn toggle_caps_lock(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let mut notes = Vec::new();
    match load(&dir) {
        Ok(mut hotkey) => {
            hotkey.caps_lock = !hotkey.caps_lock;
            if let Err(error) = save(&dir, &hotkey) {
                notes.push(format!("Could not save {FILE}: {error}"));
            }
        }
        Err(error) => notes.push(error),
    }
    notes.extend(apply(app));
    if !notes.is_empty() {
        let _ = app.emit("startup-notes", notes.join(" "));
    }
}

/// Gives Caps Lock back when Sushi quits.
pub(crate) fn release() {
    unsafe { sushi_caps_release() };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_run_seeds_caps_lock_with_a_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let hotkey = load(tmp.path()).unwrap();
        assert_eq!(fs::read_to_string(tmp.path().join(FILE)).unwrap(), EXAMPLE);
        assert!(hotkey.caps_lock);
        assert_eq!(symbols(&hotkey.shortcut), "⌃⇧Space");
        assert_eq!(hotkey, Hotkey::default());
    }

    #[test]
    fn a_saved_switch_keeps_the_combination() {
        let tmp = tempfile::tempdir().unwrap();
        let mut hotkey = load(tmp.path()).unwrap();
        hotkey.caps_lock = false;
        hotkey.shortcut = "Option+Command+KeyP".into();
        save(tmp.path(), &hotkey).unwrap();
        assert_eq!(load(tmp.path()).unwrap(), hotkey);
    }

    #[test]
    fn invalid_files_name_the_file_and_the_field() {
        let tmp = tempfile::tempdir().unwrap();
        for (bad, message) in [
            (
                r#"{"capsLock":true,"shortcut":"Shift+Nope"}"#,
                "hotkey.json: 'shortcut' is not a key combination",
            ),
            (
                r#"{"capsLock":true,"shortcut":"Space"}"#,
                "hotkey.json: 'shortcut' needs at least one of",
            ),
            (
                r#"{"capsLock":"yes","shortcut":"Control+Space"}"#,
                "hotkey.json: ",
            ),
            (
                r#"{"capsLock":true,"shortcut":"Control+Space","extra":1}"#,
                "hotkey.json: unknown field",
            ),
        ] {
            fs::write(tmp.path().join(FILE), bad).unwrap();
            let error = load(tmp.path()).unwrap_err();
            assert!(error.starts_with(message), "{bad}: {error}");
        }
    }

    #[test]
    fn combinations_read_as_menu_symbols() {
        assert_eq!(symbols("Control+Shift+Space"), "⌃⇧Space");
        assert_eq!(symbols("shift+super+space"), "⇧⌘Space");
        assert_eq!(symbols("Command+Option+KeyP"), "⌥⌘P");
        assert_eq!(symbols("Control+Digit1"), "⌃1");
        assert_eq!(symbols("Alt+F18"), "⌥F18");
    }

    #[test]
    fn a_held_key_toggles_once() {
        assert!(pressed(ShortcutState::Pressed));
        assert!(!pressed(ShortcutState::Pressed), "a repeat while held");
        assert!(!pressed(ShortcutState::Released));
        assert!(pressed(ShortcutState::Pressed));
        pressed(ShortcutState::Released);
    }
}
