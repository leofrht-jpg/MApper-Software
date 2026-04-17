import { useMemo } from 'react'
import type { AESAIndicatorResult } from '../../api/client'

interface RadarChartProps {
  indicators: AESAIndicatorResult[]
  comparison?: AESAIndicatorResult[]
  /** Cap ratios at this value for the visual. Values beyond still draw at maxRatio
   *  but the label shows true value. */
  maxRatio?: number
  size?: number
}

const DEFAULT_MAX = 1.25

/** Custom SVG radial chart — concentric reference rings at 0.25/0.5/0.75/1.0/1.25,
 *  1.0 dashed red (boundary), 0.8 dashed amber (caution). Axes radiate from
 *  center to each boundary label. Impact polygon filled at 25% opacity with
 *  full-opacity stroke; optional comparison polygon dashed. */
export function RadarChart({ indicators, comparison, maxRatio = DEFAULT_MAX, size = 420 }: RadarChartProps) {
  const pad = 60
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - pad

  const n = indicators.length

  const rings = useMemo(
    () => [0.25, 0.5, 0.75, 1.0, 1.25].filter((r) => r <= maxRatio),
    [maxRatio],
  )

  if (n < 3) {
    return (
      <div style={{
        width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center',
      }}>
        Need at least 3 mapped boundaries<br />for the radar view.
      </div>
    )
  }

  const pointFor = (i: number, ratio: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const r = (Math.min(ratio, maxRatio) / maxRatio) * radius
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    }
  }

  const axisEnd = (i: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    }
  }

  const labelPos = (i: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const r = radius + 22
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      anchor: Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end',
    }
  }

  const polygonPath = (values: AESAIndicatorResult[]) => {
    const pts = indicators.map((ind, i) => {
      const match = values.find((v) => v.boundary_id === ind.boundary_id)
      const ratio = match?.ratio ?? 0
      return pointFor(i, ratio)
    })
    return pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z'
  }

  return (
    <svg width={size} height={size} style={{ display: 'block' }} role="img" aria-label="AESA radar chart">
      {rings.map((r) => {
        const rr = (r / maxRatio) * radius
        const isBoundary = r === 1.0
        const isCaution = r === 0.8
        return (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={rr}
            fill="none"
            stroke={isBoundary ? 'var(--danger)' : isCaution ? 'var(--warning)' : 'var(--border-subtle)'}
            strokeWidth={isBoundary ? 1.5 : 1}
            strokeDasharray={isBoundary || isCaution ? '4 4' : undefined}
          />
        )
      })}

      {/* 0.8 caution ring (not in default rings) */}
      {maxRatio >= 0.8 && (
        <circle
          cx={cx}
          cy={cy}
          r={(0.8 / maxRatio) * radius}
          fill="none"
          stroke="var(--warning)"
          strokeWidth={1}
          strokeDasharray="4 4"
          opacity={0.7}
        />
      )}

      {indicators.map((_, i) => {
        const e = axisEnd(i)
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={e.x}
            y2={e.y}
            stroke="var(--border-subtle)"
            strokeWidth={1}
          />
        )
      })}

      {rings.map((r) => {
        const rr = (r / maxRatio) * radius
        return (
          <text
            key={r}
            x={cx + 4}
            y={cy - rr - 2}
            fontSize={10}
            fill="var(--text-tertiary)"
          >
            {r.toFixed(2)}
          </text>
        )
      })}

      {comparison && comparison.length > 0 && (
        <path
          d={polygonPath(comparison)}
          fill="none"
          stroke="var(--mod-plca)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          opacity={0.85}
        />
      )}

      <path
        d={polygonPath(indicators)}
        fill="var(--mod-aesa)"
        fillOpacity={0.25}
        stroke="var(--mod-aesa)"
        strokeWidth={2}
      />

      {indicators.map((ind, i) => {
        const p = pointFor(i, ind.ratio)
        const color =
          ind.status === 'exceeded' ? 'var(--danger)' :
          ind.status === 'caution' ? 'var(--warning)' : 'var(--success)'
        return (
          <circle key={ind.boundary_id} cx={p.x} cy={p.y} r={4} fill={color} stroke="var(--bg-surface)" strokeWidth={1.5} />
        )
      })}

      {indicators.map((ind, i) => {
        const l = labelPos(i)
        return (
          <text
            key={ind.boundary_id + '-label'}
            x={l.x}
            y={l.y}
            fontSize={11}
            fill="var(--text-secondary)"
            textAnchor={l.anchor as 'start' | 'middle' | 'end'}
            dominantBaseline="middle"
          >
            {shortName(ind.boundary_name)}
          </text>
        )
      })}
    </svg>
  )
}

function shortName(name: string): string {
  if (name.length <= 20) return name
  return name.split(' ').map((w) => (w.length > 10 ? w.slice(0, 9) + '…' : w)).join(' ')
}
