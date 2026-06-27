/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import { StackedTotalTooltip } from '../charts/StackedTotalTooltip'
import { tightStackedDomain } from '../charts/yAxisDomain'
import { TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from '../charts/tooltipStyle'
import { Download, Loader2, TrendingDown, TrendingUp, BarChart3 } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { YearSlider } from '../ui/YearSlider'
import { useDSMStore } from '../../stores/dsmStore'
import { useParameterStore } from '../../stores/parameterStore'
import { useChartColors, colorFor } from '../../utils/chartColors'
import { DSMScenariosChip } from '../dsm/DSMScenariosChip'
import { BASE_SCENARIO } from '../../api/client'

type Scope = 'inflows' | 'outflows' | 'stock' | 'all'
type GroupBy = 'material' | 'component' | 'stage' | 'archetype'

const SCOPE_OPTIONS: { value: Scope; label: string; tip: string }[] = [
  { value: 'inflows', label: 'Manufacturing', tip: 'Manufacturing stage materials x units produced each year.' },
  { value: 'stock', label: 'Operation', tip: 'Use Phase + Maintenance materials x in-service stock each year.' },
  { value: 'outflows', label: 'End of Life', tip: 'End of Life stage materials x units retired each year.' },
]

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'material', label: 'Material' },
  { value: 'component', label: 'Component' },
  { value: 'stage', label: 'Stage' },
  { value: 'archetype', label: 'Archetype' },
]

type TopN = 5 | 10 | 20 | 'all'
const TOP_N_OPTIONS: TopN[] = [5, 10, 20, 'all']

const fmtInt = (n: number) => {
  if (!Number.isFinite(n)) return '0'
  const a = Math.abs(n)
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return Math.round(n).toLocaleString()
}

interface MaterialFlowPanelProps {
  // When provided, the panel scopes results to that single subsystem.
  // If omitted, the panel runs in "overall" mode and exposes a subsystem-filter
  // dropdown to cross-compare aggregates.
  scopeSubsystemId?: string
  scopeSubsystemName?: string
}

export function MaterialFlowPanel({ scopeSubsystemId, scopeSubsystemName }: MaterialFlowPanelProps = {}) {
  const {
    activeSystem,
    simulationResult,
    materialFlows,
    materialFlowLoading,
    error,
    calcMaterialFlows,
    exportMatFlows,
    materialFlowsRuns,
    materialFlowAxis,
    activeMaterialFlowScenario,
    selectMaterialFlowScenario,
  } = useDSMStore()

  // Patch 4M — multi-axis fan-out state. Local to this panel (not in
  // the store) because the chips are panel-scoped — leaving the tab
  // and coming back shouldn't carry the previous selection. Store
  // owns the *results*; chips own the *picks*.
  const [selectedDsmIds, setSelectedDsmIds] = useState<string[]>([])
  const paramTable = useParameterStore((s) => s.table)
  const selectedScenarios = useParameterStore((s) => s.selectedScenarios)
  const toggleSelectedScenario = useParameterStore((s) => s.toggleSelectedScenario)
  const availableParameterScenarios = useMemo(
    () => [BASE_SCENARIO, ...(paramTable?.scenarios ?? [])],
    [paramTable],
  )
  const effectiveSelectedParams = useMemo(
    () => selectedScenarios.filter((s) => availableParameterScenarios.includes(s)),
    [selectedScenarios, availableParameterScenarios],
  )

  const scoped = scopeSubsystemId != null
  const [scope, setScope] = useState<Scope>('stock')
  const [groupBy, setGroupBy] = useState<GroupBy>('material')
  const [yearStart, setYearStart] = useState<number | null>(null)
  const [yearEnd, setYearEnd] = useState<number | null>(null)
  const [detailYear, setDetailYear] = useState<number | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [selectedSubsystem, setSelectedSubsystem] = useState<string>('all')
  const [topN, setTopN] = useState<TopN>(10)
  const [resultsExpanded, setResultsExpanded] = useState(true)
  // Charts can't meaningfully stack kg + kWh + pieces on one axis. We scope
  // the whole results surface to one unit at a time; the user switches
  // between units via a dropdown in the card header.
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)
  const areaChartRef = useRef<HTMLDivElement>(null)
  const barChartRef = useRef<HTMLDivElement>(null)

  // Per-chart formatters. Summary headline shares the area-chart formatter
  // since both reflect cumulative/over-time totals. fmtInt is preserved for
  // integer unit-counts (vehicles, etc.) which aren't user-formatted.
  const areaFormat = useNumberFormatter()
  const detailFormat = useNumberFormatter()

  // Component grouping only makes sense at Manufacturing — at End of Life
  // the whole archetype is dismantled, and at Operation you replace
  // consumables (tires, fluids, brake pads), not components.
  const availableGroupOptions = useMemo(
    () => (scope === 'inflows' ? GROUP_OPTIONS : GROUP_OPTIONS.filter((g) => g.value !== 'component')),
    [scope],
  )

  useEffect(() => {
    if (scope !== 'inflows' && groupBy === 'component') setGroupBy('material')
  }, [scope, groupBy])

  const subsystems = materialFlows?.subsystems ?? []
  const hasDependents = subsystems.length > 1
  const primarySubsystemId = subsystems[0]?.id ?? activeSystem?.id ?? ''

  useEffect(() => {
    // Reset filter whenever a new result arrives with an id set that doesn't
    // include the current selection.
    if (scoped) return
    if (!materialFlows) return
    if (selectedSubsystem === 'all') return
    if (!subsystems.some((s) => s.id === selectedSubsystem)) setSelectedSubsystem('all')
  }, [materialFlows, selectedSubsystem, subsystems, scoped])

  const displayFlows = useMemo(() => {
    if (!materialFlows) return null
    let rows = materialFlows.materials

    if (scoped) {
      // Single-subsystem view: keep only materials from this subsystem.
      rows = rows.filter((m) => {
        const rid = m.subsystem_id || primarySubsystemId
        return rid === scopeSubsystemId
      })
      return { ...materialFlows, materials: rows }
    }

    // Overall view.
    if (selectedSubsystem !== 'all' && hasDependents) {
      rows = rows.filter((m) => {
        const rid = m.subsystem_id || primarySubsystemId
        return rid === selectedSubsystem
      })
    }
    if (selectedSubsystem === 'all' && hasDependents) {
      // Prefix names with subsystem to avoid collisions across subsystems.
      rows = rows.map((m) => {
        const subLabel = m.subsystem_name || subsystems[0]?.name || ''
        return { ...m, name: subLabel ? `${subLabel} · ${m.name}` : m.name }
      })
    }
    return { ...materialFlows, materials: rows }
  }, [materialFlows, selectedSubsystem, hasDependents, primarySubsystemId, subsystems, scoped, scopeSubsystemId])

  const availableYears = useMemo(() => {
    if (simulationResult) return simulationResult.years.map((y) => y.year)
    if (activeSystem) {
      const { start_year, end_year } = activeSystem.time_horizon
      return Array.from({ length: end_year - start_year + 1 }, (_, i) => start_year + i)
    }
    return []
  }, [simulationResult, activeSystem])

  useEffect(() => {
    if (availableYears.length === 0) return
    if (yearStart == null || !availableYears.includes(yearStart)) setYearStart(availableYears[0])
    if (yearEnd == null || !availableYears.includes(yearEnd)) setYearEnd(availableYears[availableYears.length - 1])
  }, [availableYears, yearStart, yearEnd])

  // Auto-expand the results card whenever a fresh calculation lands. Mirrors
  // the DSM Simulation Results behaviour (expanded after Run simulation).
  useEffect(() => {
    if (materialFlows && materialFlows.materials.length > 0) {
      setResultsExpanded(true)
    }
  }, [materialFlows])

  useEffect(() => {
    if (displayFlows && displayFlows.materials.length > 0) {
      const allYears = new Set<number>()
      for (const m of displayFlows.materials) for (const y of Object.keys(m.values)) allYears.add(Number(y))
      const sorted = Array.from(allYears).sort((a, b) => a - b)
      setDetailYear(sorted[Math.floor(sorted.length / 2)] ?? sorted[0])
    }
  }, [displayFlows])

  // Patch 4M — axisConflict: at most one of (DSM, parameter) may be
  // multi-select. Cartesian-product (N×M) is out of scope — would need
  // a matrix UI; not designed yet. Both axes single (≤1 selected) →
  // legacy single-result path. Exactly one axis with N>1 → fan-out.
  const dsmAxisN = selectedDsmIds.length
  const paramAxisN = effectiveSelectedParams.filter((s) => s !== BASE_SCENARIO).length
  // Treat Base as always implicit. The explicit "fan-out" axis count
  // matches what the store sees: N>1 in either axis triggers the
  // multi-endpoint; N≤1 stays on the legacy single endpoint.
  const axisConflict = dsmAxisN > 1 && (paramAxisN > 1 || effectiveSelectedParams.length > 1)

  const handleCalculate = async () => {
    if (!activeSystem?.id) return
    if (axisConflict) return  // button is disabled too; defence-in-depth
    const fullStart = availableYears[0]
    const fullEnd = availableYears[availableYears.length - 1]
    const ys = yearStart != null && yearStart !== fullStart ? yearStart : null
    const ye = yearEnd != null && yearEnd !== fullEnd ? yearEnd : null
    // Pass the multi-axis args. Store handles routing (single vs multi
    // endpoint) based on count.
    await calcMaterialFlows(scope, ys, ye, groupBy, {
      dsmScenarioIds: selectedDsmIds,
      // Drop Base — the legacy endpoint's `parameter_scenario=null`
      // already maps to base values; sending "Base" through would
      // hit the 400 path on the backend (Base isn't in the
      // parameter table's scenario list).
      parameterScenarios: effectiveSelectedParams.filter((s) => s !== BASE_SCENARIO),
    })
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const fullStart = availableYears[0]
      const fullEnd = availableYears[availableYears.length - 1]
      const ys = yearStart != null && yearStart !== fullStart ? yearStart : null
      const ye = yearEnd != null && yearEnd !== fullEnd ? yearEnd : null
      await exportMatFlows(scope, ys, ye)
    } finally {
      setIsExporting(false)
    }
  }

  // ── Data transforms ──

  // Ordered list of units present in the results with their entry counts.
  // Most-populated first so "default unit = first entry" gives the user the
  // view they usually want (typically kg).
  const allUnits = useMemo(() => {
    if (!displayFlows) return []
    const counts: Record<string, number> = {}
    for (const m of displayFlows.materials) counts[m.unit] = (counts[m.unit] ?? 0) + 1
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([unit, count]) => ({ unit, count }))
  }, [displayFlows])

  useEffect(() => {
    if (allUnits.length === 0) {
      if (selectedUnit !== null) setSelectedUnit(null)
      return
    }
    if (!selectedUnit || !allUnits.some((u) => u.unit === selectedUnit)) {
      setSelectedUnit(allUnits[0].unit)
    }
  }, [allUnits, selectedUnit])

  // Unit-scoped projection of displayFlows. All downstream charts/tables
  // consume this instead of displayFlows directly, so stacked areas and
  // aggregates only mix commensurable quantities.
  const unitFlows = useMemo(() => {
    if (!displayFlows) return null
    if (!selectedUnit) return displayFlows
    return { ...displayFlows, materials: displayFlows.materials.filter((m) => m.unit === selectedUnit) }
  }, [displayFlows, selectedUnit])

  const years = useMemo(() => {
    if (!unitFlows) return []
    const s = new Set<number>()
    for (const m of unitFlows.materials) for (const y of Object.keys(m.values)) s.add(Number(y))
    return Array.from(s).sort((a, b) => a - b)
  }, [unitFlows])

  const materialKeys = useMemo(() => {
    if (!unitFlows) return []
    return unitFlows.materials.map((m) => m.name)
  }, [unitFlows])

  const materialColorMap = useChartColors(materialKeys)

  const areaData = useMemo(() => {
    if (!unitFlows || years.length === 0) return []
    return years.map((yr) => {
      const row: Record<string, number | string> = { year: yr }
      for (const m of unitFlows.materials) {
        row[m.name] = m.values[yr] ?? 0
      }
      return row
    })
  }, [unitFlows, years])

  // Top materials table — uses the unit-filtered flows.
  const topMaterials = useMemo(() => {
    if (!unitFlows) return []
    return unitFlows.materials.map((m) => {
      const total = Object.values(m.values).reduce((a, b) => a + b, 0)
      const yearVal = detailYear != null ? (m.values[detailYear] ?? 0) : 0
      return { ...m, total, yearVal }
    }).sort((a, b) => b.total - a.total)
  }, [unitFlows, detailYear])

  // Year detail bar data. Applies the Top-N limit: rows beyond N are folded
  // into an aggregate "Other" row so downstream readers can still see the
  // residual mass without drowning the chart in tails.
  const unitLabel = displayFlows?.unit_name ?? 'units'
  const archetypeUnitsByYear = displayFlows?.archetype_units_by_year ?? {}

  // Labels derived from the active Group By so titles and column headers
  // reflect what the user is looking at ("Top components" vs "Top materials").
  const groupNoun = (
    groupBy === 'material' ? 'material'
      : groupBy === 'component' ? 'component'
        : groupBy === 'stage' ? 'stage'
          : 'archetype'
  )
  const groupNounPlural = groupNoun + 's'
  const groupNounTitle = groupNoun.charAt(0).toUpperCase() + groupNoun.slice(1)
  const groupNounPluralTitle = groupNounTitle + 's'

  const yearBarData = useMemo(() => {
    if (!unitFlows || detailYear == null) return []
    const sorted = unitFlows.materials
      .map((m) => ({
        name: m.name,
        quantity: m.values[detailYear] ?? 0,
        unit: m.unit,
        units: archetypeUnitsByYear[m.name]?.[detailYear] ?? null,
      }))
      .filter((d) => d.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity)
    const limit = topN === 'all' ? sorted.length : topN
    if (sorted.length <= limit) return sorted
    const head = sorted.slice(0, limit)
    const tail = sorted.slice(limit)
    const otherQty = tail.reduce((s, d) => s + d.quantity, 0)
    const otherUnits = tail.reduce<number | null>((acc, d) => {
      if (d.units == null) return acc
      return (acc ?? 0) + d.units
    }, null)
    const otherUnit = head[0]?.unit ?? tail[0]?.unit ?? ''
    return [
      ...head,
      { name: `Other (${tail.length})`, quantity: otherQty, unit: otherUnit, units: otherUnits },
    ]
  }, [unitFlows, detailYear, topN, archetypeUnitsByYear])

  const systemUnitsAtYear = detailYear != null
    ? displayFlows?.system_units_by_year?.[detailYear] ?? null
    : null

  // Unique key that changes whenever flows are replaced, forcing Recharts to fully remount
  const chartKey = useMemo(() => {
    if (!unitFlows) return ''
    return `${unitFlows.scope}-${unitFlows.group_by}-${unitFlows.elapsed_seconds}-${unitFlows.materials.length}-${selectedSubsystem}-${selectedUnit ?? ''}`
  }, [unitFlows, selectedSubsystem, selectedUnit])

  // Summary — based on the unit-filtered flows so the headline totals
  // and peak year reflect what the user is looking at.
  const summary = useMemo(() => {
    if (!unitFlows || unitFlows.materials.length === 0) return null
    let unitTotal = 0
    const yearTotals: Record<number, number> = {}
    for (const m of unitFlows.materials) {
      for (const [y, v] of Object.entries(m.values)) {
        const yr = Number(y)
        yearTotals[yr] = (yearTotals[yr] ?? 0) + v
        unitTotal += v
      }
    }
    let peakYear = 0
    let peakVal = 0
    for (const [y, v] of Object.entries(yearTotals)) {
      if (v > peakVal) { peakYear = Number(y); peakVal = v }
    }
    return { unitTotal, peakYear, peakVal, materialCount: unitFlows.materials.length }
  }, [unitFlows])

  if (!activeSystem) return null

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
  }

  const headCell: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)',
    color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)',
    position: 'sticky', top: 0,
  }

  const numCell: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* ── Controls ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-5)', flexWrap: 'nowrap' }}>
          {/* Scope */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
              Scope
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {SCOPE_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setScope(s.value)}
                  disabled={materialFlowLoading}
                  title={s.tip}
                  style={{
                    padding: '6px 10px', borderRadius: 'var(--radius-md)',
                    cursor: materialFlowLoading ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (scope === s.value ? 'var(--mod-dsm)' : 'var(--border-default)'),
                    backgroundColor: scope === s.value ? 'color-mix(in srgb, var(--mod-dsm) 12%, transparent)' : 'var(--bg-elevated)',
                    color: scope === s.value ? 'var(--mod-dsm)' : 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', fontWeight: scope === s.value ? 600 : 500,
                    opacity: materialFlowLoading ? 0.5 : 1, whiteSpace: 'nowrap',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Group by */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
              Group by
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {availableGroupOptions.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setGroupBy(g.value)}
                  disabled={materialFlowLoading}
                  style={{
                    padding: '6px 10px', borderRadius: 'var(--radius-md)',
                    cursor: materialFlowLoading ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (groupBy === g.value ? 'var(--mod-dsm)' : 'var(--border-default)'),
                    backgroundColor: groupBy === g.value ? 'color-mix(in srgb, var(--mod-dsm) 12%, transparent)' : 'var(--bg-elevated)',
                    color: groupBy === g.value ? 'var(--mod-dsm)' : 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', fontWeight: groupBy === g.value ? 600 : 500,
                    opacity: materialFlowLoading ? 0.5 : 1, whiteSpace: 'nowrap',
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Subsystem filter — only in overall mode with ≥1 dependent. */}
          {!scoped && hasDependents && (
            <div>
              <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
                Subsystem
              </label>
              <select
                value={selectedSubsystem}
                onChange={(e) => setSelectedSubsystem(e.target.value)}
                disabled={materialFlowLoading}
                style={{ height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none', minWidth: 160 }}
              >
                <option value="all">All subsystems</option>
                {subsystems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Years */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
              Years
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={yearStart ?? ''}
                onChange={(e) => setYearStart(Number(e.target.value))}
                disabled={materialFlowLoading || availableYears.length === 0}
                style={{ height: 32, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none' }}
              >
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>to</span>
              <select
                value={yearEnd ?? ''}
                onChange={(e) => setYearEnd(Number(e.target.value))}
                disabled={materialFlowLoading || availableYears.length === 0}
                style={{ height: 32, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none' }}
              >
                {availableYears.filter((y) => yearStart == null || y >= yearStart).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Calculate */}
          <Button
            variant="primary"
            onClick={handleCalculate}
            disabled={materialFlowLoading || !simulationResult || axisConflict}
            style={{ backgroundColor: 'var(--mod-dsm)', height: 36 }}
            title={
              !simulationResult ? 'Run simulation first'
              : axisConflict ? 'Cannot fan out across DSM and parameter axes simultaneously'
              : 'Calculate material flows'
            }
          >
            {materialFlowLoading ? (
              <>
                <Loader2 size={14} style={{ animation: 'mfp-spin 1s linear infinite' }} />
                Calculating...
              </>
            ) : (
              <>
                <BarChart3 size={14} />
                Calculate
              </>
            )}
          </Button>
        </div>

        {/* Patch 4M — scenario axes row. Two chips: DSM scenarios
            (multi-select via the existing chip) + parameter scenarios
            (multi-select checklist mirroring DSMImpactPanel's
            "Sensitivity cases"). axisConflict prevents both being
            multi-select; Calculate disables itself when violated. */}
        <div
          data-testid="material-flows-scenario-axes"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-4)',
            marginTop: 'var(--space-4)',
          }}
        >
          <div>
            <label
              style={{
                fontSize: 'var(--text-xs)', fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
                display: 'block', marginBottom: 6,
              }}
            >
              DSM scenarios
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                · {selectedDsmIds.length || 'active'}
              </span>
            </label>
            <DSMScenariosChip
              selectedIds={selectedDsmIds}
              onChange={setSelectedDsmIds}
              accentColor="var(--mod-dsm)"
              disabled={materialFlowLoading}
            />
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-tertiary)',
                marginTop: 4,
              }}
            >
              {selectedDsmIds.length === 0
                ? 'Empty → uses the active scenario.'
                : selectedDsmIds.length === 1
                  ? '1 scenario → single result (no tab bar).'
                  : `${selectedDsmIds.length} scenarios → fan-out, switchable via tab bar above results.`}
            </div>
          </div>

          <div>
            <label
              style={{
                fontSize: 'var(--text-xs)', fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
                display: 'block', marginBottom: 6,
              }}
            >
              Sensitivity cases
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                · {effectiveSelectedParams.length}/{availableParameterScenarios.length}
              </span>
            </label>
            <div
              data-testid="material-flows-parameter-checklist"
              style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                padding: '6px 8px',
                maxHeight: 140, overflowY: 'auto',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {availableParameterScenarios.map((s) => {
                const isBase = s === BASE_SCENARIO
                const checked = effectiveSelectedParams.includes(s)
                return (
                  <label
                    key={s}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 'var(--text-xs)',
                      color: isBase ? 'var(--text-secondary)' : 'var(--text-primary)',
                      cursor: isBase ? 'not-allowed' : 'pointer',
                      opacity: isBase ? 0.85 : 1,
                    }}
                    title={isBase ? 'Base values are always available' : `Toggle "${s}"`}
                  >
                    <input
                      type="checkbox"
                      data-testid={`material-flows-param-${s}`}
                      checked={checked}
                      disabled={isBase || materialFlowLoading}
                      onChange={(e) => toggleSelectedScenario(s, e.target.checked)}
                    />
                    <span style={{ fontFamily: isBase ? 'inherit' : 'var(--font-mono)' }}>{s}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        {axisConflict && (
          <div
            data-testid="material-flows-axis-conflict"
            style={{
              marginTop: 'var(--space-3)',
              padding: '8px 12px',
              fontSize: 'var(--text-xs)',
              color: 'var(--status-error)',
              backgroundColor: 'color-mix(in srgb, var(--status-error) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--status-error) 30%, transparent)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            Cannot fan out across DSM and parameter axes simultaneously. Pick one axis at a time.
          </div>
        )}

        {materialFlowLoading && (
          <div style={{ marginTop: 'var(--space-3)', height: 4, backgroundColor: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: '33%', backgroundColor: 'var(--mod-dsm)', animation: 'mfp-progress 1.6s ease-in-out infinite' }} />
          </div>
        )}

        <style>{`@keyframes mfp-spin { to { transform: rotate(360deg); } } @keyframes mfp-progress { 0% { left: -33%; } 100% { left: 100%; } }`}</style>

        {error && !materialFlowLoading && (
          <div style={{ marginTop: 'var(--space-3)', padding: '8px 10px', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Warnings are suppressed: in per-subsystem mode they belong to other
          subsystems; in overall mode, missing links are handled silently per
          product decision. */}

      {/* Patch 4M — scenario tab bar (multi-axis fan-out only). When
          ``materialFlowsRuns.length > 1``, render a tab bar above the
          Results card; clicking a tab swaps the active scenario which
          mirrors that scenario's ``MaterialFlowResult`` into the
          legacy ``materialFlows`` slot — the existing rendering code
          (table, chart, summary) reads it without per-component
          awareness of multi-scenario state. Single-scenario runs
          (``materialFlowsRuns.length <= 1``) render no tab bar — the
          existing UI is unchanged. */}
      {materialFlowsRuns.length > 1 && (
        <div
          data-testid="material-flows-scenario-tabs"
          style={{
            display: 'flex', gap: 4,
            borderBottom: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
          }}
        >
          {materialFlowsRuns.map((run) => {
            const isActive = run.scenario_id === activeMaterialFlowScenario
            return (
              <button
                key={run.scenario_id}
                type="button"
                data-testid={`material-flows-scenario-tab-${run.scenario_id}`}
                onClick={() => selectMaterialFlowScenario(run.scenario_id)}
                style={{
                  border: 'none', background: 'transparent',
                  borderBottom: isActive ? '2px solid var(--mod-dsm)' : '2px solid transparent',
                  padding: '6px 10px',
                  fontSize: 'var(--text-xs)',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  marginBottom: -1,
                  fontFamily: materialFlowAxis === 'parameter' ? 'var(--font-mono)' : 'inherit',
                }}
              >
                {run.scenario_label}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Results ─── */}
      {displayFlows && displayFlows.materials.length > 0 && (
        <CollapsibleCard
          expanded={resultsExpanded}
          onToggle={() => setResultsExpanded((v) => !v)}
          title="Material flows results"
          summary={
            <>
              <span>
                {allUnits.length > 1 ? (
                  <>
                    <strong style={{ color: 'var(--text-primary)' }}>{unitFlows?.materials.length ?? 0}</strong>
                    {' '}of{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{displayFlows.materials.length}</strong>
                    {' '}series{selectedUnit ? ` (${selectedUnit})` : ''}
                  </>
                ) : (
                  <><strong style={{ color: 'var(--text-primary)' }}>{displayFlows.materials.length}</strong> series</>
                )}
              </span>
              <span>grouped by <strong style={{ color: 'var(--text-primary)' }}>{displayFlows.group_by}</strong></span>
              {scoped && scopeSubsystemName && (
                <span style={{ color: 'var(--text-secondary)' }}>{scopeSubsystemName}</span>
              )}
              {!scoped && hasDependents && selectedSubsystem !== 'all' && (
                <span style={{ color: 'var(--text-secondary)' }}>
                  {subsystems.find((s) => s.id === selectedSubsystem)?.name ?? ''}
                </span>
              )}
              {displayFlows.elapsed_seconds > 0 && (
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                  {displayFlows.elapsed_seconds.toFixed(2)}s
                </span>
              )}
            </>
          }
          actions={
            <>
              {allUnits.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                    Unit
                  </span>
                  <select
                    value={selectedUnit ?? ''}
                    onChange={(e) => setSelectedUnit(e.target.value)}
                    style={{
                      height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
                      border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                      color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
                    }}
                  >
                    {allUnits.map((u) => (
                      <option key={u.unit} value={u.unit}>
                        {u.unit} ({u.count})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button
                variant="secondary"
                onClick={handleExport}
                disabled={isExporting}
                style={{ height: 28, fontSize: 'var(--text-xs)', padding: '0 10px' }}
                title="Export all units (one sheet per unit)"
              >
                <Download size={13} strokeWidth={1.5} /> {isExporting ? 'Exporting…' : 'Export Excel'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Summary card */}
          {summary && (
            <div style={cardStyle}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                Cumulative demand ({displayFlows.scope})
              </div>
              {displayFlows.stages_included.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Stages: {displayFlows.stages_included.join(', ')}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--mod-dsm)' }}>
                  {areaFormat.format(summary.unitTotal)}
                </span>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  {selectedUnit ?? ''} (total)
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 16 }}>
                  Peak in {summary.peakYear}: {areaFormat.format(summary.peakVal)} {selectedUnit ?? ''} | {summary.materialCount} series
                </span>
              </div>
              {allUnits.length > 1 && selectedUnit && (() => {
                const current = allUnits.find((u) => u.unit === selectedUnit)
                const biggest = allUnits[0]
                if (!current || !biggest) return null
                if (current.count >= Math.max(5, Math.ceil(biggest.count * 0.25))) return null
                return (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 6 }}>
                    {current.count} {current.count === 1 ? 'series' : 'series'} with unit {current.unit}.
                    {biggest.unit !== current.unit && (
                      <>
                        {' '}Switch to{' '}
                        <button
                          onClick={() => setSelectedUnit(biggest.unit)}
                          style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            color: 'var(--mod-dsm)', fontSize: 'inherit', textDecoration: 'underline',
                          }}
                        >
                          {biggest.unit}
                        </button>
                        {' '}to see {biggest.count} series.
                      </>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Stacked area chart */}
          <div style={cardStyle} key={chartKey}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {groupNounPluralTitle} quantities over time{selectedUnit ? ` (${selectedUnit})` : ''}
              </h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <NumberFormatControl settings={areaFormat.settings} onChange={areaFormat.setSettings} />
                <ChartExportButton
                  chartRef={areaChartRef}
                  filename={`mfa_${scope}_${groupBy}_${selectedUnit ?? 'mixed'}`}
                />
              </div>
            </div>
            <ChartExportContainer ref={areaChartRef} style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={areaData} margin={{ top: 8, right: 16, bottom: 8, left: 12 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                  <YAxis
                    domain={tightStackedDomain}
                    stroke="var(--text-tertiary)"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                    tickFormatter={(v) => areaFormat.format(v as number)}
                    label={selectedUnit ? { value: selectedUnit, angle: -90, position: 'insideLeft', style: { fill: 'var(--text-tertiary)', fontSize: 11 } } : undefined}
                  />
                  <Tooltip
                    content={<StackedTotalTooltip unit={selectedUnit ?? undefined} formatValue={areaFormat.format} />}
                  />
                  {materialKeys.map((k, i) => (
                    <Area
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stackId="1"
                      stroke={colorFor(materialColorMap, k, i)}
                      fill={colorFor(materialColorMap, k, i)}
                      fillOpacity={0.7}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </ChartExportContainer>
          </div>

          {/* Year slider — drives the bar chart, the per-year table column,
              and the unit-count context below. */}
          {years.length > 0 && detailYear != null && (
            <YearSlider
              years={years}
              value={detailYear}
              onChange={setDetailYear}
              accentColor="var(--mod-dsm)"
              variant="card"
              showDots={years.length <= 30}
              rightSlot={systemUnitsAtYear != null ? (
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-secondary)',
                    padding: '4px 10px',
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                  title={`System-wide ${unitLabel} at the selected year (from DSM ${scope === 'inflows' ? 'inflows' : scope === 'outflows' ? 'outflows' : 'stock'}).`}
                >
                  System: <strong style={{ color: 'var(--text-primary)' }}>{fmtInt(systemUnitsAtYear)}</strong> {unitLabel}
                </span>
              ) : undefined}
            />
          )}

          {yearBarData.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  {topN === 'all' ? 'All' : `Top ${topN}`} {groupNounPlural} in {detailYear}
                  {selectedUnit ? ` (${selectedUnit})` : ''}
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <NumberFormatControl settings={detailFormat.settings} onChange={detailFormat.setSettings} />
                  <ChartExportButton
                    chartRef={barChartRef}
                    filename={`mfa_top${topN}_${groupBy}_${detailYear}_${selectedUnit ?? 'mixed'}`}
                  />
                </div>
              </div>
              <ChartExportContainer ref={barChartRef} style={{ height: Math.max(200, yearBarData.length * 28) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={yearBarData} layout="vertical" margin={{ top: 4, right: 12, bottom: 20, left: 12 }}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      stroke="var(--text-tertiary)"
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      tickFormatter={(v) => detailFormat.format(v as number)}
                    />
                    <YAxis type="category" dataKey="name" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={140} />
                    <Tooltip
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      formatter={(v, _name, ctx) => {
                        const unit = (ctx?.payload as { unit?: string } | undefined)?.unit ?? ''
                        const units = (ctx?.payload as { units?: number | null } | undefined)?.units
                        if (groupBy === 'archetype' && units != null) {
                          return [`${detailFormat.format(Number(v))} ${unit} · ${fmtInt(units)} ${unitLabel}`, '']
                        }
                        return [`${detailFormat.format(Number(v))} ${unit}`.trim(), '']
                      }}
                    />
                    <Bar dataKey="quantity" fill="var(--mod-dsm)" fillOpacity={0.85} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartExportContainer>
              {groupBy !== 'archetype' && systemUnitsAtYear != null && (
                <div style={{
                  marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)',
                  borderTop: '1px solid var(--border-subtle)',
                  fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                  display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
                }}>
                  <span>System-wide {unitLabel} in {detailYear}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {fmtInt(systemUnitsAtYear)} {unitLabel}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Top contributors table — honours the Top-N selector and folds
              the residual rows into a single aggregate so the table, bar
              chart and export all share a consistent surface. */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Top {groupNounPlural}
              </h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                  Show
                </span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {TOP_N_OPTIONS.map((n) => (
                    <button
                      key={String(n)}
                      onClick={() => setTopN(n)}
                      style={{
                        padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        border: '1px solid ' + (topN === n ? 'var(--mod-dsm)' : 'var(--border-default)'),
                        backgroundColor: topN === n ? 'color-mix(in srgb, var(--mod-dsm) 12%, transparent)' : 'var(--bg-elevated)',
                        color: topN === n ? 'var(--mod-dsm)' : 'var(--text-primary)',
                        fontSize: 'var(--text-xs)', fontWeight: topN === n ? 600 : 500,
                      }}
                    >
                      {n === 'all' ? 'All' : `Top ${n}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 400 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={headCell}>{groupNounTitle}</th>
                    {groupBy === 'material' && <th style={headCell}>Stage</th>}
                    {groupBy === 'material' && <th style={headCell}>Component</th>}
                    <th style={{ ...headCell, textAlign: 'right' }}>{detailYear ?? 'Year'}</th>
                    {groupBy === 'archetype' && (
                      <th style={{ ...headCell, textAlign: 'right' }}>
                        {unitLabel} ({detailYear ?? 'Year'})
                      </th>
                    )}
                    <th style={{ ...headCell, textAlign: 'right' }}>Total</th>
                    <th style={{ ...headCell, textAlign: 'right' }}>Evolution</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const limit = topN === 'all' ? topMaterials.length : topN
                    const head = topMaterials.slice(0, limit)
                    const tail = topMaterials.slice(limit)
                    const rows = head.map((m) => (
                      <tr key={m.name + m.unit} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{m.name}</td>
                        {groupBy === 'material' && <td style={{ padding: '6px 10px' }}>{m.stage && <Badge label={m.stage} variant="mfa" />}</td>}
                        {groupBy === 'material' && <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{m.component}</td>}
                        <td style={{ ...numCell, color: 'var(--text-primary)' }}>{detailFormat.format(m.yearVal)}</td>
                        {groupBy === 'archetype' && (
                          <td style={{ ...numCell, color: 'var(--text-secondary)' }}>
                            {detailYear != null
                              ? fmtInt(archetypeUnitsByYear[m.name]?.[detailYear] ?? 0)
                              : '-'}
                          </td>
                        )}
                        <td style={{ ...numCell, color: 'var(--mod-dsm)', fontWeight: 600 }}>{detailFormat.format(m.total)}</td>
                        <td style={{ ...numCell }}>
                          <EvolutionBadge method={m.evolution_method} rate={m.evolution_rate} />
                        </td>
                      </tr>
                    ))
                    if (tail.length > 0) {
                      const otherYearVal = tail.reduce((s, m) => s + m.yearVal, 0)
                      const otherTotal = tail.reduce((s, m) => s + m.total, 0)
                      const otherUnits = groupBy === 'archetype' && detailYear != null
                        ? tail.reduce((s, m) => s + (archetypeUnitsByYear[m.name]?.[detailYear] ?? 0), 0)
                        : 0
                      rows.push(
                        <tr key="__other__" style={{ borderTop: '1px solid var(--border-default)', backgroundColor: 'var(--bg-elevated)' }}>
                          <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Other ({tail.length})</td>
                          {groupBy === 'material' && <td />}
                          {groupBy === 'material' && <td />}
                          <td style={{ ...numCell, color: 'var(--text-secondary)' }}>{detailFormat.format(otherYearVal)}</td>
                          {groupBy === 'archetype' && (
                            <td style={{ ...numCell, color: 'var(--text-secondary)' }}>{fmtInt(otherUnits)}</td>
                          )}
                          <td style={{ ...numCell, color: 'var(--text-secondary)', fontWeight: 600 }}>{detailFormat.format(otherTotal)}</td>
                          <td style={{ ...numCell, color: 'var(--text-tertiary)' }}>-</td>
                        </tr>,
                      )
                    }
                    return rows
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          </div>
        </CollapsibleCard>
      )}

      {/* Empty hint */}
      {!materialFlows && !materialFlowLoading && (
        <div style={{ padding: 'var(--space-6)', backgroundColor: 'var(--bg-surface)', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          {simulationResult
            ? 'Choose scope and group-by, then click Calculate to see material flow quantities.'
            : 'Run a simulation first (System dynamics tab), then calculate material flows here.'}
        </div>
      )}
    </div>
  )
}

function EvolutionBadge({ method, rate }: { method: string | null; rate: number | null }) {
  if (!method || method === 'fixed') return <span style={{ color: 'var(--text-tertiary)' }}>-</span>
  if (method === 'milestones') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 500, backgroundColor: 'color-mix(in srgb, var(--info) 10%, transparent)', color: 'var(--info)', borderRadius: 'var(--radius-sm)', border: '1px solid color-mix(in srgb, var(--info) 20%, transparent)' }}>
        milestones
      </span>
    )
  }
  const isRebound = method === 'rebound_effect'
  const pct = rate != null ? (rate * 100).toFixed(1) : '?'
  const sign = isRebound ? '+' : '-'
  const color = isRebound ? 'var(--warning)' : 'var(--success)'
  const Icon = isRebound ? TrendingUp : TrendingDown
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 'var(--text-xs)', fontWeight: 500, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`, color, borderRadius: 'var(--radius-sm)', border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}>
      <Icon size={12} /> {sign}{pct}%/yr
    </span>
  )
}
