import { useMemo, useState } from 'react'
import type { SustainabilityRatioResult } from '../../api/client'
import { ZONE_COLOR, shortPbName, srOrInf, fmtSR } from './zones'

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
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
                <title>{`${r.pb_name}: SR=${fmtSR(r.sr)} (${r.zone})`}</title>
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

      {years.length > 1 && (
        <div style={{ width: '80%', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{years[0]}</span>
          <input
            type="range"
            min={years[0]}
            max={years[years.length - 1]}
            step={1}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--mod-aesa)' }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{years[years.length - 1]}</span>
          <span style={{
            minWidth: 50, textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
          }}>
            {year}
          </span>
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
