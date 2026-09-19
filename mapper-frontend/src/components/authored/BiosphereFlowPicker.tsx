/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import {
  searchBiosphereFlows,
  type FlowCandidate,
  type FlowSearchResponse,
  type SubstanceGroup,
} from '../../api/client'

// Choosing a biosphere flow by name alone is a guess: Nitrogen oxides has five
// flows that differ only by compartment, and the compartment changes some
// characterisation factors (EF v3.1 particulate matter: 1.6e-6 urban vs 2.1e-7
// high stacks) and, under some method families, whether the flow is
// characterised at all. This picker shows what the selected family does with
// each compartment, and nothing is selected until the user clicks one.
//
// Order: compartments are alphabetical and the UI says the order means
// nothing. The ecoinvent usage count is shown as information and never used to
// sort, because a first row -- or a big number -- reads as a recommendation.

export const ORDER_NOTE = 'Compartments are listed alphabetically; the order is not a recommendation.'
export const USAGE_TOOLTIP =
  'How many ecoinvent exchanges use this exact flow. Frequency is information, not a recommendation.'

export const FLOOR_TOOLTIP =
  "ecoinvent's median GSD² for this flow, used as the lower bound when authoring an exchange. " +
  '— means ecoinvent has too few lognormal exchanges for this flow to give one.'

const MIN_QUERY = 2

function compartment(c: FlowCandidate): string {
  return c.categories.join(' › ') || '(unspecified)'
}

function fmt(v: number | undefined): string {
  if (v === undefined) return '—'
  if (v === 0) return '0'
  return Math.abs(v) >= 1e-2 && Math.abs(v) < 1e4 ? String(Number(v.toPrecision(3))) : v.toExponential(2)
}

export interface BiosphereFlowPickerProps {
  database: string | null
  onSelect?: (candidate: FlowCandidate) => void
  /** Debounce for the search box, ms. */
  debounceMs?: number
}

export function BiosphereFlowPicker({ database, onSelect, debounceMs = 300 }: BiosphereFlowPickerProps) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState<string | null>(null)
  const [data, setData] = useState<FlowSearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setQuery(input.trim()), debounceMs)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [input, debounceMs])

  useEffect(() => {
    if (query.length < MIN_QUERY) { setData(null); setError(null); return }
    const ticket = ++latest.current
    setLoading(true)
    searchBiosphereFlows({ q: query, database, family })
      .then((r) => { if (ticket === latest.current) { setData(r); setError(null) } })
      .catch((e: unknown) => { if (ticket === latest.current) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (ticket === latest.current) setLoading(false) })
  }, [query, database, family])

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  return (
    <div data-testid="flow-picker" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          data-testid="flow-picker-search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Substance name, e.g. nitrogen oxides"
          style={{
            flex: 1, minWidth: 200, height: 32, padding: '0 10px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)',
          }}
        />
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Method family
          <select
            data-testid="flow-picker-family"
            value={data?.family ?? family ?? ''}
            onChange={(e) => setFamily(e.target.value)}
            disabled={!data}
            style={{
              height: 28, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)',
            }}
          >
            {(data?.families ?? (family ? [family] : [])).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      </div>

      {query.length < MIN_QUERY && (
        <div data-testid="flow-picker-hint" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Type at least two letters of a substance name. Flows that share a name are grouped, and each
          compartment shows how the selected method family characterises it.
        </div>
      )}
      {error && <div data-testid="flow-picker-error" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{error}</div>}
      {loading && !data && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Searching…</div>}
      {data && query.length >= MIN_QUERY && data.groups.length === 0 && (
        <div data-testid="flow-picker-empty" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          No biosphere flow in {data.database} matches “{query}”.
        </div>
      )}

      {data && query.length >= MIN_QUERY && data.groups.map((g) => {
        const key = `${g.database}|${g.name}`
        return (
          <GroupBlock
            key={key}
            group={g}
            family={data.family}
            open={expanded.has(key)}
            onToggle={() => toggle(key)}
            selected={selected}
            onPick={(c) => { setSelected(`${c.database}|${c.code}`); onSelect?.(c) }}
          />
        )
      })}
      {data?.truncated && (
        <div data-testid="flow-picker-truncated" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          More substances match; refine the search to see them.
        </div>
      )}
    </div>
  )
}

function GroupBlock({ group, family, open, onToggle, selected, onPick }: {
  group: SubstanceGroup
  family: string
  open: boolean
  onToggle: () => void
  selected: string | null
  onPick: (c: FlowCandidate) => void
}) {
  const best = useMemo(() => Math.max(0, ...group.candidates.map((c) => c.characterised)), [group])
  const varying = group.varying_methods.map((m) => m.label)
  const testKey = group.name.replace(/[^A-Za-z0-9]+/g, '-')
  return (
    <div data-testid={`flow-picker-group-${testKey}`} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
      <button
        type="button"
        data-testid={`flow-picker-group-toggle-${testKey}`}
        aria-expanded={open}
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)',
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{group.name}</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          {group.candidates.length} compartment{group.candidates.length === 1 ? '' : 's'} · {group.units.join(', ')}
        </span>
      </button>

      {/* Visibility toggle, not conditional mount: expansion is cheap to keep. */}
      <div data-testid={`flow-picker-group-body-${testKey}`} style={{ display: open ? 'block' : 'none', padding: '0 10px 10px' }}>
        <div data-testid="flow-picker-order-note" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 6 }}>
          {ORDER_NOTE}
        </div>
        {group.uniform_methods.length > 0 && (
          <div data-testid="flow-picker-uniform" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 6 }}>
            Same factor in every compartment: {group.uniform_methods.map((m) => m.label).join(', ')}
          </div>
        )}
        {varying.length === 0 && group.candidates.length > 1 && (
          <div data-testid="flow-picker-no-difference" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 6 }}>
            No {family} factor differs between these compartments.
          </div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
              <th style={{ padding: '4px 6px', fontWeight: 500 }}>Compartment</th>
              {varying.map((l) => (
                <th key={l} data-testid="flow-picker-varying-col" style={{ padding: '4px 6px', fontWeight: 500 }}>{l}</th>
              ))}
              <th style={{ padding: '4px 6px', fontWeight: 500 }}>Characterised</th>
              <th style={{ padding: '4px 6px', fontWeight: 500 }} title={FLOOR_TOOLTIP}>GSD² floor</th>
              <th style={{ padding: '4px 6px', fontWeight: 500 }} title={USAGE_TOOLTIP} data-testid="flow-picker-usage-header">
                Used in ecoinvent
              </th>
            </tr>
          </thead>
          <tbody>
            {group.candidates.map((c) => {
              const id = `${c.database}|${c.code}`
              const missing = varying.filter((l) => c.factors[l] === undefined)
              const isSel = selected === id
              return (
                <tr
                  key={id}
                  data-testid={`flow-picker-candidate-${c.code}`}
                  aria-selected={isSel}
                  onClick={() => onPick(c)}
                  style={{
                    cursor: 'pointer', borderTop: '1px solid var(--border-subtle)',
                    background: isSel ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '6px', color: 'var(--text-primary)' }}>
                    {compartment(c)}
                    {c.characterised < best && (
                      <div data-testid="flow-picker-coverage-warning" style={{ display: 'flex', gap: 4, alignItems: 'center', color: 'var(--warning)', marginTop: 2 }}>
                        <AlertTriangle size={11} />
                        Not characterised by {family} for: {missing.join(', ') || `${best - c.characterised} indicator(s)`}
                      </div>
                    )}
                  </td>
                  {varying.map((l) => (
                    <td key={l} style={{ padding: '6px', fontFamily: 'var(--font-mono)' }}>{fmt(c.factors[l])}</td>
                  ))}
                  <td style={{ padding: '6px' }}>{c.characterised} of {group.family_indicator_count}</td>
                  <td style={{ padding: '6px', fontFamily: 'var(--font-mono)' }} title={FLOOR_TOOLTIP} data-testid="flow-picker-floor">
                    {c.floor_available && c.floor_gsd2 !== null ? c.floor_gsd2.toFixed(2) : '—'}
                  </td>
                  <td style={{ padding: '6px', color: 'var(--text-secondary)' }} title={USAGE_TOOLTIP}>
                    {c.ecoinvent_exchanges.toLocaleString()} exchanges
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
