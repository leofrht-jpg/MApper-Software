/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useState } from 'react'
import {
  estimatePairedSeconds,
  formatEstimate,
  type MonteCarloMultiResult,
  type PairwiseDifference,
} from '../../api/client'
import type { MonteCarloMultiHandoff } from '../../stores/monteCarloStore'

/**
 * Which items to propagate, defaulting to the comparison's current selection.
 *
 * The estimate is shown BEFORE Run because paired uncertainty is minutes, not
 * seconds, and the cost is linear in item count: measured 59 s for one item
 * per 1000 iterations, then ~39 s per additional item.
 */
export function ItemPicker({
  handoff, selected, onToggle, iterations,
}: {
  handoff: MonteCarloMultiHandoff
  selected: string[]
  onToggle: (id: string) => void
  iterations: number
}) {
  const seconds = estimatePairedSeconds(selected.length, iterations)
  return (
    <div data-testid="mc-item-picker" style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Items to propagate
      </div>
      {handoff.items.map((it) => (
        <label
          key={it.archetypeId}
          data-testid={`mc-item-${it.archetypeId}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={selected.includes(it.archetypeId)}
            onChange={() => onToggle(it.archetypeId)}
          />
          {it.archetypeName}
        </label>
      ))}
      <div
        data-testid="mc-estimate"
        style={{ fontSize: 'var(--text-xs)', color: selected.length ? 'var(--text-secondary)' : 'var(--warning)' }}
      >
        {selected.length === 0
          ? 'Select at least one item.'
          : `${selected.length} item${selected.length === 1 ? '' : 's'} × ${iterations} iterations ≈ ${formatEstimate(seconds)}`}
      </div>
    </div>
  )
}

/**
 * The pairwise difference, which is the headline of a paired run.
 *
 * Correlation is reported beside each pair as INFORMATION, not a warning: a
 * weakly correlated pair gives a genuinely wide difference and that is
 * correct. The correlation tells the reader where the precision comes from.
 */
export function PairwiseDifferences({ result }: { result: MonteCarloMultiResult }) {
  const [method, setMethod] = useState(0)
  const labels = useMemo(
    () => Array.from(new Set(result.differences.map((d) => d.method_label))),
    [result.differences],
  )
  const active = labels[Math.min(method, labels.length - 1)]
  const rows = result.differences.filter((d) => d.method_label === active)

  if (!result.differences.length) {
    return (
      <div data-testid="mc-no-pairs" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        A single item has no pairwise difference. Add a second item to compare.
      </div>
    )
  }

  return (
    <div data-testid="mc-pairwise">
      {labels.length > 1 && (
        <select
          data-testid="mc-pairwise-method"
          value={method}
          onChange={(e) => setMethod(Number(e.target.value))}
          style={{ marginBottom: 10, height: 30, fontSize: 'var(--text-sm)' }}
        >
          {labels.map((l, i) => <option key={l} value={i}>{l}</option>)}
        </select>
      )}
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {rows.map((d) => <PairCard key={`${d.a_id}-${d.b_id}`} d={d} />)}
      </div>
    </div>
  )
}

function PairCard({ d }: { d: PairwiseDifference }) {
  const pct = d.fraction_a_lower * 100
  // The statement a paired run supports.
  const claim =
    pct >= 99.95 ? `${d.a_name} is lower than ${d.b_name} in 100% of iterations`
      : pct <= 0.05 ? `${d.a_name} is higher than ${d.b_name} in 100% of iterations`
      : `${d.a_name} is lower than ${d.b_name} in ${pct.toFixed(1)}% of iterations`
  const decisive = pct >= 95 || pct <= 5
  const num = (v: number) =>
    Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(3) : v.toFixed(4)

  return (
    <div
      data-testid={`mc-pair-${d.a_id}-${d.b_id}`}
      style={{
        padding: 'var(--space-3)',
        border: `1px solid ${decisive ? 'var(--mod-lca)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)',
      }}
    >
      <div data-testid="mc-pair-claim" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
        {claim}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
        median Δ {num(d.median)} {d.unit} · 95% [{num(d.p2_5)}, {num(d.p97_5)}] · deterministic {num(d.deterministic)}
      </div>
      <div
        data-testid={`mc-pair-corr-${d.a_id}-${d.b_id}`}
        style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}
      >
        correlation {d.correlation.toFixed(4)} —{' '}
        {d.correlation >= 0.9
          ? 'the items move together, so the difference is tightly determined'
          : d.correlation >= 0.5
            ? 'partly shared drivers; the difference is correspondingly wider'
            : 'little shared structure, so this difference is genuinely wide'}
      </div>
    </div>
  )
}

/** One box per item, in COMPARISON order — not sorted by value, so the
 *  reader's mental order from the comparison carries over. */
export function MultiItemBoxPlot({
  result, methodLabel,
}: { result: MonteCarloMultiResult; methodLabel?: string }) {
  const label = methodLabel ?? result.items[0]?.distributions[0]?.method_label
  const rows = result.items
    .map((it) => ({ name: it.archetype_name, d: it.distributions.find((x) => x.method_label === label) }))
    .filter((r) => r.d)
  if (!rows.length) return null

  const lo = Math.min(...rows.map((r) => r.d!.p2_5))
  const hi = Math.max(...rows.map((r) => r.d!.p97_5))
  const pad = (hi - lo) * 0.08 || 1
  const xMin = lo - pad, xMax = hi + pad
  const LABEL_W = 220, W = 900, ROW_H = 30
  const H = rows.length * ROW_H + 30
  const x = (v: number) => LABEL_W + ((v - xMin) / (xMax - xMin)) * (W - LABEL_W - 24)

  return (
    <svg
      data-testid="mc-multi-boxplot"
      data-chart-export-target
      width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distribution per item"
    >
      {rows.map((r, i) => {
        const d = r.d!
        const cy = 20 + i * ROW_H
        return (
          <g key={r.name} data-testid={`mc-box-${i}`}>
            <text x={LABEL_W - 10} y={cy + 4} textAnchor="end" fontSize={11} fill="var(--text-primary)">
              {r.name.length > 32 ? `${r.name.slice(0, 31)}…` : r.name}
            </text>
            <line x1={x(d.p2_5)} x2={x(d.p97_5)} y1={cy} y2={cy} stroke="#60A5FA" strokeWidth={1} />
            <rect x={x(d.p25)} y={cy - 8} width={Math.max(x(d.p75) - x(d.p25), 1.5)} height={16}
                  fill="#60A5FA" fillOpacity={0.28} stroke="#60A5FA" strokeWidth={1} />
            <line x1={x(d.median)} x2={x(d.median)} y1={cy - 8} y2={cy + 8} stroke="#60A5FA" strokeWidth={2} />
            <circle cx={x(d.deterministic)} cy={cy} r={3} fill="#F59E0B" />
          </g>
        )
      })}
    </svg>
  )
}
