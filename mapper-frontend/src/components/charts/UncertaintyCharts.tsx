/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useRef } from 'react'
import type { ArchetypeLCAMethodDistribution, VarianceContributor } from '../../api/client'
import { histogram } from '../../utils/boxStats'
import { ChartExportButton } from './ChartExportButton'
import { ChartExportContainer } from './ChartExportContainer'
import { NumberFormatControl } from './NumberFormatControl'
import { useNumberFormatter } from './numberFormat'

/** Deterministic marker, distinct from the distribution fill so the two never
 *  read as the same quantity. */
const DET_COLOR = '#F59E0B'
const BOX_COLOR = '#60A5FA'
const ROW_COLOR = '#34D399'
const PARAM_COLOR = '#A78BFA'

// ── Box plot: one row per indicator ──────────────────────────────────────────

interface BoxProps {
  distributions: ArchetypeLCAMethodDistribution[]
  filenameBase: string
}

/**
 * Every indicator on one chart, each normalised to its OWN deterministic score.
 *
 * The alternative -- absolute values on a shared axis -- cannot work here:
 * GWP is in kg CO2-eq and ecotoxicity in CTUe, six orders of magnitude apart,
 * so fifteen of the sixteen boxes would collapse to a line. Normalising makes
 * the comparison the useful one anyway: which indicators are more uncertain,
 * not which are larger.
 */
export function UncertaintyBoxPlot({ distributions, filenameBase }: BoxProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(
    () =>
      distributions.map((d) => {
        const base = d.deterministic !== 0 ? Math.abs(d.deterministic) : 1
        return {
          label: d.method_label,
          unit: d.unit,
          lo: d.p2_5 / base,
          q1: d.p25 / base,
          med: d.median / base,
          q3: d.p75 / base,
          hi: d.p97_5 / base,
          det: d.deterministic / base,
          gsd2: d.gsd2,
        }
      }),
    [distributions],
  )

  if (!rows.length) return null

  const lo = Math.min(0, ...rows.map((r) => r.lo))
  const hi = Math.max(...rows.map((r) => Math.max(r.hi, r.det)))
  const pad = (hi - lo) * 0.06 || 0.1
  const xMin = lo - pad
  const xMax = hi + pad

  const LABEL_W = 260
  const W = 900
  const ROW_H = 26
  const H = rows.length * ROW_H + 44
  const plotW = W - LABEL_W - 24
  const x = (v: number) => LABEL_W + ((v - xMin) / (xMax - xMin)) * plotW

  const ticks = 5
  const tickVals = Array.from({ length: ticks }, (_, i) => xMin + ((xMax - xMin) * i) / (ticks - 1))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
        <ChartExportButton chartRef={chartRef} filename={`uncertainty_boxplot_${filenameBase}`} />
      </div>
      <ChartExportContainer ref={chartRef}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Uncertainty by indicator">
          {tickVals.map((t, i) => (
            <g key={i}>
              <line
                x1={x(t)} x2={x(t)} y1={18} y2={H - 26}
                stroke="var(--border-subtle)" strokeWidth={1}
              />
              <text
                x={x(t)} y={H - 10} textAnchor="middle"
                fontSize={11} fill="var(--text-secondary)"
              >
                {t.toFixed(2)}×
              </text>
            </g>
          ))}
          {/* 1.0 = the deterministic score */}
          <line
            x1={x(1)} x2={x(1)} y1={18} y2={H - 26}
            stroke={DET_COLOR} strokeWidth={1.5} strokeDasharray="4 3"
          />
          {rows.map((r, i) => {
            const cy = 26 + i * ROW_H
            return (
              <g key={r.label}>
                <text
                  x={LABEL_W - 10} y={cy + 4} textAnchor="end"
                  fontSize={11} fill="var(--text-primary)"
                >
                  {r.label.length > 40 ? `${r.label.slice(0, 39)}…` : r.label}
                </text>
                {/* whiskers: 2.5th to 97.5th percentile */}
                <line x1={x(r.lo)} x2={x(r.hi)} y1={cy} y2={cy} stroke={BOX_COLOR} strokeWidth={1} />
                <line x1={x(r.lo)} x2={x(r.lo)} y1={cy - 4} y2={cy + 4} stroke={BOX_COLOR} strokeWidth={1} />
                <line x1={x(r.hi)} x2={x(r.hi)} y1={cy - 4} y2={cy + 4} stroke={BOX_COLOR} strokeWidth={1} />
                {/* interquartile box */}
                <rect
                  x={x(r.q1)} y={cy - 7}
                  width={Math.max(x(r.q3) - x(r.q1), 1.5)} height={14}
                  fill={BOX_COLOR} fillOpacity={0.28} stroke={BOX_COLOR} strokeWidth={1}
                />
                {/* median */}
                <line x1={x(r.med)} x2={x(r.med)} y1={cy - 7} y2={cy + 7} stroke={BOX_COLOR} strokeWidth={2} />
                {/* deterministic score */}
                <circle cx={x(r.det)} cy={cy} r={3.2} fill={DET_COLOR} />
              </g>
            )
          })}
        </svg>
      </ChartExportContainer>
      <div style={{ display: 'flex', gap: 18, marginTop: 8, flexWrap: 'wrap', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: BOX_COLOR, opacity: 0.5, marginRight: 6 }} />
          box = 25th–75th, whiskers = 2.5th–97.5th percentile</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: DET_COLOR, marginRight: 6 }} />
          deterministic score (= 1.0×)</span>
      </div>
    </div>
  )
}

// ── Histogram for one indicator ──────────────────────────────────────────────

interface HistProps {
  distribution: ArchetypeLCAMethodDistribution
  filenameBase: string
}

export function UncertaintyHistogram({ distribution, filenameBase }: HistProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const fmt = useNumberFormatter({ notation: 'scientific', sigFigs: 3 })
  const bins = useMemo(() => histogram(distribution.samples ?? []), [distribution.samples])

  if (!distribution.samples?.length) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
        Draws were not retained for this run. Re-run with “Keep samples” enabled to see the histogram.
      </div>
    )
  }
  if (!bins.length) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
        Every draw is identical — nothing in this configuration carries uncertainty.
      </div>
    )
  }

  const W = 900
  const H = 260
  const M = { top: 14, right: 16, bottom: 40, left: 56 }
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const xMin = bins[0].x0
  const xMax = bins[bins.length - 1].x1
  const yMax = Math.max(...bins.map((b) => b.count))
  const x = (v: number) => M.left + ((v - xMin) / (xMax - xMin)) * plotW
  const y = (c: number) => M.top + plotH - (c / yMax) * plotH

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
        <NumberFormatControl settings={fmt.settings} onChange={fmt.setSettings} />
        <ChartExportButton chartRef={chartRef} filename={`uncertainty_histogram_${filenameBase}`} />
      </div>
      <ChartExportContainer ref={chartRef}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distribution of sampled scores">
          <line x1={M.left} x2={W - M.right} y1={M.top + plotH} y2={M.top + plotH} stroke="var(--border-default)" />
          <line x1={M.left} x2={M.left} y1={M.top} y2={M.top + plotH} stroke="var(--border-default)" />
          {bins.map((b, i) => (
            <rect
              key={i}
              x={x(b.x0)} y={y(b.count)}
              width={Math.max(x(b.x1) - x(b.x0) - 1, 1)}
              height={M.top + plotH - y(b.count)}
              fill={BOX_COLOR} fillOpacity={0.6}
            />
          ))}
          {/* the two numbers worth reading off this chart */}
          <line x1={x(distribution.median)} x2={x(distribution.median)} y1={M.top} y2={M.top + plotH} stroke={BOX_COLOR} strokeWidth={2} />
          <line
            x1={x(distribution.deterministic)} x2={x(distribution.deterministic)}
            y1={M.top} y2={M.top + plotH}
            stroke={DET_COLOR} strokeWidth={2} strokeDasharray="4 3"
          />
          {[xMin, (xMin + xMax) / 2, xMax].map((t, i) => (
            <text key={i} x={x(t)} y={H - 16} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
              {fmt.format(t)}
            </text>
          ))}
          <text x={W / 2} y={H - 2} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
            {distribution.unit}
          </text>
          {[0, yMax].map((c, i) => (
            <text key={i} x={M.left - 8} y={y(c) + 4} textAnchor="end" fontSize={11} fill="var(--text-secondary)">
              {c}
            </text>
          ))}
        </svg>
      </ChartExportContainer>
      <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: BOX_COLOR, marginRight: 6, verticalAlign: 'middle' }} />median</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: DET_COLOR, marginRight: 6, verticalAlign: 'middle' }} />deterministic</span>
      </div>
    </div>
  )
}

// ── Contribution to variance ─────────────────────────────────────────────────

interface VarProps {
  contributors: VarianceContributor[]
  filenameBase: string
}

/**
 * Which rows and parameters drive the spread.
 *
 * This is the chart that changes how a BOM gets authored: it says where a
 * better data source would actually narrow the result, as opposed to where
 * the impact happens to be largest.
 */
export function VarianceContributionBar({ contributors, filenameBase }: VarProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(
    () => contributors.filter((c) => c.share > 0.001).slice(0, 15),
    [contributors],
  )

  if (!rows.length) {
    return (
      <div data-testid="mc-no-contributors" style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
        No foreground input carries uncertainty, so the whole spread comes from the background
        database. Tag a BOM row or a parameter to see what drives it.
      </div>
    )
  }

  const LABEL_W = 300
  const W = 900
  const ROW_H = 24
  const H = rows.length * ROW_H + 16
  const plotW = W - LABEL_W - 90
  const max = Math.max(...rows.map((r) => r.share))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ChartExportButton chartRef={chartRef} filename={`uncertainty_variance_${filenameBase}`} />
      </div>
      <ChartExportContainer ref={chartRef}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Contribution to variance">
          {rows.map((r, i) => {
            const cy = 8 + i * ROW_H
            const w = (r.share / max) * plotW
            const color = r.kind === 'row' ? ROW_COLOR : PARAM_COLOR
            return (
              <g key={`${r.kind}:${r.name}`}>
                <text x={LABEL_W - 10} y={cy + 13} textAnchor="end" fontSize={11} fill="var(--text-primary)">
                  {r.name.length > 44 ? `${r.name.slice(0, 43)}…` : r.name}
                </text>
                <rect x={LABEL_W} y={cy + 3} width={Math.max(w, 1)} height={15} fill={color} fillOpacity={0.75} rx={2} />
                <text x={LABEL_W + Math.max(w, 1) + 8} y={cy + 15} fontSize={11} fill="var(--text-secondary)">
                  {(r.share * 100).toFixed(1)}%
                </text>
              </g>
            )
          })}
        </svg>
      </ChartExportContainer>
      <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: ROW_COLOR, marginRight: 6 }} />BOM row</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: PARAM_COLOR, marginRight: 6 }} />parameter</span>
        <span>Shares are an approximate attribution (squared rank correlation, normalised) — the inputs are not orthogonal.</span>
      </div>
    </div>
  )
}
