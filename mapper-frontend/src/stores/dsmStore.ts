/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { create } from 'zustand'
import { useProjectStore } from './projectStore'
import { normalizeHex } from '../utils/chartColors'
import {
  HttpError,
  type CohortMappingEntry,
  type DSMLCAResult,
  type DSMScalingRule,
  type DSMScenario,
  type DSMSystemState,
  type ModeConfig,
  type MultiScenarioSimulationResult,
  type SimulationResult,
  type SurvivalConfig,
  type SystemDefinition,
  type SystemSummary,
  type SystemUpdateResponse,
  type MaterialFlowResult,
  type MaterialFlowScenarioRun,
  activateDSMScenario,
  promoteDSMScenarioToBase,
  calculateMaterialFlows as apiCalculateMaterialFlows,
  calculateMaterialFlowsMulti as apiCalculateMaterialFlowsMulti,
  createDSMScenario,
  createDSMSystem,
  deleteDSMScenario,
  deleteDSMSystem,
  downloadInflowTemplate,
  downloadOutflowTemplate,
  downloadStockAggregateTemplate,
  downloadStockTargetsTemplate,
  downloadStockTemplate,
  exportDSMLCA,
  exportMaterialFlows as apiExportMaterialFlows,
  exportMFAResults,
  getCohortMappings,
  getDSMSystem,
  getMFAResults,
  getMFAState,
  getScalingRules,
  importDSMSystem,
  importMFASimulation,
  listDSMSystems,
  runDSMLCA,
  setCohortMappings,
  setModeConfigs,
  setScalingRules,
  setSurvivalConfigs,
  simulateMFA,
  simulateScenarios,
  updateDSMScenario,
  updateDSMSystem,
  uploadInflows,
  uploadOutflows,
  uploadStock,
  uploadStockAggregate,
  uploadStockTargets,
} from '../api/client'

export interface CohortMappingValue {
  archetype_id: string
  scaling_factor: number
}

/** Key used by ``MultiScenarioSimulationResult.scenarios`` for a given
 *  (scenario, case) pair. Mirrors the server's degradation rules:
 *  single scenario → key is case; single case → key is scenarioId;
 *  otherwise "{scenarioId}|{case}".
 */
export function multiResultKey(
  scenarioIds: string[], cases: string[], scenarioId: string, caseName: string,
): string {
  const singleScenario = scenarioIds.length === 1
  const singleCase = cases.length === 1
  if (singleScenario && !singleCase) return caseName
  if (singleCase && !singleScenario) return scenarioId
  return `${scenarioId}|${caseName}`
}

export interface ActiveResultView {
  scenarioId: string
  case: string
}

interface DSMStore {
  systems: SystemSummary[]
  activeSystem: SystemDefinition | null
  systemState: DSMSystemState | null
  simulationResult: SimulationResult | null
  multiScenarioResult: MultiScenarioSimulationResult | null
  /** Last dispatched (scenario_ids, cases) pairing — kept so the viewer can
   *  reconstruct result keys without re-deriving them from dropdown state. */
  lastRunScenarioIds: string[]
  lastRunCases: string[]
  activeView: ActiveResultView | null
  selectedYear: number | null
  stackByDimension: string | null
  cohortMappings: Record<string, CohortMappingValue>
  // Patch 4AK — per-row color overrides keyed by cohort_key.
  // Backend-persisted via CohortMapping.row_colors; mirrored here for
  // O(1) chart lookups.
  cohortRowColors: Record<string, string>
  dsmLCAResults: DSMLCAResult[]
  dsmLCAWarnings: string[]
  selectedResultIndex: number
  scalingRules: DSMScalingRule[]
  isLoading: boolean
  isSimulating: boolean
  isCalculatingLCA: boolean
  materialFlows: MaterialFlowResult | null
  materialFlowLoading: boolean
  // Patch 4M — multi-axis fan-out slots. When the user selects more
  // than one DSM scenario OR more than one parameter scenario, results
  // land here and the panel renders a scenario tab bar above the
  // result. ``materialFlows`` is mirrored to the active scenario's
  // result so the existing single-result rendering code keeps working
  // unchanged for the active tab. ``materialFlowAxis`` tracks which
  // axis was fanned out so the tab bar can label tabs appropriately.
  materialFlowsRuns: MaterialFlowScenarioRun[]
  materialFlowAxis: 'dsm' | 'parameter' | null
  activeMaterialFlowScenario: string | null
  error: string | null

  fetchSystems: () => Promise<void>
  createSystem: (def: Omit<SystemDefinition, 'id' | 'created_at'>) => Promise<SystemDefinition>
  updateSystem: (def: SystemDefinition) => Promise<SystemUpdateResponse>
  selectSystem: (id: string) => Promise<void>
  removeSystem: (id: string) => Promise<void>
  refreshState: () => Promise<void>
  uploadStock: (file: File) => Promise<void>
  uploadStockAggregate: (
    file: File,
    opts?: { shape?: number; scale?: number; maxAge?: number },
  ) => Promise<void>
  uploadInflows: (file: File) => Promise<void>
  uploadStockTargets: (file: File) => Promise<void>
  uploadOutflows: (file: File) => Promise<{ cohort_specific: boolean; rows_parsed: number; total_outflows: number }>
  setSurvival: (configs: SurvivalConfig[]) => Promise<void>
  setModes: (configs: ModeConfig[]) => Promise<void>
  simulate: (scenarioId?: string | null) => Promise<void>
  simulateCross: (scenarioIds: string[], cases: string[]) => Promise<void>
  fetchScalingRules: () => Promise<void>
  saveScalingRules: (rules: DSMScalingRule[]) => Promise<void>
  // Scenario CRUD
  createScenario: (body: { name: string; description?: string; copyFrom?: string }) => Promise<DSMScenario>
  renameScenario: (scenarioId: string, name: string, description?: string | null) => Promise<DSMScenario>
  duplicateScenario: (scenarioId: string, name: string) => Promise<DSMScenario>
  deleteScenario: (scenarioId: string) => Promise<void>
  activateScenario: (scenarioId: string) => Promise<void>
  promoteScenarioToBase: (scenarioId: string) => Promise<void>
  // Clears a slot on a non-base scenario so it inherits from Base again.
  revertSlotToBase: (slot: 'initial_stock' | 'inflows' | 'stock_targets' | 'outflows' | 'mode_configs' | 'scaling_rules') => Promise<void>
  setActiveView: (view: ActiveResultView | null) => void
  exportResults: () => Promise<void>
  setSelectedYear: (year: number) => void
  setStackByDimension: (dim: string) => void
  downloadTemplate: (type: 'stock' | 'inflows' | 'stock-targets' | 'stock-aggregate' | 'outflows') => Promise<void>
  fetchCohortMappings: () => Promise<void>
  saveCohortMappings: (
    mappings: Record<string, CohortMappingValue>,
    rowColors?: Record<string, string>,
  ) => Promise<void>
  // Patch 4AK — per-row color override actions.
  setRowColor: (cohortKey: string, color: string) => Promise<void>
  clearRowColor: (cohortKey: string) => Promise<void>
  runDSMLCA: (
    methods: string[][],
    scope: 'inflows' | 'outflows' | 'stock' | 'all',
    opts?: { yearStart?: number | null; yearEnd?: number | null; parameterSetId?: string | null },
  ) => Promise<void>
  selectResultIndex: (i: number) => void
  exportDSMLCAResults: (year?: number | null) => Promise<void>
  importSimulation: (file: File) => Promise<{ years_imported: number; cohorts_found: number; warnings: string[] }>
  importSystem: (file: File) => Promise<SystemDefinition>
  calcMaterialFlows: (
    scope: string,
    yearStart: number | null,
    yearEnd: number | null,
    groupBy: string,
    opts?: {
      // Patch 4M — multi-axis fan-out. At most one of these may have
      // length > 1 (axisConflict, enforced both client-side via the
      // calculate button gating and server-side via 400). Empty / single
      // values fall through to the single-result endpoint.
      dsmScenarioIds?: string[]
      parameterScenarios?: string[]
    },
  ) => Promise<void>
  selectMaterialFlowScenario: (id: string | null) => void
  exportMatFlows: (scope: string, yearStart: number | null, yearEnd: number | null) => Promise<void>
  reset: () => void
}

// ── Selector helpers (used by UI to read the resolved scenario view) ────────

export function findScenario(
  state: DSMSystemState | null, scenarioId: string | null | undefined,
): DSMScenario | null {
  if (!state) return null
  const sid = scenarioId ?? state.active_scenario_id
  if (!sid) return state.scenarios.find((s) => s.is_base) ?? state.scenarios[0] ?? null
  return state.scenarios.find((s) => s.id === sid) ?? null
}

export function baseScenario(state: DSMSystemState | null): DSMScenario | null {
  if (!state) return null
  return state.scenarios.find((s) => s.is_base) ?? state.scenarios[0] ?? null
}

/** Resolve a slot on the active scenario with Base inheritance.
 *  ``null`` on a non-base scenario means "use Base". On Base ``null`` is "empty". */
export function resolveSlot<K extends keyof DSMScenario>(
  state: DSMSystemState | null, slot: K, scenarioId?: string | null,
): NonNullable<DSMScenario[K]> | null {
  const scen = findScenario(state, scenarioId)
  const base = baseScenario(state)
  if (!scen) return null
  const own = scen[slot]
  if (own !== null && own !== undefined) return own as NonNullable<DSMScenario[K]>
  if (scen !== base && base) {
    const b = base[slot]
    if (b !== null && b !== undefined) return b as NonNullable<DSMScenario[K]>
  }
  return null
}

const INITIAL: Pick<
  DSMStore,
  | 'systems' | 'activeSystem' | 'systemState' | 'simulationResult'
  | 'multiScenarioResult' | 'lastRunScenarioIds' | 'lastRunCases'
  | 'activeView' | 'selectedYear' | 'stackByDimension' | 'cohortMappings' | 'cohortRowColors'
  | 'dsmLCAResults' | 'dsmLCAWarnings' | 'selectedResultIndex' | 'scalingRules'
  | 'isLoading' | 'isSimulating' | 'isCalculatingLCA' | 'materialFlows'
  | 'materialFlowLoading'
  | 'materialFlowsRuns' | 'materialFlowAxis' | 'activeMaterialFlowScenario'
  | 'error'
> = {
  systems: [],
  activeSystem: null,
  systemState: null,
  simulationResult: null,
  multiScenarioResult: null,
  lastRunScenarioIds: [],
  lastRunCases: [],
  activeView: null,
  selectedYear: null,
  stackByDimension: null,
  cohortMappings: {}, cohortRowColors: {},
  dsmLCAResults: [],
  dsmLCAWarnings: [],
  selectedResultIndex: 0,
  scalingRules: [],
  isLoading: false,
  isSimulating: false,
  isCalculatingLCA: false,
  materialFlows: null,
  materialFlowLoading: false,
  materialFlowsRuns: [],
  materialFlowAxis: null,
  activeMaterialFlowScenario: null,
  error: null,
}

function resolveActiveScalingRules(state: DSMSystemState | null): DSMScalingRule[] {
  return (resolveSlot(state, 'scaling_rules') as DSMScalingRule[] | null) ?? []
}

export const useDSMStore = create<DSMStore>((set, get) => ({
  ...INITIAL,

  fetchSystems: async () => {
    set({ isLoading: true, error: null })
    try {
      const systems = await listDSMSystems()
      set({ systems, isLoading: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
    }
  },

  createSystem: async (def) => {
    set({ isLoading: true, error: null })
    try {
      const created = await createDSMSystem(def)
      const [systems, state] = await Promise.all([
        listDSMSystems(),
        created.id ? getMFAState(created.id) : Promise.resolve(null as DSMSystemState | null),
      ])
      const firstNonAge = created.dimensions.find((d) => !d.is_age)
      set({
        systems,
        activeSystem: created,
        systemState: state,
        simulationResult: null,
        multiScenarioResult: null,
        lastRunScenarioIds: [],
        lastRunCases: [],
        activeView: null,
        selectedYear: created.time_horizon.start_year,
        stackByDimension: firstNonAge?.name ?? null,
        cohortMappings: {}, cohortRowColors: {},
        dsmLCAResults: [],
        dsmLCAWarnings: [],
        selectedResultIndex: 0,
        scalingRules: resolveActiveScalingRules(state),
        materialFlows: null,
        materialFlowLoading: false,
        materialFlowsRuns: [],
        materialFlowAxis: null,
        activeMaterialFlowScenario: null,
        isLoading: false,
      })
      return created
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ error: msg, isLoading: false })
      throw e
    }
  },

  updateSystem: async (def) => {
    if (!def.id) throw new Error('Missing system id')
    set({ isLoading: true, error: null })
    try {
      const res = await updateDSMSystem(def.id, def)
      const [state, systems] = await Promise.all([getMFAState(def.id), listDSMSystems()])
      const firstNonAge = res.system.dimensions.find((d) => !d.is_age)
      set({
        systems,
        activeSystem: res.system,
        systemState: state,
        simulationResult: null,
        multiScenarioResult: null,
        lastRunScenarioIds: [],
        lastRunCases: [],
        activeView: null,
        selectedYear: res.system.time_horizon.start_year,
        stackByDimension: firstNonAge?.name ?? null,
        dsmLCAResults: [],
        dsmLCAWarnings: [],
        selectedResultIndex: 0,
        scalingRules: resolveActiveScalingRules(state),
        materialFlows: null,
        materialFlowLoading: false,
        materialFlowsRuns: [],
        materialFlowAxis: null,
        activeMaterialFlowScenario: null,
        isLoading: false,
      })
      get().fetchCohortMappings().catch(() => undefined)
      return res
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ error: msg, isLoading: false })
      throw e
    }
  },

  selectSystem: async (id) => {
    set({ isLoading: true, error: null })
    try {
      const [sys, state] = await Promise.all([getDSMSystem(id), getMFAState(id)])
      const firstNonAge = sys.dimensions.find((d) => !d.is_age)
      set({
        activeSystem: sys,
        systemState: state,
        simulationResult: null,
        multiScenarioResult: null,
        lastRunScenarioIds: [],
        lastRunCases: [],
        activeView: null,
        selectedYear: sys.time_horizon.start_year,
        stackByDimension: firstNonAge?.name ?? null,
        cohortMappings: {}, cohortRowColors: {},
        dsmLCAResults: [],
        dsmLCAWarnings: [],
        selectedResultIndex: 0,
        scalingRules: resolveActiveScalingRules(state),
        materialFlows: null,
        materialFlowLoading: false,
        materialFlowsRuns: [],
        materialFlowAxis: null,
        activeMaterialFlowScenario: null,
        isLoading: false,
      })
      get().fetchCohortMappings().catch(() => undefined)
    } catch (e: unknown) {
      if (e instanceof HttpError && e.status === 404) {
        let systems: SystemSummary[] = []
        try { systems = await listDSMSystems() } catch { /* ignore */ }
        set({
          ...INITIAL,
          systems,
        })
        return
      }
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
    }
  },

  removeSystem: async (id) => {
    await deleteDSMSystem(id)
    const { activeSystem } = get()
    const systems = await listDSMSystems()
    set({
      systems,
      activeSystem: activeSystem?.id === id ? null : activeSystem,
      systemState: activeSystem?.id === id ? null : get().systemState,
      simulationResult: activeSystem?.id === id ? null : get().simulationResult,
    })
  },

  refreshState: async () => {
    const { activeSystem } = get()
    if (!activeSystem?.id) return
    const state = await getMFAState(activeSystem.id)
    set({
      systemState: state,
      scalingRules: resolveActiveScalingRules(state),
    })
  },

  uploadStock: async (file) => {
    const { activeSystem, systemState } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await uploadStock(activeSystem.id, file, systemState?.active_scenario_id ?? null)
    await get().refreshState()
  },

  uploadStockAggregate: async (file, opts) => {
    const { activeSystem, systemState } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await uploadStockAggregate(activeSystem.id, file, {
      ...opts,
      scenarioId: systemState?.active_scenario_id ?? null,
    })
    await get().refreshState()
  },

  uploadInflows: async (file) => {
    const { activeSystem, systemState } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await uploadInflows(activeSystem.id, file, systemState?.active_scenario_id ?? null)
    await get().refreshState()
  },

  uploadStockTargets: async (file) => {
    const { activeSystem, systemState } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await uploadStockTargets(activeSystem.id, file, systemState?.active_scenario_id ?? null)
    await get().refreshState()
  },

  uploadOutflows: async (file) => {
    const { activeSystem, systemState } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const res = await uploadOutflows(activeSystem.id, file, systemState?.active_scenario_id ?? null)
    await get().refreshState()
    return {
      cohort_specific: res.cohort_specific,
      rows_parsed: res.rows_parsed,
      total_outflows: res.total_outflows,
    }
  },

  setSurvival: async (configs) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await setSurvivalConfigs(activeSystem.id, configs)
    await get().refreshState()
  },

  setModes: async (configs) => {
    const { activeSystem, systemState } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await setModeConfigs(activeSystem.id, configs, systemState?.active_scenario_id ?? null)
    await get().refreshState()
  },

  simulate: async (scenarioId?: string | null) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    set({ isSimulating: true, error: null })
    try {
      const result = await simulateMFA(activeSystem.id, scenarioId ?? null)
      set({
        simulationResult: result,
        multiScenarioResult: null,
        lastRunScenarioIds: [],
        lastRunCases: [],
        activeView: null,
        isSimulating: false,
        selectedYear: result.years[0]?.year ?? activeSystem.time_horizon.start_year,
      })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isSimulating: false })
      throw e
    }
  },

  simulateCross: async (scenarioIds, cases) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const sids = scenarioIds.length
      ? scenarioIds
      : [get().systemState?.active_scenario_id ?? 'base']
    const csList = cases.length ? cases : ['Base']
    set({ isSimulating: true, error: null })
    try {
      const res = await simulateScenarios(activeSystem.id, {
        scenario_ids: sids, cases: csList,
      })
      const firstKey = multiResultKey(sids, csList, sids[0], csList[0])
      const firstResult = res.scenarios[firstKey]
      set({
        multiScenarioResult: res,
        lastRunScenarioIds: sids,
        lastRunCases: csList,
        activeView: { scenarioId: sids[0], case: csList[0] },
        simulationResult: firstResult ?? null,
        isSimulating: false,
        selectedYear:
          firstResult?.years[0]?.year ?? activeSystem.time_horizon.start_year,
      })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isSimulating: false })
      throw e
    }
  },

  fetchScalingRules: async () => {
    const { activeSystem, systemState } = get()
    if (!activeSystem?.id) return
    try {
      const res = await getScalingRules(activeSystem.id, systemState?.active_scenario_id ?? null)
      set({ scalingRules: res.rules })
    } catch {
      set({ scalingRules: [] })
    }
  },

  saveScalingRules: async (rules) => {
    const { activeSystem, systemState } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await setScalingRules(activeSystem.id, rules, systemState?.active_scenario_id ?? null)
    set({ scalingRules: rules })
    await get().refreshState()
  },

  createScenario: async ({ name, description, copyFrom }) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const created = await createDSMScenario(activeSystem.id, {
      name,
      description: description ?? null,
      copy_from: copyFrom ?? null,
    })
    await get().refreshState()
    return created
  },

  renameScenario: async (scenarioId, name, description) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const updated = await updateDSMScenario(activeSystem.id, scenarioId, {
      name, description: description ?? null,
    })
    await get().refreshState()
    return updated
  },

  duplicateScenario: async (scenarioId, name) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const created = await createDSMScenario(activeSystem.id, {
      name, copy_from: scenarioId,
    })
    await get().refreshState()
    return created
  },

  deleteScenario: async (scenarioId) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await deleteDSMScenario(activeSystem.id, scenarioId)
    await get().refreshState()
  },

  activateScenario: async (scenarioId) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await activateDSMScenario(activeSystem.id, scenarioId)
    await get().refreshState()
  },

  promoteScenarioToBase: async (scenarioId) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await promoteDSMScenarioToBase(activeSystem.id, scenarioId)
    // Promotion flattens inheritance and invalidates cached simulation
    // results — refreshState pulls the new scenarios + cleared results.
    await get().refreshState()
  },

  revertSlotToBase: async (slot) => {
    const { activeSystem, systemState } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const active = findScenario(systemState, systemState?.active_scenario_id ?? null)
    if (!active || active.is_base) {
      throw new Error('Base scenario slots cannot be reverted — they are the source.')
    }
    await updateDSMScenario(activeSystem.id, active.id, { clear_slots: [slot] })
    await get().refreshState()
  },

  setActiveView: (view) => {
    const { multiScenarioResult, activeSystem, lastRunScenarioIds, lastRunCases } = get()
    if (!multiScenarioResult || !view) {
      set({ activeView: null })
      return
    }
    const key = multiResultKey(
      lastRunScenarioIds.length ? lastRunScenarioIds : [view.scenarioId],
      lastRunCases.length ? lastRunCases : [view.case],
      view.scenarioId, view.case,
    )
    const result = multiScenarioResult.scenarios[key]
    if (!result) return
    set({
      activeView: view,
      simulationResult: result,
      selectedYear:
        result.years[0]?.year ??
        activeSystem?.time_horizon.start_year ??
        null,
    })
  },

  exportResults: async () => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await exportMFAResults(activeSystem.id)
  },

  setSelectedYear: (year) => set({ selectedYear: year }),
  setStackByDimension: (dim) => set({ stackByDimension: dim }),

  downloadTemplate: async (type) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const safeName = activeSystem.name.replace(/\s+/g, '_')
    if (type === 'stock') await downloadStockTemplate(activeSystem.id, safeName)
    else if (type === 'inflows') await downloadInflowTemplate(activeSystem.id, safeName)
    else if (type === 'stock-targets') await downloadStockTargetsTemplate(activeSystem.id, safeName)
    else if (type === 'outflows') await downloadOutflowTemplate(activeSystem.id, safeName)
    else await downloadStockAggregateTemplate(activeSystem.id, safeName)
  },

  fetchCohortMappings: async () => {
    const { activeSystem } = get()
    if (!activeSystem?.id) return
    try {
      const res = await getCohortMappings(activeSystem.id)
      const dict: Record<string, CohortMappingValue> = {}
      for (const m of res.mappings) {
        dict[m.cohort_key] = {
          archetype_id: m.archetype_id,
          scaling_factor: m.scaling_factor ?? 1.0,
        }
      }
      // Patch 4AK³ — normalise hex on read too, in case any backend
      // path (legacy save, manual JSON edit, future reverts) returns
      // mixed case. Idempotent against backend's _normalize_color.
      const normalizedRowColors: Record<string, string> = {}
      for (const [ck, hex] of Object.entries(res.row_colors ?? {})) {
        if (typeof hex === 'string' && hex.length > 0) {
          normalizedRowColors[ck] = normalizeHex(hex)
        }
      }
      set({ cohortMappings: dict, cohortRowColors: normalizedRowColors })
    } catch {
      set({ cohortMappings: {}, cohortRowColors: {} })
    }
  },

  saveCohortMappings: async (mappings, rowColors) => {
    const { activeSystem, cohortRowColors } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const entries: CohortMappingEntry[] = Object.entries(mappings)
      .filter(([, val]) => val?.archetype_id)
      .map(([cohort_key, val]) => ({
        cohort_key,
        archetype_id: val.archetype_id,
        scaling_factor: val.scaling_factor ?? 1.0,
      }))
    // Patch 4AK — preserve existing row colors when the caller doesn't
    // pass them explicitly (cohort mapping autosave during archetype /
    // scale edits shouldn't clobber colors).
    const effectiveRowColors = rowColors ?? cohortRowColors
    await setCohortMappings(activeSystem.id, entries, effectiveRowColors)
    set({
      cohortMappings: { ...mappings },
      cohortRowColors: { ...effectiveRowColors },
    })
  },

  setRowColor: async (cohortKey, color) => {
    const { cohortRowColors, cohortMappings, saveCohortMappings } = get()
    // Patch 4AK³ — canonicalise hex on write. Picker presets emit
    // lowercase already; this guards against any caller passing
    // uppercase or untrimmed strings (Excel-import code paths,
    // future callers).
    const next = { ...cohortRowColors, [cohortKey]: normalizeHex(color) }
    // Sync to backend via the standard save path so Excel round-trip
    // sees the updated state on the next template export.
    await saveCohortMappings(cohortMappings, next)
  },

  clearRowColor: async (cohortKey) => {
    const { cohortRowColors, cohortMappings, saveCohortMappings } = get()
    if (!(cohortKey in cohortRowColors)) return
    const next = { ...cohortRowColors }
    delete next[cohortKey]
    await saveCohortMappings(cohortMappings, next)
  },

  runDSMLCA: async (methods, scope, opts) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    if (!methods || methods.length === 0) throw new Error('At least one method is required')
    set({ isCalculatingLCA: true, error: null })
    try {
      const batch = await runDSMLCA(activeSystem.id, methods, {
        scope,
        yearStart: opts?.yearStart ?? null,
        yearEnd: opts?.yearEnd ?? null,
        parameterSetId: opts?.parameterSetId ?? null,
      })
      set({
        dsmLCAResults: batch.results,
        dsmLCAWarnings: batch.warnings ?? [],
        selectedResultIndex: 0,
        isCalculatingLCA: false,
      })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isCalculatingLCA: false })
      throw e
    }
  },

  selectResultIndex: (i) => set({ selectedResultIndex: i }),

  exportDSMLCAResults: async (year) => {
    const { activeSystem, dsmLCAResults } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    if (dsmLCAResults.length === 0) throw new Error('No results to export')
    const safe = activeSystem.name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'system'
    const scope = dsmLCAResults[0].scope
    await exportDSMLCA(activeSystem.id, `${safe}_impact_${scope}.xlsx`, year ?? null)
  },

  importSimulation: async (file) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    set({ isSimulating: true, error: null })
    try {
      const res = await importMFASimulation(activeSystem.id, file)
      const result = await getMFAResults(activeSystem.id)
      set({
        simulationResult: result,
        isSimulating: false,
        selectedYear: result.years[0]?.year ?? activeSystem.time_horizon.start_year,
      })
      return res
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isSimulating: false })
      throw e
    }
  },

  importSystem: async (file) => {
    set({ isLoading: true, error: null })
    try {
      const created = await importDSMSystem(file)
      const [systems, state, result] = await Promise.all([
        listDSMSystems(),
        getMFAState(created.id ?? ''),
        getMFAResults(created.id ?? '').catch(() => null),
      ])
      const firstNonAge = created.dimensions.find((d) => !d.is_age)
      set({
        systems,
        activeSystem: created,
        systemState: state,
        simulationResult: result,
        multiScenarioResult: null,
        lastRunScenarioIds: [],
        lastRunCases: [],
        activeView: null,
        selectedYear: result?.years[0]?.year ?? created.time_horizon.start_year,
        stackByDimension: firstNonAge?.name ?? null,
        cohortMappings: {}, cohortRowColors: {},
        dsmLCAResults: [],
        dsmLCAWarnings: [],
        selectedResultIndex: 0,
        scalingRules: resolveActiveScalingRules(state),
        isLoading: false,
      })
      return created
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ error: msg, isLoading: false })
      throw e
    }
  },

  calcMaterialFlows: async (scope, yearStart, yearEnd, groupBy, opts) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')

    // Patch 4M — axisConflict guard + routing. Both axes empty / single
    // → single endpoint (legacy path, no scenario fields). Exactly one
    // axis with N>1 → multi endpoint, populate the runs slot, mirror
    // the first run to ``materialFlows`` so the existing single-result
    // rendering keeps working unchanged.
    const dsmIds = opts?.dsmScenarioIds ?? []
    const paramIds = opts?.parameterScenarios ?? []
    if (dsmIds.length > 1 && paramIds.length > 1) {
      throw new Error(
        'Cannot fan out across DSM and parameter axes simultaneously. '
        + 'Pick one axis at a time.',
      )
    }

    set({
      materialFlows: null,
      materialFlowsRuns: [],
      materialFlowAxis: null,
      activeMaterialFlowScenario: null,
      materialFlowLoading: true,
      error: null,
    })
    try {
      const fanOutAxis: 'dsm' | 'parameter' | null =
        dsmIds.length > 1 ? 'dsm'
        : paramIds.length > 1 ? 'parameter'
        : null

      if (fanOutAxis !== null) {
        const env = await apiCalculateMaterialFlowsMulti(activeSystem.id, {
          scope,
          year_start: yearStart,
          year_end: yearEnd,
          group_by: groupBy,
          dsm_scenario_ids: fanOutAxis === 'dsm' ? dsmIds : null,
          parameter_scenarios: fanOutAxis === 'parameter' ? paramIds : null,
        })
        const first = env.runs[0]
        set({
          materialFlows: first?.result ?? null,
          materialFlowsRuns: env.runs,
          materialFlowAxis: env.axis,
          activeMaterialFlowScenario: first?.scenario_id ?? null,
          materialFlowLoading: false,
        })
      } else {
        // Single-result path. When exactly one axis carries one id we
        // still pass it through so the user's selection is honored —
        // they just don't get a tab bar (only one scenario to show).
        const result = await apiCalculateMaterialFlows(activeSystem.id, {
          scope,
          year_start: yearStart,
          year_end: yearEnd,
          group_by: groupBy,
          dsm_scenario_id: dsmIds[0] ?? null,
          parameter_scenario: paramIds[0] ?? null,
        })
        set({ materialFlows: result, materialFlowLoading: false })
      }
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), materialFlowLoading: false })
      throw e
    }
  },

  selectMaterialFlowScenario: (id) => {
    const { materialFlowsRuns } = get()
    const run = materialFlowsRuns.find((r) => r.scenario_id === id)
    set({
      activeMaterialFlowScenario: id,
      // Mirror the picked scenario's result into the legacy slot so
      // the existing rendering code (table, chart) reads the right one
      // without per-component awareness of the multi-axis envelope.
      materialFlows: run?.result ?? get().materialFlows,
    })
  },

  exportMatFlows: async (scope, yearStart, yearEnd) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const safe = activeSystem.name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'system'
    await apiExportMaterialFlows(
      activeSystem.id, scope, yearStart, yearEnd,
      `${safe}_material_flows_${scope}.xlsx`,
    )
  },

  reset: () => set({ ...INITIAL }),
}))

// Re-scope to current bw2 project whenever it changes: clear state and reload.
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  const store = useDSMStore.getState()
  store.reset()
  if (state.currentProject) {
    store.fetchSystems().catch(() => undefined)
  }
})
