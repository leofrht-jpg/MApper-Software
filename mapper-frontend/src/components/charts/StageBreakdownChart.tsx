/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useRef, useState } from 'react'
import { ChartExportButton } from './ChartExportButton'
import { ChartExportContainer } from './ChartExportContainer'
import { NumberFormatControl } from './NumberFormatControl'
import { type useNumberFormatter } from './numberFormat'
import { CHART_PALETTE } from '../../utils/chartColors'

type NumberFormatterAPI = ReturnType<typeof useNumberFormatter>

interface MethodRow {
  method_label: string
  score: number
  unit: string
}

interface Props {
  // Patch 4B — per-method × per-stage subtotal of impact (scope=all only).
  // Shape mirrors the backend response: { method_label: { stage: score } }.
  stageBreakdown: Record<string, Record<string, number>>
  methods: MethodRow[]
  format: NumberFormatterAPI
  // Used as part of the chart export filename suffix.
  filenameBase: string
}

export function StageBreakdownChart({ stageBreakdown, methods, format, filenameBase }: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ method: string; stage: string } | null>(null)

  // Stable stage order: first appearance in the first method's breakdown.
  // Stages come from BOM root names which are consistent across methods.
  const stageOrder = useMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const method of methods) {
      const subtotals = stageBreakdown[method.method_label]
      if (!subtotals) continue
      for (const stage of Object.keys(subtotals)) {
        if (!seen.has(stage)) {
          seen.add(stage)
          order.push(stage)
        }
      }
    }
    return order
  }, [methods, stageBreakdown])

  const stageColors = useMemo(() => {
    const map: Record<string, string> = {}
    stageOrder.forEach((stage, idx) => {
      map[stage] = CHART_PALETTE[idx % CHART_PALETTE.length]
    })
    return map
  }, [stageOrder])

  if (stageOrder.length === 0) return null

  return (
    <div data-testid="stage-breakdown-chart" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
          Stage breakdown
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <NumberFormatControl settings={format.settings} onChange={format.setSettings} />
          <ChartExportButton chartRef={chartRef} filename={`single_product_stage_breakdown_${filenameBase}`} />
        </div>
      </div>

      <ChartExportContainer ref={chartRef}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {methods.map((m) => {
            const subtotals = stageBreakdown[m.method_label] ?? {}
            const total = Object.values(subtotals).reduce((a, b) => a + b, 0)
            const denom = Math.abs(total) > 1e-30 ? Math.abs(total) : 1
            return (
              <div
                key={m.method_label}
                data-testid={`stage-breakdown-row-${m.method_label}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <div style={{ width: 200, flexShrink: 0 }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.method_label}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{m.unit}</div>
                </div>

                <div style={{ flex: 1, position: 'relative', height: 24, display: 'flex', alignItems: 'center' }}>
                  <div style={{ display: 'flex', width: '100%', height: 20, borderRadius: 'var(--radius-sm)', overflow: 'hidden', backgroundColor: 'var(--bg-subtle)' }}>
                    {stageOrder.map((stage) => {
                      const v = subtotals[stage] ?? 0
                      const pct = (Math.abs(v) / denom) * 100
                      if (pct < 0.01) return null
                      const isHovered = hover?.method === m.method_label && hover.stage === stage
                      return (
                        <div
                          key={stage}
                          data-testid={`stage-segment-${m.method_label}-${stage}`}
                          onMouseEnter={() => setHover({ method: m.method_label, stage })}
                          onMouseLeave={() => setHover(null)}
                          style={{
                            width: `${pct}%`,
                            backgroundColor: stageColors[stage],
                            opacity: isHovered ? 1 : 0.85,
                            transition: 'opacity var(--duration-fast) var(--ease-out)',
                            cursor: 'default',
                          }}
                          title={`${stage}: ${format.format(v)} ${m.unit} (${pct.toFixed(1)}%)`}
                        />
                      )
                    })}
                  </div>
                </div>

                <div style={{ width: 100, textAlign: 'right', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {format.format(total)}
                </div>
              </div>
            )
          })}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginLeft: 212, paddingTop: 4 }}>
            {stageOrder.map((stage) => (
              <div key={stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, backgroundColor: stageColors[stage], borderRadius: 2 }} />
                {stage}
              </div>
            ))}
          </div>
        </div>
      </ChartExportContainer>
    </div>
  )
}
