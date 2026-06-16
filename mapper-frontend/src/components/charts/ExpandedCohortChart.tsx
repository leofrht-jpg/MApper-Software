import { useMemo, useRef } from 'react'
import {
  Area, AreaChart, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { ChartExportButton } from './ChartExportButton'
import { ChartExportContainer } from './ChartExportContainer'
import { NumberFormatControl } from './NumberFormatControl'
import { type useNumberFormatter } from './numberFormat'
import { StackedTotalTooltip } from './StackedTotalTooltip'
import { tightStackedDomain } from './yAxisDomain'

// Patch 4AL+ — full-affordance render of a single cohort-stacked
// scenario for the <ChartExpandModal>. Mirrors the single-scenario
// by-cohort view in ProjectedImpactPanel exactly (Recharts AreaChart
// + StackedTotalTooltip + sibling legend + ChartExportButton +
// NumberFormatControl) so the expanded modal feels like the
// canonical detail view, not "the small facet but bigger".
//
// Color resolution: takes `colorForCohort` from the parent's
// `useDSMSystemColors` hook so per-dim (Patch 4AJ) and per-row
// (Patch 4AK) overrides propagate to chart fills, legend swatches,
// AND tooltip swatches uniformly.

interface YearData {
  year: number
  impact_by_cohort: Record<string, number>
  total_impact: number
}

export interface ExpandedCohortChartProps {
  /** Per-year cohort data — same shape as `SingleMethodImpactResult.years[]`. */
  years: YearData[]
  /** Stable cohort key set + ordering (matches grid facet). */
  cohortKeys: string[]
  /** Color resolver from `useDSMSystemColors.colorForCohort`. */
  colorForCohort: (cohortKey: string, fallbackIndex?: number) => string
  /** Optional per-dim-stacked legend label projection. When omitted,
   *  legend renders one entry per cohort key. */
  legendLabels?: string[]
  /** Resolver for legend label → display color. Required when
   *  `legendLabels` is set (the legend label may differ from the
   *  cohort key when stacked by a dimension). */
  legendColor?: (label: string, idx: number) => string
  unit: string
  format: ReturnType<typeof useNumberFormatter>
  /** Optional ReferenceLine year (dashed vertical marker). */
  detailYear?: number | null
  /** Y-axis override — pass a numeric max to lock the chart to the
   *  grid's shared scale. Undefined → Recharts auto-fit. */
  yMaxOverride?: number
  /** Filename base for the export action (no extension). */
  exportFilename: string
  /** Optional extra header content rendered before the format + export
   *  controls (e.g. the auto-fit Y-axis toggle from the parent). */
  extraHeader?: React.ReactNode
}

export function ExpandedCohortChart({
  years, cohortKeys, colorForCohort, legendLabels, legendColor,
  unit, format, detailYear, yMaxOverride,
  exportFilename, extraHeader,
}: ExpandedCohortChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)

  // Recharts AreaChart row shape: { year, [cohortKey]: number, ... }
  const data = useMemo(() => {
    return years.map((y) => {
      const row: Record<string, number | string> = { year: y.year }
      for (const ck of cohortKeys) {
        row[ck] = y.impact_by_cohort[ck] ?? 0
      }
      return row
    })
  }, [years, cohortKeys])

  // Effective Y-axis domain — locked when `yMaxOverride` is provided
  // (Patch 4AL grid-shared scale), Recharts default otherwise (auto-fit).
  const yDomain = yMaxOverride != null
    ? [0, yMaxOverride] as const
    : tightStackedDomain

  // Legend label set + colors. When the parent provided a projected
  // label set (e.g. dim-aggregated), use those; otherwise one entry
  // per cohort key.
  const legend = useMemo(() => {
    if (legendLabels && legendColor) {
      return legendLabels.map((label, i) => ({
        label, color: legendColor(label, i),
      }))
    }
    return cohortKeys.map((ck, i) => ({
      label: ck, color: colorForCohort(ck, i),
    }))
  }, [legendLabels, legendColor, cohortKeys, colorForCohort])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{
        display: 'flex', justifyContent: 'flex-end',
        alignItems: 'center', gap: 8,
      }}>
        {extraHeader}
        <NumberFormatControl
          settings={format.settings}
          onChange={format.setSettings}
        />
        <ChartExportButton
          chartRef={chartRef}
          legendRef={legendRef}
          filename={exportFilename}
        />
      </div>
      <div data-testid="expanded-cohort-chart">
      <ChartExportContainer
        ref={chartRef}
        style={{ height: 440 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 56 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis
              dataKey="year"
              stroke="var(--text-tertiary)"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
            />
            <YAxis
              domain={yDomain as [number, number] | typeof tightStackedDomain}
              stroke="var(--text-tertiary)"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              tickFormatter={(v) => format.format(v as number)}
              label={{
                value: unit, angle: -90, position: 'left', offset: 15,
                style: { fill: 'var(--text-tertiary)', fontSize: 11, textAnchor: 'middle' },
              }}
            />
            <Tooltip
              content={
                <StackedTotalTooltip
                  unit={unit}
                  formatValue={format.format}
                />
              }
            />
            {cohortKeys.map((ck, i) => (
              <Area
                key={ck}
                type="monotone"
                dataKey={ck}
                stackId="1"
                stroke={colorForCohort(ck, i)}
                fill={colorForCohort(ck, i)}
                fillOpacity={0.7}
                isAnimationActive={false}
              />
            ))}
            {detailYear != null && (
              <ReferenceLine
                x={detailYear}
                stroke="var(--mod-plca)"
                strokeDasharray="3 3"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </ChartExportContainer>
      </div>
      <div
        ref={legendRef}
        data-testid="expanded-cohort-legend"
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 10,
          paddingTop: 4,
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
        }}
      >
        {legend.map(({ label, color }) => (
          <span
            key={label}
            data-testid={`expanded-cohort-legend-${label}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}
          >
            <span
              style={{
                display: 'inline-block', width: 10, height: 10,
                borderRadius: 2, backgroundColor: color,
              }}
            />
            <span style={{ fontFamily: 'var(--font-mono)' }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
