mod library;
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
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

extern "C" {
    fn susi_remember_frontmost();
    fn susi_prepare_window(window: *mut std::ffi::c_void);
    fn susi_refresh_shadow(window: *mut std::ffi::c_void);
    fn susi_activate();
    fn susi_restore_frontmost();
    fn susi_is_active() -> bool;
    fn susi_copy(bytes: *const u8, count: usize) -> bool;
    fn susi_stage_appearance(name: *const libc::c_char);
    fn susi_stage_present(
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

#[derive(Default)]
struct ShortcutStatus(Mutex<Option<String>>);

#[tauri::command]
fn shortcut_status(state: State<'_, ShortcutStatus>) -> Option<String> {
    state.0.lock().ok().and_then(|status| status.clone())
}

// Dispatch window and NSApplication calls together so that focus capture precedes activation.
fn show_launcher(app: &AppHandle, toggle: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            if toggle && unsafe { susi_is_active() } && window.is_focused().unwrap_or(false) {
                let _ = hide(&handle);
                return;
            }
            unsafe { susi_remember_frontmost() };
            let native = window.ns_window().ok();
            if let Some(native) = native {
                unsafe { susi_prepare_window(native) };
            }
            let _ = window.unminimize();
            let _ = window.show();
            unsafe { susi_activate() };
            let _ = window.set_focus();
            if let Some(native) = native {
                unsafe { susi_refresh_shadow(native) };
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
        let active = unsafe { susi_is_active() };
        window.hide().map_err(|e| e.to_string())?;
        if active {
            unsafe { susi_restore_frontmost() };
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
    if unsafe { susi_copy(text.as_ptr(), text.len()) } {
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
    let image = std::env::var("SUSI_STAGE_BACKDROP")
        .ok()
        .and_then(|path| CString::new(path).ok());
    unsafe { susi_prepare_window(native) };
    let mut backdrop = 0;
    let id = unsafe {
        susi_stage_present(
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
        "SUSI_STAGE_WINDOW={id}\nSUSI_STAGE_BACKDROP_WINDOW={backdrop}"
    );
    let _ = out.flush();
}

fn main() {
    let stage = std::env::var_os("SUSI_STAGE").is_some_and(|v| v == "1");
    STAGE.store(stage, Ordering::Relaxed);
    if !stage {
        // On a cold start the app the user came from is still frontmost.
        unsafe { susi_remember_frontmost() };
    }
    // `--hidden` starts with the tray and hotkey only, e.g. after an update.
    let hidden = std::env::args().any(|arg| arg == "--hidden");
    let context = tauri::generate_context!();
    if stage && context.config().identifier == "me.octopot.susi" {
        eprintln!("SUSI_STAGE needs a build with a separate identifier, not me.octopot.susi.");
        std::process::exit(2);
    }
    let mut builder = tauri::Builder::default();
    if stage {
        builder = builder.activate_ignoring_other_apps(false);
        if let Some(path) = std::env::var_os("SUSI_STAGE_SCRIPT") {
            builder = builder.on_page_load(move |webview, payload| {
                if payload.event() == PageLoadEvent::Finished {
                    match std::fs::read_to_string(&path) {
                        Ok(script) => {
                            let _ = webview.eval(script);
                        }
                        Err(error) => eprintln!("SUSI_STAGE_SCRIPT: {error}"),
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
                        if event.state == ShortcutState::Pressed {
                            show_launcher(app, true);
                        }
                    })
                    .build(),
            );
    }
    let app = builder
        .manage(ShortcutStatus::default())
        .manage(rewrite::Requests::default())
        .setup(move |app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            if stage {
                if let Some(name) = std::env::var("SUSI_STAGE_APPEARANCE")
                    .ok()
                    .and_then(|name| CString::new(name).ok())
                {
                    unsafe { susi_stage_appearance(name.as_ptr()) };
                }
                return Ok(());
            }
            let show = MenuItem::with_id(app, "susi-show", "Show Susi", true, None::<&str>)?;
            let folder = MenuItem::with_id(
                app,
                "susi-folder",
                "Open Settings Folder",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "susi-quit", "Quit", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show, &folder, &separator, &quit])?;
            TrayIconBuilder::with_id("susi")
                .tooltip("Susi")
                .icon(tauri::include_image!("icons/menu-template.png"))
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "susi-show" => show_launcher(app, false),
                    "susi-folder" => open_settings_folder(app),
                    "susi-quit" => app.exit(0),
                    _ => (),
                })
                .build(app)?;

            if let Err(error) = app.global_shortcut().register("super+shift+space") {
                *app.state::<ShortcutStatus>().0.lock().unwrap() =
                    Some(format!("Could not register ⌘⇧Space: {error}"));
            }
            if !hidden {
                show_launcher(app.handle(), false);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = hide(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            hide_launcher,
            copy_text,
            shortcut_status,
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
        .expect("Susi could not start");
    app.run(move |app, event| match event {
        RunEvent::Ready if stage => stage_present(app),
        RunEvent::Reopen { .. } if !stage => show_launcher(app, false),
        _ => (),
    });
}
