//! The key that shows and hides the panel: Caps Lock, or a combination from `hotkey.json`.

use crate::files::{self, Change, FileName, Refusal};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

extern "C" {
    fn sushi_caps_take() -> libc::c_int;
    fn sushi_caps_release();
    fn sushi_keys_down(flags: u64, codes: *const u16, count: usize) -> bool;
}

pub(crate) const FILE: &str = "hotkey.json";
pub(crate) const EXAMPLE: &str = include_str!("../../docs/specs/examples/hotkey.json");
/// Caps Lock arrives as this key while Sushi maps it.
const CAPS_KEY: &str = "F18";
/// What `effective` says while Caps Lock shows the panel.
pub(crate) const CAPS_LOCK: &str = "caps-lock";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Hotkey {
    /// Caps Lock shows and hides the panel while Sushi runs.
    pub(crate) caps_lock: bool,
    /// Used when `caps_lock` is off or Caps Lock is taken, e.g. `Control+Shift+Space`.
    pub(crate) shortcut: String,
}

impl Default for Hotkey {
    fn default() -> Self {
        serde_json::from_str(EXAMPLE).expect("the example hotkey.json is valid")
    }
}

/// Reads `hotkey.json` from its bytes, checked as Sushi uses it.
pub(crate) fn parse(bytes: &[u8]) -> Result<Hotkey, String> {
    let hotkey: Hotkey = serde_json::from_slice(bytes).map_err(|e| format!("{FILE}: {e}"))?;
    canonical(&hotkey.shortcut)?;
    Ok(hotkey)
}

/// Checks `hotkey.json` as `load` would, without seeding it.
pub(crate) fn check(bytes: &[u8]) -> Result<(), String> {
    parse(bytes).map(|_| ())
}

/// The combination as the window writes it, whatever the spelling it was read in:
/// `ctrl+shift+space` → `Control+Shift+Space`, `Command+Option+P` → `Option+Command+KeyP`.
/// The modifiers come in the order macOS menus use; the key is its physical code.
pub(crate) fn canonical(shortcut: &str) -> Result<String, String> {
    let parsed = Shortcut::from_str(shortcut).map_err(|e| {
        format!("{FILE}: 'shortcut' is not a key combination ({e}), e.g. \"Control+Shift+Space\".")
    })?;
    if parsed.mods.is_empty() {
        return Err(format!(
            "{FILE}: 'shortcut' needs at least one of Control, Option, Shift or Command."
        ));
    }
    let mut parts: Vec<String> = [
        (Modifiers::CONTROL, "Control"),
        (Modifiers::ALT, "Option"),
        (Modifiers::SHIFT, "Shift"),
        (Modifiers::SUPER, "Command"),
    ]
    .into_iter()
    .filter(|(m, _)| parsed.mods.contains(*m))
    .map(|(_, name)| name.to_string())
    .collect();
    parts.push(parsed.key.to_string());
    Ok(parts.join("+"))
}

pub(crate) fn load(dir: &Path) -> Result<Hotkey, String> {
    parse(&crate::settings::read_seeded(
        dir,
        FileName::Hotkey,
        EXAMPLE,
    )?)
}

/// The bytes Sushi writes: the shortcut in its canonical spelling.
pub(crate) fn render(hotkey: &Hotkey) -> Result<Vec<u8>, String> {
    let hotkey = Hotkey {
        caps_lock: hotkey.caps_lock,
        shortcut: canonical(&hotkey.shortcut)?,
    };
    let mut text = serde_json::to_string_pretty(&hotkey).map_err(|e| e.to_string())?;
    text.push('\n');
    Ok(text.into_bytes())
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

/// Why the key in effect is not the chosen one, or why none is active.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "kebab-case")]
pub enum ProblemKind {
    InputSources,
    Remapped,
    NotRegistered,
    InvalidFile,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Problem {
    pub kind: ProblemKind,
    /// Short, for a status line.
    pub message: String,
    /// What to do about it.
    pub advice: Option<String>,
}

/// What shows the panel right now, and why it is not what the user chose.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Effect {
    /// `capsLock` as Sushi applied it: the file's, or the default's when the file is invalid.
    pub(crate) caps_lock: bool,
    /// `caps-lock`, a canonical combination, or None when no key is registered.
    pub(crate) effective: Option<String>,
    pub(crate) problem: Option<Problem>,
    /// For a problem report (RP-6): kinds only, never a value.
    conflicts: Vec<&'static str>,
    /// What the global-shortcut plugin holds, to take it back after a capture.
    registered: Option<String>,
}

impl Effect {
    /// The key in effect for people: `Caps Lock`, `⌃⇧Space`, or `not registered`.
    pub(crate) fn label(&self) -> String {
        match self.effective.as_deref() {
            Some(CAPS_LOCK) => "Caps Lock".into(),
            Some(shortcut) => symbols(shortcut),
            None => "not registered".into(),
        }
    }

    /// One sentence on what is in effect after a failed change.
    fn sentence(&self) -> String {
        match self.effective {
            Some(_) => format!("{} still shows Sushi.", self.label()),
            None => "No shortcut is active.".into(),
        }
    }
}

/// The problem of a `hotkey.json` Sushi cannot use, with what shows Sushi meanwhile.
fn invalid_file(error: &str, effective: Option<&str>) -> Problem {
    let effect = Effect {
        effective: effective.map(str::to_string),
        ..Effect::default()
    };
    Problem {
        kind: ProblemKind::InvalidFile,
        message: error.to_string(),
        advice: Some(match effective {
            Some(_) => format!(
                "Fix {FILE} or start over with the defaults; until then {} shows Sushi.",
                effect.label()
            ),
            None => format!("Fix {FILE} or start over with the defaults."),
        }),
    }
}

/// What is in effect for `hotkey` with Caps Lock `caps` (`taken`, `input-sources`, `remapped`,
/// `off`) and the keys in `refused` taken by another app: the real decision, without AppKit,
/// for the fixtures of the browser tests.
#[cfg(test)]
pub(crate) fn planned(
    hotkey: &Hotkey,
    file_error: Option<&str>,
    caps: &str,
    refused: &[&str],
) -> Effect {
    let caps = match caps {
        "taken" => Caps::Taken,
        "input-sources" => Caps::InputSources,
        "remapped" => Caps::Remapped,
        _ => Caps::NotWanted,
    };
    let mut register = |key: &str| {
        if refused.contains(&key) {
            Err("taken".to_string())
        } else {
            Ok(())
        }
    };
    plan(hotkey, file_error, caps, &mut register).0
}

/// What Sushi learned when it tried to take Caps Lock.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Caps {
    Taken,
    InputSources,
    Remapped,
    NotWanted,
}

/// Decides what is in effect: registers Caps Lock's key or the combination through `register`,
/// falls back from Caps Lock to the combination, and names the problem. Returns the effect, the
/// startup notes and whether Caps Lock must be given back. Pure apart from `register`.
fn plan(
    hotkey: &Hotkey,
    file_error: Option<&str>,
    caps: Caps,
    register: &mut dyn FnMut(&str) -> Result<(), String>,
) -> (Effect, Vec<String>, bool) {
    let shortcut = canonical(&hotkey.shortcut).unwrap_or_else(|_| hotkey.shortcut.clone());
    let combo = symbols(&shortcut);
    let mut notes = Vec::new();
    let mut conflicts = Vec::new();
    let mut problem = None;
    let mut release = false;
    if let Some(error) = file_error {
        notes.push(error.to_string());
        conflicts.push("hotkey.json invalid");
    }
    let mut registered = None;
    let mut effective = None;
    if caps == Caps::Taken {
        match register(CAPS_KEY) {
            Ok(()) => {
                registered = Some(CAPS_KEY.to_string());
                effective = Some(CAPS_LOCK.to_string());
            }
            Err(error) => {
                conflicts.push("the key could not be registered");
                notes.push(format!("Could not register Caps Lock: {error}"));
                release = true;
            }
        }
    }
    let caps_problem = match caps {
        Caps::Taken if effective.is_none() => Some((
            ProblemKind::NotRegistered,
            format!("Caps Lock could not be registered, so {combo} shows Sushi."),
            "Choose a combination, or quit Sushi and open it again.",
        )),
        Caps::InputSources => {
            conflicts.push("input sources switch with Caps Lock");
            Some((
                ProblemKind::InputSources,
                format!("Caps Lock switches input sources on this Mac, so {combo} shows Sushi."),
                "Turn off “Use the Caps Lock key to switch…” in System Settings ▸ Keyboard ▸ Input Sources.",
            ))
        }
        Caps::Remapped => {
            conflicts.push("another app remaps Caps Lock");
            Some((
                ProblemKind::Remapped,
                format!("Another app already remaps Caps Lock, so {combo} shows Sushi."),
                "Quit the app that remaps Caps Lock, or choose a combination.",
            ))
        }
        _ => None,
    };
    if let Some((kind, message, _)) = &caps_problem {
        if *kind != ProblemKind::NotRegistered {
            notes.push(message.clone());
        }
    }
    if effective.is_none() {
        match register(&shortcut) {
            Ok(()) => {
                registered = Some(shortcut.clone());
                effective = Some(shortcut.clone());
                if let Some((kind, message, advice)) = caps_problem {
                    problem = Some(Problem {
                        kind,
                        message,
                        advice: Some(advice.into()),
                    });
                }
            }
            Err(error) => {
                if !conflicts.contains(&"the key could not be registered") {
                    conflicts.push("the key could not be registered");
                }
                notes.push(format!("Could not register {combo}: {error}"));
                problem = Some(Problem {
                    kind: ProblemKind::NotRegistered,
                    message: format!("No key shows Sushi: {combo} could not be registered."),
                    advice: Some(
                        "Choose another combination: another app may already use this one.".into(),
                    ),
                });
            }
        }
    }
    if let (None, Some(error)) = (&problem, file_error) {
        problem = Some(invalid_file(error, effective.as_deref()));
    }
    let effect = Effect {
        caps_lock: hotkey.caps_lock,
        effective,
        problem,
        conflicts,
        registered,
    };
    (effect, notes, release)
}

#[derive(Default)]
pub(crate) struct State {
    effect: Mutex<Effect>,
    /// The hotkey last applied and the error of the file it came from, to apply it again.
    applied: Mutex<Option<(Hotkey, Option<String>)>>,
    /// The settings window records a combination: the key that shows Sushi is paused.
    capturing: AtomicBool,
    /// A capture ended while its keys were down: the key waits for them to come up, and
    /// nothing else registers it meanwhile.
    waiting: AtomicBool,
    /// The revision of `hotkey.json` the effect follows (files.rs): the window applies the file
    /// again only when it differs.
    revision: Mutex<Option<String>>,
}

/// What is in effect now, for the menu and the settings window.
pub(crate) fn effect(app: &AppHandle) -> Effect {
    app.state::<State>()
        .effect
        .lock()
        .map(|e| e.clone())
        .unwrap_or_default()
}

/// The hotkey setup without anything personal: `capsLock` in the file, the key in effect and
/// the conflicts Sushi detected (docs/specs/report.md, RP-6).
pub(crate) fn summary(app: &AppHandle) -> String {
    let effect = effect(app);
    let conflicts = effect.conflicts.join(", ");
    format!(
        "capsLock {}, in effect {}, conflicts {}",
        effect.caps_lock,
        effect.label(),
        if conflicts.is_empty() {
            "none"
        } else {
            &conflicts
        }
    )
}

static HELD: AtomicBool = AtomicBool::new(false);
/// Bumped whenever the registrations change hands, so a capture that waits for the keys to come
/// up does not register over a newer state.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// The registrations are torn down: a release will never arrive for a key held now, so the
/// next press must toggle again.
fn unlatch() {
    HELD.store(false, Ordering::Relaxed);
    GENERATION.fetch_add(1, Ordering::Relaxed);
}

/// What must be up before the key in effect is registered again after a capture: the key
/// codes Caps Lock arrives as (F18, and Caps Lock itself) or the modifiers of the combination.
fn held_keys(effective: &str) -> (u64, Vec<u16>) {
    if effective == CAPS_LOCK {
        return (0, vec![0x4F, 0x39]);
    }
    let Ok(parsed) = Shortcut::from_str(effective) else {
        return (0, vec![]);
    };
    let flags = [
        (Modifiers::CONTROL, 0x40000),
        (Modifiers::ALT, 0x80000),
        (Modifiers::SHIFT, 0x20000),
        (Modifiers::SUPER, 0x100000),
    ]
    .into_iter()
    .filter(|(m, _)| parsed.mods.contains(*m))
    .fold(0, |all, (_, flag)| all | flag);
    (flags, vec![])
}

fn keys_down(flags: u64, codes: &[u16]) -> bool {
    unsafe { sushi_keys_down(flags, codes.as_ptr(), codes.len()) }
}

/// A held key repeats; only the first press of each hold toggles the panel.
pub(crate) fn pressed(state: ShortcutState) -> bool {
    let toggles = match state {
        ShortcutState::Pressed => !HELD.swap(true, Ordering::Relaxed),
        ShortcutState::Released => {
            HELD.store(false, Ordering::Relaxed);
            false
        }
    };
    crate::diagnostics::hotkey(state == ShortcutState::Pressed, toggles);
    toggles
}

/// Takes Caps Lock or registers the combination of `hotkey`, and keeps what is in effect.
/// Ends a capture: the key works again.
fn engage(app: &AppHandle, hotkey: &Hotkey, file_error: Option<String>) -> (Effect, Vec<String>) {
    unlatch();
    // A stage run (tests/stage) has no global-shortcut plugin and must never remap Caps Lock:
    // the decision is made as if every key registered, so the window shows a working state.
    let (effect, notes) = if crate::staged() {
        let caps = if hotkey.caps_lock {
            Caps::Taken
        } else {
            Caps::NotWanted
        };
        let (effect, notes, _) = plan(hotkey, file_error.as_deref(), caps, &mut |_| Ok(()));
        (effect, notes)
    } else {
        let shortcuts = app.global_shortcut();
        let _ = shortcuts.unregister_all();
        let caps = if hotkey.caps_lock {
            match unsafe { sushi_caps_take() } {
                0 => Caps::Taken,
                1 => Caps::InputSources,
                _ => Caps::Remapped,
            }
        } else {
            unsafe { sushi_caps_release() };
            Caps::NotWanted
        };
        let mut register = |key: &str| shortcuts.register(key).map_err(|e| e.to_string());
        let (effect, notes, release) = plan(hotkey, file_error.as_deref(), caps, &mut register);
        if release {
            unsafe { sushi_caps_release() };
        }
        (effect, notes)
    };
    let state = app.state::<State>();
    state.capturing.store(false, Ordering::Relaxed);
    state.waiting.store(false, Ordering::Relaxed);
    if let Ok(mut kept) = state.effect.lock() {
        *kept = effect.clone();
    }
    if let Ok(mut applied) = state.applied.lock() {
        *applied = Some((hotkey.clone(), file_error));
    }
    crate::tray::refresh(app);
    (effect, notes)
}

/// Reads `hotkey.json`, takes Caps Lock or registers the combination, and updates the menu.
/// Problems become notes for the panel; the panel stays reachable whenever any key registers.
pub(crate) fn apply(app: &AppHandle) -> Vec<String> {
    let Ok(dir) = app.path().app_data_dir() else {
        let (_, notes) = engage(app, &Hotkey::default(), None);
        return notes;
    };
    let (hotkey, error) = match load(&dir) {
        Ok(hotkey) => (hotkey, None),
        Err(error) => (Hotkey::default(), Some(error)),
    };
    let (_, notes) = engage(app, &hotkey, error);
    follow(
        app,
        files::read(&dir, FileName::Hotkey, check).state.revision,
    );
    crate::preferences::changed(app, crate::preferences::Changed::File(FileName::Hotkey));
    notes
}

fn follow(app: &AppHandle, revision: String) {
    if let Ok(mut kept) = app.state::<State>().revision.lock() {
        *kept = Some(revision);
    }
}

/// What a read of `hotkey.json` asks for, against the revision the effect follows.
#[derive(Debug, PartialEq)]
enum Reload {
    /// The file is the one in effect.
    Same,
    /// A valid file Sushi has not applied yet: register it.
    Apply(Hotkey),
    /// A file Sushi cannot use: the key in effect stays, and the problem says so.
    Invalid(String),
}

fn reload_action(applied: Option<&str>, snapshot: &files::Snapshot) -> Reload {
    let state = &snapshot.state;
    if applied == Some(state.revision.as_str()) {
        return Reload::Same;
    }
    match (&snapshot.bytes, state.status) {
        (None, files::Status::Absent) => Reload::Apply(Hotkey::default()),
        (Some(bytes), _) => match parse(bytes) {
            Ok(hotkey) => Reload::Apply(hotkey),
            Err(error) => Reload::Invalid(error),
        },
        (None, _) => Reload::Invalid(state.message.clone().unwrap_or_default()),
    }
}

/// A load leaves the key alone while a capture runs or the keys of one are still down: the wait
/// registers the key itself once they are up, from the file as it is then.
fn paused(capturing: bool, waiting: bool) -> bool {
    capturing || waiting
}

/// The key in effect is not the chosen one for a reason outside Sushi, or none is active: a
/// load of the window tries again.
fn worth_retrying(effect: &Effect) -> bool {
    let caps_missing = effect.caps_lock
        && effect.effective.as_deref() != Some(CAPS_LOCK)
        && effect.problem.as_ref().is_some_and(|p| {
            matches!(
                p.kind,
                ProblemKind::InputSources | ProblemKind::Remapped | ProblemKind::NotRegistered
            )
        });
    caps_missing || effect.effective.is_none()
}

/// The settings window reads `hotkey.json` (LF-18): a file edited by hand since Sushi applied
/// it takes effect now, so the pane never shows a choice beside the key of an older one. A
/// file Sushi cannot use leaves the key in effect as it is and says so. Emits nothing, so a
/// load of the window never leads to another. Main thread.
pub(crate) fn reload(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let state = app.state::<State>();
    if paused(
        state.capturing.load(Ordering::Relaxed),
        state.waiting.load(Ordering::Relaxed),
    ) {
        return;
    }
    let applied = state.revision.lock().ok().and_then(|r| r.clone());
    let snapshot = files::read(&dir, FileName::Hotkey, check);
    let revision = snapshot.state.revision.clone();
    match reload_action(applied.as_deref(), &snapshot) {
        Reload::Same => {
            // The cause of a conflict may be gone (Caps Lock no longer switches input sources,
            // the other app quit): try the chosen key again, without the file changing.
            let retry = state.effect.lock().is_ok_and(|e| worth_retrying(&e));
            let hotkey = state.applied.lock().ok().and_then(|a| a.clone());
            if let (true, Some((hotkey, error))) = (retry, hotkey) {
                engage(app, &hotkey, error);
            }
            return;
        }
        Reload::Apply(hotkey) => {
            engage(app, &hotkey, None);
        }
        Reload::Invalid(error) => {
            if let Ok(mut effect) = state.effect.lock() {
                effect.problem = Some(invalid_file(&error, effect.effective.as_deref()));
                if !effect.conflicts.contains(&"hotkey.json invalid") {
                    effect.conflicts.push("hotkey.json invalid");
                }
            }
            crate::tray::refresh(app);
        }
    }
    follow(app, revision);
}

/// The settings window's save (SUSI-12), one transaction: the shortcut is checked, the new key
/// is registered, then the file is written. A key that cannot be registered is not written, and
/// one that cannot be written is not kept: the previous key is registered again and the message
/// says what is in effect, "No shortcut is active" included.
pub(crate) fn save(
    app: &AppHandle,
    dir: &Path,
    revision: &str,
    caps_lock: bool,
    shortcut: &str,
) -> Result<files::Written, Refusal> {
    let new = Hotkey {
        caps_lock,
        shortcut: canonical(shortcut).map_err(Refusal::Invalid)?,
    };
    let bytes = render(&new).map_err(Refusal::Invalid)?;
    let previous = app
        .state::<State>()
        .applied
        .lock()
        .ok()
        .and_then(|a| a.clone())
        .unwrap_or_default();
    let mut engaged = false;
    let result = files::update_written(dir, FileName::Hotkey, Some(revision), |_| {
        engaged = true;
        let (effect, _) = engage(app, &new, None);
        // With Caps Lock in effect the combination waits as its fallback (LF-19): a new one
        // is registered once and released, so one Sushi cannot use is never saved.
        let changed =
            canonical(&previous.0.shortcut).ok().as_deref() != Some(new.shortcut.as_str());
        let backup =
            if effect.effective.as_deref() == Some(CAPS_LOCK) && changed && !crate::staged() {
                let shortcuts = app.global_shortcut();
                probe(
                    &new.shortcut,
                    |key| shortcuts.register(key).map_err(|e| e.to_string()),
                    |key| shortcuts.unregister(key).map_err(|e| e.to_string()),
                )
            } else {
                Ok(())
            };
        if effect.effective.is_none() || backup.is_err() {
            // Back to a clean state: engage drops every registration, the trial's included,
            // and takes the previous key again.
            let (back, _) = engage(app, &previous.0, previous.1.clone());
            engaged = false;
            let stuck = matches!(backup, Err(Trial::Stuck(_)))
                && app.global_shortcut().is_registered(new.shortcut.as_str());
            return Err(Refusal::Failed(refusal(
                &new.shortcut,
                &backup,
                stuck,
                &back,
            )));
        }
        Ok((Change::Write(bytes), ()))
    });
    match result {
        Ok(((), revision, written)) => {
            follow(app, revision);
            Ok(written)
        }
        Err(Refusal::Failed(why)) if engaged => {
            let (back, _) = engage(app, &previous.0, previous.1);
            Err(Refusal::Failed(format!("{why} {}", back.sentence())))
        }
        Err(other) => Err(other),
    }
}

/// How a trial registration of a backup combination failed.
#[derive(Debug, PartialEq)]
enum Trial {
    /// It could not be registered: another app may hold it.
    Taken(String),
    /// It was registered and could not be released again.
    Stuck(String),
}

/// Whether a combination can be registered now: registered, then released at once.
fn probe(
    shortcut: &str,
    register: impl FnOnce(&str) -> Result<(), String>,
    unregister: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), Trial> {
    register(shortcut).map_err(Trial::Taken)?;
    unregister(shortcut).map_err(Trial::Stuck)
}

/// What a refused keyboard save says: the key it tried, and what is in effect after the
/// previous key was taken again. `stuck`: the trial of a backup is still registered.
fn refusal(shortcut: &str, trial: &Result<(), Trial>, stuck: bool, back: &Effect) -> String {
    let key = symbols(shortcut);
    match trial {
        Err(Trial::Stuck(_)) if stuck => format!(
            "Sushi tried {key} and could not release it again: it was not saved. {} {key} may also show Sushi until Sushi quits.",
            back.sentence()
        ),
        Err(Trial::Stuck(_)) => format!(
            "Sushi tried {key} and had trouble releasing it: it was not saved. {}",
            back.sentence()
        ),
        _ => format!(
            "Sushi could not register {key}: it was not saved. {}",
            back.sentence()
        ),
    }
}

/// The settings window records a combination: the key that shows Sushi stops showing it, so
/// pressing the current combination records it instead of toggling the panel. Caps Lock stays
/// mapped; the page ignores the key it arrives as. Off registers the same key again.
pub(crate) fn capture(app: &AppHandle, on: bool) {
    let state = app.state::<State>();
    let was = state.capturing.swap(on, Ordering::Relaxed);
    if on && !was {
        let _ = app.global_shortcut().unregister_all();
        unlatch();
        state.waiting.store(false, Ordering::Relaxed);
        // A capture never outlives its page: one left on ends by itself, and the page hears
        // of it so it drops its recording state.
        let generation = GENERATION.load(Ordering::Relaxed);
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(CAPTURE_LIMIT);
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let capturing = handle.state::<State>().capturing.load(Ordering::Relaxed);
                if capturing && GENERATION.load(Ordering::Relaxed) == generation {
                    capture(&handle, false);
                    crate::preferences::changed(
                        &handle,
                        crate::preferences::Changed::File(FileName::Hotkey),
                    );
                }
            });
        });
    } else if was && !on {
        // A key still held would arrive as a press with no release before it: wait until the
        // keys of the key in effect are up, then register it again.
        let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
        let effective = state.effect.lock().ok().and_then(|e| e.effective.clone());
        let (flags, codes) = effective.as_deref().map(held_keys).unwrap_or_default();
        if !keys_down(flags, &codes) {
            resume(app);
            return;
        }
        state.waiting.store(true, Ordering::Relaxed);
        let app = app.clone();
        std::thread::spawn(move || {
            let up = wait_until_up(
                generation,
                || GENERATION.load(Ordering::Relaxed),
                || keys_down(flags, &codes),
                || std::thread::sleep(Duration::from_millis(25)),
            );
            if !up {
                return;
            }
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let state = handle.state::<State>();
                let capturing = state.capturing.load(Ordering::Relaxed);
                if GENERATION.load(Ordering::Relaxed) == generation && !capturing {
                    state.waiting.store(false, Ordering::Relaxed);
                    resume(&handle);
                    // A load while the keys were down left the file alone: apply it now.
                    reload(&handle);
                }
            });
        });
    }
}

/// How long a capture may last without its page ending it.
pub(crate) const CAPTURE_LIMIT: Duration = Duration::from_secs(60);

/// Waits, however long it takes, until the keys are up; false when a newer capture, a
/// registration or quitting made this wait stale.
fn wait_until_up(
    generation: u64,
    current: impl Fn() -> u64,
    mut down: impl FnMut() -> bool,
    mut pause: impl FnMut(),
) -> bool {
    loop {
        if current() != generation {
            return false;
        }
        if !down() {
            return true;
        }
        pause();
    }
}

/// Registers the key in effect again after a capture.
fn resume(app: &AppHandle) {
    let state = app.state::<State>();
    HELD.store(false, Ordering::Relaxed);
    let registered = state.effect.lock().ok().and_then(|e| e.registered.clone());
    if let Some(key) = registered {
        if app.global_shortcut().register(key.as_str()).is_err() {
            // The key was taken meanwhile: apply the file again, which says what is in effect.
            let (hotkey, error) = state.applied.lock().ok().and_then(|a| a.clone()).unzip();
            engage(app, &hotkey.unwrap_or_default(), error.flatten());
        }
    }
}

/// Gives Caps Lock back when Sushi quits.
pub(crate) fn release() {
    // A wait for keys to come up must not register anything while Sushi quits.
    GENERATION.fetch_add(1, Ordering::Relaxed);
    unsafe { sushi_caps_release() };
}

/// Why the window cannot record a combination now: only the settings window in front, with the
/// keyboard, may pause the key that shows Sushi.
pub(crate) fn capture_refusal(shown: bool, keyboard: bool) -> Option<&'static str> {
    (!(shown && keyboard))
        .then_some("Sushi records a combination only while the Settings window is in front.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
    fn a_saved_switch_keeps_the_combination_in_its_canonical_spelling() {
        let hotkey = Hotkey {
            caps_lock: false,
            shortcut: "command+option+p".into(),
        };
        let bytes = render(&hotkey).unwrap();
        assert_eq!(
            String::from_utf8(bytes.clone()).unwrap(),
            "{\n  \"capsLock\": false,\n  \"shortcut\": \"Option+Command+KeyP\"\n}\n"
        );
        assert_eq!(parse(&bytes).unwrap().shortcut, "Option+Command+KeyP");
        assert_eq!(render(&Hotkey::default()).unwrap(), EXAMPLE.as_bytes());
    }

    #[test]
    fn canonical_spelling_accepts_what_the_file_may_hold() {
        for (written, canonical_form) in [
            ("Control+Shift+Space", "Control+Shift+Space"),
            ("ctrl+shift+space", "Control+Shift+Space"),
            ("Shift+Control+Space", "Control+Shift+Space"),
            ("Command+Option+P", "Option+Command+KeyP"),
            ("Cmd+Alt+KeyP", "Option+Command+KeyP"),
            ("SUPER+DIGIT1", "Command+Digit1"),
            ("Control+1", "Control+Digit1"),
            ("Shift+F13", "Shift+F13"),
            ("CmdOrCtrl+K", "Command+KeyK"),
        ] {
            assert_eq!(
                canonical(written).as_deref(),
                Ok(canonical_form),
                "{written}"
            );
            assert_eq!(canonical(canonical_form).as_deref(), Ok(canonical_form));
        }
        assert!(canonical("Space")
            .unwrap_err()
            .contains("needs at least one of"));
        assert!(canonical("Meta+Space")
            .unwrap_err()
            .contains("is not a key combination"));
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

    fn run(
        hotkey: &Hotkey,
        file_error: Option<&str>,
        caps: Caps,
        refuse: &[&str],
    ) -> (Effect, Vec<String>, bool, Vec<String>) {
        let mut tried = Vec::new();
        let mut register = |key: &str| {
            tried.push(key.to_string());
            if refuse.contains(&key) {
                Err("taken".to_string())
            } else {
                Ok(())
            }
        };
        let (effect, notes, release) = plan(hotkey, file_error, caps, &mut register);
        (effect, notes, release, tried)
    }

    #[test]
    fn caps_lock_in_effect_has_no_problem() {
        let (effect, notes, release, tried) = run(&Hotkey::default(), None, Caps::Taken, &[]);
        assert_eq!(effect.effective.as_deref(), Some(CAPS_LOCK));
        assert_eq!(effect.problem, None);
        assert!(notes.is_empty() && !release);
        assert_eq!(tried, ["F18"]);
        assert_eq!(effect.label(), "Caps Lock");
    }

    #[test]
    fn a_taken_caps_lock_falls_back_to_the_combination_and_says_why() {
        let (effect, notes, _, _) = run(&Hotkey::default(), None, Caps::InputSources, &[]);
        assert_eq!(effect.effective.as_deref(), Some("Control+Shift+Space"));
        let problem = effect.problem.unwrap();
        assert_eq!(problem.kind, ProblemKind::InputSources);
        assert_eq!(
            problem.message,
            "Caps Lock switches input sources on this Mac, so ⌃⇧Space shows Sushi."
        );
        assert!(problem.advice.unwrap().contains("Input Sources"));
        assert_eq!(notes, [problem.message]);
        let (effect, _, _, _) = run(&Hotkey::default(), None, Caps::Remapped, &[]);
        assert_eq!(effect.problem.unwrap().kind, ProblemKind::Remapped);
        // Caps Lock taken but its key refused: it is given back and the combination works.
        let (effect, _, release, tried) = run(&Hotkey::default(), None, Caps::Taken, &["F18"]);
        assert!(release);
        assert_eq!(tried, ["F18", "Control+Shift+Space"]);
        assert_eq!(effect.effective.as_deref(), Some("Control+Shift+Space"));
        assert_eq!(effect.problem.unwrap().kind, ProblemKind::NotRegistered);
    }

    #[test]
    fn a_key_that_failed_to_register_is_not_shown_as_in_effect() {
        let hotkey = Hotkey {
            caps_lock: false,
            shortcut: "option+space".into(),
        };
        let (effect, notes, _, tried) = run(&hotkey, None, Caps::NotWanted, &["Option+Space"]);
        assert_eq!(
            tried,
            ["Option+Space"],
            "registered in its canonical spelling"
        );
        assert_eq!(effect.effective, None);
        assert_eq!(effect.label(), "not registered");
        assert_eq!(effect.sentence(), "No shortcut is active.");
        let problem = effect.problem.unwrap();
        assert_eq!(problem.kind, ProblemKind::NotRegistered);
        assert_eq!(
            problem.message,
            "No key shows Sushi: ⌥Space could not be registered."
        );
        assert_eq!(notes, ["Could not register ⌥Space: taken"]);
    }

    #[test]
    fn an_invalid_file_runs_the_defaults_and_says_so() {
        let error =
            "hotkey.json: 'shortcut' needs at least one of Control, Option, Shift or Command.";
        let (effect, notes, _, _) = run(&Hotkey::default(), Some(error), Caps::Taken, &[]);
        assert_eq!(effect.effective.as_deref(), Some(CAPS_LOCK));
        let problem = effect.problem.clone().unwrap();
        assert_eq!(problem.kind, ProblemKind::InvalidFile);
        assert_eq!(problem.message, error);
        assert!(problem
            .advice
            .unwrap()
            .ends_with("until then Caps Lock shows Sushi."));
        assert_eq!(notes, [error]);
        assert_eq!(effect.conflicts, ["hotkey.json invalid"]);
        // Nothing registered outranks the file.
        let (effect, _, _, _) = run(
            &Hotkey::default(),
            Some(error),
            Caps::Remapped,
            &["Control+Shift+Space"],
        );
        assert_eq!(effect.problem.unwrap().kind, ProblemKind::NotRegistered);
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
        // A capture starts while the key is held: its release never arrives, and the first
        // press after the capture still toggles.
        unlatch();
        assert!(pressed(ShortcutState::Pressed));
        pressed(ShortcutState::Released);
    }

    #[test]
    fn a_capture_resumes_only_once_the_keys_are_up() {
        use std::cell::Cell;
        // Held far longer than any limit: still waiting, then resumes once they are up.
        let polls = Cell::new(0);
        let up = wait_until_up(
            7,
            || 7,
            || polls.get() < 10_000,
            || polls.set(polls.get() + 1),
        );
        assert!(up);
        assert_eq!(polls.get(), 10_000);
        // A newer capture, a registration or quitting ends the wait without resuming.
        let generation = Cell::new(7);
        let stale = wait_until_up(7, || generation.get(), || true, || generation.set(8));
        assert!(!stale);
        assert_eq!(CAPTURE_LIMIT, Duration::from_secs(60));
    }

    #[test]
    fn a_load_retries_a_key_lost_to_something_outside_sushi() {
        let effect = |caps: Caps, refuse: &[&str]| run(&Hotkey::default(), None, caps, refuse).0;
        assert!(
            !worth_retrying(&effect(Caps::Taken, &[])),
            "Caps Lock in effect"
        );
        assert!(worth_retrying(&effect(Caps::InputSources, &[])));
        assert!(worth_retrying(&effect(Caps::Remapped, &[])));
        assert!(worth_retrying(&effect(Caps::Taken, &["F18"])));
        assert!(
            worth_retrying(&effect(Caps::Remapped, &["Control+Shift+Space"])),
            "none active"
        );
        let combination = Hotkey {
            caps_lock: false,
            shortcut: "Option+Space".into(),
        };
        let (fine, _, _, _) = run(&combination, None, Caps::NotWanted, &[]);
        assert!(!worth_retrying(&fine));
        let (none, _, _, _) = run(&combination, None, Caps::NotWanted, &["Option+Space"]);
        assert!(worth_retrying(&none));
        // An invalid file with Caps Lock in effect is the file's problem, not a lost key.
        let (invalid, _, _, _) = run(&Hotkey::default(), Some("hotkey.json: x"), Caps::Taken, &[]);
        assert!(!worth_retrying(&invalid));
    }

    #[test]
    fn a_load_never_registers_while_keys_of_a_capture_are_down() {
        assert!(!paused(false, false));
        assert!(paused(true, false), "a capture runs");
        assert!(paused(false, true), "its keys are still down");
    }

    #[test]
    fn a_backup_combination_is_tried_and_given_back() {
        use std::cell::RefCell;
        let calls = RefCell::new(Vec::new());
        let ok = probe(
            "Option+Space",
            |k| {
                calls.borrow_mut().push(format!("+{k}"));
                Ok(())
            },
            |k| {
                calls.borrow_mut().push(format!("-{k}"));
                Ok(())
            },
        );
        assert_eq!(ok, Ok(()));
        assert_eq!(*calls.borrow(), ["+Option+Space", "-Option+Space"]);
        calls.borrow_mut().clear();
        let taken = probe(
            "Option+Space",
            |_| Err("taken".into()),
            |k| {
                calls.borrow_mut().push(format!("-{k}"));
                Ok(())
            },
        );
        assert_eq!(taken, Err(Trial::Taken("taken".into())));
        assert!(calls.borrow().is_empty(), "nothing to give back");
        // Registered but not released: a failure of its own, never a success.
        let stuck = probe("Option+Space", |_| Ok(()), |_| Err("busy".into()));
        assert_eq!(stuck, Err(Trial::Stuck("busy".into())));
        let caps = run(&Hotkey::default(), None, Caps::Taken, &[]).0;
        assert_eq!(
            refusal("Option+Space", &stuck, true, &caps),
            "Sushi tried ⌥Space and could not release it again: it was not saved. Caps Lock still shows Sushi. ⌥Space may also show Sushi until Sushi quits."
        );
        assert_eq!(
            refusal("Option+Space", &stuck, false, &caps),
            "Sushi tried ⌥Space and had trouble releasing it: it was not saved. Caps Lock still shows Sushi."
        );
        assert_eq!(
            refusal("Option+Space", &taken, false, &caps),
            "Sushi could not register ⌥Space: it was not saved. Caps Lock still shows Sushi."
        );
    }

    #[test]
    fn only_the_window_in_front_may_record() {
        assert_eq!(capture_refusal(true, true), None);
        for (shown, keyboard) in [(false, false), (true, false), (false, true)] {
            assert_eq!(
                capture_refusal(shown, keyboard),
                Some("Sushi records a combination only while the Settings window is in front.")
            );
        }
    }

    #[test]
    fn a_capture_waits_for_the_keys_of_the_key_in_effect() {
        assert_eq!(held_keys(CAPS_LOCK), (0, vec![0x4F, 0x39]));
        assert_eq!(
            held_keys("Control+Shift+Space"),
            (0x40000 | 0x20000, vec![])
        );
        assert_eq!(
            held_keys("Option+Command+KeyP"),
            (0x80000 | 0x100000, vec![])
        );
        assert_eq!(held_keys("not a key"), (0, vec![]));
    }

    fn snapshot(text: Option<&str>) -> files::Snapshot {
        let dir = tempfile::tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(dir.path().join(FILE), text).unwrap();
        }
        files::read(dir.path(), FileName::Hotkey, check)
    }

    #[test]
    fn the_window_applies_a_file_edited_since_launch() {
        let edited = snapshot(Some(r#"{"capsLock": false, "shortcut": "Option+Space"}"#));
        let revision = edited.state.revision.clone();
        assert_eq!(
            reload_action(Some(&revision), &edited),
            Reload::Same,
            "no loop"
        );
        assert_eq!(
            reload_action(Some("older"), &edited),
            Reload::Apply(Hotkey {
                caps_lock: false,
                shortcut: "Option+Space".into()
            })
        );
        let broken = snapshot(Some(r#"{"capsLock": false, "shortcut": "Space"}"#));
        assert!(matches!(
            reload_action(Some(&revision), &broken),
            Reload::Invalid(e) if e.contains("needs at least one of")
        ));
        assert_eq!(
            reload_action(Some(&revision), &snapshot(None)),
            Reload::Apply(Hotkey::default())
        );
        // What the pane says while an invalid file waits: the key that stays.
        let problem = invalid_file("hotkey.json: x", Some("Option+Space"));
        assert_eq!(
            problem.advice.as_deref(),
            Some("Fix hotkey.json or start over with the defaults; until then ⌥Space shows Sushi.")
        );
        assert_eq!(
            invalid_file("hotkey.json: x", None).advice.as_deref(),
            Some("Fix hotkey.json or start over with the defaults.")
        );
    }
}
