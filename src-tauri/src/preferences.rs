//! The settings window's side in Rust (SUSI-12, .agents contract): what each pane shows, read
//! from its file, and the saves, each through the validator the panel uses and the one writer
//! (files.rs). The window keeps no state of its own. No secret enters these types: a key stays
//! in the keychain or, from v0.2.1, inside `model.json`, where an option edit keeps it.

use crate::files::{self, Change, FileName, FileState, Refusal};
use crate::hotkey::{self, Problem};
use crate::model::{self, Settings as ModelSettings};
use crate::providers::{self, Provider};
use crate::settings::{self, Rule, Term};
use crate::{build_info, diagnostics, library};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum PaneId {
    Keyboard,
    Model,
    Actions,
    Library,
    About,
}

impl PaneId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Keyboard => "keyboard",
            Self::Model => "model",
            Self::Actions => "actions",
            Self::Library => "library",
            Self::About => "about",
        }
    }
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Prefs {
    pub keyboard: KeyboardPane,
    pub model: ModelPane,
    pub actions: ActionsPane,
    pub library: LibraryPane,
    pub about: AboutPane,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct KeyboardPane {
    /// hotkey.json; with an invalid file the values are the defaults Sushi uses meanwhile.
    pub file: FileState,
    pub caps_lock: bool,
    /// Canonical, as written to the file.
    pub shortcut: String,
    pub default_shortcut: String,
    /// `caps-lock`, a canonical combination, or null when none is registered.
    pub effective: Option<String>,
    pub problem: Option<Problem>,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Ollama {
    pub model: String,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ModelPane {
    /// model.json; absent means Ollama (MD-1).
    pub file: FileState,
    /// `ollama` or a provider id: what `provider` says.
    pub active: String,
    pub ollama: Ollama,
    pub providers: Vec<ProviderCard>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "kebab-case")]
pub enum ConnectKind {
    SignIn,
    Key,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ProviderCard {
    #[cfg_attr(test, ts(type = "'openrouter' | 'openai' | 'anthropic'"))]
    pub id: String,
    pub name: String,
    /// A key is stored. It does not say the key or the account still works.
    pub connected: bool,
    pub connect: ConnectKind,
    pub sends: String,
    pub pays: String,
    pub model_name: String,
    pub options: Vec<ProviderOption>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Field {
    Model,
    Reasoning,
    Tier,
    Effort,
}

#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProviderOption {
    pub field: Field,
    pub label: String,
    /// What the file's section holds, or null. Never a key.
    pub stored: Option<String>,
    /// What an edit sends now for this field; null when nothing is sent.
    pub effective: Option<String>,
    /// What an edit would send with the field removed from the section.
    pub unset: Option<String>,
    /// The values the schema allows; null for free text.
    pub choices: Option<Vec<String>>,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ActionsPane {
    /// rules.json, seeded when missing (LF-3).
    pub file: FileState,
    pub rules: Vec<Rule>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Default,
    File,
    Environment,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct DictionaryPart {
    pub file: FileState,
    pub terms: Vec<Term>,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct LibraryPane {
    /// library-path.txt; absent means the default folder.
    pub file: FileState,
    /// The folder the Library reads now (LF-11).
    pub path: String,
    pub source: Source,
    /// Counted by LF-12 and LF-13 without creating anything; null when it cannot be read.
    pub prompts: Option<u32>,
    pub templates: Option<u32>,
    pub dictionary: DictionaryPart,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsPart {
    pub file: FileState,
    pub record: bool,
    pub log_exists: bool,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct AboutPane {
    pub version: String,
    pub hash: String,
    /// The block of BI-1.
    pub build: String,
    pub diagnostics: DiagnosticsPart,
    /// A problem report records (RP-5): the log is written whatever the switch says.
    pub recording: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Saved,
    Changed,
    Invalid,
    Failed,
}

/// The reply of every save: what happened and the pane as it is on disk and in effect now.
#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Saved<P> {
    pub outcome: Outcome,
    pub message: Option<String>,
    pub pane: P,
}

/// What a pane is built from besides the files.
pub(crate) struct Context {
    pub dir: PathBuf,
    pub effect: hotkey::Effect,
    pub connected: Vec<Provider>,
    pub recording: bool,
    pub log_exists: bool,
    /// `SUSHI_LIBRARY_DIR`, read once per load, so tests never touch the environment.
    pub environment: Option<PathBuf>,
    /// `diagnostics.json` turns the log on now (LF-21).
    pub logging: bool,
    /// The file a save just wrote, as it wrote it: its pane is built from these bytes, never
    /// from a read after the lock was released (files.rs, `Written`).
    pub written: Option<(FileName, files::Written)>,
}

impl Context {
    /// A settings file as the pane shows it: the bytes a save wrote, or a fresh read.
    fn read(&self, name: FileName, check: impl Fn(&[u8]) -> Result<(), String>) -> files::Snapshot {
        match &self.written {
            Some((written, bytes)) if *written == name => files::known(name, bytes, check),
            _ => files::read(&self.dir, name, check),
        }
    }
}

impl Context {
    fn from_app(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            dir: app.path().app_data_dir().map_err(|e| e.to_string())?,
            effect: hotkey::effect(app),
            connected: Provider::ALL
                .into_iter()
                .filter(|p| providers::connected(*p))
                .collect(),
            recording: diagnostics::reporting(),
            log_exists: diagnostics::path(diagnostics::LOG).is_some_and(|p| p.exists()),
            environment: library::environment(),
            logging: diagnostics::state().file,
            written: None,
        })
    }
}

// ——— Panes ———

fn keyboard(ctx: &Context) -> KeyboardPane {
    let snapshot = ctx.read(FileName::Hotkey, hotkey::check);
    let hotkey = snapshot
        .bytes
        .as_deref()
        .and_then(|b| hotkey::parse(b).ok())
        .unwrap_or_default();
    let default = hotkey::Hotkey::default().shortcut;
    KeyboardPane {
        file: snapshot.state,
        caps_lock: hotkey.caps_lock,
        shortcut: hotkey::canonical(&hotkey.shortcut).unwrap_or(hotkey.shortcut),
        default_shortcut: default,
        effective: ctx.effect.effective.clone(),
        problem: ctx.effect.problem.clone(),
    }
}

/// The fields `model.json` holds for a provider, model first (MD-10).
fn fields(provider: Provider) -> &'static [Field] {
    match provider {
        Provider::OpenRouter => &[Field::Model, Field::Reasoning, Field::Tier],
        Provider::OpenAi => &[Field::Model, Field::Reasoning],
        Provider::Anthropic => &[Field::Model, Field::Effort],
    }
}

/// The values a field allows: the validator's own lists.
fn choices(field: Field) -> Option<&'static [&'static str]> {
    match field {
        Field::Model => None,
        Field::Reasoning => Some(&model::REASONING),
        Field::Tier => Some(&model::TIERS),
        Field::Effort => Some(&model::EFFORT),
    }
}

fn label(field: Field) -> &'static str {
    match field {
        Field::Model => "Model",
        Field::Reasoning => "Reasoning",
        Field::Tier => "Tier",
        Field::Effort => "Effort",
    }
}

fn field_name(field: Field) -> &'static str {
    match field {
        Field::Model => "model",
        Field::Reasoning => "reasoning",
        Field::Tier => "tier",
        Field::Effort => "effort",
    }
}

/// What the section holds for `field`, or with `filled` what an edit sends.
fn value(
    settings: &ModelSettings,
    provider: Provider,
    field: Field,
    filled: bool,
) -> Option<String> {
    match provider {
        Provider::OpenRouter => {
            let s = if filled {
                Some(settings.openrouter())
            } else {
                settings.openrouter.clone()
            }?;
            match field {
                Field::Model => s.model,
                Field::Reasoning => s.reasoning,
                Field::Tier => s.tier,
                Field::Effort => None,
            }
        }
        Provider::OpenAi => {
            let s = if filled {
                Some(settings.openai())
            } else {
                settings.openai.clone()
            }?;
            match field {
                Field::Model => s.model,
                Field::Reasoning => s.reasoning,
                _ => None,
            }
        }
        Provider::Anthropic => {
            let s = if filled {
                Some(settings.anthropic())
            } else {
                settings.anthropic.clone()
            }?;
            match field {
                Field::Model => s.model,
                Field::Effort => s.effort,
                _ => None,
            }
        }
    }
}

/// Sets or removes one field of a provider's section. A section the file does not have yet
/// starts from the defaults an edit sends (MD-10), so changing one option keeps the others as
/// they were in effect. Everything else in the section, a key of v0.2.1 included, stays.
fn set_option(
    settings: &mut ModelSettings,
    provider: Provider,
    field: Field,
    value: Option<String>,
) -> Result<(), String> {
    if !fields(provider).contains(&field) {
        return Err(format!(
            "{} has no {} option.",
            provider.name(),
            field_name(field)
        ));
    }
    let value = match field {
        Field::Model => value.map(|v| v.trim().to_string()),
        _ => value,
    };
    match provider {
        Provider::OpenRouter => {
            let s = settings
                .openrouter
                .get_or_insert_with(|| model::OpenRouter::default().filled());
            match field {
                Field::Model => s.model = value,
                Field::Reasoning => s.reasoning = value,
                _ => s.tier = value,
            }
        }
        Provider::OpenAi => {
            let s = settings
                .openai
                .get_or_insert_with(|| model::OpenAi::default().filled());
            match field {
                Field::Model => s.model = value,
                _ => s.reasoning = value,
            }
        }
        Provider::Anthropic => {
            let s = settings
                .anthropic
                .get_or_insert_with(|| model::Anthropic::default().filled());
            match field {
                Field::Model => s.model = value,
                _ => s.effort = value,
            }
        }
    }
    Ok(())
}

fn options(settings: &ModelSettings, provider: Provider) -> Vec<ProviderOption> {
    fields(provider)
        .iter()
        .map(|&field| {
            let mut without = settings.clone();
            let _ = set_option(&mut without, provider, field, None);
            ProviderOption {
                field,
                label: label(field).into(),
                stored: value(settings, provider, field, false),
                effective: value(settings, provider, field, true),
                unset: value(&without, provider, field, true),
                choices: choices(field).map(|c| c.iter().map(|s| s.to_string()).collect()),
            }
        })
        .collect()
}

/// A key is stored for `provider`: in the keychain, or one of v0.2.1 still in the file (MD-12).
fn has_key(ctx: &Context, settings: &ModelSettings, provider: Provider) -> bool {
    providers::keyed(&ctx.connected, Some(settings), provider)
}

fn model_pane(ctx: &Context) -> ModelPane {
    let snapshot = ctx.read(FileName::Model, |b| model::parse(Some(b)).map(|_| ()));
    let settings = snapshot
        .bytes
        .as_deref()
        .and_then(|b| model::parse(Some(b)).ok())
        .unwrap_or_default();
    let providers = Provider::ALL
        .into_iter()
        .map(|provider| {
            let connected = has_key(ctx, &settings, provider);
            (provider, connected)
        })
        .map(|(provider, connected)| ProviderCard {
            id: provider.id().into(),
            name: provider.name().into(),
            connected,
            connect: match provider.connect() {
                providers::Connect::SignIn => ConnectKind::SignIn,
                providers::Connect::PasteKey => ConnectKind::Key,
            },
            // A connected provider already gets the edits; one that is not yet will.
            sends: providers::sends_text(provider, connected),
            pays: provider.terms().into(),
            model_name: settings.model_name(provider),
            options: options(&settings, provider),
        })
        .collect();
    ModelPane {
        file: snapshot.state,
        active: settings.provider().into(),
        ollama: Ollama {
            model: crate::rewrite::MODEL.into(),
        },
        providers,
    }
}

fn actions(ctx: &Context) -> ActionsPane {
    let _ = settings::read_seeded(&ctx.dir, FileName::Rules, settings::RULES);
    let snapshot = ctx.read(FileName::Rules, |b| settings::check_rules(b).map(|_| ()));
    ActionsPane {
        rules: snapshot
            .bytes
            .as_deref()
            .and_then(|b| settings::parse_rules(b).ok())
            .unwrap_or_default(),
        file: snapshot.state,
    }
}

fn count(dir: &Path) -> Option<u32> {
    library::count(dir).map(|n| u32::try_from(n).unwrap_or(u32::MAX))
}

/// The folder the Library reads now and where that comes from (LF-11), resolved as
/// `library::source` resolves it for the panel: a file Sushi cannot use is no folder at all,
/// never a quiet fall back to the default. Err holds what the file says and the panel's message.
fn library_folder(
    dir: &Path,
    environment: Option<&Path>,
    snapshot: &files::Snapshot,
) -> Result<(PathBuf, Source), (String, String)> {
    if let Some(path) = environment {
        return Ok((path.to_path_buf(), Source::Environment));
    }
    let message = || snapshot.state.message.clone().unwrap_or_default();
    match &snapshot.bytes {
        None if snapshot.state.status == files::Status::Absent => {
            Ok((dir.join("Input"), Source::Default))
        }
        None => Err((String::new(), message())),
        Some(bytes) => match library::parse_path(bytes) {
            Ok(path) => Ok((path, Source::File)),
            Err(error) => Err((
                String::from_utf8_lossy(bytes)
                    .trim_end_matches(['\r', '\n'])
                    .to_string(),
                error,
            )),
        },
    }
}

fn library_snapshot(dir: &Path) -> files::Snapshot {
    files::read(dir, FileName::LibraryPath, |b| {
        library::parse_path(b).map(|_| ())
    })
}

fn library_pane(ctx: &Context) -> LibraryPane {
    let snapshot = ctx.read(FileName::LibraryPath, |b| {
        library::parse_path(b).map(|_| ())
    });
    let resolved = library_folder(&ctx.dir, ctx.environment.as_deref(), &snapshot);
    let (path, source, prompts, templates) = match resolved {
        Ok((path, source)) => {
            let templates =
                library::count_templates(&path).map(|n| n.min(u32::MAX as usize) as u32);
            (path.display().to_string(), source, count(&path), templates)
        }
        Err((written, _)) => (written, Source::File, None, None),
    };
    let _ = settings::read_seeded(&ctx.dir, FileName::Dictionary, settings::DICTIONARY);
    let dictionary = ctx.read(FileName::Dictionary, |b| {
        settings::check_terms(b).map(|_| ())
    });
    LibraryPane {
        file: snapshot.state,
        prompts,
        templates,
        path,
        source,
        dictionary: DictionaryPart {
            terms: dictionary
                .bytes
                .as_deref()
                .and_then(|b| settings::parse_terms(b).ok())
                .unwrap_or_default(),
            file: dictionary.state,
        },
    }
}

fn about(ctx: &Context) -> AboutPane {
    let info = build_info::collect();
    let snapshot = ctx.read(FileName::Diagnostics, |b| diagnostics::parse(b).map(|_| ()));
    AboutPane {
        version: info.version.clone(),
        hash: build_info::short_hash(&info),
        build: build_info::block(&info),
        diagnostics: DiagnosticsPart {
            // What Sushi does now: the file's value, or, while the file cannot be used, the mode
            // as it was before, which an invalid file keeps (LF-21).
            record: match snapshot.bytes.as_deref().map(diagnostics::parse) {
                Some(Ok(record)) => record,
                None if snapshot.state.status == files::Status::Absent => false,
                _ => ctx.logging,
            },
            file: snapshot.state,
            log_exists: ctx.log_exists,
        },
        recording: ctx.recording,
    }
}

fn load(ctx: &Context) -> Prefs {
    Prefs {
        keyboard: keyboard(ctx),
        model: model_pane(ctx),
        actions: actions(ctx),
        library: library_pane(ctx),
        about: about(ctx),
    }
}

// ——— Saves, without the app: each one transaction of files.rs ———

fn write(
    dir: &Path,
    name: FileName,
    revision: &str,
    change: Change,
) -> Result<files::Written, Refusal> {
    files::update_written(dir, name, Some(revision), |_| Ok((change, ()))).map(|(_, _, w)| w)
}

fn select(ctx: &Context, revision: &str, active: &str) -> Result<files::Written, Refusal> {
    let provider = match active {
        "ollama" => None,
        id => Some(
            Provider::from_id(id)
                .ok_or_else(|| Refusal::Invalid(format!("Sushi knows no provider '{id}'.")))?,
        ),
    };
    let mut gone = None;
    let result = model::modify(&ctx.dir, Some(revision), |settings| {
        if let Some(p) = provider.filter(|p| !has_key(ctx, settings, *p)) {
            gone = Some(p);
            return Err(String::new());
        }
        if settings.active() == provider {
            return Ok(false);
        }
        settings.choose(provider);
        Ok(true)
    });
    match (result, gone) {
        // The window may have shown the provider as connected before its key went.
        (Err(_), Some(p)) => Err(Refusal::Failed(format!(
            "No key for {name} is stored on this Mac any more. Connect {name} again to use it.",
            name = p.name()
        ))),
        (result, _) => result.map(|m| m.after),
    }
}

fn option(
    dir: &Path,
    revision: &str,
    provider: &str,
    field: Field,
    value: Option<String>,
) -> Result<files::Written, Refusal> {
    let provider = Provider::from_id(provider)
        .ok_or_else(|| Refusal::Invalid(format!("Sushi knows no provider '{provider}'.")))?;
    model::modify(dir, Some(revision), |settings| {
        let before = settings.clone();
        set_option(settings, provider, field, value)?;
        Ok(*settings != before)
    })
    .map(|m| m.after)
}

fn save_rules(dir: &Path, revision: &str, rules: &[Rule]) -> Result<files::Written, Refusal> {
    let bytes = settings::render_rules(rules).map_err(Refusal::Invalid)?;
    write(dir, FileName::Rules, revision, Change::Write(bytes))
}

fn save_terms(dir: &Path, revision: &str, terms: &[Term]) -> Result<files::Written, Refusal> {
    let bytes = settings::render_terms(terms).map_err(Refusal::Invalid)?;
    write(dir, FileName::Dictionary, revision, Change::Write(bytes))
}

/// Writes the chosen folder to `library-path.txt`, or removes the file for the default (LF-11).
fn save_library(
    dir: &Path,
    revision: &str,
    folder: Option<&Path>,
) -> Result<files::Written, Refusal> {
    if library::environment().is_some() {
        return Err(Refusal::Failed(
            "SUSHI_LIBRARY_DIR sets the library folder, so it cannot be changed here.".into(),
        ));
    }
    let change = match folder {
        None => Change::Remove,
        Some(folder) => {
            let text = folder.display().to_string();
            if text.contains(['\n', '\r']) {
                return Err(Refusal::Invalid(
                    "Choose a folder whose name has no line break.".into(),
                ));
            }
            let bytes = format!("{text}\n").into_bytes();
            library::parse_path(&bytes).map_err(Refusal::Invalid)?;
            Change::Write(bytes)
        }
    };
    write(dir, FileName::LibraryPath, revision, change)
}

fn save_diagnostics(dir: &Path, revision: &str, record: bool) -> Result<files::Written, Refusal> {
    write(
        dir,
        FileName::Diagnostics,
        revision,
        Change::Write(diagnostics::render(record)),
    )
}

/// What a file starts over with: the shipped example for the files Sushi seeds, no file for the
/// optional ones.
fn default_of(name: FileName) -> Option<&'static str> {
    match name {
        FileName::Rules => Some(settings::RULES),
        FileName::Dictionary => Some(settings::DICTIONARY),
        FileName::Hotkey => Some(hotkey::EXAMPLE),
        FileName::Model | FileName::LibraryPath | FileName::Diagnostics => None,
    }
}

/// The validator Sushi reads each file with.
fn check(name: FileName) -> fn(&[u8]) -> Result<(), String> {
    match name {
        FileName::Rules => |b| settings::check_rules(b).map(|_| ()),
        FileName::Dictionary => |b| settings::check_terms(b).map(|_| ()),
        FileName::Hotkey => hotkey::check,
        FileName::Model => |b| model::parse(Some(b)).map(|_| ()),
        FileName::LibraryPath => |b| library::parse_path(b).map(|_| ()),
        FileName::Diagnostics => |b| diagnostics::parse(b).map(|_| ()),
    }
}

fn reset(dir: &Path, name: FileName, revision: &str) -> Result<(PathBuf, files::Written), Refusal> {
    files::reset(
        dir,
        name,
        revision,
        check(name),
        default_of(name).map(str::as_bytes),
    )
}

/// The reply of a save: on success the pane of the bytes this save wrote, so the page's next save
/// carries their revision and is refused as `changed` if anyone wrote since; otherwise a fresh
/// read, which the page keeps beside its draft.
fn answer<P>(
    mut ctx: Context,
    name: FileName,
    result: Result<files::Written, Refusal>,
    build: impl Fn(&Context) -> P,
) -> Saved<P> {
    let result = result.map(|written| ctx.written = Some((name, written)));
    let pane = build(&ctx);
    saved(name, result, pane)
}

fn saved<P>(name: FileName, result: Result<(), Refusal>, pane: P) -> Saved<P> {
    let (outcome, message) = match result {
        Ok(()) => (Outcome::Saved, None),
        Err(Refusal::Changed) => (
            Outcome::Changed,
            Some(format!("{} changed on disk.", name.as_str())),
        ),
        Err(Refusal::Invalid(why)) => (Outcome::Invalid, Some(why)),
        Err(Refusal::Failed(why)) => (Outcome::Failed, Some(why)),
    };
    Saved {
        outcome,
        message,
        pane,
    }
}

// ——— Events ———

/// What changed outside the window.
pub(crate) enum Changed {
    File(FileName),
    Keychain,
    Recording,
}

#[derive(Serialize, Clone)]
struct ChangedPayload {
    file: &'static str,
}

/// Tells the settings window, and only it, that something outside it changed a file, the
/// keychain or the recording state: it loads again and refreshes the panes without a draft.
pub(crate) fn changed(app: &AppHandle, what: Changed) {
    let file = match what {
        Changed::File(name) => name.as_str(),
        Changed::Keychain => "keychain",
        Changed::Recording => "recording",
    };
    let _ = app.emit_to(
        crate::settings_window::LABEL,
        "prefs-changed",
        ChangedPayload { file },
    );
}

// ——— Commands ———

fn context(app: &AppHandle) -> Result<Context, String> {
    Context::from_app(app)
}

#[tauri::command]
pub async fn prefs_load(app: AppHandle) -> Result<Prefs, String> {
    // A key deleted in Keychain Access shows on the next focus of the window. A stage run never
    // reads the keychain.
    if !crate::staged() && providers::recheck() {
        crate::tray::refresh(&app);
    }
    // diagnostics.json edited or removed by hand takes effect now, as on a show of the panel
    // (LF-21), so About shows what runs; the menu follows. Nothing is emitted from a load.
    if !crate::staged() && diagnostics::refresh(&app) {
        crate::tray::refresh(&app);
    }
    // hotkey.json edited by hand since Sushi applied it takes effect now, on the main thread
    // where keys are registered, so the Keyboard pane shows a choice with its own key.
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        // Safe in a stage run: nothing is registered there (hotkey.rs, `engage`).
        hotkey::reload(&handle);
        let _ = send.send(());
    })
    .map_err(|e| e.to_string())?;
    let _ = receive.await;
    Ok(load(&context(&app)?))
}

/// Synchronous: it runs on the main thread, where the key is registered.
#[tauri::command]
pub fn prefs_keyboard_save(
    app: AppHandle,
    revision: String,
    caps_lock: bool,
    shortcut: String,
) -> Result<Saved<KeyboardPane>, String> {
    let dir = context(&app)?.dir;
    let result = hotkey::save(&app, &dir, &revision, caps_lock, &shortcut);
    Ok(answer(context(&app)?, FileName::Hotkey, result, keyboard))
}

#[tauri::command]
/// Synchronous, on the main thread, where the window's keyboard is known. Starting a capture is
/// refused unless the settings window is shown and has the keyboard.
pub fn prefs_capture(app: AppHandle, on: bool) -> Result<(), String> {
    if crate::staged() {
        return Ok(());
    }
    if on {
        let window = crate::settings_window::shown(&app);
        let keyboard = window
            .as_ref()
            .is_some_and(crate::settings_window::has_keyboard);
        if let Some(why) = hotkey::capture_refusal(window.is_some(), keyboard) {
            return Err(why.into());
        }
    }
    hotkey::capture(&app, on);
    Ok(())
}

#[tauri::command]
pub async fn prefs_model_select(
    app: AppHandle,
    revision: String,
    active: String,
) -> Result<Saved<ModelPane>, String> {
    // The keychain itself decides, not what the window or the cache saw last.
    if let Some(provider) = Provider::from_id(&active).filter(|_| !crate::staged()) {
        if providers::recheck_one(provider) {
            crate::tray::refresh(&app);
        }
    }
    let ctx = context(&app)?;
    let result = select(&ctx, &revision, &active);
    crate::tray::refresh(&app);
    Ok(answer(ctx, FileName::Model, result, model_pane))
}

#[tauri::command]
pub async fn prefs_model_option(
    app: AppHandle,
    revision: String,
    provider: String,
    field: Field,
    value: Option<String>,
) -> Result<Saved<ModelPane>, String> {
    let ctx = context(&app)?;
    let result = option(&ctx.dir, &revision, &provider, field, value);
    crate::tray::refresh(&app);
    Ok(answer(ctx, FileName::Model, result, model_pane))
}

fn provider(id: &str) -> Result<Provider, String> {
    Provider::from_id(id).ok_or_else(|| format!("Sushi knows no provider '{id}'."))
}

#[tauri::command]
pub async fn prefs_connect(
    app: AppHandle,
    provider: String,
) -> Result<providers::ConnectOutcome, String> {
    let provider = self::provider(&provider)?;
    if crate::staged() {
        return Ok(providers::ConnectOutcome::Cancelled);
    }
    Ok(providers::run_connect(&app, provider, providers::Origin::Settings).await)
}

/// **Cancel** next to *Connecting…* while a sign-in waits for the browser (MD-14); the flow of
/// `prefs_connect` then ends as cancelled.
#[tauri::command]
pub fn prefs_connect_cancel() {
    providers::cancel_sign_in();
}

#[tauri::command]
pub async fn prefs_disconnect(
    app: AppHandle,
    provider: String,
) -> Result<providers::DisconnectOutcome, String> {
    let provider = self::provider(&provider)?;
    if crate::staged() {
        return Ok(providers::DisconnectOutcome::Cancelled);
    }
    Ok(providers::run_disconnect(&app, provider, providers::Origin::Settings).await)
}

#[tauri::command]
pub async fn prefs_actions_save(
    app: AppHandle,
    revision: String,
    rules: Vec<Rule>,
) -> Result<Saved<ActionsPane>, String> {
    let ctx = context(&app)?;
    let result = save_rules(&ctx.dir, &revision, &rules);
    Ok(answer(ctx, FileName::Rules, result, actions))
}

#[tauri::command]
pub async fn prefs_dictionary_save(
    app: AppHandle,
    revision: String,
    terms: Vec<Term>,
) -> Result<Saved<LibraryPane>, String> {
    let ctx = context(&app)?;
    let result = save_terms(&ctx.dir, &revision, &terms);
    Ok(answer(ctx, FileName::Dictionary, result, library_pane))
}

/// The native folder picker as a sheet of the window, then the write. The revision is checked
/// after the picker closes: no lock is held while it is open. A cancel changes nothing.
#[tauri::command]
pub async fn prefs_library_choose(
    app: AppHandle,
    revision: String,
) -> Result<Saved<LibraryPane>, String> {
    let ctx = context(&app)?;
    let result = if library::environment().is_some() {
        save_library(&ctx.dir, &revision, None)
    } else {
        let start = PathBuf::from(&library_pane(&ctx).path);
        match crate::settings_window::choose_folder(&app, start).await {
            Some(folder) => save_library(&ctx.dir, &revision, Some(&folder)),
            // A cancel wrote nothing: the pane as it is.
            None => return Ok(saved(FileName::LibraryPath, Ok(()), library_pane(&ctx))),
        }
    };
    Ok(answer(ctx, FileName::LibraryPath, result, library_pane))
}

#[tauri::command]
pub async fn prefs_library_default(
    app: AppHandle,
    revision: String,
) -> Result<Saved<LibraryPane>, String> {
    let ctx = context(&app)?;
    let result = save_library(&ctx.dir, &revision, None);
    Ok(answer(ctx, FileName::LibraryPath, result, library_pane))
}

/// The switch creates `diagnostics.json` with `record: true` and sets `false` when turned off;
/// it takes effect at once (LF-21).
#[tauri::command]
pub async fn prefs_diagnostics_save(
    app: AppHandle,
    revision: String,
    record: bool,
) -> Result<Saved<AboutPane>, String> {
    let dir = context(&app)?.dir;
    let result = save_diagnostics(&dir, &revision, record);
    if diagnostics::refresh(&app) {
        crate::tray::refresh(&app);
    }
    Ok(answer(context(&app)?, FileName::Diagnostics, result, about))
}

/// Only for an invalid file: its bytes are kept aside first. Synchronous, on the main thread:
/// a reset `hotkey.json` registers its key again.
#[tauri::command]
pub fn prefs_reset(app: AppHandle, name: FileName, revision: String) -> Result<Prefs, String> {
    let dir = context(&app)?.dir;
    let result = reset(&dir, name, &revision);
    match name {
        FileName::Hotkey => {
            hotkey::apply(&app);
        }
        FileName::Model => crate::tray::refresh(&app),
        FileName::Diagnostics => {
            diagnostics::refresh(&app);
            crate::tray::refresh(&app);
        }
        _ => (),
    }
    let (_, written) = result.map_err(|e| match e {
        Refusal::Changed => format!("{} changed on disk.", name.as_str()),
        other => other.to_string(),
    })?;
    // The reset file as the reset wrote it; the other files as they are.
    let mut ctx = context(&app)?;
    ctx.written = Some((name, written));
    Ok(load(&ctx))
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileAction {
    Reveal,
    Edit,
}

fn open(args: &[&std::ffi::OsStr]) -> Result<(), String> {
    if crate::staged() {
        return Ok(());
    }
    let output = Command::new("/usr/bin/open")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Shows a settings file in Finder, or opens it in the default text editor.
#[tauri::command]
pub async fn prefs_file(app: AppHandle, name: FileName, action: FileAction) -> Result<(), String> {
    let dir = context(&app)?.dir;
    let path = dir.join(name.as_str());
    let exists = std::fs::symlink_metadata(&path).is_ok();
    match action {
        FileAction::Reveal if exists => open(&["-R".as_ref(), path.as_os_str()]),
        FileAction::Reveal => {
            let _ = std::fs::create_dir_all(&dir);
            open(&[dir.as_os_str()])
        }
        FileAction::Edit => {
            if !std::fs::metadata(&path).is_ok_and(|m| m.is_file()) {
                return Err(format!("{} is not a file Sushi can open.", name.as_str()));
            }
            open(&["-t".as_ref(), path.as_os_str()])
                .map_err(|e| format!("Could not open {}: {e}", name.as_str()))
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AboutAction {
    CopyBuild,
    Log,
    Reports,
    Folder,
    Docs,
    Notes,
    Github,
    KeyboardSettings,
    Library,
    Report,
    Models,
}

/// The About pane's buttons and System Settings ▸ Keyboard. Nothing takes a URL or a path from
/// the page.
#[tauri::command]
pub async fn prefs_action(
    app: AppHandle,
    action: AboutAction,
    provider: Option<String>,
) -> Result<(), String> {
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    match action {
        // Shown as it is: nothing is created for it.
        AboutAction::Library => {
            let ctx = context(&app)?;
            let (folder, _) = library_folder(
                &ctx.dir,
                ctx.environment.as_deref(),
                &library_snapshot(&ctx.dir),
            )
            .map_err(|(_, message)| message)?;
            if !folder.is_dir() {
                return Err(format!(
                    "The library folder {} does not exist yet.",
                    folder.display()
                ));
            }
            open(&[folder.as_os_str()])
                .map_err(|e| format!("Could not open the library folder: {e}"))
        }
        AboutAction::Report => {
            if !crate::staged() {
                // On the main thread, as from the menu: the panel shows, then hears the event.
                let handle = app.clone();
                app.run_on_main_thread(move || crate::open_report(&handle, "settings"))
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        AboutAction::Models => {
            let provider = self::provider(provider.as_deref().unwrap_or(""))?;
            open(&[provider.models_page().as_ref()])
        }
        AboutAction::CopyBuild => crate::copy_text(build_info::block(&build_info::collect())),
        AboutAction::Log => match diagnostics::path(diagnostics::LOG).filter(|p| p.exists()) {
            Some(log) => open(&["-R".as_ref(), log.as_os_str()]),
            None => {
                let _ = std::fs::create_dir_all(&logs);
                open(&[logs.as_os_str()])
            }
        },
        AboutAction::Reports => {
            let reports = logs.join("Reports");
            let _ = std::fs::create_dir_all(&reports);
            open(&[reports.as_os_str()])
        }
        AboutAction::Folder => {
            let dir = context(&app)?.dir;
            let _ = std::fs::create_dir_all(&dir);
            open(&[dir.as_os_str()])
        }
        AboutAction::Docs => open(&["https://sushi.octolab.org/".as_ref()]),
        AboutAction::Notes => {
            let url = format!(
                "https://sushi.octolab.org/changelog/v{}/",
                env!("CARGO_PKG_VERSION")
            );
            open(&[url.as_ref()])
        }
        AboutAction::Github => open(&["https://github.com/octopot/sushi".as_ref()]),
        AboutAction::KeyboardSettings => {
            open(&["x-apple.systempreferences:com.apple.Keyboard-Settings.extension".as_ref()])
        }
    }
}

/// From the panel: ⌘, opens the window.
#[tauri::command]
pub fn prefs_open(app: AppHandle, pane: Option<PaneId>) {
    if !crate::staged() {
        crate::settings_window::open(&app, pane);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::files::Status;
    use std::fs;

    pub(crate) fn context(dir: &Path) -> Context {
        Context {
            dir: dir.to_path_buf(),
            effect: hotkey::Effect::default(),
            connected: vec![],
            recording: false,
            log_exists: false,
            environment: None,
            logging: false,
            written: None,
        }
    }

    #[test]
    fn loads_every_pane_from_a_fresh_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let prefs = load(&context(tmp.path()));
        assert_eq!(prefs.actions.file.status, Status::Ok, "seeded (LF-3)");
        assert!(prefs.actions.rules.iter().any(|r| r.id == "shorten"));
        assert_eq!(prefs.library.dictionary.file.status, Status::Ok);
        assert_eq!(prefs.keyboard.file.status, Status::Absent);
        assert!(prefs.keyboard.caps_lock);
        assert_eq!(prefs.keyboard.shortcut, "Control+Shift+Space");
        assert_eq!(prefs.keyboard.default_shortcut, "Control+Shift+Space");
        assert_eq!(prefs.model.file.status, Status::Absent);
        assert_eq!(prefs.model.active, "ollama");
        assert_eq!(prefs.library.source, Source::Default);
        assert!(prefs.library.path.ends_with("/Input"));
        assert_eq!(prefs.library.prompts, None, "nothing is created");
        assert!(!tmp.path().join("Input").exists());
        assert_eq!(prefs.about.diagnostics.file.status, Status::Absent);
        assert!(!prefs.about.diagnostics.record);
        assert_eq!(prefs.about.version, env!("CARGO_PKG_VERSION"));
        let ids: Vec<&str> = prefs
            .model
            .providers
            .iter()
            .map(|p| p.id.as_str())
            .collect();
        assert_eq!(ids, ["openrouter", "openai", "anthropic"]);
        assert_eq!(prefs.model.providers[0].connect, ConnectKind::SignIn);
    }

    #[test]
    fn options_tell_stored_effective_and_unset_apart() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("model.json"),
            r#"{"provider": "openrouter", "openrouter": {"model": "m/x", "tier": "flex"}}"#,
        )
        .unwrap();
        let pane = model_pane(&context(tmp.path()));
        let card = &pane.providers[0];
        assert_eq!(card.model_name, "x");
        assert_eq!(
            card.options[1],
            ProviderOption {
                field: Field::Reasoning,
                label: "Reasoning".into(),
                stored: None,
                effective: None,
                unset: None,
                choices: Some(model::REASONING.map(String::from).to_vec()),
            }
        );
        let model = &card.options[0];
        assert_eq!(model.stored.as_deref(), Some("m/x"));
        assert_eq!(model.unset.as_deref(), Some("openai/gpt-6-luna"));
        assert_eq!(model.choices, None);
        // Without a section each option is the default; removing one writes the section with
        // the others, so that one is no longer sent, as the call itself would do.
        let openai = &pane.providers[1].options;
        assert_eq!(openai[1].stored, None);
        assert_eq!(openai[1].effective.as_deref(), Some("high"));
        assert_eq!(openai[1].unset, None);
        assert_eq!(openai[0].unset.as_deref(), Some("gpt-6-luna"));
    }

    #[test]
    fn an_option_edit_keeps_the_legacy_key_and_never_shows_it() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("model.json");
        fs::write(
            &file,
            r#"{"provider": "openrouter", "openrouter": {"key": "sk-or-v1-legacy", "model": "m/x"}}"#,
        )
        .unwrap();
        let ctx = context(tmp.path());
        let pane = model_pane(&ctx);
        assert!(pane.providers[0].connected, "a key of v0.2.1 is a key");
        let json = serde_json::to_string(&load(&ctx)).unwrap();
        assert!(!json.contains("sk-or"), "{json}");
        option(
            tmp.path(),
            &pane.file.revision,
            "openrouter",
            Field::Reasoning,
            Some("low".into()),
        )
        .unwrap();
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.contains("sk-or-v1-legacy") && text.contains("\"reasoning\": \"low\""));
    }

    #[test]
    fn an_option_is_set_removed_or_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("model.json");
        let ctx = context(tmp.path());
        // A first edit starts the section from the defaults: the other options stay in effect.
        option(
            tmp.path(),
            "absent",
            "openai",
            Field::Model,
            Some(" gpt-x ".into()),
        )
        .unwrap();
        let settings = model::load(tmp.path()).unwrap();
        assert_eq!(
            settings.openai.clone().unwrap().model.as_deref(),
            Some("gpt-x")
        );
        assert_eq!(settings.openai().reasoning.as_deref(), Some("high"));
        assert_eq!(
            settings.active(),
            None,
            "looking at a provider never activates it"
        );
        // Removing a field.
        let revision = model_pane(&ctx).file.revision;
        option(tmp.path(), &revision, "openai", Field::Reasoning, None).unwrap();
        let section = model::load(tmp.path()).unwrap().openai.unwrap();
        assert_eq!(section.reasoning, None);
        // What the schema does not allow is never written.
        let revision = model_pane(&ctx).file.revision;
        let before = fs::read_to_string(&file).unwrap();
        for (provider, field, value, message) in [
            (
                "openai",
                Field::Reasoning,
                Some("max"),
                "model.json: openai.reasoning must be one of",
            ),
            (
                "openai",
                Field::Model,
                Some("  "),
                "model.json: openai.model is empty.",
            ),
            (
                "openai",
                Field::Tier,
                Some("fast"),
                "OpenAI has no tier option.",
            ),
            (
                "anthropic",
                Field::Effort,
                Some("none"),
                "model.json: anthropic.effort must be one of",
            ),
        ] {
            let refused = option(
                tmp.path(),
                &revision,
                provider,
                field,
                value.map(String::from),
            );
            match refused {
                Err(Refusal::Invalid(why)) => assert!(why.starts_with(message), "{why}"),
                other => panic!("{other:?}"),
            }
            assert_eq!(fs::read_to_string(&file).unwrap(), before);
        }
        // A stale revision is refused.
        assert_eq!(
            option(
                tmp.path(),
                "absent",
                "openai",
                Field::Reasoning,
                Some("low".into())
            ),
            Err(Refusal::Changed)
        );
    }

    #[test]
    fn a_provider_without_a_key_is_not_chosen() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ctx = context(tmp.path());
        assert_eq!(
            select(&ctx, "absent", "openai"),
            Err(Refusal::Failed(
                "No key for OpenAI is stored on this Mac any more. Connect OpenAI again to use it."
                    .into()
            ))
        );
        assert!(!tmp.path().join("model.json").exists());
        ctx.connected = vec![Provider::OpenAi];
        select(&ctx, "absent", "openai").unwrap();
        assert_eq!(
            model::load(tmp.path()).unwrap().active(),
            Some(Provider::OpenAi)
        );
        let revision = model_pane(&ctx).file.revision;
        select(&ctx, &revision, "ollama").unwrap();
        assert_eq!(model::load(tmp.path()).unwrap().active(), None);
    }

    #[test]
    fn actions_and_terms_save_through_the_validator() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = context(tmp.path());
        let pane = actions(&ctx);
        let mut rules = pane.rules.clone();
        rules.swap(0, 1);
        rules.pop();
        save_rules(tmp.path(), &pane.file.revision, &rules).unwrap();
        assert_eq!(actions(&ctx).rules, rules);
        // An invalid record is not written, nor a write over a hand edit.
        let revision = actions(&ctx).file.revision;
        let mut bad = rules.clone();
        bad[0].instruction = None;
        bad[0].prefix = None;
        assert!(matches!(
            save_rules(tmp.path(), &revision, &bad),
            Err(Refusal::Invalid(_))
        ));
        fs::write(tmp.path().join("rules.json"), r#"{"rules": []}"#).unwrap();
        assert_eq!(
            save_rules(tmp.path(), &revision, &rules),
            Err(Refusal::Changed)
        );
        let library = library_pane(&ctx);
        let mut terms = library.dictionary.terms.clone();
        terms.push(Term {
            from: "mac whisper".into(),
            to: "x".into(),
        });
        assert_eq!(
            save_terms(tmp.path(), &library.dictionary.file.revision, &terms),
            Err(Refusal::Invalid(
                "dictionary.json: duplicate source 'mac whisper'.".into()
            ))
        );
        terms.pop();
        terms.push(Term {
            from: "sushi".into(),
            to: "Sushi".into(),
        });
        save_terms(tmp.path(), &library.dictionary.file.revision, &terms).unwrap();
        assert_eq!(library_pane(&ctx).dictionary.terms, terms);
    }

    #[test]
    fn the_library_folder_is_chosen_and_given_back() {
        if library::environment().is_some() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let ctx = context(tmp.path());
        let folder = tmp.path().join("Prompts");
        fs::create_dir_all(folder.join(".templates")).unwrap();
        fs::write(folder.join("one.md"), "x").unwrap();
        save_library(tmp.path(), "absent", Some(&folder)).unwrap();
        let pane = library_pane(&ctx);
        assert_eq!(pane.source, Source::File);
        assert_eq!(pane.path, folder.display().to_string());
        assert_eq!((pane.prompts, pane.templates), (Some(1), Some(0)));
        assert_eq!(
            fs::read_to_string(tmp.path().join("library-path.txt")).unwrap(),
            format!("{}\n", folder.display())
        );
        save_library(tmp.path(), &pane.file.revision, None).unwrap();
        assert_eq!(library_pane(&ctx).source, Source::Default);
        assert!(!tmp.path().join("library-path.txt").exists());
        assert!(matches!(
            save_library(tmp.path(), "absent", Some(Path::new("relative"))),
            Err(Refusal::Invalid(_))
        ));
    }

    #[test]
    fn the_library_pane_says_what_the_panel_reads() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let ctx = context(tmp.path());
        let file = tmp.path().join("library-path.txt");
        let panel = || library::source(tmp.path()).map(|_| ());
        let env = library::environment().is_some();
        // A relative path, an empty file, an unreadable one: no folder, the panel's message.
        for (written, text) in [("Prompts", "Prompts\n"), ("", "")] {
            fs::write(&file, text).unwrap();
            let pane = library_pane(&ctx);
            assert_eq!(pane.file.status, Status::Invalid);
            assert_eq!(pane.path, written);
            assert_eq!((pane.prompts, pane.templates), (None, None));
            if !env {
                assert_eq!(Err(pane.file.message.unwrap()), panel());
            }
        }
        fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).unwrap();
        let pane = library_pane(&ctx);
        let error = panel();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(pane.file.status, Status::Unreadable);
        assert_eq!((pane.path.as_str(), pane.prompts), ("", None));
        if !env {
            assert_eq!(Err(pane.file.message.unwrap()), error);
        }
        // A readable folder without .templates yet: its prompts, and no templates.
        let folder = tmp.path().join("Notes");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("a.md"), "x").unwrap();
        fs::write(&file, format!("{}\n", folder.display())).unwrap();
        let pane = library_pane(&ctx);
        assert_eq!((pane.prompts, pane.templates), (Some(1), Some(0)));
        // The environment wins over the file, as for the panel.
        let with_env = Context {
            environment: Some(tmp.path().join("Env")),
            ..context(tmp.path())
        };
        let pane = library_pane(&with_env);
        assert_eq!(pane.source, Source::Environment);
        assert_eq!((pane.prompts, pane.templates), (None, None), "not created");
    }

    /// A writer that changes the file right after a save's write, before its reply is built:
    /// the reply still describes what the save wrote, and the next save on it is refused.
    #[test]
    fn a_save_reply_never_adopts_a_later_edit() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = || context(tmp.path());
        let other = |name: &str, text: &str| fs::write(tmp.path().join(name), text).unwrap();
        // Dictionary.
        let pane = library_pane(&ctx());
        let mut terms = pane.dictionary.terms.clone();
        terms.push(Term {
            from: "a".into(),
            to: "A".into(),
        });
        let result = save_terms(tmp.path(), &pane.dictionary.file.revision, &terms);
        other(
            "dictionary.json",
            "{\"terms\": [{\"from\": \"b\", \"to\": \"B-external\"}]}\n",
        );
        let reply = answer(ctx(), FileName::Dictionary, result, library_pane);
        assert_eq!(reply.outcome, Outcome::Saved);
        assert_eq!(reply.pane.dictionary.terms, terms, "what this save wrote");
        let written = settings::render_terms(&terms).unwrap();
        assert_eq!(
            reply.pane.dictionary.file.revision,
            files::revision(Some(&written))
        );
        assert_eq!(
            save_terms(tmp.path(), &reply.pane.dictionary.file.revision, &terms),
            Err(Refusal::Changed),
            "the external edit is not overwritten"
        );
        // Actions, the same way.
        let pane = actions(&ctx());
        let rules = pane.rules[..2].to_vec();
        let result = save_rules(tmp.path(), &pane.file.revision, &rules);
        other("rules.json", "{\"rules\": []}\n");
        let reply = answer(ctx(), FileName::Rules, result, actions);
        assert_eq!(reply.pane.rules, rules);
        assert_eq!(
            save_rules(tmp.path(), &reply.pane.file.revision, &rules),
            Err(Refusal::Changed)
        );
        // Model options, and a file removed by the save (the library folder's default).
        let result = option(
            tmp.path(),
            "absent",
            "openai",
            Field::Reasoning,
            Some("low".into()),
        );
        other("model.json", "{\"provider\": \"ollama\"}\n");
        let reply = answer(ctx(), FileName::Model, result, model_pane);
        assert_eq!(
            reply.pane.providers[1].options[1].stored.as_deref(),
            Some("low")
        );
        assert_eq!(
            option(
                tmp.path(),
                &reply.pane.file.revision,
                "openai",
                Field::Reasoning,
                Some("high".into())
            ),
            Err(Refusal::Changed)
        );
        if library::environment().is_none() {
            other("library-path.txt", "/tmp\n");
            let seen = library_pane(&ctx()).file.revision;
            let result = save_library(tmp.path(), &seen, None);
            other("library-path.txt", "/var\n");
            let reply = answer(ctx(), FileName::LibraryPath, result, library_pane);
            assert_eq!(reply.pane.file.revision, "absent");
            assert_eq!(reply.pane.source, Source::Default);
            assert_eq!(
                save_library(tmp.path(), &reply.pane.file.revision, None),
                Err(Refusal::Changed)
            );
        }
        // A refused save is answered with the file as it is now.
        let reply = answer(ctx(), FileName::Rules, Err(Refusal::Changed), actions);
        assert_eq!(reply.outcome, Outcome::Changed);
        assert!(reply.pane.rules.is_empty());
    }

    #[test]
    fn about_says_whether_sushi_logs_now() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ctx = context(tmp.path());
        ctx.logging = true;
        // No file: off, whatever ran before.
        assert!(!about(&ctx).diagnostics.record);
        // A file Sushi cannot use keeps the mode as it was.
        fs::write(tmp.path().join("diagnostics.json"), "{").unwrap();
        assert!(about(&ctx).diagnostics.record);
        ctx.logging = false;
        assert!(!about(&ctx).diagnostics.record);
        // A valid file says it.
        fs::write(tmp.path().join("diagnostics.json"), r#"{"record": true}"#).unwrap();
        assert!(about(&ctx).diagnostics.record);
    }

    #[test]
    fn a_connected_provider_is_spoken_of_in_the_present() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ctx = context(tmp.path());
        ctx.connected = vec![Provider::OpenRouter];
        let pane = model_pane(&ctx);
        assert!(pane.providers[0]
            .sends
            .starts_with("Edits go to OpenRouter: Sushi's instruction"));
        assert!(pane.providers[1]
            .sends
            .starts_with("Edits will go to OpenAI: Sushi's instruction"));
        assert!(providers::sends(Provider::OpenRouter).starts_with("Edits will go to"));
    }

    #[test]
    fn the_diagnostics_switch_creates_and_updates_its_file() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = context(tmp.path());
        save_diagnostics(tmp.path(), "absent", true).unwrap();
        let pane = about(&ctx);
        assert!(pane.diagnostics.record);
        save_diagnostics(tmp.path(), &pane.diagnostics.file.revision, false).unwrap();
        assert!(!about(&ctx).diagnostics.record);
        assert!(tmp.path().join("diagnostics.json").exists());
    }

    #[test]
    fn a_broken_file_affects_only_its_own_pane_and_can_start_over() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = context(tmp.path());
        fs::write(tmp.path().join("hotkey.json"), r#"{"capsLock": 1}"#).unwrap();
        fs::write(tmp.path().join("diagnostics.json"), "{}").unwrap();
        let prefs = load(&ctx);
        assert_eq!(prefs.keyboard.file.status, Status::Invalid);
        assert!(!prefs.keyboard.file.writable);
        assert!(
            prefs.keyboard.caps_lock,
            "the defaults Sushi uses meanwhile"
        );
        assert_eq!(prefs.about.diagnostics.file.status, Status::Invalid);
        assert_eq!(prefs.actions.file.status, Status::Ok);
        // Starting over keeps the broken bytes aside: the example for hotkey.json, no file for
        // diagnostics.json.
        reset(tmp.path(), FileName::Hotkey, &prefs.keyboard.file.revision).unwrap();
        assert_eq!(
            fs::read_to_string(tmp.path().join("hotkey.json")).unwrap(),
            hotkey::EXAMPLE
        );
        let aside = reset(
            tmp.path(),
            FileName::Diagnostics,
            &prefs.about.diagnostics.file.revision,
        )
        .unwrap()
        .0;
        assert_eq!(fs::read_to_string(aside).unwrap(), "{}");
        assert!(!tmp.path().join("diagnostics.json").exists());
        // Only an invalid file starts over.
        let revision = actions(&ctx).file.revision;
        assert!(matches!(
            reset(tmp.path(), FileName::Rules, &revision),
            Err(Refusal::Failed(_))
        ));
    }

    #[test]
    fn a_saved_reply_names_what_happened() {
        let changed = saved(FileName::Rules, Err(Refusal::Changed), ());
        assert_eq!(changed.outcome, Outcome::Changed);
        assert_eq!(
            changed.message.as_deref(),
            Some("rules.json changed on disk.")
        );
        assert_eq!(saved(FileName::Rules, Ok(()), ()).message, None);
        let json = serde_json::to_value(saved(FileName::Rules, Ok(()), 1)).unwrap();
        assert_eq!(json["outcome"], "saved");
    }

    /// The settings folder as the fixtures name it, on every Mac.
    const SAMPLE_DIR: &str = "/Users/sample/Library/Application Support/me.octopot.sushi";

    /// One real `Prefs` reply, as `prefs_load` builds it after its keychain and hotkey steps,
    /// with what differs between Macs replaced: the folder and the build.
    fn reply(ctx: &Context) -> String {
        let mut prefs = load(ctx);
        let info = build_info::Info {
            version: "0.3.0".into(),
            build: "release".into(),
            date: "2026-11-29T09:30:00Z".into(),
            commit: "0123456789abcdef0123456789abcdef01234567".into(),
            rust: "1.100.0 (0ef1bc386 2026-11-09)".into(),
            tauri: "2.12.7".into(),
            webkit: "21623.1.14.11.4".into(),
            platform: "darwin/arm64".into(),
            macos: "27.2 (25C56)".into(),
            signing: "ad-hoc".into(),
            features: "-".into(),
        };
        prefs.about.version = info.version.clone();
        prefs.about.hash = build_info::short_hash(&info);
        prefs.about.build = build_info::block(&info);
        // A file that names a folder inside the settings folder: its revision as it would be on
        // the sample Mac, made from the same bytes with the sample folder.
        let folder = ctx.dir.display().to_string();
        for (name, state) in [
            (FileName::LibraryPath, &mut prefs.library.file),
            (FileName::Hotkey, &mut prefs.keyboard.file),
        ] {
            if let Ok(text) = fs::read_to_string(ctx.dir.join(name.as_str())) {
                if text.contains(&folder) {
                    let sample = text.replace(&folder, SAMPLE_DIR);
                    state.revision = files::revision(Some(sample.as_bytes()));
                }
            }
        }
        let json = serde_json::to_string_pretty(&prefs).unwrap() + "\n";
        json.replace(&ctx.dir.display().to_string(), SAMPLE_DIR)
    }

    /// Real `Prefs` replies for the browser tests of the settings window, in
    /// tests/fixtures/prefs/: written by `make bindings`, and this test fails while one is stale,
    /// as for src/bindings/. Each state is made in a temporary folder through the code Sushi runs;
    /// the keychain, the recording and the key in effect are given, as the app would find them.
    #[test]
    fn prefs_fixtures_are_current() {
        use std::collections::BTreeMap;
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/prefs");
        let write = std::env::var_os("SUSHI_WRITE_BINDINGS").is_some();
        let default = hotkey::Hotkey::default();
        let caps = hotkey::planned(&default, None, "taken", &[]);
        let mut replies = BTreeMap::new();
        let mut state = |name: &str, setup: &dyn Fn(&mut Context)| {
            let tmp = tempfile::tempdir().unwrap();
            let mut ctx = context(tmp.path());
            ctx.effect = caps.clone();
            // A folder Sushi has started in: the hotkey seeded as at launch (LF-3).
            hotkey::load(tmp.path()).unwrap();
            setup(&mut ctx);
            replies.insert(format!("{name}.json"), reply(&ctx));
        };
        let put = |ctx: &Context, name: &str, text: &str| {
            fs::write(ctx.dir.join(name), text).unwrap();
        };
        state("fresh", &|_| ());
        state("connected", &|ctx| {
            ctx.connected = vec![Provider::OpenRouter, Provider::Anthropic];
            select(ctx, "absent", "openrouter").unwrap();
        });
        state("no-section", &|ctx| {
            ctx.connected = vec![Provider::OpenAi];
            put(ctx, "model.json", "{\"provider\": \"openai\"}\n");
        });
        state("custom-model", &|ctx| {
            ctx.connected = vec![Provider::OpenRouter];
            put(
                ctx,
                "model.json",
                "{\"provider\": \"openrouter\", \"openrouter\": {\"model\": \"anthropic/claude-opus-5-5\"}}\n",
            );
        });
        state("hotkey-input-sources", &|ctx| {
            ctx.effect = hotkey::planned(&hotkey::Hotkey::default(), None, "input-sources", &[]);
        });
        state("hotkey-not-registered", &|ctx| {
            let chosen = hotkey::Hotkey {
                caps_lock: false,
                shortcut: "Option+Space".into(),
            };
            fs::write(
                ctx.dir.join("hotkey.json"),
                hotkey::render(&chosen).unwrap(),
            )
            .unwrap();
            ctx.effect = hotkey::planned(&chosen, None, "off", &["Option+Space"]);
        });
        state("invalid-rules", &|ctx| {
            put(
                ctx,
                "rules.json",
                "{\"rules\": [{\"id\": \"shorten\", \"name\": \"\", \"instruction\": \"Make it shorter.\", \"aliases\": []}]}\n",
            );
        });
        state("invalid-model", &|ctx| {
            ctx.connected = vec![Provider::OpenAi];
            put(
                ctx,
                "model.json",
                "{\"provider\": \"openai\", \"openai\": {\"reasoning\": \"max\"}}\n",
            );
        });
        state("linked-hotkey", &|ctx| {
            let target = ctx.dir.join("Dotfiles");
            fs::create_dir(&target).unwrap();
            fs::rename(ctx.dir.join("hotkey.json"), target.join("hotkey.json")).unwrap();
            std::os::unix::fs::symlink(target.join("hotkey.json"), ctx.dir.join("hotkey.json"))
                .unwrap();
        });
        let library = |root: &Path| {
            fs::create_dir_all(root.join(".templates")).unwrap();
            fs::write(root.join("Release plan.md"), "# Release plan\n").unwrap();
            fs::write(root.join("Bug.md"), "# Bug\n").unwrap();
            fs::write(root.join(".templates/brief.md"), "---\ntitle: Brief\n---\n").unwrap();
        };
        state("library-custom", &|ctx| {
            let folder = ctx.dir.join("Prompts");
            library(&folder);
            put(ctx, "library-path.txt", &format!("{}\n", folder.display()));
        });
        state("library-invalid", &|ctx| {
            put(ctx, "library-path.txt", "Prompts\n");
        });
        state("library-environment", &|ctx| {
            let folder = ctx.dir.join("From the environment");
            library(&folder);
            ctx.environment = Some(folder);
        });
        state("diagnostics-on", &|ctx| {
            save_diagnostics(&ctx.dir, "absent", true).unwrap();
            ctx.log_exists = true;
        });
        state("recording", &|ctx| {
            ctx.recording = true;
        });

        if write {
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
        }
        let mut stale = Vec::new();
        for (name, text) in &replies {
            assert!(
                !text.contains("/var/folders") && !text.contains("/private/"),
                "{name}"
            );
            let path = dir.join(name);
            if write {
                fs::write(&path, text).unwrap();
            } else if fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
                stale.push(format!("tests/fixtures/prefs/{name} is out of date"));
            }
        }
        for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !replies.contains_key(&name) {
                stale.push(format!(
                    "tests/fixtures/prefs/{name} is no longer generated"
                ));
            }
        }
        assert!(
            stale.is_empty(),
            "run `make bindings`: {}",
            stale.join("; ")
        );
    }

    /// The fixture of `make config-vet` (SUSI-12): the choices the window offers, and files
    /// written through the real save paths, accepted and rejected, under `target/files-schema`.
    /// `.github/scripts/files-schema.mjs` compares the choices with the enums of
    /// docs/specs/files.cue and runs `cue vet` on every file: accepted ones pass, rejected fail.
    #[test]
    fn files_schema_corpus() {
        let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/files-schema");
        let _ = fs::remove_dir_all(&out);
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let mut ctx = context(dir);
        ctx.connected = Provider::ALL.to_vec();
        let mut count = 0;
        let mut keep = |kind: &str, def: &str, name: &str, bytes: &[u8]| {
            let folder = out.join(kind).join(def);
            fs::create_dir_all(&folder).unwrap();
            fs::write(folder.join(format!("{name}.json")), bytes).unwrap();
            count += 1;
        };
        let current = |name: FileName| fs::read(dir.join(name.as_str())).unwrap();

        // The choices: provider ids `select` takes, and every option with a list.
        let pane = model_pane(&ctx);
        let mut choices = serde_json::Map::new();
        let providers: Vec<String> = std::iter::once("ollama".to_string())
            .chain(pane.providers.iter().map(|p| p.id.clone()))
            .collect();
        choices.insert("provider".into(), providers.clone().into());
        for card in &pane.providers {
            for option in &card.options {
                if let Some(list) = &option.choices {
                    choices.insert(
                        format!("{}.{}", card.id, field_name(option.field)),
                        list.clone().into(),
                    );
                }
            }
        }
        fs::create_dir_all(&out).unwrap();
        fs::write(
            out.join("choices.json"),
            serde_json::to_vec_pretty(&choices).unwrap(),
        )
        .unwrap();

        // model.json through `select` and `option`, every choice of every list.
        // Ollama last: with no file yet, choosing it writes nothing.
        for id in providers.iter().skip(1).chain(&providers[..1]) {
            let revision = model_pane(&ctx).file.revision;
            select(&ctx, &revision, id).unwrap();
            keep(
                "accepted",
                "Model",
                &format!("select-{id}"),
                &current(FileName::Model),
            );
        }
        for card in &pane.providers {
            for option in &card.options {
                let values: Vec<Option<String>> = match &option.choices {
                    Some(list) => list.iter().cloned().map(Some).collect(),
                    None => vec![Some(" vendor/model-x ".into())],
                };
                for value in values.into_iter().chain([None]) {
                    let revision = model_pane(&ctx).file.revision;
                    option_edit(dir, &revision, &card.id, option.field, value.clone());
                    let name = format!(
                        "{}-{}-{}",
                        card.id,
                        field_name(option.field),
                        value.as_deref().unwrap_or("unset").trim().replace('/', "_")
                    );
                    keep("accepted", "Model", &name, &current(FileName::Model));
                }
            }
        }
        let refused_model = [
            ("openai", Field::Reasoning, "max"),
            ("openrouter", Field::Tier, "priority"),
            ("anthropic", Field::Effort, "none"),
            ("openai", Field::Model, "  "),
        ];
        for (id, field, value) in refused_model {
            let revision = model_pane(&ctx).file.revision;
            let refused = option(dir, &revision, id, field, Some(value.into()));
            assert!(matches!(refused, Err(Refusal::Invalid(_))), "{refused:?}");
            // The bytes the save would have written without the validator.
            let mut settings = model::load(dir).unwrap();
            set_option(
                &mut settings,
                Provider::from_id(id).unwrap(),
                field,
                Some(value.into()),
            )
            .unwrap();
            let bytes = serde_json::to_vec_pretty(&settings).unwrap();
            assert!(model::parse(Some(&bytes)).is_err());
            let name = format!("{id}-{}-{}", field_name(field), value.trim());
            keep("rejected", "Model", &name, &bytes);
        }
        for (name, text) in [
            ("unknown-provider", r#"{"provider": "mistral"}"#),
            (
                "unknown-field",
                r#"{"provider": "openai", "openai": {"temperature": 0}}"#,
            ),
            (
                "key-elsewhere",
                r#"{"provider": "openai", "openai": {"key": "k"}}"#,
            ),
        ] {
            assert!(model::parse(Some(text.as_bytes())).is_err(), "{name}");
            keep("rejected", "Model", name, text.as_bytes());
        }

        // rules.json and dictionary.json through their saves.
        let shipped = actions(&ctx).rules;
        let mut rules = shipped.clone();
        rules.reverse();
        rules.push(Rule {
            id: "prefix-two".into(),
            name: "Prefix two".into(),
            instruction: None,
            prefix: Some("/two  ".into()),
            aliases: vec![],
        });
        for (name, list) in [
            ("shipped", shipped.clone()),
            ("edited", rules),
            ("empty", vec![]),
        ] {
            let revision = actions(&ctx).file.revision;
            save_rules(dir, &revision, &list).unwrap();
            keep("accepted", "Rules", name, &current(FileName::Rules));
        }
        let mut broken = |name: &str, change: &dyn Fn(&mut Vec<Rule>)| {
            let mut list = shipped.clone();
            change(&mut list);
            let revision = actions(&ctx).file.revision;
            assert!(matches!(
                save_rules(dir, &revision, &list),
                Err(Refusal::Invalid(_))
            ));
            let bytes = serde_json::to_vec(&serde_json::json!({ "rules": list })).unwrap();
            assert!(settings::check_rules(&bytes).is_err());
            keep("rejected", "Rules", name, &bytes);
        };
        broken("empty-name", &|l| l[0].name = " ".into());
        broken("both-kinds", &|l| l[1].prefix = Some("/x ".into()));
        broken("no-kind", &|l| l[1].instruction = None);
        broken("empty-alias", &|l| l[1].aliases.push(String::new()));
        broken("duplicate-id", &|l| {
            let copy = l[1].clone();
            l.push(copy)
        });

        let library = library_pane(&ctx);
        let mut terms = library.dictionary.terms.clone();
        terms.push(Term {
            from: "type script".into(),
            to: "TypeScript".into(),
        });
        save_terms(dir, &library.dictionary.file.revision, &terms).unwrap();
        keep(
            "accepted",
            "Dictionary",
            "edited",
            &current(FileName::Dictionary),
        );
        for (name, extra) in [
            ("duplicate-source", (" Type Script ", "TS")),
            ("empty-to", ("voice", " ")),
        ] {
            let mut list = terms.clone();
            list.push(Term {
                from: extra.0.into(),
                to: extra.1.into(),
            });
            let revision = library_pane(&ctx).dictionary.file.revision;
            assert!(matches!(
                save_terms(dir, &revision, &list),
                Err(Refusal::Invalid(_))
            ));
            let bytes = serde_json::to_vec(&serde_json::json!({ "terms": list })).unwrap();
            keep("rejected", "Dictionary", name, &bytes);
        }

        // hotkey.json: the bytes `hotkey::save` writes, and hand-written spellings Sushi takes.
        for (name, caps, shortcut) in [
            ("default", true, "Control+Shift+Space"),
            ("combination", false, "command+option+p"),
            ("digit", false, "Control+1"),
            ("function-key", false, "Shift+F13"),
        ] {
            let bytes = hotkey::render(&hotkey::Hotkey {
                caps_lock: caps,
                shortcut: shortcut.into(),
            })
            .unwrap();
            write(
                dir,
                FileName::Hotkey,
                &files::revision(fs::read(dir.join("hotkey.json")).ok().as_deref()),
                Change::Write(bytes),
            )
            .unwrap();
            keep("accepted", "Hotkey", name, &current(FileName::Hotkey));
        }
        for (name, shortcut) in [
            ("hand-lowercase", "ctrl+shift+space"),
            ("hand-upper", "CMD+ALT+KEYP"),
            ("hand-cmdorctrl", "CmdOrCtrl+K"),
        ] {
            let bytes = format!(r#"{{"capsLock": false, "shortcut": "{shortcut}"}}"#);
            assert!(hotkey::check(bytes.as_bytes()).is_ok(), "{shortcut}");
            keep("accepted", "Hotkey", name, bytes.as_bytes());
        }
        for (name, shortcut) in [
            ("no-modifier", "Space"),
            ("meta", "Meta+Space"),
            ("empty", ""),
        ] {
            assert!(hotkey::canonical(shortcut).is_err(), "{shortcut}");
            let bytes = format!(r#"{{"capsLock": false, "shortcut": "{shortcut}"}}"#);
            assert!(hotkey::check(bytes.as_bytes()).is_err());
            keep("rejected", "Hotkey", name, bytes.as_bytes());
        }

        // diagnostics.json through its switch.
        for record in [true, false] {
            let revision = about(&ctx).diagnostics.file.revision;
            save_diagnostics(dir, &revision, record).unwrap();
            keep(
                "accepted",
                "Diagnostics",
                &format!("record-{record}"),
                &current(FileName::Diagnostics),
            );
        }
        for (name, text) in [("missing", "{}"), ("not-bool", r#"{"record": "yes"}"#)] {
            assert!(diagnostics::parse(text.as_bytes()).is_err());
            keep("rejected", "Diagnostics", name, text.as_bytes());
        }
        assert!(count > 40, "{count}");
    }

    fn option_edit(
        dir: &Path,
        revision: &str,
        provider: &str,
        field: Field,
        value: Option<String>,
    ) {
        option(dir, revision, provider, field, value).unwrap();
    }
}
