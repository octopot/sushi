//! The settings window (SUSI-12): one normal window, `settings`, made on the first open from
//! `settings.html` and hidden, not destroyed, on close. Sushi stays an accessory app; opening the
//! window activates it so the window takes the keyboard. Window events are dispatched by label
//! in main.rs: the panel's rules (PN-5, PN-8) and `sushi_prepare_window` never apply here.

use crate::preferences::PaneId;
use std::{
    ffi::{CStr, CString},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Emitter, Manager, TitleBarStyle, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tokio::sync::oneshot;

pub const LABEL: &str = "settings";

extern "C" {
    fn sushi_remember_frontmost();
    fn sushi_restore_frontmost();
    fn sushi_is_active() -> bool;
    fn sushi_activate_window(window: *mut std::ffi::c_void);
    fn sushi_window_family_key(window: *mut std::ffi::c_void) -> bool;
    fn sushi_window_family_focus(window: *mut std::ffi::c_void);
    fn sushi_choose_folder(
        window: *mut std::ffi::c_void,
        start: *const libc::c_char,
        done: extern "C" fn(*mut std::ffi::c_void, *const libc::c_char),
        context: *mut std::ffi::c_void,
    );
}

/// The page has loaded and listens for `prefs-pane`.
static READY: AtomicBool = AtomicBool::new(false);
/// A pane asked for while the page was still loading; sent once it has.
static PENDING: Mutex<Option<PaneId>> = Mutex::new(None);
/// The failure of a flow the window started and that ended after it closed: shown as a sheet
/// on the next open, never as an alert over another app.
static NOTE: Mutex<Option<(String, String)>> = Mutex::new(None);

/// Keeps a failure for the window's next open; a newer one replaces it.
pub fn hold_note(title: &str, text: &str) {
    if let Ok(mut note) = NOTE.lock() {
        *note = Some((title.into(), text.into()));
    }
}

/// The window, when it exists and is on screen.
pub fn shown(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
        .filter(|w| w.is_visible().unwrap_or(false))
}

/// Shows `pane`: at once when the page listens, otherwise as soon as it does. The first load
/// carries its pane in the URL.
fn request(app: &AppHandle, pane: PaneId) {
    if READY.load(Ordering::Relaxed) {
        let _ = app.emit_to(LABEL, "prefs-pane", pane);
    } else if let Ok(mut pending) = PENDING.lock() {
        *pending = Some(pane);
    }
}

fn create(app: &AppHandle, pane: Option<PaneId>) -> tauri::Result<WebviewWindow> {
    READY.store(false, Ordering::Relaxed);
    let url = match pane {
        Some(pane) => format!("settings.html#{}", pane.as_str()),
        None => "settings.html".to_string(),
    };
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(url.into()))
        .title("Sushi settings")
        .inner_size(760.0, 560.0)
        .min_inner_size(680.0, 460.0)
        .resizable(true)
        .center()
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .visible(false)
        .on_page_load(|webview, payload| match payload.event() {
            // A reload ends a capture: the page that started it is gone.
            PageLoadEvent::Started => {
                READY.store(false, Ordering::Relaxed);
                crate::hotkey::capture(webview.app_handle(), false);
            }
            PageLoadEvent::Finished => {
                READY.store(true, Ordering::Relaxed);
                let pending = PENDING.lock().ok().and_then(|mut p| p.take());
                if let Some(pane) = pending {
                    let _ = webview.app_handle().emit_to(LABEL, "prefs-pane", pane);
                }
            }
        })
        .build()
}

/// A stage run (tests/stage): the window made as `open` makes it, loading `pane`, and never
/// shown, activated or focused here; main.rs puts it under the wallpaper.
pub fn stage(app: &AppHandle, pane: Option<PaneId>) -> Option<WebviewWindow> {
    create(app, pane).ok()
}

/// Opens the window, or brings it forward and shows `pane`. The panel gives way without handing
/// the keyboard back to the app underneath; that app gets it again when the window closes.
pub fn open(app: &AppHandle, pane: Option<PaneId>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        crate::hide_for_window(&handle);
        unsafe { sushi_remember_frontmost() };
        let window = match handle.get_webview_window(LABEL) {
            Some(window) => {
                if let Some(pane) = pane {
                    request(&handle, pane);
                }
                window
            }
            None => match create(&handle, pane) {
                Ok(window) => window,
                Err(error) => {
                    crate::diagnostics::record(&format!("settings: could not open ({error})"));
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
        let note = NOTE.lock().ok().and_then(|mut n| n.take());
        if let Some((title, text)) = note {
            let app = handle.clone();
            tauri::async_runtime::spawn(async move {
                crate::providers::alert_in(
                    &app,
                    crate::providers::Origin::Settings,
                    &title,
                    &text,
                    &["OK"],
                    false,
                )
                .await;
            });
        }
    });
}

/// Hides the window and gives the app the user came from the keyboard back; the panel does not
/// show.
fn close(window: &tauri::Window) {
    let app = window.app_handle();
    crate::hotkey::capture(app, false);
    let _ = window.hide();
    let panel = app
        .get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    // Only while Sushi has the keyboard: a window closed from elsewhere must not pull an app
    // to the front.
    if !panel && !crate::staged() && unsafe { sushi_is_active() } {
        // The report stays open when Settings closes, and has the keyboard next.
        match crate::report_window::shown(app) {
            Some(report) => take_keyboard(&report),
            None => unsafe { sushi_restore_frontmost() },
        }
    }
}

/// The window's own events. A capture ends when the window loses the keyboard, hides or goes.
pub fn on_event(window: &tauri::Window, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            close(window);
        }
        WindowEvent::Focused(false) => crate::hotkey::capture(window.app_handle(), false),
        WindowEvent::Destroyed => {
            READY.store(false, Ordering::Relaxed);
            crate::hotkey::capture(window.app_handle(), false);
        }
        _ => (),
    }
}

/// The window or one of its sheets (a folder picker, a connect screen) has the keyboard: for
/// the panel they are one. Main thread only; false off it.
pub fn has_keyboard(window: &WebviewWindow) -> bool {
    window
        .ns_window()
        .is_ok_and(|native| unsafe { sushi_window_family_key(native) })
}

/// Gives the keyboard back to the window, or to its deepest sheet, as when the panel shown over
/// it hides.
pub fn take_keyboard(window: &WebviewWindow) {
    if let Ok(native) = window.ns_window() {
        unsafe { sushi_window_family_focus(native) };
    }
}

type Picked = oneshot::Sender<Option<PathBuf>>;

extern "C" fn folder_done(context: *mut std::ffi::c_void, path: *const libc::c_char) {
    let send = unsafe { Box::from_raw(context.cast::<Picked>()) };
    let path = (!path.is_null()).then(|| {
        use std::os::unix::ffi::OsStrExt;
        PathBuf::from(std::ffi::OsStr::from_bytes(
            unsafe { CStr::from_ptr(path) }.to_bytes(),
        ))
    });
    let _ = send.send(path);
}

/// The native folder picker, directories only: a sheet of the window when it is shown. None
/// for a cancel.
pub async fn choose_folder(app: &AppHandle, start: PathBuf) -> Option<PathBuf> {
    // A stage run presents no sheet: the picker counts as cancelled.
    if crate::staged() {
        return None;
    }
    let (send, receive) = oneshot::channel::<Option<PathBuf>>();
    let start = {
        use std::os::unix::ffi::OsStrExt;
        CString::new(start.as_os_str().as_bytes()).ok()
    };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        // Decided here, where the window closes: a picker whose window is hidden or gone by
        // now counts as cancelled, and never opens on its own over another app.
        let Some(native) = shown(&handle).and_then(|w| w.ns_window().ok()) else {
            let _ = send.send(None);
            return;
        };
        let context = Box::into_raw(Box::new(send));
        unsafe {
            sushi_choose_folder(
                native,
                start.as_ref().map_or(std::ptr::null(), |s| s.as_ptr()),
                folder_done,
                context.cast(),
            )
        };
    });
    receive.await.ok().flatten()
}
