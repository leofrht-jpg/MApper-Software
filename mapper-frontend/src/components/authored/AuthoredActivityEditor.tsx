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
  fetchReachedIndicators,
  previewAuthoredExchange,
  structuredErrorDetail,
  updateAuthoredActivity,
  type AuthoredActivity,
  type AuthoredActivityInput,
  type AuthoredExchangeInput,
  type UncertaintyBasis,
  type AuthoredFlowSnapshot,
  type AuthoredScope,
  type ExchangePreview,
  type FlowCandidate,
  type ReachedIndicatorsResponse,
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
  /** Where this exchange's uncertainty comes from. `supplied` is a deliberate
   *  choice about what the AMOUNT is, never a way out of the floor. */
  basis: UncertaintyBasis
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
    basis: 'ecoinvent',
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
    basis: a.uncertainty_basis ?? 'ecoinvent',
    derivedBv: derived ? a.basic_variance : null,
    bvNote: derived ? a.basic_variance_detail : 'ecoinvent has no usable basic variance for this flow: enter one, with the reason',
    basicVariance: derived ? null : a.basic_variance,
    bvReason: derived ? '' : a.basic_variance_detail,
    floorReason: a.floor_reason ?? '',
    preview: null,
  }
}

/** The author states the variance when ecoinvent has none to derive, and always
 *  on the supplied basis -- there the figure's uncertainty is the supplier's. */
const bvIsTheAuthors = (r: ExchangeRow) => r.basis === 'supplied' || r.bvMode === 'required'

export function toInput(r: ExchangeRow): AuthoredExchangeInput {
  const own = bvIsTheAuthors(r)
  return {
    flow_database: r.flow.database,
    flow_code: r.flow.code,
    amount: r.amount,
    pedigree: r.pedigree ?? {},
    basic_variance: own ? r.basicVariance : null,
    basic_variance_reason: own ? r.bvReason : null,
    // A supplied exchange has no floor, so it can carry no reason for being
    // under one. Any text typed before the basis was changed stays in the form
    // but is not sent: the backend refuses it, and storing it would be a
    // reason for a comparison that was never made.
    floor_reason: r.basis === 'supplied' ? null : (r.floorReason.trim() || null),
    uncertainty_basis: r.basis,
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
  // Per-indicator declaration (partial only). Keys are full method tuples joined
  // by '|'. Starts EMPTY for a new activity: nothing is complete until ticked.
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set((initial?.complete_indicators ?? []).map((m) => m.join('|'))))
  const [reached, setReached] = useState<ReachedIndicatorsResponse | null>(null)
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

  // What the listed flows reach -- the only indicators that can be ticked.
  // Asked of the backend (same function as the save-time floor), never derived here.
  const flowsKey = rows.map((r) => `${r.flow.database}|${r.flow.code}`).sort().join(',')
  const reachTicket = useRef(0)
  useEffect(() => {
    if (scope !== 'partial' || rows.length === 0) { setReached(null); return }
    const ticket = ++reachTicket.current
    const t = setTimeout(() => {
      fetchReachedIndicators(rows.map((r) => ({ database: r.flow.database, code: r.flow.code })))
        .then((res) => { if (reachTicket.current === ticket) setReached(res) })
        .catch(() => { if (reachTicket.current === ticket) setReached(null) })
    }, debounceMs)
    return () => clearTimeout(t)
  }, [flowsKey, scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const reachedKeys = new Set((reached?.indicators ?? []).map((i) => i.method.join('|')))
  const staleTicks = scope === 'partial' && reached ? [...ticked].filter((k) => !reachedKeys.has(k)) : []

  const unfloored = rows.some((r) => r.preview?.exchange?.floor_status === 'unfloored')
  const blockers: string[] = []
  if (!name.trim()) blockers.push('a name')
  if (scope === null) blockers.push('the inventory scope')
  if (scope === 'partial' && !scopeNote.trim()) blockers.push('a note on what the partial inventory leaves out')
  if (rows.length === 0) blockers.push('at least one exchange')
  if (rows.some((r) => !complete(r))) blockers.push('all five pedigree scores on every exchange')
  if (rows.some((r) => complete(r) && !r.preview?.ok)) blockers.push('every exchange accepted by the check below it')
  if (staleTicks.length) blockers.push('no ticks on indicators no listed flow reaches (untick them)')

  const save = async () => {
    if (blockers.length || scope === null) return
    const body: AuthoredActivityInput = {
      name: name.trim(), reference_product: refProduct.trim() || null, unit, location, comment,
      scope, scope_note: scope === 'partial' ? scopeNote.trim() : null,
      exchanges: rows.map(toInput),
      // A complete activity declares full coverage by definition: no ticks.
      complete_indicators: scope === 'partial' ? [...ticked].sort().map((k) => k.split('|')) : [],
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

        {scope === 'partial' && rows.length > 0 && (
          <CoverageDeclaration
            reached={reached}
            ticked={ticked}
            stale={staleTicks}
            onToggle={(k) => setTicked((t) => { const n = new Set(t); if (n.has(k)) n.delete(k); else n.add(k); return n })}
          />
        )}

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
  const supplied = row.basis === 'supplied'
  const ownBv = bvIsTheAuthors(row)
  // Never on the supplied basis: there is no floor there to be under.
  const needsFloorReason = !supplied && (codes.includes('below_floor') || row.floorReason.trim() !== '')
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
        basicVariance={ownBv ? row.basicVariance : row.derivedBv}
        onChange={(scores, bv) => onChange(ownBv ? { pedigree: scores, basicVariance: bv } : { pedigree: scores })}
        requireAll
        basicVarianceMode={ownBv ? 'required' : 'derived'}
        basicVarianceNote={supplied
          ? "Required: the uncertainty of the supplied figure itself. ecoinvent's median for this flow describes an emission amount, which this is not, so it is not used."
          : row.bvNote}
        compact
      />
      {ownBv && (
        <textarea data-testid={`${tid}-bv-reason`} style={{ ...field, height: 40, paddingTop: 6 }}
          placeholder={supplied
            ? 'Required: whose uncertainty this is and how you arrived at it — the supplier, the report, what they state (it is stored on the exchange)'
            : 'Required: where this basic variance comes from (it is stored on the exchange)'}
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
          {p.exchange.floor_status === 'not_applicable' && (
            <span data-testid={`${tid}-basis-not-applicable`}>
              no floor: {p.exchange.floor_detail}
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
      <UncertaintyBasisControl tid={tid} basis={row.basis} onChange={(basis) => onChange({ basis })} />
    </div>
  )
}

/** The exemption from ecoinvent's floor, and the only way to reach it.
 *
 *  Deliberately undersold: closed by default, last in the row, in the quiet
 *  colour, and phrased as a question about what the amount IS. It is never
 *  presented as a fix for a floor complaint, because for an emission amount it
 *  is not one -- the floor exists because authored inventories understate, and
 *  an author who takes this route to silence a `below_floor` message has made
 *  their number look better without changing what they know. */
function UncertaintyBasisControl({ tid, basis, onChange }: {
  tid: string
  basis: UncertaintyBasis
  onChange: (b: UncertaintyBasis) => void
}) {
  const supplied = basis === 'supplied'
  return (
    <details data-testid={`${tid}-basis`} open={supplied}>
      <summary data-testid={`${tid}-basis-summary`}
        style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
        Uncertainty basis: <strong>{supplied ? 'supplied with the figure' : "ecoinvent's spread for this flow"}</strong>
      </summary>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'grid', gap: 6, padding: '6px 0 0 16px' }}>
        <p style={{ margin: 0 }}>
          The amount above is read as an emission of this flow, so ecoinvent's spread for that flow is the
          reference: its median is the basic variance, and its GSD² is the floor.
        </p>
        <p style={{ margin: 0 }}>
          That is wrong for one kind of amount: a characterised result someone else computed — a supplier's
          product carbon footprint, an EPD — entered against a flow so that the indicator reproduces their
          number. No emission of that size occurs; the figure's uncertainty is the supplier's, and ecoinvent's
          per-flow median describes a different quantity. If that is what you have entered, say so here: you
          then state the variance and where it came from, and no floor is checked.
        </p>
        <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>
          If the amount is an emission, leave this as it is, including when the floor says your GSD² is low.
        </p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" data-testid={`${tid}-basis-supplied`} checked={supplied}
            onChange={(e) => onChange(e.target.checked ? 'supplied' : 'ecoinvent')} />
          <span>This amount is a characterised result, not an emission amount.</span>
        </label>
      </div>
    </details>
  )
}

/** Partial activities only. Lists the indicators the listed flows reach and lets
 *  the author tick those the partial inventory is complete for. Nothing starts
 *  ticked; an indicator no listed flow reaches is never offered. */
function CoverageDeclaration({ reached, ticked, stale, onToggle }: {
  reached: ReachedIndicatorsResponse | null
  ticked: Set<string>
  stale: string[]
  onToggle: (key: string) => void
}) {
  const [family, setFamily] = useState<string | null>(null)
  const fam = family && reached?.families.includes(family) ? family : reached?.default_family ?? null
  const shown = (reached?.indicators ?? []).filter((i) => i.family === fam)
  const tickedHere = shown.filter((i) => ticked.has(i.method.join('|'))).length
  return (
    <fieldset data-testid="authored-coverage-declaration" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
      <legend style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', padding: '0 4px' }}>
        Which indicators is this partial inventory complete for?
      </legend>
      <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        Listed: the indicators your flows are characterised by. A factor means a flow contributes, not that
        the flows you listed are enough. Tick an indicator only if they are. Everything you leave unticked,
        and every indicator not listed here, is marked <strong>not specified</strong> on results.
      </p>
      {!reached && <span data-testid="authored-coverage-loading" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Finding the indicators these flows reach…</span>}
      {reached && reached.indicators.length === 0 && (
        <span data-testid="authored-coverage-none" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          No installed indicator characterises these flows, so none can be declared complete.
        </span>
      )}
      {reached && reached.families.length > 1 && (
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>
          Method family
          <select data-testid="authored-coverage-family" value={fam ?? ''} onChange={(e) => setFamily(e.target.value)}
            style={{ height: 24, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}>
            {reached.families.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      )}
      {shown.length > 0 && (
        <div style={{ display: 'grid', gap: 2 }}>
          {shown.map((i) => {
            const k = i.method.join('|')
            return (
              <label key={k} style={{ display: 'flex', gap: 6, fontSize: 'var(--text-sm)', alignItems: 'center' }}>
                <input type="checkbox" data-testid={`coverage-tick-${k}`} checked={ticked.has(k)} onChange={() => onToggle(k)} />
                {i.label}
              </label>
            )
          })}
          <span data-testid="authored-coverage-summary" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {tickedHere} of {shown.length} declared complete in {fam}; {ticked.size - stale.length} across all families.
          </span>
        </div>
      )}
      {stale.length > 0 && (
        <div data-testid="authored-coverage-stale" style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', display: 'grid', gap: 2 }}>
          Ticked, but no listed flow reaches it any more -- it cannot be declared complete:
          {stale.map((k) => (
            <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" data-testid={`coverage-stale-${k}`} checked onChange={() => onToggle(k)} />
              {k.split('|').join(' › ')}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}
