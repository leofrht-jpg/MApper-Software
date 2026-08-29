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

type Fmt = ReturnType<typeof useNumberFormatter>

export interface CaseValue { case: string; value: number }

/** min / max / Base across the selected cases. */
export function rangeOf(values: CaseValue[], base: number) {
  const vs = values.map((v) => v.value)
  const lo = Math.min(base, ...vs)
  const hi = Math.max(base, ...vs)
  return { lo, hi, base, spread: hi - lo }
}

/** Cases ordered by |Δ from Base|, biggest first, with near-zero movers
 *  separated out.
 *
 * The point of a tornado is to answer "which case actually matters". With a
 * sparse study most cases move nothing, and listing them as six near-zero bars
 * buries the one that does. Anything under `epsilon` relative to Base is
 * collected into a count instead of drawn.
 */
export function tornadoRows(
  values: CaseValue[], base: number, epsilon = 0.001,
): { movers: Array<CaseValue & { delta: number; rel: number }>; flat: string[] } {
  const movers: Array<CaseValue & { delta: number; rel: number }> = []
  const flat: string[] = []
  for (const v of values) {
    const delta = v.value - base
    const rel = base !== 0 ? delta / Math.abs(base) : 0
    if (Math.abs(rel) < epsilon) flat.push(v.case)
    else movers.push({ ...v, delta, rel })
  }
  movers.sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel))
  return { movers, flat }
}

interface Props {
  /** Base value for the active method. */
  base: number
  /** One entry per non-Base selected case. */
  cases: CaseValue[]
  unit: string
  label: string
  format: Fmt
  filenameBase: string
}

export function SensitivityRangeChart({
  base, cases, unit, label, format, filenameBase,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const { lo, hi, spread } = useMemo(() => rangeOf(cases, base), [cases, base])
  const { movers, flat } = useMemo(() => tornadoRows(cases, base), [cases, base])

  if (cases.length === 0) return null

  const axisLo = Math.min(lo, base) * 0.98
  const axisHi = Math.max(hi, base) * 1.02
  const span = axisHi - axisLo || 1
  const pos = (v: number) => ((v - axisLo) / span) * 100

  return (
    <div data-testid="sensitivity-range-chart" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        }}>
          Sensitivity range · {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <NumberFormatControl settings={format.settings} onChange={format.setSettings} />
          <ChartExportButton rasterOnly chartRef={chartRef} filename={`single_product_sensitivity_${filenameBase}`} />
        </div>
      </div>

      <ChartExportContainer ref={chartRef}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Range around Base */}
          <div data-testid="sensitivity-range-band" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 90, flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              Range
            </div>
            <div style={{ flex: 1, position: 'relative', height: 26 }}>
              <div style={{
                position: 'absolute', top: 12, left: 0, right: 0, height: 1,
                backgroundColor: 'var(--border-subtle)',
              }} />
              {spread > 0 && (
                <div style={{
                  position: 'absolute', top: 11, height: 3, borderRadius: 2,
                  left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%`,
                  backgroundColor: 'var(--warning)',
                }} />
              )}
              {[lo, hi].map((v, i) => (
                <div key={i} style={{
                  position: 'absolute', top: 6, left: `${pos(v)}%`,
                  width: 2, height: 14, backgroundColor: 'var(--warning)',
                }} />
              ))}
              <div
                data-testid="sensitivity-base-marker"
                style={{
                  position: 'absolute', top: 3, left: `${pos(base)}%`,
                  width: 2, height: 20, backgroundColor: 'var(--mod-lca)',
                }}
              />
            </div>
            <div style={{
              width: 190, textAlign: 'right', fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
            }}>
              {format.format(base)} {unit}
              {spread > 0 && (
                <span style={{ display: 'block', fontSize: 10, color: 'var(--warning)' }}>
                  {((lo / base - 1) * 100).toFixed(1)}% / +{((hi / base - 1) * 100).toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          {/* Tornado — only the cases that move anything */}
          <div data-testid="sensitivity-tornado" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {movers.map((m) => {
              const w = Math.min(100, Math.abs(m.rel) * 100 / Math.max(
                ...movers.map((x) => Math.abs(x.rel)), 1e-9) * 100)
              return (
                <div key={m.case} data-testid={`tornado-row-${m.case}`}
                     style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 90, flexShrink: 0, fontSize: 10, color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={m.case}>{m.case}</div>
                  <div style={{ flex: 1, height: 14, backgroundColor: 'var(--bg-subtle)', borderRadius: 2 }}>
                    <div style={{
                      width: `${w}%`, height: 14, borderRadius: 2,
                      backgroundColor: m.rel >= 0 ? 'var(--danger)' : 'var(--success)',
                    }} />
                  </div>
                  <div style={{
                    width: 190, textAlign: 'right', fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    color: m.rel >= 0 ? 'var(--danger)' : 'var(--success)',
                  }}>
                    {m.rel >= 0 ? '+' : ''}{(m.rel * 100).toFixed(2)}%
                  </div>
                </div>
              )
            })}
            {flat.length > 0 && (
              <div data-testid="sensitivity-tornado-flat"
                   style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 102 }}>
                {flat.length} case{flat.length === 1 ? '' : 's'} move the total by
                less than 0.1% and are not drawn: {flat.join(', ')}
              </div>
            )}
            {movers.length === 0 && (
              <div data-testid="sensitivity-tornado-empty"
                   style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                No selected case moves this indicator.
              </div>
            )}
          </div>
        </div>
      </ChartExportContainer>
    </div>
  )
}
