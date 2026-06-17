import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Download,
  Edit2,
  Eye,
  GitBranch,
  Link2,
  Plus,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
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
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { CohortMappingDialog } from '../components/dsm/CohortMappingDialog'
import { CSVUploader } from '../components/dsm/CSVUploader'
import { DSMUploadSlot } from '../components/dsm/DSMUploadSlot'
import { SimulationWarningsPanel } from '../components/dsm/SimulationWarningsPanel'
import { StartEndStockCard, yearStockStartEnd } from '../components/dsm/StartEndStockCard'
import { MaterialFlowPanel } from '../components/flows/MaterialFlowPanel'
import { ModeConfigurator } from '../components/dsm/ModeConfigurator'
import { buildFlowLegend, outflowSourceCount } from '../utils/dsmFlowLegend'
import { ChartExportButton } from '../components/charts/ChartExportButton'
import { ChartExportContainer } from '../components/charts/ChartExportContainer'
import { StackedTotalTooltip } from '../components/charts/StackedTotalTooltip'
import { tightStackedDomain } from '../components/charts/yAxisDomain'
import { ScenarioManagerModal } from '../components/dsm/ScenarioManagerModal'
import { SlotDataViewer, type SlotKey } from '../components/dsm/SlotDataViewer'
import { SystemCreator } from '../components/dsm/SystemCreator'
import { EditSystemModal } from '../components/dsm/EditSystemModal'
import { CollapsibleCard } from '../components/ui/CollapsibleCard'
import { ComputeProgress } from '../components/ui/ComputeProgress'
import { YearSlider } from '../components/ui/YearSlider'
import { BASE_SCENARIO, exportDSMCohorts } from '../api/client'
import { multiResultKey, resolveSlot, useDSMStore } from '../stores/dsmStore'
import type { ActiveResultView } from '../stores/dsmStore'
import { useParameterStore } from '../stores/parameterStore'
import { useSubsystemStore } from '../stores/subsystemStore'
import { SubsystemTabs, OVERALL_ID } from '../components/subsystems/SubsystemTabs'
import { DependentSubsystemView } from '../components/subsystems/DependentSubsystemView'
import { colorFor } from '../utils/chartColors'
import { groupKeyForDim, parseCohortKey, useDSMSystemColors } from '../utils/dsmCohortColors'
import type {
  DimensionDef,
  DSMScenario,
  InflowData,
  ModeConfig,
  MultiScenarioSimulationResult,
  OutflowData,
  StockTargetData,
  YearResult,
} from '../api/client'

// Patch 4N — `parseCohortKey` and `groupKeyForDim` lifted into
// `src/utils/dsmCohortColors.ts` so DSM Dashboard and Impact
// Assessment share the same cohort→dim-value extraction. The local
// `COHORT_SEP` is preserved here only to keep `formatCohortKeyShort`
// (used by the cohort table below) self-contained — that function
// renders the full cohort key for display, distinct from
// dim-extraction.

const multiLabel: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600,
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
  minWidth: 120,
}

function multiChip(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 'var(--text-xs)',
    color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: on
      ? 'color-mix(in srgb, var(--mod-dsm) 15%, transparent)'
      : 'transparent',
    border: `1px solid ${on ? 'var(--mod-dsm)' : 'var(--border-subtle)'}`,
  }
}

function formatNumber(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (Math.abs(v) >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return v.toFixed(3)
}

export function DSMDashboard() {
  const {
    systems,
    activeSystem,
    systemState,
    simulationResult,
    multiScenarioResult,
    lastRunScenarioIds,
    lastRunCases,
    activeView,
    scalingRules,
    selectedYear,
    stackByDimension,
    isSimulating,
    error,
    fetchSystems,
    selectSystem,
    removeSystem,
    uploadStock,
    uploadStockAggregate,
    uploadInflows,
    uploadStockTargets,
    uploadOutflows,
    simulate,
    simulateCross,
    fetchScalingRules,
    activateScenario,
    revertSlotToBase,
    setActiveView,
    exportResults,
    importSimulation,
    importSystem,
    setSelectedYear,
    setStackByDimension,
    downloadTemplate,
  } = useDSMStore()

  const parameterTable = useParameterStore((s) => s.table)
  const allScenarios = useMemo<string[]>(
    () => [BASE_SCENARIO, ...(parameterTable?.scenarios ?? [])],
    [parameterTable],
  )

  const activeSubsystemId = useSubsystemStore((s) => s.activeSubsystemId)

  const [activeTab, setActiveTab] = useState<'dynamics' | 'materials'>('dynamics')
  const [showCreator, setShowCreator] = useState(false)
  const [showModes, setShowModes] = useState(false)
  const [showCohortMapping, setShowCohortMapping] = useState(false)
  const [showScenarios, setShowScenarios] = useState(false)
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([])
  const [selectedCases, setSelectedCases] = useState<string[]>([BASE_SCENARIO])
  const [expandTargets, setExpandTargets] = useState(false)
  const [expandOutflows, setExpandOutflows] = useState(false)
  const [useAggregate, setUseAggregate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [systemListOpen, setSystemListOpen] = useState(false)
  const [expandStock, setExpandStock] = useState(false)
  const [expandInflows, setExpandInflows] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const [viewSlotKey, setViewSlotKey] = useState<SlotKey | null>(null)
  const importSimInputRef = useRef<HTMLInputElement>(null)
  const importSysInputRef = useRef<HTMLInputElement>(null)
  const stockChartRef = useRef<HTMLDivElement>(null)
  const ageChartRef = useRef<HTMLDivElement>(null)
  const outflowChartRef = useRef<HTMLDivElement>(null)
  // Patch 4J — sibling legend refs. Stock composition and Age
  // distribution share the same color map (stackKeys × colorFor) so
  // they could share a single legend element in principle, but the
  // legends live in separate cards and the export-affordance API takes
  // one ref per chart — keep them separate. Outflow split has its own
  // 1–3 fixed colors (natural / forced / uploaded) with no shared map.
  const stockLegendRef = useRef<HTMLDivElement>(null)
  const ageLegendRef = useRef<HTMLDivElement>(null)
  const outflowLegendRef = useRef<HTMLDivElement>(null)

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportResults()
    } catch (e) {
      console.error(e)
    } finally {
      setExporting(false)
    }
  }

  const handleImportSimulation = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const res = await importSimulation(file)
      const msg = `Imported ${res.years_imported} years, ${res.cohorts_found} cohorts.`
      alert(res.warnings.length ? `${msg}\n\nWarnings:\n${res.warnings.join('\n')}` : msg)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleImportSystem = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      await importSystem(file)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    fetchSystems()
  }, [fetchSystems])

  // Refresh scaling rules whenever the active system changes.
  useEffect(() => {
    if (activeSystem?.id) fetchScalingRules().catch(() => undefined)
  }, [activeSystem?.id, fetchScalingRules])

  // Drop any selected sensitivity cases that no longer exist in the table.
  useEffect(() => {
    setSelectedCases((prev) => {
      const filtered = prev.filter((s) => allScenarios.includes(s))
      if (!filtered.includes(BASE_SCENARIO)) filtered.unshift(BASE_SCENARIO)
      return filtered.length === prev.length &&
        filtered.every((s, i) => s === prev[i])
        ? prev
        : filtered
    })
  }, [allScenarios])

  const dsmScenarios = systemState?.scenarios ?? []
  const activeScenarioId = systemState?.active_scenario_id ?? null
  const activeScenario: DSMScenario | null = useMemo(
    () => dsmScenarios.find((s) => s.id === activeScenarioId) ?? dsmScenarios.find((s) => s.is_base) ?? null,
    [dsmScenarios, activeScenarioId],
  )
  const baseScenarioObj: DSMScenario | null = useMemo(
    () => dsmScenarios.find((s) => s.is_base) ?? null,
    [dsmScenarios],
  )

  // Drop any selected DSM scenario ids that no longer exist.
  useEffect(() => {
    setSelectedScenarioIds((prev) => {
      const valid = new Set(dsmScenarios.map((s) => s.id))
      const filtered = prev.filter((id) => valid.has(id))
      // Default-select the active scenario if nothing is picked.
      if (filtered.length === 0 && activeScenarioId && valid.has(activeScenarioId)) {
        return [activeScenarioId]
      }
      return filtered.length === prev.length ? prev : filtered
    })
  }, [dsmScenarios, activeScenarioId])

  // Re-expand results whenever a new simulation finishes.
  useEffect(() => {
    if (simulationResult) setResultsCollapsed(false)
  }, [simulationResult])

  const toggleCase = (name: string, on: boolean) => {
    setSelectedCases((prev) => {
      let next = prev.slice()
      if (on && !next.includes(name)) next.push(name)
      if (!on) next = next.filter((s) => s !== name)
      if (!next.includes(BASE_SCENARIO)) next.unshift(BASE_SCENARIO)
      next.sort((a, b) => allScenarios.indexOf(a) - allScenarios.indexOf(b))
      return next
    })
  }

  const toggleScenarioId = (id: string, on: boolean) => {
    setSelectedScenarioIds((prev) => {
      let next = prev.slice()
      if (on && !next.includes(id)) next.push(id)
      if (!on) next = next.filter((s) => s !== id)
      // Preserve declared scenario order.
      next.sort(
        (a, b) => dsmScenarios.findIndex((s) => s.id === a) - dsmScenarios.findIndex((s) => s.id === b),
      )
      return next
    })
  }

  const runSimulation = async () => {
    const chosenScenarios = selectedScenarioIds.length
      ? selectedScenarioIds
      : activeScenarioId
        ? [activeScenarioId]
        : []
    const chosenCases = selectedCases.length ? selectedCases : [BASE_SCENARIO]
    const singleScenario = chosenScenarios.length <= 1
    const singleCase = chosenCases.length === 1 && chosenCases[0] === BASE_SCENARIO
    if (singleScenario && singleCase && scalingRules.length === 0) {
      await simulate()
      return
    }
    await simulateCross(chosenScenarios, chosenCases)
  }

  const handleRevertSlot = async (
    slot: 'initial_stock' | 'inflows' | 'stock_targets' | 'outflows' | 'mode_configs' | 'scaling_rules',
  ) => {
    try {
      await revertSlotToBase(slot)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  const cohortCount = useMemo(() => {
    if (!simulationResult) return 0
    const keys = new Set<string>()
    for (const yr of simulationResult.years) {
      Object.keys(yr.stock).forEach((k) => keys.add(k))
      Object.keys(yr.inflow).forEach((k) => keys.add(k))
    }
    return keys.size
  }, [simulationResult])

  const nonAgeDims = useMemo(
    () => activeSystem?.dimensions.filter((d) => !d.is_age) ?? [],
    [activeSystem],
  )

  const selectedYearResult: YearResult | null = useMemo(() => {
    if (!simulationResult || selectedYear == null) return null
    return simulationResult.years.find((y) => y.year === selectedYear) ?? simulationResult.years[0]
  }, [simulationResult, selectedYear])

  const areaData = useMemo(() => {
    if (!simulationResult || !activeSystem) return []
    return simulationResult.years.map((yr) => {
      const row: Record<string, number | string> = { year: yr.year }
      for (const [ck, count] of Object.entries(yr.stock)) {
        const group = groupKeyForDim(ck, activeSystem.dimensions, stackByDimension)
        row[group] = (Number(row[group] ?? 0)) + count
      }
      return row
    })
  }, [simulationResult, activeSystem, stackByDimension])

  // Patch 4N — both `stackKeys` and `colorMap` come from the shared
  // `useDSMSystemColors` hook so the Impact Assessment by-cohort
  // chart can produce IDENTICAL colors when consuming the same
  // active-system + Stack-by inputs. Behavior here is byte-identical
  // to the prior implementation (same label union → same
  // useChartColors call) — proven by the regression test
  // `tests/dsmSharedColors.test.ts::DSM Stock Composition color stability`.
  // Patch 4AK — pass per-row color overrides so cohort-key stacked
  // charts (when stackByDimension is null) respect user row picks.
  const cohortRowColors = useDSMStore((s) => s.cohortRowColors)
  const { stackKeys, colorMap } = useDSMSystemColors(
    activeSystem ?? null,
    stackByDimension,
    { rowColorOverrides: cohortRowColors },
  )

  const ageData = useMemo(() => {
    if (!selectedYearResult || !activeSystem) return []
    const buckets: Record<number, Record<string, number>> = {}
    for (const [ck, byAge] of Object.entries(selectedYearResult.stock_by_age)) {
      const group = groupKeyForDim(ck, activeSystem.dimensions, stackByDimension)
      for (const [ageStr, count] of Object.entries(byAge)) {
        const age = Number(ageStr)
        buckets[age] ??= {}
        buckets[age][group] = (buckets[age][group] ?? 0) + count
      }
    }
    return Object.entries(buckets)
      .map(([age, vals]) => ({ age: Number(age), ...vals }))
      .sort((a, b) => a.age - b.age)
  }, [selectedYearResult, activeSystem, stackByDimension])

  const cohortRows = useMemo(() => {
    if (!selectedYearResult || !activeSystem) return []
    const cks = new Set([
      ...Object.keys(selectedYearResult.stock),
      ...Object.keys(selectedYearResult.inflow),
      ...Object.keys(selectedYearResult.outflow),
    ])
    return Array.from(cks).map((ck) => {
      const stock = selectedYearResult.stock[ck] ?? 0
      const inflow = selectedYearResult.inflow[ck] ?? 0
      const outflow = selectedYearResult.outflow[ck] ?? 0
      return {
        cohort_key: ck,
        dims: parseCohortKey(ck, activeSystem.dimensions),
        stock,
        inflow,
        outflow,
        net: inflow - outflow,
      }
    }).sort((a, b) => b.stock - a.stock)
  }, [selectedYearResult, activeSystem])

  const summary = useMemo(() => {
    if (!selectedYearResult) return null
    const totalStock = Object.values(selectedYearResult.stock).reduce((a, b) => a + b, 0)
    const totalInflow = Object.values(selectedYearResult.inflow).reduce((a, b) => a + b, 0)
    const totalOutflow = Object.values(selectedYearResult.outflow).reduce((a, b) => a + b, 0)
    return { totalStock, totalInflow, totalOutflow, net: totalInflow - totalOutflow }
  }, [selectedYearResult])

  // Dev-mode invariant check: Σ ageData (stacked bar values) must equal
  // summary.totalStock. Both come from the same backend `stock_by_age` dict,
  // so divergence would indicate an accounting bug.
  useEffect(() => {
    if (!import.meta.env.DEV || !summary || ageData.length === 0) return
    let ageSum = 0
    for (const row of ageData) {
      for (const [k, v] of Object.entries(row)) {
        if (k === 'age') continue
        ageSum += (v as number) ?? 0
      }
    }
    const delta = ageSum - summary.totalStock
    // eslint-disable-next-line no-console
    console.log(
      `[DSM Age Distribution · ${selectedYear}] totalStock=${summary.totalStock.toLocaleString()} ageDistSum=${ageSum.toLocaleString()} Δ=${delta.toFixed(6)}`,
    )
  }, [selectedYear, ageData, summary])

  const outflowBreakdown = useMemo(() => {
    if (!simulationResult) return { rows: [], hasForced: false, hasManual: false, hasNatural: false, hasInflow: false }
    let hasForced = false
    let hasManual = false
    let hasNatural = false
    let hasInflow = false
    const rows = simulationResult.years.map((yr) => {
      const natural = Object.values(yr.natural_outflow ?? {}).reduce((a, b) => a + b, 0)
      const forced = Object.values(yr.forced_retirement ?? {}).reduce((a, b) => a + b, 0)
      const manual = Object.values(yr.manual_outflow ?? {}).reduce((a, b) => a + b, 0)
      // Patch 5AD — per-year total inflow from the SAME DSM result (no compute
      // change), so the flows chart shows inflows alongside outflows.
      const inflow = Object.values(yr.inflow ?? {}).reduce((a, b) => a + b, 0)
      if (forced > 1e-9) hasForced = true
      if (manual > 1e-9) hasManual = true
      if (natural > 1e-9) hasNatural = true
      if (inflow > 1e-9) hasInflow = true
      return { year: yr.year, natural, forced, manual, inflow }
    })
    return { rows, hasForced, hasManual, hasNatural, hasInflow }
  }, [simulationResult])

  // ── Empty state ──
  if (!activeSystem) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)', flexShrink: 0 }}>
          Dynamic Stock Modeller
        </h1>
        <div style={{ flex: 1, minHeight: 0 }}>
          <EmptyState
            systemsExist={systems.length > 0}
            systems={systems}
            onCreate={() => setShowCreator(true)}
            onSelect={selectSystem}
            onRestoreClick={() => importSysInputRef.current?.click()}
            importing={importing}
          />
        </div>
        <input
          ref={importSysInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleImportSystem}
          style={{ display: 'none' }}
        />
        {showCreator && <SystemCreator onClose={() => setShowCreator(false)} />}
      </div>
    )
  }

  const horizonYears = activeSystem.time_horizon
  const yearList = Array.from(
    { length: horizonYears.end_year - horizonYears.start_year + 1 },
    (_, i) => horizonYears.start_year + i,
  )

  const effStock = (resolveSlot(systemState, 'initial_stock') as Record<string, number> | null) ?? {}
  const effInflows = (resolveSlot(systemState, 'inflows') as InflowData[] | null) ?? []
  const effTargets = (resolveSlot(systemState, 'stock_targets') as StockTargetData[] | null) ?? []
  const effOutflows = (resolveSlot(systemState, 'outflows') as OutflowData[] | null) ?? []
  const effModes = (resolveSlot(systemState, 'mode_configs') as ModeConfig[] | null) ?? []
  // Whether the slot is explicitly owned by the active scenario
  // (vs. inherited from Base).
  const slotOwned = (slot: keyof DSMScenario): boolean => {
    if (!activeScenario) return false
    const v = activeScenario[slot]
    return v !== null && v !== undefined
  }
  const stockRowCount = Object.keys(effStock).length
  const inflowYearCount = effInflows.length
  const targetYearCount = effTargets.length
  const outflowYearCount = effOutflows.length
  const stockLoaded = stockRowCount > 0
  const inflowsLoaded = inflowYearCount > 0
  const targetsLoaded = targetYearCount > 0
  const outflowsLoaded = outflowYearCount > 0
  const modeConfigs = effModes
  const globalMode =
    modeConfigs.find((c) => Object.keys(c.dimension_filters).length === 0)?.mode ?? 'survival_inflow'
  const hasManualCohort = modeConfigs.some((c) => c.mode === 'manual')
  const hasStockDrivenCohort = modeConfigs.some((c) => c.mode === 'survival_stock')
  const showOutflowCard = globalMode === 'manual' || hasManualCohort
  const showStockTargetsCard = globalMode === 'survival_stock' || hasStockDrivenCohort
  // Stock spans its own full-width row (system identity); the temporal inputs
  // (inflows + conditionally outflows / stock-targets) form an equal-width
  // parallel row below. N equal columns → the inflows/outflows pair always
  // splits its row evenly regardless of stock upload state.
  const temporalCount = 1 + (showOutflowCard ? 1 : 0) + (showStockTargetsCard ? 1 : 0)
  const temporalCols = Array.from({ length: temporalCount }, () => '1fr').join(' ')
  const simulationWarnings = simulationResult?.summary.warnings ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>
            Dynamic Stock Modeller
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-secondary)' }}>
              {activeSystem.name}
            </span>
            <Badge label="DSM" variant="dsm" />
            <SystemSwitcher
              open={systemListOpen}
              onToggle={() => setSystemListOpen((v) => !v)}
              systems={systems}
              activeId={activeSystem.id ?? ''}
              onSelect={async (id) => { setSystemListOpen(false); await selectSystem(id) }}
              onDelete={async (id) => { if (confirm('Delete this system?')) await removeSystem(id) }}
              onCreateNew={() => setShowCreator(true)}
            />
          </div>
          {activeSystem.description && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>{activeSystem.description}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => setShowEdit(true)}>
            <Edit2 size={14} strokeWidth={1.5} /> Edit
          </Button>
          <Button
            variant="ghost"
            onClick={() => importSimInputRef.current?.click()}
            disabled={importing}
            title="Restore a simulation from a previously exported Excel"
          >
            <Upload size={14} strokeWidth={1.5} /> {importing ? 'Importing…' : 'Import DSM'}
          </Button>
          <input
            ref={importSimInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImportSimulation}
            style={{ display: 'none' }}
          />
          <Button
            variant="secondary"
            onClick={handleExport}
            disabled={!simulationResult || exporting}
            title={simulationResult ? 'Export all results to Excel' : 'Run simulation first'}
          >
            <Download size={14} strokeWidth={1.5} /> {exporting ? 'Exporting…' : 'Export'}
          </Button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Subsystem tab bar — only visible when ≥1 dependent exists. */}
      {activeSystem.id && <SubsystemTabs primarySystemId={activeSystem.id} />}

      {activeSubsystemId === OVERALL_ID ? (
        <MaterialFlowPanel />
      ) : activeSubsystemId !== null ? (
        <DependentSubsystemView
          subsystemId={activeSubsystemId}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      ) : (
      <>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {([
          { key: 'dynamics' as const, label: 'System dynamics' },
          { key: 'materials' as const, label: 'Material flows' },
        ]).map((tab) => {
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 500,
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderBottom: active ? '2px solid var(--mod-dsm)' : '2px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'materials' && activeSystem.id && (
        <MaterialFlowPanel
          scopeSubsystemId={activeSystem.id}
          scopeSubsystemName={activeSystem.name}
        />
      )}

      {activeTab === 'dynamics' && <>
          {/* Simulation configuration box — comes first because Mode controls which upload slots appear. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              padding: '10px 14px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              flexShrink: 0,
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: 'var(--space-3)',
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button variant="ghost" onClick={() => setShowScenarios(true)}>
                  <GitBranch size={14} strokeWidth={1.5} /> Scenarios
                  {dsmScenarios.length > 1 && (
                    <span style={{
                      marginLeft: 6,
                      padding: '1px 6px',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      borderRadius: 999,
                      backgroundColor: 'color-mix(in srgb, var(--mod-dsm) 20%, transparent)',
                      color: 'var(--text-primary)',
                    }}>{dsmScenarios.length}</span>
                  )}
                </Button>
                <Button variant="ghost" onClick={() => setShowModes(true)}>
                  <Settings2 size={14} strokeWidth={1.5} /> Mode
                </Button>
                <Button variant="ghost" onClick={() => setShowCohortMapping(true)}>
                  <Link2 size={14} strokeWidth={1.5} /> Cohort mapping
                </Button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button
                  variant="primary"
                  onClick={runSimulation}
                  disabled={isSimulating}
                  style={{ backgroundColor: 'var(--mod-dsm)' }}
                >
                  <Activity size={14} strokeWidth={1.5} /> {isSimulating ? 'Simulating…' : 'Run simulation'}
                </Button>
              </div>
            </div>
            {/* Patch 5AN — DSM simulation is a single in-process op (sub-3s, no
                pct, not cancellable), so the shared progress card uses
                bar='none' (spinner + elapsed). */}
            <ComputeProgress
              active={isSimulating}
              label="Simulating…"
              bar="none"
              statusColor="var(--mod-dsm)"
              data-testid="dsm-sim-progress"
              style={{ marginTop: 'var(--space-3)' }}
            />

            {/* Three clearly-separated selectors:
                 1. Editing scenario (radio) — which scenario the uploads target
                 2. Sensitivity cases (checkboxes) — LCA parameter cases
                 3. Run on (checkboxes) — scenarios to execute on next simulate */}
            {(dsmScenarios.length > 1 || allScenarios.length > 1) && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                paddingTop: 6,
                borderTop: '1px dashed var(--border-subtle)',
              }}>
                {dsmScenarios.length > 1 && activeScenario && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={multiLabel} title="The scenario that receives uploads and edits on this tab. Only one at a time.">
                      Editing scenario
                    </span>
                    {dsmScenarios.map((scen) => {
                      const on = activeScenario.id === scen.id
                      return (
                        <label key={scen.id} style={multiChip(on)}>
                          <input
                            type="radio"
                            name="editing-scenario"
                            checked={on}
                            onChange={() => { activateScenario(scen.id).catch(() => undefined) }}
                            style={{ accentColor: 'var(--mod-dsm)' }}
                          />
                          {scen.name}
                        </label>
                      )
                    })}
                    <button
                      onClick={() => setShowScenarios(true)}
                      style={{
                        marginLeft: 'auto', background: 'transparent', border: 'none',
                        color: 'var(--mod-dsm)', fontSize: 'var(--text-xs)',
                        cursor: 'pointer', textDecoration: 'underline',
                      }}
                    >
                      Manage…
                    </button>
                  </div>
                )}
                {allScenarios.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={multiLabel} title="Parameter cases active in the LCA parameter table.">
                      Sensitivity cases
                    </span>
                    {allScenarios.map((scen) => {
                      const on = selectedCases.includes(scen)
                      const locked = scen === BASE_SCENARIO
                      return (
                        <label
                          key={scen}
                          style={{ ...multiChip(on), cursor: locked ? 'default' : 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={locked}
                            onChange={(e) => toggleCase(scen, e.target.checked)}
                            style={{ accentColor: 'var(--mod-dsm)' }}
                          />
                          {scen}
                        </label>
                      )
                    })}
                  </div>
                )}
                {dsmScenarios.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={multiLabel} title="Scenarios executed when Run simulation is clicked.">
                      Run on
                    </span>
                    {dsmScenarios.map((scen) => {
                      const on = selectedScenarioIds.includes(scen.id)
                      return (
                        <label key={scen.id} style={multiChip(on)}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => toggleScenarioId(scen.id, e.target.checked)}
                            style={{ accentColor: 'var(--mod-dsm)' }}
                          />
                          {scen.name}
                        </label>
                      )
                    })}
                  </div>
                )}
                {(() => {
                  const n = Math.max(selectedScenarioIds.length, 1)
                  const m = Math.max(selectedCases.length, 1)
                  const k = n * m
                  if (k <= 1) return null
                  return (
                    <div style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-tertiary)',
                      paddingLeft: 2,
                    }}>
                      {n} × {m} = <strong style={{ color: 'var(--text-primary)' }}>{k}</strong> simulation runs
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {/* Editing-scenario context hint — rendered below the config box so
              users always see whether edits hit Base or an inheriting scenario. */}
          {dsmScenarios.length > 1 && activeScenario && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px',
              backgroundColor: 'color-mix(in srgb, var(--mod-dsm) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--mod-dsm) 30%, transparent)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              flexShrink: 0,
            }}>
              <span style={{ color: 'var(--text-tertiary)' }}>
                Editing <strong style={{ color: 'var(--text-primary)' }}>{activeScenario.name}</strong>
                {activeScenario.is_base ? ' — every upload is authoritative for Base.' : ` — unset slots inherit from ${baseScenarioObj?.name ?? 'Base'}.`}
              </span>
            </div>
          )}

          {/* Data setup — slots depend on the Mode selected above. */}
          {(() => {
            const onBase = activeScenario?.is_base ?? true
            const baseName = baseScenarioObj?.name ?? 'Base'
            return (
              <div data-testid="dsm-data-setup" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', flexShrink: 0 }}>
                {/* Stock = system identity — full-width row (banner when uploaded, setup card when empty). */}
                <SlotFrame
                  owned={slotOwned('initial_stock')}
                  onBase={onBase}
                  baseName={baseName}
                  onRevert={slotOwned('initial_stock') ? () => handleRevertSlot('initial_stock') : undefined}
                >
                  {stockLoaded && !expandStock ? (
                    <CompactCard
                      label={`Stock: ${stockRowCount} cohort-age rows${useAggregate ? ' (aggregate)' : ''}`}
                      onReupload={() => setExpandStock(true)}
                      onView={() => setViewSlotKey('initial_stock')}
                    />
                  ) : (
                    <SetupCard
                      title="Initial stock"
                      description={stockLoaded ? `${stockRowCount} cohort-age rows loaded` : 'Not yet uploaded'}
                      right={<AggregateToggle value={useAggregate} onChange={setUseAggregate} />}
                    >
                      <CSVUploader
                        label={useAggregate ? 'Upload aggregate stock CSV (no age column)' : 'Upload initial stock CSV'}
                        description={useAggregate ? 'Total per cohort — server spreads across ages via Weibull.' : undefined}
                        onUpload={async (f) => {
                          if (useAggregate) {
                            await uploadStockAggregate(f)
                            setExpandStock(false)
                            return { summary: 'Stock uploaded (decomposed by Weibull).' }
                          }
                          await uploadStock(f)
                          setExpandStock(false)
                          return { summary: 'Stock uploaded.' }
                        }}
                        onDownloadTemplate={() => downloadTemplate(useAggregate ? 'stock-aggregate' : 'stock')}
                      />
                    </SetupCard>
                  )}
                </SlotFrame>
                {/* Temporal inputs (inflows + conditionally outflows / stock-targets) —
                    equal-width parallel row; align-items stretch equalizes box heights. */}
                <div
                  data-testid="dsm-temporal-grid"
                  style={{ display: 'grid', gridTemplateColumns: temporalCols, gap: 'var(--space-4)', alignItems: 'stretch' }}
                >
                <SlotFrame
                  owned={slotOwned('inflows')}
                  onBase={onBase}
                  baseName={baseName}
                  onRevert={slotOwned('inflows') ? () => handleRevertSlot('inflows') : undefined}
                >
                  {inflowsLoaded && !expandInflows ? (
                    <CompactCard
                      label={`Inflows: ${inflowYearCount} years loaded`}
                      onReupload={() => setExpandInflows(true)}
                      onView={() => setViewSlotKey('inflows')}
                    />
                  ) : (
                    <DSMUploadSlot
                      title="Annual inflows"
                      status={inflowsLoaded ? `${inflowYearCount} years of sales data loaded` : 'Required to run simulation'}
                      uploadLabel="Upload inflow CSV"
                      schemaSubtitle="year, dims…, count. Sets new units entering the stock each year."
                      onUpload={async (f) => {
                        await uploadInflows(f)
                        setExpandInflows(false)
                        return { summary: 'Inflows uploaded.' }
                      }}
                      onDownloadTemplate={() => downloadTemplate('inflows')}
                    />
                  )}
                </SlotFrame>
                {showOutflowCard && (
                  <SlotFrame
                    owned={slotOwned('outflows')}
                    onBase={onBase}
                    baseName={baseName}
                    onRevert={slotOwned('outflows') ? () => handleRevertSlot('outflows') : undefined}
                  >
                    {outflowsLoaded && !expandOutflows ? (
                      <CompactCard
                        label={`Outflows: ${outflowYearCount} years loaded`}
                        onReupload={() => setExpandOutflows(true)}
                        onView={() => setViewSlotKey('outflows')}
                      />
                    ) : (
                      <DSMUploadSlot
                        title="Annual outflows"
                        status={outflowsLoaded ? `${outflowYearCount} years of retirement data loaded` : 'Required for manual cohorts'}
                        uploadLabel="Upload outflow CSV"
                        schemaSubtitle="year, dims…, count. Optional age / birth_year column targets a specific cohort."
                        onUpload={async (f) => {
                          const res = await uploadOutflows(f)
                          setExpandOutflows(false)
                          const scope = res.cohort_specific ? 'cohort-specific' : 'FIFO-allocated'
                          return { summary: `Outflows uploaded (${scope}).` }
                        }}
                        onDownloadTemplate={() => downloadTemplate('outflows')}
                      />
                    )}
                  </SlotFrame>
                )}
                {showStockTargetsCard && (
                  <SlotFrame
                    owned={slotOwned('stock_targets')}
                    onBase={onBase}
                    baseName={baseName}
                    onRevert={slotOwned('stock_targets') ? () => handleRevertSlot('stock_targets') : undefined}
                  >
                    {targetsLoaded && !expandTargets ? (
                      <CompactCard
                        label={`Stock targets: ${targetYearCount} years loaded`}
                        onReupload={() => setExpandTargets(true)}
                        onView={() => setViewSlotKey('stock_targets')}
                      />
                    ) : (
                      <SetupCard title="Stock targets" description={targetsLoaded ? `${targetYearCount} years loaded` : 'Required for stock-driven cohorts'}>
                        <CSVUploader
                          label="Upload stock-target CSV"
                          description="year, dims…, count — one row per (year, cohort)."
                          onUpload={async (f) => {
                            await uploadStockTargets(f)
                            setExpandTargets(false)
                            return { summary: 'Stock targets uploaded.' }
                          }}
                          onDownloadTemplate={() => downloadTemplate('stock-targets')}
                        />
                      </SetupCard>
                    )}
                  </SlotFrame>
                )}
                </div>
              </div>
            )
          })()}

          <SimulationWarningsPanel warnings={simulationWarnings} />

          {/* Collapsible results card — matches Archetype Summary /
              Prospective databases pattern. */}
          {simulationResult && (
            <CollapsibleCard
              expanded={!resultsCollapsed}
              onToggle={() => setResultsCollapsed((v) => !v)}
              title="Simulation results"
              summary={
                <>
                  <span><strong style={{ color: 'var(--text-primary)' }}>{simulationResult.years.length}</strong> years</span>
                  <span><strong style={{ color: 'var(--text-primary)' }}>{cohortCount}</strong> cohorts</span>
                </>
              }
              actions={
                <>
                  {multiScenarioResult && Object.keys(multiScenarioResult.scenarios).length > 1 && activeView && (
                    <ResultsViewSwitcher
                      scenarioIds={lastRunScenarioIds}
                      cases={lastRunCases}
                      activeView={activeView}
                      onChange={(v) => setActiveView(v)}
                      scenarioNameById={Object.fromEntries(dsmScenarios.map((s) => [s.id, s.name]))}
                    />
                  )}
                  <Button
                    variant="secondary"
                    onClick={handleExport}
                    disabled={exporting}
                    title="Export simulation results to Excel"
                    style={{ height: 28, fontSize: 'var(--text-xs)', padding: '0 10px' }}
                  >
                    <Download size={13} strokeWidth={1.5} /> {exporting ? 'Exporting…' : 'Export Excel'}
                  </Button>
                </>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

          {/* Per-scenario comparison table */}
          {multiScenarioResult &&
            Object.keys(multiScenarioResult.scenarios).length > 1 && (
            <ScenarioComparisonTable
              result={multiScenarioResult}
              scenarioIds={lastRunScenarioIds}
              cases={lastRunCases}
              scenarioNameById={Object.fromEntries(dsmScenarios.map((s) => [s.id, s.name]))}
            />
          )}

          {/* Year timeline */}
          {simulationResult && (
            <YearTimeline
              years={yearList}
              selectedYear={selectedYear ?? horizonYears.start_year}
              onSelect={setSelectedYear}
            />
          )}

          {/* Row 1 — Stacked area chart (full width) */}
          {simulationResult && selectedYearResult && (
            <Card>
              <CardHeader
                title="Stock composition"
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StackByDropdown
                      dims={nonAgeDims}
                      value={stackByDimension}
                      onChange={setStackByDimension}
                    />
                    <ChartExportButton
                      chartRef={stockChartRef}
                      legendRef={stockLegendRef}
                      filename={`stock_composition_${yearList[0] ?? ''}-${yearList[yearList.length - 1] ?? ''}`}
                    />
                  </div>
                }
              />
              <ChartExportContainer ref={stockChartRef} style={{ minHeight: 350, height: 350 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={areaData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                    <YAxis domain={tightStackedDomain} stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                    <Tooltip
                      content={<StackedTotalTooltip unit={activeSystem?.unit_name} formatValue={formatNumber} />}
                    />
                    {stackKeys.map((k, i) => (
                      <Area
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stackId="1"
                        stroke={colorFor(colorMap, k, i)}
                        fill={colorFor(colorMap, k, i)}
                        fillOpacity={0.7}
                        isAnimationActive={false}
                      />
                    ))}
                    <ReferenceLine x={selectedYear ?? undefined} stroke="var(--mod-dsm)" strokeDasharray="3 3" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartExportContainer>
              {/*
                Patch 4J — color legend for the stacked area. Categories
                come from `stackKeys` (one per value of the active
                Stack-by dimension, or `['all']` when none). The legend
                re-renders implicitly when the user changes Stack by,
                because both `stackKeys` and `colorMap` are recomputed
                from `stackByDimension`.
              */}
              {stackKeys.length > 0 && stackKeys[0] !== 'all' && (
                <div
                  ref={stockLegendRef}
                  data-testid="dsm-stock-composition-legend"
                  style={{
                    display: 'flex', flexWrap: 'wrap', gap: 12,
                    paddingTop: 8, paddingLeft: 12,
                    fontSize: 11, color: 'var(--text-secondary)',
                  }}
                >
                  {stackKeys.map((k, i) => (
                    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{
                        display: 'inline-block', width: 10, height: 10,
                        borderRadius: 2,
                        backgroundColor: colorFor(colorMap, k, i),
                      }} />
                      <span>{k}</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Row 2 — Summary cards (2×2) | Age distribution */}
          {simulationResult && selectedYearResult && summary && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 'var(--space-3)' }}>
                {/* end(Y) = Σ YearResult[Y].stock (post-flows snapshot). start(Y) =
                    uploaded initial stock for the first year, else Σ stock of the
                    prior year (= end of Y−1). start + Net change = end. */}
                {(() => {
                  const initialStockResolved = resolveSlot(systemState, 'initial_stock') as Record<string, number> | null
                  const initialStockTotal = initialStockResolved
                    ? Object.values(initialStockResolved).reduce((a, b) => a + b, 0)
                    : null
                  const { start, end } = yearStockStartEnd(
                    simulationResult.years,
                    selectedYear ?? yearList[0],
                    initialStockTotal,
                  )
                  return (
                    <StartEndStockCard
                      year={selectedYear ?? yearList[0]}
                      start={start}
                      end={end}
                      format={formatNumber}
                    />
                  )
                })()}
                <SummaryCard label="Inflows" value={formatNumber(summary.totalInflow)} icon={<ArrowUp size={14} color="var(--success)" />} accent="var(--success)" />
                <SummaryCard label="Outflows" value={formatNumber(summary.totalOutflow)} icon={<ArrowDown size={14} color="var(--danger)" />} accent="var(--danger)" />
                <SummaryCard label="Net change" value={(summary.net >= 0 ? '+' : '') + formatNumber(summary.net)} accent={summary.net >= 0 ? 'var(--success)' : 'var(--danger)'} />
              </div>

              <Card>
                <CardHeader
                  title={`Age distribution · ${selectedYear}`}
                  right={
                    <ChartExportButton
                      chartRef={ageChartRef}
                      legendRef={ageLegendRef}
                      filename={`age_distribution_${selectedYear ?? ''}`}
                    />
                  }
                />
                <ChartExportContainer ref={ageChartRef} style={{ minHeight: 250, height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ageData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="age" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} label={{ value: 'Age', position: 'insideBottom', offset: -2, fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <YAxis domain={tightStackedDomain} stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <Tooltip
                        content={<StackedTotalTooltip unit={activeSystem?.unit_name} formatValue={formatNumber} />}
                      />
                      {stackKeys.map((k, i) => (
                        <Bar key={k} dataKey={k} stackId="age" fill={colorFor(colorMap, k, i)} fillOpacity={0.85} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </ChartExportContainer>
                {stackKeys.length > 0 && stackKeys[0] !== 'all' && (
                  <div
                    ref={ageLegendRef}
                    data-testid="dsm-age-distribution-legend"
                    style={{
                      display: 'flex', flexWrap: 'wrap', gap: 10,
                      paddingTop: 6, paddingLeft: 12,
                      fontSize: 11, color: 'var(--text-secondary)',
                    }}
                  >
                    {stackKeys.map((k, i) => (
                      <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{
                          display: 'inline-block', width: 10, height: 10,
                          borderRadius: 2,
                          backgroundColor: colorFor(colorMap, k, i),
                        }} />
                        <span>{k}</span>
                      </span>
                    ))}
                  </div>
                )}
                {yearList.length > 1 && (
                  <div style={{ marginTop: 10 }}>
                    <YearSlider
                      years={yearList}
                      value={selectedYear ?? yearList[0]}
                      onChange={setSelectedYear}
                      accentColor="var(--mod-dsm)"
                      variant="inline"
                      showDots={yearList.length <= 30}
                    />
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* Row 3 — Cohort breakdown (full width) */}
          {simulationResult && selectedYearResult && (
            <Card>
              <CardHeader
                title={`Cohorts in ${selectedYear}`}
                right={
                  <Button
                    variant="secondary"
                    data-testid="cohort-export"
                    title="Download all years (.xlsx)"
                    aria-label="Download all years (.xlsx)"
                    disabled={!activeSystem?.id || !simulationResult || simulationResult.years.length === 0}
                    onClick={async () => {
                      if (!activeSystem?.id) return
                      try {
                        await exportDSMCohorts(activeSystem.id)
                      } catch (err) {
                        console.error(err)
                      }
                    }}
                  >
                    <Download size={14} strokeWidth={1.5} /> Export Excel
                  </Button>
                }
              />
              <div style={{ overflow: 'auto', maxHeight: 400 }}>
                <CohortTable rows={cohortRows} dims={nonAgeDims} colorMap={colorMap} />
              </div>
            </Card>
          )}

          {/* Row 4 — Inflows & Outflows (Patch 5AD). Inflows (green, from the
              same DSM result) render as a grouped bar beside the outflow column;
              the outflow column keeps its per-source stacked breakdown
              (natural / forced / uploaded) when more than one source applies. */}
          {simulationResult && (() => {
            const outSourceCount = outflowSourceCount(outflowBreakdown)
            // Nothing to show only if there are neither inflows nor outflows.
            if (outSourceCount === 0 && !outflowBreakdown.hasInflow) return null
            const isOutflowSplit = outSourceCount >= 2
            // Legend entries (Inflows first, then the outflow side) from the
            // shared pure model — keeps bars + legend swatches in lockstep.
            const legendEntries = buildFlowLegend(outflowBreakdown)
            return (
              <Card>
                <CardHeader
                  title="Inflows & Outflows"
                  right={
                    <ChartExportButton
                      chartRef={outflowChartRef}
                      legendRef={outflowLegendRef}
                      filename={`flows_${yearList[0] ?? ''}-${yearList[yearList.length - 1] ?? ''}`}
                    />
                  }
                />
                <ChartExportContainer ref={outflowChartRef} style={{ minHeight: 260, height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={outflowBreakdown.rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <YAxis domain={tightStackedDomain} stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <Tooltip
                        content={<StackedTotalTooltip unit={activeSystem?.unit_name} formatValue={formatNumber} />}
                      />
                      {/* Inflows — its own stack ("i") so it sits GROUPED beside
                          the outflow column. Green, matching the table/summary. */}
                      {outflowBreakdown.hasInflow && (
                        <Bar dataKey="inflow" stackId="i" fill="var(--success)" name="Inflows" isAnimationActive={false} />
                      )}
                      {/* Outflows — stacked by source under "o". */}
                      {outflowBreakdown.hasNatural && (
                        <Bar dataKey="natural" stackId="o" fill="var(--chart-3)" name={isOutflowSplit ? 'Natural attrition' : 'Outflows'} isAnimationActive={false} />
                      )}
                      {outflowBreakdown.hasForced && (
                        <Bar dataKey="forced" stackId="o" fill="var(--danger)" name={isOutflowSplit ? 'Forced' : 'Outflows'} isAnimationActive={false} />
                      )}
                      {outflowBreakdown.hasManual && (
                        <Bar dataKey="manual" stackId="o" fill="var(--mod-dsm)" name={isOutflowSplit ? 'Uploaded' : 'Outflows'} isAnimationActive={false} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </ChartExportContainer>
                <div
                  ref={outflowLegendRef}
                  data-testid="dsm-outflow-legend"
                  style={{
                    display: 'flex', flexWrap: 'wrap', gap: 12,
                    paddingTop: 8, paddingLeft: 12,
                    fontSize: 11, color: 'var(--text-secondary)',
                  }}
                >
                  {legendEntries.map((e) => (
                    <span key={e.key} data-testid={`dsm-flow-legend-${e.key}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, backgroundColor: e.color }} />
                      <span>{e.label}</span>
                    </span>
                  ))}
                </div>
              </Card>
            )
          })()}

              </div>
            </CollapsibleCard>
          )}

          {!simulationResult && (
            <div style={{ padding: 'var(--space-6)', backgroundColor: 'var(--bg-surface)', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
              {globalMode === 'manual'
                ? <>Upload stock, inflows, and outflows, then click <strong>Run simulation</strong>.</>
                : globalMode === 'survival_stock'
                  ? <>Upload stock and stock targets, pick a survival function, then click <strong>Run simulation</strong>.</>
                  : <>Upload stock + inflows, pick a survival function, then click <strong>Run simulation</strong>.</>}
            </div>
          )}
      </>}
      </>
      )}

      {showCreator && <SystemCreator onClose={() => setShowCreator(false)} />}
      {showModes && <ModeConfigurator onClose={() => setShowModes(false)} />}
      {showCohortMapping && <CohortMappingDialog onClose={() => setShowCohortMapping(false)} />}
      {showScenarios && <ScenarioManagerModal onClose={() => setShowScenarios(false)} />}
      {viewSlotKey && activeScenario && (
        <SlotDataViewer
          scenario={activeScenario}
          baseScenario={baseScenarioObj}
          slotKey={viewSlotKey}
          onClose={() => setViewSlotKey(null)}
        />
      )}
      {showEdit && activeSystem && (
        <EditSystemModal system={activeSystem} onClose={() => setShowEdit(false)} />
      )}
    </div>
  )
}

// ── sub-components ─────────────────────────────────────────────────────────────

function ResultsViewSwitcher({
  scenarioIds, cases, activeView, onChange, scenarioNameById,
}: {
  scenarioIds: string[]
  cases: string[]
  activeView: ActiveResultView
  onChange: (v: ActiveResultView) => void
  scenarioNameById: Record<string, string>
}) {
  const selStyle: React.CSSProperties = {
    height: 26, padding: '0 8px',
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-xs)',
  }
  const labelStyle: React.CSSProperties = {
    textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
    color: 'var(--text-tertiary)', fontWeight: 600,
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 'var(--text-xs)' }}>
      {scenarioIds.length > 1 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle}>Scenario</span>
          <select
            value={activeView.scenarioId}
            onChange={(e) => onChange({ ...activeView, scenarioId: e.target.value })}
            style={selStyle}
          >
            {scenarioIds.map((sid) => (
              <option key={sid} value={sid}>{scenarioNameById[sid] ?? sid}</option>
            ))}
          </select>
        </label>
      )}
      {cases.length > 1 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle}>Case</span>
          <select
            value={activeView.case}
            onChange={(e) => onChange({ ...activeView, case: e.target.value })}
            style={selStyle}
          >
            {cases.map((cs) => (
              <option key={cs} value={cs}>{cs}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function ScenarioComparisonTable({
  result, scenarioIds, cases, scenarioNameById,
}: {
  result: MultiScenarioSimulationResult
  scenarioIds: string[]
  cases: string[]
  scenarioNameById: Record<string, string>
}) {
  // Build the list of (key, label) pairs by iterating the cross product in
  // the same order the server responded in. Falls back to raw keys when the
  // server returned a shape we don't recognize (e.g. legacy runs).
  const columns = (() => {
    if (scenarioIds.length && cases.length) {
      const pairs: { key: string; label: string }[] = []
      for (const sid of scenarioIds) {
        for (const cs of cases) {
          const key = multiResultKey(scenarioIds, cases, sid, cs)
          const sName = scenarioNameById[sid] ?? sid
          const label = scenarioIds.length === 1
            ? cs
            : cases.length === 1 ? sName : `${sName} × ${cs}`
          if (result.scenarios[key]) pairs.push({ key, label })
        }
      }
      return pairs
    }
    return Object.keys(result.scenarios).map((k) => ({ key: k, label: k }))
  })()

  const keys = columns.map((c) => c.key)
  const base = result.scenarios[BASE_SCENARIO] ?? result.scenarios[keys[0]]
  const years = base?.years.map((y) => y.year) ?? []

  const rows = years.map((year) => {
    const byKey: Record<string, number> = {}
    for (const k of keys) {
      const yr = result.scenarios[k]?.years.find((y) => y.year === year)
      if (!yr) continue
      byKey[k] = Object.values(yr.stock).reduce((a, b) => a + b, 0)
    }
    return { year, byKey }
  })

  const baseCol = columns[0] ?? { key: BASE_SCENARIO, label: BASE_SCENARIO }
  const otherCols = columns.slice(1)

  return (
    <div style={{
      marginTop: 'var(--space-2)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      backgroundColor: 'var(--bg-surface)',
      overflow: 'auto',
      maxHeight: 240,
    }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-mono)',
      }}>
        <thead>
          <tr style={{
            position: 'sticky', top: 0,
            backgroundColor: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border-default)',
          }}>
            <th style={thStyle}>Year</th>
            <th style={thStyle}>{baseCol.label} (total stock)</th>
            {otherCols.map((c) => (
              <th key={c.key} style={thStyle}>
                {c.label} <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>(Δ vs {baseCol.label})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const baseVal = row.byKey[baseCol.key] ?? 0
            return (
              <tr key={row.year} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={tdStyle}>{row.year}</td>
                <td style={tdStyle}>{formatNumber(baseVal)}</td>
                {otherCols.map((c) => {
                  const v = row.byKey[c.key] ?? 0
                  const delta = v - baseVal
                  const pct = baseVal !== 0 ? (delta / baseVal) * 100 : 0
                  const positive = delta > 0
                  const neutral = Math.abs(delta) < 1e-6
                  return (
                    <td key={c.key} style={tdStyle}>
                      {formatNumber(v)}{' '}
                      <span style={{
                        color: neutral
                          ? 'var(--text-tertiary)'
                          : positive
                            ? 'var(--success, #46a758)'
                            : 'var(--danger, #e5484d)',
                      }}>
                        {neutral
                          ? '±0'
                          : `${positive ? '+' : ''}${formatNumber(delta)} (${positive ? '+' : ''}${pct.toFixed(1)}%)`}
                      </span>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  fontFamily: 'var(--font-sans)',
  fontSize: 10,
}

const tdStyle: React.CSSProperties = {
  padding: '4px 10px',
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
}

function InheritanceBadge({
  owned,
  onBase,
  baseName,
  onRevert,
}: {
  owned: boolean
  onBase: boolean
  baseName: string
  onRevert?: () => void
}) {
  if (onBase) return null
  const label = owned ? 'Scenario-specific' : `Inherits from ${baseName}`
  const color = owned ? 'var(--mod-dsm)' : 'var(--text-tertiary)'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontSize: 10, color,
      padding: '2px 8px',
      borderRadius: 999,
      border: `1px solid ${color}`,
      backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      marginBottom: 6,
      alignSelf: 'flex-start',
      textTransform: 'uppercase', fontWeight: 600,
      letterSpacing: 'var(--tracking-wide)',
    }}>
      <span>{owned ? '✓' : '↳'}</span>
      <span>{label}</span>
      {owned && onRevert && (
        <button
          onClick={onRevert}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'inherit', fontSize: 10, padding: 0,
            textDecoration: 'underline', textTransform: 'none',
            fontWeight: 500,
          }}
        >
          Revert to {baseName}
        </button>
      )}
    </div>
  )
}

function SlotFrame({
  owned, onBase, baseName, onRevert, children,
}: {
  owned: boolean
  onBase: boolean
  baseName: string
  onRevert?: () => void
  children: React.ReactNode
}) {
  return (
    // height: 100% lets the frame fill a stretch-aligned grid cell so the
    // upload card inside (flexGrow) equalizes height with parallel siblings.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <InheritanceBadge
        owned={owned}
        onBase={onBase}
        baseName={baseName}
        onRevert={onRevert}
      />
      {children}
    </div>
  )
}

function CompactCard({
  label,
  onReupload,
  onView,
}: {
  label: string
  onReupload: () => void
  onView?: () => void
}) {
  return (
    <div style={{
      padding: '12px 16px',
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
        <CheckCircle2 size={14} color="var(--success)" />
        <span>{label}</span>
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
        {onView && (
          <button
            onClick={onView}
            title="View data"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', padding: 0,
              display: 'inline-flex', alignItems: 'center',
            }}
          >
            <Eye size={14} strokeWidth={1.6} />
          </button>
        )}
        <button
          onClick={onReupload}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--mod-dsm)', fontSize: 'var(--text-xs)', fontWeight: 500, padding: 0,
          }}
        >
          Re-upload
        </button>
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-5)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      {children}
    </div>
  )
}

function CardHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h3>
      {right}
    </div>
  )
}

function SetupCard({ title, description, right, children }: { title: string; description?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
          {description && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{description}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function AggregateToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 2, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
      {[
        { k: false, label: 'By age' },
        { k: true, label: 'Aggregate' },
      ].map((o) => {
        const active = value === o.k
        return (
          <button
            key={String(o.k)}
            onClick={() => onChange(o.k)}
            style={{
              padding: '4px 10px',
              fontSize: 'var(--text-xs)',
              fontWeight: active ? 600 : 500,
              background: active ? 'var(--mod-dsm)' : 'transparent',
              color: active ? 'white' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function SummaryCard({ label, value, icon, accent }: { label: string; value: string; icon?: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minHeight: 110,
    }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {icon}
        <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 600, color: accent ?? 'var(--text-primary)' }}>
          {value}
        </span>
      </div>
    </div>
  )
}

function StackByDropdown({ dims, value, onChange }: { dims: DimensionDef[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
      Stack by
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none', cursor: 'pointer' }}
      >
        {dims.map((d) => (
          <option key={d.name} value={d.name}>{d.display_name || d.name}</option>
        ))}
      </select>
    </label>
  )
}

function YearTimeline({ years, selectedYear, onSelect }: { years: number[]; selectedYear: number; onSelect: (y: number) => void }) {
  return (
    <YearSlider
      years={years}
      value={selectedYear}
      onChange={onSelect}
      accentColor="var(--mod-dsm)"
    />
  )
}

function CohortTable({ rows, dims, colorMap }: { rows: ReturnType<typeof useCohortRowsType>; dims: DimensionDef[]; colorMap: Record<string, string> }) {
  const [sortBy, setSortBy] = useState<'stock' | 'inflow' | 'outflow' | 'net'>('stock')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortBy]
    const bv = b[sortBy]
    return dir === 'asc' ? av - bv : bv - av
  })

  const headers: { key: 'stock' | 'inflow' | 'outflow' | 'net'; label: string }[] = [
    { key: 'stock', label: 'Stock' },
    { key: 'inflow', label: 'Inflow' },
    { key: 'outflow', label: 'Outflow' },
    { key: 'net', label: 'Net' },
  ]

  const handleSort = (k: typeof sortBy) => {
    if (sortBy === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(k); setDir('desc') }
  }

  const numCell: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }
  const headCell: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', cursor: 'pointer', backgroundColor: 'var(--bg-surface)', position: 'sticky', top: 0 }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {dims.map((d) => <th key={d.name} style={headCell}>{d.display_name || d.name}</th>)}
          {headers.map((h) => (
            <th key={h.key} style={{ ...headCell, textAlign: 'right' }} onClick={() => handleSort(h.key)}>
              {h.label} {sortBy === h.key && (dir === 'asc' ? '↑' : '↓')}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.cohort_key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {dims.map((d) => {
              const v = row.dims[d.name] ?? ''
              return (
                <td key={d.name} style={{ padding: '6px 10px' }}>
                  <Badge label={v} variant="dsm" customColor={colorMap[v]} />
                </td>
              )
            })}
            <td style={numCell}>{formatNumber(row.stock)}</td>
            <td style={{ ...numCell, color: row.inflow > 0 ? 'var(--success)' : 'var(--text-tertiary)' }}>{formatNumber(row.inflow)}</td>
            <td style={{ ...numCell, color: row.outflow > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>{formatNumber(row.outflow)}</td>
            <td style={{ ...numCell, color: row.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {(row.net >= 0 ? '+' : '') + formatNumber(row.net)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// helper-only type alias for CohortTable rows
function useCohortRowsType(): { cohort_key: string; dims: Record<string, string>; stock: number; inflow: number; outflow: number; net: number }[] {
  return []
}

interface SystemSwitcherProps {
  open: boolean
  onToggle: () => void
  systems: { id: string; name: string }[]
  activeId: string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onCreateNew: () => void
}

function SystemSwitcher({ open, onToggle, systems, activeId, onSelect, onDelete, onCreateNew }: SystemSwitcherProps) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onToggle}
        style={{ height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}
      >
        Switch <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 32, left: 0, minWidth: 240, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', zIndex: 30, overflow: 'hidden' }}>
          {systems.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', backgroundColor: s.id === activeId ? 'var(--bg-active)' : 'transparent' }}>
              <button onClick={() => onSelect(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', textAlign: 'left', flex: 1 }}>
                {s.name}
              </button>
              <button onClick={() => onDelete(s.id)} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {systems.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-subtle)' }} />
          )}
          <button
            onClick={() => { onCreateNew(); onToggle() }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mod-dsm)', fontSize: 'var(--text-sm)', fontWeight: 500, textAlign: 'left' }}
          >
            <Plus size={14} strokeWidth={1.5} /> New system
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyState({ systemsExist, systems, onCreate, onSelect, onRestoreClick, importing }: {
  systemsExist: boolean
  systems: { id: string; name: string; cohort_count: number; time_horizon: { start_year: number; end_year: number } }[]
  onCreate: () => void
  onSelect: (id: string) => void
  onRestoreClick: () => void
  importing: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', gap: 'var(--space-5)' }}>
      <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-full)', backgroundColor: 'color-mix(in srgb, var(--mod-dsm) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <GitBranch size={28} color="var(--mod-dsm)" />
      </div>
      <div>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {systemsExist ? 'Pick a system to open' : 'Create your first system'}
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 6, maxWidth: 420 }}>
          MApper's stock modeller is a dynamic stock-flow model with cohort tracking. Define dimensions
          (e.g. fuel type, size), upload an initial stock and annual sales, and watch the system age year by year.
          Couple dependent sub-systems (e.g. infrastructure to a primary product stock) so their populations scale with the primary stock.
        </p>
      </div>
      <Button variant="primary" onClick={onCreate} style={{ backgroundColor: 'var(--mod-dsm)', height: 40, padding: '0 18px' }}>
        <Plus size={14} strokeWidth={1.5} /> New system
      </Button>
      <button
        onClick={onRestoreClick}
        disabled={importing}
        style={{ background: 'none', border: 'none', cursor: importing ? 'not-allowed' : 'pointer', color: 'var(--mod-dsm)', fontSize: 'var(--text-sm)', fontWeight: 500, padding: 0 }}
      >
        {importing ? 'Importing…' : 'Or restore from a previous export'}
      </button>
      {systemsExist && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 360 }}>
          {systems.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left' }}
            >
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{s.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                  {s.time_horizon.start_year}–{s.time_horizon.end_year} · {s.cohort_count} cohorts
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
