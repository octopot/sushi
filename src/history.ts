/** A version produced by an action carries its label; only such versions have a diff position. */
export interface Version { text: string; label?: string }

/**
 * A linear chain of prompt versions. For A →(Shorten) B →(Clarify) C the positions are
 * text A, diff(A,B), text B, diff(B,C), text C. Copy always takes versions[index].text:
 * A, B, B, C, C.
 */
export class Chain {
  versions: Version[] = []
  index = 0
  diff = false
  review = false
  copied = false

  constructor(text = '') { this.reset(text) }

  get current(): Version { return this.versions[this.index] }
  /** The whole prompt: the shown text, or the right-hand text of a diff. */
  get text(): string { return this.current.text }
  /** The left-hand text while a diff is shown. */
  get before(): string | undefined { return this.diff ? this.versions[this.index - 1].text : undefined }
  get canBack(): boolean { return this.index > 0 }
  get canForward(): boolean { return this.diff || this.index < this.versions.length - 1 }

  private hasDiff(index: number) { return index > 0 && this.versions[index].label !== undefined }
  private moved() { this.review = true; this.copied = false; return true }

  back(): boolean {
    if (this.diff) { this.diff = false; this.index-- }
    else if (this.hasDiff(this.index)) this.diff = true
    else if (this.index > 0) this.index--
    else return false
    return this.moved()
  }

  forward(): boolean {
    if (this.diff) this.diff = false
    else if (this.index < this.versions.length - 1) this.diff = this.hasDiff(++this.index)
    else return false
    return this.moved()
  }

  /** An action result: drops everything after the current version and shows the new diff. */
  apply(text: string, label: string): boolean {
    if (text === this.text) return false
    this.append({ text, label })
    this.diff = true
    this.review = true
    return true
  }

  /** Typing edits the current version in place. */
  edit(text: string) {
    this.versions[this.index] = { ...this.current, text }
    this.diff = this.review = this.copied = false
  }

  /** A Library entry becomes the next version, or replaces a blank prompt. */
  open(text: string) {
    if (this.versions.length === 1 && !this.text.trim()) this.reset(text)
    else this.append({ text })
    this.diff = this.review = this.copied = false
  }

  /** A new prompt. */
  reset(text: string) {
    this.versions = [{ text }]
    this.index = 0
    this.diff = this.review = this.copied = false
  }

  private append(version: Version) {
    this.versions = [...this.versions.slice(0, this.index + 1), version]
    this.index = this.versions.length - 1
    this.copied = false
  }

  /**
   * Frees storage: keeps the first version and everything from the previous version on.
   * The diff from the first version to the next kept one then merges every dropped edit,
   * so an action's label there would name only the last of them.
   */
  compact(): boolean {
    const from = this.index - 1
    if (from <= 1) return false
    const merged = this.versions[from]
    this.versions = [this.versions[0], merged.label === undefined ? merged : { ...merged, label: 'Earlier edits' },
      ...this.versions.slice(from + 1)]
    this.index -= from - 1
    return true
  }

  toJSON() {
    const { versions, index, diff, review, copied } = this
    return { versions, index, diff, review, copied }
  }

  static restore(value: unknown): Chain {
    const chain = new Chain()
    if (!value || typeof value !== 'object') return chain
    const { versions, index, diff, review, copied } = value as Record<string, unknown>
    const valid = Array.isArray(versions) && versions.length > 0 &&
      versions.every(v => v && typeof v === 'object' && typeof v.text === 'string' &&
        (v.label === undefined || typeof v.label === 'string')) &&
      Number.isInteger(index) && (index as number) >= 0 && (index as number) < versions.length
    if (!valid) return chain
    chain.versions = versions.map(({ text, label }) => label === undefined ? { text } : { text, label })
    chain.index = index as number
    chain.diff = diff === true && chain.hasDiff(chain.index)
    chain.review = review === true
    chain.copied = copied === true
    return chain
  }
}
