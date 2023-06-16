// Model (model.json, keys in the keychain): where edits run. Each row opens its details in place;
// opening never changes anything. Use for edits, Connect… and Disconnect… say what they do.
import type { Field } from '../../bindings/Field'
import type { ModelPane } from '../../bindings/ModelPane'
import type { ProviderCard } from '../../bindings/ProviderCard'
import type { ProviderOption } from '../../bindings/ProviderOption'
import { call } from '../../ipc'
import { FileBar, fileNotice } from '../filebar'
import type { Context, Pane } from '../pane'
import type { Slot } from '../store'
import { afterFocus, button, card, chevron, composing, fieldError, group, h, row, select } from '../ui'

type ProviderId = ProviderCard['id']
const optionKey = (provider: string, field: Field) => provider + '.' + field

/** The options in the user's words: what each one does. */
const OPTION: Record<Field, { label: string; help: (provider: string) => string }> = {
  model: { label: 'Model ID', help: () => '' },
  reasoning: { label: 'Reasoning effort', help: () => 'How long the model thinks before it answers. More is slower and costs more.' },
  tier: { label: 'Service tier', help: () => 'OpenRouter’s speed and price class for the request. Faster tiers cost more.' },
  effort: { label: 'Effort', help: () => 'How much work Claude puts into an edit. More is slower and costs more.' },
}

export class ModelSettings implements Pane {
  readonly id = 'model'
  readonly title = 'Model'
  readonly root = h('div', { class: 'pane-body' })
  private readonly bar: FileBar<ModelPane>
  /** The row whose details are open; undefined follows the provider in use, null closes all. */
  private open: string | null | undefined = undefined
  /** The model ID typed and not in the file yet, per provider. */
  private readonly typed = new Map<ProviderId, string>()
  /** Choices on their way to the file, shown at once. */
  private selecting: string | null = null
  private readonly setting = new Map<string, string | null>()
  private readonly errors = new Map<string, string>()
  private readonly flows = new Map<ProviderId, 'connect' | 'disconnect'>()
  private advanced = new Set<ProviderId>()
  private stopped = false
  /** The row whose Use for edits was refused. */
  private refused: string | null = null

  constructor(private readonly slot: Slot<ModelPane>, private readonly ctx: Context) {
    slot.host = {
      file: pane => pane.file,
      hasDraft: () => this.typed.size > 0 || this.selecting !== null || this.setting.size > 0,
      blocked: () => this.errors.size > 0 && this.typed.size > 0,
      dropDraft: () => { this.typed.clear(); this.selecting = null; this.setting.clear(); this.errors.clear() },
      render: () => this.render(),
    }
    this.bar = new FileBar(slot, 'model')
  }

  pending() { return this.typed.size > 0 }

  private get active() { return this.selecting ?? this.slot.pane.active }

  private choose(active: string) {
    this.selecting = active
    this.errors.delete('active')
    this.refused = null
    const done = () => { if (this.selecting === active) this.selecting = null }
    const fail = (text: string) => { done(); this.errors.set('active', text); this.refused = active }
    // A refused choice (a key gone since the window read it) shows at its row, and the window reads again.
    const failed = (text: string) => { fail(text); void this.ctx.reload() }
    this.slot.save({ send: revision => call('prefs_model_select', { revision, active }), saved: done, invalid: fail, failed, matches: pane => pane.active === active })
    this.render()
  }

  private option(provider: ProviderId, field: Field, value: string | null) {
    const key = optionKey(provider, field)
    this.setting.set(key, value)
    this.errors.delete(key)
    const settle = () => { if (this.setting.get(key) === value) this.setting.delete(key) }
    this.slot.save({
      send: revision => call('prefs_model_option', { revision, provider, field, value }),
      matches: pane => (pane.providers.find(p => p.id === provider)?.options.find(o => o.field === field)?.stored ?? null) === (field === 'model' ? value?.trim() ?? null : value),
      saved: () => {
        settle()
        if (field === 'model' && (this.typed.get(provider) ?? '').trim() === (value ?? '')) this.typed.delete(provider)
      },
      // The typed model ID stays in the field with the reason beside it, ready to fix and send again.
      invalid: text => { settle(); this.errors.set(key, text) },
      failed: text => { settle(); this.errors.set(key, text) },
    })
    this.render()
  }

  private commitModel(provider: ProviderId) {
    const text = this.typed.get(provider)
    if (text === undefined) return
    const option = this.slot.pane.providers.find(p => p.id === provider)?.options.find(o => o.field === 'model')
    if (!option) return
    const value = text.trim() || null
    const key = optionKey(provider, 'model')
    const current = this.setting.has(key) ? this.setting.get(key) : option.stored
    if (value === current && !this.errors.has(key)) {
      this.typed.delete(provider)
      this.render()
      return
    }
    this.option(provider, 'model', value)
  }

  private async flow(provider: ProviderCard, kind: 'connect' | 'disconnect') {
    this.flows.set(provider.id, kind)
    this.render()
    try {
      // Both resolve when the native sheet is done; it says its own errors.
      if (kind === 'connect') await call('prefs_connect', { provider: provider.id })
      else await call('prefs_disconnect', { provider: provider.id })
    } catch (e) {
      this.ctx.error(e)
    } finally {
      this.flows.delete(provider.id)
      await this.ctx.reload()
      this.render()
    }
  }

  render() {
    const pane = this.slot.pane
    const writable = pane.file.writable && !this.slot.conflict
    const open = this.open === undefined ? this.active : this.open
    const notice = fileNotice(this.slot, {
      subject: 'The model settings',
      resave: () => { for (const provider of [...this.typed.keys()]) this.commitModel(provider) },
      reset: prefs => this.ctx.applyReset(prefs, 'model.json'),
    })
    // An invalid model.json runs no edit (MD-3): no row is in use until it is fixed.
    // A link whose target does not validate stops edits the same way.
    this.stopped = pane.file.status === 'invalid' || pane.file.status === 'unreadable' ||
      (pane.file.status === 'linked' && !!(pane.file.message ?? '').split('Edit it where it points.')[1]?.trim())
    const items = [
      this.item('ollama', 'Ollama', `On this Mac · ${pane.ollama.model}`, open === 'ollama', () => this.ollamaDetails(pane, writable)),
      ...pane.providers.map(p => this.item(p.id, p.name,
        p.connected ? `Connected · ${p.modelName}` : this.active === p.id && !this.stopped ? 'In use, but no key is saved' : 'Not connected',
        open === p.id, () => this.providerDetails(p, writable))),
    ]
    const list = card(...items)
    list.classList.add('provider-list')
    list.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !(event.target as Element).classList.contains('provider-head')) return
      const heads = [...list.querySelectorAll<HTMLButtonElement>('.provider-head')]
      const at = heads.indexOf(event.target as HTMLButtonElement)
      event.preventDefault()
      heads[Math.max(0, Math.min(heads.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))].focus()
    })
    this.root.replaceChildren(
      ...(notice ? [notice] : []),
      group('Edits run on', list, this.refused === null ? fieldError(this.errors.get('active'), 'model-active-error') : null, this.bar.root),
    )
    this.bar.update()
  }

  private item(id: string, name: string, sub: string, open: boolean, details: () => HTMLElement) {
    const inUse = this.active === id && !this.stopped
    const head = h('button', {
      type: 'button', class: 'provider-head', id: 'model-row-' + id, 'aria-expanded': String(open), 'aria-controls': 'model-details-' + id,
    },
      chevron(open),
      h('span', { class: 'choice-text' }, h('span', { class: 'choice-name', text: name }), h('span', { class: 'choice-sub', text: sub })),
      inUse ? h('span', { class: 'in-use', text: 'In use' }) : null)
    head.addEventListener('click', () => { this.open = open ? null : id; this.render() })
    const refusal = this.refused === id ? this.errors.get('active') : undefined
    return h('div', { class: 'provider' + (open ? ' open' : '') }, head,
      refusal ? h('div', { class: 'row-message' }, fieldError(refusal, 'model-active-error')) : null,
      open ? h('div', { class: 'provider-details', id: 'model-details-' + id, role: 'group', 'aria-label': name }, details()) : null)
  }

  private ollamaDetails(pane: ModelPane, writable: boolean) {
    const inUse = this.active === 'ollama'
    return h('div', {},
      row({ title: 'On this Mac', detail: 'Nothing leaves it, and nothing is paid. Edits use this model:', control: h('code', { class: 'value', text: pane.ollama.model }) }),
      inUse ? null : h('div', { class: 'detail-actions' },
        button({ label: 'Use for edits', id: 'model-use-ollama', disabled: !writable, onClick: () => this.choose('ollama') })))
  }

  private providerDetails(p: ProviderCard, writable: boolean) {
    const pending = this.flows.get(p.id)
    const inUse = this.active === p.id
    if (!p.connected) {
      const connect = button({
        label: pending === 'connect' ? 'Connecting…' : 'Connect…', kind: 'primary', id: 'model-connect-' + p.id,
        busy: pending === 'connect', onClick: () => this.flow(p, 'connect'),
      })
      return h('div', {},
        inUse ? h('p', { class: 'detail-note warning-text', text: `Edits are set to run on ${p.name}, but no key is saved. Connect it, or use another row.` }) : null,
        row({ title: 'What leaves your Mac', detail: p.sends }),
        row({ title: 'Who pays', detail: p.pays }),
        h('div', { class: 'detail-actions' },
          h('span', { class: 'card-note', text: pending === 'connect'
            ? `Finish in the sheet Sushi opened${p.connect === 'sign-in' ? ', or in your browser' : ''}.`
            : p.connect === 'sign-in' ? `Sign in to ${p.name} in your browser. The key is kept in the keychain.` : 'Paste an API key once. It is kept in the keychain.' }),
          connect))
    }
    const [model, ...rest] = p.options
    const open = this.advanced.has(p.id)
    const summary = h('button', { type: 'button', class: 'disclosure', id: `model-advanced-${p.id}`, 'aria-expanded': String(open) },
      chevron(open), h('span', { text: 'Advanced' }))
    summary.addEventListener('click', () => { if (open) this.advanced.delete(p.id); else this.advanced.add(p.id); this.render() })
    const disconnect = button({
      label: pending === 'disconnect' ? 'Disconnecting…' : 'Disconnect…', kind: 'quiet', id: 'model-disconnect-' + p.id,
      busy: pending === 'disconnect', onClick: () => this.flow(p, 'disconnect'),
    })
    return h('div', {},
      h('div', { class: 'detail-actions top' },
        h('span', { class: 'key-saved' }, h('strong', { text: 'Key saved' }), ' · checked when you run an edit'),
        inUse ? null : button({ label: 'Use for edits', id: 'model-use-' + p.id, disabled: !writable || !!pending, onClick: () => this.choose(p.id) })),
      model ? this.modelRow(p, model, writable && !pending) : null,
      rest.length ? h('div', { class: 'advanced' }, summary,
        open ? h('div', { class: 'advanced-body' }, ...rest.map(o => this.optionRow(p, o, writable && !pending))) : null) : null,
      h('div', { class: 'detail-actions quiet' },
        h('span', { class: 'card-note', text: `${p.sends} ${p.pays}` }),
        disconnect))
  }

  private modelRow(p: ProviderCard, o: ProviderOption, writable: boolean) {
    const key = optionKey(p.id, 'model')
    const pending = this.setting.has(key)
    const stored = pending ? this.setting.get(key)! : o.stored
    const error = this.errors.get(key)
    const input = h('input', {
      type: 'text', id: 'model-name-' + p.id, class: 'text', spellcheck: 'false', autocomplete: 'off',
      'aria-label': `${p.name} model ID`, placeholder: o.unset ?? '',
      'aria-describedby': error ? `model-name-error-${p.id}` : `model-name-detail-${p.id}`, 'aria-invalid': error ? 'true' : undefined,
    })
    input.value = this.typed.get(p.id) ?? stored ?? ''
    input.disabled = !writable
    input.addEventListener('input', () => { this.typed.set(p.id, input.value); this.slot.changed() })
    // Return sends it and keeps the focus here; leaving the field sends it too.
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || composing(event)) return
      event.preventDefault()
      this.commitModel(p.id)
    })
    input.addEventListener('change', () => afterFocus(() => this.commitModel(p.id)))
    const detail = stored === null ? `Not set in the file, so edits use ${o.effective ?? o.unset ?? 'the provider’s default'}.` : `Edits use ${o.effective ?? stored}.`
    // Without a model in the section, Sushi fills in its own defaults for the options the file does not set (MD-10).
    const refilled = stored === null ? [] : p.options.filter(x => x.field !== 'model' && x.stored === null).map(x => OPTION[x.field].label.toLowerCase())
    const reset = refilled.length
      ? `Use Sushi’s default also brings back Sushi’s defaults for ${refilled.join(' and ')}, which the file does not set.` : null
    return h('div', { class: 'row stacked' },
      h('div', { class: 'row-text' },
        h('label', { class: 'row-title', for: input.id, text: OPTION.model.label }),
        h('div', { class: 'row-detail', id: 'model-name-detail-' + p.id, text: detail })),
      h('div', { class: 'row-control wide' }, input,
        button({ label: 'Use Sushi’s default', kind: 'quiet', id: `model-default-${p.id}`, title: reset ?? undefined, disabled: !writable || (stored === null && !this.typed.has(p.id)),
          onClick: () => { this.typed.delete(p.id); this.option(p.id, 'model', null) } }),
        button({ label: 'Browse models…', id: `model-browse-${p.id}`,
          onClick: () => call('prefs_action', { action: 'models', provider: p.id }).catch(e => this.ctx.error(e)) })),
      reset ? h('div', { class: 'field-help', id: `model-default-help-${p.id}`, text: reset }) : null,
      fieldError(error, `model-name-error-${p.id}`))
  }

  private optionRow(p: ProviderCard, o: ProviderOption, writable: boolean) {
    const key = optionKey(p.id, o.field)
    const stored = this.setting.has(key) ? this.setting.get(key)! : o.stored
    // What edits send now comes from `effective`, whatever the file stores; removing the field is a choice of
    // its own, offered only when the file sets it, and its consequence comes from `unset`.
    const sends = (value: string | null) => value === null ? 'nothing is sent' : `edits send ${value}`
    const empty = stored === null
      ? `Not set in the file · ${sends(o.effective)}`
      : `Remove from the file — ${o.unset === null ? 'nothing is sent' : `Sushi sends ${o.unset}`}`
    const choices = [{ value: '', label: empty }, ...(o.choices ?? []).map(c => ({ value: c, label: c }))]
    // The select already says what is set or sent; a line beside it only when the two differ.
    const state = stored === null ? ''
      : o.effective === null ? `Saved as ${stored}; this model’s request does not send it.`
      : o.effective !== stored ? `Saved as ${stored}; edits send ${o.effective}.` : ''
    const help = OPTION[o.field]
    const describedBy = `model-option-${p.id}-${o.field}-detail`
    const control = select({
      label: `${p.name} ${help.label.toLowerCase()}`, id: `model-option-${p.id}-${o.field}`, describedBy, choices, value: stored ?? '', disabled: !writable,
      onChange: value => this.option(p.id, o.field, value || null),
    })
    return h('div', { class: 'row-wrap' },
      row({ title: help.label, detail: h('span', { id: describedBy }, help.help(p.id), state ? h('span', { class: 'option-state differs' }, ' ', state) : null), control }),
      fieldError(this.errors.get(key)))
  }
}
