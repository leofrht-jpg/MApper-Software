import { useMemo, useRef, useState } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { CarbonBudgetConfig, SharingPreset, SustainabilityRatioResult } from '../../api/client'
import { computeChainFactor } from '../../stores/aesaStore'
import { ZONE_COLOR, shortPbName } from './zones'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import { colorForIndicator } from '../../utils/aesaIndicatorColors'

interface Props {
  results: SustainabilityRatioResult[]
  carbonBudget?: CarbonBudgetConfig | null
  sharing?: SharingPreset | null
}

// Patch 4S — palette moved to `utils/aesaIndicatorColors.ts`. Old
// local palette had `var(--mod-aesa)` as slot 0; CSS variables don't
// resolve reliably on SVG presentation attributes inside Recharts'
// detached legend wrapper, which is why the legend swatches rendered
// as faint outlines instead of filled colors.

export function TimelineView({ results, carbonBudget, sharing }: Props) {
  const [logScale, setLogScale] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  // SR ≈ 1.0 — Fixed-only is the only sensible notation.
  const srFormat = useNumberFormatter({ notation: 'fixed', decimals: 2 })

  const { data, pbs } = useMemo(() => {
    const pbMap = new Map<string, string>()
    const yearSet = new Set<number>()
    for (const r of results) {
      if (!pbMap.has(r.pb_id)) pbMap.set(r.pb_id, r.pb_name)
      yearSet.add(r.year)
    }
    const pbArr = Array.from(pbMap.entries()).map(([id, name]) => ({ id, name }))
    const years = Array.from(yearSet).sort((a, b) => a - b)
    const byKey = new Map<string, number | null>()
    for (const r of results) byKey.set(`${r.year}|${r.pb_id}`, r.sr)
    const rows = years.map((y) => {
      const row: Record<string, number | string> = { year: y }
      for (const p of pbArr) {
        const v = byKey.get(`${y}|${p.id}`)
        if (v === undefined || v === null) continue // gap for depleted / missing
        row[p.id] = logScale ? Math.max(v, 1e-6) : v
      }
      return row
    })
    return { data: rows, pbs: pbArr }
  }, [results, logScale])

  if (!data.length) {
    return (
      <div style={{ padding: 'var(--space-6)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center' }}>
        No results
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
          Log scale
        </label>
        <NumberFormatControl
          settings={srFormat.settings}
          onChange={srFormat.setSettings}
          notations={['fixed']}
        />
        <ChartExportButton
          chartRef={timelineRef}
          // Recharts renders Legend as `<div class="recharts-legend-wrapper">`
          // inside the chart container; query for it at export time.
          legendSelector=".recharts-legend-wrapper"
          filename="aesa_timeline"
        />
      </div>

      <ChartExportContainer ref={timelineRef} style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 56 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 11 }} />
          <YAxis
            stroke="var(--text-tertiary)"
            tick={{ fontSize: 11 }}
            scale={logScale ? 'log' : 'auto'}
            domain={logScale ? [0.01, 'auto'] : [0, 'auto']}
            allowDataOverflow
            tickFormatter={(v: number) => srFormat.format(v)}
            label={{ value: 'SR', angle: -90, position: 'left', offset: 15, fontSize: 11, fill: 'var(--text-tertiary)', textAnchor: 'middle' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
            }}
            formatter={(v, name) => {
              const p = pbs.find((x) => x.id === name)
              return [srFormat.format(Number(v)), p?.name ?? name]
            }}
          />
          {/* Patch 4S — explicit legend payload + iconType="square".
              Recharts' default `iconType` is "line", which renders
              the swatch as a 1-2px horizontal stroke that reads as a
              faint outline at legend size. Square swatches make the
              color-to-label mapping legible. The payload also passes
              concrete hex colors (not CSS variables) so the swatch
              fills resolve in the detached legend wrapper. */}
          {/* Patch 4AF — SR boundary references moved to the legend.
              Pre-Patch-4AF the labels lived inside the chart plot
              area (`insideTopLeft` per Patch 4AD); when the Y-range
              expanded to 0-60 in filtered views, 1.0 and 2.0
              collapsed to nearly identical pixel rows and the
              labels overlapped regardless of left/right placement.
              The methodologically-correct fix: reference markers
              are NOT data — they're interpretation aids — so they
              belong in the legend (where chart meanings are
              documented), not in the plot area (which is for
              data). The dashed lines themselves still render via
              the `<ReferenceLine>`s below; only the text labels
              move. */}
          {/* Patch 4AF — custom legend content. Recharts 3.x' default
              Legend renderer filters explicit-payload entries that
              don't match a chart series (only the `<Line>` entries
              survive), so the SR boundary entries we want to add
              alongside indicator entries get dropped. The
              `content={(props) => ...}` API gives us full render
              control: we walk the indicator list AND append the two
              reference-line entries, all in one custom `<ul>`. */}
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            content={() => (
              <ul
                data-testid="aesa-timeline-legend"
                className="recharts-default-legend"
                style={{
                  padding: 0, margin: 0,
                  textAlign: 'center', fontSize: 11,
                  listStyle: 'none',
                }}
              >
                {pbs.map((p, idx) => {
                  const color = colorForIndicator(p.id, idx)
                  return (
                    <li
                      key={p.id}
                      className="recharts-legend-item"
                      style={{
                        display: 'inline-block',
                        marginRight: 10,
                        color,
                      }}
                    >
                      <svg
                        width="14" height="14"
                        viewBox="0 0 14 14"
                        style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}
                      >
                        <rect x="1" y="1" width="12" height="12" fill={color} rx="1" />
                      </svg>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {shortPbName(p.name)}
                      </span>
                    </li>
                  )
                })}
                {/* Reference-line entries. Swatch is a dashed
                    horizontal line matching the chart's actual
                    dashed boundary lines (strokeDasharray="4 4").
                    Label text is descriptive (boundary terminology)
                    because the legend has more horizontal room
                    than the chart plot area did. */}
                <li
                  data-testid="aesa-timeline-legend-ref-safe"
                  className="recharts-legend-item"
                  style={{ display: 'inline-block', marginRight: 10 }}
                >
                  <svg
                    width="20" height="14"
                    viewBox="0 0 20 14"
                    style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}
                  >
                    <line
                      x1="0" y1="7" x2="20" y2="7"
                      stroke={ZONE_COLOR.safe}
                      strokeWidth={2}
                      strokeDasharray="4 4"
                    />
                  </svg>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    SR = 1.0 (safe boundary)
                  </span>
                </li>
                <li
                  data-testid="aesa-timeline-legend-ref-uncert"
                  className="recharts-legend-item"
                  style={{ display: 'inline-block', marginRight: 10 }}
                >
                  <svg
                    width="20" height="14"
                    viewBox="0 0 20 14"
                    style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}
                  >
                    <line
                      x1="0" y1="7" x2="20" y2="7"
                      stroke={ZONE_COLOR.zone_of_uncertainty}
                      strokeWidth={2}
                      strokeDasharray="4 4"
                    />
                  </svg>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    SR = 2.0 (uncertainty boundary)
                  </span>
                </li>
              </ul>
            )}
          />
          {/* Dashed reference lines — text labels removed (now in
              the legend, Patch 4AF). The dashed strokes themselves
              remain so the chart's safe / uncertainty boundaries
              are still visually anchored. */}
          <ReferenceLine
            y={1.0}
            stroke={ZONE_COLOR.safe}
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={2.0}
            stroke={ZONE_COLOR.zone_of_uncertainty}
            strokeDasharray="4 4"
          />
          {pbs.map((p, idx) => (
            <Line
              key={p.id}
              dataKey={p.id}
              type="monotone"
              stroke={colorForIndicator(p.id, idx)}
              strokeWidth={1.75}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      </ChartExportContainer>

      {carbonBudget && <CarbonBudgetInset budget={carbonBudget} sharing={sharing ?? null} />}
    </div>
  )
}

function CarbonBudgetInset({ budget, sharing }: { budget: CarbonBudgetConfig; sharing: SharingPreset | null }) {
  const carbonRef = useRef<HTMLDivElement>(null)
  // Carbon budget Gt CO₂ — Fixed-only (typical range ~100s of Gt).
  const cbFormat = useNumberFormatter({ notation: 'fixed', decimals: 1 })
  const { depletionYear, series, totalAllocated, fleetShareFrac } = useMemo(() => {
    const years = Object.keys(budget.projected_emissions)
      .map(Number)
      .filter((y) => y >= budget.start_year && y <= budget.end_year)
      .sort((a, b) => a - b)

    // Share factor for climate_change, taken at the first projected year so the
    // curve has a single scale. (Full year-by-year factors come from compute.)
    const shareFrac = sharing
      ? computeChainFactor(sharing, 'climate_change', years[0] ?? budget.start_year)
      : null

    let cum = 0
    const pts = years.map((y) => {
      cum += budget.projected_emissions[y] ?? 0
      const remaining = Math.max(0, budget.initial_budget_gt - cum)
      const fleet_allocated = shareFrac !== null ? remaining * shareFrac : null
      return { year: y, used: cum, remaining, fleet_allocated }
    })
    const deplete = pts.find((p) => p.used >= budget.initial_budget_gt)
    return {
      depletionYear: deplete?.year ?? null,
      series: pts,
      totalAllocated: cum,
      fleetShareFrac: shareFrac,
    }
  }, [budget, sharing])

  return (
    <div style={{
      padding: '10px 12px',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      backgroundColor: 'var(--bg-elevated)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 2,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        }}>
          Carbon budget depletion
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {budget.initial_budget_gt} Gt · {budget.ssp_scenario}
            {depletionYear ? (
              <span
                data-testid="carbon-budget-depletion-year"
                style={{ color: 'var(--danger)', marginLeft: 6 }}
              >
                depleted ~{depletionYear}
              </span>
            ) : (
              // Patch X2 — affirmative annotation for the SSP1-1.9 ×
              // 2°C and similar cases where late-century net-negative
              // emissions keep the budget from depleting. Without this
              // line, "depleted ~YYYY" silently disappeared which read
              // as a render bug; the affirmative phrasing makes the
              // methodological reality clear.
              <span
                data-testid="carbon-budget-not-depleted"
                style={{ color: 'var(--success)', marginLeft: 6 }}
                title={`Cumulative emissions under ${budget.ssp_scenario} stay below the ${budget.initial_budget_gt} Gt budget for the full horizon (${budget.start_year}-${budget.end_year}); late-century net-negative emissions in this scenario replenish the budget.`}
              >
                not depleted within horizon
              </span>
            )}
          </span>
          <NumberFormatControl
            settings={cbFormat.settings}
            onChange={cbFormat.setSettings}
            notations={['fixed']}
          />
          <ChartExportButton chartRef={carbonRef} filename={`aesa_carbon_budget_${budget.ssp_scenario}`} />
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 6, fontStyle: 'italic' }}>
        Based on projected global emissions under {budget.ssp_scenario}, not system emissions
      </div>
      <ChartExportContainer ref={carbonRef} style={{ width: '100%', height: 120 }}>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={series} margin={{ top: 2, right: 8, bottom: 2, left: 64 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fontSize: 10 }} />
          <YAxis
            stroke="var(--text-tertiary)"
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => cbFormat.format(v)}
            label={{ value: 'Global remaining budget (Gt CO₂)', angle: -90, position: 'left', offset: 15, fontSize: 9, fill: 'var(--text-tertiary)', textAnchor: 'middle' }}
          />
          <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="remaining"
            name="Global remaining"
            stroke="var(--mod-aesa)"
            strokeWidth={1.75}
            dot={false}
          />
          {fleetShareFrac !== null && (
            <Line
              type="monotone"
              dataKey="fleet_allocated"
              name="System allocated share"
              stroke="var(--warning)"
              strokeWidth={1}
              strokeDasharray="3 2"
              dot={false}
            />
          )}
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
            }}
            formatter={(v, name) => {
              if (name === 'fleet_allocated' || name === 'System allocated share') {
                return [`${cbFormat.format(Number(v))} Gt`, 'System allocated share']
              }
              return [`${cbFormat.format(Number(v))} Gt`, 'Global remaining']
            }}
          />
        </LineChart>
      </ResponsiveContainer>
      </ChartExportContainer>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
        Total global emissions over horizon: {totalAllocated.toFixed(1)} Gt · {budget.budget_source}
        {fleetShareFrac !== null && (
          <> · system share {(fleetShareFrac * 100).toFixed(4)}%</>
        )}
      </div>
    </div>
  )
}
