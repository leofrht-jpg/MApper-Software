/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { useDSMStore } from '../../stores/dsmStore'
import { useParameterStore } from '../../stores/parameterStore'
import {
  BASE_SCENARIO,
  resolveParameterValue,
  type DSMScalingRule,
  type ScalingTarget,
} from '../../api/client'

interface ScalingRulesEditorProps {
  onClose: () => void
}

const APPLIES_TO_LABELS: Record<ScalingTarget, string> = {
  inflows: 'Inflows',
  stock_targets: 'Stock targets',
  outflows: 'Outflows (manual mode)',
}

const labelCol: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  display: 'block',
  marginBottom: 6,
}

function makeRuleId(): string {
  return `rule_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`
}

/** Very small expression probe for the preview column: supports the four
 *  arithmetic operators, parentheses, ``base``, ``year`` and user parameters.
 *  Anything else falls back to "—" (the server will validate on save). */
function previewValue(
  expression: string,
  base: number,
  year: number,
  params: Record<string, number>,
): number | null {
  const trimmed = expression.trim()
  if (!trimmed) return null
  const context = { base, year, ...params }
  try {
    // Reject anything that isn't [A-Za-z0-9_. +*/%()\-\s]
    if (!/^[A-Za-z0-9_.+\-*/%()\s]+$/.test(trimmed)) return null
    const keys = Object.keys(context)
    const values = keys.map((k) => context[k as keyof typeof context])
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(...keys, `return (${trimmed});`)
    const out = fn(...values)
    return typeof out === 'number' && Number.isFinite(out) ? out : null
  } catch {
    return null
  }
}

export function ScalingRulesEditor({ onClose }: ScalingRulesEditorProps) {
  const activeSystem = useDSMStore((s) => s.activeSystem)
  const scalingRules = useDSMStore((s) => s.scalingRules)
  const saveScalingRules = useDSMStore((s) => s.saveScalingRules)

  const table = useParameterStore((s) => s.table)
  const scenarios = useMemo<string[]>(
    () => [BASE_SCENARIO, ...(table?.scenarios ?? [])],
    [table],
  )

  const nonAgeDims = useMemo(
    () => (activeSystem?.dimensions ?? []).filter((d) => !d.is_age),
    [activeSystem],
  )

  const startYear = activeSystem?.time_horizon.start_year ?? new Date().getFullYear()

  const [rules, setRules] = useState<DSMScalingRule[]>(() =>
    scalingRules.map((r) => ({ ...r, dimension_filters: { ...r.dimension_filters } })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')

  const updateRule = (index: number, patch: Partial<DSMScalingRule>) => {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      {
        id: makeRuleId(),
        dimension_filters: {},
        applies_to: 'inflows',
        expression: 'base',
        description: null,
      },
    ])
  }

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      // Client-side dup-id check (server also enforces).
      const ids = new Set<string>()
      for (const r of rules) {
        if (!r.id.trim()) throw new Error('Rule id is required.')
        if (ids.has(r.id)) throw new Error(`Duplicate rule id: ${r.id}`)
        ids.add(r.id)
        if (!r.expression.trim()) throw new Error(`Rule "${r.id}" needs an expression.`)
      }
      await saveScalingRules(rules)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        width: 820,
        maxHeight: '92vh',
        overflow: 'auto',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{
          padding: 'var(--space-5) var(--space-6)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
              Scaling rules
            </h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4, maxWidth: 620 }}>
              Scale base DSM data (inflows, stock targets, or manual outflows) with parameter-driven
              expressions. Reserved variables: <code>base</code> (uploaded value), <code>year</code>.
              One rule per cohort — most-specific filter wins.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {rules.length === 0 && (
            <div style={{
              padding: 'var(--space-5)',
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-elevated)',
              fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textAlign: 'center',
            }}>
              No scaling rules yet. Base values will flow through unchanged.
            </div>
          )}

          {rules.map((rule, idx) => (
            <RuleCard
              key={rule.id + '-' + idx}
              rule={rule}
              nonAgeDims={nonAgeDims}
              parameters={table?.parameters ?? {}}
              scenarios={scenarios}
              startYear={startYear}
              previewAt={previewValue}
              onChange={(patch) => updateRule(idx, patch)}
              onRemove={() => removeRule(idx)}
            />
          ))}

          <Button variant="ghost" onClick={addRule}>
            <Plus size={14} strokeWidth={1.5} /> Add rule
          </Button>

          {error && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 'var(--space-2)' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving}
              style={{ backgroundColor: 'var(--mod-dsm)' }}
            >
              {saving ? 'Saving…' : 'Save rules'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Rule card ─────────────────────────────────────────────────────────────

interface RuleCardProps {
  rule: DSMScalingRule
  nonAgeDims: { name: string; display_name: string; labels: string[] }[]
  parameters: Record<string, { name: string; base_value: number; scenario_overrides?: Record<string, number> }>
  scenarios: string[]
  startYear: number
  previewAt: (expr: string, base: number, year: number, params: Record<string, number>) => number | null
  onChange: (patch: Partial<DSMScalingRule>) => void
  onRemove: () => void
}

function RuleCard({
  rule, nonAgeDims, parameters, scenarios, startYear, previewAt, onChange, onRemove,
}: RuleCardProps) {
  const filterEntries = Object.entries(rule.dimension_filters)
  const unusedDims = nonAgeDims.filter((d) => !(d.name in rule.dimension_filters))

  const setFilter = (dim: string, label: string) => {
    const next = { ...rule.dimension_filters, [dim]: label }
    onChange({ dimension_filters: next })
  }

  const removeFilter = (dim: string) => {
    const next = { ...rule.dimension_filters }
    delete next[dim]
    onChange({ dimension_filters: next })
  }

  // Resolve parameter values per scenario for preview.
  const previews = scenarios.map((scen) => {
    const paramValues: Record<string, number> = {}
    for (const p of Object.values(parameters)) {
      paramValues[p.name] = resolveParameterValue(
        p as Parameters<typeof resolveParameterValue>[0],
        scen === BASE_SCENARIO ? null : scen,
      )
    }
    const value = previewAt(rule.expression, 1, startYear, paramValues)
    return { scen, value }
  })

  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      backgroundColor: 'var(--bg-elevated)',
      padding: 'var(--space-4)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 32px', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
        <div>
          <label style={labelCol}>Rule id</label>
          <input
            type="text"
            value={rule.id}
            onChange={(e) => onChange({ id: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelCol}>Applies to</label>
          <select
            value={rule.applies_to}
            onChange={(e) => onChange({ applies_to: e.target.value as ScalingTarget })}
            style={inputStyle}
          >
            {(Object.keys(APPLIES_TO_LABELS) as ScalingTarget[]).map((k) => (
              <option key={k} value={k}>{APPLIES_TO_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <button
          onClick={onRemove}
          aria-label="Delete rule"
          style={{
            background: 'none', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            color: 'var(--text-tertiary)', width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div>
        <label style={labelCol}>Cohort filter</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {filterEntries.length === 0 && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Global — matches every cohort (unless a more specific rule wins).
            </span>
          )}
          {filterEntries.map(([dim, label]) => (
            <span
              key={dim}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 6px 2px 8px',
                backgroundColor: 'color-mix(in srgb, var(--mod-dsm) 15%, transparent)',
                border: '1px solid var(--mod-dsm)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)',
              }}
            >
              {nonAgeDims.find((d) => d.name === dim)?.display_name ?? dim} = {label}
              <button
                onClick={() => removeFilter(dim)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0, display: 'flex' }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {unusedDims.length > 0 && (
            <AddFilterPicker dims={unusedDims} onAdd={setFilter} />
          )}
        </div>
      </div>

      <div>
        <label style={labelCol}>Expression</label>
        <input
          type="text"
          value={rule.expression}
          onChange={(e) => onChange({ expression: e.target.value })}
          placeholder="base * adoption_rate"
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
        />
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
          Examples: <code>base * 1.5</code>, <code>base + flat_increment</code>,{' '}
          <code>base * (1 + (year - {startYear}) * ramp_rate)</code>.
        </p>
      </div>

      <div>
        <label style={labelCol}>
          Preview · base = 1 · year = {startYear}
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {previews.map(({ scen, value }) => (
            <div
              key={scen}
              style={{
                padding: '4px 10px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                display: 'flex', gap: 6, alignItems: 'baseline',
              }}
            >
              <span style={{ color: 'var(--text-tertiary)' }}>{scen}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                {value === null ? '—' : value.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label style={labelCol}>Description (optional)</label>
        <input
          type="text"
          value={rule.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value || null })}
          style={inputStyle}
          placeholder="Short label shown in exports"
        />
      </div>
    </div>
  )
}

function AddFilterPicker({
  dims, onAdd,
}: {
  dims: { name: string; display_name: string; labels: string[] }[]
  onAdd: (dim: string, label: string) => void
}) {
  const [pickedDim, setPickedDim] = useState<string>('')
  if (dims.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select
        value={pickedDim}
        onChange={(e) => setPickedDim(e.target.value)}
        style={{
          ...inputStyle,
          height: 26, fontSize: 'var(--text-xs)',
          width: 'auto', paddingRight: 20,
        }}
      >
        <option value="">+ filter…</option>
        {dims.map((d) => (
          <option key={d.name} value={d.name}>{d.display_name || d.name}</option>
        ))}
      </select>
      {pickedDim && (
        <select
          onChange={(e) => {
            if (e.target.value) {
              onAdd(pickedDim, e.target.value)
              setPickedDim('')
            }
          }}
          defaultValue=""
          style={{
            ...inputStyle,
            height: 26, fontSize: 'var(--text-xs)',
            width: 'auto', paddingRight: 20,
          }}
        >
          <option value="">pick label…</option>
          {dims.find((d) => d.name === pickedDim)?.labels.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '0 8px',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
}
