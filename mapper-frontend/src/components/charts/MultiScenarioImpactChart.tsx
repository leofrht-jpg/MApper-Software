import { useMemo, useRef, useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis, type TooltipContentProps,
} from 'recharts'
import { Layers, AlertCircle, Maximize2 } from 'lucide-react'
import { ChartExpandModal } from '../ui/ChartExpandModal'
import { ExpandedCohortChart } from './ExpandedCohortChart'
import { CHART_PALETTE } from '../../utils/chartColors'
import type { ImpactAssessmentResult } from '../../api/client'
import { ChartExportButton } from './ChartExportButton'
import { ChartExportContainer } from './ChartExportContainer'
import { NumberFormatControl } from './NumberFormatControl'
import { type useNumberFormatter } from './numberFormat'
import { SCENARIO_PALETTE } from '../../utils/chartColors'

type NumberFormatterAPI = ReturnType<typeof useNumberFormatter>
import { tightStackedDomain } from './yAxisDomain'

const FACET_MAX = 6
const ACCENT = 'var(--mod-plca)'

type ViewMode = 'total' | 'facets'

export interface MultiScenarioChartItem {
  label: string
  result: ImpactAssessmentResult
}

interface Props {
  /** Pre-built per-scenario items. Caller is responsible for generating the
   *  display label (LCI: ``IAM/SSP``; DSM: scenario name; Parameter: scenario
   *  name) so the chart stays axis-agnostic. */
  scenarios: MultiScenarioChartItem[]
  selectedResultIdx: number
  detailYear: number | null
  format: NumberFormatterAPI
  cohortKeys: string[]
  cohortColorMap: Record<string, string>
  filenameBase: string
  /** Optional headline label (e.g. "LCI scenarios", "DSM scenarios",
   *  "Sensitivity cases"). Defaults to ``"scenarios"``. */
  axisLabel?: string
}

function scenarioColor(idx: number): string {
  return SCENARIO_PALETTE[idx % SCENARIO_PALETTE.length]
}

export function MultiScenarioImpactChart({
  scenarios, selectedResultIdx, detailYear, format,
  cohortKeys, cohortColorMap, filenameBase,
  axisLabel = 'scenarios',
}: Props) {
  const [view, setView] = useState<ViewMode>('total')
  const chartRef = useRef<HTMLDivElement>(null)
  // Patch 4I — separate legend ref. Only Total view has a sibling
  // legend block; faceted view's facets self-label, so legend export is
  // only meaningful in Total mode. The export button hides the Mode
  // picker when legendRef is undefined, so we conditionally pass the
  // ref only when the legend is rendered.
  const legendRef = useRef<HTMLDivElement>(null)

  const N = scenarios.length

  // Per-scenario method result slice. All facets/lines render against the
  // currently selected method (selectedResultIdx).
  const perScenario = useMemo(() => {
    return scenarios.map((s, i) => {
      const res = s.result.results[selectedResultIdx] ?? s.result.results[0]
      return {
        idx: i,
        label: s.label,
        color: scenarioColor(i),
        result: res,
      }
    }).filter((s) => s.result)
  }, [scenarios, selectedResultIdx])

  const unit = perScenario[0]?.result.unit ?? ''

  // Per-scenario line visibility — a display filter only (Patch 5O). Default:
  // all visible (current behavior). Keyed by stable scenario label; toggling
  // never recomputes or refetches (visibility is session-local component
  // state) and never recolors (color is resolved from the ORIGINAL index in
  // `perScenario`, so hiding one leaves the others' colors untouched).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const toggleVisibility = (label: string) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    return next
  })
  const visibleScenarios = useMemo(
    () => perScenario.filter((s) => !hidden.has(s.label)),
    [perScenario, hidden],
  )
  const hiddenScenarios = useMemo(
    () => perScenario.filter((s) => hidden.has(s.label)),
    [perScenario, hidden],
  )
  const allHidden = perScenario.length > 0 && visibleScenarios.length === 0

  // Total-view dataset: one row per year, one column per VISIBLE scenario, so
  // the y-domain (and the chart) reflect exactly what's shown.
  const totalData = useMemo(() => {
    const yearSet = new Set<number>()
    for (const s of visibleScenarios) {
      for (const yr of s.result.years) yearSet.add(yr.year)
    }
    const years = Array.from(yearSet).sort((a, b) => a - b)
    return years.map((year) => {
      const row: Record<string, number | string> = { year }
      for (const s of visibleScenarios) {
        const yr = s.result.years.find((y) => y.year === year)
        row[s.label] = yr ? yr.total_impact : 0
      }
      return row
    })
  }, [visibleScenarios])

  // Faceted view shows one facet per VISIBLE scenario; the cap applies to the
  // visible subset.
  const facetSet = visibleScenarios.slice(0, FACET_MAX)
  const facetsTruncated = visibleScenarios.length > FACET_MAX

  const fileSuffix = view === 'facets' ? 'facets' : 'total'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {view === 'total' ? 'Impact over time, total per scenario' : 'Impact over time, by cohort (per scenario)'}
          <span style={{
            fontSize: 'var(--text-xs)', fontWeight: 500,
            color: ACCENT,
            padding: '2px 8px',
            borderRadius: 999,
            backgroundColor: 'color-mix(in srgb, var(--mod-plca) 12%, transparent)',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <Layers size={11} /> {N} {axisLabel}
          </span>
        </h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ViewToggle view={view} onChange={setView} />
          <NumberFormatControl settings={format.settings} onChange={format.setSettings} />
          <ChartExportButton
            chartRef={chartRef}
            // Faceted view doesn't render a sibling legend (facets
            // self-label), so the legend ref is omitted in that mode.
            // The button degrades to chart-only when legendRef is
            // undefined.
            legendRef={view === 'total' ? legendRef : undefined}
            filename={`${filenameBase}_${fileSuffix}`}
          />
        </div>
      </div>

      {view === 'facets' && facetsTruncated && (
        <div style={{
          padding: '6px 10px',
          backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-xs)', color: 'var(--warning)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertCircle size={12} />
          Faceted view supports up to {FACET_MAX} {axisLabel}; showing first {FACET_MAX} of {N}. Use Total view for larger comparisons.
        </div>
      )}

      <ChartExportContainer ref={chartRef}>
        {allHidden ? (
          <div
            data-testid="multi-scenario-all-hidden"
            style={{
              height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)',
              border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
            }}
          >
            All {axisLabel} hidden — click a {axisLabel.replace(/s$/, '')} below to show it.
          </div>
        ) : view === 'total' ? (
          <TotalView
            data={totalData}
            scenarios={visibleScenarios.map((s) => ({ label: s.label, color: s.color }))}
            unit={unit}
            format={format.format}
            detailYear={detailYear}
          />
        ) : (
          <FacetedView
            scenarios={facetSet}
            cohortKeys={cohortKeys}
            cohortColorMap={cohortColorMap}
            unit={unit}
            format={format.format}
            detailYear={detailYear}
            filenameBase={filenameBase}
            formatApi={format}
          />
        )}
      </ChartExportContainer>

      {/* Clickable scenario legend (Total view only — facets self-label).
          Click an entry to toggle its line. Visible entries live inside
          `legendRef` so the native-SVG legend export reflects ONLY the
          visible subset; hidden entries render greyed/struck in a sibling
          group (outside the ref → excluded from export) so they can be
          toggled back. */}
      {view === 'total' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <div ref={legendRef} data-testid="multi-scenario-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {visibleScenarios.map((s) => (
              <button
                key={s.label}
                type="button"
                data-testid={`multi-scenario-legend-item-${s.label}`}
                aria-pressed={true}
                onClick={() => toggleVisibility(s.label)}
                title={`Hide ${s.label}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: s.color, display: 'inline-block' }} />
                <span style={{ fontFamily: 'var(--font-mono)' }}>{s.label}</span>
              </button>
            ))}
          </div>
          {hiddenScenarios.length > 0 && (
            <div data-testid="multi-scenario-legend-hidden" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 'var(--text-xs)' }}>
              {hiddenScenarios.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  data-testid={`multi-scenario-legend-item-${s.label}`}
                  aria-pressed={false}
                  onClick={() => toggleVisibility(s.label)}
                  title={`Show ${s.label}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--text-tertiary)', opacity: 0.6, textDecoration: 'line-through',
                  }}
                >
                  {/* Hollow swatch (greyed outline) keeps the "off" look. */}
                  <span style={{ width: 10, height: 10, borderRadius: 2, border: '1px solid var(--text-tertiary)', display: 'inline-block' }} />
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{s.label}</span>
                </button>
              ))}
            </div>
          )}
          {/* Discoverability controls (Patch 5AE) — OUTSIDE legendRef so the
              visible-only legend export is untouched. Tells the user the legend
              toggles lines and that the download is visible-only; "Isolate"
              solos one scenario (hide all others) for a single-line download;
              "Show all" resets. */}
          {N > 1 && (
            <div
              data-testid="multi-scenario-legend-controls"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}
            >
              <span>Click a {axisLabel.replace(/s$/, '')} to hide it — the download includes only visible {axisLabel}.</span>
              {visibleScenarios.length > 1 && (
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {visibleScenarios.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      data-testid={`multi-scenario-isolate-${s.label}`}
                      onClick={() => setHidden(new Set(perScenario.filter((x) => x.label !== s.label).map((x) => x.label)))}
                      title={`Isolate ${s.label} (hide the others)`}
                      style={{
                        padding: '1px 6px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        border: '1px solid var(--border-default)', background: 'var(--bg-base)',
                        color: 'var(--text-secondary)', fontSize: 'var(--text-xs)',
                      }}
                    >
                      Isolate {s.label}
                    </button>
                  ))}
                </span>
              )}
              {hiddenScenarios.length > 0 && (
                <button
                  type="button"
                  data-testid="multi-scenario-show-all"
                  onClick={() => setHidden(new Set())}
                  style={{
                    padding: '1px 6px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    border: '1px solid var(--border-default)', background: 'var(--bg-base)',
                    color: 'var(--text-secondary)', fontSize: 'var(--text-xs)',
                  }}
                >
                  Show all
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── View toggle ─────────────────────────────────────────────────────────────

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const btn = (target: ViewMode, _label: string): React.CSSProperties => ({
    padding: '4px 10px',
    fontSize: 'var(--text-xs)',
    fontWeight: view === target ? 600 : 500,
    border: 'none',
    background: view === target ? 'color-mix(in srgb, var(--mod-plca) 15%, transparent)' : 'transparent',
    color: view === target ? ACCENT : 'var(--text-secondary)',
    cursor: 'pointer',
  } as React.CSSProperties)
  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <button role="tab" aria-selected={view === 'total'} onClick={() => onChange('total')} style={btn('total', 'Total')}>Total</button>
      <button role="tab" aria-selected={view === 'facets'} onClick={() => onChange('facets')} style={btn('facets', 'By cohort')}>By cohort</button>
    </div>
  )
}

// ── Total view (Recharts LineChart) ─────────────────────────────────────────

function TotalView({
  data, scenarios, unit, format, detailYear,
}: {
  data: Array<Record<string, number | string>>
  scenarios: Array<{ label: string; color: string }>
  unit: string
  format: (v: number) => string
  detailYear: number | null
}) {
  return (
    <div style={{ height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 56 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
          <YAxis
            domain={tightStackedDomain}
            stroke="var(--text-tertiary)"
            tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
            tickFormatter={(v) => format(v as number)}
            label={{
              value: unit, angle: -90, position: 'left', offset: 15,
              style: { fill: 'var(--text-tertiary)', fontSize: 11, textAnchor: 'middle' },
            }}
          />
          <Tooltip content={<MultiScenarioTooltip unit={unit} format={format} />} />
          {scenarios.map((s) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
          <ReferenceLine x={detailYear ?? undefined} stroke={ACCENT} strokeDasharray="3 3" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function MultiScenarioTooltip({
  active, payload, label, unit, format,
}: Partial<TooltipContentProps<number, string>> & { unit: string; format: (v: number) => string }) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload
    .filter((p) => typeof p.value === 'number')
    .map((p) => ({ name: String(p.name ?? p.dataKey ?? ''), value: p.value as number, color: (p.color ?? p.stroke) as string }))
    .sort((a, b) => b.value - a.value)
  return (
    <div style={{
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      fontSize: 12,
      padding: '8px 10px',
      minWidth: 200,
      boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))',
    }}>
      {label !== undefined && (
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          {String(label)}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2px 8px', alignItems: 'center' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: r.color, display: 'inline-block' }} />
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.name}</span>
            <span style={{ color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {format(r.value)}{unit ? <span style={{ marginLeft: 4, fontWeight: 400, color: 'var(--text-secondary)' }}>{unit}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Faceted view (single SVG, hand-drawn small multiples) ───────────────────

function FacetedView({
  scenarios, cohortKeys, cohortColorMap, unit, format, detailYear,
  filenameBase, formatApi,
}: {
  scenarios: Array<{ idx: number; label: string; color: string; result: { years: Array<{ year: number; impact_by_cohort: Record<string, number>; total_impact: number }> } }>
  cohortKeys: string[]
  cohortColorMap: Record<string, string>
  unit: string
  format: (v: number) => string
  detailYear: number | null
  // Patch 4AL+ — extras passed through to the expand modal so its
  // ExpandedCohortChart can render the full single-scenario
  // affordances (export with proper filename, format control).
  filenameBase: string
  formatApi: NumberFormatterAPI
}) {
  const N = scenarios.length
  const cols = N === 1 ? 1 : 2
  const rows = Math.ceil(N / cols)
  const cellW = 380
  const cellH = 220
  const gap = 16
  const W = cols * cellW + (cols - 1) * gap
  const H = rows * cellH + (rows - 1) * gap

  // Shared X (years) — union across all scenarios.
  const allYears = useMemo(() => {
    const s = new Set<number>()
    for (const sc of scenarios) for (const yr of sc.result.years) s.add(yr.year)
    return Array.from(s).sort((a, b) => a - b)
  }, [scenarios])

  // Shared Y domain — max stacked total across all scenarios.
  const yMax = useMemo(() => {
    let m = 0
    for (const sc of scenarios) {
      for (const yr of sc.result.years) {
        if (yr.total_impact > m) m = yr.total_impact
      }
    }
    if (!isFinite(m) || m <= 0) return 1
    const padded = m * 1.05
    const mag = Math.pow(10, Math.floor(Math.log10(padded)))
    return Math.ceil(padded / mag) * mag
  }, [scenarios])

  const yTicks = useMemo(() => {
    const n = 4
    return Array.from({ length: n + 1 }, (_, i) => (yMax * i) / n)
  }, [yMax])

  const xTicks = useMemo(() => {
    if (allYears.length <= 6) return allYears
    const step = Math.ceil(allYears.length / 6)
    return allYears.filter((_, i) => i % step === 0)
  }, [allYears])

  // Patch 4AL — single-chart expand state. Tracks which facet (if any)
  // is currently expanded in the modal.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  // Auto-fit toggle for the expanded view: when on, the expanded
  // chart's Y-axis is computed from JUST that scenario's data (more
  // detail visible). When off (default), it uses the grid-shared yMax
  // so cross-scenario visual comparison is preserved.
  const [expandedAutoFit, setExpandedAutoFit] = useState(false)

  const expanded = expandedIdx !== null ? scenarios[expandedIdx] : null
  const expandedYMax = useMemo(() => {
    if (!expanded) return yMax
    if (!expandedAutoFit) return yMax
    let m = 0
    for (const yr of expanded.result.years) {
      if (yr.total_impact > m) m = yr.total_impact
    }
    if (!isFinite(m) || m <= 0) return 1
    const padded = m * 1.05
    const mag = Math.pow(10, Math.floor(Math.log10(padded)))
    return Math.ceil(padded / mag) * mag
  }, [expanded, expandedAutoFit, yMax])
  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', maxHeight: rows * 240 }}
        preserveAspectRatio="xMidYMid meet"
      >
        {scenarios.map((sc, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const ox = col * (cellW + gap)
          const oy = row * (cellH + gap)
          return (
            <g key={sc.label} transform={`translate(${ox},${oy})`}>
              <Facet
                width={cellW}
                height={cellH}
                title={sc.label}
                titleColor={sc.color}
                years={allYears}
                xTicks={xTicks}
                yTicks={yTicks}
                yMax={yMax}
                cohortKeys={cohortKeys}
                cohortColorMap={cohortColorMap}
                yearMap={new Map(sc.result.years.map((y) => [y.year, y.impact_by_cohort]))}
                unit={unit}
                format={format}
                detailYear={detailYear}
              />
            </g>
          )
        })}
      </svg>
      {/* Patch 4AL — HTML overlay layer for expand buttons, positioned
          using the same grid math as the SVG facets. The buttons sit
          above the SVG's title text in the facet's top-right corner. */}
      <div
        aria-hidden="false"
        style={{
          position: 'absolute', inset: 0,
          pointerEvents: 'none',  // children re-enable per-button
        }}
      >
        {scenarios.map((sc, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          // Convert SVG coords to percent of container width/height —
          // works regardless of the SVG's responsive scale.
          const leftPct = ((col * (cellW + gap) + cellW - 28) / W) * 100
          const topPct = ((row * (cellH + gap) + 4) / H) * 100
          return (
            <button
              key={sc.label}
              data-testid={`facet-expand-${i}`}
              onClick={() => { setExpandedAutoFit(false); setExpandedIdx(i) }}
              title={`Expand chart: ${sc.label}`}
              aria-label={`Expand chart for ${sc.label}`}
              style={{
                position: 'absolute',
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: 22, height: 22,
                display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                pointerEvents: 'auto',
                padding: 0,
              }}
            >
              <Maximize2 size={12} />
            </button>
          )
        })}
      </div>
      {/* Patch 4AL+ — expand modal with full single-scenario
          affordances (export + legend + tooltip), implemented via
          ExpandedCohortChart which mirrors the canonical
          ProjectedImpactPanel by-cohort view. */}
      {expanded !== null && (
        <ChartExpandModal
          isOpen={true}
          onClose={() => setExpandedIdx(null)}
          title={expanded.label}
        >
          <div data-testid="facet-expand-body" style={{ width: '100%' }}>
            <ExpandedCohortChart
              years={expanded.result.years}
              cohortKeys={cohortKeys}
              colorForCohort={(ck, i = 0) =>
                cohortColorMap[ck] ?? CHART_PALETTE[i % CHART_PALETTE.length]
              }
              unit={unit}
              format={formatApi}
              detailYear={detailYear}
              yMaxOverride={expandedAutoFit ? undefined : expandedYMax}
              exportFilename={`${filenameBase}_facet_${expanded.label.replace(/[^A-Za-z0-9._-]+/g, '_')}`}
              extraHeader={
                <label
                  data-testid="facet-expand-autofit"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                    cursor: 'pointer', userSelect: 'none',
                  }}
                  title="Auto-fit Y-axis to this scenario's data range (breaks cross-scenario comparability)"
                >
                  <input
                    type="checkbox"
                    checked={expandedAutoFit}
                    onChange={(e) => setExpandedAutoFit(e.target.checked)}
                  />
                  Auto-fit Y-axis
                </label>
              }
            />
          </div>
        </ChartExpandModal>
      )}
    </div>
  )
}

function Facet({
  width, height, title, titleColor,
  years, xTicks, yTicks, yMax,
  cohortKeys, cohortColorMap, yearMap,
  unit, format, detailYear,
}: {
  width: number; height: number
  title: string; titleColor: string
  years: number[]; xTicks: number[]; yTicks: number[]; yMax: number
  cohortKeys: string[]; cohortColorMap: Record<string, string>
  yearMap: Map<number, Record<string, number>>
  unit: string
  format: (v: number) => string
  detailYear: number | null
}) {
  const padL = 52, padR = 8, padT = 26, padB = 28
  const plotW = width - padL - padR
  const plotH = height - padT - padB

  const x0 = years[0] ?? 0
  const x1 = years[years.length - 1] ?? 1
  const xSpan = x1 === x0 ? 1 : x1 - x0
  const xFor = (yr: number) => padL + ((yr - x0) / xSpan) * plotW
  const yFor = (v: number) => padT + plotH - (v / yMax) * plotH

  // Stacked area paths — one per cohort. Lower = prefix excluding this cohort,
  // upper = prefix including. Bottom-up stack matches the Recharts default.
  const paths = cohortKeys.map((ck) => {
    const upper: Array<[number, number]> = []
    const lower: Array<[number, number]> = []
    for (const yr of years) {
      const cohorts = yearMap.get(yr) ?? {}
      let prefix = 0
      for (const k of cohortKeys) {
        if (k === ck) break
        prefix += cohorts[k] ?? 0
      }
      const here = cohorts[ck] ?? 0
      upper.push([yr, prefix + here])
      lower.push([yr, prefix])
    }
    const fwd = upper.map(([yr, v], i) => `${i === 0 ? 'M' : 'L'}${xFor(yr).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ')
    const back = [...lower].reverse().map(([yr, v]) => `L${xFor(yr).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ')
    return { ck, d: `${fwd} ${back} Z` }
  })

  const detailX = detailYear != null && detailYear >= x0 && detailYear <= x1 ? xFor(detailYear) : null

  return (
    <>
      {/* Frame */}
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} fill="none" stroke="var(--border-subtle)" strokeWidth={1} rx={4} />
      {/* Title (scenario label) */}
      <text x={padL} y={16} fontSize={12} fontWeight={600} fill={titleColor} fontFamily="var(--font-mono)">
        {title}
      </text>
      {/* Y gridlines + ticks */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line
            x1={padL} x2={padL + plotW}
            y1={yFor(v)} y2={yFor(v)}
            stroke="var(--border-subtle)" strokeDasharray="3 3" strokeWidth={0.5}
          />
          <text
            x={padL - 6} y={yFor(v)} fontSize={9} fill="var(--text-tertiary)"
            textAnchor="end" dominantBaseline="middle"
          >
            {format(v)}
          </text>
        </g>
      ))}
      {/* Y unit label */}
      <text
        x={10} y={padT + plotH / 2} fontSize={9} fill="var(--text-tertiary)"
        textAnchor="middle" transform={`rotate(-90, 10, ${padT + plotH / 2})`}
      >
        {unit}
      </text>
      {/* Stacked areas */}
      {paths.map(({ ck, d }) => (
        <path
          key={ck}
          d={d}
          fill={cohortColorMap[ck] ?? '#999'}
          fillOpacity={0.7}
          stroke={cohortColorMap[ck] ?? '#999'}
          strokeWidth={0.5}
          strokeOpacity={0.9}
        />
      ))}
      {/* X axis */}
      <line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke="var(--text-tertiary)" strokeWidth={0.5} />
      {xTicks.map((yr) => (
        <g key={yr}>
          <line x1={xFor(yr)} x2={xFor(yr)} y1={padT + plotH} y2={padT + plotH + 3} stroke="var(--text-tertiary)" strokeWidth={0.5} />
          <text x={xFor(yr)} y={padT + plotH + 14} fontSize={9} fill="var(--text-tertiary)" textAnchor="middle">
            {yr}
          </text>
        </g>
      ))}
      {/* Detail year reference line */}
      {detailX !== null && (
        <line x1={detailX} x2={detailX} y1={padT} y2={padT + plotH} stroke={ACCENT} strokeDasharray="3 3" strokeWidth={1} />
      )}
    </>
  )
}
