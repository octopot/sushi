// Files are the committed truth; the page keeps drafts beside them. A Slot is one settings file:
// what was last read or saved, the saves waiting for it (run one at a time, each with the revision
// the previous one left), and a conflict when the file changed under a draft.
import type { FileState } from '../bindings/FileState'
import type { Saved } from '../bindings/Saved'

export interface Op<P> {
  /** Sends the change with the revision the file has now (as far as the page knows). */
  send(revision: string): Promise<Saved<P>>
  /** A queued op with the same key is replaced instead of queued twice: a whole-file save. */
  key?: string
  /** The validator refused: the message belongs next to the field. */
  invalid?(message: string): void
  failed?(message: string): void
  saved?(): void
  /** Every reply, `changed` included: clears what the page shows while the request runs. */
  settled?(): void
  /**
   * Whether a `saved` reply holds what this op sent. Rust replies with what the save wrote, so it always does;
   * if it ever did not, the file was changed by someone else in between, and that is a conflict, not ours to adopt.
   */
  matches?(pane: P): boolean
}

export interface SlotHost<P> {
  file(pane: P): FileState
  /** Something typed or chosen that differs from the file and would be written by a save. */
  hasDraft(): boolean
  /** Input that is not part of a save yet (a half-typed phrase) and that `fresh` would take away. */
  loses?(fresh: P): boolean
  /** A draft that cannot be saved as it is (an empty name, a duplicate term): "Not saved". */
  blocked?(): boolean
  /** Use the file's version: forget the drafts. */
  dropDraft(): void
  /** The file was read again while the pane had no draft: take the fresh values as they are. */
  rebase?(): void
  /** Draws the pane again from `slot.pane`, keeping the drafts. */
  render(): void
}

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'conflict' | 'failed' | 'absent'

export class Slot<P> {
  pane: P
  host!: SlotHost<P>
  private ops: Op<P>[] = []
  private running = false
  /** The loop of pump() is on; a save made while it draws joins the queue instead of starting another loop. */
  private pumping = false
  /** The file changed under a draft: the fresh read, kept beside the draft, and the pane it replaced. */
  conflict: { fresh: P; base: P } | null = null
  /** The last failed save, until the next save or reload. */
  failure: string | null = null
  /** When the last save went through, for the short "Saved" in the header. */
  savedAt = 0
  /** Bumped by every reply, so a load that started before it does not overwrite it. */
  epoch = 0
  private readonly listeners = new Set<() => void>()

  constructor(pane: P) { this.pane = pane }

  get file(): FileState { return this.host.file(this.pane) }
  get revision(): string { return this.file.revision }
  get busy(): boolean { return this.running || this.ops.length > 0 }

  get state(): SaveState {
    if (this.conflict) return 'conflict'
    if (this.busy) return 'saving'
    if (this.failure) return 'failed'
    if (this.host.blocked?.()) return 'unsaved'
    if (this.file.status === 'absent') return 'absent'
    return 'saved'
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  changed() { for (const listener of this.listeners) listener() }

  /** Takes `pane` as what the file holds now. A pane that had no draft against the old one follows the new one. */
  private replace(pane: P) {
    const clean = !this.host.hasDraft()
    this.pane = pane
    if (clean) this.host.rebase?.()
  }

  save(op: Op<P>) {
    const queued = op.key === undefined ? -1 : this.ops.findIndex((o, i) => o.key === op.key && (i > 0 || !this.running))
    if (queued >= 0) this.ops[queued] = op
    else this.ops.push(op)
    this.changed()
    void this.pump()
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.ops.length && !this.conflict) {
        const op = this.ops[0]
        this.running = true
        // The revision this request was based on: a reply may hand over a newer one only with its own content.
        const based = this.revision
        let reply: Saved<P>
        try {
          reply = await op.send(based)
        } catch (e) {
          reply = { outcome: 'failed', message: e instanceof Error ? e.message : String(e), pane: this.pane }
        }
        this.running = false
        this.epoch++
        op.settled?.()
        if (reply.outcome === 'changed') {
          this.conflict = { fresh: reply.pane, base: this.pane }
          this.host.render()
          break
        }
        this.ops.shift()
        if (reply.outcome === 'saved' && op.matches && !op.matches(reply.pane)) {
          this.conflict = { fresh: reply.pane, base: this.pane }
          this.savedAt = Date.now()
          op.saved?.()
          this.host.render()
          break
        }
        const message = reply.message ?? (reply.outcome === 'invalid' ? 'Sushi cannot save this.' : 'Sushi could not save the change.')
        // A refusal (invalid, failed) replies with a fresh read. If the file moved since the request was based on it,
        // someone else wrote it: the drafts and the waiting saves were read from the older file, so they wait for a
        // decision instead of going out under a revision they never saw.
        if (reply.outcome !== 'saved' && this.host.file(reply.pane).revision !== based) {
          if (reply.outcome === 'invalid') op.invalid?.(message)
          else op.failed?.(message)
          if (this.host.hasDraft() || this.ops.length) {
            this.conflict = { fresh: reply.pane, base: this.pane }
            this.host.render()
            break
          }
          // Nothing of the page's own is left: the fresh read is simply the file now.
          this.failure = reply.outcome === 'failed' && !op.failed ? message : null
          this.replace(reply.pane)
          this.host.render()
          this.changed()
          continue
        }
        // A failure with no field to show it at goes to the pane's banner.
        this.failure = reply.outcome === 'failed' && !op.failed ? message : null
        // The pane takes the reply first, so the handlers see what the file holds now; then it is drawn.
        this.pane = reply.pane
        if (reply.outcome === 'saved') { this.savedAt = Date.now(); op.saved?.() }
        else if (reply.outcome === 'invalid') op.invalid?.(message)
        else op.failed?.(message)
        this.host.render()
        this.changed()
      }
    } finally {
      this.pumping = false
    }
    this.changed()
  }

  /** A read of the file (on focus, on prefs-changed, after a reset). Never drops a draft. */
  reload(pane: P, startedAt: number, force = false) {
    // A load that started before the last reply, or while a request is out, is older than what the page has.
    if (!force && (this.running || this.epoch !== startedAt)) return
    // A conflict waiting for a decision keeps its fresh side as fresh as the file.
    if (!force && this.conflict) {
      if (JSON.stringify(pane) === JSON.stringify(this.conflict.fresh)) return
      this.conflict = { ...this.conflict, fresh: pane }
      this.host.render()
      this.changed()
      return
    }
    if (!force && this.busy) return
    // Nothing changed: no redraw, which would also take away a control the user is pressing right now.
    if (!force && !this.failure && JSON.stringify(pane) === JSON.stringify(this.pane)) return
    const fresh = this.host.file(pane).revision
    if (!force && ((this.host.hasDraft() && fresh !== this.revision) || this.host.loses?.(pane))) {
      this.conflict = { fresh: pane, base: this.pane }
    } else {
      if (force) { this.conflict = null; this.ops = []; this.host.dropDraft() }
      this.failure = null
      this.replace(pane)
    }
    this.host.render()
    this.changed()
  }

  /** Use the file's version. */
  useFile() {
    if (!this.conflict) return
    const fresh = this.conflict.fresh
    this.conflict = null
    this.ops = []
    this.failure = null
    this.host.dropDraft()
    this.pane = fresh
    this.host.rebase?.()
    this.host.render()
    this.changed()
  }

  /** Replace with my version: the drafts and the waiting saves go over the fresh revision. */
  keepMine(resave: () => void) {
    if (!this.conflict) return
    const fresh = this.conflict.fresh
    this.conflict = null
    this.pane = fresh
    if (this.ops.length) void this.pump()
    else resave()
    this.host.render()
    this.changed()
  }
}
