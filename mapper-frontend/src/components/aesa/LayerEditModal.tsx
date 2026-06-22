/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'
import type { DownscalingLayer, LayerData, PrincipleDefinition, PrincipleMode } from '../../api/client'

interface Props {
  layer: DownscalingLayer
  principles: PrincipleDefinition[]
  readOnly?: boolean
  onClose: () => void
  onSave: (patch: Partial<DownscalingLayer>) => void
}

/** Modal to edit one DownscalingLayer. Shows name / description / mode, a
 *  fixed-principle selector (when mode = 'fixed'), and a per-principle data
 *  table. Each principle card supports a constant pair or a year × value
 *  time-varying table. */
export function LayerEditModal({ layer, principles, readOnly, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<DownscalingLayer>(layer)

  useEffect(() => setDraft(layer), [layer])

  const handleModeChange = (mode: PrincipleMode) => {
    setDraft((d) => ({
      ...d,
      principle_mode: mode,
      fixed_principle: mode === 'fixed'
        ? (d.fixed_principle ?? principles[0]?.id ?? null)
        : null,
    }))
  }

  const handleDataChange = (principleId: string, years: Record<number, [number, number]>) => {
    setDraft((d) => {
      const nextData: LayerData = { ...d.data }
      if (Object.keys(years).length === 0) delete nextData[principleId]
      else nextData[principleId] = years
      return { ...d, data: nextData }
    })
  }

  const handleSave = () => { onSave(draft); onClose() }

  // Principles actually relevant for the data editor:
  //   - fixed mode: only the chosen principle
  //   - category_specific: all principles in the preset
  const relevantPrinciples = useMemo(() => {
    if (draft.principle_mode === 'fixed' && draft.fixed_principle) {
      return principles.filter((p) => p.id === draft.fixed_principle)
    }
    return principles
  }, [draft.principle_mode, draft.fixed_principle, principles])

  return (
    <div
      style={backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={modal}>
        <header style={header}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              Edit Layer {draft.layer_number}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Principle data at this downscaling step.
            </div>
          </div>
          <button onClick={onClose} style={iconBtn} title="Close"><X size={16} /></button>
        </header>

        <div style={body}>
          {/* Basics */}
          <FieldRow label="Name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              disabled={readOnly}
              style={input}
            />
          </FieldRow>

          <FieldRow label="Description">
            <input
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              disabled={readOnly}
              placeholder="What does this layer downscale? e.g. Global → Country"
              style={input}
            />
          </FieldRow>

          <FieldRow label="Mode">
            <div style={{ display: 'flex', gap: 6 }}>
              <ModeOption
                active={draft.principle_mode === 'category_specific'}
                disabled={readOnly}
                onClick={() => handleModeChange('category_specific')}
                title="Each impact category uses its own principle (per-category assignment)"
              >
                Category-specific
              </ModeOption>
              <ModeOption
                active={draft.principle_mode === 'fixed'}
                disabled={readOnly}
                onClick={() => handleModeChange('fixed')}
                title="All categories use the same principle at this layer"
              >
                Fixed
              </ModeOption>
            </div>
          </FieldRow>

          {draft.principle_mode === 'fixed' && (
            <FieldRow label="Fixed principle">
              <select
                value={draft.fixed_principle ?? ''}
                onChange={(e) => setDraft({ ...draft, fixed_principle: e.target.value })}
                disabled={readOnly}
                style={input}
              >
                {principles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                ))}
              </select>
            </FieldRow>
          )}

          {/* Per-principle data */}
          <section style={{ marginTop: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 6,
            }}>
              Principle data
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              Factor = system ÷ global. Use year 0 for a constant value.
              {draft.principle_mode === 'category_specific'
                ? ' All principles used by any assignment need data here.'
                : ' Only the fixed principle is used.'}
            </div>
            {relevantPrinciples.length === 0 && (
              <div style={emptyBox}>No principles defined yet. Add them in the preset editor first.</div>
            )}
            {relevantPrinciples.map((p) => (
              <PrincipleDataCard
                key={p.id}
                principle={p}
                years={draft.data[p.id] ?? {}}
                readOnly={readOnly}
                onChange={(years) => handleDataChange(p.id, years)}
              />
            ))}
          </section>
        </div>

        <footer style={footer}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={readOnly}>Apply</Button>
        </footer>
      </div>
    </div>
  )
}

// ── PrincipleDataCard ────────────────────────────────────────────────────────

function PrincipleDataCard({
  principle, years, readOnly, onChange,
}: {
  principle: PrincipleDefinition
  years: Record<number, [number, number]>
  readOnly?: boolean
  onChange: (years: Record<number, [number, number]>) => void
}) {
  const entries = Object.entries(years)
    .map(([y, v]) => [Number(y), v] as [number, [number, number]])
    .sort((a, b) => a[0] - b[0])

  const isConstant = entries.length <= 1
  const [expanded, setExpanded] = useState(!isConstant)
  const [timeVarying, setTimeVarying] = useState(!isConstant)

  const constPair = entries[0]?.[1] ?? [0, 0]

  const updateConst = (sys: number, glob: number) => {
    // Store as year 0 for a "constant" series (matches backend _resolve_year).
    onChange({ 0: [sys, glob] })
  }

  const setYear = (year: number, pair: [number, number]) => {
    onChange({ ...years, [year]: pair })
  }
  const deleteYear = (year: number) => {
    const next = { ...years }
    delete next[year]
    onChange(next)
  }
  const addYear = () => {
    const latest = entries[entries.length - 1]?.[0] ?? new Date().getFullYear()
    const y = latest + 1
    if (years[y]) return
    onChange({ ...years, [y]: constPair })
  }

  const factor = constPair[1] > 0 ? constPair[0] / constPair[1] : 0

  return (
    <div style={card}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          background: 'transparent', border: 'none', padding: 0,
          color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={{ fontSize: 11, fontWeight: 600 }}>{principle.name}</span>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>({principle.id})</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>
          {isConstant ? `constant · factor ${(factor * 100).toPrecision(4)}%` : `${entries.length} years`}
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={timeVarying}
              disabled={readOnly}
              onChange={(e) => {
                setTimeVarying(e.target.checked)
                if (!e.target.checked) {
                  // Collapse the series back to a single "year 0 = constant" entry.
                  onChange({ 0: constPair })
                }
              }}
            />
            Time-varying
          </label>

          {!timeVarying && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <NumField
                label="System"
                value={constPair[0]}
                disabled={readOnly}
                onChange={(v) => updateConst(v, constPair[1])}
              />
              <NumField
                label="Global"
                value={constPair[1]}
                disabled={readOnly}
                onChange={(v) => updateConst(constPair[0], v)}
              />
            </div>
          )}

          {timeVarying && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr 1fr 24px',
                gap: 4, fontSize: 10, color: 'var(--text-tertiary)', padding: '0 4px',
              }}>
                <span>Year</span><span>System</span><span>Global</span><span />
              </div>
              {entries.map(([y, pair]) => (
                <div
                  key={y}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 1fr 1fr 24px',
                    gap: 4, alignItems: 'center',
                  }}
                >
                  <input
                    type="number"
                    value={y}
                    disabled={readOnly}
                    onChange={(e) => {
                      const newY = Number(e.target.value)
                      if (newY === y) return
                      const next = { ...years }
                      delete next[y]
                      next[newY] = pair
                      onChange(next)
                    }}
                    style={miniInput}
                  />
                  <input
                    type="number"
                    value={pair[0]}
                    disabled={readOnly}
                    onChange={(e) => setYear(y, [Number(e.target.value), pair[1]])}
                    style={miniInput}
                  />
                  <input
                    type="number"
                    value={pair[1]}
                    disabled={readOnly}
                    onChange={(e) => setYear(y, [pair[0], Number(e.target.value)])}
                    style={miniInput}
                  />
                  <button
                    onClick={() => deleteYear(y)}
                    disabled={readOnly}
                    style={{
                      ...iconBtn, width: 20, height: 20,
                      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                    }}
                    title="Remove year"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
              <button
                onClick={addYear}
                disabled={readOnly}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  alignSelf: 'flex-start',
                  background: 'transparent',
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                  padding: '3px 8px', fontSize: 10, cursor: readOnly ? 'not-allowed' : 'pointer',
                }}
              >
                <Plus size={10} /> Add year
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Primitives ──────────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
      <span style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
      }}>{label}</span>
      {children}
    </div>
  )
}

function ModeOption({
  active, disabled, onClick, title, children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        flex: 1, padding: '6px 8px', fontSize: 11,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: active ? 'color-mix(in srgb, var(--mod-aesa) 12%, transparent)' : 'var(--bg-elevated)',
        border: `1px solid ${active ? 'var(--mod-aesa)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function NumField({
  label, value, onChange, disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</span>
      <input
        type="number"
        step="any"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...input, height: 24, padding: '3px 6px', fontSize: 11 }}
      />
    </label>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000,
}

const modal: React.CSSProperties = {
  width: 'min(560px, 92vw)',
  maxHeight: '88vh',
  display: 'flex', flexDirection: 'column',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
}

const header: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: '12px 14px',
  borderBottom: '1px solid var(--border-subtle)',
}

const body: React.CSSProperties = {
  flex: 1, overflow: 'auto',
  padding: '12px 14px',
}

const footer: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 8,
  padding: '10px 14px',
  borderTop: '1px solid var(--border-subtle)',
}

const input: React.CSSProperties = {
  width: '100%', height: 28,
  padding: '4px 8px', fontSize: 11,
  color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none', fontFamily: 'inherit',
}

const miniInput: React.CSSProperties = {
  ...input, height: 22, padding: '2px 5px', fontSize: 10,
}

const card: React.CSSProperties = {
  padding: 8,
  marginBottom: 6,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
}

const emptyBox: React.CSSProperties = {
  padding: 10, fontSize: 11, color: 'var(--text-tertiary)',
  border: '1px dashed var(--border-subtle)',
  borderRadius: 'var(--radius-sm)', textAlign: 'center',
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none',
  color: 'var(--text-secondary)', cursor: 'pointer', padding: 0,
}
