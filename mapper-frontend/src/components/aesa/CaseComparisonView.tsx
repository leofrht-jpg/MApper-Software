/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useRef } from 'react'
import type { AESACase, AESAZone, SustainabilityRatioResult } from '../../api/client'
import { SCENARIO_PALETTE } from '../../utils/chartColors'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { ZONE_COLOR, ZONE_LABEL, fmtSR } from './zones'

/**
 * Every selected case against a reference, per impact category, for one year:
 * the parameter cases against Base under the chosen sharing, or -- when the run
 * has no parameter cases -- the sharing choices against the base chain.
 *
 * x is the SR difference from the base (case − base), centred on zero; one mark
 * per case. A case that moves the category into a different zone is drawn as a
 * diamond in the NEW zone's colour, so a class change reads at a glance without
 * a note. Follows the figure rules: dashed outer edge, legend at the bottom, no
 * captions inside the frame, categories by their conventional abbreviation
 * (full name in each mark's tooltip). Existing colours only: the scenario
 * palette for cases, the zone colours for zones.
 */
export function CaseComparisonView({ base, cases, year, acronyms, referenceLabel = 'base' }: {
  base: SustainabilityRatioResult[]
  cases: AESACase[]
  year: number
  acronyms: Record<string, string>
  /** What every Δ is taken against, e.g. "Base, under AR". Named on the axis
   *  and in each mark's tooltip. */
  referenceLabel?: string
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const byYear = base.filter((r) => r.year === year)
    return byYear.map((b) => ({
      base: b,
      label: acronyms[b.pb_id] || b.pb_short_name || b.pb_name,
      marks: cases.map((c, i) => {
        const v = c.results.find((r) => r.year === year && r.pb_id === b.pb_id)
        const delta = v && v.sr != null && b.sr != null ? v.sr - b.sr : null
        return { c, i, v, delta, changed: !!v && v.zone !== b.zone }
      }),
    }))
  }, [base, cases, year, acronyms])

  if (cases.length === 0) {
    return (
      <div data-testid="aesa-cases-empty" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', padding: 'var(--space-4)' }}>
        No sensitivity cases in this result. Tick "Sharing sensitivity" or keep parameter cases selected in the case window, then Compute.
      </div>
    )
  }

  const maxAbs = Math.max(1e-9, ...rows.flatMap((r) => r.marks.map((m) => Math.abs(m.delta ?? 0))))
  const labelW = 72, W = 640, rowH = 22, top = 8, axisH = 34
  const plotL = labelW, plotR = W - 12
  const x = (d: number) => plotL + ((d + maxAbs) / (2 * maxAbs)) * (plotR - plotL)
  const H = top + rows.length * rowH + axisH
  const ticks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ChartExportButton chartRef={frameRef} legendRef={legendRef} filename={`aesa_cases_${year}`} />
      </div>
      <ChartExportContainer
        ref={frameRef}
        className="aesa-cases-frame"
        style={{
          border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        }}
      >
        <svg
          data-chart-export-target=""
          data-testid="aesa-cases-svg"
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: 'block' }}
        >
          <line x1={x(0)} x2={x(0)} y1={top} y2={top + rows.length * rowH} stroke="var(--border-default)" />
          {rows.map((r, ri) => {
            const cy = top + ri * rowH + rowH / 2
            return (
              <g key={r.base.pb_id} data-testid={`aesa-cases-row-${r.base.pb_id}`}>
                <text x={labelW - 8} y={cy} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--text-secondary)">
                  <title>{r.base.pb_name}</title>
                  {r.label}
                </text>
                <line x1={plotL} x2={plotR} y1={cy} y2={cy} stroke="var(--border-subtle)" />
                {r.marks.map((m) => {
                  if (m.delta == null || !m.v) return null
                  const cx = x(m.delta)
                  const color = SCENARIO_PALETTE[m.i % SCENARIO_PALETTE.length]
                  const title = `${r.base.pb_name} · ${m.c.label}\nSR ${fmtSR(m.v.sr)} vs ${referenceLabel} ${fmtSR(r.base.sr)} (Δ ${m.delta >= 0 ? '+' : ''}${m.delta.toPrecision(3)})\n` +
                    `${ZONE_LABEL[r.base.zone]} → ${ZONE_LABEL[m.v.zone as AESAZone]}`
                  return m.changed ? (
                    <polygon
                      key={m.c.id}
                      data-testid={`aesa-cases-mark-${r.base.pb_id}-${m.c.id}`}
                      data-zone-change="true"
                      points={`${cx},${cy - 6} ${cx + 6},${cy} ${cx},${cy + 6} ${cx - 6},${cy}`}
                      fill={ZONE_COLOR[m.v.zone as AESAZone]} stroke={color} strokeWidth={2}
                    >
                      <title>{title}</title>
                    </polygon>
                  ) : (
                    <circle
                      key={m.c.id}
                      data-testid={`aesa-cases-mark-${r.base.pb_id}-${m.c.id}`}
                      cx={cx} cy={cy} r={4.5} fill={color}
                    >
                      <title>{title}</title>
                    </circle>
                  )
                })}
              </g>
            )
          })}
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={top + rows.length * rowH + 14} textAnchor="middle" fontSize={10} fill="var(--text-tertiary)">
              {t === 0 ? '0' : `${t > 0 ? '+' : ''}${Number(t.toPrecision(2))}`}
            </text>
          ))}
          <text x={(plotL + plotR) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
            ΔSR vs {referenceLabel}
          </text>
        </svg>
        <div ref={legendRef} data-testid="aesa-cases-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: 'var(--text-secondary)' }}>
          {cases.map((c, i) => (
            <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: SCENARIO_PALETTE[i % SCENARIO_PALETTE.length] }} />
              {c.label}
            </span>
          ))}
          {(['safe', 'zone_of_uncertainty', 'high_risk'] as AESAZone[]).map((z) => (
            <span key={z} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 9, height: 9, transform: 'rotate(45deg)', background: ZONE_COLOR[z] }} />
              Zone changed to {ZONE_LABEL[z]}
            </span>
          ))}
        </div>
      </ChartExportContainer>
    </div>
  )
}
