import { useMemo, useState } from 'react'
import type { AESAComputeResult, SharingPrincipleId, SustainabilityRatioResult } from '../../api/client'
import { PRINCIPLE_COLOR, ZONE_COLOR, shortPbName, srOrInf } from './zones'

interface Props {
  result: AESAComputeResult
}

interface BoxStats {
  min: number
  q1: number
  median: number
  q3: number
  max: number
  values: number[]
}

const PRINCIPLES: SharingPrincipleId[] = ['EpC', 'IN', 'AGR', 'LA', 'AR']

const MULTI_D_COLOR = '#A78BFA'

export function BoxPlotView({ result }: Props) {
  const years = useMemo(() => {
    const s = new Set<number>()
    for (const r of result.results) s.add(r.year)
    return Array.from(s).sort((a, b) => a - b)
  }, [result.results])

  const [year, setYear] = useState(() => years[years.length - 1] ?? 0)

  const yearResults = useMemo(
    () => result.results.filter((r) => r.year === year),
    [result.results, year],
  )

  const sensitivity = result.sensitivity ?? null

  // Build per-PB stats: { pb_id: { 'Multi-D': stats, EpC: stats, ... } }
  const perPB = useMemo(() => {
    const pbMap = new Map<string, { name: string; byScenario: Record<string, BoxStats> }>()
    const upsert = (pb_id: string, pb_name: string, scenario: string, values: number[]) => {
      if (!pbMap.has(pb_id)) pbMap.set(pb_id, { name: pb_name, byScenario: {} })
      pbMap.get(pb_id)!.byScenario[scenario] = boxStats(values)
    }
    // Multi-D: single value per PB — treat as degenerate box
    for (const r of yearResults) {
      upsert(r.pb_id, r.pb_name, 'Multi-D', [srOrInf(r.sr)])
    }
    if (sensitivity) {
      for (const p of PRINCIPLES) {
        const arr = sensitivity[p]
        if (!arr) continue
        const byYear = arr.filter((r) => r.year === year)
        for (const r of byYear) {
          upsert(r.pb_id, r.pb_name, p, [srOrInf(r.sr)])
        }
      }
    }
    return Array.from(pbMap.entries()).map(([id, v]) => ({ pb_id: id, pb_name: v.name, byScenario: v.byScenario }))
  }, [yearResults, sensitivity, year])

  // Global SR max for scale (must be declared before any early return to keep hook order stable)
  const maxSR = useMemo(() => {
    let m = 2.5
    for (const row of perPB) {
      for (const s of Object.values(row.byScenario)) {
        if (s.max > m) m = s.max
      }
    }
    return Math.min(m, 10) // cap visual
  }, [perPB])

  if (!perPB.length) {
    return <Empty msg="No sensitivity data. Enable 'Run sensitivity' in the sidebar and re-compute." />
  }

  const W = 900
  const rowH = 46
  const pbLabelW = 160
  const scenarioLabelW = 56
  const H = perPB.length * rowH + 30

  const xFor = (sr: number) => pbLabelW + scenarioLabelW + (Math.min(sr, maxSR) / maxSR) * (W - pbLabelW - scenarioLabelW - 10)
  const scenarios = sensitivity ? ['Multi-D', ...PRINCIPLES] : ['Multi-D']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Multi-D vs uniform sharing principles — SR distribution per boundary
        </div>
        {years.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Year:</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={selStyle}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
      </div>

      <div style={{ overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
        <svg width={W} height={H} style={{ display: 'block' }}>
          {/* Zone shading */}
          <rect x={xFor(0)} y={0} width={xFor(1) - xFor(0)} height={H} fill={ZONE_COLOR.safe} fillOpacity={0.06} />
          <rect x={xFor(1)} y={0} width={xFor(2) - xFor(1)} height={H} fill={ZONE_COLOR.zone_of_uncertainty} fillOpacity={0.06} />
          <rect x={xFor(2)} y={0} width={W - xFor(2)} height={H} fill={ZONE_COLOR.high_risk} fillOpacity={0.06} />

          {/* Reference lines */}
          <line x1={xFor(1)} x2={xFor(1)} y1={0} y2={H} stroke={ZONE_COLOR.safe} strokeDasharray="3 3" strokeWidth={1} />
          <line x1={xFor(2)} x2={xFor(2)} y1={0} y2={H} stroke={ZONE_COLOR.zone_of_uncertainty} strokeDasharray="3 3" strokeWidth={1} />

          {/* Rows */}
          {perPB.map((row, ri) => {
            const y0 = ri * rowH + 4
            return (
              <g key={row.pb_id}>
                {/* PB label */}
                <text x={6} y={y0 + rowH / 2} fontSize={11} fill="var(--text-primary)" dominantBaseline="middle">
                  {shortPbName(row.pb_name)}
                </text>
                {/* Scenarios stacked mini-rows */}
                {scenarios.map((sc, si) => {
                  const stats = row.byScenario[sc]
                  if (!stats) return null
                  const subH = (rowH - 6) / scenarios.length
                  const cy = y0 + 3 + si * subH + subH / 2
                  const isMultiD = sc === 'Multi-D'
                  const color = isMultiD ? MULTI_D_COLOR : PRINCIPLE_COLOR[sc as SharingPrincipleId]
                  const single = stats.values.length === 1
                  return (
                    <g key={sc}>
                      <text
                        x={pbLabelW + 4}
                        y={cy}
                        fontSize={9}
                        fill={color}
                        fontWeight={isMultiD ? 700 : 500}
                        dominantBaseline="middle"
                      >
                        {sc}
                      </text>
                      {single ? (
                        <circle
                          cx={xFor(stats.median)}
                          cy={cy}
                          r={isMultiD ? 4 : 3}
                          fill={color}
                          stroke={isMultiD ? 'var(--bg-surface)' : 'none'}
                          strokeWidth={1.5}
                        >
                          <title>{`${sc}: SR=${stats.median.toFixed(3)}`}</title>
                        </circle>
                      ) : (
                        <>
                          <line x1={xFor(stats.min)} x2={xFor(stats.max)} y1={cy} y2={cy} stroke={color} strokeWidth={1} />
                          <rect
                            x={xFor(stats.q1)}
                            y={cy - 5}
                            width={Math.max(xFor(stats.q3) - xFor(stats.q1), 2)}
                            height={10}
                            fill={color}
                            fillOpacity={0.35}
                            stroke={color}
                            strokeWidth={isMultiD ? 2 : 1}
                          />
                          <line x1={xFor(stats.median)} x2={xFor(stats.median)} y1={cy - 5} y2={cy + 5} stroke={color} strokeWidth={2} />
                        </>
                      )}
                    </g>
                  )
                })}
                {/* Row separator */}
                {ri < perPB.length - 1 && (
                  <line x1={0} x2={W} y1={y0 + rowH - 2} y2={y0 + rowH - 2} stroke="var(--border-subtle)" strokeWidth={0.5} />
                )}
              </g>
            )
          })}

          {/* X-axis at bottom */}
          <g transform={`translate(0, ${H - 20})`}>
            {[0, 0.5, 1, 1.5, 2, 2.5, 3].filter((v) => v <= maxSR).map((v) => (
              <g key={v}>
                <line x1={xFor(v)} x2={xFor(v)} y1={-4} y2={0} stroke="var(--text-tertiary)" strokeWidth={0.5} />
                <text x={xFor(v)} y={12} fontSize={10} fill="var(--text-tertiary)" textAnchor="middle">
                  {v}
                </text>
              </g>
            ))}
            <text x={(W + pbLabelW + scenarioLabelW) / 2} y={22} fontSize={10} fill="var(--text-tertiary)" textAnchor="middle">
              Sustainability Ratio (SR)
            </text>
          </g>
        </svg>
      </div>

      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 8, background: MULTI_D_COLOR, border: `1.5px solid ${MULTI_D_COLOR}` }} />
          <b>Multi-D (baseline)</b>
        </span>
        {PRINCIPLES.map((p) => (
          <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: PRINCIPLE_COLOR[p] }} />
            {p}
          </span>
        ))}
      </div>
    </div>
  )
}

function boxStats(values: number[]): BoxStats {
  if (!values.length) return { min: 0, q1: 0, median: 0, q3: 0, max: 0, values: [] }
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: q(0.5),
    q1: q(0.25),
    q3: q(0.75),
    values: sorted,
  }
}

function Empty({ msg }: { msg: string }) {
  return (
    <div style={{
      padding: 'var(--space-6)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
      textAlign: 'center', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)',
    }}>
      {msg}
    </div>
  )
}

const selStyle: React.CSSProperties = {
  padding: '3px 6px', fontSize: 11,
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
}
