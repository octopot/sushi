import type { FileName } from '../bindings/FileName'
import type { PaneId } from '../bindings/PaneId'
import type { Prefs } from '../bindings/Prefs'

export const PANES: PaneId[] = ['keyboard', 'model', 'actions', 'library', 'about']

/** What every pane gets from the window. */
export interface Context {
  /** Applies what prefs_reset returned: the reset file is taken as it is, the others like a reload. */
  applyReset(prefs: Prefs, name: FileName): void
  /** Reads every file again; panes with drafts keep them. */
  reload(): Promise<void>
  /** The window's own message line, for what has no field. */
  error(e: unknown): void
  /** Says something to VoiceOver without moving the focus ("Shorten moved to position 3 of 6"). */
  announce(text: string): void
}

export interface Pane {
  readonly id: PaneId
  readonly title: string
  readonly root: HTMLElement
  render(): void
  /** Something typed and not in the file yet, even a half-typed phrase: the sidebar shows a dot. */
  pending(): boolean
  /** Esc: ends what is open in the pane; true when it ended something. */
  escape?(): boolean
  /** The window is about to show another pane or hide. */
  leave?(): void
  /** prefs-changed arrived for `file`, before the window loads again. */
  external?(file: string): void
}
