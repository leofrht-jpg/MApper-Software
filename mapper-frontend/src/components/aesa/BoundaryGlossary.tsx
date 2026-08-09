/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '../ui/Button'
import type { BoundarySet } from '../../api/client'

/**
 * What the abbreviated axis labels mean, read from the ACTIVE boundary set.
 *
 * Populated entirely from the boundary records — the same objects the charts
 * label themselves from — so the glossary cannot drift from what is on screen.
 * A second hand-written table is exactly the failure this codebase keeps
 * finding (four copies of the year resolver, four of the budget arithmetic),
 * and a glossary that disagrees with the chart is worse than none.
 *
 * The "commonly written" column is INFORMATIONAL. Those abbreviations (AP,
 * HTP-c, ODP…) come from CML/ILCD convention, not from EF: Zampori & Pant
 * (2019), EUR 29682 EN, Table 2 defines category names, indicators and units
 * and no per-category acronyms. MApper therefore never uses them as a label —
 * showing one would assert a naming EF does not define — but an LCA reader
 * recognises them instantly, so they are offered here as a cross-reference.
 */
export function BoundaryGlossary({
  boundarySet, onClose,
}: {
  boundarySet: BoundarySet | null
  onClose: () => void
}) {
  const rows = Object.values(boundarySet?.boundaries ?? {})

  // Portalled: the AESA sidebar is `position: sticky`, which creates a stacking
  // context that traps a modal rendered inside it (Patch 4X).
  return createPortal(
    <div
      data-testid="boundary-glossary"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)', maxWidth: 940, width: '100%',
        maxHeight: '86vh', display: 'flex', flexDirection: 'column',
      }}>
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              Impact categories
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {boundarySet?.name ?? '—'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close glossary"
            title="Close glossary"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', display: 'flex', padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </header>

        <div style={{ overflow: 'auto', padding: '8px 16px 16px' }}>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Charts label each axis with the EF v3.1 category name. EF defines no
            per-category acronyms, so MApper does not use any — the
            “commonly written” column lists the abbreviations you may see in the
            LCA literature (CML / ILCD convention), for cross-reference only.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
                <th style={th}>Category (EF v3.1)</th>
                <th style={th}>Commonly written</th>
                <th style={th}>EF indicator</th>
                <th style={th}>Unit</th>
                <th style={th}>Planetary boundary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} data-testid={`glossary-row-${b.id}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ ...td, color: 'var(--text-primary)' }}>{b.short_name || b.name}</td>
                  <td style={{ ...td, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {b.conventional_acronym ?? '—'}
                  </td>
                  <td style={td}>{b.ef_indicator ?? '—'}</td>
                  <td style={td}>{b.unit}</td>
                  <td style={td}>
                    {b.control_variable}
                    {b.pb_value != null && (
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {' '}· SOS {b.pb_value.toPrecision(3)} {b.unit}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '12px 0' }}>
              No boundary set loaded.
            </div>
          )}
        </div>

        <footer style={{
          padding: '10px 16px', borderTop: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 8px', color: 'var(--text-secondary)', verticalAlign: 'top' }
