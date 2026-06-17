import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, AlertCircle, ChevronDown, ChevronRight, Loader2, Download, Layers } from 'lucide-react'
import { BASE_SCENARIO, exportImpact, type MultiParamImpactResult } from '../../api/client'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { ComputeProgress } from '../ui/ComputeProgress'
import { YearSlider } from '../ui/YearSlider'
import { DSMScenariosChip } from './DSMScenariosChip'
import { useDSMStore } from '../../stores/dsmStore'
import type { DSMLCAResult } from '../../api/client'
import { useBOMStore } from '../../stores/bomStore'
import { useImpactStore } from '../../stores/impactStore'
import { useParameterStore } from '../../stores/parameterStore'
import { useProjectStore } from '../../stores/projectStore'
import { type DimensionDef } from '../../api/client'
import { IndicatorChecklist, MethodFamilySelect, useMethodSelection } from '../MethodPicker'
import { useChartColors, colorFor } from '../../utils/chartColors'
import { evaluateAxisConflict } from '../../utils/axisConflict'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import { StackedTotalTooltip } from '../charts/StackedTotalTooltip'
import { tightStackedDomain } from '../charts/yAxisDomain'
import { MultiScenarioImpactChart } from '../charts/MultiScenarioImpactChart'

const COHORT_SEP = '|'

const fmtCount = (n: number) => {
  if (n === 0) return '0'
  return Math.round(n).toLocaleString()
}

function parseCohortKey(key: string, dims: DimensionDef[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  const parts = key.split(COHORT_SEP)
  return nads.map((_, i) => parts[i] ?? '')
}

function enumerateCohortKeys(dims: DimensionDef[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  if (nads.length === 0) return []
  const labelLists = nads.map((d) => d.labels)
  const out: string[][] = [[]]
  for (const labels of labelLists) {
    const next: string[][] = []
    for (const acc of out) for (const l of labels) next.push([...acc, l])
    out.length = 0
    out.push(...next)
  }
  return out.map((parts) => parts.join(COHORT_SEP))
}

interface DSMImpactPanelProps {
  onNavigate?: (id: string) => void
}

function DSMImpactPanelImpl({ onNavigate }: DSMImpactPanelProps = {}) {
  const {
    activeSystem,
    simulationResult,
    systemState,
    activeView,
    selectedYear,
    cohortMappings,
    dsmLCAResults,
    dsmLCAWarnings,
    selectedResultIndex,
    isCalculatingLCA,
    error,
    fetchCohortMappings,
    runDSMLCA,
    selectResultIndex,
    exportDSMLCAResults,
  } = useDSMStore()

  const { fetchArchetypes } = useBOMStore()

  const [indicatorExpanded, setIndicatorExpanded] = useState(false)
  const [configExpanded, setConfigExpanded] = useState(true)
  const [resultsExpanded, setResultsExpanded] = useState(true)
  const [scope, setScope] = useState<'inflows' | 'outflows' | 'stock' | 'all'>('all')
  // Per-tab DSM scenario selection. N=1 collapses to the legacy single-
  // scenario path (re-simulates on pick, drives `dsmLCAResults`); N>1 routes
  // the calculation through the multi-DSM fan-out without re-simulating in
  // place.
  const [selectedDsmScenarioIds, setSelectedDsmScenarioIds] = useState<string[]>([])
  useEffect(() => {
    if (selectedDsmScenarioIds.length > 0) return
    const sid = activeView?.scenarioId ?? systemState?.active_scenario_id ?? null
    if (sid) setSelectedDsmScenarioIds([sid])
  }, [activeView?.scenarioId, systemState?.active_scenario_id, selectedDsmScenarioIds])
  const handlePickDsmScenarios = async (ids: string[]) => {
    setSelectedDsmScenarioIds(ids)
    if (ids.length === 1 && ids[0] !== selectedDsmScenarioIds[0]) {
      try {
        await useDSMStore.getState().simulate(ids[0])
      } catch {
        // store records the error; chip resets via simulationResult update
      }
    }
  }
  // Reset per-tab pick when active system changes.
  useEffect(() => { setSelectedDsmScenarioIds([]) }, [activeSystem?.id])
  const [methods, setMethods] = useState<string[][]>([])
  // System-level: default to ALL indicators of the selected method (re-defaults
  // on method change). Users can still deselect.
  const methodSelection = useMethodSelection(setMethods, undefined, true)
  const [yearStart, setYearStart] = useState<number | null>(null)
  const [yearEnd, setYearEnd] = useState<number | null>(null)
  const [completedElapsed, setCompletedElapsed] = useState<number | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [detailYear, setDetailYear] = useState<number | null>(null)
  const impactAreaRef = useRef<HTMLDivElement>(null)
  const impactMaterialBarsRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<number | null>(null)
  // Per-chart formatters. summaryFormat covers the time-series Area chart,
  // headline metric, and summary card; detailFormat covers the year-detail
  // breakdown (cohort table + material bars).
  const summaryFormat = useNumberFormatter()
  const detailFormat = useNumberFormatter()

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

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])
  useEffect(() => { if (activeSystem) fetchCohortMappings() }, [activeSystem?.id, fetchCohortMappings])

  useEffect(() => {
    if (!activeSystem?.id || dsmLCAResults.length === 0) return
    const first = dsmLCAResults[0]
    useImpactStore.getState().setStaticFromMFA({
      mfaSystemId: activeSystem.id,
      results: dsmLCAResults,
      scope: first.scope,
      yearStart: yearStart ?? null,
      yearEnd: yearEnd ?? null,
    })
  }, [dsmLCAResults, activeSystem?.id, yearStart, yearEnd])

  // Timer effect lives BELOW the store reads (lines 285+) so the
  // fan-out slot watchers can read them. See the `isAnyTaskRunning`
  // derivation + `useEffect` later in this component (Patch 4P).

  const cohortKeys = useMemo(() => activeSystem ? enumerateCohortKeys(activeSystem.dimensions) : [], [activeSystem])

  // Read-only count derived DIRECTLY from the shared store slice (no local
  // snapshot) so it always matches the DSM editor and the Prospective tab.
  // Editing the mapping happens only in the DSM tab (see "Edit in DSM →").
  const mappedCount = Object.values(cohortMappings).filter((v) => v?.archetype_id).length

  // Static scenario fan-out (multi-parameter sensitivity). Pulled directly
  // from impactStore so the panel can read each scenario's per-task progress
  // and switch the displayed result via the tab bar without re-running.
  const runScenarios = useImpactStore((s) => s.runScenarios)
  const runDSMScenarios = useImpactStore((s) => s.runDSMScenarios)
  const staticScenarioOrder = useImpactStore((s) => s.staticScenarioOrder)
  const staticScenarioRuns = useImpactStore((s) => s.staticScenarioRuns)
  const activeStaticScenario = useImpactStore((s) => s.activeStaticScenario)
  const selectStaticScenario = useImpactStore((s) => s.selectStaticScenario)
  const dsmScenarioOrder = useImpactStore((s) => s.staticDsmScenarioOrder)
  const dsmScenarioRuns = useImpactStore((s) => s.staticDsmScenarioRuns)
  const activeDsmScenario = useImpactStore((s) => s.activeStaticDsmScenario)
  const selectDsmScenario = useImpactStore((s) => s.selectStaticDsmScenario)
  const impactError = useImpactStore((s) => s.error)

  const paramScenarios = useParameterStore((s) => s.sets)
  const paramTable = useParameterStore((s) => s.table)
  const activeScenario = useParameterStore((s) => s.activeScenario)
  const fetchParamTable = useParameterStore((s) => s.fetchTable)
  const selectedScenarios = useParameterStore((s) => s.selectedScenarios)
  const toggleSelectedScenario = useParameterStore((s) => s.toggleSelectedScenario)
  useEffect(() => { if (paramScenarios.length === 0) { void fetchParamTable() } }, [paramScenarios.length, fetchParamTable])
  useEffect(() => { if (!paramTable) { void fetchParamTable() } }, [paramTable, fetchParamTable])

  // Multi-select sensitivity cases. N=1 → legacy single-scenario DSM-LCA path
  // (`useDSMStore.runDSMLCA`). N>1 → fan-out via `/impact/calculate-scenarios`
  // (mode:'static') and route results through the impactStore static slot.
  const availableScenarios = useMemo(
    () => [BASE_SCENARIO, ...(paramTable?.scenarios ?? [])],
    [paramTable],
  )
  const effectiveSelected = useMemo(
    () => selectedScenarios.filter((s) => availableScenarios.includes(s)),
    [selectedScenarios, availableScenarios],
  )
  // The legacy single-scenario path expects a parameter set id (string|null).
  // Derive it from the multi-select: first effective selection wins, falling
  // back to the parameter store's active scenario when nothing is checked.
  const selectedParamSetId = effectiveSelected[0] ?? activeScenario ?? null

  // Static LCI runs against the active bw2 project's base (non-prospective)
  // database. Surface the actual name in the source chip so the user sees the
  // real LCI source rather than a misleading SSP-shaped string.
  const projectDatabases = useProjectStore((s) => s.databases)
  const fetchProjectDatabases = useProjectStore((s) => s.fetchDatabases)
  useEffect(() => {
    if (projectDatabases.length === 0) void fetchProjectDatabases()
  }, [projectDatabases.length, fetchProjectDatabases])
  const baseDbName = useMemo(() => {
    const bases = projectDatabases.filter((d) => !d.is_prospective && d.name !== 'biosphere3')
    if (bases.length === 0) return 'base ecoinvent'
    return bases[0].name
  }, [projectDatabases])

  // Active scenario context — echoed inside Results so the card is
  // self-describing whether Configuration is expanded or collapsed.
  const dsmScenarioLabel = useMemo(() => {
    const scs = systemState?.scenarios ?? []
    if (selectedDsmScenarioIds.length > 1) {
      return `${selectedDsmScenarioIds.length} scenarios`
    }
    const sid = selectedDsmScenarioIds[0]
    const sel = scs.find((s) => s.id === sid)
      ?? scs.find((s) => s.is_base)
      ?? scs[0]
    return sel?.name ?? 'Base'
  }, [systemState?.scenarios, selectedDsmScenarioIds])
  // 3-way axis-conflict rule: at most one of {multi-LCI, multi-DSM,
  // multi-parameter} can be N>1 at a time. Static LCI pins LCI=1 (no
  // IAM/SSP fan-out); DSM and Parameter axes are live.
  const { conflict: axisConflict, message: axisConflictMessage } = evaluateAxisConflict({
    lci: 1,
    dsm: selectedDsmScenarioIds.length,
    parameter: effectiveSelected.length,
  })

  // Result display source. N=1 path keeps reading `dsmLCAResults` from
  // dsmStore (legacy /dsm-lca route). Multi-parameter (paramAxisN>1) reads
  // from the active static-parameter scenario slot. Multi-DSM reads from
  // the active static-side DSM-scenario slot when populated.
  const displayResults: DSMLCAResult[] = useMemo(() => {
    if (dsmScenarioOrder.length > 1 && activeDsmScenario) {
      const r = dsmScenarioRuns[activeDsmScenario]?.result
      if (r) return r.results
    }
    if (effectiveSelected.length > 1 && activeStaticScenario) {
      const r = staticScenarioRuns[activeStaticScenario]?.result
      return r?.results ?? []
    }
    return dsmLCAResults
  }, [
    dsmScenarioOrder.length, activeDsmScenario, dsmScenarioRuns,
    effectiveSelected.length, activeStaticScenario, staticScenarioRuns,
    dsmLCAResults,
  ])
  const mfaLCAResult = displayResults[selectedResultIndex] ?? null

  // Default detailYear from results. Must come after `mfaLCAResult` is
  // declared (TDZ) — the dep array is evaluated during render.
  useEffect(() => {
    if (mfaLCAResult && mfaLCAResult.years.length > 0) {
      const yrs = mfaLCAResult.years
      setDetailYear(yrs[Math.floor(yrs.length / 2)]?.year ?? yrs[0].year)
    }
  }, [mfaLCAResult])

  // Aggregate calc-in-flight signal: legacy N=1 path comes from dsmStore;
  // multi-parameter fan-out from the static slot; multi-DSM fan-out from
  // the DSM-axis slot (Patch 2E.2).
  const multiCalcRunning =
    staticScenarioOrder.length > 0 &&
    staticScenarioOrder.some((s) => {
      const j = staticScenarioRuns[s]?.job
      return j && !j.done
    })
  const dsmCalcRunning =
    dsmScenarioOrder.length > 0 &&
    dsmScenarioOrder.some((sid) => {
      const j = dsmScenarioRuns[sid]?.job
      return j && !j.done
    })
  const isAnyCalculating = isCalculatingLCA || multiCalcRunning || dsmCalcRunning

  // Patch 4P — elapsed timer must watch every fan-out slot, not just
  // ``isCalculatingLCA``. Pre-Patch-2E.2 the timer was correct: there
  // was one slot, ``isCalculatingLCA``, and one task. The multi-DSM
  // (Patch 2E.2) and multi-parameter (Patch 2C) fan-outs spawn N
  // parallel tasks under ``staticDsmScenarioRuns`` /
  // ``staticScenarioRuns``; none of those flip ``isCalculatingLCA``.
  // Wire the timer to ``isAnyCalculating`` (already computed above)
  // so it ticks regardless of which slot is in flight.
  // Patch 5AL — the LIVE elapsed counter now lives in <ComputeProgress>
  // (fed by useElapsedSeconds). This effect only records the FINAL elapsed
  // (`completedElapsed`) for the post-result "Calculated in Xs" metadata line;
  // no live interval, no bespoke seconds state.
  useEffect(() => {
    if (!isAnyCalculating) {
      if (startRef.current != null) {
        setCompletedElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      }
      startRef.current = null
      return
    }
    setCompletedElapsed(null)
    startRef.current = Date.now()
  }, [isAnyCalculating])

  const paramScenarioLabel = useMemo(() => {
    if (effectiveSelected.length > 1) {
      const names = effectiveSelected.map((id) => paramScenarios.find((s) => s.id === id)?.name ?? id)
      if (names.length <= 3) return names.join(', ')
      return `${names.length} cases`
    }
    const first = effectiveSelected[0] ?? selectedParamSetId
    return paramScenarios.find((s) => s.id === first)?.name ?? first ?? 'Base'
  }, [paramScenarios, effectiveSelected, selectedParamSetId])

  const handleCalculate = async () => {
    if (methods.length === 0 || mappedCount === 0) return
    if (axisConflict) return
    const ys = yearStart ?? undefined
    const ye = yearEnd ?? undefined
    const fullStart = availableYears[0]
    const fullEnd = availableYears[availableYears.length - 1]
    const effectiveYs = ys != null && ys !== fullStart ? ys : null
    const effectiveYe = ye != null && ye !== fullEnd ? ye : null
    if (selectedDsmScenarioIds.length > 1) {
      // Multi-DSM fan-out (Patch 2E.2): one task per DSM scenario via
      // /impact/calculate-scenarios with dsm_scenario_ids. Routes through
      // the impactStore DSM-scenario slot; bridges to the static job/result
      // for the active scenario.
      if (!activeSystem) return
      const basePayload: import('../../api/client').ImpactAssessmentRequest = {
        mode: 'static',
        mfa_system_id: activeSystem.id!,
        scope,
        methods,
        year_start: effectiveYs,
        year_end: effectiveYe,
        scenario: null,
        parameter_set_id: selectedParamSetId,
      }
      const scenariosMap = new Map((systemState?.scenarios ?? []).map((s) => [s.id, s.name]))
      const names: Record<string, string> = {}
      for (const sid of selectedDsmScenarioIds) names[sid] = scenariosMap.get(sid) ?? sid
      console.log('[Static LCI] POST /impact/calculate-scenarios (DSM axis)', { dsm_scenario_ids: selectedDsmScenarioIds })
      try {
        await runDSMScenarios(basePayload, selectedDsmScenarioIds, names)
      } catch (e) {
        console.error('[Static LCI] runDSMScenarios() threw', e)
      }
      return
    }
    if (effectiveSelected.length > 1) {
      // Multi-parameter fan-out via /impact/calculate-scenarios. Static mode
      // routes through the impactStore static-scenario slots; the panel reads
      // staticScenarioRuns[active].result.results below.
      if (!activeSystem) return
      const basePayload: import('../../api/client').ImpactAssessmentRequest = {
        mode: 'static',
        mfa_system_id: activeSystem.id!,
        scope,
        methods,
        year_start: effectiveYs,
        year_end: effectiveYe,
        scenario: null,
        parameter_set_id: null,
        ...(selectedDsmScenarioIds[0] ? { dsm_scenario_id: selectedDsmScenarioIds[0] } : {}),
      }
      console.log('[Static LCI] POST /impact/calculate-scenarios', { scenarios: effectiveSelected })
      try {
        await runScenarios(basePayload, effectiveSelected)
      } catch (e) {
        console.error('[Static LCI] runScenarios() threw', e)
      }
      return
    }
    await runDSMLCA(methods, scope, {
      yearStart: effectiveYs,
      yearEnd: effectiveYe,
      parameterSetId: selectedParamSetId,
    })
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      // Multi-DSM fan-out (Patch 2E.2 frontend; builder lands in 2E.3 — until
      // then the route 501s). Mutually exclusive with multi-LCI / multi-param
      // by the 3-way axisConflict rule, so this branch checks first.
      if (
        dsmScenarioOrder.length > 1
        && activeSystem
      ) {
        const entries = dsmScenarioOrder
          .map((sid) => {
            const r = dsmScenarioRuns[sid]
            if (!r?.result) return null
            return { scenario_id: sid, scenario_name: r.scenarioName, result: r.result }
          })
          .filter((x): x is { scenario_id: string; scenario_name: string; result: NonNullable<typeof x>['result'] } => x !== null)
        if (entries.length > 0) {
          const envelope: import('../../api/client').MultiDSMImpactResult = {
            result_type: 'multi_dsm',
            meta: entries[0].result.meta,
            scenarios: entries,
          }
          const sysName = activeSystem.name.replace(/[^\w.-]+/g, '_') || 'system'
          await exportImpact(
            { multi_dsm_result: envelope, year: selectedYear ?? null },
            `${sysName}_static_impact_multi_dsm.xlsx`,
          )
          return
        }
      }
      // Multi-parameter fan-out (N>1): assemble a MultiParamImpactResult
      // envelope client-side from each scenario tab's result and route
      // through /impact/export. The backend reads the project's parameter
      // table to populate the index sheet's varying-parameters columns.
      if (
        effectiveSelected.length > 1
        && staticScenarioOrder.length > 0
        && activeSystem
      ) {
        const entries = staticScenarioOrder
          .map((scen) => {
            const r = staticScenarioRuns[scen]?.result
            return r ? { scenario: scen, result: r } : null
          })
          .filter((x): x is { scenario: string; result: NonNullable<typeof x>['result'] } => x !== null)
        if (entries.length > 0) {
          const envelope: MultiParamImpactResult = {
            result_type: 'multi_param',
            meta: entries[0].result.meta,
            scenarios: entries,
          }
          const sysName = activeSystem.name.replace(/[^\w.-]+/g, '_') || 'system'
          await exportImpact(
            { multi_param_result: envelope, year: selectedYear ?? null },
            `${sysName}_static_impact_multi_param.xlsx`,
          )
          return
        }
      }
      await exportDSMLCAResults(selectedYear)
    } finally {
      setIsExporting(false)
    }
  }

  const yearCount = useMemo(() => {
    if (yearStart != null && yearEnd != null) return Math.max(0, yearEnd - yearStart + 1)
    if (activeSystem) return activeSystem.time_horizon.end_year - activeSystem.time_horizon.start_year + 1
    return 0
  }, [yearStart, yearEnd, activeSystem])

  // Stacked area: years × cohort impact
  const areaData = useMemo(() => {
    if (!mfaLCAResult) return []
    return mfaLCAResult.years.map((yr) => {
      const row: Record<string, number | string> = { year: yr.year }
      for (const [ck, impact] of Object.entries(yr.impact_by_cohort)) row[ck] = impact
      return row
    })
  }, [mfaLCAResult])

  const cohortStackKeys = useMemo(() => {
    if (!mfaLCAResult) return []
    const all = new Set<string>()
    mfaLCAResult.years.forEach((yr) => Object.keys(yr.impact_by_cohort).forEach((k) => all.add(k)))
    return Array.from(all)
  }, [mfaLCAResult])

  const cohortColorMap = useChartColors(cohortStackKeys)

  // Multi-DSM chart adapter (Patch 2E.2): build the {label, result}[] shape
  // expected by MultiScenarioImpactChart from the per-DSM scenario runs.
  // Filters to only fully-loaded results so partial states don't render
  // empty facets.
  const multiDsmChartScenarios = useMemo(() => {
    if (dsmScenarioOrder.length <= 1) return null
    const items = dsmScenarioOrder
      .map((sid) => {
        const r = dsmScenarioRuns[sid]
        if (!r?.result) return null
        return { label: r.scenarioName, result: r.result }
      })
      .filter((x): x is { label: string; result: import('../../api/client').ImpactAssessmentResult } => x !== null)
    return items.length > 1 ? items : null
  }, [dsmScenarioOrder, dsmScenarioRuns])

  // Selected year breakdown
  const yearBreakdown = useMemo(() => {
    if (!mfaLCAResult || detailYear == null) return null
    const yr = mfaLCAResult.years.find((y) => y.year === detailYear) ?? mfaLCAResult.years[0]
    if (!yr) return null
    const countData = yr.count_by_cohort ?? {}
    const rows = Object.entries(yr.impact_by_cohort).map(([ck, impact]) => {
      const cnt = countData[ck] ?? 0
      return {
        cohort_key: ck,
        count: cnt,
        total: impact,
        perUnit: cnt > 0 ? impact / cnt : 0,
        pct: yr.total_impact > 0 ? (impact / yr.total_impact) * 100 : 0,
      }
    }).sort((a, b) => b.total - a.total)
    return { yr, rows }
  }, [mfaLCAResult, detailYear])

  const materialBars = useMemo(() => {
    if (!mfaLCAResult || detailYear == null) return []
    const yr = mfaLCAResult.years.find((y) => y.year === detailYear) ?? mfaLCAResult.years[0]
    if (!yr) return []
    return Object.entries(yr.impact_by_material)
      .map(([name, impact]) => ({ name, impact }))
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 12)
  }, [mfaLCAResult, detailYear])

  if (!activeSystem) return null

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* ── Cohort → Archetype (read-only summary; the DSM tab is the single
          canonical editor). The count derives directly from the shared store
          slice so it always matches the DSM editor and the Prospective tab. ─── */}
      <div style={{ ...cardStyle, padding: 'var(--space-3) var(--space-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Cohort → Archetype
            </h3>
            <span data-testid="ia-cohort-mapped-count" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              · {mappedCount} of {cohortKeys.length} mapped
            </span>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('dsm')}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--mod-dsm)', fontSize: 'var(--text-xs)', fontWeight: 500,
                padding: 0,
              }}
            >
              Edit in DSM →
            </button>
          )}
        </div>
      </div>

      {/* ── Calculate environmental impact ─── */}
      <CollapsibleCard
        expanded={configExpanded}
        onToggle={() => setConfigExpanded((v) => !v)}
        title="Configuration"
        summary={!configExpanded ? (
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {methodSelection.count} indicator{methodSelection.count === 1 ? '' : 's'}
            {' · '}{({ inflows: 'Manufacturing', stock: 'Operation', outflows: 'End of Life', all: 'Full Lifecycle' } as const)[scope]}
            {' · '}{yearStart ?? '—'}–{yearEnd ?? '—'}
            {' · Sensitivity: '}{paramScenarios.find((s) => s.id === selectedParamSetId)?.name ?? selectedParamSetId ?? 'Base'}
          </span>
        ) : undefined}
      >
        {/* Static LCI computes against the active project's base ecoinvent
            (no IAM scenario axis). The chip names each coordinate explicitly
            so the user can't misread DSM-scenario × parameter-set as
            SSP × climate. Rendered unconditionally — the DSM chip is the
            only affordance for the multi-DSM axis, so users must see it
            before they've run a sim. */}
        <div data-testid="impact-coord-chip-static" style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          marginBottom: 'var(--space-4)',
          padding: '4px 12px',
          borderRadius: 999,
          fontSize: 'var(--text-xs)',
          backgroundColor: 'color-mix(in srgb, var(--mod-lca) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--mod-lca) 30%, transparent)',
          color: 'var(--text-primary)',
        }}>
          <ChipCoord label="LCI" value={baseDbName} accent="var(--mod-lca)" />
          <span style={{ color: 'var(--text-tertiary)' }}>·</span>
          <DSMScenariosChip
            selectedIds={selectedDsmScenarioIds}
            onChange={handlePickDsmScenarios}
            accentColor="var(--mod-lca)"
            disabled={isAnyCalculating}
          />
          <span style={{ color: 'var(--text-tertiary)' }}>·</span>
          <ChipCoord
            label="Parameters"
            value={paramScenarios.find((s) => s.id === selectedParamSetId)?.name ?? selectedParamSetId ?? 'Base'}
          />
        </div>
        {/* Top row: Impact Method · Scope · Years */}
        <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
            <label style={topLabel}>Impact Method</label>
            <MethodFamilySelect selection={methodSelection} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 280px' }}>
            <label style={topLabel}>Scope</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                { value: 'all', label: 'Full Lifecycle', tip: 'Sum of all three scope-paired passes (Manufacturing × inflows + Operation × stock + EoL × outflows).' },
                { value: 'inflows', label: 'Manufacturing', tip: 'Manufacturing stage × inflows (units produced each year).' },
                { value: 'stock', label: 'Operation', tip: 'Use Phase + Maintenance × in-service stock (units active each year).' },
                { value: 'outflows', label: 'End of Life', tip: 'End of Life stage × outflows (units retired each year).' },
              ] as const).map((s) => (
                <button
                  key={s.value}
                  onClick={() => setScope(s.value)}
                  disabled={isCalculatingLCA}
                  title={s.tip}
                  style={{
                    padding: '0 12px', height: 36, borderRadius: 'var(--radius-md)', cursor: isCalculatingLCA ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (scope === s.value ? 'var(--mod-lca)' : 'var(--border-default)'),
                    backgroundColor: scope === s.value ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)' : 'var(--bg-elevated)',
                    color: scope === s.value ? 'var(--mod-lca)' : 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', fontWeight: scope === s.value ? 600 : 500,
                    opacity: isCalculatingLCA ? 0.5 : 1, whiteSpace: 'nowrap',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={topLabel}>Years</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={yearStart ?? ''}
                onChange={(e) => setYearStart(Number(e.target.value))}
                disabled={isCalculatingLCA || availableYears.length === 0}
                style={yearSel}
              >
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>to</span>
              <select
                value={yearEnd ?? ''}
                onChange={(e) => setYearEnd(Number(e.target.value))}
                disabled={isCalculatingLCA || availableYears.length === 0}
                style={yearSel}
              >
                {availableYears.filter((y) => yearStart == null || y >= yearStart).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Middle: indicator selection (collapsible) */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div
            onClick={() => setIndicatorExpanded((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', marginBottom: indicatorExpanded ? 8 : 0 }}
          >
            <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
              {indicatorExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <label style={{ ...topLabel, margin: 0, cursor: 'pointer' }}>Indicator selection</label>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              · {methodSelection.count} of {methodSelection.totalIndicators} selected
            </span>
          </div>
          {indicatorExpanded && (
            <IndicatorChecklist selection={methodSelection} accent="var(--mod-lca)" maxHeight={320} />
          )}
        </div>

        {/* Bottom: sensitivity multi-select + Calculate pinned right.
            N=1 selection routes through the legacy DSM-LCA path; N>1 fans
            out via /impact/calculate-scenarios (mode:'static'). */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            flexShrink: 0, minWidth: 200,
          }}>
            <span style={{
              fontSize: 'var(--text-xs)', fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <Layers size={11} /> Sensitivity cases
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 2 }}>
                · {effectiveSelected.length}/{availableScenarios.length}
              </span>
            </span>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 2,
              padding: '6px 8px',
              maxHeight: 140, overflowY: 'auto',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
            }}>
              {availableScenarios.map((s) => {
                const isBase = s === BASE_SCENARIO
                const checked = effectiveSelected.includes(s)
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
                    title={isBase ? 'Base is always included' : `Toggle "${s}"`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isBase || isCalculatingLCA}
                      onChange={(e) => toggleSelectedScenario(s, e.target.checked)}
                    />
                    <span style={{ fontFamily: isBase ? 'inherit' : 'var(--font-mono)' }}>
                      {paramScenarios.find((p) => p.id === s)?.name ?? s}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
          <Button
            variant="primary"
            onClick={handleCalculate}
            disabled={methods.length === 0 || mappedCount === 0 || isAnyCalculating || axisConflict}
            title={axisConflictMessage ?? undefined}
            style={{ backgroundColor: 'var(--mod-lca)', height: 36 }}
          >
            {isAnyCalculating ? (
              <>
                <Loader2 size={14} style={{ animation: 'dsm-spin 1s linear infinite' }} />
                Calculating…
              </>
            ) : (
              <>
                <Calculator size={14} />
                {effectiveSelected.length > 1
                  ? ` Calculate (${effectiveSelected.length} cases × ${methods.length} method${methods.length === 1 ? '' : 's'})`
                  : methods.length > 1 ? ` Calculate (${methods.length} methods)` : ' Calculate'}
              </>
            )}
          </Button>
        </div>

        {axisConflict && (
          <div style={{ marginTop: 'var(--space-3)', padding: '8px 10px', backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)', borderRadius: 'var(--radius-md)', color: 'var(--warning)', fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={13} /> {axisConflictMessage}
          </div>
        )}

        <ComputeProgress
          active={isAnyCalculating}
          label={`Running LCA for ${yearCount} year${yearCount === 1 ? '' : 's'} × ${mappedCount} cohort${mappedCount === 1 ? '' : 's'} × ${methods.length} indicator${methods.length === 1 ? '' : 's'}…`}
          bar="indeterminate"
          statusColor="var(--mod-lca)"
          data-testid="dsm-impact-progress"
          style={{ marginTop: 'var(--space-3)' }}
        />
        {/* `dsm-spin` keyframe is referenced by this panel's button/status
            spinners (and other DSM chips); keep it defined unconditionally now
            that the running banner that used to host it is gone. */}
        <style>{`@keyframes dsm-spin { to { transform: rotate(360deg); } }`}</style>

        {(error || impactError) && (
          <div style={{ marginTop: 'var(--space-3)', padding: '8px 10px', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
            {error || impactError}
          </div>
        )}
      </CollapsibleCard>

      {dsmLCAWarnings.length > 0 && (
        <div style={{
          padding: '8px 12px',
          backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--warning)', fontSize: 'var(--text-xs)',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <AlertCircle size={13} /> Calculation warnings
          </div>
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            {dsmLCAWarnings.map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
        </div>
      )}

      {/* Scenario tab bar — multi-DSM (per-side slot) */}
      {dsmScenarioOrder.length > 1 && (
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
          padding: '6px 10px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{
            fontSize: 'var(--text-xs)', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
            marginRight: 4,
          }}>
            <Layers size={11} style={{ verticalAlign: '-1px' }} /> DSM
          </span>
          {dsmScenarioOrder.map((sid) => {
            const r = dsmScenarioRuns[sid]
            if (!r) return null
            const active = activeDsmScenario === sid
            const status = r.job.error ? 'error' : r.job.done ? (r.result ? 'ready' : 'empty') : 'running'
            return (
              <button
                key={sid}
                onClick={() => selectDsmScenario(sid)}
                title={r.job.error ?? `${r.job.stage} · ${Math.round(r.job.pct * 100)}%`}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  border: '1px solid ' + (active ? 'var(--mod-dsm)' : 'var(--border-default)'),
                  backgroundColor: active
                    ? 'color-mix(in srgb, var(--mod-dsm) 12%, transparent)'
                    : 'var(--bg-elevated)',
                  color: active ? 'var(--mod-dsm)' : 'var(--text-primary)',
                  fontSize: 'var(--text-xs)', fontWeight: active ? 600 : 500,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {r.scenarioName}
                {status === 'running' && <Loader2 size={10} style={{ animation: 'dsm-spin 1s linear infinite' }} />}
                {status === 'error' && <AlertCircle size={10} color="var(--danger)" />}
                {status === 'ready' && <span style={{ color: 'var(--success)' }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Scenario tab bar (shown after a multi-parameter run) */}
      {staticScenarioOrder.length > 1 && (
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
          padding: '6px 10px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{
            fontSize: 'var(--text-xs)', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
            marginRight: 4,
          }}>
            <Layers size={11} style={{ verticalAlign: '-1px' }} /> Showing
          </span>
          {staticScenarioOrder.map((s) => {
            const r = staticScenarioRuns[s]
            if (!r) return null
            const active = activeStaticScenario === s
            const status = r.job.error ? 'error' : r.job.done ? (r.result ? 'ready' : 'empty') : 'running'
            const label = paramScenarios.find((p) => p.id === s)?.name ?? s
            return (
              <button
                key={s}
                onClick={() => selectStaticScenario(s)}
                title={r.job.error ?? `${r.job.stage} · ${Math.round(r.job.pct * 100)}%`}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  border: '1px solid ' + (active ? 'var(--mod-lca)' : 'var(--border-default)'),
                  backgroundColor: active
                    ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)'
                    : 'var(--bg-elevated)',
                  color: active ? 'var(--mod-lca)' : 'var(--text-primary)',
                  fontSize: 'var(--text-xs)', fontWeight: active ? 600 : 500,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {label}
                {status === 'running' && <Loader2 size={10} style={{ animation: 'dsm-spin 1s linear infinite' }} />}
                {status === 'error' && <AlertCircle size={10} color="var(--danger)" />}
                {status === 'ready' && <span style={{ color: 'var(--success)' }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Results ─── */}
      {mfaLCAResult && (
        <CollapsibleCard
          expanded={resultsExpanded}
          onToggle={() => setResultsExpanded((v) => !v)}
          title="Results"
          summary={!resultsExpanded ? (
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {completedElapsed != null && completedElapsed > 0 && (
                <>Calculated in {Math.floor(completedElapsed / 60) > 0 ? `${Math.floor(completedElapsed / 60)}m ` : ''}{completedElapsed % 60}s · </>
              )}
              {displayResults.length} indicator{displayResults.length === 1 ? '' : 's'}
              {' · Peak: '}{summaryFormat.format(mfaLCAResult.summary.peak_impact)} {mfaLCAResult.unit} ({mfaLCAResult.summary.peak_year})
              {' · LCI: '}{baseDbName}{' · DSM: '}{dsmScenarioLabel}{' · Sensitivity: '}{paramScenarioLabel}
            </span>
          ) : undefined}
        >
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
          {/* Vertical indicator sidebar */}
          {displayResults.length > 1 && (
            <div style={{ width: 220, minWidth: 220, flexShrink: 0, alignSelf: 'flex-start', position: 'sticky', top: 0 }}>
              <div style={cardStyle}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 'var(--space-3)' }}>
                  Indicators
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 600, overflowY: 'auto' }}>
                  {displayResults.map((r, i) => {
                    const active = i === selectedResultIndex
                    const label = r.method[r.method.length - 1] || r.method_label || `Method ${i + 1}`
                    return (
                      <button
                        key={i}
                        onClick={() => selectResultIndex(i)}
                        title={r.method.join(' › ')}
                        style={{
                          width: '100%', textAlign: 'left', padding: '8px 10px',
                          background: active ? 'color-mix(in srgb, var(--mod-lca) 10%, transparent)' : 'transparent',
                          border: 'none', borderLeft: active ? '3px solid var(--mod-lca)' : '3px solid transparent',
                          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 400, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', lineHeight: 1.3 }}>
                          {label}
                        </div>
                        {r.unit && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>{r.unit}</div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Right content panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
            {/* Scenario-context echo. Mirrors the Configuration chip but
                renders as a non-interactive one-line subheader so Results
                stays self-describing whether Configuration is expanded or
                collapsed. */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              alignSelf: 'flex-start',
              padding: '4px 12px',
              borderRadius: 999,
              fontSize: 'var(--text-xs)',
              backgroundColor: 'color-mix(in srgb, var(--mod-lca) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--mod-lca) 30%, transparent)',
              color: 'var(--text-primary)',
            }}>
              <ChipCoord label="LCI" value={baseDbName} accent="var(--mod-lca)" />
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <ChipCoord label="DSM scenario" value={dsmScenarioLabel} accent="var(--mod-lca)" />
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <ChipCoord label="Sensitivity case" value={paramScenarioLabel} />
            </div>
            {/* Export + elapsed */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
              {completedElapsed != null && completedElapsed > 0 && (
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', padding: '2px 8px', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  Calculated in {Math.floor(completedElapsed / 60) > 0 ? `${Math.floor(completedElapsed / 60)}m ` : ''}{completedElapsed % 60}s
                </span>
              )}
              <Button variant="secondary" onClick={handleExport} disabled={isExporting}>
                <Download size={14} /> {isExporting ? 'Exporting…' : 'Export Excel'}
              </Button>
            </div>

          {/* Summary card */}
          <div style={cardStyle}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
              Cumulative impact ({mfaLCAResult.scope}, {mfaLCAResult.method.join(' › ')})
            </div>
            {mfaLCAResult.stages_included && mfaLCAResult.stages_included.length > 0 && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                Stages: {mfaLCAResult.stages_included.join(', ')}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--mod-lca)' }}>
                {summaryFormat.format(mfaLCAResult.summary.total_impact)}
              </span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{mfaLCAResult.unit}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 16 }}>
                Peak in {mfaLCAResult.summary.peak_year}: {summaryFormat.format(mfaLCAResult.summary.peak_impact)} {mfaLCAResult.unit}
              </span>
            </div>
          </div>

          {/* Stacked area chart. Multi-DSM (N>1, Patch 2E.2) swaps to the
              dual-view (Total / By cohort) chart with shared formatter and
              detailYear. Single-scenario keeps the legacy AreaChart. */}
          <div style={cardStyle}>
            {multiDsmChartScenarios ? (
              <MultiScenarioImpactChart
                scenarios={multiDsmChartScenarios}
                axisLabel="DSM scenarios"
                selectedResultIdx={selectedResultIndex}
                detailYear={detailYear}
                format={summaryFormat}
                cohortKeys={cohortStackKeys}
                cohortColorMap={cohortColorMap}
                filenameBase={`static_impact_multi_dsm_${mfaLCAResult.method.join('_')}_${mfaLCAResult.scope}`}
              />
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                  <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Impact over time, by cohort
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <NumberFormatControl settings={summaryFormat.settings} onChange={summaryFormat.setSettings} />
                    <ChartExportButton
                      chartRef={impactAreaRef}
                      filename={`impact_by_cohort_${mfaLCAResult.method.join('_')}_${mfaLCAResult.scope}`}
                    />
                  </div>
                </div>
                <ChartExportContainer ref={impactAreaRef} style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={areaData} margin={{ top: 8, right: 16, bottom: 8, left: 56 }}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <YAxis
                        domain={tightStackedDomain}
                        stroke="var(--text-tertiary)"
                        tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                        tickFormatter={(v) => summaryFormat.format(v as number)}
                        label={{ value: mfaLCAResult.unit, angle: -90, position: 'left', offset: 15, style: { fill: 'var(--text-tertiary)', fontSize: 11, textAnchor: 'middle' } }}
                      />
                      <Tooltip
                        content={<StackedTotalTooltip unit={mfaLCAResult.unit} formatValue={summaryFormat.format} />}
                      />
                      {cohortStackKeys.map((k, i) => (
                        <Area
                          key={k}
                          type="monotone"
                          dataKey={k}
                          stackId="1"
                          stroke={colorFor(cohortColorMap, k, i)}
                          fill={colorFor(cohortColorMap, k, i)}
                          fillOpacity={0.7}
                          isAnimationActive={false}
                        />
                      ))}
                      <ReferenceLine x={detailYear ?? undefined} stroke="var(--mod-dsm)" strokeDasharray="3 3" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartExportContainer>
              </>
            )}
          </div>

          {/* Year detail slider — drives ReferenceLine, cohort table, material chart live on every drag step */}
          {mfaLCAResult.years.length > 0 && detailYear != null && (
            <YearSlider
              years={mfaLCAResult.years.map((yr) => yr.year)}
              value={detailYear}
              onChange={setDetailYear}
              label="Year detail"
              accentColor="var(--mod-lca)"
              ariaLabel="Year detail"
              rightSlot={yearBreakdown ? (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  Total: {detailFormat.format(yearBreakdown.yr.total_impact)} {mfaLCAResult.unit}
                </span>
              ) : undefined}
            />
          )}

          {/* Year breakdown + material bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 'var(--space-4)' }}>
            {yearBreakdown && (
              <div style={cardStyle}>
                <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                  Impact by cohort in {yearBreakdown.yr.year}
                </h4>
                <div style={{ overflow: 'auto', maxHeight: 320 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>Cohort</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>Count</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>Per unit</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>Total ({mfaLCAResult.unit})</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)' }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearBreakdown.rows.map((row) => (
                        <tr key={row.cohort_key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '6px 10px', fontSize: 'var(--text-sm)' }}>
                            {parseCohortKey(row.cohort_key, activeSystem.dimensions).map((p, i) => (
                              <span key={i} style={{ marginRight: 4 }}><Badge label={p} variant="dsm" /></span>
                            ))}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{fmtCount(row.count)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{detailFormat.format(row.perUnit)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--mod-lca)', fontWeight: 600 }}>{detailFormat.format(row.total)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{row.pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Material contribution {detailYear != null ? `(${detailYear})` : ''}
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <NumberFormatControl settings={detailFormat.settings} onChange={detailFormat.setSettings} />
                  <ChartExportButton
                    chartRef={impactMaterialBarsRef}
                    filename={`material_contribution_${detailYear ?? ''}_${mfaLCAResult.method.join('_')}`}
                  />
                </div>
              </div>
              <ChartExportContainer ref={impactMaterialBarsRef} style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={materialBars} layout="vertical" margin={{ top: 4, right: 12, bottom: 20, left: 12 }}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      stroke="var(--text-tertiary)"
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      tickFormatter={(v) => detailFormat.format(v as number)}
                      label={{ value: mfaLCAResult.unit, position: 'insideBottom', offset: -6, style: { fill: 'var(--text-tertiary)', fontSize: 11 } }}
                    />
                    <YAxis type="category" dataKey="name" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={120} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                      formatter={(v) => (typeof v === 'number' ? detailFormat.format(v) : String(v))}
                    />
                    <Bar dataKey="impact" fill="var(--mod-lca)" fillOpacity={0.85} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartExportContainer>
            </div>
          </div>
          </div>
        </div>
        </CollapsibleCard>
      )}
    </div>
  )
}

// memo skips re-renders cascading from the parent ImpactAssessment when only
// activeTab/libraryOpen flip — panel still re-renders on its own store
// subscriptions. Pairs with the visibility-toggle pattern in
// pages/ImpactAssessment.tsx so inactive (display:none) panels don't redo
// virtual-DOM work on unrelated parent updates.
export const DSMImpactPanel = memo(DSMImpactPanelImpl)

const topLabel: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
}
const yearSel: React.CSSProperties = {
  height: 36, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
}

function ChipCoord({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{
        color: 'var(--text-tertiary)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        fontSize: 10,
      }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, color: accent ?? 'var(--text-primary)' }}>{value}</span>
    </span>
  )
}
