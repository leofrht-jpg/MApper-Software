/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, CheckCircle2, AlertCircle, ChevronRight, ChevronDown } from 'lucide-react'
import { Button } from '../ui/Button'
import { useSubsystemStore } from '../../stores/subsystemStore'
import { useDSMStore } from '../../stores/dsmStore'
import { useParameterStore } from '../../stores/parameterStore'
import type { DependencyRule, DimensionDef, Subsystem } from '../../api/client'

const BUILTIN_VARS = ['filtered_stock', 'total_primary_stock', 'year'] as const

const labelCol: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  display: 'block',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 34,
  padding: '0 10px',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
}

function cartesianArchetypes(dims: DimensionDef[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  if (nads.length === 0) return []
  let acc: string[][] = [[]]
  for (const d of nads) {
    const next: string[][] = []
    for (const row of acc) for (const l of d.labels) next.push([...row, l])
    acc = next
  }
  return acc.map((parts) => parts.join('|'))
}

interface DependencyRulesEditorProps {
  subsystem: Subsystem
}

export function DependencyRulesEditor({ subsystem }: DependencyRulesEditorProps) {
  const saveDependent = useSubsystemStore((s) => s.saveDependent)
  const validateRule = useSubsystemStore((s) => s.validateRule)
  const primaryDims = useDSMStore((s) => s.activeSystem?.dimensions ?? [])
  const parameters = useParameterStore((s) => s.activeSet?.parameters ?? [])

  const [rules, setRules] = useState<DependencyRule[]>(subsystem.dependency_rules)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')

  // Keep local rules in sync if subsystem identity changes.
  const lastSubId = useRef(subsystem.id)
  useEffect(() => {
    if (lastSubId.current !== subsystem.id) {
      setRules(subsystem.dependency_rules)
      lastSubId.current = subsystem.id
    }
  }, [subsystem.id, subsystem.dependency_rules])

  const archetypes = useMemo(() => cartesianArchetypes(subsystem.dimensions), [subsystem.dimensions])
  const primaryNonAge = useMemo(() => primaryDims.filter((d) => !d.is_age), [primaryDims])
  const paramNames = useMemo(() => parameters.map((p) => p.name).filter(Boolean), [parameters])

  const dirty = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(subsystem.dependency_rules),
    [rules, subsystem.dependency_rules],
  )

  const addRule = () => {
    setRules([...rules, {
      id: '',
      dependent_archetype_id: archetypes[0] ?? '',
      driver_filter: {},
      expression: 'filtered_stock',
      description: null,
    }])
  }

  const updateRule = (idx: number, patch: Partial<DependencyRule>) => {
    setRules(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  const deleteRule = (idx: number) => {
    setRules(rules.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    setError('')
    setFlash('')
    if (rules.some((r) => !r.dependent_archetype_id)) {
      setError('Every rule needs a target archetype.')
      return
    }
    if (rules.some((r) => !r.expression.trim())) {
      setError('Every rule needs an expression.')
      return
    }
    setSaving(true)
    try {
      await saveDependent({ ...subsystem, dependency_rules: rules })
      setFlash('Saved')
      setTimeout(() => setFlash(''), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      padding: 'var(--space-4)', backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            Dependency rules
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Each rule derives stock for one dependent archetype. Multiple rules for the same archetype sum.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {flash && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--success)' }}>
              <CheckCircle2 size={12} /> {flash}
            </span>
          )}
          <Button variant="ghost" onClick={addRule}>
            <Plus size={14} strokeWidth={1.5} /> Add rule
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!dirty || saving}
            style={{ backgroundColor: 'var(--mod-dsm)' }}
          >
            {saving ? 'Saving…' : 'Save rules'}
          </Button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', backgroundColor: 'var(--danger-muted)',
          border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-xs)', color: 'var(--danger)',
        }}>
          {error}
        </div>
      )}

      {rules.length === 0 && (
        <div style={{
          padding: 'var(--space-4)', backgroundColor: 'var(--bg-elevated)',
          border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', textAlign: 'center',
        }}>
          No rules yet. Click <strong>Add rule</strong> to derive a dependent archetype's stock from the primary.
        </div>
      )}

      {rules.map((rule, idx) => (
        <RuleCard
          key={idx}
          rule={rule}
          idx={idx}
          archetypes={archetypes}
          primaryNonAge={primaryNonAge}
          paramNames={paramNames}
          onChange={(patch) => updateRule(idx, patch)}
          onDelete={() => deleteRule(idx)}
          onValidate={() => validateRule(rule)}
        />
      ))}
    </div>
  )
}

interface RuleCardProps {
  rule: DependencyRule
  idx: number
  archetypes: string[]
  primaryNonAge: DimensionDef[]
  paramNames: string[]
  onChange: (patch: Partial<DependencyRule>) => void
  onDelete: () => void
  onValidate: () => Promise<{ ok: boolean; errors: string[] }>
}

function RuleCard({
  rule, idx, archetypes, primaryNonAge, paramNames, onChange, onDelete, onValidate,
}: RuleCardProps) {
  const exprRef = useRef<HTMLTextAreaElement>(null)
  const [validation, setValidation] = useState<{ ok: boolean; errors: string[] } | null>(null)
  const [validating, setValidating] = useState(false)
  const [collapsed, setCollapsed] = useState(true)

  const insertAtCursor = (snippet: string) => {
    const ta = exprRef.current
    if (!ta) {
      onChange({ expression: rule.expression + snippet })
      return
    }
    const start = ta.selectionStart ?? rule.expression.length
    const end = ta.selectionEnd ?? start
    const next = rule.expression.slice(0, start) + snippet + rule.expression.slice(end)
    onChange({ expression: next })
    // Restore caret after the insertion.
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + snippet.length
      ta.setSelectionRange(pos, pos)
    })
  }

  const runValidate = async () => {
    setValidating(true)
    try {
      setValidation(await onValidate())
    } catch (e: unknown) {
      setValidation({ ok: false, errors: [e instanceof Error ? e.message : String(e)] })
    } finally {
      setValidating(false)
    }
  }

  const toggleFilterLabel = (dimName: string, label: string) => {
    const current = rule.driver_filter[dimName] ?? []
    const next = current.includes(label)
      ? current.filter((l) => l !== label)
      : [...current, label]
    const updated = { ...rule.driver_filter }
    if (next.length === 0) delete updated[dimName]
    else updated[dimName] = next
    onChange({ driver_filter: updated })
  }

  return (
    <div style={{
      padding: 'var(--space-4)', backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand rule' : 'Collapse rule'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
            color: 'var(--text-secondary)', textAlign: 'left',
          }}
        >
          {collapsed ? <ChevronRight size={14} strokeWidth={1.5} /> : <ChevronDown size={14} strokeWidth={1.5} />}
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            Rule #{idx + 1}
          </span>
          {collapsed && (
            <span style={{
              fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
            }}>
              · {rule.dependent_archetype_id || '—'} · {rule.expression || '—'}
            </span>
          )}
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete rule"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', padding: 4, display: 'flex',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </div>

      {!collapsed && (<>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <div>
          <label style={labelCol}>Dependent archetype</label>
          <select
            value={rule.dependent_archetype_id}
            onChange={(e) => onChange({ dependent_archetype_id: e.target.value })}
            style={{ ...inputStyle, padding: '0 8px' }}
          >
            {!rule.dependent_archetype_id && <option value="">— select —</option>}
            {archetypes.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
            {/* Allow a free-form id if the subsystem's cartesian space doesn't match (e.g. legacy). */}
            {rule.dependent_archetype_id && !archetypes.includes(rule.dependent_archetype_id) && (
              <option value={rule.dependent_archetype_id}>{rule.dependent_archetype_id} (custom)</option>
            )}
          </select>
        </div>

        <div>
          <label style={labelCol}>Description</label>
          <input
            type="text"
            value={rule.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value || null })}
            placeholder="e.g. 1 unit per 100 primary units"
            style={inputStyle}
          />
        </div>
      </div>

      <div>
        <label style={labelCol}>Driver filter (primary dimensions)</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {primaryNonAge.length === 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              The primary system has no dimensions to filter by.
            </div>
          )}
          {primaryNonAge.map((dim) => {
            const selected = rule.driver_filter[dim.name] ?? []
            return (
              <div key={dim.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{
                  minWidth: 110, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                  paddingTop: 6, fontFamily: 'var(--font-mono)',
                }}>
                  {dim.name}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {dim.labels.map((l) => {
                    const isOn = selected.includes(l)
                    return (
                      <button
                        key={l}
                        onClick={() => toggleFilterLabel(dim.name, l)}
                        style={{
                          padding: '2px 8px', borderRadius: 'var(--radius-full)',
                          border: '1px solid ' + (isOn ? 'var(--mod-dsm)' : 'var(--border-default)'),
                          backgroundColor: isOn ? 'color-mix(in srgb, var(--mod-dsm) 14%, transparent)' : 'transparent',
                          color: isOn ? 'var(--mod-dsm)' : 'var(--text-secondary)',
                          fontSize: 'var(--text-xs)', cursor: 'pointer',
                        }}
                      >
                        {l}
                      </button>
                    )
                  })}
                  {selected.length === 0 && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', alignSelf: 'center' }}>
                      all
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <label style={labelCol}>Expression</label>
        <textarea
          ref={exprRef}
          value={rule.expression}
          onChange={(e) => { onChange({ expression: e.target.value }); setValidation(null) }}
          rows={2}
          placeholder="filtered_stock * 1.2"
          style={{
            ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginRight: 4 }}>Insert:</span>
          {BUILTIN_VARS.map((v) => (
            <InsertChip key={v} label={v} onClick={() => insertAtCursor(v)} accent />
          ))}
          {paramNames.map((p) => (
            <InsertChip key={p} label={p} onClick={() => insertAtCursor(p)} />
          ))}
          <Button variant="ghost" onClick={runValidate} disabled={validating} style={{ marginLeft: 'auto' }}>
            {validating ? 'Checking…' : 'Validate'}
          </Button>
        </div>
        {validation && (
          <div style={{
            marginTop: 6, padding: '6px 10px', borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)',
            backgroundColor: validation.ok ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'var(--danger-muted)',
            color: validation.ok ? 'var(--success)' : 'var(--danger)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            {validation.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {validation.ok ? 'Looks good.' : validation.errors.join('; ')}
          </div>
        )}
      </div>
      </>)}
    </div>
  )
}

function InsertChip({ label, onClick, accent = false }: { label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 8px', borderRadius: 'var(--radius-full)',
        border: '1px solid ' + (accent ? 'color-mix(in srgb, var(--mod-dsm) 40%, transparent)' : 'var(--border-default)'),
        backgroundColor: accent ? 'color-mix(in srgb, var(--mod-dsm) 8%, transparent)' : 'transparent',
        color: accent ? 'var(--mod-dsm)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}
