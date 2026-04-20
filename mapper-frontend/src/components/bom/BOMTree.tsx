import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, Circle, Plus, Trash2, Link as LinkIcon, Pencil, TrendingDown, TrendingUp, Minus, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EcoinventLinker } from './EcoinventLinker'
import type { BOMNode, EcoinventLink, MaterialEvolution, QuantityMilestone } from '../../api/client'

const UNIT_OPTIONS = ['kg', 'g', 't', 'piece', 'm', 'm2', 'm3', 'l', 'kWh', 'MJ']

interface BOMTreeProps {
  node: BOMNode
  depth?: number
  isRoot?: boolean
  onPatch: (nodeId: string, patch: { name?: string; quantity?: number; unit?: string; is_annual?: boolean; ecoinvent_activity?: EcoinventLink | null; evolution?: MaterialEvolution | null }) => Promise<void>
  onAddChild: (parentId: string, child: BOMNode) => Promise<void>
  onDelete: (nodeId: string) => Promise<void>
}

function projectLR(base: number, rate: number, baseYear: number, year: number): number {
  return base * Math.pow(1 + rate, year - baseYear)
}

function evolutionSummary(ev: MaterialEvolution | null | undefined): string {
  if (!ev || ev.method === 'fixed') return 'Fixed'
  if (ev.method === 'learning_rate') {
    const r = ev.learning_rate ?? 0
    return `${(r * 100).toFixed(1)}%/yr LR (from ${ev.base_year})`
  }
  if (ev.method === 'rebound_effect') {
    const r = ev.rebound_rate ?? 0
    const sign = r >= 0 ? '+' : ''
    return `${sign}${(r * 100).toFixed(1)}%/yr rebound (from ${ev.base_year})`
  }
  if (ev.method === 'milestones' && ev.milestones && ev.milestones.length > 0) {
    const ms = [...ev.milestones].sort((a, b) => a.year - b.year)
    return `${ms.length} milestones (${ms[0].year}→${ms[ms.length - 1].year})`
  }
  return 'Evolving'
}

export function BOMTree({ node, depth = 0, isRoot = false, onPatch, onAddChild, onDelete }: BOMTreeProps) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: node.name, quantity: node.quantity, unit: node.unit })
  const [linkerOpen, setLinkerOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [evolutionOpen, setEvolutionOpen] = useState(false)

  const isComponent = node.node_type === 'component'
  const hasChildren = (node.children?.length ?? 0) > 0
  const linked = node.ecoinvent_activity
  const nodeId = node.id ?? ''

  const beginEdit = () => {
    setDraft({ name: node.name, quantity: node.quantity, unit: node.unit })
    setEditing(true)
  }

  const saveEdit = async () => {
    const patch: { name?: string; quantity?: number; unit?: string } = {}
    if (draft.name !== node.name) patch.name = draft.name
    if (draft.quantity !== node.quantity) patch.quantity = Number(draft.quantity)
    if (draft.unit !== node.unit) patch.unit = draft.unit
    if (Object.keys(patch).length > 0) await onPatch(nodeId, patch)
    setEditing(false)
  }

  const cancelEdit = () => setEditing(false)

  const addComponent = async () => {
    await onAddChild(nodeId, {
      name: 'New component',
      node_type: 'component',
      quantity: 1,
      unit: 'piece',
      children: [],
    })
    setExpanded(true)
  }

  const addMaterial = async () => {
    await onAddChild(nodeId, {
      name: 'New material',
      node_type: 'material',
      quantity: 1,
      unit: 'kg',
    })
    setExpanded(true)
  }

  const handlePickActivity = async (link: EcoinventLink) => {
    await onPatch(nodeId, { ecoinvent_activity: link })
  }

  const clearActivity = async () => {
    await onPatch(nodeId, { ecoinvent_activity: null })
  }

  const indent = depth * 24

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          paddingLeft: 10 + indent,
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: hovered ? 'var(--bg-hover)' : 'transparent',
          minHeight: 40,
        }}
      >
        {/* Expand chevron / leaf icon */}
        <button
          onClick={() => isComponent && setExpanded(!expanded)}
          disabled={!isComponent}
          style={{
            width: 18, height: 18, padding: 0, background: 'none', border: 'none',
            cursor: isComponent ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', flexShrink: 0,
          }}
        >
          {isComponent
            ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
            : <Circle size={8} fill="var(--mod-lca)" color="var(--mod-lca)" />}
        </button>

        {/* Name + qty + unit */}
        {editing ? (
          <>
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
              style={{
                flex: 1, height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none', minWidth: 120,
              }}
            />
            <input
              type="number"
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}
              step="any"
              min="0"
              style={{
                width: 80, height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', outline: 'none',
              }}
            />
            <select
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              style={{
                height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none',
              }}
            >
              {UNIT_OPTIONS.includes(draft.unit) ? null : <option value={draft.unit}>{draft.unit}</option>}
              {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <Button variant="primary" onClick={saveEdit} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', backgroundColor: 'var(--mod-lca)' }}>Save</Button>
            <Button variant="ghost" onClick={cancelEdit} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)' }}>Cancel</Button>
          </>
        ) : (
          <>
            <span
              onClick={beginEdit}
              style={{
                fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: isComponent ? 500 : 400,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {node.name}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              {node.quantity} {node.unit}
            </span>
            {isComponent && (node.children?.length ?? 0) > 0 && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                · {node.children!.length} {node.children!.length === 1 ? 'component' : 'components'}
              </span>
            )}

            {/* Annual toggle (root stage nodes only) */}
            {isRoot && isComponent && (
              <button
                onClick={() => onPatch(nodeId, { is_annual: !node.is_annual })}
                title={node.is_annual ? 'Annual quantities (per year) — click to set as one-time' : 'One-time quantities — click to set as annual'}
                style={{
                  background: node.is_annual
                    ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                    : 'transparent',
                  border: `1px solid ${node.is_annual ? 'var(--accent)' : 'var(--border-default)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  color: node.is_annual ? 'var(--accent)' : 'var(--text-tertiary)',
                  padding: '2px 6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 9,
                  fontWeight: 600,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.05em',
                }}
              >
                {node.is_annual ? 'ANNUAL' : 'ONE-TIME'}
              </button>
            )}

            {/* Evolution badge (materials only) */}
            {!isComponent && (() => {
              const ev = node.evolution
              const isRebound = ev?.method === 'rebound_effect'
              const active = !!ev && ev.method !== 'fixed'
              const accent = isRebound ? 'var(--warning)' : 'var(--mod-plca)'
              return (
                <button
                  onClick={() => setEvolutionOpen((v) => !v)}
                  title={`Quantity evolution — ${evolutionSummary(ev)}`}
                  style={{
                    background: active
                      ? `color-mix(in srgb, ${accent} 15%, transparent)`
                      : 'transparent',
                    border: `1px solid ${active ? accent : 'var(--border-default)'}`,
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    color: active ? accent : 'var(--text-tertiary)',
                    padding: '2px 6px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  {(() => {
                    const r = ev?.learning_rate ?? 0
                    if (ev?.method === 'rebound_effect') return <TrendingUp size={11} />
                    if (ev?.method === 'learning_rate' && r < 0) return <TrendingDown size={11} />
                    if (ev?.method === 'learning_rate' && r > 0) return <TrendingUp size={11} />
                    if (ev?.method === 'milestones') return <TrendingDown size={11} />
                    return <Minus size={11} />
                  })()}
                  <span>{evolutionSummary(ev)}</span>
                </button>
              )
            })()}

            {/* Ecoinvent link section (materials only) */}
            {!isComponent && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                {linked ? (
                  <>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {linked.name}
                    </span>
                    {linked.location && <Badge label={linked.location} />}
                    <Badge label={linked.database} variant="lca" />
                    <button
                      onClick={() => setLinkerOpen(true)}
                      title="Change linked activity"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={clearActivity}
                      title="Unlink"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => setLinkerOpen(true)}
                    style={{ height: 26, padding: '0 10px', fontSize: 'var(--text-xs)', borderColor: 'var(--warning)', color: 'var(--warning)' }}
                  >
                    <LinkIcon size={12} />
                    Link to ecoinvent
                  </Button>
                )}
              </div>
            )}

            {/* Action buttons (right side, components push these to far right) */}
            <div style={{ display: 'flex', gap: 4, marginLeft: isComponent ? 'auto' : 8, opacity: hovered ? 1 : 0, transition: 'opacity var(--duration-fast) var(--ease-out)' }}>
              {isComponent && (
                <>
                  <button
                    onClick={addComponent}
                    title="Add sub-component"
                    style={{ background: 'none', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--text-xs)' }}
                  >
                    <Plus size={11} /> Component
                  </button>
                  <button
                    onClick={addMaterial}
                    title="Add material"
                    style={{ background: 'none', border: `1px solid var(--mod-lca)`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--mod-lca)', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--text-xs)' }}
                  >
                    <Plus size={11} /> Material
                  </button>
                </>
              )}
              {!isRoot && (
                <button
                  onClick={() => onDelete(nodeId)}
                  title="Delete node"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4 }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Evolution editor panel (materials only) */}
      {!isComponent && evolutionOpen && (
        <EvolutionPanel
          node={node}
          depth={depth}
          onSave={(ev) => onPatch(nodeId, { evolution: ev })}
          onClose={() => setEvolutionOpen(false)}
        />
      )}

      {/* Children */}
      {isComponent && expanded && hasChildren && (
        <>
          {node.children!.map((child, idx) => (
            <BOMTree
              key={child.id ?? `${idx}-${child.name}`}
              node={child}
              depth={depth + 1}
              onPatch={onPatch}
              onAddChild={onAddChild}
              onDelete={onDelete}
            />
          ))}
        </>
      )}

      {/* Empty state for empty component */}
      {isComponent && expanded && !hasChildren && (
        <div style={{
          padding: '6px 10px',
          paddingLeft: 10 + indent + 28,
          fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          No children. Add a component or material above.
        </div>
      )}

      {/* Ecoinvent linker modal */}
      {linkerOpen && (
        <EcoinventLinker
          current={linked ?? null}
          onClose={() => setLinkerOpen(false)}
          onPick={handlePickActivity}
        />
      )}
    </>
  )
}


// ── Evolution panel ──────────────────────────────────────────────────────────
// Rendered inline below a material row. Lets the user pick method = fixed |
// learning_rate | milestones and shows a live projection of the per-unit qty
// across a reference horizon (2025 → 2050, step 5).

const PREVIEW_YEARS = [2025, 2030, 2035, 2040, 2045, 2050]

function EvolutionPanel({
  node, depth, onSave, onClose,
}: {
  node: BOMNode
  depth: number
  onSave: (ev: MaterialEvolution | null) => Promise<void>
  onClose: () => void
}) {
  const initial = node.evolution
  const [method, setMethod] = useState<'fixed' | 'learning_rate' | 'rebound_effect' | 'milestones'>(
    initial?.method ?? 'fixed',
  )
  const [learningRate, setLearningRate] = useState<number>(initial?.learning_rate ?? -0.02)
  const [reboundRate, setReboundRate] = useState<number>(initial?.rebound_rate ?? 0.02)
  const [baseYear, setBaseYear] = useState<number>(initial?.base_year ?? 2025)
  const [milestones, setMilestones] = useState<QuantityMilestone[]>(
    initial?.milestones && initial.milestones.length > 0
      ? initial.milestones
      : [
          { year: 2025, quantity: node.quantity },
          { year: 2050, quantity: node.quantity * 0.5 },
        ],
  )

  const preview = useMemo(() => {
    return PREVIEW_YEARS.map((y) => {
      if (method === 'fixed') return { year: y, qty: node.quantity }
      if (method === 'learning_rate') {
        return { year: y, qty: projectLR(node.quantity, learningRate, baseYear, y) }
      }
      if (method === 'rebound_effect') {
        return { year: y, qty: projectLR(node.quantity, reboundRate, baseYear, y) }
      }
      const ms = [...milestones].sort((a, b) => a.year - b.year)
      if (ms.length === 0) return { year: y, qty: node.quantity }
      if (y <= ms[0].year) return { year: y, qty: ms[0].quantity }
      if (y >= ms[ms.length - 1].year) return { year: y, qty: ms[ms.length - 1].quantity }
      for (let i = 0; i < ms.length - 1; i++) {
        const a = ms[i]
        const b = ms[i + 1]
        if (y >= a.year && y <= b.year) {
          const t = (y - a.year) / (b.year - a.year)
          return { year: y, qty: a.quantity + t * (b.quantity - a.quantity) }
        }
      }
      return { year: y, qty: node.quantity }
    })
  }, [method, learningRate, reboundRate, baseYear, milestones, node.quantity])

  const handleSave = async () => {
    if (method === 'fixed') {
      await onSave(null)
    } else if (method === 'learning_rate') {
      await onSave({ method: 'learning_rate', learning_rate: learningRate, base_year: baseYear })
    } else if (method === 'rebound_effect') {
      await onSave({ method: 'rebound_effect', rebound_rate: reboundRate, base_year: baseYear })
    } else {
      if (milestones.length < 2) {
        alert('Milestones require at least two (year, value) pairs.')
        return
      }
      await onSave({ method: 'milestones', milestones: [...milestones].sort((a, b) => a.year - b.year), base_year: baseYear })
    }
    onClose()
  }

  const handleReset = async () => {
    if (!initial) { onClose(); return }
    await onSave(null)
    onClose()
  }

  const indent = depth * 24

  const updateMilestone = (idx: number, patch: Partial<QuantityMilestone>) => {
    setMilestones((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)))
  }
  const addMilestone = () => {
    const last = milestones[milestones.length - 1]
    setMilestones([...milestones, { year: (last?.year ?? 2025) + 5, quantity: last?.quantity ?? node.quantity }])
  }
  const removeMilestone = (idx: number) => {
    setMilestones((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)))
  }

  return (
    <div
      style={{
        paddingLeft: 10 + indent + 28,
        paddingRight: 'var(--space-5)',
        paddingTop: 'var(--space-3)',
        paddingBottom: 'var(--space-3)',
        backgroundColor: 'color-mix(in srgb, var(--mod-plca) 6%, transparent)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 'var(--text-xs)', flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text-primary)' }}>Quantity evolution</strong>
        {(['fixed', 'learning_rate', 'rebound_effect', 'milestones'] as const).map((m) => {
          const label =
            m === 'fixed' ? 'Fixed'
            : m === 'learning_rate' ? 'Learning rate'
            : m === 'rebound_effect' ? 'Rebound effect'
            : 'Milestones'
          return (
            <label key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input type="radio" checked={method === m} onChange={() => setMethod(m)} />
              {label}
            </label>
          )
        })}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {initial && initial.method !== 'fixed' && (
            <Button
              variant="ghost"
              onClick={handleReset}
              title="Clear evolution (back to fixed quantity)"
              style={{ height: 26, padding: '0 8px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <RotateCcw size={11} /> Reset to fixed
            </Button>
          )}
          <Button variant="primary" onClick={handleSave} style={{ height: 26, padding: '0 10px', fontSize: 'var(--text-xs)', backgroundColor: 'var(--mod-plca)' }}>Save</Button>
          <Button variant="ghost" onClick={onClose} style={{ height: 26, padding: '0 10px', fontSize: 'var(--text-xs)' }}>Cancel</Button>
        </span>
      </div>

      {method === 'learning_rate' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          <label>
            Annual change (%)
            <input
              type="number"
              value={(learningRate * 100).toFixed(2)}
              onChange={(e) => setLearningRate(Number(e.target.value) / 100)}
              step="0.1"
              style={{ marginLeft: 6, width: 80, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
            />
          </label>
          <label>
            Base year
            <input
              type="number"
              value={baseYear}
              onChange={(e) => setBaseYear(Math.round(Number(e.target.value)))}
              style={{ marginLeft: 6, width: 76, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
            />
          </label>
          <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            q(y) = {node.quantity} × (1 + r)^(y − {baseYear})
          </span>
        </div>
      )}

      {method === 'rebound_effect' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <label>
              Rebound rate
              <input
                type="number"
                value={(reboundRate * 100).toFixed(2)}
                onChange={(e) => setReboundRate(Number(e.target.value) / 100)}
                step="0.1"
                style={{ marginLeft: 6, width: 80, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
              />
              <span style={{ marginLeft: 4, color: 'var(--text-tertiary)' }}>% / year</span>
            </label>
            <label>
              Base year
              <input
                type="number"
                value={baseYear}
                onChange={(e) => setBaseYear(Math.round(Number(e.target.value)))}
                style={{ marginLeft: 6, width: 76, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
              />
            </label>
            <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              q(y) = {node.quantity} × (1 + r)^(y − {baseYear})
            </span>
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            Represents increased consumption from efficiency gains (rebound effect). Common on use-phase processes — vehicle use, appliance operation, lighting, heating.
          </span>
        </div>
      )}

      {method === 'milestones' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {milestones.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--text-xs)' }}>
              <input
                type="number"
                value={m.year}
                onChange={(e) => updateMilestone(i, { year: Math.round(Number(e.target.value)) })}
                style={{ width: 72, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
              />
              <input
                type="number"
                step="any"
                value={m.quantity}
                onChange={(e) => updateMilestone(i, { quantity: Number(e.target.value) })}
                style={{ width: 96, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
              />
              <span style={{ color: 'var(--text-tertiary)' }}>{node.unit}</span>
              <button
                onClick={() => removeMilestone(i)}
                disabled={milestones.length <= 2}
                title="Remove milestone"
                style={{ background: 'none', border: 'none', cursor: milestones.length <= 2 ? 'not-allowed' : 'pointer', color: 'var(--danger)', padding: 2, opacity: milestones.length <= 2 ? 0.3 : 1 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <Button variant="ghost" onClick={addMilestone} style={{ height: 24, padding: '0 8px', fontSize: 'var(--text-xs)', alignSelf: 'flex-start' }}>
            <Plus size={11} /> Add milestone
          </Button>
        </div>
      )}

      {/* Live preview — simple table showing per-unit qty at reference years */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Preview</span>
        {preview.map((p) => (
          <span key={p.year} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>{p.year}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {Math.abs(p.qty) >= 1000 ? p.qty.toExponential(2) : p.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
