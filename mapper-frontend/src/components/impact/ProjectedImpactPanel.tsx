import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Calculator, ChevronDown, ChevronRight, Download, Loader2, Info, AlertCircle, Sparkles, Layers, Plus, X, Link2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useDSMStore } from '../../stores/dsmStore'
import { useBOMStore } from '../../stores/bomStore'
import { usePLCAStore } from '../../stores/plcaStore'
import { useImpactStore } from '../../stores/impactStore'
import { useParameterStore } from '../../stores/parameterStore'
import {
  BASE_SCENARIO, cancelTask, exportImpact,
  pairKey, pairedShortLabel,
  type MultiPairedImpactResult, type MultiParamImpactResult,
  type PairedDSMLCIRef, type ProspectiveScenarioRef,
} from '../../api/client'
import { StopButton } from '../ui/StopButton'
import { YearSlider } from '../ui/YearSlider'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { ComputeProgress } from '../ui/ComputeProgress'
import { DSMScenariosChip } from '../dsm/DSMScenariosChip'
import { IndicatorChecklist, MethodFamilySelect, useMethodSelection } from '../MethodPicker'
import { colorFor } from '../../utils/chartColors'
import { useDSMSystemColors } from '../../utils/dsmCohortColors'
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
// ── Panel ─────────────────────────────────────────────────────────────────────

function parseCohortKey(key: string, dims: { is_age?: boolean }[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  const parts = key.split(COHORT_SEP)
  return nads.map((_, i) => parts[i] ?? '')
}

function ProjectedImpactPanelImpl() {
  const { activeSystem, simulationResult, systemState, activeView, selectedYear, cohortMappings, fetchCohortMappings, stackByDimension } = useDSMStore()
  const { archetypes, fetchArchetypes } = useBOMStore()
  const { databases, fetchDatabases } = usePLCAStore()
  const {
    projectedJob, projectedResult, projectedMultiResult, run, runScenarios,
    runDSMScenarios, runPairedScenarios,
    projectedScenarioOrder, projectedScenarioRuns, activeProjectedScenario,
    selectProjectedScenario,
    projectedDsmScenarioOrder: dsmScenarioOrder,
    projectedDsmScenarioRuns: dsmScenarioRuns,
    activeProjectedDsmScenario: activeDsmScenario,
    selectProjectedDsmScenario: selectDsmScenario,
    pairedScenarioOrder, pairedScenarioRuns, activePairedScenario,
    selectPairedScenario,
    error: storeError,
  } = useImpactStore()

  const { staticResult } = useImpactStore()

  // Per-chart formatters. summaryFormat covers headline + collapsed-summary +
  // time-series Area chart; detailFormat covers the year-detail breakdown
  // (cohort table + material bars).
  const summaryFormat = useNumberFormatter()
  const detailFormat = useNumberFormatter()

  const [scope, setScope] = useState<'inflows' | 'outflows' | 'stock' | 'all'>('all')
  // Prospective-LCA temporal handling: 'interpolate' (default — blend the two
  // bracketing-anchor solves → smooth piecewise-linear profile) vs 'block'
  // (per-year nearest-earlier anchor db → step at 5-year boundaries; retained
  // for reproducibility of stepped results).
  // Per-tab DSM scenario selection (independent of Static LCI tab and DSM
  // Architect's active flag). N=1 collapses to the legacy single-scenario
  // path (re-simulates on pick); N>1 routes the calculation through the
  // multi-DSM fan-out (no in-place re-simulate).
  const [selectedDsmScenarioIds, setSelectedDsmScenarioIds] = useState<string[]>([])
  useEffect(() => {
    if (selectedDsmScenarioIds.length > 0) return
    const sid = activeView?.scenarioId ?? systemState?.active_scenario_id ?? null
    if (sid) setSelectedDsmScenarioIds([sid])
  }, [activeView?.scenarioId, systemState?.active_scenario_id, selectedDsmScenarioIds])
  const handlePickDsmScenarios = async (ids: string[]) => {
    setSelectedDsmScenarioIds(ids)
    // Single-select: re-simulate to drive the cohort/legacy display path.
    if (ids.length === 1 && ids[0] !== selectedDsmScenarioIds[0]) {
      try {
        await useDSMStore.getState().simulate(ids[0])
      } catch {
        // store records the error
      }
    }
  }
  useEffect(() => { setSelectedDsmScenarioIds([]) }, [activeSystem?.id])
  const [methods, setMethods] = useState<string[][]>([])
  // System-level: default to ALL indicators of the selected method (re-defaults
  // on method change). Users can still deselect.
  const methodSelection = useMethodSelection(setMethods, undefined, true)
  const [yearStart, setYearStart] = useState<number | null>(null)
  const [yearEnd, setYearEnd] = useState<number | null>(null)
  // Multi-select LCI scenarios. ``scenarioKeys[0]`` drives the headline +
  // time-series chart (Patch 2A renders only the first); the full list is sent
  // to the backend as ``lci_scenarios`` for sequential compute under one task.
  const [scenarioKeys, setScenarioKeys] = useState<string[]>([])
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false)
  // Paired DSM × LCI co-variation (Patch 2F.2). ``scenarioMode`` toggles
  // between independent multi-axis selections and paired co-variation.
  // ``pairs`` is the ordered list of (DSM scenario, LCI scenario) pairs sent
  // to the backend in paired mode. In independent mode the existing
  // ``scenarioKeys`` and ``selectedDsmScenarioIds`` lists drive the run.
  const [scenarioMode, setScenarioMode] = useState<'independent' | 'paired'>('independent')
  const [pairs, setPairs] = useState<PairedDSMLCIRef[]>([])
  // Reset paired state when switching systems (mirrors selectedDsmScenarioIds reset).
  useEffect(() => { setPairs([]); setScenarioMode('independent') }, [activeSystem?.id])
  const [selectedResultIdx, setSelectedResultIdx] = useState(0)
  const [isExporting, setIsExporting] = useState(false)
  const [detailYear, setDetailYear] = useState<number | null>(null)
  const projAreaRef = useRef<HTMLDivElement>(null)
  // Patch 4N — sibling legend ref so ChartExportButton's Mode picker
  // appears for the single-LCI by-cohort chart.
  const projLegendRef = useRef<HTMLDivElement>(null)
  const projMaterialBarsRef = useRef<HTMLDivElement>(null)
  const [indicatorExpanded, setIndicatorExpanded] = useState(false)
  const [configExpanded, setConfigExpanded] = useState(true)
  // Patch 5AE — the Year → Database mapping is a long per-year list; default
  // collapsed so it doesn't eat vertical space. Visibility-toggle (state kept).
  const [yearDbExpanded, setYearDbExpanded] = useState(false)
  const [resultsExpanded, setResultsExpanded] = useState(true)
  // Collapsible cohort-mappings info banner (default collapsed; per-session).
  const [infoBannerExpanded, setInfoBannerExpanded] = useState(false)

  const paramTable = useParameterStore((s) => s.table)
  const selectedScenarios = useParameterStore((s) => s.selectedScenarios)
  const toggleSelectedScenario = useParameterStore((s) => s.toggleSelectedScenario)
  const fetchParamTable = useParameterStore((s) => s.fetchTable)
  useEffect(() => { if (!paramTable) { void fetchParamTable() } }, [paramTable, fetchParamTable])
  const availableScenarios = useMemo(
    () => [BASE_SCENARIO, ...(paramTable?.scenarios ?? [])],
    [paramTable],
  )
  const effectiveSelected = useMemo(
    () => selectedScenarios.filter((s) => availableScenarios.includes(s)),
    [selectedScenarios, availableScenarios],
  )

  // Running = any scenario still in flight. Multi-scenario progress snapshot.
  const scenarioProgress = useMemo(() => {
    if (projectedScenarioOrder.length === 0) return null
    const runs = projectedScenarioOrder.map((s) => projectedScenarioRuns[s]).filter(Boolean)
    const total = runs.length
    const done = runs.filter((r) => r.job.done).length
    const active = runs.find((r) => !r.job.done) ?? runs[runs.length - 1]
    return { total, done, active }
  }, [projectedScenarioOrder, projectedScenarioRuns])

  // Patch 4P — `isRunning` must cover EVERY fan-out slot, not just
  // the legacy single-task path + parameter-axis fan-out. Multi-DSM
  // (Patch 2E.2) and paired DSM × LCI (Patch 2F) also spawn jobs in
  // their own runs maps; the elapsed timer below depends on this
  // boolean, and the Stop button surfaces it as the visual
  // "running / stopping / idle" state.
  const dsmCalcRunning = dsmScenarioOrder.length > 0
    && dsmScenarioOrder.some((sid) => {
      const j = dsmScenarioRuns[sid]?.job
      return j && !j.done
    })
  const pairedCalcRunning = pairedScenarioOrder.length > 0
    && pairedScenarioOrder.some((k) => {
      const j = pairedScenarioRuns[k]?.job
      return j && !j.done
    })
  const isRunning = scenarioProgress
    ? scenarioProgress.done < scenarioProgress.total
    : (!!projectedJob && !projectedJob.done) || dsmCalcRunning || pairedCalcRunning

  // Stop control: cancels every in-flight projected task. Single-run mode has
  // one task on ``projectedJob.taskId``; scenario mode fans out N concurrent
  // tasks under ``projectedScenarioRuns``. Each WS connection delivers its own
  // ``cancelled`` frame, so we just POST cancel for each and the store
  // finalises state via existing handlers.
  const [isStopping, setIsStopping] = useState(false)
  useEffect(() => { if (!isRunning) setIsStopping(false) }, [isRunning])
  const stopState = isStopping ? 'stopping' : isRunning ? 'running' : 'idle'
  const stopTaskId = scenarioProgress
    ? (scenarioProgress.active.job.taskId || null)
    : (projectedJob?.taskId ?? null)
  const requestStop = async () => {
    setIsStopping(true)
    const ids: string[] = []
    if (projectedScenarioOrder.length > 0) {
      for (const s of projectedScenarioOrder) {
        const r = projectedScenarioRuns[s]
        if (r && !r.job.done && r.job.taskId) ids.push(r.job.taskId)
      }
    } else if (projectedJob && !projectedJob.done && projectedJob.taskId) {
      ids.push(projectedJob.taskId)
    }
    await Promise.all(ids.map((id) => cancelTask(id).catch(() => null)))
  }

  const handleExport = async () => {
    if (!projectedResult || !activeSystem) return
    setIsExporting(true)
    try {
      const sysName = activeSystem.name.replace(/[^\w.-]+/g, '_') || 'system'
      // Paired DSM × LCI fan-out (Patch 2F). Checked before multi-DSM /
      // multi-param because paired is mutually exclusive with all other
      // axes by axisConflict.
      if (pairedScenarioOrder.length > 1) {
        const entries = pairedScenarioOrder
          .map((k) => {
            const r = pairedScenarioRuns[k]
            if (!r?.result) return null
            return {
              dsm_scenario_id: r.dsmScenarioId,
              dsm_scenario_name: r.dsmScenarioName,
              lci_scenario: r.lciScenario,
              lci_scenario_label: `${r.lciScenario.iam.toUpperCase()}/${r.lciScenario.ssp}`,
              result: r.result,
            }
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
        if (entries.length > 0) {
          const envelope: MultiPairedImpactResult = {
            result_type: 'multi_paired_dsm_lci',
            meta: entries[0].result.meta,
            scenarios: entries,
          }
          await exportImpact(
            { multi_paired_result: envelope, year: selectedYear ?? null },
            `${sysName}_projected_impact_multi_paired.xlsx`,
          )
          return
        }
      }
      // Multi-DSM fan-out (Patch 2E.2 frontend, builder lands in 2E.3 — until
      // then the route 501s). Checked first because it's mutually exclusive
      // with multi-LCI / multi-param by the 3-way axisConflict rule.
      if (dsmScenarioOrder.length > 1) {
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
          await exportImpact(
            { multi_dsm_result: envelope, year: selectedYear ?? null },
            `${sysName}_projected_impact_multi_dsm.xlsx`,
          )
          return
        }
      }
      // Multi-parameter fan-out (N>1 sensitivity cases) routes through the
      // multi-param builder. Mutually exclusive with multi-LCI by the 3-way
      // axisConflict rule, so this branch checks first.
      if (effectiveSelected.length > 1 && projectedScenarioOrder.length > 0) {
        const entries = projectedScenarioOrder
          .map((scen) => {
            const r = projectedScenarioRuns[scen]?.result
            return r ? { scenario: scen, result: r } : null
          })
          .filter((x): x is { scenario: string; result: NonNullable<typeof x>['result'] } => x !== null)
        if (entries.length > 0) {
          const envelope: MultiParamImpactResult = {
            result_type: 'multi_param',
            meta: entries[0].result.meta,
            scenarios: entries,
          }
          await exportImpact(
            { multi_param_result: envelope, year: selectedYear ?? null },
            `${sysName}_projected_impact_multi_param.xlsx`,
          )
          return
        }
      }
      // Multi-LCI runs route through the dedicated workbook (LCI Scenario
      // column on every data sheet). Static comparison is suppressed in
      // multi-mode to keep the file readable.
      if (projectedMultiResult && projectedMultiResult.scenarios.length > 1) {
        await exportImpact(
          {
            multi_result: projectedMultiResult,
            year: selectedYear ?? null,
          },
          `${sysName}_projected_impact_multi_lci.xlsx`,
        )
      } else {
        await exportImpact(
          {
            result: projectedResult,
            year: selectedYear ?? null,
            compare_result: staticResult ?? null,
          },
          `${sysName}_projected_impact.xlsx`,
        )
      }
    } catch (e) {
      console.error('Export failed', e)
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])
  useEffect(() => { fetchDatabases() }, [fetchDatabases])
  useEffect(() => { if (activeSystem) fetchCohortMappings() }, [activeSystem?.id, fetchCohortMappings])

  const scenarios = useMemo(() => {
    const map = new Map<string, { base_db: string; iam: string; ssp: string; years: number[] }>()
    for (const d of databases) {
      const key = `${d.base_db}|${d.iam}|${d.ssp}`
      const entry = map.get(key) ?? { base_db: d.base_db, iam: d.iam, ssp: d.ssp, years: [] }
      if (d.year != null) entry.years.push(d.year)
      map.set(key, entry)
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v, years: v.years.sort((a, b) => a - b) }))
  }, [databases])

  // Default scenario selection: pick the first available LCI scenario when
  // none is selected yet. Drop any selected keys that no longer exist (e.g.
  // after a project switch wipes the prospective DB list).
  useEffect(() => {
    if (scenarios.length === 0) return
    const valid = new Set(scenarios.map((s) => s.key))
    const filtered = scenarioKeys.filter((k) => valid.has(k))
    if (filtered.length === 0) {
      setScenarioKeys([scenarios[0].key])
    } else if (filtered.length !== scenarioKeys.length) {
      setScenarioKeys(filtered)
    }
  }, [scenarios, scenarioKeys])

  // Patch 5AL — the live elapsed counter is owned by <ComputeProgress> (fed by
  // useElapsedSeconds); no bespoke interval timer here. Post-result time comes
  // from projectedResult.elapsed_seconds.

  // Default detailYear from results
  useEffect(() => {
    if (projectedResult && projectedResult.results[0]?.years.length) {
      const yrs = projectedResult.results[0].years
      setDetailYear(yrs[Math.floor(yrs.length / 2)]?.year ?? yrs[0].year)
    }
  }, [projectedResult])

  const selectedScenarioObjs = useMemo(
    () => scenarioKeys.map((k) => scenarios.find((s) => s.key === k)).filter(Boolean) as typeof scenarios,
    [scenarioKeys, scenarios],
  )
  const selectedScenario = selectedScenarioObjs[0] ?? null

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
  const paramScenarioLabel = useMemo(() => {
    if (effectiveSelected.length > 1) return `${effectiveSelected.length} cases`
    return effectiveSelected[0] ?? BASE_SCENARIO
  }, [effectiveSelected])
  const toggleScenarioKey = (key: string) => {
    if (scenarioKeys.includes(key)) {
      if (scenarioKeys.length <= 1) return
      setScenarioKeys(scenarioKeys.filter((k) => k !== key))
    } else {
      setScenarioKeys([...scenarioKeys, key])
    }
  }
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

  const mappedCount = Object.values(cohortMappings).filter((v) => v?.archetype_id).length
  const unlinkedArchetypes = useMemo(() => new Set(archetypes.filter((a) => a.unlinked_count > 0).map((a) => a.id)), [archetypes])
  const mappedUnlinked = Object.values(cohortMappings).filter((v) => v?.archetype_id && unlinkedArchetypes.has(v.archetype_id)).length

  // 4-way axis-conflict rule: at most one of {multi-LCI, multi-DSM,
  // multi-parameter, paired} can be N>1 at a time. In paired mode the
  // independent LCI/DSM/parameter selections collapse to N=1 for conflict
  // purposes (the pair list IS the axis), so only ``paired`` is counted.
  const isPairedMode = scenarioMode === 'paired'
  const { conflict: axisConflict, message: axisConflictMessage } = evaluateAxisConflict({
    lci: isPairedMode ? 1 : selectedScenarioObjs.length,
    dsm: isPairedMode ? 1 : selectedDsmScenarioIds.length,
    parameter: isPairedMode ? 1 : effectiveSelected.length,
    paired: isPairedMode ? pairs.length : 0,
  })

  // Inline duplicate detection on the pair list. Uses the same key format the
  // backend uses for fan-out task ids (``<dsm>::<base_db>::<iam>::<ssp>``).
  const duplicatePairKeys = useMemo(() => {
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const p of pairs) {
      if (!p.dsm_scenario_id || !p.lci_scenario.base_db) continue
      const k = pairKey(p)
      if (seen.has(k)) dupes.add(k)
      else seen.add(k)
    }
    return dupes
  }, [pairs])

  // DSM scenario name lookup (for pair labels and fan-out call).
  const dsmScenariosList = systemState?.scenarios ?? []
  const dsmScenarioNameMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of dsmScenariosList) m[s.id] = s.name
    return m
  }, [dsmScenariosList])

  const preflightIssues = useMemo(() => {
    const issues: string[] = []
    if (!activeSystem) issues.push('Select an DSM system.')
    if (!simulationResult) issues.push('Run the DSM simulation first (Simulation tab).')
    if (mappedCount === 0) issues.push('Save at least one cohort → archetype mapping (Static Background tab).')
    if (methods.length === 0) issues.push('Select at least one impact indicator below.')
    if (mappedUnlinked > 0) issues.push(`Resolve unlinked materials in ${mappedUnlinked} mapped archetype(s).`)
    if (isPairedMode) {
      if (pairs.length === 0) issues.push('Add at least one DSM × LCI pair, or switch to Independent mode.')
      const incomplete = pairs.filter((p) => !p.dsm_scenario_id || !p.lci_scenario.base_db).length
      if (incomplete > 0) issues.push(`Finish ${incomplete} incomplete pair${incomplete === 1 ? '' : 's'} (pick both DSM and LCI scenario).`)
      if (duplicatePairKeys.size > 0) issues.push(`Remove ${duplicatePairKeys.size} duplicate pair${duplicatePairKeys.size === 1 ? '' : 's'}.`)
    } else {
      if (selectedScenarioObjs.length === 0) issues.push('Pick at least one prospective LCI scenario.')
      if (effectiveSelected.length === 0) issues.push('Select at least one parameter scenario.')
    }
    if (axisConflict && axisConflictMessage) {
      issues.push(axisConflictMessage)
    }
    return issues
  }, [activeSystem, simulationResult, mappedCount, methods.length, selectedScenarioObjs.length, effectiveSelected.length, mappedUnlinked, axisConflict, axisConflictMessage, isPairedMode, pairs, duplicatePairKeys])

  const canRun = preflightIssues.length === 0

  const handleRun = async () => {
    console.log('[Projected LCI] Calculate clicked', {
      canRun, preflightIssues,
      activeSystemId: activeSystem?.id, hasSimulation: !!simulationResult,
      mappedCount, methods: methods.length,
      lciScenarios: selectedScenarioObjs.map((s) => s.key),
    })
    if (!canRun) {
      useImpactStore.setState({
        error: 'Cannot run: ' + preflightIssues.join(' '),
      })
      return
    }
    if (!activeSystem || selectedScenarioObjs.length === 0) return
    const fullStart = availableYears[0]
    const fullEnd = availableYears[availableYears.length - 1]
    const ys = yearStart != null && yearStart !== fullStart ? yearStart : null
    const ye = yearEnd != null && yearEnd !== fullEnd ? yearEnd : null
    const scenarioRefs: ProspectiveScenarioRef[] = selectedScenarioObjs.map((s) => ({
      base_db: s.base_db,
      iam: s.iam,
      ssp: s.ssp,
    }))
    const basePayload: import('../../api/client').ImpactAssessmentRequest = {
      mode: 'projected',
      mfa_system_id: activeSystem.id!,
      scope,
      methods,
      year_start: ys,
      year_end: ye,
      // ``scenario`` is kept for backward-compat with consumers that read
      // ``meta.scenario`` on a single-scenario projected response. Backend
      // gives ``lci_scenarios`` precedence.
      scenario: scenarioRefs[0],
      lci_scenarios: scenarioRefs,
      parameter_set_id: null,
      // Always interpolate from the UI (the block path stays API-reachable).
      temporal_mode: 'interpolate',
    }
    if (axisConflict) return
    // Paired branch first — when in paired mode it's the only valid axis.
    if (isPairedMode) {
      const single = effectiveSelected[0] ?? BASE_SCENARIO
      const payload = { ...basePayload, parameter_set_id: single }
      const names: Record<string, string> = {}
      for (const p of pairs) names[p.dsm_scenario_id] = dsmScenarioNameMap[p.dsm_scenario_id] ?? p.dsm_scenario_id
      console.log('[Projected LCI] POST /impact/calculate-scenarios (paired)', { pairs })
      try {
        await runPairedScenarios(payload, pairs, names)
      } catch (e) {
        console.error('[Projected LCI] runPairedScenarios() threw', e)
      }
      return
    }
    if (selectedDsmScenarioIds.length > 1) {
      const scenariosMap = new Map((systemState?.scenarios ?? []).map((s) => [s.id, s.name]))
      const names: Record<string, string> = {}
      for (const sid of selectedDsmScenarioIds) names[sid] = scenariosMap.get(sid) ?? sid
      const single = effectiveSelected[0] ?? BASE_SCENARIO
      const payload = { ...basePayload, parameter_set_id: single }
      console.log('[Projected LCI] POST /impact/calculate-scenarios (DSM axis)', { dsm_scenario_ids: selectedDsmScenarioIds })
      try {
        await runDSMScenarios(payload, selectedDsmScenarioIds, names)
      } catch (e) {
        console.error('[Projected LCI] runDSMScenarios() threw', e)
      }
    } else if (effectiveSelected.length > 1) {
      const payloadWithDsm = selectedDsmScenarioIds[0]
        ? { ...basePayload, dsm_scenario_id: selectedDsmScenarioIds[0] }
        : basePayload
      console.log('[Projected LCI] POST /impact/calculate-scenarios', { scenarios: effectiveSelected })
      try {
        await runScenarios(payloadWithDsm, effectiveSelected)
      } catch (e) {
        console.error('[Projected LCI] runScenarios() threw', e)
      }
    } else {
      const single = effectiveSelected[0] ?? BASE_SCENARIO
      const payload = {
        ...basePayload,
        parameter_set_id: single,
        ...(selectedDsmScenarioIds[0] ? { dsm_scenario_id: selectedDsmScenarioIds[0] } : {}),
      }
      console.log('[Projected LCI] POST /impact/calculate', payload)
      try {
        await run(payload)
      } catch (e) {
        console.error('[Projected LCI] run() threw', e)
      }
    }
  }

  const selectedResult = projectedResult?.results[selectedResultIdx] ?? null

  const areaData = useMemo(() => {
    if (!selectedResult) return []
    return selectedResult.years.map((yr) => {
      const row: Record<string, number | string> = { year: yr.year }
      for (const [ck, impact] of Object.entries(yr.impact_by_cohort)) row[ck] = impact
      return row
    })
  }, [selectedResult])

  const cohortStackKeys = useMemo(() => {
    if (!selectedResult) return []
    const all = new Set<string>()
    selectedResult.years.forEach((yr) => Object.keys(yr.impact_by_cohort).forEach((k) => all.add(k)))
    return Array.from(all)
  }, [selectedResult])

  // Patch 4N — color cohorts by their value of the user's currently-
  // selected DSM Stack-by dimension, so a band representing
  // ``BEV-LFP|Small|2028`` here shares the color the DSM Stock
  // Composition chart uses for ``BEV-LFP``. When `stackByDimension`
  // is null (DSM has no grouping), `colorForCohort` falls back to a
  // palette-by-index assignment so cohorts remain visually
  // distinguishable.
  // Patch 4AK — wire per-row color overrides into the cohort-color
  // resolution. Row overrides only apply in null-stackBy (cohort-key
  // stacked) branch — see useDSMSystemColors.
  const cohortRowColors = useDSMStore((s) => s.cohortRowColors)
  const dsmColors = useDSMSystemColors(activeSystem ?? null, stackByDimension, {
    rowColorOverrides: cohortRowColors,
  })
  // Patch 5AG — the multi-scenario "By cohort" facets consume a cohort-key →
  // color map as a prop. Resolve it through the SHARED cohort resolver
  // (`dsmColors.colorForCohort`, identity-keyed with two-layer base+override),
  // NOT a generic palette — so By-cohort impact bands match the DSM charts +
  // cohort mapping. Keyed by cohort identity (index only as the resolver's last
  // fallback) → stable: adding/hiding a band never recolors the others.
  const cohortColorMap = useMemo(() => {
    const m: Record<string, string> = {}
    cohortStackKeys.forEach((ck, i) => { m[ck] = dsmColors.colorForCohort(ck, i) })
    return m
  }, [cohortStackKeys, dsmColors])

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

  // Paired chart adapter (Patch 2F.2). Same shape as multiDsmChartScenarios
  // but labels each facet with the short pair label (``<dsm> × <iam>/<ssp>``)
  // for legend/title legibility.
  const multiPairedChartScenarios = useMemo(() => {
    if (pairedScenarioOrder.length <= 1) return null
    const items = pairedScenarioOrder
      .map((key) => {
        const r = pairedScenarioRuns[key]
        if (!r?.result) return null
        return { label: pairedShortLabel(r.dsmScenarioName, r.lciScenario), result: r.result }
      })
      .filter((x): x is { label: string; result: import('../../api/client').ImpactAssessmentResult } => x !== null)
    return items.length > 1 ? items : null
  }, [pairedScenarioOrder, pairedScenarioRuns])

  const yearBreakdown = useMemo(() => {
    if (!selectedResult || detailYear == null) return null
    const yr = selectedResult.years.find((y) => y.year === detailYear) ?? selectedResult.years[0]
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
  }, [selectedResult, detailYear])

  const materialBars = useMemo(() => {
    if (!selectedResult || detailYear == null) return []
    const yr = selectedResult.years.find((y) => y.year === detailYear) ?? selectedResult.years[0]
    if (!yr) return []
    return Object.entries(yr.impact_by_material)
      .map(([name, impact]) => ({ name, impact }))
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 12)
  }, [selectedResult, detailYear])

  const card: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
  }

  if (!activeSystem) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Select an DSM system first.</div>
  }

  if (scenarios.length === 0) {
    return (
      <div style={{
        ...card,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, textAlign: 'center', padding: 'var(--space-8)', minHeight: 240,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'color-mix(in srgb, var(--mod-plca) 12%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Sparkles size={20} color="var(--mod-plca)" />
        </div>
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
          No prospective databases generated yet
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', maxWidth: 440 }}>
          Go to <b>pLCA Developer</b> to generate premise databases for future years, then come back here to run the prospective background against your DSM system.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Preflight — collapsible cohort-mappings info banner. */}
      <div
        data-testid="projected-info-banner"
        style={{
          padding: '10px 14px',
          backgroundColor: 'color-mix(in srgb, var(--mod-plca) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--mod-plca) 30%, transparent)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}
      >
        <button
          type="button"
          data-testid="projected-info-banner-toggle"
          aria-expanded={infoBannerExpanded}
          onClick={() => setInfoBannerExpanded((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            border: 'none', background: 'transparent', padding: 0, margin: 0,
            cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'left',
          }}
        >
          <Info size={14} color="var(--mod-plca)" />
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            Cohort mappings ({mappedCount} mapped)
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
            {infoBannerExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </button>
        {infoBannerExpanded && (
          <span data-testid="projected-info-banner-body">
            Cohort mappings are shared across Static and Prospective Background — one per DSM system. Each year is matched to a prospective database via premise (exact → nearest earlier → earliest available).
          </span>
        )}
      </div>

      {/* Controls */}
      <CollapsibleCard
        expanded={configExpanded}
        onToggle={() => setConfigExpanded((v) => !v)}
        title="Configuration"
        summary={!configExpanded ? (
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {methodSelection.count} indicator{methodSelection.count === 1 ? '' : 's'}
            {' · '}{({ inflows: 'Manufacturing', stock: 'Operation', outflows: 'End of Life', all: 'Full Lifecycle' } as const)[scope]}
            {' · '}{yearStart ?? '—'}–{yearEnd ?? '—'}
            {isPairedMode
              ? ` · Paired: ${pairs.length} pair${pairs.length === 1 ? '' : 's'}`
              : ` · ${scenarioKeys.length} LCI scenario${scenarioKeys.length === 1 ? '' : 's'} · Sensitivity: ${effectiveSelected.length === 1 ? effectiveSelected[0] : `${effectiveSelected.length} cases`}`}
          </span>
        ) : undefined}
      >
        {/* Mode toggle (Patch 2F.2): Independent vs Paired co-variation.
            Independent = today's behaviour; Paired = N pairs of (DSM × LCI)
            run as N tasks under one fan-out POST. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)' }}>
          <span style={labelS as React.CSSProperties}>Scenario mode</span>
          <div role="tablist" aria-label="Scenario mode" style={{
            display: 'inline-flex', gap: 4,
            padding: 3,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
          }}>
            {([
              { value: 'independent' as const, label: 'Independent', tip: 'Multi-LCI, multi-DSM, or multi-parameter — pick one axis at a time.' },
              { value: 'paired' as const, label: 'Paired DSM × LCI', tip: 'Run N matched (DSM scenario × LCI scenario) pairs as one coherent SSP-N future per pair.' },
            ]).map((opt) => {
              const active = scenarioMode === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`scenario-mode-${opt.value}`}
                  onClick={() => setScenarioMode(opt.value)}
                  disabled={isRunning}
                  title={opt.tip}
                  style={{
                    padding: '4px 12px', borderRadius: 'var(--radius-sm)', cursor: isRunning ? 'not-allowed' : 'pointer',
                    border: 'none',
                    background: active ? 'var(--mod-plca)' : 'transparent',
                    color: active ? 'var(--bg-surface)' : 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', fontWeight: active ? 600 : 500,
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Paired DSM × LCI editor (Patch 2F.2). Sits immediately after the
            Scenario Mode toggle so the toggle's "Paired DSM × LCI" choice and
            its primary affordance are visually adjacent (Patch 2I order). In
            Independent mode the slot is omitted — no empty space. */}
        {isPairedMode && (
          <PairListEditor
            pairs={pairs}
            onChange={setPairs}
            dsmScenarios={dsmScenariosList}
            lciScenarios={scenarios}
            disabled={isRunning}
            duplicateKeys={duplicatePairKeys}
          />
        )}

        {/* Coordinate chip: shows DSM scenario binding for this calculation.
            Rendered unconditionally in Independent mode — the chip is the
            affordance users need to discover the multi-DSM axis before
            running anything. In Paired mode the pair editor IS the binding. */}
        {!isPairedMode && (
          <div data-testid="impact-coord-chip-projected" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            marginBottom: 'var(--space-4)',
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 'var(--text-xs)',
            backgroundColor: 'color-mix(in srgb, var(--mod-plca) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--mod-plca) 30%, transparent)',
            color: 'var(--text-primary)',
          }}>
            <DSMScenariosChip
              selectedIds={selectedDsmScenarioIds}
              onChange={handlePickDsmScenarios}
              accentColor="var(--mod-plca)"
              disabled={isRunning}
            />
          </div>
        )}

        {/* Top row: Impact Method · Scope · Years */}
        <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
            <label style={labelS}>Impact Method</label>
            <MethodFamilySelect selection={methodSelection} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 280px' }}>
            <label style={labelS}>Scope</label>
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
                  disabled={isRunning}
                  title={s.tip}
                  style={{
                    padding: '0 12px', height: 36, borderRadius: 'var(--radius-md)', cursor: isRunning ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (scope === s.value ? 'var(--mod-plca)' : 'var(--border-default)'),
                    backgroundColor: scope === s.value ? 'color-mix(in srgb, var(--mod-plca) 12%, transparent)' : 'var(--bg-elevated)',
                    color: scope === s.value ? 'var(--mod-plca)' : 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', fontWeight: scope === s.value ? 600 : 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelS}>Years</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={yearStart ?? ''} onChange={(e) => setYearStart(Number(e.target.value))} disabled={isRunning} style={selS}>
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>to</span>
              <select value={yearEnd ?? ''} onChange={(e) => setYearEnd(Number(e.target.value))} disabled={isRunning} style={selS}>
                {availableYears.filter((y) => yearStart == null || y >= yearStart).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          {/* Temporal background is always interpolate (smooth piecewise-linear
              blend of the two bracketing premise anchors). The block path stays
              API-reachable for reproducibility but is no longer a user choice. */}
        </div>

        {/* Second row: LCI Scenarios (multi-select chips, Projected LCI only).
            Hidden in Paired mode — the pair editor below replaces it. */}
        {!isPairedMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 'var(--space-4)' }}>
          <label style={labelS}>
            LCI Scenarios
            <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-tertiary)' }}>
              · {scenarioKeys.length} selected
            </span>
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 36 }}>
            {/* Left-anchored Pick (UI convention: multi-select Pick/Add stays
                on the left so layout doesn't drift as selections grow/shrink).
                Selected chips render to the right in selection order. */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                data-testid="lci-scenarios-pick"
                onClick={() => setScenarioPickerOpen((v) => !v)}
                disabled={isRunning || scenarios.length === 0}
                title={scenarios.length === 0 ? 'No LCI scenarios available' : 'Pick LCI scenarios'}
                style={{
                  height: 28,
                  padding: '0 10px',
                  border: '1px dashed var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  cursor: isRunning || scenarios.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 'var(--text-xs)',
                }}
              >
                Pick ▾
              </button>
              {scenarioPickerOpen && scenarios.length > 0 && (
                <div
                  role="listbox"
                  style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 10,
                    minWidth: 360, maxWidth: 560, maxHeight: 240, overflowY: 'auto',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-md)',
                    padding: 4,
                  }}
                >
                  {scenarios.map((s) => {
                    const checked = scenarioKeys.includes(s.key)
                    const isLastSelected = checked && scenarioKeys.length <= 1
                    return (
                      <button
                        key={s.key}
                        type="button"
                        role="option"
                        aria-selected={checked}
                        onClick={() => toggleScenarioKey(s.key)}
                        disabled={isLastSelected}
                        title={isLastSelected ? 'At least one scenario must remain selected' : undefined}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          width: '100%', textAlign: 'left',
                          padding: '6px 10px',
                          border: 'none', background: 'transparent',
                          color: isLastSelected ? 'var(--text-tertiary)' : 'var(--text-primary)',
                          fontSize: 'var(--text-xs)',
                          fontFamily: 'var(--font-mono)',
                          cursor: isLastSelected ? 'not-allowed' : 'pointer',
                          borderRadius: 'var(--radius-sm)',
                        }}
                        onMouseEnter={(e) => { if (!isLastSelected) e.currentTarget.style.backgroundColor = 'var(--bg-elevated)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 14, height: 14,
                            border: `1px solid ${checked ? 'var(--mod-plca)' : 'var(--border-default)'}`,
                            borderRadius: 3,
                            backgroundColor: checked ? 'var(--mod-plca)' : 'transparent',
                            color: checked ? 'var(--bg-surface)' : 'transparent',
                            fontSize: 10, lineHeight: 1, fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {checked ? '✓' : ''}
                        </span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.base_db} · {s.iam.toUpperCase()} / {s.ssp} ({s.years.length} year{s.years.length === 1 ? '' : 's'})
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {selectedScenarioObjs.map((s) => (
              <span
                key={s.key}
                title={`${s.base_db} · ${s.iam.toUpperCase()} / ${s.ssp} · ${s.years.length} year${s.years.length === 1 ? '' : 's'} · uncheck in the dropdown to deselect`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px',
                  border: '1px solid var(--mod-plca)',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'color-mix(in srgb, var(--mod-plca) 12%, transparent)',
                  color: 'var(--mod-plca)',
                  fontSize: 'var(--text-xs)', fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {s.iam.toUpperCase()}/{s.ssp}
              </span>
            ))}
          </div>
          {selectedScenario && scenarioKeys.length === 1 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              Years: {selectedScenario.years.join(', ')}
            </div>
          )}
        </div>
        )}

        {/* Middle: indicator selection (collapsible) */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div
            onClick={() => setIndicatorExpanded((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', marginBottom: indicatorExpanded ? 8 : 0 }}
          >
            <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
              {indicatorExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <label style={{ ...labelS, margin: 0, cursor: 'pointer' }}>Indicator selection</label>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              · {methodSelection.count} of {methodSelection.totalIndicators} selected
            </span>
          </div>
          {indicatorExpanded && (
            <IndicatorChecklist selection={methodSelection} accent="var(--mod-plca)" maxHeight={320} />
          )}
        </div>

        {/* Change 4: preflight stacks full-width above; the Sensitivity-cases
            box + Calculate sit in a LEFT-aligned row (aligned with the LCI
            scenarios column above) instead of right-floating. Layout only. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {preflightIssues.length > 0 && (
            <div style={{
              padding: '8px 10px', backgroundColor: 'var(--warning-muted, color-mix(in srgb, var(--warning) 10%, transparent))',
              border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
              borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--warning)',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                <AlertCircle size={13} /> Cannot calculate yet — fix the following:
              </div>
              <ul style={{ margin: 0, paddingLeft: 22 }}>
                {preflightIssues.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, minWidth: 200,
          }}>
            <span
              data-testid="projected-sensitivity-cases-label"
              style={{
                fontSize: 'var(--text-xs)', fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              {/* Canonical label "Sensitivity cases" (was "Scenarios") — never
                  "Scenarios", which collides with the LCI Scenarios control. */}
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
                const disabled = isBase || isRunning || isPairedMode
                const title = isPairedMode
                  ? 'Parameter sensitivity is disabled in paired mode. Switch to Independent mode to vary parameters.'
                  : isBase ? 'Base is always included' : `Toggle "${s}"`
                return (
                  <label
                    key={s}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 'var(--text-xs)',
                      color: isBase ? 'var(--text-secondary)' : 'var(--text-primary)',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: isPairedMode ? 0.5 : isBase ? 0.85 : 1,
                    }}
                    title={title}
                  >
                    <input
                      type="checkbox"
                      checked={checked && !isPairedMode}
                      disabled={disabled}
                      onChange={(e) => toggleSelectedScenario(s, e.target.checked)}
                    />
                    <span style={{ fontFamily: isBase ? 'inherit' : 'var(--font-mono)' }}>{s}</span>
                  </label>
                )
              })}
            </div>
            {isPairedMode && (
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                Disabled in paired mode
              </span>
            )}
          </div>
          <StopButton taskId={stopTaskId} state={stopState} onClick={requestStop} style={{ height: 36 }} />
          <Button variant="primary" onClick={handleRun} disabled={isRunning} style={{ backgroundColor: 'var(--mod-plca)', height: 36, flexShrink: 0, opacity: canRun ? 1 : 0.6 }}>
            {isRunning ? (
              <><Loader2 size={14} style={{ animation: 'impact-spin 1s linear infinite' }} /> Calculating…</>
            ) : (
              <>
                <Calculator size={14} />
                {isPairedMode && pairs.length > 0
                  ? ` Calculate (${pairs.length} pair${pairs.length === 1 ? '' : 's'} × ${methods.length} method${methods.length === 1 ? '' : 's'})`
                  : effectiveSelected.length > 1
                    ? ` Calculate (${effectiveSelected.length} scenarios × ${methods.length} method${methods.length === 1 ? '' : 's'})`
                    : methods.length > 1
                      ? ` Calculate (${methods.length} methods)`
                      : ' Calculate'}
              </>
            )}
          </Button>
          </div>
        </div>

        <ComputeProgress
          active={isRunning}
          label={
            scenarioProgress ? (
              <>
                Scenario {Math.min(scenarioProgress.done + 1, scenarioProgress.total)}/{scenarioProgress.total}:{' '}
                <span style={{ color: 'var(--mod-plca)', fontWeight: 600 }}>{scenarioProgress.active.scenario}</span>
                {' · '}{scenarioProgress.active.job.stage || 'running…'}
              </>
            ) : (
              <>{projectedJob?.stage || 'running…'}{methods.length > 0 ? ` × ${methods.length} indicator${methods.length === 1 ? '' : 's'}` : ''}</>
            )
          }
          bar="determinate"
          pct={
            scenarioProgress
              ? (scenarioProgress.done + scenarioProgress.active.job.pct) / scenarioProgress.total
              : (projectedJob?.pct ?? 0)
          }
          statusColor="var(--mod-plca)"
          data-testid="projected-impact-progress"
          style={{ marginTop: 'var(--space-3)' }}
        />
        {/* `impact-spin` keyframe is used by this panel's button/status spinners;
            keep it defined unconditionally now the running banner is gone. */}
        <style>{`@keyframes impact-spin { to { transform: rotate(360deg) } }`}</style>

        {(projectedJob?.error || storeError) && (
          <div style={{ marginTop: 'var(--space-3)', padding: '8px 10px', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
            {projectedJob?.error || storeError}
          </div>
        )}
      </CollapsibleCard>

      {projectedResult && projectedResult.meta.warnings && projectedResult.meta.warnings.length > 0 && (
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
            {projectedResult.meta.warnings.map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
        </div>
      )}

      {/* Multi-LCI summary card: per-scenario headline list (total + peak per
          scenario at a glance). The time-series chart below renders all
          scenarios in dual-view (Total / By cohort). */}
      {projectedMultiResult && projectedMultiResult.scenarios.length > 1 && (
        <div style={{
          ...card,
          padding: 'var(--space-3) var(--space-5)',
          backgroundColor: 'color-mix(in srgb, var(--mod-plca) 6%, var(--bg-surface))',
          borderColor: 'color-mix(in srgb, var(--mod-plca) 40%, var(--border-subtle))',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            fontSize: 'var(--text-xs)', fontWeight: 600,
            color: 'var(--mod-plca)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
          }}>
            <Layers size={12} />
            Multi-LCI · {projectedMultiResult.scenarios.length} scenarios
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 8,
          }}>
            {projectedMultiResult.scenarios.map((s, i) => {
              const headlineRes = s.result.results[selectedResultIdx] ?? s.result.results[0]
              if (!headlineRes) return null
              return (
                <div key={i} style={{
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                }}>
                  <div style={{
                    fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)', marginBottom: 4,
                  }}>
                    {s.scenario.iam.toUpperCase()}/{s.scenario.ssp}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{
                      fontSize: 'var(--text-lg)', fontWeight: 700,
                      fontFamily: 'var(--font-mono)', color: 'var(--mod-plca)',
                    }}>
                      {summaryFormat.format(headlineRes.summary.total_impact)}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {headlineRes.unit}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2,
                  }}>
                    Peak {headlineRes.summary.peak_year}: {summaryFormat.format(headlineRes.summary.peak_impact)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Scenario tab bar — paired DSM × LCI (Patch 2F.2). Sits above the
          multi-DSM bar (mutually exclusive — paired runs clear the multi-DSM
          slot at fan-out time). Pair short label for compactness. */}
      {pairedScenarioOrder.length > 1 && (
        <div data-testid="paired-tab-bar" style={{
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
            <Link2 size={11} style={{ verticalAlign: '-1px' }} /> Pair
          </span>
          {pairedScenarioOrder.map((key) => {
            const r = pairedScenarioRuns[key]
            if (!r) return null
            const active = activePairedScenario === key
            const status = r.job.error ? 'error' : r.job.done ? (r.result ? 'ready' : 'empty') : 'running'
            const label = pairedShortLabel(r.dsmScenarioName, r.lciScenario)
            return (
              <button
                key={key}
                onClick={() => selectPairedScenario(key)}
                title={r.job.error ?? `${r.job.stage} · ${Math.round(r.job.pct * 100)}%`}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  border: '1px solid ' + (active ? 'var(--mod-plca)' : 'var(--border-default)'),
                  backgroundColor: active
                    ? 'color-mix(in srgb, var(--mod-plca) 12%, transparent)'
                    : 'var(--bg-elevated)',
                  color: active ? 'var(--mod-plca)' : 'var(--text-primary)',
                  fontSize: 'var(--text-xs)', fontWeight: active ? 600 : 500,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {label}
                {status === 'running' && <Loader2 size={10} style={{ animation: 'impact-spin 1s linear infinite' }} />}
                {status === 'error' && <AlertCircle size={10} color="var(--danger)" />}
                {status === 'ready' && <span style={{ color: 'var(--success)' }}>✓</span>}
              </button>
            )
          })}
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
                {status === 'running' && <Loader2 size={10} style={{ animation: 'impact-spin 1s linear infinite' }} />}
                {status === 'error' && <AlertCircle size={10} color="var(--danger)" />}
                {status === 'ready' && <span style={{ color: 'var(--success)' }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Scenario tab bar (shown after a multi-scenario run) */}
      {projectedScenarioOrder.length > 1 && (
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
          {projectedScenarioOrder.map((s) => {
            const r = projectedScenarioRuns[s]
            if (!r) return null
            const active = activeProjectedScenario === s
            const status = r.job.error ? 'error' : r.job.done ? (r.result ? 'ready' : 'empty') : 'running'
            return (
              <button
                key={s}
                onClick={() => selectProjectedScenario(s)}
                title={r.job.error ?? `${r.job.stage} · ${Math.round(r.job.pct * 100)}%`}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  border: '1px solid ' + (active ? 'var(--mod-plca)' : 'var(--border-default)'),
                  backgroundColor: active
                    ? 'color-mix(in srgb, var(--mod-plca) 12%, transparent)'
                    : 'var(--bg-elevated)',
                  color: active ? 'var(--mod-plca)' : 'var(--text-primary)',
                  fontSize: 'var(--text-xs)', fontWeight: active ? 600 : 500,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {s}
                {status === 'running' && <Loader2 size={10} style={{ animation: 'impact-spin 1s linear infinite' }} />}
                {status === 'error' && <AlertCircle size={10} color="var(--danger)" />}
                {status === 'ready' && <span style={{ color: 'var(--success)' }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Results */}
      {projectedResult && selectedResult && (
        <CollapsibleCard
          expanded={resultsExpanded}
          onToggle={() => setResultsExpanded((v) => !v)}
          title="Results"
          summary={!resultsExpanded ? (
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {projectedResult.elapsed_seconds != null && (
                <>Calculated in {Math.floor(projectedResult.elapsed_seconds / 60) > 0 ? `${Math.floor(projectedResult.elapsed_seconds / 60)}m ` : ''}{Math.round(projectedResult.elapsed_seconds % 60)}s · </>
              )}
              {projectedResult.results.length} indicator{projectedResult.results.length === 1 ? '' : 's'}
              {' · Peak: '}{summaryFormat.format(selectedResult.summary.peak_impact)} {selectedResult.unit} ({selectedResult.summary.peak_year})
              {' · LCI: '}{
                projectedMultiResult && projectedMultiResult.scenarios.length > 1
                  ? `${projectedMultiResult.scenarios.length} scenarios`
                  : (projectedResult.meta.scenario
                    ? `${projectedResult.meta.scenario.iam.toUpperCase()}/${projectedResult.meta.scenario.ssp}`
                    : '—')
              }{' · DSM: '}{dsmScenarioLabel}{' · Params: '}{paramScenarioLabel}
            </span>
          ) : undefined}
        >
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
          {/* Vertical indicator sidebar */}
          {projectedResult.results.length > 1 && (
            <div style={{ width: 220, minWidth: 220, flexShrink: 0, alignSelf: 'flex-start', position: 'sticky', top: 0 }}>
              <div style={card}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 'var(--space-3)' }}>
                  Indicators
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 600, overflowY: 'auto' }}>
                  {projectedResult.results.map((r, i) => {
                    const active = i === selectedResultIdx
                    const label = r.method[r.method.length - 1] || r.method_label || `Method ${i + 1}`
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedResultIdx(i)}
                        title={r.method.join(' › ')}
                        style={{
                          width: '100%', textAlign: 'left', padding: '8px 10px',
                          background: active ? 'color-mix(in srgb, var(--mod-plca) 10%, transparent)' : 'transparent',
                          border: 'none', borderLeft: active ? '3px solid var(--mod-plca)' : '3px solid transparent',
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
            backgroundColor: 'color-mix(in srgb, var(--mod-plca) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--mod-plca) 30%, transparent)',
            color: 'var(--text-primary)',
          }}>
            <ChipCoord
              label="LCI"
              value={
                projectedMultiResult && projectedMultiResult.scenarios.length > 1
                  ? `${projectedMultiResult.scenarios.length} scenarios`
                  : (projectedResult.meta.scenario
                    ? `${projectedResult.meta.scenario.iam.toUpperCase()}/${projectedResult.meta.scenario.ssp}`
                    : '—')
              }
              accent="var(--mod-plca)"
            />
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <ChipCoord label="DSM scenario" value={dsmScenarioLabel} accent="var(--mod-plca)" />
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <ChipCoord label="Sensitivity case" value={paramScenarioLabel} />
          </div>
          {/* Year→Database mapping — default-collapsed CollapsibleCard (Patch
              5AE): a long per-year list, so it's tucked away by default with an
              informative collapsed summary (year range · count). */}
          {(() => {
            const yearKeys = Object.keys(projectedResult.meta.year_to_database)
            if (yearKeys.length === 0) return null
            const years = yearKeys.map(Number).sort((a, b) => a - b)
            const yearRange = years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : ''
            return (
              <CollapsibleCard
                title="Year → Database"
                expanded={yearDbExpanded}
                onToggle={() => setYearDbExpanded((v) => !v)}
                summary={!yearDbExpanded ? (
                  <span data-testid="year-db-summary" style={{ fontFamily: 'var(--font-mono)' }}>
                    {yearRange} · {years.length} year{years.length === 1 ? '' : 's'}
                  </span>
                ) : undefined}
              >
                <div data-testid="year-db-body" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(projectedResult.meta.year_to_database)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([y, db]) => (
                      <div key={y} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                        <span style={{ color: 'var(--mod-plca)', fontWeight: 600 }}>{y}</span>
                        <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{db}</span>
                      </div>
                    ))}
                </div>
              </CollapsibleCard>
            )
          })()}

          {/* Summary */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                  Cumulative impact ({selectedResult.scope}, {selectedResult.method.join(' › ')})
                </div>
                {selectedResult.stages_included && selectedResult.stages_included.length > 0 && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Stages: {selectedResult.stages_included.join(', ')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {projectedResult.elapsed_seconds != null && (
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', padding: '2px 8px', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                    Calculated in {Math.floor(projectedResult.elapsed_seconds / 60) > 0 ? `${Math.floor(projectedResult.elapsed_seconds / 60)}m ` : ''}{Math.round(projectedResult.elapsed_seconds % 60)}s
                  </span>
                )}
                <Button variant="secondary" size="sm" onClick={handleExport} disabled={isExporting}>
                  {isExporting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
                  Export
                </Button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--mod-plca)' }}>
                {summaryFormat.format(selectedResult.summary.total_impact)}
              </span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{selectedResult.unit}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 16 }}>
                Peak in {selectedResult.summary.peak_year}: {summaryFormat.format(selectedResult.summary.peak_impact)} {selectedResult.unit}
              </span>
            </div>
          </div>

          {/* Time-series chart. Single-scenario: existing cohort-stacked area.
              Multi-scenario (N>1): dual-view (Total / By cohort) component
              with shared formatter and detailYear. */}
          <div style={card}>
            {multiPairedChartScenarios ? (
              <MultiScenarioImpactChart
                scenarios={multiPairedChartScenarios}
                axisLabel="paired scenarios"
                selectedResultIdx={selectedResultIdx}
                detailYear={detailYear}
                format={summaryFormat}
                cohortKeys={cohortStackKeys}
                cohortColorMap={cohortColorMap}
                filenameBase={`projected_impact_multi_paired_${selectedResult.method.join('_')}`}
              />
            ) : multiDsmChartScenarios ? (
              <MultiScenarioImpactChart
                scenarios={multiDsmChartScenarios}
                axisLabel="DSM scenarios"
                selectedResultIdx={selectedResultIdx}
                detailYear={detailYear}
                format={summaryFormat}
                cohortKeys={cohortStackKeys}
                cohortColorMap={cohortColorMap}
                filenameBase={`projected_impact_multi_dsm_${selectedResult.method.join('_')}`}
              />
            ) : projectedMultiResult && projectedMultiResult.scenarios.length > 1 ? (
              <MultiScenarioImpactChart
                scenarios={projectedMultiResult.scenarios.map((s) => ({
                  label: `${s.scenario.iam.toUpperCase()}/${s.scenario.ssp}`,
                  result: s.result,
                }))}
                axisLabel="LCI scenarios"
                selectedResultIdx={selectedResultIdx}
                detailYear={detailYear}
                format={summaryFormat}
                cohortKeys={cohortStackKeys}
                cohortColorMap={cohortColorMap}
                filenameBase={`projected_impact_${selectedResult.method.join('_')}`}
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
                      chartRef={projAreaRef}
                      legendRef={projLegendRef}
                      filename={`projected_impact_by_cohort_${selectedResult.method.join('_')}`}
                    />
                  </div>
                </div>
                <ChartExportContainer ref={projAreaRef} style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={areaData} margin={{ top: 8, right: 16, bottom: 8, left: 56 }}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <YAxis domain={tightStackedDomain} stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={(v) => summaryFormat.format(v as number)}
                        label={{ value: selectedResult.unit, angle: -90, position: 'left', offset: 15, style: { fill: 'var(--text-tertiary)', fontSize: 11, textAnchor: 'middle' } }}
                      />
                      <Tooltip
                        content={<StackedTotalTooltip unit={selectedResult.unit} formatValue={summaryFormat.format} />}
                      />
                      {/*
                        Patch 4N — color via `dsmColors.colorForCohort`
                        instead of `colorFor(cohortColorMap, k, i)`
                        so the bands match what the DSM Stock
                        Composition chart shows for the same Stack-by.
                      */}
                      {cohortStackKeys.map((k, i) => (
                        <Area key={k} type="monotone" dataKey={k} stackId="1"
                          stroke={dsmColors.colorForCohort(k, i)}
                          fill={dsmColors.colorForCohort(k, i)}
                          fillOpacity={0.7} isAnimationActive={false}
                        />
                      ))}
                      <ReferenceLine x={detailYear ?? undefined} stroke="var(--mod-plca)" strokeDasharray="3 3" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartExportContainer>
                {/*
                  Patch 4N — sibling legend for the by-cohort chart.
                  Labels project to DSM-Stack-by-dim values when a
                  Stack-by is set (≤10 entries typically, matches the
                  DSM Stock Composition legend exactly); falls back to
                  full cohort keys when no DSM grouping is active
                  (the user gets per-cohort distinguishability with
                  one legend entry per band — wraps to multiple rows).
                */}
                {cohortStackKeys.length > 0 && (() => {
                  const labels = dsmColors.projectLegendLabels(cohortStackKeys)
                  if (labels.length === 0) return null
                  return (
                    <div
                      ref={projLegendRef}
                      data-testid="projected-by-cohort-legend"
                      style={{
                        display: 'flex', flexWrap: 'wrap', gap: 12,
                        paddingTop: 8,
                        fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                      }}
                    >
                      {labels.map((label, idx) => {
                        // Pick a representative cohort key for color
                        // lookup. When grouping by Stack-by-dim, all
                        // cohorts mapping to `label` share a color —
                        // use the first match. When no grouping,
                        // `label` IS the cohort key.
                        const repCohort = stackByDimension
                          ? cohortStackKeys.find((ck) =>
                              dsmColors.colorForCohort(ck, 0)
                              === colorFor(dsmColors.colorMap, label),
                            ) ?? label
                          : label
                        const swatchColor = stackByDimension
                          ? colorFor(dsmColors.colorMap, label)
                          : dsmColors.colorForCohort(repCohort, idx)
                        return (
                          <span
                            key={label}
                            data-testid={`projected-by-cohort-legend-${label}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                          >
                            <span style={{
                              display: 'inline-block', width: 10, height: 10,
                              borderRadius: 2, backgroundColor: swatchColor,
                            }} />
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{label}</span>
                          </span>
                        )
                      })}
                    </div>
                  )
                })()}
              </>
            )}
          </div>

          {/* Year detail slider — drives ReferenceLine, cohort table, material chart live on every drag step */}
          {selectedResult.years.length > 0 && detailYear != null && (
            <YearSlider
              years={selectedResult.years.map((yr) => yr.year)}
              value={detailYear}
              onChange={setDetailYear}
              label="Year detail"
              accentColor="var(--mod-plca)"
              ariaLabel="Year detail"
              rightSlot={yearBreakdown ? (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  Total: {detailFormat.format(yearBreakdown.yr.total_impact)} {selectedResult.unit}
                </span>
              ) : undefined}
            />
          )}

          {/* Year breakdown + material bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 'var(--space-4)' }}>
            {yearBreakdown && (
              <div style={card}>
                <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                  Impact by cohort in {yearBreakdown.yr.year}
                </h4>
                <div style={{ overflow: 'auto', maxHeight: 320 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thS}>Cohort</th>
                        <th style={{ ...thS, textAlign: 'right' }}>Count</th>
                        <th style={{ ...thS, textAlign: 'right' }}>Per unit</th>
                        <th style={{ ...thS, textAlign: 'right' }}>Total ({selectedResult.unit})</th>
                        <th style={{ ...thS, textAlign: 'right' }}>%</th>
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
                          <td style={tdR}>{fmtCount(row.count)}</td>
                          <td style={tdR}>{detailFormat.format(row.perUnit)}</td>
                          <td style={{ ...tdR, color: 'var(--mod-plca)', fontWeight: 600 }}>{detailFormat.format(row.total)}</td>
                          <td style={{ ...tdR, color: 'var(--text-tertiary)' }}>{row.pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Material contribution {detailYear != null ? `(${detailYear})` : ''}
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <NumberFormatControl settings={detailFormat.settings} onChange={detailFormat.setSettings} />
                  <ChartExportButton
                    chartRef={projMaterialBarsRef}
                    filename={`projected_material_contribution_${detailYear ?? ''}_${selectedResult.method.join('_')}`}
                  />
                </div>
              </div>
              <ChartExportContainer ref={projMaterialBarsRef} style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={materialBars} layout="vertical" margin={{ top: 4, right: 12, bottom: 20, left: 12 }}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis type="number" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickFormatter={(v) => detailFormat.format(v as number)}
                      label={{ value: selectedResult.unit, position: 'insideBottom', offset: -6, style: { fill: 'var(--text-tertiary)', fontSize: 11 } }}
                    />
                    <YAxis type="category" dataKey="name" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={120} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                      formatter={(v) => (typeof v === 'number' ? detailFormat.format(v) : String(v))}
                    />
                    <Bar dataKey="impact" fill="var(--mod-plca)" fillOpacity={0.85} isAnimationActive={false} />
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
// activeTab/libraryOpen flip. Pairs with the visibility-toggle pattern in
// pages/ImpactAssessment.tsx.
export const ProjectedImpactPanel = memo(ProjectedImpactPanelImpl)

const labelS: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6,
}
const selS: React.CSSProperties = {
  height: 36, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none',
}
const thS: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)', backgroundColor: 'var(--bg-elevated)',
}
const tdR: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
}

interface LciScenarioOption {
  key: string
  base_db: string
  iam: string
  ssp: string
  years: number[]
}

interface PairListEditorProps {
  pairs: PairedDSMLCIRef[]
  onChange: (next: PairedDSMLCIRef[]) => void
  dsmScenarios: { id: string; name: string; is_base?: boolean }[]
  lciScenarios: LciScenarioOption[]
  disabled?: boolean
  duplicateKeys: Set<string>
}

export function PairListEditor({
  pairs, onChange, dsmScenarios, lciScenarios, disabled, duplicateKeys,
}: PairListEditorProps) {
  const updateRow = (i: number, next: Partial<PairedDSMLCIRef>) => {
    const out = pairs.slice()
    out[i] = { ...out[i], ...next, lci_scenario: { ...out[i].lci_scenario, ...(next.lci_scenario ?? {}) } }
    onChange(out)
  }
  const removeRow = (i: number) => {
    onChange(pairs.filter((_, idx) => idx !== i))
  }
  const addRow = () => {
    onChange([
      ...pairs,
      {
        dsm_scenario_id: dsmScenarios[0]?.id ?? '',
        lci_scenario: lciScenarios[0]
          ? { base_db: lciScenarios[0].base_db, iam: lciScenarios[0].iam, ssp: lciScenarios[0].ssp }
          : { base_db: '', iam: '', ssp: '' },
      },
    ])
  }

  return (
    <div data-testid="pair-list-editor" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 'var(--space-4)' }}>
      <label style={labelS}>
        Paired DSM × LCI scenarios
        <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-tertiary)' }}>
          · {pairs.length} pair{pairs.length === 1 ? '' : 's'}
        </span>
      </label>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 4 }}>
        Each row binds one DSM scenario to one prospective LCI database. Pairs are evaluated 1:1 — no Cartesian product.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pairs.map((p, i) => {
          const k = p.dsm_scenario_id && p.lci_scenario.base_db ? pairKey(p) : ''
          const isDup = !!k && duplicateKeys.has(k)
          return (
            <div
              key={i}
              data-testid={`pair-row-${i}`}
              style={{
                display: 'flex', gap: 6, alignItems: 'center',
                padding: '6px 8px',
                backgroundColor: isDup
                  ? 'color-mix(in srgb, var(--danger) 8%, var(--bg-elevated))'
                  : 'var(--bg-elevated)',
                border: '1px solid ' + (isDup ? 'var(--danger)' : 'var(--border-default)'),
                borderRadius: 'var(--radius-md)',
              }}
            >
              <select
                aria-label={`DSM scenario for pair ${i + 1}`}
                value={p.dsm_scenario_id}
                disabled={disabled}
                onChange={(e) => updateRow(i, { dsm_scenario_id: e.target.value })}
                style={{ ...selS, flex: 1, minWidth: 140 }}
              >
                <option value="">— pick DSM scenario —</option>
                {dsmScenarios.map((d) => (
                  // Patch 4AB — no "(base)" suffix on DSM scenario
                  // displays. The is_base flag stays on the data
                  // model but isn't visually annotated; consistency
                  // across all DSM scenario rows wins over flagging
                  // the canonical reference. The Sensitivity Cases
                  // checklist's "Base" label is a different concept
                  // (parameter set, not DSM scenario) and stays.
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>×</span>
              <select
                aria-label={`LCI scenario for pair ${i + 1}`}
                value={p.lci_scenario.base_db ? `${p.lci_scenario.base_db}|${p.lci_scenario.iam}|${p.lci_scenario.ssp}` : ''}
                disabled={disabled}
                onChange={(e) => {
                  const parts = e.target.value.split('|')
                  if (parts.length === 3) {
                    updateRow(i, { lci_scenario: { base_db: parts[0], iam: parts[1], ssp: parts[2] } })
                  } else {
                    updateRow(i, { lci_scenario: { base_db: '', iam: '', ssp: '' } })
                  }
                }}
                style={{ ...selS, flex: 2, minWidth: 200, fontFamily: 'var(--font-mono)' }}
              >
                <option value="">— pick LCI scenario —</option>
                {lciScenarios.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.base_db} · {l.iam.toUpperCase()}/{l.ssp}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={disabled}
                aria-label={`Remove pair ${i + 1}`}
                title="Remove pair"
                style={{
                  height: 32, width: 32,
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
        {duplicateKeys.size > 0 && (
          <div style={{
            padding: '6px 8px',
            fontSize: 'var(--text-xs)',
            color: 'var(--danger)',
            backgroundColor: 'color-mix(in srgb, var(--danger) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
            borderRadius: 'var(--radius-sm)',
          }}>
            {duplicateKeys.size === 1 ? '1 duplicate pair' : `${duplicateKeys.size} duplicate pairs`} — each (DSM × LCI) combination must be unique.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          data-testid="pair-add-row"
          style={{
            padding: '4px 10px', height: 30,
            border: '1px dashed var(--border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-xs)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          <Plus size={12} /> Add pair
        </button>
      </div>
    </div>
  )
}

function ChipCoord({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{
        color: 'var(--text-tertiary)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        fontSize: 10,
      }}>{label}</span>
      <span style={{ fontWeight: 600, color: accent ?? 'var(--text-primary)' }}>{value}</span>
    </span>
  )
}
