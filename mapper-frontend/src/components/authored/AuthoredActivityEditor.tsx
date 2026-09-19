/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, X } from 'lucide-react'
import {
  addAuthoredActivity,
  previewAuthoredExchange,
  structuredErrorDetail,
  updateAuthoredActivity,
  type AuthoredActivity,
  type AuthoredActivityInput,
  type AuthoredExchangeInput,
  type AuthoredFlowSnapshot,
  type AuthoredScope,
  type ExchangePreview,
  type FlowCandidate,
} from '../../api/client'
import { NumberInput } from '../ui/NumberInput'
import { PedigreeEditor } from '../uncertainty/PedigreeEditor'
import { BiosphereFlowPicker } from './BiosphereFlowPicker'
import { usePedigreeTable } from '../../utils/pedigree'

// An authored activity is defined by its biosphere exchanges. Everything this
// editor shows about an exchange -- GSD², the comparison with ecoinvent's floor,
// any refusal, and whether a floor reason is needed -- comes from the preview
// endpoint, which runs the SAME code as saving. The editor restates none of
// those rules; it only reacts to the verdict (and its machine-readable codes).

export interface ExchangeRow {
  key: string
  flow: AuthoredFlowSnapshot
  amount: number
  pedigree: Record<string, number> | null
  /** 'derived': ecoinvent supplies the basic variance (read-only).
   *  'required': the user must enter one, with a reason. */
  bvMode: 'derived' | 'required'
  derivedBv: number | null
  bvNote: string
  basicVariance: number | null
  bvReason: string
  floorReason: string
  preview: ExchangePreview | null
}

let rowSeq = 0
const nextKey = () => `row-${++rowSeq}`

export function rowFromCandidate(c: FlowCandidate): ExchangeRow {
  const derived = c.basic_variance !== null
  return {
    key: nextKey(),
    flow: { database: c.database, code: c.code, name: c.name, categories: c.categories, unit: c.unit },
    amount: 1,
    pedigree: null,
    bvMode: derived ? 'derived' : 'required',
    derivedBv: c.basic_variance,
    bvNote: derived
      ? `ecoinvent median over ${c.basic_variance_n.toLocaleString()} exchanges`
      : 'ecoinvent has no usable basic variance for this flow: enter one, with the reason',
    basicVariance: null,
    bvReason: '',
    floorReason: '',
    preview: null,
  }
}

function rowFromStored(a: AuthoredActivity['exchanges'][number]): ExchangeRow {
  const derived = a.basic_variance_source === 'ecoinvent_median'
  return {
    key: nextKey(),
    flow: a.flow,
    amount: a.amount,
    pedigree: { ...a.pedigree },
    bvMode: derived ? 'derived' : 'required',
    derivedBv: derived ? a.basic_variance : null,
    bvNote: derived ? a.basic_variance_detail : 'ecoinvent has no usable basic variance for this flow: enter one, with the reason',
    basicVariance: derived ? null : a.basic_variance,
    bvReason: derived ? '' : a.basic_variance_detail,
    floorReason: a.floor_reason ?? '',
    preview: null,
  }
}

export function toInput(r: ExchangeRow): AuthoredExchangeInput {
  return {
    flow_database: r.flow.database,
    flow_code: r.flow.code,
    amount: r.amount,
    pedigree: r.pedigree ?? {},
    basic_variance: r.bvMode === 'required' ? r.basicVariance : null,
    basic_variance_reason: r.bvMode === 'required' ? r.bvReason : null,
    floor_reason: r.floorReason.trim() || null,
  }
}

const field: React.CSSProperties = {
  height: 28, padding: '0 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', width: '100%',
}
const label: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'grid', gap: 4 }

export interface AuthoredActivityEditorProps {
  database: string
  initial?: AuthoredActivity
  onSaved: (a: AuthoredActivity) => void
  onCancel: () => void
  /** Preview debounce, ms. */
  debounceMs?: number
}

export function AuthoredActivityEditor({ database, initial, onSaved, onCancel, debounceMs = 300 }: AuthoredActivityEditorProps) {
  const table = usePedigreeTable()
  const [name, setName] = useState(initial?.name ?? '')
  const [refProduct, setRefProduct] = useState(initial?.reference_product ?? '')
  const [unit, setUnit] = useState(initial?.unit ?? 'kilogram')
  const [location, setLocation] = useState(initial?.location ?? 'GLO')
  const [comment, setComment] = useState(initial?.comment ?? '')
  // No default scope: the user must say whether the listed flows are complete.
  const [scope, setScope] = useState<AuthoredScope | null>(initial?.scope ?? null)
  const [scopeNote, setScopeNote] = useState(initial?.scope_note ?? '')
  const [rows, setRows] = useState<ExchangeRow[]>(() => (initial?.exchanges ?? []).map(rowFromStored))
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveProblems, setSaveProblems] = useState<string[]>([])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const tickets = useRef<Record<string, number>>({})

  const complete = (r: ExchangeRow) =>
    !!table && table.indicators.every((i) => r.pedigree?.[i] !== undefined)

  const update = (key: string, patch: Partial<ExchangeRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, preview: 'preview' in patch ? patch.preview! : null } : r)))

  // Preview each row whenever its inputs change (debounced). The row's own
  // preview is cleared on every edit (see `update`), so what is on screen is
  // never the verdict for an older version of the row.
  const inputsKey = rows.map((r) => `${r.key}:${JSON.stringify(toInput(r))}:${complete(r)}`).join('|')
  useEffect(() => {
    for (const r of rows) {
      if (r.preview || !complete(r)) continue
      clearTimeout(timers.current[r.key])
      const ticket = (tickets.current[r.key] ?? 0) + 1
      tickets.current[r.key] = ticket
      timers.current[r.key] = setTimeout(() => {
        previewAuthoredExchange(toInput(r))
          .then((p) => { if (tickets.current[r.key] === ticket) setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, preview: p } : x))) })
          .catch((e: unknown) => {
            if (tickets.current[r.key] !== ticket) return
            const msg = e instanceof Error ? e.message : String(e)
            setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, preview: { ok: false, exchange: null, problems: [msg], codes: ['request'] } } : x)))
          })
      }, debounceMs)
    }
  }, [inputsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])

  const unfloored = rows.some((r) => r.preview?.exchange?.floor_status === 'unfloored')
  const blockers: string[] = []
  if (!name.trim()) blockers.push('a name')
  if (scope === null) blockers.push('the inventory scope')
  if (scope === 'partial' && !scopeNote.trim()) blockers.push('a note on what the partial inventory leaves out')
  if (rows.length === 0) blockers.push('at least one exchange')
  if (rows.some((r) => !complete(r))) blockers.push('all five pedigree scores on every exchange')
  if (rows.some((r) => complete(r) && !r.preview?.ok)) blockers.push('every exchange accepted by the check below it')

  const save = async () => {
    if (blockers.length || scope === null) return
    const body: AuthoredActivityInput = {
      name: name.trim(), reference_product: refProduct.trim() || null, unit, location, comment,
      scope, scope_note: scope === 'partial' ? scopeNote.trim() : null,
      exchanges: rows.map(toInput),
    }
    setSaving(true)
    setSaveProblems([])
    try {
      const saved = initial
        ? await updateAuthoredActivity(database, initial.code, body)
        : await addAuthoredActivity(database, body)
      onSaved(saved)
    } catch (e) {
      const d = structuredErrorDetail(e)
      const problems = Array.isArray(d?.problems) ? (d!.problems as string[]) : [e instanceof Error ? e.message : String(e)]
      setSaveProblems(problems)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      data-testid="authored-editor"
      role="dialog"
      aria-label={initial ? `Edit ${initial.name}` : 'New authored activity'}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflow: 'auto', padding: 'var(--space-6)' }}
    >
      <div style={{ width: 'min(960px, 100%)', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>
            {initial ? `Edit activity in ${database}` : `New activity in ${database}`}
          </h2>
          <button type="button" aria-label="Close" onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr', gap: 'var(--space-3)' }}>
          <label style={label}>Name<input data-testid="authored-name" style={field} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={label}>Reference product<input data-testid="authored-refproduct" style={field} value={refProduct} placeholder="defaults to the name" onChange={(e) => setRefProduct(e.target.value)} /></label>
          <label style={label}>Unit<input data-testid="authored-unit" style={field} value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
          <label style={label}>Location<input data-testid="authored-location" style={field} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        </div>
        <label style={label}>Comment<textarea data-testid="authored-comment" style={{ ...field, height: 48, paddingTop: 6 }} value={comment} onChange={(e) => setComment(e.target.value)} /></label>

        <fieldset data-testid="authored-scope" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', margin: 0 }}>
          <legend style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', padding: '0 4px' }}>Inventory scope (required)</legend>
          <label style={{ display: 'flex', gap: 6, fontSize: 'var(--text-sm)' }}>
            <input type="radio" name="scope" data-testid="scope-complete" checked={scope === 'complete'} onChange={() => setScope('complete')} />
            Complete — the flows listed are the whole inventory
          </label>
          <label style={{ display: 'flex', gap: 6, fontSize: 'var(--text-sm)', marginTop: 4 }}>
            <input type="radio" name="scope" data-testid="scope-partial" checked={scope === 'partial'} onChange={() => setScope('partial')} />
            Partial — only the flows listed were specified; others are unknown, not zero
          </label>
          {scope === 'partial' && (
            <textarea
              data-testid="scope-note"
              style={{ ...field, height: 44, marginTop: 8, paddingTop: 6 }}
              placeholder="Required: which flows were specified, and which were not (e.g. CO₂ only; NOx and particulates not known)"
              value={scopeNote}
              onChange={(e) => setScopeNote(e.target.value)}
            />
          )}
        </fieldset>

        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 'var(--text-sm)' }}>Biosphere exchanges (per 1 {unit || 'unit'})</strong>
            <button type="button" data-testid="authored-add-flow" onClick={() => setPicking(true)}
              style={{ display: 'inline-flex', gap: 4, alignItems: 'center', padding: '4px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>
              <Plus size={12} /> Add flow
            </button>
          </div>
          {rows.length === 0 && (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              No exchanges yet. Add the flows this activity emits or consumes; every installed method will characterise them.
            </div>
          )}
          {rows.map((r) => (
            <ExchangeRowView key={r.key} row={r} complete={complete(r)}
              onChange={(patch) => update(r.key, patch)}
              onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
          ))}
        </div>

        {unfloored && (
          <div data-testid="activity-unfloored" style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
            This activity carries an exchange whose uncertainty could not be checked against ecoinvent (marked Unfloored).
          </div>
        )}
        {saveProblems.length > 0 && (
          <ul data-testid="authored-save-problems" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>
            {saveProblems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          {blockers.length > 0 && (
            <span data-testid="authored-blockers" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              Still needed: {blockers.join('; ')}.
            </span>
          )}
          <button type="button" onClick={onCancel} style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
          <button type="button" data-testid="authored-save" disabled={blockers.length > 0 || saving} onClick={save}
            style={{ padding: '6px 12px', background: 'var(--mod-lca)', border: 'none', borderRadius: 'var(--radius-md)', color: '#fff', cursor: blockers.length ? 'not-allowed' : 'pointer', opacity: blockers.length ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save activity'}
          </button>
        </div>
      </div>

      {picking && (
        <div data-testid="authored-picker-modal" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ width: 'min(900px, 95%)', height: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
              <strong style={{ fontSize: 'var(--text-sm)' }}>Choose a biosphere flow — pick the compartment</strong>
              <button type="button" aria-label="Close picker" onClick={() => setPicking(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={16} /></button>
            </div>
            <BiosphereFlowPicker database={null} onSelect={(c) => { setRows((rs) => [...rs, rowFromCandidate(c)]); setPicking(false) }} />
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

function ExchangeRowView({ row, complete, onChange, onRemove }: {
  row: ExchangeRow
  complete: boolean
  onChange: (patch: Partial<ExchangeRow>) => void
  onRemove: () => void
}) {
  const p = row.preview
  const codes = p?.codes ?? []
  const needsFloorReason = codes.includes('below_floor') || row.floorReason.trim() !== ''
  const tid = `exchange-${row.flow.code}`
  return (
    <div data-testid={tid} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <strong style={{ fontSize: 'var(--text-sm)' }}>{row.flow.name}</strong>
          <span data-testid={`${tid}-compartment`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginLeft: 8 }}>
            {row.flow.categories.join(' › ')} · {row.flow.unit}
          </span>
        </div>
        <button type="button" aria-label="Remove exchange" onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><Trash2 size={14} /></button>
      </div>
      <label style={{ ...label, gridTemplateColumns: 'auto 140px 1fr', alignItems: 'center', display: 'grid' }}>
        Amount
        <NumberInput data-testid={`${tid}-amount`} value={row.amount} onChange={(v) => onChange({ amount: v })}
          style={{ height: 26, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }} />
        <span style={{ color: 'var(--text-tertiary)' }}>
          {row.flow.unit} per unit of activity. Positive amounts only: negative (uptake) flows are not supported in this version.
        </span>
      </label>
      <PedigreeEditor
        testIdPrefix={`${tid}-pedigree`}
        scores={row.pedigree}
        basicVariance={row.bvMode === 'derived' ? row.derivedBv : row.basicVariance}
        onChange={(scores, bv) => onChange(row.bvMode === 'required' ? { pedigree: scores, basicVariance: bv } : { pedigree: scores })}
        requireAll
        basicVarianceMode={row.bvMode}
        basicVarianceNote={row.bvNote}
        compact
      />
      {row.bvMode === 'required' && (
        <textarea data-testid={`${tid}-bv-reason`} style={{ ...field, height: 40, paddingTop: 6 }}
          placeholder="Required: where this basic variance comes from (it is stored on the exchange)"
          value={row.bvReason} onChange={(e) => onChange({ bvReason: e.target.value })} />
      )}
      {needsFloorReason && (
        <textarea data-testid={`${tid}-floor-reason`} style={{ ...field, height: 40, paddingTop: 6, borderColor: 'var(--warning)' }}
          placeholder="Required: why this exchange is better constrained than ecoinvent's median for the flow (stored on the exchange)"
          value={row.floorReason} onChange={(e) => onChange({ floorReason: e.target.value })} />
      )}

      {!complete && (
        <div data-testid={`${tid}-waiting`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Score all five indicators to check this exchange.
        </div>
      )}
      {complete && !p && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Checking…</div>
      )}
      {p?.ok && p.exchange && (
        <div data-testid={`${tid}-verdict`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>GSD² <strong style={{ color: 'var(--text-primary)' }}>{p.exchange.gsd2.toFixed(3)}</strong></span>
          {p.exchange.floor_status === 'floored' && (
            <span data-testid={`${tid}-floored`}>at or above ecoinvent's median {p.exchange.floor_gsd2?.toFixed(3)} for this flow</span>
          )}
          {p.exchange.floor_status === 'below_floor_with_reason' && (
            <span data-testid={`${tid}-below-floor`} style={{ color: 'var(--warning)' }}>
              below ecoinvent's median {p.exchange.floor_gsd2?.toFixed(3)}; your reason will be stored with it
            </span>
          )}
          {p.exchange.floor_status === 'unfloored' && (
            <span data-testid={`${tid}-unfloored`} style={{ color: 'var(--warning)' }}>
              <strong>Unfloored</strong> — {p.exchange.floor_detail}
            </span>
          )}
        </div>
      )}
      {p && !p.ok && (
        <ul data-testid={`${tid}-problems`} style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
          {p.problems.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
    </div>
  )
}
