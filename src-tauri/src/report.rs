//! Report a problem (docs/specs/report.md): the user's description, optional follow-up questions,
//! an optional recording, and a snapshot built only from the fields listed here. Sushi turns them
//! into one text the user reads, edits and sends; Sushi never sends it.

use crate::keychain::Keychain;
use crate::providers::{self, Provider};
use crate::{build_info, diagnostics, hosted, library, model, settings, tray};
use serde::{Deserialize, Serialize};
use std::{
    ffi::CStr,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

pub const FORMAT: u32 = 1;
/// Used without a model, and when the user declines to send the description to a hosted one (RP-3).
pub const FIXED: [&str; 3] = [
    "What were you doing when it happened?",
    "What did you expect to happen instead?",
    "Does it happen again when you repeat the same steps?",
];

/// The panel's state, as the page reports it: no text of the prompt (RP-6).
#[derive(Deserialize, Clone, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    /// `editor`, `actions` or `library`; `unknown` when the panel's page did not answer.
    pub view: String,
    pub versions: u32,
    pub editing: bool,
}

#[derive(Deserialize, Clone, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Answer {
    pub question: String,
    pub answer: String,
}

/// What the page needs before the first question (RP-3).
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ReportStart {
    /// The hosted provider the description would go to, or none for Ollama on this Mac.
    #[cfg_attr(test, ts(optional))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub fixed: Vec<String>,
}

/// The report as the user will see and edit it, and the size of the recording kept apart.
#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ReportDraft {
    pub text: String,
    #[cfg_attr(test, ts(optional))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recording: Option<u32>,
}

/// The kind of a problem with a settings file, never its text: a message may quote a value.
pub fn kind(error: &str) -> &'static str {
    let error = error.to_lowercase();
    [
        ("unknown field", "an unknown field"),
        ("missing field", "a missing field"),
        ("duplicate", "a duplicate entry"),
        ("is empty", "an empty field"),
        ("empty field", "an empty field"),
        ("needs exactly one", "a rule of the wrong kind"),
        ("needs both", "an incomplete term"),
        ("must be one of", "a value that is not allowed"),
        (
            "not a key combination",
            "a shortcut that is not a key combination",
        ),
        ("needs at least one of", "a shortcut without a modifier"),
        ("invalid type", "a value of the wrong type"),
        ("absolute", "a path that is not absolute"),
        ("eof while parsing", "JSON that is not valid"),
        ("expected", "JSON that is not valid"),
        ("key must be a string", "JSON that is not valid"),
    ]
    .into_iter()
    .find(|(needle, _)| error.contains(needle))
    .map_or("a problem Sushi could not classify", |(_, kind)| kind)
}

/// What the snapshot reads from the Mac; collected by [`gather`], rendered by [`snapshot`].
pub struct Facts {
    pub data: PathBuf,
    pub keychain: Keychain,
    pub hotkey: String,
    pub input_source: String,
    pub dark: bool,
    pub ollama: String,
    /// How the last hosted edit ended, if one ran since Sushi started.
    pub last_hosted: Option<(Provider, &'static str)>,
}

fn file_line(data: &Path, name: &str, check: impl Fn(&[u8]) -> Result<String, String>) -> String {
    match fs::read(data.join(name)) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => format!("{name}: absent"),
        Err(_) => format!("{name}: present, cannot be read"),
        Ok(bytes) => match check(&bytes) {
            Ok(extra) => format!("{name}: present, valid{extra}"),
            Err(error) => format!("{name}: present, invalid ({})", kind(&error)),
        },
    }
}

/// The snapshot of RP-6, from listed fields only (RP-7): nothing of the prompt, the library, the
/// dictionary, the rules or the keys, no paths and no names.
pub fn snapshot(facts: &Facts, panel: &Panel) -> String {
    let data = &facts.data;
    let mut lines = Vec::new();
    let view = match panel.view.as_str() {
        v @ ("editor" | "actions" | "library") => v,
        _ => "unknown",
    };
    lines.push(format!(
        "panel: {view} view, {} version{} in the chain, an edit {}",
        panel.versions,
        if panel.versions == 1 { "" } else { "s" },
        if panel.editing {
            "running"
        } else {
            "not running"
        }
    ));
    lines.push("settings files:".into());
    for line in [
        file_line(data, "rules.json", |b| {
            settings::check_rules(b)
                .map(|n| format!(", {n} action{}", if n == 1 { "" } else { "s" }))
        }),
        file_line(data, "dictionary.json", |b| {
            settings::check_terms(b).map(|n| format!(", {n} term{}", if n == 1 { "" } else { "s" }))
        }),
        file_line(data, "hotkey.json", |b| {
            crate::hotkey::check(b).map(|()| String::new())
        }),
        file_line(data, "model.json", |_| {
            model::load(data).map(|_| String::new())
        }),
        file_line(data, "diagnostics.json", |_| {
            diagnostics::load(data).map(|_| String::new())
        }),
        file_line(data, "library-path.txt", |_| {
            library::source(data).map(|_| String::new())
        }),
    ] {
        lines.push(format!("  {line}"));
    }
    lines.push(match library::source(data) {
        Ok((dir, source)) => {
            let count =
                |dir: &Path| library::count(dir).map_or("not readable".into(), |n| n.to_string());
            format!(
                "library: {source} folder, prompts {}, templates {}",
                count(&dir),
                count(&dir.join(".templates"))
            )
        }
        Err(error) => format!("library: not usable ({})", kind(&error)),
    });
    lines.push(format!("hotkey: {}", facts.hotkey));
    lines.push(format!(
        "keyboard: input source {}",
        if facts.input_source.is_empty() {
            "unknown"
        } else {
            &facts.input_source
        }
    ));
    lines.push(format!(
        "appearance: {}",
        if facts.dark { "dark" } else { "light" }
    ));
    let settings = model::load(data);
    let connected: Vec<&str> = Provider::ALL
        .into_iter()
        .filter(|p| facts.keychain.has(p.id()))
        .map(Provider::name)
        .collect();
    lines.push(match &settings {
        Ok(s) => match s.active() {
            None => format!("model: Ollama · {}", crate::rewrite::MODEL),
            Some(p) => format!(
                "model: {} · {} (hosted, not checked: the report sends nothing)",
                p.name(),
                s.model_name(p)
            ),
        },
        Err(error) => format!("model: not known, model.json has {}", kind(error)),
    });
    lines.push(format!(
        "connected providers: {}",
        if connected.is_empty() {
            "none".into()
        } else {
            connected.join(", ")
        }
    ));
    // Whether a hosted provider is reachable, from the last edit: the report asks no provider (RP-6).
    lines.push(match facts.last_hosted {
        Some((provider, outcome)) => format!("last hosted edit: {} {outcome}", provider.name()),
        None => "last hosted edit: none since Sushi started".into(),
    });
    lines.push(format!("ollama: {}", facts.ollama));
    lines.join("\n")
}

/// The report's text in format 1 (RP-9).
pub fn render(
    description: &str,
    answers: &[Answer],
    build: &str,
    snapshot: &str,
    recording: Option<(u64, bool)>,
) -> String {
    let mut text = format!(
        "Sushi problem report · format {FORMAT}\n\n## What went wrong\n\n{}\n",
        description.trim()
    );
    let answered: Vec<&Answer> = answers
        .iter()
        .filter(|a| !a.question.trim().is_empty())
        .collect();
    if !answered.is_empty() {
        text.push_str("\n## Follow-up questions\n\n");
        for (i, a) in answered.iter().enumerate() {
            let answer = a.answer.trim();
            text.push_str(&format!(
                "{}. {}\n   {}\n",
                i + 1,
                a.question.trim(),
                if answer.is_empty() {
                    "(skipped)"
                } else {
                    answer
                }
            ));
        }
    }
    text.push_str(&format!(
        "\n## Build\n\n{build}\n## State\n\n{snapshot}\n\n## Recording\n\n"
    ));
    text.push_str(&match recording {
        None => "No recording.\n".into(),
        Some((bytes, cut)) => format!(
            "{} ({}), sent as a separate file{}. It lists when the panel showed and hid, the keys with ⌘ or ⌃, and the bundle IDs of the apps and windows around it; never the text.\n",
            diagnostics::RECORDING,
            size(bytes),
            if cut { "; its start was cut, it keeps the last 256 KB" } else { "" }
        ),
    });
    text
}

fn size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    }
}

extern "C" {
    fn sushi_input_source(out: *mut libc::c_char, size: usize);
    fn sushi_dark() -> bool;
}

async fn gather(app: &AppHandle) -> Result<Facts, String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // Text Input Sources and AppKit want the main thread.
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let mut source = [0 as libc::c_char; 256];
        unsafe { sushi_input_source(source.as_mut_ptr(), source.len()) };
        let source = unsafe { CStr::from_ptr(source.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        let _ = send.send((source, unsafe { sushi_dark() }));
    })
    .map_err(|e| e.to_string())?;
    let (input_source, dark) = receive.await.unwrap_or_default();
    // A stage run never asks the login keychain, not even whether an item exists: its report
    // looks into a keychain file that is not there.
    let keychain = if crate::staged() {
        Keychain {
            file: Some(data.join("stage.keychain-db")),
        }
    } else {
        Keychain::default()
    };
    Ok(Facts {
        data,
        keychain,
        hotkey: crate::hotkey::summary(app),
        input_source,
        dark,
        ollama: crate::rewrite::ollama_status().await,
        last_hosted: hosted::last_outcome(),
    })
}

/// The recording of the report under way, never one left by an earlier report (RP-5): one made
/// since the flow started, finished in the panel or from the menu. It is read once, before
/// anything is awaited: leaving the flow meanwhile removes the file, and a save already under way
/// must keep what it started with.
fn recording(own: bool) -> Option<Vec<u8>> {
    recording_at(diagnostics::path(diagnostics::RECORDING), own)
}

fn recording_at(path: Option<PathBuf>, own: bool) -> Option<Vec<u8>> {
    if !own {
        return None;
    }
    fs::read(path?).ok()
}

/// The size of a recording and whether its start was cut (RP-9).
fn about(recording: &[u8]) -> (u64, bool) {
    let cut = String::from_utf8_lossy(recording).contains("[earlier records were cut");
    (recording.len() as u64, cut)
}

async fn draft(
    app: &AppHandle,
    description: &str,
    answers: &[Answer],
    panel: &Panel,
    recording: Option<&[u8]>,
) -> Result<String, String> {
    let facts = gather(app).await?;
    let build = build_info::block(&build_info::collect());
    Ok(render(
        description,
        answers,
        &build,
        &snapshot(&facts, panel),
        recording.map(about),
    ))
}

/// A folder of its own for each save, so a second save never mixes with the first: a recording
/// left out the second time must not stay from the first.
fn new_folder(reports: &Path, stamp: &str) -> std::io::Result<PathBuf> {
    fs::create_dir_all(reports)?;
    let mut attempt = 1;
    loop {
        let name = if attempt == 1 {
            stamp.to_string()
        } else {
            format!("{stamp} {attempt}")
        };
        match fs::create_dir(reports.join(&name)) {
            Ok(()) => return Ok(reports.join(name)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && attempt < 100 => {
                attempt += 1
            }
            Err(e) => return Err(e),
        }
    }
}

/// Writes the text and, if asked, the recording into a new folder and shows it in Finder (RP-8).
fn save(app: &AppHandle, text: &str, recording: Option<&[u8]>) -> Result<PathBuf, String> {
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let dir = new_folder(&logs.join("Reports"), &diagnostics::now().replace(':', "-"))
        .map_err(|e| format!("Could not save the report: {e}"))?;
    let file = dir.join("report.txt");
    fs::write(&file, text).map_err(|e| format!("Could not save the report: {e}"))?;
    if let Some(recording) = recording {
        fs::write(dir.join(diagnostics::RECORDING), recording)
            .map_err(|e| format!("Could not save the recording: {e}"))?;
    }
    if !crate::staged() {
        let _ = Command::new("/usr/bin/open").arg("-R").arg(&file).spawn();
    }
    Ok(dir)
}

/// Starts or finishes the recording; the menu and the panel follow (RP-5).
pub fn record(app: &AppHandle, on: bool) {
    if diagnostics::report(on) {
        tray::refresh(app);
        let _ = app.emit("report-recording", on);
        crate::preferences::changed(app, crate::preferences::Changed::Recording);
    }
}

// The system instruction for the follow-up questions: they help to reproduce, nothing else.
const QUESTIONS: &str = "A person describes a problem with Sushi, a macOS menu bar app for writing prompts. \
Ask at most three short follow-up questions that would help a developer reproduce the problem: what the \
person was doing, what they expected, whether it happens again. Skip what the description already answers. \
Write the questions in the same language as the description. Reply with one question per line and nothing else.";

fn questions(reply: &str) -> Vec<String> {
    reply
        .lines()
        .map(|l| {
            l.trim()
                .trim_start_matches(|c: char| c.is_ascii_digit() || "-*•.) ".contains(c))
                .trim()
        })
        .filter(|l| !l.is_empty())
        .map(|l| l.chars().take(200).collect())
        .take(3)
        .collect()
}

#[tauri::command]
pub fn report_start(app: AppHandle) -> ReportStart {
    diagnostics::forget_recording();
    let provider = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| model::load(&dir).ok())
        .and_then(|s| s.active())
        .map(|p| p.name().to_string());
    ReportStart {
        provider,
        fixed: FIXED.map(str::to_string).into(),
    }
}

/// Up to three questions from the model; it receives the description only (RP-3). A hosted
/// provider is asked only when `consent` names it: the user agreed to that provider, and a
/// switch in the menu since then does not carry the agreement over.
#[tauri::command]
pub async fn report_questions(
    app: AppHandle,
    description: String,
    consent: Option<String>,
) -> Result<Vec<String>, String> {
    if crate::staged() || description.trim().is_empty() {
        return Err("No questions.".into());
    }
    let content = format!("<description>\n{}\n</description>", description.trim());
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let settings = model::load(&dir)?;
    let reply = match settings.active() {
        None => crate::rewrite::chat(QUESTIONS, content, true).await?,
        Some(provider) if consent.as_deref() == Some(provider.name()) => {
            let key = providers::key(&settings, provider).ok_or("Not connected.")?;
            hosted::ask(
                provider.api(),
                provider,
                &settings,
                &key,
                QUESTIONS,
                &content,
            )
            .await?
            .text
        }
        Some(_) => return Err("The description stays on this Mac.".into()),
    };
    let found = questions(&reply);
    if found.is_empty() {
        Err("The model asked nothing.".into())
    } else {
        Ok(found)
    }
}

/// Starts or finishes the recording. Finished from the top of the panel, the report's window
/// comes forward with the report (RP-5).
#[tauri::command]
pub fn report_record(app: AppHandle, on: bool) {
    if !crate::staged() {
        record(&app, on);
        if !on {
            crate::report_window::open(&app);
        }
    }
}

/// The user left the flow: a recording stops, and it no longer belongs to any report (RP-5).
#[tauri::command]
pub fn report_end(app: AppHandle) {
    if !crate::staged() {
        record(&app, false);
        diagnostics::forget_recording();
    }
}

/// The panel's page answers `report-panel` with its state for the snapshot: the report is
/// built in another window, and only that page knows the view and the chain.
static PANEL: Mutex<Option<oneshot::Sender<Panel>>> = Mutex::new(None);

/// The panel's answer to `report-panel` (RP-6): never the prompt's text.
#[tauri::command]
pub fn report_panel(panel: Panel) {
    if let Some(asked) = PANEL.lock().ok().and_then(|mut asked| asked.take()) {
        let _ = asked.send(panel);
    }
}

/// What the panel shows now. A page that does not answer in time, because it is still loading,
/// gives `unknown`: the report is built anyway.
async fn panel(app: &AppHandle) -> Panel {
    let (ask, answer) = oneshot::channel();
    if let Ok(mut asked) = PANEL.lock() {
        *asked = Some(ask);
    }
    let _ = app.emit_to("main", "report-panel", ());
    match tokio::time::timeout(Duration::from_millis(500), answer).await {
        Ok(Ok(panel)) => panel,
        _ => Panel {
            view: "unknown".into(),
            versions: 0,
            editing: false,
        },
    }
}

#[tauri::command]
pub async fn report_draft(
    app: AppHandle,
    description: String,
    answers: Vec<Answer>,
) -> Result<ReportDraft, String> {
    let panel = panel(&app).await;
    let recording = recording(diagnostics::recorded());
    let text = draft(&app, &description, &answers, &panel, recording.as_deref()).await?;
    Ok(ReportDraft {
        text,
        recording: recording.map(|r| r.len().min(u32::MAX as usize) as u32),
    })
}

#[tauri::command]
pub async fn report_save(app: AppHandle, text: String, recording: bool) -> Result<(), String> {
    if crate::staged() {
        return Ok(());
    }
    let recording = recording
        .then(|| self::recording(diagnostics::recorded()))
        .flatten();
    save(&app, &text, recording.as_deref()).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKER: &str = "Zebra7Marker";

    #[test]
    fn plants_a_marker_everywhere_and_finds_none_in_the_report() {
        let scratch = crate::keychain::tests::scratch();
        let root = tempfile::tempdir().unwrap();
        // The home folder's name, in every path Sushi knows.
        let data = root.path().join(format!(
            "{MARKER}-home/Library/Application Support/me.octopot.sushi"
        ));
        let library = root.path().join(format!("{MARKER}-library"));
        fs::create_dir_all(library.join(".templates")).unwrap();
        fs::create_dir_all(&data).unwrap();
        let write = |name: &str, text: String| fs::write(data.join(name), text).unwrap();
        write(
            "rules.json",
            format!(
                r#"{{"rules":[{{"id":"{MARKER}","name":"{MARKER}","instruction":"{MARKER}","aliases":["{MARKER}"]}}]}}"#
            ),
        );
        write(
            "dictionary.json",
            format!(r#"{{"terms":[{{"from":"{MARKER}","to":"{MARKER}"}}]}}"#),
        );
        write(
            "hotkey.json",
            format!(r#"{{"capsLock":true,"shortcut":"{MARKER}"}}"#),
        );
        write(
            "model.json",
            format!(
                r#"{{"provider":"openrouter","openrouter":{{"key":"sk-{MARKER}","model":"openai/gpt-6-luna"}}}}"#
            ),
        );
        write("library-path.txt", library.display().to_string());
        fs::write(library.join(format!("{MARKER}.md")), MARKER).unwrap();
        fs::write(
            library.join(".templates").join(format!("{MARKER}.md")),
            format!("---\ntitle: {MARKER}\n---\n{MARKER}"),
        )
        .unwrap();
        scratch
            .keychain
            .store("anthropic", "Sushi: Claude", &format!("sk-{MARKER}-key"))
            .unwrap();
        let facts = Facts {
            data: data.clone(),
            keychain: scratch.keychain.clone(),
            hotkey: "capsLock true, in effect Caps Lock, conflicts none".into(),
            input_source: "com.apple.keylayout.US".into(),
            dark: true,
            ollama: "not installed".into(),
            last_hosted: Some((Provider::OpenRouter, "not reachable")),
        };
        let panel = Panel {
            view: format!("{MARKER} window title"),
            versions: 3,
            editing: false,
        };
        let snapshot = snapshot(&facts, &panel);
        let report = render(
            "It hides.",
            &[],
            &build_info::block(&build_info::collect()),
            &snapshot,
            None,
        );
        assert!(!report.contains(MARKER), "{report}");
        // …and it still says what support needs.
        assert!(
            snapshot.contains("panel: unknown view, 3 versions in the chain, an edit not running"),
            "{snapshot}"
        );
        assert!(snapshot.contains("rules.json: present, valid, 1 action"));
        assert!(snapshot
            .contains("hotkey.json: present, invalid (a shortcut that is not a key combination)"));
        assert!(snapshot.contains("library: custom folder, prompts 1, templates 1"));
        assert!(
            snapshot.contains("model: OpenRouter · gpt-6-luna (hosted"),
            "{snapshot}"
        );
        assert!(snapshot.contains("connected providers: Claude"));
        assert!(snapshot.contains("last hosted edit: OpenRouter not reachable"));
        assert!(snapshot.contains("diagnostics.json: absent"));
    }

    #[test]
    fn a_report_takes_only_its_own_recording() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(diagnostics::RECORDING);
        fs::write(&file, "an earlier report's recording\n").unwrap();
        // The file of an earlier report is on disk, but this report made no recording.
        assert_eq!(recording_at(Some(file.clone()), false), None);
        let held = recording_at(Some(file.clone()), true).unwrap();
        assert_eq!(about(&held), (30, false));
        // What was read stays, even when leaving the flow removes the file meanwhile.
        fs::remove_file(&file).unwrap();
        assert_eq!(about(&held), (30, false));
        fs::write(&file, "[earlier records were cut: …]\nx\n").unwrap();
        assert!(about(&recording_at(Some(file.clone()), true).unwrap()).1);
        assert_eq!(recording_at(Some(dir.path().join("none")), true), None);
        // The menu owns only a recording that runs now; the panel one it made in its flow.
        diagnostics::forget_recording();
        assert!(!diagnostics::recorded() && !diagnostics::reporting());
    }

    #[test]
    fn every_save_gets_a_folder_of_its_own() {
        let root = tempfile::tempdir().unwrap();
        let reports = root.path().join("Reports");
        let first = new_folder(&reports, "2026-11-23T10-00-00.123Z").unwrap();
        fs::write(first.join(diagnostics::RECORDING), "x").unwrap();
        let second = new_folder(&reports, "2026-11-23T10-00-00.123Z").unwrap();
        assert_ne!(first, second);
        assert!(!second.join(diagnostics::RECORDING).exists());
    }

    #[test]
    fn renders_format_1() {
        let answers = vec![
            Answer {
                question: "What were you doing?".into(),
                answer: "Typing.".into(),
            },
            Answer {
                question: "Does it repeat?".into(),
                answer: " ".into(),
            },
        ];
        let text = render(
            "  The panel hides.  ",
            &answers,
            "sushi:\n  version     : 0.3.0\n",
            "panel: editor view",
            Some((2048, true)),
        );
        assert!(text.starts_with(
            "Sushi problem report · format 1\n\n## What went wrong\n\nThe panel hides.\n"
        ));
        assert!(text
            .contains("1. What were you doing?\n   Typing.\n2. Does it repeat?\n   (skipped)\n"));
        assert!(text.contains(
            "## Build\n\nsushi:\n  version     : 0.3.0\n\n## State\n\npanel: editor view\n"
        ));
        assert!(text
            .contains("report-recording.log (2.0 KB), sent as a separate file; its start was cut"));
        assert!(render("x", &[], "b\n", "s", None).ends_with("## Recording\n\nNo recording.\n"));
    }

    #[test]
    fn classifies_without_quoting() {
        assert_eq!(
            kind("rules.json: duplicate rule ID 'secret'."),
            "a duplicate entry"
        );
        assert_eq!(
            kind("model.json: unknown field `secret`, expected one of"),
            "an unknown field"
        );
        assert_eq!(
            kind("dictionary.json: EOF while parsing a value at line 1 column 0"),
            "JSON that is not valid"
        );
        assert_eq!(kind("something new"), "a problem Sushi could not classify");
    }

    #[test]
    fn reads_the_questions() {
        assert_eq!(
            questions("1. Что вы делали?\n\n2) Повторяется ли?\n- Какая версия?\n4. Лишний?"),
            ["Что вы делали?", "Повторяется ли?", "Какая версия?"]
        );
    }
}
