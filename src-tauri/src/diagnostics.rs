//! Why the panel showed and hid (SUSI-7): an optional recording in a plain-text log, turned on by
//! `diagnostics.json` or, for a problem report, in memory (docs/specs/local-files.md, LF-21 to
//! LF-23; docs/specs/report.md, RP-5). It never records the prompt, typed characters or other
//! apps' window titles.

use crate::build_info;
use serde::{Deserialize, Serialize};
use std::{
    ffi::CStr,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub const FILE: &str = "diagnostics.json";
/// The log the file turns on, in `~/Library/Logs/me.octopot.sushi/`.
pub const LOG: &str = "diagnostics.log";
/// The recording of a problem report, next to it; started empty for each report.
pub const RECORDING: &str = "report-recording.log";
/// A log over this size is cut from the start (LF-22).
pub const LIMIT: u64 = 512 * 1024;
const CUT: &str = "[earlier records were cut: the log keeps its last 256 KB]\n";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    record: bool,
}

/// Reads the switch out of the bytes of `diagnostics.json`.
pub fn parse(bytes: &[u8]) -> Result<bool, String> {
    serde_json::from_slice::<Settings>(bytes)
        .map(|s| s.record)
        .map_err(|e| format!("{FILE}: {e}"))
}

/// The bytes the settings window writes for the switch.
pub fn render(record: bool) -> Vec<u8> {
    let mut text = serde_json::to_string_pretty(&Settings { record }).expect("a switch serializes");
    text.push('\n');
    text.into_bytes()
}

/// Reads `diagnostics.json`: a missing file means off. Only the settings window creates it
/// (LF-21).
pub fn load(dir: &Path) -> Result<bool, String> {
    let data = match fs::read(dir.join(FILE)) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        other => other.map_err(|e| format!("{FILE}: {e}"))?,
    };
    parse(&data)
}

static LOGS: OnceLock<PathBuf> = OnceLock::new();
static FROM_FILE: AtomicBool = AtomicBool::new(false);
static FOR_REPORT: AtomicBool = AtomicBool::new(false);
/// A recording was made for the report under way; one left from an earlier report never counts.
static RECORDED: AtomicBool = AtomicBool::new(false);
/// The last combination with ⌘ or ⌃ the page reported, as `⌘A` (LF-22).
static LAST_COMBINATION: Mutex<String> = Mutex::new(String::new());
/// The error of the last read of the file, shown on every show until it is fixed.
static FILE_ERROR: Mutex<Option<String>> = Mutex::new(None);

pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = LOGS.set(dir);
    }
}

pub fn on() -> bool {
    FROM_FILE.load(Ordering::Relaxed) || FOR_REPORT.load(Ordering::Relaxed)
}

pub fn reporting() -> bool {
    FOR_REPORT.load(Ordering::Relaxed)
}

/// What the page shows on every show (LF-23).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Diagnostics {
    /// `diagnostics.json` turns the recording on.
    pub file: bool,
    /// A problem report is recording (RP-5).
    pub report: bool,
    /// Why `diagnostics.json` was not read, as `diagnostics.json: …`.
    #[cfg_attr(test, ts(optional))]
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub fn state() -> Diagnostics {
    Diagnostics {
        file: FROM_FILE.load(Ordering::Relaxed),
        report: reporting(),
        error: FILE_ERROR.lock().ok().and_then(|e| e.clone()),
    }
}

/// Reads the file again (on every show, LF-2) and starts or stops the log. Returns whether the
/// state changed, so the menu can follow.
pub fn refresh(app: &AppHandle) -> bool {
    let Ok(dir) = app.path().app_data_dir() else {
        return false;
    };
    let (wanted, error) = match load(&dir) {
        Ok(wanted) => (wanted, None),
        // An invalid file keeps the recording as it was, so a typo does not lose the record.
        Err(error) => (FROM_FILE.load(Ordering::Relaxed), Some(error)),
    };
    let changed_error = FILE_ERROR
        .lock()
        .map(|mut e| std::mem::replace(&mut *e, error.clone()) != error)
        .unwrap_or(false);
    let was = FROM_FILE.swap(wanted, Ordering::Relaxed);
    if wanted && !was {
        start(LOG, false);
    } else if was && !wanted {
        write(LOG, "recording stopped: diagnostics.json turns it off");
    }
    changed_error || was != wanted
}

/// Starts or finishes the recording of a problem report. Starting empties its file.
pub fn report(on: bool) -> bool {
    let was = FOR_REPORT.swap(on, Ordering::Relaxed);
    if on && !was {
        RECORDED.store(true, Ordering::Relaxed);
        start(RECORDING, true);
    } else if was && !on {
        write(RECORDING, "recording finished");
    }
    was != on
}

/// Whether the report under way has a recording of its own (RP-5).
pub fn recorded() -> bool {
    RECORDED.load(Ordering::Relaxed)
}

/// A new report starts without a recording: the file of an earlier one is removed.
pub fn forget_recording() {
    if reporting() {
        return;
    }
    RECORDED.store(false, Ordering::Relaxed);
    if let Some(path) = path(RECORDING) {
        let _ = fs::remove_file(path);
    }
}

pub fn path(name: &str) -> Option<PathBuf> {
    LOGS.get().map(|dir| dir.join(name))
}

/// UTC with milliseconds: `2026-11-23T10:00:00.123Z`.
pub fn now() -> String {
    let since = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    utc(since.as_secs() as i64, since.subsec_millis())
}

fn utc(seconds: i64, millis: u32) -> String {
    let days = seconds.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let rest = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// Every session of a log starts with the build info block (LF-22, BI-1).
fn start(name: &str, empty: bool) {
    let Some(path) = path(name) else { return };
    let _ = fs::create_dir_all(path.parent().unwrap_or(Path::new("/")));
    if empty {
        let _ = fs::remove_file(&path);
    }
    let header = format!(
        "{}{} recording started\n",
        build_info::block(&build_info::collect()),
        now()
    );
    let _ = append(&path, &header);
}

fn append(path: &Path, text: &str) -> io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(text.as_bytes())?;
    if file.metadata()?.len() > LIMIT {
        drop(file);
        cut(path)?;
    }
    Ok(())
}

/// Keeps the block of the build that writes now and the last half of the limit, from a line start.
fn cut(path: &Path) -> io::Result<()> {
    let text = fs::read_to_string(path)?;
    let keep = (LIMIT / 2) as usize;
    let mut from = text.len().saturating_sub(keep);
    while !text.is_char_boundary(from) {
        from += 1;
    }
    let tail = &text[from..];
    let tail = tail.split_once('\n').map_or(tail, |(_, rest)| rest);
    let cut = format!("{}{CUT}{tail}", build_info::block(&build_info::collect()));
    crate::settings::replace(path, cut.as_bytes())
}

fn write(name: &str, line: &str) {
    if let Some(path) = path(name) {
        let _ = append(&path, &format!("{} {line}\n", now()));
    }
}

/// Appends one record to every log that is on.
pub fn record(line: &str) {
    if FROM_FILE.load(Ordering::Relaxed) {
        write(LOG, line);
    }
    if reporting() {
        write(RECORDING, line);
    }
}

/// Records the hotkey's every press and release (LF-22).
pub fn hotkey(pressed: bool, toggles: bool) {
    if !on() {
        return;
    }
    record(match (pressed, toggles) {
        (true, true) => "hotkey pressed",
        (true, false) => "hotkey pressed (a repeat while held, ignored)",
        (false, _) => "hotkey released",
    });
}

/// `⌘A`, `⌃⇧K`: only modifiers and one key name, never typed text.
fn combination(text: &str) -> Option<String> {
    let mods: String = text.chars().take_while(|c| "⌃⌥⇧⌘".contains(*c)).collect();
    let key = &text[mods.len()..];
    let valid = (mods.contains('⌘') || mods.contains('⌃'))
        && !key.is_empty()
        && key.chars().count() <= 12
        && key.chars().all(|c| c.is_ascii_alphanumeric());
    valid.then(|| text.to_string())
}

/// The page reports each combination with ⌘ or ⌃ while the recording is on.
#[tauri::command]
pub fn diagnostics_key(combination: String) {
    if !on() {
        return;
    }
    let Some(combination) = self::combination(&combination) else {
        return;
    };
    record(&format!("key {combination}"));
    if let Ok(mut last) = LAST_COMBINATION.lock() {
        *last = combination;
    }
}

#[tauri::command]
pub fn diagnostics_state() -> Diagnostics {
    state()
}

extern "C" {
    fn sushi_focus_snapshot(
        window: *mut std::ffi::c_void,
        done: extern "C" fn(*const libc::c_char),
    );
}

extern "C" fn focus_recorded(text: *const libc::c_char) {
    if text.is_null() {
        return;
    }
    let what = unsafe { CStr::from_ptr(text) }.to_string_lossy();
    let last = LAST_COMBINATION
        .lock()
        .map(|l| if l.is_empty() { "-".into() } else { l.clone() })
        .unwrap_or_default();
    record(&format!("focus lost: {what}; last combination {last}"));
}

/// The panel lost the keyboard: what Sushi can see without a permission, one run-loop turn
/// later, once the window that took the keyboard is known (LF-22).
pub fn focus_lost(window: &tauri::WebviewWindow) {
    if !on() {
        return;
    }
    if let Ok(native) = window.ns_window() {
        unsafe { sushi_focus_snapshot(native, focus_recorded) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = include_str!("../../docs/specs/examples/diagnostics.json");

    fn with(contents: Option<&str>) -> Result<bool, String> {
        let dir = tempfile::tempdir().unwrap();
        if let Some(contents) = contents {
            fs::write(dir.path().join(FILE), contents).unwrap();
        }
        load(dir.path())
    }

    #[test]
    fn reads_the_switch() {
        assert_eq!(
            with(None),
            Ok(false),
            "no file: off, and nothing is created"
        );
        assert_eq!(with(Some(EXAMPLE)), Ok(true));
        assert_eq!(with(Some(r#"{"record": false}"#)), Ok(false));
        assert_eq!(render(true), EXAMPLE.as_bytes());
        assert_eq!(parse(&render(false)), Ok(false));
    }

    #[test]
    fn rejects_invalid_files() {
        let error = |contents: &str| with(Some(contents)).unwrap_err();
        assert!(error(r#"{"record": true, "verbose": true}"#)
            .starts_with("diagnostics.json: unknown field `verbose`"));
        assert!(error(r#"{"record": "yes"}"#).starts_with("diagnostics.json: invalid type"));
        assert!(error("{}").starts_with("diagnostics.json: missing field `record`"));
        assert!(error("").starts_with("diagnostics.json: EOF"));
    }

    #[test]
    fn keeps_only_combinations() {
        assert_eq!(combination("⌘A").as_deref(), Some("⌘A"));
        assert_eq!(combination("⌃⇧Space").as_deref(), Some("⌃⇧Space"));
        assert_eq!(combination("⇧A"), None, "no ⌘ or ⌃: typing");
        assert_eq!(combination("⌘"), None);
        assert_eq!(combination("⌘secret text"), None);
        assert_eq!(combination("⌘ä"), None);
    }

    #[test]
    fn cuts_a_long_log_from_the_start() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(LOG);
        let line = "2026-11-23T10:00:00.000Z hide reason=focus-lost\n";
        let mut text = String::new();
        while (text.len() as u64) < LIMIT {
            text.push_str(line);
        }
        fs::write(&path, &text).unwrap();
        append(&path, "2026-11-23T10:00:01.000Z last\n").unwrap();
        let cut = fs::read_to_string(&path).unwrap();
        assert!(
            cut.starts_with("sushi:\n  version     : "),
            "the block first"
        );
        assert!(cut.contains(CUT));
        assert!(cut.ends_with("last\n"));
        assert!((cut.len() as u64) <= LIMIT / 2 + 2048, "{}", cut.len());
        let after = cut.split_once(CUT).unwrap().1;
        assert!(after.starts_with("2026-"), "from a line start");
    }

    #[test]
    fn writes_utc_with_milliseconds() {
        assert_eq!(utc(0, 7), "1970-01-01T00:00:00.007Z");
        assert_eq!(utc(1_795_420_800, 123), "2026-11-23T08:00:00.123Z");
    }
}
