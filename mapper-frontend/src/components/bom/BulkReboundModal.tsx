import { useMemo, useState } from 'react'
import { X, TrendingUp, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { NumberInput } from '../ui/NumberInput'
import type { Archetype } from '../../api/client'

interface BulkReboundModalProps {
  archetype: Archetype
  onApply: (reboundRate: number | null, baseYear: number, nodeIds: string[] | null, appliesToStages: string[] | null) => Promise<void>
  onClose: () => void
}

interface MaterialRow {
  nodeId: string
  name: string
  stage: string
  path: string
  quantity: number
  unit: string
  currentMethod: string
}

function collectMaterials(nodes: Archetype['bom'], stage: string | null = null, path: string[] = []): MaterialRow[] {
  const out: MaterialRow[] = []
  for (const n of nodes) {
    const thisStage = stage ?? n.name
    if (n.node_type === 'material') {
      out.push({
        nodeId: n.id ?? '',
        name: n.name,
        stage: thisStage,
        path: path.join(' › '),
        quantity: n.quantity,
        unit: n.unit,
        currentMethod: n.evolution?.method ?? 'fixed',
      })
    } else if (n.children) {
      out.push(...collectMaterials(n.children, thisStage, [...path, n.name]))
    }
  }
  return out
}

export function BulkReboundModal({ archetype, onApply, onClose }: BulkReboundModalProps) {
  const materials = useMemo(() => collectMaterials(archetype.bom), [archetype])
  const stages = useMemo(() => Array.from(new Set(materials.map((m) => m.stage))).sort(), [materials])
  const [reboundRate, setReboundRate] = useState(0.02)
  const [baseYear, setBaseYear] = useState(2025)
  const [mode, setMode] = useState<'apply' | 'reset'>('apply')
  const [applyTo, setApplyTo] = useState<'all' | 'selection'>('all')
  const [stageFilter, setStageFilter] = useState<string>('__all__')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const filtered = useMemo(() => {
    if (stageFilter === '__all__') return materials
    return materials.filter((m) => m.stage === stageFilter)
  }, [materials, stageFilter])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleApply = async () => {
    let ids: string[] | null
    if (applyTo === 'selection') {
      ids = Array.from(selected)
      if (!ids.length) {
        alert('Select at least one material or switch to "All materials".')
        return
      }
    } else if (stageFilter !== '__all__') {
      ids = filtered.map((m) => m.nodeId)
      if (!ids.length) {
        alert(`No materials in stage "${stageFilter}".`)
        return
      }
    } else {
      ids = null
    }
    const stagesHint = stageFilter !== '__all__' ? [stageFilter] : null
    setSubmitting(true)
    try {
      await onApply(mode === 'reset' ? null : reboundRate, baseYear, ids, stagesHint)
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
      <div style={{ width: 760, maxHeight: '90vh', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TrendingUp size={18} strokeWidth={1.5} style={{ color: 'var(--warning)' }} />
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {mode === 'reset' ? 'Reset materials to fixed' : 'Set rebound effects'}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic', borderBottom: '1px solid var(--border-subtle)' }}>
          Rebound is common when efficiency improvements make a process cheaper or more convenient — users consume more.
          Applicable to use-phase processes (appliance operation, lighting, heating, transport, etc.).
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', gap: 14, fontSize: 'var(--text-sm)' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" checked={mode === 'apply'} onChange={() => setMode('apply')} /> Apply rebound rate
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" checked={mode === 'reset'} onChange={() => setMode('reset')} /> Reset to fixed (clear evolution)
            </label>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 'var(--text-sm)', opacity: mode === 'apply' ? 1 : 0.4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Rebound rate (%)
              <NumberInput
                value={Number((reboundRate * 100).toFixed(4))}
                onChange={(v) => setReboundRate(v / 100)}
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

          <div style={{ display: 'flex', gap: 12, fontSize: 'var(--text-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Stage filter
              <select
                value={stageFilter}
                onChange={(e) => { setStageFilter(e.target.value); setSelected(new Set()) }}
                style={{ height: 26, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
              >
                <option value="__all__">All stages</option>
                {stages.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" checked={applyTo === 'all'} onChange={() => setApplyTo('all')} /> All visible ({filtered.length})
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
                  <th style={th}>Stage</th>
                  <th style={th}>Path</th>
                  <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                  <th style={th}>Current</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
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
                    <td style={{ ...td, color: 'var(--text-tertiary)' }}>{m.stage}</td>
                    <td style={{ ...td, color: 'var(--text-tertiary)' }}>{m.path || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{m.quantity} {m.unit}</td>
                    <td style={{ ...td, color: m.currentMethod === 'fixed' ? 'var(--text-tertiary)' : m.currentMethod === 'rebound_effect' ? 'var(--warning)' : 'var(--mod-plca)' }}>{m.currentMethod}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: 'var(--space-3)' }}>No materials match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ padding: 'var(--space-3) var(--space-6)', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleApply} disabled={submitting} style={{ backgroundColor: 'var(--warning)' }}>
            {submitting ? <Loader2 size={13} className="rb-spin" /> : mode === 'reset' ? <RotateCcw size={13} /> : <TrendingUp size={13} />}
            {' '}{mode === 'reset' ? 'Reset' : 'Apply'}
          </Button>
        </div>
      </div>
      <style>{`@keyframes rb-spin { to { transform: rotate(360deg) } } .rb-spin { animation: rb-spin 1s linear infinite }`}</style>
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
