/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useRef, useState } from 'react'
import type { SustainabilityRatioResult } from '../../api/client'
import { ZONE_COLOR, shortPbName, srOrInf } from './zones'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import { YearSlider } from '../ui/YearSlider'

interface Props {
  results: SustainabilityRatioResult[]
  size?: number
}

const MAX_DISPLAY_SR = 3.0

export function RadarView({ results, size = 480 }: Props) {
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

  const pad = 80
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - pad
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
  const labelPos = (i: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const r = radius + 20
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      anchor: Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end',
    }
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
      <svg width={size} height={size} style={{ display: 'block' }} role="img">
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

        {/* Ring labels */}
        <text x={cx + 4} y={cy - rSafe - 2} fontSize={10} fill={ZONE_COLOR.safe}>SR=1.0</text>
        <text x={cx + 4} y={cy - rUncert - 2} fontSize={10} fill={ZONE_COLOR.zone_of_uncertainty}>SR=2.0</text>

        {/* Polygon */}
        <path d={polygonPath} fill="var(--mod-aesa)" fillOpacity={0.2} stroke="var(--mod-aesa)" strokeWidth={2} />

        {/* Points */}
        {yearResults.map((r, i) => {
          const p = pointFor(i, r.sr)
          return (
            <g key={r.pb_id}>
              <circle cx={p.x} cy={p.y} r={5} fill={ZONE_COLOR[r.zone]} stroke="var(--bg-surface)" strokeWidth={1.5}>
                <title>{`${r.pb_name}: SR=${fmtSRDisplay(r.sr)} (${r.zone})`}</title>
              </circle>
            </g>
          )
        })}

        {/* Labels */}
        {yearResults.map((r, i) => {
          const l = labelPos(i)
          return (
            <text
              key={r.pb_id + '-l'}
              x={l.x}
              y={l.y}
              fontSize={10}
              fill="var(--text-secondary)"
              textAnchor={l.anchor as 'start' | 'middle' | 'end'}
              dominantBaseline="middle"
            >
              {shortPbName(r.pb_name)}
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
