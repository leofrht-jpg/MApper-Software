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
  // Two axes, listed apart: every ticked case is computed under every ticked
  // sharing. Base is on both and always computed.
  const groups: { axis: 'case' | 'sharing'; title: string; note: string; base: string; items: CaseOption[] }[] = [
    { axis: 'case', title: 'Cases', note: 'Parameter values. Each case reruns the LCA once.',
      base: 'Base: the parameter values as they stand.', items: options.filter((o) => o.kind === 'parameter') },
    { axis: 'sharing', title: 'Sharing', note: 'How the boundary is shared down to the product. No LCA rerun.',
      base: 'Base chain: the configured sharing chain.', items: options.filter((o) => o.kind === 'sharing') },
  ]
  const nCases = 1 + groups[0].items.filter((o) => picked.has(o.id)).length
  const nSharing = 1 + groups[1].items.filter((o) => picked.has(o.id)).length

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
          Cases and sharing to compute
        </div>
        {groups.map((g) => (
          <div key={g.axis} data-testid={`aesa-case-group-${g.axis}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
              {g.title}
            </div>
            <div style={defStyle}>{g.note}</div>
            <label style={rowStyle}>
              <input type="checkbox" checked disabled data-testid={g.axis === 'case' ? 'aesa-case-base' : 'aesa-sharing-base'} />
              <span>
                <span style={labelStyle}>{g.axis === 'case' ? 'Base' : 'Base chain'}</span>
                <span style={defStyle}>{g.base} Always computed.</span>
              </span>
            </label>
            {g.items.map((o) => (
              <label key={o.id} style={rowStyle}>
                <input
                  type="checkbox"
                  data-testid={`aesa-case-${o.id}`}
                  checked={picked.has(o.id)}
                  onChange={() => toggle(o.id)}
                />
                <span>
                  <span style={labelStyle}>{o.label.replace(/^(Case|Sharing): /, '')}</span>
                  {o.definition.map((d) => <span key={d} style={defStyle}>{d}</span>)}
                </span>
              </label>
            ))}
            {g.items.length === 0 && (
              <div style={defStyle}>
                {g.axis === 'case'
                  ? 'No parameter cases offered (the project has none, or the source is a fleet).'
                  : 'No sharing choices offered (tick "Sharing sensitivity" to add them).'}
              </div>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="ghost" onClick={onCancel} data-testid="aesa-case-cancel">Cancel</Button>
          <Button variant="primary" onClick={() => onRun(picked)} data-testid="aesa-case-run">
            Run {nCases} case{nCases === 1 ? '' : 's'} × {nSharing} sharing
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
