'use client'

import { useState } from 'react'
import { release } from '../release.mjs'

function Command({ children, label }) {
  const [state, setState] = useState('')
  const copy = async () => {
    try { await navigator.clipboard.writeText(children); setState('Copied') }
    catch { setState('Select and copy') }
    setTimeout(() => setState(''), 2000)
  }
  return (
    <div className="install-command">
      <code><span aria-hidden="true">$ </span>{children}</code>
      <button type="button" onClick={copy} aria-label={`Copy: ${label}`}>{state || 'Copy'}</button>
    </div>
  )
}

/** The install commands; `full` adds the model and the manual download. */
export function Install({ full = false }) {
  return (
    <div className={`install${full ? ' install-full' : ''}`}>
      <Command label="install Sushi with Homebrew">{`brew install --cask ${release.cask}`}</Command>
      {full && <Command label="download the local model">{`ollama pull ${release.model}`}</Command>}
    </div>
  )
}
