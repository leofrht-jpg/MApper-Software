/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useState } from 'react'
import { X, TrendingDown, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { NumberInput } from '../ui/NumberInput'
import type { Archetype } from '../../api/client'

interface BulkLearningRateModalProps {
  archetype: Archetype
  onApply: (learningRate: number | null, baseYear: number, nodeIds: string[] | null) => Promise<void>
  onClose: () => void
}

interface MaterialRow {
  nodeId: string
  name: string
  path: string
  quantity: number
  unit: string
  currentMethod: string
}

function collectMaterials(nodes: Archetype['bom'], path: string[] = []): MaterialRow[] {
  const out: MaterialRow[] = []
  for (const n of nodes) {
    if (n.node_type === 'material') {
      out.push({
        nodeId: n.id ?? '',
        name: n.name,
        path: path.join(' › '),
        quantity: n.quantity,
        unit: n.unit,
        currentMethod: n.evolution?.method ?? 'fixed',
      })
    } else if (n.children) {
      out.push(...collectMaterials(n.children, [...path, n.name]))
    }
  }
  return out
}

export function BulkLearningRateModal({ archetype, onApply, onClose }: BulkLearningRateModalProps) {
  const materials = useMemo(() => collectMaterials(archetype.bom), [archetype])
  const [learningRate, setLearningRate] = useState(-0.02)
  const [baseYear, setBaseYear] = useState(2025)
  const [applyTo, setApplyTo] = useState<'all' | 'selection'>('all')
  const [mode, setMode] = useState<'apply' | 'reset'>('apply')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleApply = async () => {
    const ids = applyTo === 'selection' ? Array.from(selected) : null
    if (applyTo === 'selection' && !selected.size) {
      alert('Select at least one material or switch to "All materials".')
      return
    }
    setSubmitting(true)
    try {
      await onApply(mode === 'reset' ? null : learningRate, baseYear, ids)
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 220 }}
    >
      <div style={{ width: 720, maxHeight: '90vh', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TrendingDown size={18} strokeWidth={1.5} style={{ color: 'var(--mod-plca)' }} />
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {mode === 'reset' ? 'Reset materials to fixed' : 'Set learning rates'}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', gap: 14, fontSize: 'var(--text-sm)' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" checked={mode === 'apply'} onChange={() => setMode('apply')} /> Apply learning rate
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" checked={mode === 'reset'} onChange={() => setMode('reset')} /> Reset to fixed (clear evolution)
            </label>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 'var(--text-sm)', opacity: mode === 'apply' ? 1 : 0.4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Annual change (%)
              <NumberInput
                value={Number((learningRate * 100).toFixed(4))}
                onChange={(v) => setLearningRate(v / 100)}
                allowNegative
                disabled={mode !== 'apply'}
                style={inputS}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Base year
              <NumberInput
                value={baseYear}
                onChange={setBaseYear}
                integerOnly
                emptyValue={2025}
                disabled={mode !== 'apply'}
                style={inputS}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 14, fontSize: 'var(--text-sm)' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" checked={applyTo === 'all'} onChange={() => setApplyTo('all')} /> All materials ({materials.length})
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" checked={applyTo === 'selection'} onChange={() => setApplyTo('selection')} /> Selected only ({selected.size})
            </label>
          </div>

          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', maxHeight: 280, overflow: 'auto', opacity: applyTo === 'selection' ? 1 : 0.55 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-elevated)' }}>
                  <th style={th}></th>
                  <th style={th}>Material</th>
                  <th style={th}>Path</th>
                  <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                  <th style={th}>Current</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={m.nodeId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ ...td, width: 32 }}>
                      <input
                        type="checkbox"
                        checked={selected.has(m.nodeId)}
                        onChange={() => toggle(m.nodeId)}
                        disabled={applyTo !== 'selection'}
                      />
                    </td>
                    <td style={td}>{m.name}</td>
                    <td style={{ ...td, color: 'var(--text-tertiary)' }}>{m.path || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{m.quantity} {m.unit}</td>
                    <td style={{ ...td, color: m.currentMethod === 'fixed' ? 'var(--text-tertiary)' : 'var(--mod-plca)' }}>{m.currentMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ padding: 'var(--space-3) var(--space-6)', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleApply} disabled={submitting} style={{ backgroundColor: 'var(--mod-plca)' }}>
            {submitting ? <Loader2 size={13} className="plca-spin" /> : mode === 'reset' ? <RotateCcw size={13} /> : <TrendingDown size={13} />}
            {' '}{mode === 'reset' ? 'Reset' : 'Apply'}
          </Button>
        </div>
      </div>
      <style>{`@keyframes plca-spin { to { transform: rotate(360deg) } } .plca-spin { animation: plca-spin 1s linear infinite }`}</style>
    </div>
  )
}

const inputS: React.CSSProperties = {
  marginLeft: 6,
  width: 96,
  height: 26,
  padding: '0 6px',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }
const td: React.CSSProperties = { padding: '6px 8px' }
