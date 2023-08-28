#[cfg(test)]
mod bindings;
#[cfg(test)]
#[path = "../build_git.rs"]
mod build_git;
mod build_info;
mod diagnostics;
mod files;
mod hosted;
mod hotkey;
mod keychain;
mod library;
mod model;
mod preferences;
mod providers;
mod report;
mod report_window;
mod rewrite;
mod settings;
mod settings_window;
mod signin;
mod tray;

use std::{
    ffi::CString,
    io::Write,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};
use tauri::tray::TrayIconBuilder;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Listener, Manager, RunEvent, State, WindowEvent};

extern "C" {
    fn sushi_remember_frontmost();
    fn sushi_prepare_window(window: *mut std::ffi::c_void);
    fn sushi_refresh_shadow(window: *mut std::ffi::c_void);
    fn sushi_present(window: *mut std::ffi::c_void);
    fn sushi_restore_frontmost();
    fn sushi_is_active() -> bool;
    fn sushi_copy(bytes: *const u8, count: usize) -> bool;
    fn sushi_stage_appearance(name: *const libc::c_char);
    fn sushi_panel_family_key(window: *mut std::ffi::c_void) -> bool;
    fn sushi_present_sheet(window: *mut std::ffi::c_void) -> bool;
    fn sushi_panel_keeps(window: *mut std::ffi::c_void) -> bool;
    fn sushi_watch_sheets(window: *mut std::ffi::c_void, lost: extern "C" fn());
    fn sushi_test_sheet(window: *mut std::ffi::c_void);
    fn sushi_stage_present(
        window: *mut std::ffi::c_void,
        image: *const libc::c_char,
        backdrop: *mut i64,
    ) -> i64;
}

/// Stage runs must never touch the clipboard, focus, other apps or Ollama's lifecycle.
static STAGE: AtomicBool = AtomicBool::new(false);
/// The panel was shown while one of Sushi's own windows had the keyboard, the settings window
/// or the report: its label. Hiding the panel gives the keyboard back to that window, not to
/// the app underneath (PN-10).
static OVER: Mutex<Option<&'static str>> = Mutex::new(None);

/// Sushi's normal windows, in the order the panel asks them.
const WINDOWS: [&str; 2] = [settings_window::LABEL, report_window::LABEL];

/// A normal window of Sushi that is on screen.
fn own_window(app: &AppHandle, label: &str) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(label)
        .filter(|w| w.is_visible().unwrap_or(false))
}

/// The normal window of Sushi that has the keyboard, itself or through one of its sheets.
fn keyboard_window(app: &AppHandle) -> Option<&'static str> {
    WINDOWS.into_iter().find(|label| {
        own_window(app, label).is_some_and(|window| settings_window::has_keyboard(&window))
    })
}

fn set_over(label: Option<&'static str>) -> Option<&'static str> {
    OVER.lock()
        .map(|mut over| std::mem::replace(&mut *over, label))
        .unwrap_or(None)
}

pub(crate) fn staged() -> bool {
    STAGE.load(Ordering::Relaxed)
}

/// Problems found while starting (the hotkey), shown once the page asks.
#[derive(Default)]
struct StartupNotes(Mutex<Vec<String>>);

impl StartupNotes {
    fn add(&self, note: String) {
        if let Ok(mut notes) = self.0.lock() {
            notes.push(note);
        }
    }
}

#[tauri::command]
fn startup_notes(state: State<'_, StartupNotes>) -> Option<String> {
    let notes = state.0.lock().ok()?;
    (!notes.is_empty()).then(|| notes.join(" "))
}

// Dispatch window and NSApplication calls together so that focus capture precedes showing.
// The panel takes the keyboard without activating Sushi: no Space switch, and the app
// underneath stays frontmost (SUSI-2).
/// PN-11: starting Sushi leaves the menu bar icon and the key; the panel shows by itself only
/// on the first start on a Mac, so a login item or Homebrew's reopen after an upgrade puts
/// nothing in front of the user.
fn shows_at_start(first_start: bool, hidden: bool) -> bool {
    first_start && !hidden
}

fn show_launcher(app: &AppHandle, toggle: bool, reason: &'static str) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let native = window.ns_window().ok();
            // The panel's sheet has the keyboard while it is open: the hotkey still hides (PN-8).
            if toggle
                && window.is_visible().unwrap_or(false)
                && (window.is_focused().unwrap_or(false)
                    || native.is_some_and(|n| unsafe { sushi_panel_family_key(n) }))
            {
                let _ = hide(&handle, "hotkey");
                return;
            }
            // diagnostics.json is read on every show (LF-2, LF-21), and the menu follows it and
            // model.json, which the user may have edited by hand (LF-20).
            diagnostics::refresh(&handle);
            tray::refresh(&handle);
            diagnostics::record(&format!("show reason={reason}"));
            let Some(native) = native else {
                return;
            };
            // Shown over its open sheet: the sheet takes the keyboard back, the editor waits (PN-8).
            if window.is_visible().unwrap_or(false) && unsafe { sushi_present_sheet(native) } {
                diagnostics::record("show: keyboard back to the panel's sheet");
                return;
            }
            // A window and its sheets are one family: shown over a folder picker, the panel gives
            // the keyboard back to the picker.
            set_over(keyboard_window(&handle));
            unsafe { sushi_remember_frontmost() };
            unsafe {
                sushi_prepare_window(native);
                sushi_watch_sheets(native, sheet_lost);
            }
            // The key hid the panel with its sheet: the show brings both back, and the sheet has
            // the keyboard (PN-8).
            if unsafe { sushi_present_sheet(native) } {
                diagnostics::record("show: the panel with its sheet, the sheet has the keyboard");
            } else {
                let _ = window.show();
                unsafe { sushi_present(native) };
            }
            unsafe { sushi_refresh_shadow(native) };
            let _ = window.emit("launcher-shown", ());
            // PR-10 on a Mac without Writing Tools: a sheet on the first show.
            if std::env::var_os("SUSHI_TEST_SHEET").is_some() {
                unsafe { sushi_test_sheet(native) };
            }
        }
    });
}

/// Set once the app starts, for the callback of the panel's sheets.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// The keyboard left the panel and its sheets: the panel hides (PN-5).
fn focus_lost(app: &AppHandle) {
    if let Some(webview) = app.get_webview_window("main") {
        diagnostics::focus_lost(&webview);
    }
    let _ = hide(app, "focus-lost");
}

/// One of the panel's sheets lost the keyboard to another app or window (PN-8).
extern "C" fn sheet_lost() {
    if let Some(app) = APP.get() {
        focus_lost(app);
    }
}

/// Hides the panel. Where the keyboard goes: to the window of Sushi the panel was shown over,
/// the settings window or the report (Esc, a copy, the hotkey), nowhere when a click already
/// gave it to one of them, and otherwise back to the app the user came from, as before (SUSI-2).
fn hide(app: &AppHandle, reason: &str) -> Result<(), String> {
    if staged() {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            diagnostics::record(&format!("hide reason={reason}"));
        }
        let active = unsafe { sushi_is_active() };
        let over = set_over(None)
            .filter(|_| reason != "focus-lost")
            .and_then(|label| own_window(app, label));
        window.hide().map_err(|e| e.to_string())?;
        if active {
            match over {
                Some(under) => settings_window::take_keyboard(&under),
                // A click already gave the keyboard to one of Sushi's windows or its sheets.
                None if keyboard_window(app).is_some() => (),
                None => unsafe { sushi_restore_frontmost() },
            }
        }
    }
    Ok(())
}

/// A normal window of Sushi takes the keyboard, the settings window or the report: the panel
/// hides without handing it to the app underneath, which gets it back when the window closes.
pub(crate) fn hide_for_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            diagnostics::record("hide reason=settings");
            let _ = window.hide();
        }
    }
    set_over(None);
}

/// `reason`: `esc` or `copy`, for the diagnostic log (LF-22).
#[tauri::command]
fn hide_launcher(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    // Synchronous desktop commands run on the UI thread.
    let reason = match reason.as_deref() {
        Some("esc") => "esc",
        Some("copy") => "copy",
        _ => "page",
    };
    hide(&app, reason)
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    if staged() {
        return Ok(());
    }
    if unsafe { sushi_copy(text.as_ptr(), text.len()) } {
        Ok(())
    } else {
        Err("Could not copy the text to the macOS clipboard.".into())
    }
}

/// Shows a log in Finder, selected.
fn reveal_log(name: &str) {
    if let Some(path) = diagnostics::path(name).filter(|p| p.exists()) {
        let _ = Command::new("/usr/bin/open").arg("-R").arg(path).spawn();
    }
}

/// The window a stage run presents: `main` (the panel), or `settings` or `report` with
/// `SUSHI_STAGE_WINDOW=<label>`.
fn stage_label() -> &'static str {
    match std::env::var("SUSHI_STAGE_WINDOW").as_deref() {
        Ok(settings_window::LABEL) => settings_window::LABEL,
        Ok(report_window::LABEL) => report_window::LABEL,
        _ => "main",
    }
}

// Stage mode renders the real window off-screen for screenshots: no hotkey, no tray,
// no activation, and never the real profile.
fn stage_present(app: &AppHandle) {
    let label = stage_label();
    let settings = label == settings_window::LABEL;
    let window = if label == report_window::LABEL {
        // The panel stays, hidden: the report asks its page what the panel shows (RP-6).
        report_window::stage(app)
    } else if settings {
        // `SUSHI_STAGE_PANE`: the pane the window opens on, as the menu would ask for it.
        let pane = std::env::var("SUSHI_STAGE_PANE")
            .ok()
            .and_then(|pane| serde_json::from_value(serde_json::Value::String(pane)).ok());
        let window = settings_window::stage(app, pane);
        // The panel's page would read and seed the settings files too: a settings run checks
        // what the settings window alone does.
        if let Some(panel) = app.get_webview_window("main") {
            let _ = panel.destroy();
        }
        window
    } else {
        app.get_webview_window("main")
    };
    let Some(window) = window else {
        eprintln!("SUSHI_STAGE: the window could not be made.");
        app.exit(1);
        return;
    };
    let Ok(native) = window.ns_window() else {
        return;
    };
    let image = std::env::var("SUSHI_STAGE_BACKDROP")
        .ok()
        .and_then(|path| CString::new(path).ok());
    // The panel's own window setup; a normal window keeps the one it was made with.
    if label == "main" {
        unsafe { sushi_prepare_window(native) };
    }
    let mut backdrop = 0;
    let id = unsafe {
        sushi_stage_present(
            native,
            image.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()),
            &mut backdrop,
        )
    };
    if id < 0 {
        app.exit(3);
        return;
    }
    let mut out = std::io::stdout();
    let _ = writeln!(
        out,
        "SUSHI_STAGE_WINDOW={id}\nSUSHI_STAGE_BACKDROP_WINDOW={backdrop}"
    );
    let _ = out.flush();
}

fn main() {
    // Before the single-instance check and any AppKit call (BI-5).
    if std::env::args().nth(1).as_deref() == Some("version") {
        print!("{}", build_info::block(&build_info::collect()));
        return;
    }
    let stage = std::env::var_os("SUSHI_STAGE").is_some_and(|v| v == "1");
    STAGE.store(stage, Ordering::Relaxed);
    if !stage {
        // On a cold start the app the user came from is still frontmost.
        unsafe { sushi_remember_frontmost() };
    }
    // `--hidden` keeps the panel closed even on the first start (PN-11).
    let hidden = std::env::args().any(|arg| arg == "--hidden");
    let context = tauri::generate_context!();
    if stage && context.config().identifier == "me.octopot.sushi" {
        eprintln!("SUSHI_STAGE needs a build with a separate identifier, not me.octopot.sushi.");
        std::process::exit(2);
    }
    let notes = StartupNotes::default();
    let mut builder = tauri::Builder::default();
    if stage {
        builder = builder.activate_ignoring_other_apps(false);
        if let Some(path) = std::env::var_os("SUSHI_STAGE_SCRIPT") {
            let label = stage_label();
            builder = builder.on_page_load(move |webview, payload| {
                if payload.event() == PageLoadEvent::Finished && webview.label() == label {
                    match std::fs::read_to_string(&path) {
                        Ok(script) => {
                            let _ = webview.eval(script);
                        }
                        Err(error) => eprintln!("SUSHI_STAGE_SCRIPT: {error}"),
                    }
                }
            });
        }
    } else {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _, _| {
                show_launcher(app, false, "second-launch")
            }))
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _, event| {
                        if hotkey::pressed(event.state) {
                            show_launcher(app, true, "hotkey");
                        }
                    })
                    .build(),
            );
    }
    let app = builder
        .manage(notes)
        .manage(hotkey::State::default())
        .manage(rewrite::Requests::default())
        .setup(move |app| {
            // Read before anything is seeded: no settings folder yet means that Sushi starts
            // on this Mac for the first time (PN-11).
            let first_start = !app.path().app_data_dir().is_ok_and(|dir| dir.exists());
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let _ = APP.set(app.handle().clone());
            if stage {
                if let Some(name) = std::env::var("SUSHI_STAGE_APPEARANCE")
                    .ok()
                    .and_then(|name| CString::new(name).ok())
                {
                    unsafe { sushi_stage_appearance(name.as_ptr()) };
                }
                if stage_label() == settings_window::LABEL {
                    // As at launch: hotkey.json is read, seeded when missing, and its effect
                    // decided; nothing is registered in a stage run (hotkey.rs, `engage`).
                    hotkey::apply(app.handle());
                }
                if stage_label() != "main" {
                    // The stage script's lines (`stage-report` events) go to stdout, where
                    // tests/stage/settings.sh and report.sh read them.
                    app.listen_any("stage-report", |event| {
                        let line = serde_json::from_str::<String>(event.payload())
                            .unwrap_or_else(|_| event.payload().to_string());
                        let mut out = std::io::stdout();
                        let _ = writeln!(out, "{line}");
                        let _ = out.flush();
                    });
                }
                return Ok(());
            }
            diagnostics::init(app.handle());
            diagnostics::refresh(app.handle());
            providers::init(app.handle());
            let menu = tray::build(app.handle())?;
            TrayIconBuilder::with_id(tray::ID)
                .tooltip("Sushi")
                .icon(tauri::include_image!("icons/menu-template.png"))
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "sushi-show" => show_launcher(app, false, "menu"),
                    "sushi-key-problem" => {
                        settings_window::open(app, Some(preferences::PaneId::Keyboard))
                    }
                    "sushi-settings" => settings_window::open(app, None),
                    "sushi-about" => settings_window::open(app, Some(preferences::PaneId::About)),
                    "sushi-diagnostics" => reveal_log(diagnostics::LOG),
                    // The flow has a window of its own (RP-1).
                    "sushi-report" => report_window::open(app),
                    "sushi-report-finish" => {
                        report::record(app, false);
                        report_window::open(app);
                    }
                    "sushi-quit" => app.exit(0),
                    id => {
                        let _ = providers::on_menu(app, id);
                    }
                })
                .build(app)?;

            for note in hotkey::apply(app.handle()) {
                app.state::<StartupNotes>().add(note);
            }
            if shows_at_start(first_start, hidden) {
                show_launcher(app.handle(), false, "launch");
            }
            Ok(())
        })
        // By window label first: the panel's rules concern `main` only (SUSI-12).
        .on_window_event(|window, event| match window.label() {
            "main" => match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = hide(window.app_handle(), "close-request");
                }
                // As with Spotlight, a click in another app or on the desktop hides the panel;
                // focus stays where the user clicked (SUSI-2). A sheet of the panel that takes
                // the keyboard keeps it open (PN-8); `sheet_lost` covers the sheet losing it.
                WindowEvent::Focused(false) if window.is_visible().unwrap_or(false) => {
                    let keeps = window
                        .ns_window()
                        .is_ok_and(|native| unsafe { sushi_panel_keeps(native) });
                    if keeps {
                        diagnostics::record("focus kept: the panel's sheet has the keyboard");
                    } else {
                        focus_lost(window.app_handle());
                    }
                }
                _ => (),
            },
            settings_window::LABEL => settings_window::on_event(window, event),
            report_window::LABEL => report_window::on_event(window, event),
            _ => (),
        })
        .invoke_handler(tauri::generate_handler![
            hide_launcher,
            copy_text,
            startup_notes,
            settings::settings_load,
            settings::dictionary_open,
            library::library_list,
            library::library_read,
            rewrite::rewrite,
            rewrite::cancel_rewrite,
            rewrite::warm_model,
            rewrite::ollama_download,
            diagnostics::diagnostics_key,
            diagnostics::diagnostics_state,
            providers::provider_connect,
            report::report_start,
            report::report_questions,
            report::report_record,
            report::report_end,
            report::report_draft,
            report::report_panel,
            report::report_save,
            preferences::prefs_load,
            preferences::prefs_keyboard_save,
            preferences::prefs_capture,
            preferences::prefs_model_select,
            preferences::prefs_model_option,
            preferences::prefs_connect,
            preferences::prefs_connect_cancel,
            preferences::prefs_disconnect,
            preferences::prefs_actions_save,
            preferences::prefs_dictionary_save,
            preferences::prefs_library_choose,
            preferences::prefs_library_default,
            preferences::prefs_diagnostics_save,
            preferences::prefs_reset,
            preferences::prefs_file,
            preferences::prefs_action,
            preferences::prefs_open
        ])
        .build(context)
        .expect("Sushi could not start");
    app.run(move |app, event| match event {
        RunEvent::Ready if stage => stage_present(app),
        RunEvent::Reopen { .. } if !stage => show_launcher(app, false, "reopen"),
        RunEvent::Exit if !stage => hotkey::release(),
        _ => (),
    });
}

#[cfg(test)]
mod tests {
    use super::shows_at_start;

    #[test]
    fn the_panel_shows_by_itself_only_on_the_first_start() {
        assert!(shows_at_start(true, false));
        assert!(
            !shows_at_start(false, false),
            "a later start: the icon and the key only"
        );
        assert!(
            !shows_at_start(true, true),
            "--hidden keeps it closed even then"
        );
        assert!(!shows_at_start(false, true));
    }
}
