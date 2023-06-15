// The Tauri commands and events between the page and src-tauri, in one place. src-tauri/src/main.rs
// answers the commands in the app, docs/demo/shim.ts on the site. The replies come from
// src/bindings/Replies.ts, which a Rust test (src-tauri/src/bindings.rs) generates from the commands'
// own return types and keeps current: a change on either side fails `cargo test` or `npm run build`
// instead of reaching the page.
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Edit } from './bindings/Edit'
import type { Kind } from './bindings/Kind'
import type { Replies } from './bindings/Replies'
import type { Rule } from './bindings/Rule'
import type { Settings } from './bindings/Settings'

export type { Edit, Rule, Settings }

type None = Record<string, never>
/** Written by hand, camelCase: Tauri maps each name to the snake_case parameter of the command. */
interface Args {
  settings_load: None
  startup_notes: None
  warm_model: None
  ollama_download: None
  copy_text: { text: string }
  hide_launcher: None
  rewrite: { instruction: string; text: string; requestId: string; local: boolean }
  cancel_rewrite: { requestId: string }
  library_list: { kind: Kind }
  library_read: { kind: Kind; name: string }
  dictionary_open: None
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
}

export function on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Promise<UnlistenFn> {
  return listen<Events[K]>(event, ({ payload }) => handler(payload))
}
