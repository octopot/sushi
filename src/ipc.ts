// The Tauri commands and events between the page and src-tauri, in one place. src-tauri/src/main.rs
// answers the commands in the app, docs/demo/shim.ts on the site. The replies come from
// src/bindings/Replies.ts, which a Rust test (src-tauri/src/bindings.rs) generates from the commands'
// own return types and keeps current: a change on either side fails `cargo test` or `npm run build`
// instead of reaching the page.
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Diagnostics } from './bindings/Diagnostics'
import type { Edit } from './bindings/Edit'
import type { Field } from './bindings/Field'
import type { FileName } from './bindings/FileName'
import type { Kind } from './bindings/Kind'
import type { PaneId } from './bindings/PaneId'
import type { Replies } from './bindings/Replies'
import type { Rule } from './bindings/Rule'
import type { Settings } from './bindings/Settings'
import type { Term } from './bindings/Term'

export type { Diagnostics, Edit, Field, FileName, PaneId, Rule, Settings, Term }
type ProviderId = 'openrouter' | 'openai' | 'anthropic'

type None = Record<string, never>
/** Written by hand, camelCase: Tauri maps each name to the snake_case parameter of the command. */
interface Args {
  settings_load: None
  startup_notes: None
  warm_model: None
  ollama_download: None
  copy_text: { text: string }
  /** Why the page hides the panel, for the diagnostic log (LF-22). */
  hide_launcher: { reason: 'esc' | 'copy' }
  rewrite: { instruction: string; text: string; requestId: string; local: boolean }
  cancel_rewrite: { requestId: string }
  library_list: { kind: Kind }
  library_read: { kind: Kind; name: string }
  dictionary_open: None
  /** A combination with ⌘ or ⌃ such as `⌘A`, sent only while a recording is on (LF-22). */
  diagnostics_key: { combination: string }
  diagnostics_state: None
  /** Connect again after a rejected or missing key: the id of the provider (MD-6). */
  provider_connect: { provider: 'openrouter' | 'openai' | 'anthropic' }
  report_start: None
  /** `consent`: the hosted provider the user agreed to send the description to, or null (RP-3). */
  report_questions: { description: string; consent: string | null }
  report_record: { on: boolean }
  /** The flow ended: the recording stops and belongs to no report any more (RP-5). */
  report_end: None
  report_draft: { description: string; answers: { question: string; answer: string }[] }
  /** The panel's answer to `report-panel`, its state for the snapshot: never the prompt's text (RP-6). */
  report_panel: { panel: { view: 'editor' | 'actions' | 'library'; versions: number; editing: boolean } }
  report_save: { text: string; recording: boolean }
  // The settings window (SUSI-12). Every save carries the revision of the file it read.
  prefs_load: None
  /** One transaction: validate, register, write; a key that cannot be registered is not written. */
  prefs_keyboard_save: { revision: string; capsLock: boolean; shortcut: string }
  /** The key that shows Sushi pauses while a combination is recorded. */
  prefs_capture: { on: boolean }
  /** 'ollama' or a connected provider's id. */
  prefs_model_select: { revision: string; active: string }
  /** `value` null removes the field from the provider's section. */
  prefs_model_option: { revision: string; provider: ProviderId; field: Field; value: string | null }
  prefs_connect: { provider: ProviderId }
  /** Ends a sign-in that waits for the browser; `prefs_connect` then answers `cancelled`. */
  prefs_connect_cancel: None
  prefs_disconnect: { provider: ProviderId }
  prefs_actions_save: { revision: string; rules: Rule[] }
  prefs_dictionary_save: { revision: string; terms: Term[] }
  prefs_library_choose: { revision: string }
  prefs_library_default: { revision: string }
  prefs_diagnostics_save: { revision: string; record: boolean }
  /** Only for an invalid file: its bytes are kept aside, then the defaults take its place. */
  prefs_reset: { name: FileName; revision: string }
  prefs_file: { name: FileName; action: 'reveal' | 'edit' }
  /** `library` shows the folder the Library reads; `report` starts Report a problem in the panel;
      `models` opens the public model list of `provider`, which the other actions ignore. */
  prefs_action: { action: 'copy-build' | 'log' | 'reports' | 'folder' | 'docs' | 'notes' | 'github' | 'keyboard-settings' | 'library' | 'report' | 'models'; provider: ProviderId | null }
  /** From the panel: ⌘, opens the window. */
  prefs_open: { pane: PaneId | null }
}
/** Every registered command; a command missing from `Args` stops the build here. */
export type Commands = { [K in keyof Replies]: { args: Args[K]; reply: Replies[K] } }
// …and a key in `Args` for a command Rust no longer registers stops it too.
true satisfies [Exclude<keyof Args, keyof Replies>] extends [never] ? true : never

/** `invoke` with the arguments and the reply of `command` checked against `Commands`. */
export function call<K extends keyof Commands>(
  command: K, ...args: Commands[K]['args'] extends None ? [] : [Commands[K]['args']]
): Promise<Commands[K]['reply']> {
  return invoke<Commands[K]['reply']>(command, args[0])
}

/** The events src-tauri emits to the page, with their payloads. */
export interface Events {
  /** The panel was shown again (main.rs, `show_launcher`). */
  'launcher-shown': null
  /** Problems found while starting, joined into one message (hotkey.rs). */
  'startup-notes': string
  /** To the report's window only: Report a problem was chosen again, in the menu bar menu or in
      Settings ▸ About, and the flow shows where it is (report_window.rs). */
  'report-open': null
  /** To the panel only: the report is being built and asks what the panel shows; the page
      answers with `report_panel` (report.rs). */
  'report-panel': null
  /** The recording of a report started or finished, in its window, the panel or the menu (report.rs). */
  'report-recording': boolean
  /** To the settings window only: something outside it changed a file, the keychain or the
      recording state (preferences.rs, `changed`); the page loads again. */
  'prefs-changed': { file: FileName | 'keychain' | 'recording' }
  /** To the settings window only: show this pane (settings_window.rs). */
  'prefs-pane': PaneId
}

export function on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Promise<UnlistenFn> {
  return listen<Events[K]>(event, ({ payload }) => handler(payload))
}
