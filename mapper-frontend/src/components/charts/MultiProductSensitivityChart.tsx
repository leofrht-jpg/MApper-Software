/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useRef } from 'react'
import { ChartExportButton } from './ChartExportButton'
import { ChartExportContainer } from './ChartExportContainer'
import { NumberFormatControl } from './NumberFormatControl'
import { type useNumberFormatter } from './numberFormat'
import { CHART_PALETTE } from '../../utils/chartColors'

type Fmt = ReturnType<typeof useNumberFormatter>

export interface ItemCases {
  itemId: string
  label: string
  /** case name -> score for the active method. Must include Base. */
  byCase: Record<string, number>
}

/** min / max / Base per item, plus whether any item moves at all. */
export function rangesFor(items: ItemCases[], cases: string[], baseCase = 'Base') {
  return items.map((it) => {
    const vals = cases.map((c) => it.byCase[c]).filter((v) => typeof v === 'number')
    const base = it.byCase[baseCase] ?? vals[0] ?? 0
    const lo = vals.length ? Math.min(...vals) : base
    const hi = vals.length ? Math.max(...vals) : base
    return { ...it, base, lo, hi, spread: hi - lo }
  })
}

/** Do two items' [lo, hi] ranges overlap?
 *
 * The question multi-item comparison exists to answer once sensitivity is on:
 * if the ranges overlap, the ranking between those two items is NOT robust to
 * the sensitivity study.
 */
export function rangesOverlap(
  a: { lo: number; hi: number }, b: { lo: number; hi: number },
): boolean {
  return a.lo <= b.hi && b.lo <= a.hi
}

interface Props {
  items: ItemCases[]
  cases: string[]
  unit: string
  methodLabel: string
  format: Fmt
  filenameBase: string
  /** 'range' = Base bar + whisker (default). 'by_case' = grouped bars. */
  mode?: 'range' | 'by_case'
}

export function MultiProductSensitivityChart({
  items, cases, unit, methodLabel, format, filenameBase, mode = 'range',
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => rangesFor(items, cases), [items, cases])
  const gmax = useMemo(
    () => Math.max(...rows.map((r) => Math.max(r.hi, r.base)), 1e-30),
    [rows],
  )

  // Pairs whose ranges overlap — surfaced because an overlap means the
  // ordering between those two items is not robust.
  const overlaps = useMemo(() => {
    const out: Array<[string, string]> = []
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if ((rows[i].spread > 0 || rows[j].spread > 0) && rangesOverlap(rows[i], rows[j])) {
          out.push([rows[i].label, rows[j].label])
        }
      }
    }
    return out
  }, [rows])

  if (rows.length === 0) return null

  return (
    <div data-testid="multi-product-sensitivity-chart" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {methodLabel} · {unit}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <NumberFormatControl settings={format.settings} onChange={format.setSettings} />
          <ChartExportButton
            chartRef={chartRef}
            legendRef={mode === 'by_case' ? legendRef : undefined}
            filename={`multi_product_sensitivity_${mode}_${filenameBase}`}
          />
        </div>
      </div>

      <ChartExportContainer ref={chartRef}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map((r) => (
            <div key={r.itemId} data-testid={`sensitivity-row-${r.itemId}`}
                 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 170, flexShrink: 0, fontSize: 'var(--text-xs)',
                color: 'var(--text-primary)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} title={r.label}>{r.label}</div>

              {mode === 'range' ? (
                <div style={{ flex: 1, position: 'relative', height: 22,
                              backgroundColor: 'var(--bg-subtle)', borderRadius: 3 }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 3, height: 16, borderRadius: 2,
                    width: `${(r.base / gmax) * 100}%`, backgroundColor: CHART_PALETTE[0],
                  }} />
                  {r.spread > 0 && (
                    <>
                      <div data-testid={`sensitivity-whisker-${r.itemId}`} style={{
                        position: 'absolute', top: 10, height: 2,
                        left: `${(r.lo / gmax) * 100}%`,
                        width: `${((r.hi - r.lo) / gmax) * 100}%`,
                        backgroundColor: 'var(--warning)',
                      }} />
                      {[r.lo, r.hi].map((v, i) => (
                        <div key={i} style={{
                          position: 'absolute', top: 4, height: 14, width: 2,
                          left: `${(v / gmax) * 100}%`, backgroundColor: 'var(--warning)',
                        }} />
                      ))}
                    </>
                  )}
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {cases.map((c, i) => {
                    const v = r.byCase[c]
                    if (typeof v !== 'number') return null
                    return (
                      <div key={c} data-testid={`bycase-bar-${r.itemId}-${c}`}
                           title={`${c}: ${format.format(v)} ${unit}`}
                           style={{
                             width: `${(v / gmax) * 100}%`, height: 7, borderRadius: 1,
                             backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
                           }} />
                    )
                  })}
                </div>
              )}

              <div style={{
                width: 170, textAlign: 'right', fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
              }}>
                {format.format(r.base)}
                {r.spread > 0 && (
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--warning)' }}>
                    {((r.lo / r.base - 1) * 100).toFixed(1)}% / +{((r.hi / r.base - 1) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </ChartExportContainer>

      {mode === 'by_case' && (
        <div ref={legendRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingTop: 4 }}>
          {cases.map((c, i) => (
            <span key={c} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2, display: 'inline-block',
                backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
              }} />
              {c}
            </span>
          ))}
        </div>
      )}

      {mode === 'range' && overlaps.length > 0 && (
        <div data-testid="sensitivity-overlap-note" style={{
          fontSize: 'var(--text-xs)', color: 'var(--warning)', maxWidth: '78ch',
        }}>
          Ranges overlap for {overlaps.map(([a, b]) => `${a} / ${b}`).join('; ')} —
          the ordering between those items is not robust to the selected cases.
        </div>
      )}
    </div>
  )
}
