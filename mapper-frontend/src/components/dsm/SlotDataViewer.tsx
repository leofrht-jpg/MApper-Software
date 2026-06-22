/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { Download, X } from 'lucide-react'
import { Button } from '../ui/Button'
import type { DSMScenario } from '../../api/client'

export type SlotKey =
  | 'initial_stock'
  | 'inflows'
  | 'outflows'
  | 'stock_targets'
  | 'mode_configs'

export const SLOT_LABELS: Record<SlotKey, string> = {
  initial_stock: 'Initial stock',
  inflows: 'Inflows',
  outflows: 'Outflows',
  stock_targets: 'Stock targets',
  mode_configs: 'Mode configs',
}

export interface FlatTable {
  columns: string[]
  rows: Record<string, unknown>[]
}

export function flattenSlot(slot: SlotKey, data: unknown): FlatTable {
  if (data == null) return { columns: [], rows: [] }
  if (slot === 'initial_stock') {
    const rows = Object.entries(data as Record<string, number>).map(([cohort, count]) => ({
      cohort,
      count,
    }))
    return { columns: ['cohort', 'count'], rows }
  }
  if (slot === 'inflows' || slot === 'stock_targets' || slot === 'outflows') {
    const arr = data as Array<{ year: number; counts?: Record<string, number> }>
    const cohorts = new Set<string>()
    arr.forEach((d) => Object.keys(d.counts ?? {}).forEach((c) => cohorts.add(c)))
    const cohortCols = Array.from(cohorts).sort()
    const cols = ['year', ...cohortCols]
    const rows = arr.map((d) => {
      const r: Record<string, unknown> = { year: d.year }
      cohortCols.forEach((c) => {
        r[c] = d.counts?.[c] ?? ''
      })
      return r
    })
    return { columns: cols, rows }
  }
  if (slot === 'mode_configs') {
    const arr = data as Array<{ dimension_filters: Record<string, string>; mode: string }>
    const rows = arr.map((d) => ({
      filters:
        Object.entries(d.dimension_filters || {})
          .map(([k, v]) => `${k}=${v}`)
          .join(', ') || '* (all)',
      mode: d.mode,
    }))
    return { columns: ['filters', 'mode'], rows }
  }
  return { columns: [], rows: [] }
}

export function downloadSlotCSV(
  filename: string,
  columns: string[],
  rows: Record<string, unknown>[],
) {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => escape(r[c])).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

interface SlotDataViewerProps {
  scenario: DSMScenario
  baseScenario: DSMScenario | null
  slotKey: SlotKey
  onClose: () => void
}

export function SlotDataViewer({ scenario, baseScenario, slotKey, onClose }: SlotDataViewerProps) {
  const own = scenario[slotKey]
  const owned = own !== null && own !== undefined
  const isInherited = !owned && !scenario.is_base
  const sourceScenario = isInherited ? baseScenario : scenario
  const data = sourceScenario ? sourceScenario[slotKey] : null
  const flat = flattenSlot(slotKey, data)
  const previewRows = flat.rows.slice(0, 10)
  const remaining = Math.max(0, flat.rows.length - previewRows.length)
  const updatedAt = sourceScenario?.updated_at
    ? new Date(sourceScenario.updated_at).toLocaleString()
    : '—'

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-5)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 100%)', maxHeight: '80vh',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {SLOT_LABELS[slotKey]} — {scenario.name}
            </h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
              {isInherited
                ? `Inherited from ${baseScenario?.name ?? 'Base'}`
                : scenario.is_base ? 'Base scenario data' : 'Owned by this scenario'}
              {' · '}{flat.rows.length} row{flat.rows.length === 1 ? '' : 's'}
              {' · last modified '}{updatedAt}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            aria-label="Close"
          ><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4) var(--space-5)' }}>
          {flat.rows.length === 0 ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              No data in this slot.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
              <thead>
                <tr>
                  {flat.columns.map((c) => (
                    <th key={c} style={{
                      padding: '6px 8px', textAlign: 'left',
                      fontSize: 10, fontWeight: 600,
                      color: 'var(--text-tertiary)', textTransform: 'uppercase',
                      letterSpacing: 'var(--tracking-wide)',
                      borderBottom: '1px solid var(--border-subtle)',
                      position: 'sticky', top: 0, background: 'var(--bg-surface)',
                    }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    {flat.columns.map((c) => (
                      <td key={c} style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>
                        {r[c] === '' || r[c] === null || r[c] === undefined
                          ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                          : String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {remaining > 0 && (
            <div style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-tertiary)',
            }}>
              Showing first 10 of {flat.rows.length} rows. Download CSV for the full data.
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: 'var(--space-4) var(--space-5)',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <Button
            variant="ghost"
            onClick={() => downloadSlotCSV(
              `${scenario.name.replace(/\s+/g, '_')}__${slotKey}.csv`,
              flat.columns,
              flat.rows,
            )}
            disabled={flat.rows.length === 0}
          >
            <Download size={13} strokeWidth={1.6} /> Download CSV
          </Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}
