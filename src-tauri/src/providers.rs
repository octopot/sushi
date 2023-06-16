//! Hosted providers and the one flow that connects any of them (docs/specs/model.md, MD-10 to
//! MD-16): the Model menu, the screen that says what leaves the Mac and who pays, signing in or
//! pasting a key, the keychain item, and disconnecting. A provider only supplies what
//! [`Provider`] lists; the flow is the same for all.

use crate::files::{self, Change, FileName, Refusal};
use crate::keychain::Keychain;
use crate::preferences::{self, Changed};
use crate::{hosted, model, signin, tray};
use serde::Serialize;
use std::{
    ffi::{CStr, CString},
    path::PathBuf,
    process::Command,
    sync::Mutex,
};
use tauri::menu::{CheckMenuItem, IsMenuItem, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};
use tokio::sync::oneshot;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Provider {
    OpenRouter,
    OpenAi,
    Anthropic,
}

/// How a provider gives Sushi a key.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Connect {
    /// Sign in through the browser (OAuth PKCE): no key to copy.
    SignIn,
    /// Paste an API key once; Sushi checks it at once.
    PasteKey,
}

impl Provider {
    pub const ALL: [Provider; 3] = [Provider::OpenRouter, Provider::OpenAi, Provider::Anthropic];

    /// The value of `provider` in `model.json` and the keychain account.
    pub fn id(self) -> &'static str {
        match self {
            Self::OpenRouter => "openrouter",
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
        }
    }
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.id() == id)
    }
    /// The name in the menu, the hint and every message.
    pub fn name(self) -> &'static str {
        match self {
            Self::OpenRouter => "OpenRouter",
            Self::OpenAi => "OpenAI",
            Self::Anthropic => "Claude",
        }
    }
    /// Who receives the text.
    pub fn company(self) -> &'static str {
        match self {
            Self::OpenRouter => "OpenRouter",
            Self::OpenAi => "OpenAI",
            Self::Anthropic => "Anthropic",
        }
    }
    /// The label of the keychain item.
    pub fn label(self) -> String {
        format!("Sushi: {}", self.name())
    }
    pub fn api(self) -> &'static str {
        match self {
            Self::OpenRouter => "https://openrouter.ai/api/v1",
            Self::OpenAi => "https://api.openai.com/v1",
            Self::Anthropic => "https://api.anthropic.com/v1",
        }
    }
    pub fn connect(self) -> Connect {
        match self {
            Self::OpenRouter => Connect::SignIn,
            Self::OpenAi | Self::Anthropic => Connect::PasteKey,
        }
    }
    /// Where the user sees, limits or deletes the key.
    pub fn keys_page(self) -> &'static str {
        match self {
            Self::OpenRouter => "https://openrouter.ai/settings/keys",
            Self::OpenAi => "https://platform.openai.com/api-keys",
            Self::Anthropic => "https://platform.claude.com/settings/keys",
        }
    }
    /// The provider's public list of models, for choosing the model in the settings window.
    pub fn models_page(self) -> &'static str {
        match self {
            Self::OpenRouter => "https://openrouter.ai/models",
            Self::OpenAi => "https://platform.openai.com/docs/models",
            Self::Anthropic => "https://platform.claude.com/docs/en/about-claude/models/overview",
        }
    }
    /// Who pays, and what the provider is asked not to do with the text.
    pub fn terms(self) -> &'static str {
        match self {
            Self::OpenRouter => "Billed to your OpenRouter credits. OpenRouter sends edits only to providers that do not train on them; they may still keep them for a while.",
            Self::OpenAi => "Billed to your OpenAI API credits, not to a ChatGPT subscription. Sushi asks OpenAI not to store the requests.",
            Self::Anthropic => "Billed to your Anthropic API credits, not to a Claude subscription.",
        }
    }
}

/// Which providers have a key in the keychain, read at launch and kept up to date by the flow.
static CONNECTED: Mutex<Vec<Provider>> = Mutex::new(Vec::new());
/// A sign-in that waits for the browser; a new one ends it.
static WAITING: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

pub fn connected(provider: Provider) -> bool {
    CONNECTED.lock().is_ok_and(|c| c.contains(&provider))
}

/// Reads the keychain again, for the settings window: a key deleted in Keychain Access shows.
/// Returns whether anything changed, so the menu can follow.
pub fn recheck() -> bool {
    let keychain = Keychain::default();
    Provider::ALL
        .into_iter()
        .map(|provider| recheck_in(&keychain, provider))
        .fold(false, |changed, one| changed | one)
}

/// Reads the keychain again for one provider, as a choice of it is about to be written;
/// returns whether the cache changed.
pub fn recheck_one(provider: Provider) -> bool {
    recheck_in(&Keychain::default(), provider)
}

fn recheck_in(keychain: &Keychain, provider: Provider) -> bool {
    let has = keychain.has(provider.id());
    let changed = connected(provider) != has;
    mark(provider, has);
    changed
}

pub(crate) fn mark(provider: Provider, on: bool) {
    if let Ok(mut connected) = CONNECTED.lock() {
        connected.retain(|p| *p != provider);
        if on {
            connected.push(provider);
        }
    }
}

fn settings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// At launch: a key left in `model.json` by v0.2.1 moves to the keychain (MD-12), then the
/// menu learns which providers are connected.
pub fn init(app: &AppHandle) {
    let keychain = Keychain::default();
    if let Ok(dir) = settings_dir(app) {
        let _ = model::move_key(&dir, &keychain);
    }
    for provider in Provider::ALL {
        mark(provider, keychain.has(provider.id()));
    }
}

/// The key of a provider for one edit: the keychain, or a key `model.json` still holds because
/// it could not be moved (MD-12).
pub fn key(settings: &model::Settings, provider: Provider) -> Option<String> {
    let legacy = (provider == Provider::OpenRouter)
        .then(|| settings.openrouter.as_ref().and_then(|s| s.key.clone()))
        .flatten()
        .map(|k| k.trim().to_string());
    let key = legacy.or_else(|| Keychain::default().read(provider.id()));
    mark(provider, key.is_some());
    key
}

fn ollama_label() -> String {
    format!("Ollama · {} (on this Mac)", crate::rewrite::MODEL)
}

fn choice_label(settings: Option<&model::Settings>, provider: Option<Provider>) -> String {
    match (provider, settings) {
        (None, _) => ollama_label(),
        (Some(p), Some(s)) => format!("{} · {}", p.name(), s.model_name(p)),
        (Some(p), None) => p.name().into(),
    }
}

/// A key is stored for `provider`: in the keychain (`in_keychain`, the cache [`connected`]
/// keeps), or one of v0.2.1 that `model.json` still holds because it could not be moved
/// (MD-12). The menu and the settings window both ask this.
pub fn keyed(
    in_keychain: &[Provider],
    settings: Option<&model::Settings>,
    provider: Provider,
) -> bool {
    in_keychain.contains(&provider)
        || (provider == Provider::OpenRouter
            && settings
                .and_then(|s| s.openrouter.as_ref())
                .is_some_and(|s| s.key.is_some()))
}

/// One row of Model ▸, before it becomes a native item.
#[derive(Clone, Debug, PartialEq)]
pub enum ModelRow {
    /// The problem of an invalid `model.json`, as the first item (MD-3).
    Problem(String),
    Choice {
        id: String,
        text: String,
        checked: bool,
        enabled: bool,
    },
    Separator,
    /// Opens Settings ▸ Model.
    Settings(&'static str),
}

/// The title and rows of Model ▸ (MD-15, SUSI-12) as a value: the model in use, the choices
/// (Ollama, each connected provider, and an active one without a key) and the way to the
/// settings window, where providers are connected and disconnected.
pub fn model_menu(
    loaded: Result<&model::Settings, &str>,
    connected: &[Provider],
) -> (String, Vec<ModelRow>) {
    let mut rows = Vec::new();
    let settings = loaded.ok();
    let active = settings.map(model::Settings::active);
    let connected: Vec<Provider> = Provider::ALL
        .into_iter()
        .filter(|p| keyed(connected, settings, *p))
        .collect();
    let connected = connected.as_slice();
    let title = match (settings, active.flatten()) {
        (None, _) => "Model · Needs attention".to_string(),
        (Some(_), None) => format!("Model · {}", crate::rewrite::MODEL),
        (Some(s), Some(p)) => format!("Model · {}", s.model_name(p)),
    };
    if let Err(error) = loaded {
        rows.push(ModelRow::Problem(error.to_string()));
    }
    let choices = std::iter::once(None).chain(
        Provider::ALL
            .into_iter()
            .filter(|p| connected.contains(p) || active == Some(Some(*p)))
            .map(Some),
    );
    for choice in choices {
        let text = match choice {
            Some(p) if !connected.contains(&p) => format!("{} · not connected", p.name()),
            _ => choice_label(settings, choice),
        };
        rows.push(ModelRow::Choice {
            id: format!("model-use-{}", choice.map_or("ollama", Provider::id)),
            text,
            checked: active == Some(choice),
            enabled: settings.is_some(),
        });
    }
    rows.push(ModelRow::Separator);
    rows.push(ModelRow::Settings(if settings.is_some() {
        "Model settings…"
    } else {
        "Fix model settings…"
    }));
    (title, rows)
}

/// Model ▸ in the menu bar menu, built from [`model_menu`].
pub fn menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let loaded = settings_dir(app).and_then(|dir| model::load(&dir));
    let connected: Vec<Provider> = Provider::ALL
        .into_iter()
        .filter(|p| connected(*p))
        .collect();
    let (title, rows) = model_menu(loaded.as_ref().map_err(String::as_str), &connected);
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();
    for row in rows {
        items.push(match row {
            ModelRow::Problem(text) => Box::new(MenuItem::new(app, text, false, None::<&str>)?),
            ModelRow::Choice {
                id,
                text,
                checked,
                enabled,
            } => Box::new(CheckMenuItem::with_id(
                app,
                id,
                text,
                enabled,
                checked,
                None::<&str>,
            )?),
            ModelRow::Separator => Box::new(PredefinedMenuItem::separator(app)?),
            ModelRow::Settings(text) => Box::new(MenuItem::with_id(
                app,
                "model-settings",
                text,
                true,
                None::<&str>,
            )?),
        });
    }
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i.as_ref()).collect();
    Submenu::with_id_and_items(app, "sushi-model", title, true, &refs)
}

/// Handles the items of [`menu`]; false for an item that is not one of them.
pub fn on_menu(app: &AppHandle, id: &str) -> bool {
    if let Some(rest) = id.strip_prefix("model-use-") {
        choose(app, Provider::from_id(rest));
    } else if id == "model-settings" {
        crate::settings_window::open(app, Some(preferences::PaneId::Model));
    } else {
        return false;
    }
    true
}

/// One click switches the provider; the check mark follows the file, not the click (MD-15).
fn choose(app: &AppHandle, provider: Option<Provider>) {
    let result = settings_dir(app).and_then(|dir| {
        model::modify(&dir, None, |settings| {
            if settings.active() == provider {
                return Ok(false);
            }
            settings.choose(provider);
            Ok(true)
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
    });
    tray::refresh(app);
    preferences::changed(app, Changed::File(FileName::Model));
    if let Err(error) = result {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            alert(
                &app,
                "Sushi could not switch the model",
                &error,
                &["OK"],
                false,
            )
            .await;
        });
    }
}

extern "C" {
    fn sushi_alert(
        title: *const libc::c_char,
        text: *const libc::c_char,
        buttons: *const libc::c_char,
        secure: *mut libc::c_char,
        size: usize,
        placeholder: *const libc::c_char,
    ) -> libc::c_int;
    fn sushi_alert_sheet(
        window: *mut std::ffi::c_void,
        title: *const libc::c_char,
        text: *const libc::c_char,
        buttons: *const libc::c_char,
        secure: bool,
        placeholder: *const libc::c_char,
        done: extern "C" fn(*mut std::ffi::c_void, libc::c_int, *const libc::c_char),
        context: *mut std::ffi::c_void,
    ) -> bool;
}

type Pressed = oneshot::Sender<Option<(usize, String)>>;

/// A sheet of the settings window ended: the button and the pasted key go to the waiting flow.
extern "C" fn sheet_done(
    context: *mut std::ffi::c_void,
    pressed: libc::c_int,
    key: *const libc::c_char,
) {
    let send = unsafe { Box::from_raw(context.cast::<Pressed>()) };
    let key = if key.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(key) }
            .to_string_lossy()
            .trim()
            .to_string()
    };
    let _ = send.send(Some((pressed.max(0) as usize, key)));
}

/// Where a flow started, carried through the whole flow (SUSI-12): its screens belong there.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Origin {
    /// The settings window: sheets of that window, and never an alert over another app.
    Settings,
    /// The menu bar menu or the panel: alerts in front of every app, as before.
    Elsewhere,
}

/// How one screen of a flow shows.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Route {
    Sheet,
    Modal,
    /// The settings window that started the flow is closed: nothing shows. The state tells the
    /// result; a failure waits for the window's next open.
    Hold,
}

fn route(origin: Origin, settings_shown: bool) -> Route {
    match (origin, settings_shown) {
        (Origin::Elsewhere, _) => Route::Modal,
        (Origin::Settings, true) => Route::Sheet,
        (Origin::Settings, false) => Route::Hold,
    }
}

/// Shows a native alert on the main thread and waits for it; returns the button and the pasted
/// key when `secure` asks for a field.
pub(crate) async fn alert(
    app: &AppHandle,
    title: &str,
    text: &str,
    buttons: &[&str],
    secure: bool,
) -> (usize, String) {
    alert_in(app, Origin::Elsewhere, title, text, buttons, secure).await
}

/// The last screen of a flow: its result. One the closed settings window started is not raised
/// over another app; a failure is kept for the window's next open, a success shows in the
/// window's state anyway.
async fn conclude(
    app: &AppHandle,
    origin: Origin,
    failed: bool,
    title: &str,
    text: &str,
    buttons: &[&str],
) -> usize {
    match screen(app, origin, title, text, buttons, false).await {
        Some((pressed, _)) => pressed,
        None => {
            if failed {
                crate::settings_window::hold_note(title, text);
            }
            usize::MAX
        }
    }
}

/// [`alert`], as a sheet of the settings window for a flow the window started (SUSI-12), and
/// in front of every app for one the menu or the panel started. A screen of a settings flow
/// whose window has closed meanwhile does not show: it answers as a cancel.
pub(crate) async fn alert_in(
    app: &AppHandle,
    origin: Origin,
    title: &str,
    text: &str,
    buttons: &[&str],
    secure: bool,
) -> (usize, String) {
    screen(app, origin, title, text, buttons, secure)
        .await
        .unwrap_or((usize::MAX, String::new()))
}

/// One screen of a flow; None when it did not show. The route is decided on the main thread,
/// where the window closes: a settings flow whose window is gone by then, or cannot take a
/// sheet, shows nothing, and never falls through to an alert over another app.
async fn screen(
    app: &AppHandle,
    origin: Origin,
    title: &str,
    text: &str,
    buttons: &[&str],
    secure: bool,
) -> Option<(usize, String)> {
    let (send, receive) = oneshot::channel::<Option<(usize, String)>>();
    let (title, text, buttons) = (
        CString::new(title).unwrap_or_default(),
        CString::new(text).unwrap_or_default(),
        CString::new(buttons.join("\n")).unwrap_or_default(),
    );
    let placeholder = CString::new("Paste the API key").unwrap_or_default();
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let target = crate::settings_window::shown(&handle);
        match route(origin, target.is_some()) {
            Route::Hold => {
                let _ = send.send(None);
            }
            Route::Sheet => {
                let Some(native) = target.and_then(|w| w.ns_window().ok()) else {
                    let _ = send.send(None);
                    return;
                };
                let context = Box::into_raw(Box::new(send));
                let shown = unsafe {
                    sushi_alert_sheet(
                        native,
                        title.as_ptr(),
                        text.as_ptr(),
                        buttons.as_ptr(),
                        secure,
                        placeholder.as_ptr(),
                        sheet_done,
                        context.cast(),
                    )
                };
                if !shown {
                    let send = *unsafe { Box::from_raw(context) };
                    let _ = send.send(None);
                }
            }
            Route::Modal => {
                let mut field = vec![0 as libc::c_char; if secure { 1024 } else { 0 }];
                let pressed = unsafe {
                    sushi_alert(
                        title.as_ptr(),
                        text.as_ptr(),
                        buttons.as_ptr(),
                        if secure {
                            field.as_mut_ptr()
                        } else {
                            std::ptr::null_mut()
                        },
                        field.len(),
                        placeholder.as_ptr(),
                    )
                };
                let key = if secure {
                    unsafe { CStr::from_ptr(field.as_ptr()) }
                        .to_string_lossy()
                        .trim()
                        .to_string()
                } else {
                    String::new()
                };
                field.fill(0);
                let _ = send.send(Some((pressed.max(0) as usize, key)));
            }
        }
    });
    receive.await.ok().flatten()
}

fn open(url: &str) {
    if !crate::staged() {
        let _ = Command::new("/usr/bin/open").arg(url).status();
    }
}

/// What leaves the Mac, as the connect screen and the settings window say it before a
/// connection (MD-10): "Edits will go to …". With `connected`, as the window says it for a
/// provider that already has a key: "Edits go to …".
pub fn sends_text(provider: Provider, connected: bool) -> String {
    format!(
        "Edits {} to {}: Sushi's instruction, the action and the selected text, or the whole prompt when nothing is selected. Nothing else of the prompt leaves this Mac.",
        if connected { "go" } else { "will go" },
        provider.company()
    )
}

/// The connect screen's words: before anything is sent.
pub fn sends(provider: Provider) -> String {
    sends_text(provider, false)
}

/// What leaves the Mac, who pays and which model answers: said before anything is sent (MD-14).
fn disclosure(provider: Provider, model: &str) -> String {
    format!(
        "{}\n\nModel: {model}. {}",
        sends(provider),
        provider.terms()
    )
}

fn previous(app: &AppHandle) -> String {
    let settings = settings_dir(app).and_then(|dir| model::load(&dir)).ok();
    let active = settings.as_ref().and_then(model::Settings::active);
    choice_label(settings.as_ref(), active)
}

/// How a connect flow ended, for the settings window.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum ConnectOutcome {
    Connected,
    Cancelled,
    Failed,
}

/// How a disconnect flow ended, for the settings window.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum DisconnectOutcome {
    Disconnected,
    Cancelled,
    Failed,
}

/// Starts connecting `provider`; the page's Connect again comes here too.
pub fn start(app: &AppHandle, provider: Provider) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_connect(&app, provider, Origin::Elsewhere).await;
    });
}

/// Why a connection did not happen, and whether the previous choice is still in effect.
#[derive(Debug, PartialEq)]
pub(crate) struct Failure {
    pub why: String,
    /// Nothing changed: Sushi keeps what it had.
    pub kept: bool,
}

impl From<String> for Failure {
    fn from(why: String) -> Self {
        Self { why, kept: true }
    }
}

/// The whole connect flow to its end, the alerts included, with the screens where `origin`
/// wants them. A new flow ends a sign-in that still waits for the browser.
pub async fn run_connect(app: &AppHandle, provider: Provider, origin: Origin) -> ConnectOutcome {
    if let Ok(mut waiting) = WAITING.lock() {
        if let Some(earlier) = waiting.take() {
            let _ = earlier.send(());
        }
    }
    let before = previous(app);
    let outcome = connect(app, provider, origin).await;
    match outcome {
        Ok(Some(note)) => {
            let settings = settings_dir(app).and_then(|dir| model::load(&dir)).ok();
            let text = format!(
                "Edits now go to {}. Model in the menu bar menu switches back to Ollama in one click. {}{}",
                choice_label(settings.as_ref(), Some(provider)),
                match provider.connect() {
                    Connect::SignIn => "The key is on your OpenRouter keys page, where you can set a limit or delete it.",
                    Connect::PasteKey => "The key is in your keychain.",
                },
                note.map(|n| format!("\n\n{n}")).unwrap_or_default()
            );
            tray::refresh(app);
            preferences::changed(app, Changed::Keychain);
            let title = format!("Connected to {}", provider.name());
            conclude(app, origin, false, &title, &text, &["OK"]).await;
            ConnectOutcome::Connected
        }
        Ok(None) => ConnectOutcome::Cancelled,
        Err(failure) => {
            let text = if failure.kept {
                format!("{} Sushi keeps {before}.", failure.why)
            } else {
                failure.why
            };
            tray::refresh(app);
            preferences::changed(app, Changed::File(FileName::Model));
            let title = format!("{} is not connected", provider.name());
            conclude(app, origin, true, &title, &text, &["OK"]).await;
            ConnectOutcome::Failed
        }
    }
}

/// Some(note) when connected, with a note when something is left to say; None when the user
/// cancelled on Sushi's own screen; a failure otherwise. The previous choice stays until the key
/// is in the keychain (MD-14).
async fn connect(
    app: &AppHandle,
    provider: Provider,
    origin: Origin,
) -> Result<Option<Option<String>>, Failure> {
    let dir = settings_dir(app)?;
    let settings = model::load(&dir).map_err(|e| format!("Fix {e}"))?;
    let mut preview = settings.clone();
    preview.choose(Some(provider));
    let model = preview.model_name(provider);
    let disclosure = disclosure(provider, &model);
    let key = match provider.connect() {
        Connect::SignIn => {
            let text = format!("{disclosure}\n\nYour browser opens to sign in to OpenRouter and approve a key for Sushi. You copy no key.");
            let (pressed, _) = alert_in(
                app,
                origin,
                "Connect OpenRouter?",
                &text,
                &["Connect", "Cancel"],
                false,
            )
            .await;
            if pressed != 0 {
                return Ok(None);
            }
            sign_in(provider).await?
        }
        Connect::PasteKey => {
            let mut problem = String::new();
            loop {
                let text = format!(
                    "{problem}{disclosure}\n\nPaste an API key from {}. Sushi checks it and keeps it in your keychain.",
                    provider.keys_page().trim_start_matches("https://")
                );
                let title = format!("Connect {}", provider.name());
                let (pressed, key) = alert_in(
                    app,
                    origin,
                    &title,
                    &text,
                    &["Connect", "Cancel", "Open the keys page"],
                    true,
                )
                .await;
                match pressed {
                    0 if key.is_empty() => problem = "Paste a key first.\n\n".into(),
                    0 if !crate::keychain::plausible(&key) => {
                        problem = "This does not look like an API key.\n\n".into()
                    }
                    0 => match hosted::check_key(provider.api(), provider, &key).await {
                        Ok(()) => break key,
                        Err(why) => problem = format!("{why}\n\n"),
                    },
                    2 => open(provider.keys_page()),
                    _ => return Ok(None),
                }
            }
        }
    };
    let keychain = Keychain::default();
    let note = install(&dir, provider, || {
        keychain.store(provider.id(), &provider.label(), &key)
    })?;
    mark(provider, true);
    Ok(Some(note))
}

/// Makes a connection take effect all at once or not at all (MD-14), in three steps:
/// 1. `model.json` chooses the provider, so a folder Sushi cannot write changes nothing. A key
///    of v0.2.1 stays in the file for now: until the keychain holds the new key it may be the
///    only key there is.
/// 2. `store` puts the key in the keychain. When it refuses, the file goes back to what it was,
///    unless it changed again meanwhile: a rollback never overwrites a change made in between,
///    and the failure then says the file was left as it is now.
/// 3. The key of v0.2.1 leaves the file, since it would win over the new one (MD-12): in a
///    fresh locked change, and only if the file still holds that same key.
///
/// The file is read under its lock each time: the user may have edited it while the browser
/// was open, and a file that no longer parses is never replaced with what Sushi read before.
/// Returns a note when the old key could not be removed.
fn install(
    dir: &std::path::Path,
    provider: Provider,
    store: impl FnOnce() -> Result<(), String>,
) -> Result<Option<String>, Failure> {
    let mut legacy = None;
    let modified = model::modify(dir, None, |settings| {
        if provider == Provider::OpenRouter {
            legacy = settings.openrouter.as_ref().and_then(|s| s.key.clone());
        }
        settings.choose(Some(provider));
        Ok(true)
    })
    .map_err(|e| match e {
        Refusal::Invalid(why) => format!("Fix {why}"),
        other => other.to_string(),
    })?;
    if let Err(why) = store() {
        let back = match modified.before {
            Some(bytes) => Change::Write(bytes),
            None => Change::Remove,
        };
        return match files::update(dir, FileName::Model, Some(&modified.revision), |_| {
            Ok((back, ()))
        }) {
            Ok(_) => Err(why.into()),
            Err(Refusal::Changed) => Err(Failure {
                why: format!(
                    "{why} {} changed while Sushi was connecting, so Sushi left it as it is now; Model in the menu bar menu shows what is chosen.",
                    model::FILE
                ),
                kept: false,
            }),
            Err(other) => Err(Failure {
                why: format!(
                    "{why} Sushi could not put {} back ({other}): it chooses {} now.",
                    model::FILE,
                    provider.name()
                ),
                kept: false,
            }),
        };
    }
    let Some(legacy) = legacy else {
        return Ok(None);
    };
    let removed = model::modify(dir, None, |settings| {
        let section = settings
            .openrouter
            .as_mut()
            .filter(|s| s.key.as_ref() == Some(&legacy));
        Ok(section.map(|s| s.key = None).is_some())
    });
    Ok(removed.err().map(|e| {
        format!(
            "Sushi could not remove the old key from {} ({e}): until it is removed there, edits use that key.",
            model::FILE
        )
    }))
}

/// OAuth PKCE with OpenRouter on a one-time loopback address (MD-14).
async fn sign_in(provider: Provider) -> Result<String, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Could not wait for the browser: {e}."))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let nonce = signin::random(16);
    let pkce = signin::Pkce::new();
    let callback = format!("http://127.0.0.1:{port}/callback/{nonce}");
    let (send, cancelled) = oneshot::channel();
    if let Ok(mut waiting) = WAITING.lock() {
        *waiting = Some(send);
    }
    open(&signin::auth_url(&callback, &pkce.challenge));
    let code = tokio::select! {
        code = signin::wait_for_code(listener, &nonce, signin::WAIT) => code?,
        _ = cancelled => return Err("A new sign-in replaced this one.".into()),
    };
    signin::exchange(provider.api(), &code, &pkce.verifier).await
}

/// Forgets the key and says where to delete it; Ollama takes over if it was active (MD-16).
/// From the settings window it asks first, as a sheet; `Disconnect…` there promises a question.
pub async fn run_disconnect(
    app: &AppHandle,
    provider: Provider,
    origin: Origin,
) -> DisconnectOutcome {
    if origin == Origin::Settings {
        let active = settings_dir(app)
            .and_then(|dir| model::load(&dir))
            .is_ok_and(|s| s.active() == Some(provider));
        let text = format!(
            "Sushi forgets the key in your keychain.{} The key itself keeps working until you delete it on the {} keys page.",
            if active { " Edits then run on Ollama on this Mac." } else { "" },
            provider.company()
        );
        let (pressed, _) = alert_in(
            app,
            origin,
            &format!("Disconnect {}?", provider.name()),
            &text,
            &["Disconnect", "Cancel"],
            false,
        )
        .await;
        if pressed != 0 {
            return DisconnectOutcome::Cancelled;
        }
    }
    // The file first: if it still holds the provider and cannot be written, nothing changes, so
    // Sushi never says it forgot a key that a v0.2.1 file still gives to every edit.
    let result = settings_dir(app)
        .and_then(|dir| release_file(&dir, provider))
        .and_then(|was_active| {
            Keychain::default()
                .forget(provider.id())
                .map(|()| was_active)
        });
    if result.is_ok() {
        mark(provider, false);
    }
    tray::refresh(app);
    preferences::changed(app, Changed::Keychain);
    let outcome = if result.is_ok() {
        DisconnectOutcome::Disconnected
    } else {
        DisconnectOutcome::Failed
    };
    let (title, text) = match result {
        Ok(was_active) => (
            format!("Disconnected from {}", provider.name()),
            format!(
                "Sushi forgot the key.{} The key itself still works until you delete it on the {} keys page.",
                if was_active { " Edits now run on Ollama on this Mac." } else { "" },
                provider.company()
            ),
        ),
        Err(why) => (format!("{} is still connected", provider.name()), why),
    };
    let failed = outcome == DisconnectOutcome::Failed;
    let pressed = conclude(
        app,
        origin,
        failed,
        &title,
        &text,
        &["OK", "Open the keys page"],
    )
    .await;
    if pressed == 1 {
        open(provider.keys_page());
    }
    outcome
}

/// The first step of disconnecting: `model.json` forgets the provider (MD-16). It drops a key
/// of v0.2.1, which would otherwise win over the keychain and come back at the next launch, and
/// chooses Ollama if the provider was active. Returns whether it was. An invalid file runs no
/// edit, so it is left alone; a file that must change and cannot be written is an error.
fn release_file(dir: &std::path::Path, provider: Provider) -> Result<bool, String> {
    let mut was_active = false;
    let result = model::modify(dir, None, |settings| {
        let mut changed = provider == Provider::OpenRouter && settings.forget_key();
        was_active = settings.active() == Some(provider);
        if was_active {
            settings.choose(None);
            changed = true;
        }
        Ok(changed)
    });
    match result {
        Ok(_) => Ok(was_active),
        // A file Sushi cannot read may still hold an OpenRouter key of v0.2.1, which would work
        // again once the file is fixed: saying the key is forgotten would not be true.
        Err(Refusal::Invalid(error)) if provider == Provider::OpenRouter => Err(format!(
            "Fix {error} first: it may still hold an OpenRouter key."
        )),
        // Other providers never have a key in the file, and an invalid file runs no edit.
        Err(Refusal::Invalid(_)) => Ok(false),
        Err(other) => Err(other.to_string()),
    }
}

/// The page's Connect again after a rejected key or a missing one (MD-6).
#[tauri::command]
pub fn provider_connect(app: AppHandle, provider: String) -> Result<(), String> {
    if crate::staged() {
        return Ok(());
    }
    let provider = Provider::from_id(&provider).ok_or("Unknown provider.")?;
    start(&app, provider);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_provider_supplies_the_same_things() {
        for provider in Provider::ALL {
            assert_eq!(Provider::from_id(provider.id()), Some(provider));
            assert!(
                provider.api().starts_with("https://")
                    && provider.keys_page().starts_with("https://")
            );
            // Every provider has a list of models, on https and on its own host.
            let models = provider.models_page();
            assert!(models.starts_with("https://"), "{models}");
            let host = |url: &str| url.split('/').nth(2).unwrap().to_string();
            assert_eq!(host(models), host(provider.keys_page()), "{provider:?}");
            assert!(provider.terms().starts_with("Billed to your "));
            let text = disclosure(provider, "m");
            assert!(
                text.contains("the selected text, or the whole prompt"),
                "{text}"
            );
            assert!(text.contains("Model: m."));
        }
        assert_eq!(Provider::from_id("ollama"), None);
        assert_eq!(Provider::OpenRouter.connect(), Connect::SignIn);
        assert_eq!(Provider::Anthropic.label(), "Sushi: Claude");
    }

    #[test]
    fn disconnecting_changes_the_file_first_or_not_at_all() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(model::FILE);
        let old =
            r#"{"provider": "openrouter", "openrouter": {"key": "sk-or-v1-old", "model": "m/x"}}"#;
        std::fs::write(&file, old).unwrap();
        // A folder Sushi cannot write: an error, and the file is as it was.
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let locked = release_file(dir.path(), Provider::OpenRouter);
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(locked.is_err(), "{locked:?}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), old);
        // Writable: the key leaves the file and Ollama takes over.
        assert_eq!(release_file(dir.path(), Provider::OpenRouter), Ok(true));
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(
            !text.contains("sk-or") && text.contains(r#""provider": "ollama""#),
            "{text}"
        );
        // Another provider, or nothing to change: the file stays untouched.
        assert_eq!(release_file(dir.path(), Provider::OpenAi), Ok(false));
        // A file that does not validate may still hold a v0.2.1 key: OpenRouter is not
        // disconnected until it is fixed; another provider is, as no key of its lives there.
        let invalid = r#"{"provider": "openrouter", "openrouter": {"key": "sk-or-v1-old", "tier": "priority"}}"#;
        std::fs::write(&file, invalid).unwrap();
        let refused = release_file(dir.path(), Provider::OpenRouter).unwrap_err();
        assert!(
            refused.starts_with("Fix model.json: openrouter.tier"),
            "{refused}"
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), invalid);
        assert_eq!(release_file(dir.path(), Provider::OpenAi), Ok(false));
    }

    #[test]
    fn connecting_takes_effect_whole_or_not_at_all() {
        use std::os::unix::fs::PermissionsExt;
        let scratch = crate::keychain::tests::scratch();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(model::FILE);
        let old = r#"{"provider": "openai", "openai": {"model": "gpt-x"}}"#;
        std::fs::write(&file, old).unwrap();
        let settings = || model::load(dir.path()).unwrap();
        // A folder Sushi cannot write: the key is not stored and the file is as it was.
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let locked = put(
            dir.path(),
            &scratch.keychain,
            Provider::Anthropic,
            "sk-ant-api03-new",
        );
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(locked.is_err());
        assert!(!scratch.keychain.has("anthropic"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), old);
        // A keychain that refuses the key: the file goes back.
        let missing = Keychain {
            file: Some(dir.path().join("missing.keychain-db")),
        };
        assert!(put(
            dir.path(),
            &missing,
            Provider::Anthropic,
            "sk-ant-api03-new",
        )
        .is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), old);
        // A file that cannot be read stops it before anything changes.
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o000)).unwrap();
        let unreadable = put(
            dir.path(),
            &missing,
            Provider::Anthropic,
            "sk-ant-api03-new",
        );
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(unreadable.is_err());
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            old,
            "never removed"
        );
        // A file the user broke while the browser was open is left as they wrote it.
        std::fs::write(&file, "{ broken").unwrap();
        assert!(put(
            dir.path(),
            &scratch.keychain,
            Provider::Anthropic,
            "sk-ant-api03-new"
        )
        .is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{ broken");
        assert!(!scratch.keychain.has("anthropic"));
        std::fs::write(&file, old).unwrap();
        // Both work: the provider is chosen and the key stored.
        put(
            dir.path(),
            &scratch.keychain,
            Provider::Anthropic,
            "sk-ant-api03-new",
        )
        .unwrap();
        assert_eq!(settings().active(), Some(Provider::Anthropic));
        assert_eq!(
            scratch.keychain.read("anthropic").as_deref(),
            Some("sk-ant-api03-new")
        );
    }

    #[test]
    fn the_model_menu_lists_the_choices_and_the_way_to_settings() {
        let ollama = model::Settings::default();
        let (title, rows) = model_menu(Ok(&ollama), &[Provider::OpenAi]);
        assert_eq!(title, format!("Model · {}", crate::rewrite::MODEL));
        assert_eq!(
            rows,
            [
                ModelRow::Choice {
                    id: "model-use-ollama".into(),
                    text: format!("Ollama · {} (on this Mac)", crate::rewrite::MODEL),
                    checked: true,
                    enabled: true,
                },
                ModelRow::Choice {
                    id: "model-use-openai".into(),
                    text: "OpenAI · gpt-6-luna".into(),
                    checked: false,
                    enabled: true,
                },
                ModelRow::Separator,
                ModelRow::Settings("Model settings…"),
            ]
        );
        // An active provider without a key stays, said as such.
        let mut openrouter = model::Settings::default();
        openrouter.choose(Some(Provider::OpenRouter));
        let (title, rows) = model_menu(Ok(&openrouter), &[]);
        assert_eq!(title, "Model · gpt-6-luna");
        assert_eq!(
            rows[1],
            ModelRow::Choice {
                id: "model-use-openrouter".into(),
                text: "OpenRouter · not connected".into(),
                checked: true,
                enabled: true,
            }
        );
        // A key of v0.2.1 still in the file connects OpenRouter, as in the settings window.
        let legacy: model::Settings = serde_json::from_str(
            r#"{"provider": "openrouter", "openrouter": {"key": "sk-or-v1-legacy", "model": "m/x"}}"#,
        )
        .unwrap();
        let (_, rows) = model_menu(Ok(&legacy), &[]);
        assert_eq!(
            rows[1],
            ModelRow::Choice {
                id: "model-use-openrouter".into(),
                text: "OpenRouter · x".into(),
                checked: true,
                enabled: true,
            }
        );
        assert!(keyed(&[], Some(&legacy), Provider::OpenRouter));
        assert!(!keyed(&[], Some(&legacy), Provider::OpenAi));
        // An invalid file: its problem first, the choices disabled, the way to fix it.
        let (title, rows) = model_menu(Err("model.json: provider must be …"), &[Provider::OpenAi]);
        assert_eq!(title, "Model · Needs attention");
        assert_eq!(
            rows[0],
            ModelRow::Problem("model.json: provider must be …".into())
        );
        assert!(rows.iter().all(|r| !matches!(
            r,
            ModelRow::Choice { enabled: true, .. } | ModelRow::Choice { checked: true, .. }
        )));
        assert_eq!(
            rows.last(),
            Some(&ModelRow::Settings("Fix model settings…"))
        );
    }

    fn put(
        dir: &std::path::Path,
        keychain: &Keychain,
        provider: Provider,
        key: &str,
    ) -> Result<Option<String>, Failure> {
        install(dir, provider, || {
            keychain.store(provider.id(), &provider.label(), key)
        })
    }

    const LEGACY: &str =
        r#"{"provider": "ollama", "openrouter": {"key": "sk-or-v1-legacy", "model": "m/x"}}"#;

    #[test]
    fn the_old_key_leaves_the_file_only_once_the_new_one_is_stored() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(model::FILE);
        std::fs::write(&file, LEGACY).unwrap();
        // While the keychain is asked, the old key is still in the file.
        let note = install(dir.path(), Provider::OpenRouter, || {
            let now = std::fs::read_to_string(&file).unwrap();
            assert!(now.contains("sk-or-v1-legacy") && now.contains(r#""provider": "openrouter""#));
            Ok(())
        })
        .unwrap();
        assert_eq!(note, None);
        let now = model::load(dir.path()).unwrap();
        assert_eq!(now.active(), Some(Provider::OpenRouter));
        assert_eq!(now.openrouter.unwrap().key, None, "dropped after the store");
        // A refused store puts the file back, old key included.
        std::fs::write(&file, LEGACY).unwrap();
        let refused = install(dir.path(), Provider::OpenRouter, || {
            Err("No keychain.".into())
        });
        assert_eq!(refused, Err("No keychain.".to_string().into()));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), LEGACY);
    }

    #[test]
    fn a_refused_rollback_keeps_the_old_key_and_says_what_is_true() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(model::FILE);
        std::fs::write(&file, LEGACY).unwrap();
        // Another writer (the window, a hand edit) changes the file while the keychain is asked.
        let edited = LEGACY.replace(r#""model": "m/x""#, r#""model": "m/y""#);
        let failure = install(dir.path(), Provider::OpenRouter, || {
            let now = std::fs::read_to_string(&file).unwrap();
            std::fs::write(&file, now.replace("m/x", "m/y")).unwrap();
            Err("The keychain refused the key.".into())
        })
        .unwrap_err();
        assert!(
            !failure.kept,
            "Sushi does not claim to keep the previous choice"
        );
        assert!(
            failure.why.starts_with("The keychain refused the key. model.json changed while Sushi was connecting, so Sushi left it as it is now"),
            "{}",
            failure.why
        );
        let now = std::fs::read_to_string(&file).unwrap();
        assert!(
            now.contains("sk-or-v1-legacy"),
            "the only key there is stays: {now}"
        );
        assert_ne!(now, edited, "the change in between stays as written");
        assert!(now.contains("m/y"));
    }

    #[test]
    fn a_key_replaced_meanwhile_is_not_removed() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(model::FILE);
        std::fs::write(&file, LEGACY).unwrap();
        install(dir.path(), Provider::OpenRouter, || {
            let now = std::fs::read_to_string(&file).unwrap();
            std::fs::write(&file, now.replace("sk-or-v1-legacy", "sk-or-v1-other")).unwrap();
            Ok(())
        })
        .unwrap();
        let section = model::load(dir.path()).unwrap().openrouter.unwrap();
        assert_eq!(section.key.as_deref(), Some("sk-or-v1-other"));
    }

    #[test]
    fn a_flow_from_settings_never_raises_an_alert_over_another_app() {
        assert_eq!(route(Origin::Settings, true), Route::Sheet);
        assert_eq!(route(Origin::Settings, false), Route::Hold);
        assert_eq!(route(Origin::Elsewhere, true), Route::Modal);
        assert_eq!(route(Origin::Elsewhere, false), Route::Modal);
    }

    #[test]
    fn the_page_knows_the_providers() {
        // src/main.ts maps the name a message starts with to the id it sends back.
        let page = include_str!("../../src/main.ts");
        for provider in Provider::ALL {
            assert!(
                page.contains(&format!("{}: '{}'", provider.name(), provider.id())),
                "{provider:?}"
            );
        }
        assert!(page.contains(&format!("'{}'", hosted::CONNECT_AGAIN)));
    }
}
