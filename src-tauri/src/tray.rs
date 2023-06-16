//! The menu of the menu bar icon, built whole from the current state and built again when that
//! state changes: the key in effect, the Model choice, a recording, the diagnostic mode. The rows
//! are a value ([`rows`]) first, so the menu can be tested without AppKit.

use crate::hotkey::{self, ProblemKind, CAPS_LOCK};
use crate::{diagnostics, providers};
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Wry};

pub const ID: &str = "sushi";

extern "C" {
    fn sushi_menu_caps_hint(status_item: *mut std::ffi::c_void, on: bool) -> bool;
}

/// What the menu depends on.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct State {
    /// The key in effect: `caps-lock`, a canonical combination, or None.
    pub effective: Option<String>,
    pub problem: Option<ProblemKind>,
    /// The `⇪` hint can be set on the native item of Show Sushi.
    pub caps_hint: bool,
    /// A problem report records (RP-5).
    pub recording: bool,
    /// `diagnostics.json` records (LF-23).
    pub diagnostics: bool,
}

/// One row of the menu, before it becomes a native item.
#[derive(Clone, Debug, PartialEq)]
pub enum Row {
    Item {
        id: &'static str,
        text: String,
        /// A native shortcut hint, as `Control+Shift+Space`.
        accelerator: Option<String>,
    },
    Separator,
    /// Model ▸ (MD-15), built by `providers::menu`.
    Model,
}

fn item(id: &'static str, text: &str, accelerator: Option<&str>) -> Row {
    Row::Item {
        id,
        text: text.into(),
        accelerator: accelerator.map(str::to_string),
    }
}

/// The row that appears only when the key in effect is not the chosen one, or none is; it
/// opens Settings ▸ Keyboard.
fn problem_row(state: &State) -> Option<&'static str> {
    if state.effective.is_none() {
        return Some("No shortcut is active…");
    }
    match state.problem? {
        ProblemKind::InvalidFile => Some("Shortcut settings need attention…"),
        ProblemKind::InputSources | ProblemKind::Remapped | ProblemKind::NotRegistered => {
            Some("Caps Lock unavailable…")
        }
    }
}

/// The menu's rows, in order (docs/specs/panel.md, PN-7). The key in effect is the shortcut
/// hint of Show Sushi: a combination as its native accelerator, Caps Lock as `⇪` set on the
/// native item, or in the title when that item cannot be reached. `F18`, the key Caps Lock
/// arrives as, is never shown.
pub fn rows(state: &State) -> Vec<Row> {
    let show = match state.effective.as_deref() {
        Some(CAPS_LOCK) if state.caps_hint => item("sushi-show", "Show Sushi", None),
        Some(CAPS_LOCK) => item("sushi-show", "Show Sushi · ⇪", None),
        Some(combination) => item("sushi-show", "Show Sushi", Some(combination)),
        None => item("sushi-show", "Show Sushi", None),
    };
    let mut rows = vec![show];
    if let Some(text) = problem_row(state) {
        rows.push(item("sushi-key-problem", text, None));
    }
    rows.extend([
        Row::Model,
        Row::Separator,
        item("sushi-settings", "Settings…", Some("Command+Comma")),
        // One way in: the flow in the panel (RP-1).
        item("sushi-report", "Report a problem…", None),
    ]);
    if state.recording {
        rows.push(item("sushi-report-finish", "Finish recording", None));
    }
    if state.diagnostics {
        rows.push(item("sushi-diagnostics", "Diagnostics on · Show log", None));
    }
    rows.extend([
        Row::Separator,
        item("sushi-about", "About Sushi", None),
        item("sushi-quit", "Quit Sushi", Some("Command+KeyQ")),
    ]);
    rows
}

/// Turns the `⇪` hint on the status item's menu on or off; false when the item is out of reach.
fn caps_hint(app: &AppHandle, on: bool) -> bool {
    let Some(tray) = app.tray_by_id(ID) else {
        return false;
    };
    tray.with_inner_tray_icon(move |inner| {
        inner.ns_status_item().is_some_and(|item| {
            let pointer: *const _ = &*item;
            unsafe { sushi_menu_caps_hint(pointer as *mut std::ffi::c_void, on) }
        })
    })
    .unwrap_or(false)
}

fn native(app: &AppHandle, row: Row) -> tauri::Result<Box<dyn IsMenuItem<Wry>>> {
    Ok(match row {
        Row::Item {
            id,
            text,
            accelerator,
        } => match MenuItem::with_id(app, id, &text, true, accelerator.as_deref()) {
            Ok(item) => Box::new(item),
            // A combination the menu cannot draw as a shortcut is named in the title instead.
            Err(_) => {
                let text = match accelerator {
                    Some(shortcut) => format!("{text} · {}", hotkey::symbols(&shortcut)),
                    None => text,
                };
                Box::new(MenuItem::with_id(app, id, text, true, None::<&str>)?)
            }
        },
        Row::Separator => Box::new(PredefinedMenuItem::separator(app)?),
        Row::Model => Box::new(providers::menu(app)?),
    })
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let effect = hotkey::effect(app);
    let diagnostics = diagnostics::state();
    let caps = effect.effective.as_deref() == Some(CAPS_LOCK);
    // Set again on every build: the hint belongs to the menu the status item gets next.
    let reachable = caps_hint(app, caps);
    let state = State {
        effective: effect.effective,
        problem: effect.problem.map(|p| p.kind),
        caps_hint: reachable,
        recording: diagnostics.report,
        diagnostics: diagnostics.file,
    };
    let items = rows(&state)
        .into_iter()
        .map(|row| native(app, row))
        .collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// Builds the menu again; on the main thread, as AppKit wants.
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let (Some(tray), Ok(menu)) = (handle.tray_by_id(ID), build(&handle)) {
            let _ = tray.set_menu(Some(menu));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(rows: &[Row]) -> Vec<String> {
        rows.iter()
            .map(|row| match row {
                Row::Item {
                    text, accelerator, ..
                } => match accelerator {
                    Some(a) => format!("{text} [{a}]"),
                    None => text.clone(),
                },
                Row::Separator => "—".into(),
                Row::Model => "Model ▸".into(),
            })
            .collect()
    }

    #[test]
    fn the_usual_menu_has_no_row_for_the_key() {
        let state = State {
            effective: Some(CAPS_LOCK.into()),
            caps_hint: true,
            ..State::default()
        };
        assert_eq!(
            texts(&rows(&state)),
            [
                "Show Sushi",
                "Model ▸",
                "—",
                "Settings… [Command+Comma]",
                "Report a problem…",
                "—",
                "About Sushi",
                "Quit Sushi [Command+KeyQ]",
            ]
        );
    }

    #[test]
    fn the_key_in_effect_is_the_hint_of_show_sushi() {
        let combination = State {
            effective: Some("Option+Command+KeyP".into()),
            ..State::default()
        };
        assert_eq!(
            texts(&rows(&combination))[0],
            "Show Sushi [Option+Command+KeyP]"
        );
        // Caps Lock without a reachable native item reads in the title; never F18.
        let unreachable = State {
            effective: Some(CAPS_LOCK.into()),
            ..State::default()
        };
        assert_eq!(texts(&rows(&unreachable))[0], "Show Sushi · ⇪");
        for state in [combination, unreachable] {
            assert!(!texts(&rows(&state)).join(" ").contains("F18"));
        }
    }

    #[test]
    fn a_problem_gets_a_row_that_leads_to_the_setting() {
        let row = |effective: Option<&str>, problem| {
            texts(&rows(&State {
                effective: effective.map(str::to_string),
                problem,
                ..State::default()
            }))[1]
                .clone()
        };
        assert_eq!(
            row(Some("Control+Shift+Space"), Some(ProblemKind::InputSources)),
            "Caps Lock unavailable…"
        );
        assert_eq!(
            row(Some("Control+Shift+Space"), Some(ProblemKind::Remapped)),
            "Caps Lock unavailable…"
        );
        assert_eq!(
            row(None, Some(ProblemKind::NotRegistered)),
            "No shortcut is active…"
        );
        assert_eq!(
            row(Some(CAPS_LOCK), Some(ProblemKind::InvalidFile)),
            "Shortcut settings need attention…"
        );
        let none = rows(&State {
            effective: None,
            ..State::default()
        });
        assert_eq!(none[0], item("sushi-show", "Show Sushi", None), "no hint");
        assert_eq!(
            none[1],
            item("sushi-key-problem", "No shortcut is active…", None)
        );
    }

    #[test]
    fn a_recording_and_the_diagnostic_mode_add_their_rows() {
        let state = State {
            effective: Some(CAPS_LOCK.into()),
            caps_hint: true,
            recording: true,
            diagnostics: true,
            ..State::default()
        };
        let texts = texts(&rows(&state));
        let at = texts.iter().position(|t| t == "Report a problem…").unwrap();
        assert_eq!(
            texts[at + 1..at + 3],
            ["Finish recording", "Diagnostics on · Show log"]
        );
    }
}
