mod hotkey;
mod library;
mod migrate;
mod rewrite;
mod settings;

use std::{
    ffi::CString,
    io::Write,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

extern "C" {
    fn sushi_remember_frontmost();
    fn sushi_prepare_window(window: *mut std::ffi::c_void);
    fn sushi_refresh_shadow(window: *mut std::ffi::c_void);
    fn sushi_present(window: *mut std::ffi::c_void);
    fn sushi_restore_frontmost();
    fn sushi_is_active() -> bool;
    fn sushi_copy(bytes: *const u8, count: usize) -> bool;
    fn sushi_stage_appearance(name: *const libc::c_char);
    fn sushi_stage_present(
        window: *mut std::ffi::c_void,
        image: *const libc::c_char,
        backdrop: *mut i64,
    ) -> i64;
}

/// Stage runs must never touch the clipboard, focus, other apps or Ollama's lifecycle.
static STAGE: AtomicBool = AtomicBool::new(false);

pub(crate) fn staged() -> bool {
    STAGE.load(Ordering::Relaxed)
}

/// Problems found while starting (the hotkey, the move from Susi), shown once the page asks.
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
fn show_launcher(app: &AppHandle, toggle: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            if toggle
                && window.is_visible().unwrap_or(false)
                && window.is_focused().unwrap_or(false)
            {
                let _ = hide(&handle);
                return;
            }
            unsafe { sushi_remember_frontmost() };
            let Ok(native) = window.ns_window() else {
                return;
            };
            unsafe { sushi_prepare_window(native) };
            let _ = window.show();
            unsafe {
                sushi_present(native);
                sushi_refresh_shadow(native);
            }
            let _ = window.emit("launcher-shown", ());
        }
    });
}

fn hide(app: &AppHandle) -> Result<(), String> {
    if staged() {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("main") {
        let active = unsafe { sushi_is_active() };
        window.hide().map_err(|e| e.to_string())?;
        if active {
            unsafe { sushi_restore_frontmost() };
        }
    }
    Ok(())
}

#[tauri::command]
fn hide_launcher(app: AppHandle) -> Result<(), String> {
    // Synchronous desktop commands run on the UI thread.
    hide(&app)
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

fn open_settings_folder(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = Command::new("/usr/bin/open").arg(dir).spawn();
    }
}

// Stage mode renders the real window off-screen for screenshots: no hotkey, no tray,
// no activation, and never the real profile.
fn stage_present(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(native) = window.ns_window() else {
        return;
    };
    let image = std::env::var("SUSHI_STAGE_BACKDROP")
        .ok()
        .and_then(|path| CString::new(path).ok());
    unsafe { sushi_prepare_window(native) };
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
    let stage = std::env::var_os("SUSHI_STAGE").is_some_and(|v| v == "1");
    STAGE.store(stage, Ordering::Relaxed);
    if !stage {
        // On a cold start the app the user came from is still frontmost.
        unsafe { sushi_remember_frontmost() };
    }
    // `--hidden` starts with the tray and hotkey only, e.g. after an update.
    let hidden = std::env::args().any(|arg| arg == "--hidden");
    let context = tauri::generate_context!();
    if stage && context.config().identifier == "me.octopot.sushi" {
        eprintln!("SUSHI_STAGE needs a build with a separate identifier, not me.octopot.sushi.");
        std::process::exit(2);
    }
    let notes = StartupNotes::default();
    if !stage {
        // Before the webview exists: WebKit must find the copied draft in its new folder.
        if let Some(note) = migrate::run(&context.config().identifier) {
            notes.add(note);
        }
    }
    let mut builder = tauri::Builder::default();
    if stage {
        builder = builder.activate_ignoring_other_apps(false);
        if let Some(path) = std::env::var_os("SUSHI_STAGE_SCRIPT") {
            builder = builder.on_page_load(move |webview, payload| {
                if payload.event() == PageLoadEvent::Finished {
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
                show_launcher(app, false)
            }))
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _, event| {
                        if hotkey::pressed(event.state) {
                            show_launcher(app, true);
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
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            if stage {
                if let Some(name) = std::env::var("SUSHI_STAGE_APPEARANCE")
                    .ok()
                    .and_then(|name| CString::new(name).ok())
                {
                    unsafe { sushi_stage_appearance(name.as_ptr()) };
                }
                return Ok(());
            }
            let show = MenuItem::with_id(app, "sushi-show", "Show Sushi", true, None::<&str>)?;
            let folder = MenuItem::with_id(
                app,
                "sushi-folder",
                "Open Settings Folder",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "sushi-quit", "Quit", true, None::<&str>)?;
            let key = MenuItem::with_id(app, "sushi-key", "Shows Sushi:", false, None::<&str>)?;
            let caps_lock = CheckMenuItem::with_id(
                app,
                "sushi-caps-lock",
                "Use Caps Lock",
                true,
                false,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let keys = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[&show, &key, &caps_lock, &keys, &folder, &separator, &quit],
            )?;
            hotkey::attach(
                app.handle(),
                hotkey::Menu {
                    label: key,
                    caps_lock,
                },
            );
            TrayIconBuilder::with_id("sushi")
                .tooltip("Sushi")
                .icon(tauri::include_image!("icons/menu-template.png"))
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "sushi-show" => show_launcher(app, false),
                    "sushi-folder" => open_settings_folder(app),
                    "sushi-caps-lock" => hotkey::toggle_caps_lock(app),
                    "sushi-quit" => app.exit(0),
                    _ => (),
                })
                .build(app)?;

            for note in hotkey::apply(app.handle()) {
                app.state::<StartupNotes>().add(note);
            }
            if !hidden {
                show_launcher(app.handle(), false);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = hide(window.app_handle());
            }
            // As with Spotlight, a click in another app or on the desktop hides the panel;
            // focus stays where the user clicked (SUSI-2).
            WindowEvent::Focused(false) if window.is_visible().unwrap_or(false) => {
                let _ = hide(window.app_handle());
            }
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
            rewrite::ollama_download
        ])
        .build(context)
        .expect("Sushi could not start");
    app.run(move |app, event| match event {
        RunEvent::Ready if stage => stage_present(app),
        RunEvent::Reopen { .. } if !stage => show_launcher(app, false),
        RunEvent::Exit if !stage => hotkey::release(),
        _ => (),
    });
}
