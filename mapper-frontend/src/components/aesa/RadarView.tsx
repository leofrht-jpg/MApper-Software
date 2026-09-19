/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useRef, useState } from 'react'
import type { AESACoverageGap, SustainabilityRatioResult } from '../../api/client'
import { NOT_SPECIFIED_HATCH, gapsForPb, notSpecifiedTitle } from '../authored/CoverageMarkers'
import { ZONE_COLOR, srOrInf } from './zones'
import { boundaryLabel, radarLabelLayout } from '../../utils/aesaBoundaryLabels'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import { YearSlider } from '../ui/YearSlider'

interface Props {
  results: SustainabilityRatioResult[]
  size?: number
  /** Axes whose SR rests on a partial authored activity: drawn hatched, the
   *  vertex hollow -- the SR is a lower bound, not a value to read. */
  coverageGaps?: AESACoverageGap[] | null
}

const MAX_DISPLAY_SR = 3.0

export function RadarView({ results, size = 480, coverageGaps }: Props) {
  const years = useMemo(() => {
    const s = new Set<number>()
    for (const r of results) s.add(r.year)
    return Array.from(s).sort((a, b) => a - b)
  }, [results])

  const [year, setYear] = useState(() => years[years.length - 1] ?? 0)
  const radarRef = useRef<HTMLDivElement>(null)
  // SR values cluster around 1.0 (sustainability ratio). Scientific/SI
  // notation makes no sense — restrict to Fixed only.
  const srFormat = useNumberFormatter({ notation: 'fixed', decimals: 3 })
  const fmtSRDisplay = (sr: number | null) => {
    if (sr === null || !isFinite(sr)) return '∞'
    return srFormat.format(sr)
  }
  const yearResults = useMemo(
    () => results.filter((r) => r.year === year),
    [results, year],
  )

  if (!years.length) {
    return <EmptyBox msg="No results to plot" />
  }
  if (yearResults.length < 3) {
    return <EmptyBox msg={`Need at least 3 mapped boundaries for the radar view (year ${year}).`} />
  }

  // Labels come from the boundary record (pb_short_name, stamped by the
  // engine) and wrap onto two lines on EF's own comma — never truncated
  // mid-word, which is what produced "Ecotoxici… freshwater". The layout
  // derives its padding from the widest line, so nothing runs off the canvas.
  const labelInfo = yearResults.map((r) => boundaryLabel(r))
  const layout = radarLabelLayout(labelInfo.map((l) => l.lines), size)
  const cx = size / 2
  const cy = size / 2
  const radius = layout.radius
  const n = yearResults.length

  const pointFor = (i: number, sr: number | null) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const clamped = Math.min(srOrInf(sr), MAX_DISPLAY_SR)
    const r = (clamped / MAX_DISPLAY_SR) * radius
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  }
  const axisEnd = (i: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }
  }

  const polygonPath = yearResults.map((r, i) => {
    const p = pointFor(i, r.sr)
    return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }).join(' ') + ' Z'

  const rSafe = (1.0 / MAX_DISPLAY_SR) * radius
  const rUncert = (2.0 / MAX_DISPLAY_SR) * radius

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <NumberFormatControl
          settings={srFormat.settings}
          onChange={srFormat.setSettings}
          notations={['fixed']}
        />
        <ChartExportButton chartRef={radarRef} filename={`aesa_radar_${year}`} />
      </div>
      <ChartExportContainer ref={radarRef} style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ display: 'block' }} role="img" data-chart-export-target>
        {/* Zone-shaded background: safe → uncertainty → high_risk */}
        <circle cx={cx} cy={cy} r={radius} fill={ZONE_COLOR.high_risk} fillOpacity={0.08} />
        <circle cx={cx} cy={cy} r={rUncert} fill={ZONE_COLOR.zone_of_uncertainty} fillOpacity={0.12} />
        <circle cx={cx} cy={cy} r={rSafe} fill={ZONE_COLOR.safe} fillOpacity={0.14} />

        {/* Zone boundary rings */}
        <circle cx={cx} cy={cy} r={rSafe} fill="none" stroke={ZONE_COLOR.safe} strokeWidth={1.5} strokeDasharray="4 3" />
        <circle cx={cx} cy={cy} r={rUncert} fill="none" stroke={ZONE_COLOR.zone_of_uncertainty} strokeWidth={1.5} strokeDasharray="4 3" />

        {/* Axes */}
        {yearResults.map((_, i) => {
          const e = axisEnd(i)
          return <line key={i} x1={cx} y1={cy} x2={e.x} y2={e.y} stroke="var(--border-subtle)" strokeWidth={1} />
        })}

        {/* Not-specified axes: a hatched band along the axis. */}
        <defs>
          <pattern id="radar-not-specified" patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={5} stroke={NOT_SPECIFIED_HATCH} strokeWidth={2} />
          </pattern>
        </defs>
        {yearResults.map((r, i) => {
          const g = gapsForPb(coverageGaps, r.pb_id)
          if (!g.length) return null
          const angleDeg = -90 + (i * 360) / n
          return (
            <rect
              key={r.pb_id + '-ns'}
              data-testid={`radar-not-specified-${r.pb_id}`}
              x={cx} y={cy - 7} width={radius} height={14}
              fill="url(#radar-not-specified)" fillOpacity={0.9}
              transform={`rotate(${angleDeg} ${cx} ${cy})`}
            >
              <title>{notSpecifiedTitle(g)}</title>
            </rect>
          )
        })}

        {/* Ring labels */}
        <text x={cx + 4} y={cy - rSafe - 2} fontSize={10} fill={ZONE_COLOR.safe}>SR=1.0</text>
        <text x={cx + 4} y={cy - rUncert - 2} fontSize={10} fill={ZONE_COLOR.zone_of_uncertainty}>SR=2.0</text>

        {/* Polygon */}
        <path d={polygonPath} fill="var(--mod-aesa)" fillOpacity={0.2} stroke="var(--mod-aesa)" strokeWidth={2} />

        {/* Points */}
        {yearResults.map((r, i) => {
          const p = pointFor(i, r.sr)
          const g = gapsForPb(coverageGaps, r.pb_id)
          return (
            <g key={r.pb_id}>
              {g.length ? (
                // Hollow: a lower bound, not a value.
                <circle cx={p.x} cy={p.y} r={5} fill="none" stroke={NOT_SPECIFIED_HATCH} strokeWidth={2} strokeDasharray="2 2">
                  <title>{`${r.pb_name}: SR ≥ ${fmtSRDisplay(r.sr)} (not specified)\n\n${notSpecifiedTitle(g)}`}</title>
                </circle>
              ) : (
                <circle cx={p.x} cy={p.y} r={5} fill={ZONE_COLOR[r.zone]} stroke="var(--bg-surface)" strokeWidth={1.5}>
                  <title>{`${r.pb_name}: SR=${fmtSRDisplay(r.sr)} (${r.zone})`}</title>
                </circle>
              )}
            </g>
          )
        })}

        {/* Labels — real SVG <text>, with the full EF category name in a
            <title> so hover works AND the name survives export (chart export
            serialises this svg; an HTML overlay would be dropped). */}
        {yearResults.map((r, i) => {
          const box = layout.labels[i]
          const { full } = labelInfo[i]
          const lineH = layout.fontPx + 1
          const firstDy = -((box.lines.length - 1) * lineH) / 2
          return (
            <text
              key={r.pb_id + '-l'}
              data-testid={`radar-label-${r.pb_id}`}
              x={box.x}
              y={box.y}
              fontSize={layout.fontPx}
              fill="var(--text-secondary)"
              textAnchor={box.anchor}
              dominantBaseline="middle"
            >
              <title>{full}</title>
              {box.lines.map((line, li) => (
                <tspan key={li} x={box.x} dy={li === 0 ? firstDy : lineH}>{line}</tspan>
              ))}
            </text>
          )
        })}
      </svg>
      </ChartExportContainer>

      {years.length > 1 && (
        <div style={{ width: '80%' }}>
          <YearSlider
            years={years}
            value={year}
            onChange={setYear}
            accentColor="var(--mod-aesa)"
            variant="inline"
            showDots={years.length <= 30}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-secondary)' }}>
        {(['safe', 'zone_of_uncertainty', 'high_risk'] as const).map((z) => (
          <span key={z} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ZONE_COLOR[z] }} />
            {z.replace(/_/g, ' ')}
          </span>
        ))}
        {!!coverageGaps?.length && yearResults.some((r) => gapsForPb(coverageGaps, r.pb_id).length) && (
          <span data-testid="radar-legend-not-specified" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 8, background: `repeating-linear-gradient(45deg, ${NOT_SPECIFIED_HATCH} 0 2px, transparent 2px 4px)` }} />
            not specified (SR is a lower bound)
          </span>
        )}
      </div>
    </div>
  )
}

function EmptyBox({ msg }: { msg: string }) {
  return (
    <div style={{
      padding: 'var(--space-6)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
      textAlign: 'center',
    }}>
      {msg}
    </div>
  )
}
