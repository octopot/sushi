//! The window of Report a problem (docs/specs/report.md, RP-1): one normal window, `report`,
//! made on the first open from `report.html` and hidden, not destroyed, on close. A report is
//! written while looking at other apps and at Sushi itself, so the flow does not live in the
//! panel, which hides when the keyboard leaves it. As with the settings window, opening it
//! makes Sushi the active app; the panel's rules never apply here.

use crate::settings_window;
use tauri::{
    AppHandle, Emitter, Manager, TitleBarStyle, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub const LABEL: &str = "report";

extern "C" {
    fn sushi_remember_frontmost();
    fn sushi_restore_frontmost();
    fn sushi_is_active() -> bool;
    fn sushi_activate_window(window: *mut std::ffi::c_void);
}

/// The window, when it exists and is on screen.
pub fn shown(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
        .filter(|w| w.is_visible().unwrap_or(false))
}

fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("report.html".into()))
        .title("Report a problem")
        .inner_size(640.0, 560.0)
        .min_inner_size(520.0, 420.0)
        .resizable(true)
        .center()
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .visible(false)
        .build()
}

/// A stage run (tests/stage): the window made as `open` makes it, and never shown, activated
/// or focused here; main.rs puts it under the wallpaper.
pub fn stage(app: &AppHandle) -> Option<WebviewWindow> {
    create(app).ok()
}

/// Opens the window, or brings it forward with the flow where the user left it. The panel
/// gives way without handing the keyboard back to the app underneath; that app gets it again
/// when the window closes.
pub fn open(app: &AppHandle) {
    if crate::staged() {
        return;
    }
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        crate::hide_for_window(&handle);
        unsafe { sushi_remember_frontmost() };
        let window = match handle.get_webview_window(LABEL) {
            Some(window) => window,
            None => match create(&handle) {
                Ok(window) => window,
                Err(error) => {
                    crate::diagnostics::record(&format!("report: could not open ({error})"));
                    return;
                }
            },
        };
        let _ = window.unminimize();
        let _ = window.show();
        if let Ok(native) = window.ns_window() {
            unsafe { sushi_activate_window(native) };
        }
        let _ = window.set_focus();
        // The page shows the flow where it is; a page still loading starts it by itself.
        let _ = handle.emit_to(LABEL, "report-open", ());
    });
}

/// Hides the window; the flow stays as the user left it. The keyboard goes to the settings
/// window when it is open, otherwise back to the app the user came from; the panel does not show.
fn close(window: &tauri::Window) {
    let app = window.app_handle();
    let _ = window.hide();
    let panel = app
        .get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    // Only while Sushi has the keyboard: a window closed from elsewhere must not pull an app
    // to the front.
    if panel || !unsafe { sushi_is_active() } {
        return;
    }
    match settings_window::shown(app) {
        Some(settings) => settings_window::take_keyboard(&settings),
        None => unsafe { sushi_restore_frontmost() },
    }
}

pub fn on_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        close(window);
    }
}
