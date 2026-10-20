/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui/Button'
import type { CaseOption } from '../../utils/aesaCases'

/**
 * The case window shown by Compute when sensitivity cases are active.
 *
 * Lists the base (always computed, not untickable) and every available case
 * with what it changes; only the ticked cases are computed. Portalled to
 * document.body: the sidebar is sticky, and a modal inside its stacking
 * context can be painted over by the result views (CLAUDE.md, Patch 4X).
 */
export function CaseSelectionModal({ options, initial, onRun, onCancel }: {
  options: CaseOption[]
  initial: Set<string>
  onRun: (picked: Set<string>) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial))
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const groups: { title: string; items: CaseOption[] }[] = [
    { title: 'Sharing principles', items: options.filter((o) => o.kind === 'sharing') },
    { title: 'Parameter sensitivity cases', items: options.filter((o) => o.kind === 'parameter') },
  ].filter((g) => g.items.length > 0)

  return createPortal(
    <div
      data-testid="aesa-case-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Choose sensitivity cases"
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto',
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
          Sensitivity cases to compute
        </div>
        <label style={rowStyle}>
          <input type="checkbox" checked disabled data-testid="aesa-case-base" />
          <span>
            <span style={labelStyle}>Base</span>
            <span style={defStyle}>The configuration as it stands. Always computed.</span>
          </span>
        </label>
        {groups.map((g) => (
          <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
              {g.title}
            </div>
            {g.items.map((o) => (
              <label key={o.id} style={rowStyle}>
                <input
                  type="checkbox"
                  data-testid={`aesa-case-${o.id}`}
                  checked={picked.has(o.id)}
                  onChange={() => toggle(o.id)}
                />
                <span>
                  <span style={labelStyle}>{o.label}</span>
                  {o.definition.map((d) => <span key={d} style={defStyle}>{d}</span>)}
                </span>
              </label>
            ))}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="ghost" onClick={onCancel} data-testid="aesa-case-cancel">Cancel</Button>
          <Button variant="primary" onClick={() => onRun(picked)} data-testid="aesa-case-run">
            Run {picked.size + 1} case{picked.size === 0 ? '' : 's'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 'var(--text-xs)', cursor: 'pointer',
}
const labelStyle: React.CSSProperties = { display: 'block', color: 'var(--text-primary)', fontWeight: 500 }
const defStyle: React.CSSProperties = { display: 'block', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 11 }
