import { create } from 'zustand'
import { useProjectStore } from './projectStore'
import {
  type CohortMappingEntry,
  type MFALCAResult,
  type MFASystemState,
  type SimulationResult,
  type SurvivalConfig,
  type SystemDefinition,
  type SystemSummary,
  type SystemUpdateResponse,
  type MaterialFlowResult,
  calculateMaterialFlows as apiCalculateMaterialFlows,
  exportMaterialFlows as apiExportMaterialFlows,
  createMFASystem,
  deleteMFASystem,
  downloadInflowTemplate,
  downloadStockTemplate,
  exportMFALCA,
  exportMFAResults,
  getCohortMappings,
  getMFAResults,
  getMFAState,
  getMFASystem,
  importMFASimulation,
  importMFASystem,
  listMFASystems,
  runMFALCA,
  setCohortMappings,
  setSurvivalConfigs,
  simulateMFA,
  updateMFASystem,
  uploadInflows,
  uploadStock,
} from '../api/client'

export interface CohortMappingValue {
  archetype_id: string
  scaling_factor: number
}

interface MFAStore {
  systems: SystemSummary[]
  activeSystem: SystemDefinition | null
  systemState: MFASystemState | null
  simulationResult: SimulationResult | null
  selectedYear: number | null
  stackByDimension: string | null
  cohortMappings: Record<string, CohortMappingValue>
  mfaLCAResults: MFALCAResult[]
  selectedResultIndex: number
  isLoading: boolean
  isSimulating: boolean
  isCalculatingLCA: boolean
  materialFlows: MaterialFlowResult | null
  materialFlowLoading: boolean
  error: string | null

  fetchSystems: () => Promise<void>
  createSystem: (def: Omit<SystemDefinition, 'id' | 'created_at'>) => Promise<SystemDefinition>
  updateSystem: (def: SystemDefinition) => Promise<SystemUpdateResponse>
  selectSystem: (id: string) => Promise<void>
  removeSystem: (id: string) => Promise<void>
  refreshState: () => Promise<void>
  uploadStock: (file: File) => Promise<void>
  uploadInflows: (file: File) => Promise<void>
  setSurvival: (configs: SurvivalConfig[]) => Promise<void>
  simulate: () => Promise<void>
  exportResults: () => Promise<void>
  setSelectedYear: (year: number) => void
  setStackByDimension: (dim: string) => void
  downloadTemplate: (type: 'stock' | 'inflows') => Promise<void>
  fetchCohortMappings: () => Promise<void>
  saveCohortMappings: (mappings: Record<string, CohortMappingValue>) => Promise<void>
  runMFALCA: (
    methods: string[][],
    scope: 'inflows' | 'outflows' | 'stock' | 'all',
    opts?: { yearStart?: number | null; yearEnd?: number | null },
  ) => Promise<void>
  selectResultIndex: (i: number) => void
  exportMFALCAResults: (year?: number | null) => Promise<void>
  importSimulation: (file: File) => Promise<{ years_imported: number; cohorts_found: number; warnings: string[] }>
  importSystem: (file: File) => Promise<SystemDefinition>
  calcMaterialFlows: (scope: string, yearStart: number | null, yearEnd: number | null, groupBy: string) => Promise<void>
  exportMatFlows: (scope: string, yearStart: number | null, yearEnd: number | null) => Promise<void>
  reset: () => void
}

export const useMFAStore = create<MFAStore>((set, get) => ({
  systems: [],
  activeSystem: null,
  systemState: null,
  simulationResult: null,
  selectedYear: null,
  stackByDimension: null,
  cohortMappings: {},
  mfaLCAResults: [],
  selectedResultIndex: 0,
  isLoading: false,
  isSimulating: false,
  isCalculatingLCA: false,
  materialFlows: null,
  materialFlowLoading: false,
  error: null,

  fetchSystems: async () => {
    set({ isLoading: true, error: null })
    try {
      const systems = await listMFASystems()
      set({ systems, isLoading: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
    }
  },

  createSystem: async (def) => {
    set({ isLoading: true, error: null })
    try {
      const created = await createMFASystem(def)
      const systems = await listMFASystems()
      const firstNonAge = created.dimensions.find((d) => !d.is_age)
      set({
        systems,
        activeSystem: created,
        systemState: { system_id: created.id ?? '', survival_configs: [], initial_stock: {}, inflows: [] },
        simulationResult: null,
        selectedYear: created.time_horizon.start_year,
        stackByDimension: firstNonAge?.name ?? null,
        cohortMappings: {},
        mfaLCAResults: [],
        selectedResultIndex: 0,
        materialFlows: null,
        materialFlowLoading: false,
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
      const res = await updateMFASystem(def.id, def)
      const [state, systems] = await Promise.all([getMFAState(def.id), listMFASystems()])
      const firstNonAge = res.system.dimensions.find((d) => !d.is_age)
      set({
        systems,
        activeSystem: res.system,
        systemState: state,
        simulationResult: null,
        selectedYear: res.system.time_horizon.start_year,
        stackByDimension: firstNonAge?.name ?? null,
        mfaLCAResults: [],
        selectedResultIndex: 0,
        materialFlows: null,
        materialFlowLoading: false,
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
      const [sys, state] = await Promise.all([getMFASystem(id), getMFAState(id)])
      const firstNonAge = sys.dimensions.find((d) => !d.is_age)
      set({
        activeSystem: sys,
        systemState: state,
        simulationResult: null,
        selectedYear: sys.time_horizon.start_year,
        stackByDimension: firstNonAge?.name ?? null,
        cohortMappings: {},
        mfaLCAResults: [],
        selectedResultIndex: 0,
        materialFlows: null,
        materialFlowLoading: false,
        isLoading: false,
      })
      // Refresh mappings for this system asynchronously.
      get().fetchCohortMappings().catch(() => undefined)
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
    }
  },

  removeSystem: async (id) => {
    await deleteMFASystem(id)
    const { activeSystem } = get()
    const systems = await listMFASystems()
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
    set({ systemState: state })
  },

  uploadStock: async (file) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await uploadStock(activeSystem.id, file)
    await get().refreshState()
  },

  uploadInflows: async (file) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await uploadInflows(activeSystem.id, file)
    await get().refreshState()
  },

  setSurvival: async (configs) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    await setSurvivalConfigs(activeSystem.id, configs)
    await get().refreshState()
  },

  simulate: async () => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    set({ isSimulating: true, error: null })
    try {
      const result = await simulateMFA(activeSystem.id)
      set({
        simulationResult: result,
        isSimulating: false,
        selectedYear: result.years[0]?.year ?? activeSystem.time_horizon.start_year,
      })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isSimulating: false })
      throw e
    }
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
    else await downloadInflowTemplate(activeSystem.id, safeName)
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
      set({ cohortMappings: dict })
    } catch {
      set({ cohortMappings: {} })
    }
  },

  saveCohortMappings: async (mappings) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    const entries: CohortMappingEntry[] = Object.entries(mappings)
      .filter(([, val]) => val?.archetype_id)
      .map(([cohort_key, val]) => ({
        cohort_key,
        archetype_id: val.archetype_id,
        scaling_factor: val.scaling_factor ?? 1.0,
      }))
    await setCohortMappings(activeSystem.id, entries)
    set({ cohortMappings: { ...mappings } })
  },

  runMFALCA: async (methods, scope, opts) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    if (!methods || methods.length === 0) throw new Error('At least one method is required')
    set({ isCalculatingLCA: true, error: null })
    try {
      const batch = await runMFALCA(activeSystem.id, methods, {
        scope,
        yearStart: opts?.yearStart ?? null,
        yearEnd: opts?.yearEnd ?? null,
      })
      set({
        mfaLCAResults: batch.results,
        selectedResultIndex: 0,
        isCalculatingLCA: false,
      })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isCalculatingLCA: false })
      throw e
    }
  },

  selectResultIndex: (i) => set({ selectedResultIndex: i }),

  exportMFALCAResults: async (year) => {
    const { activeSystem, mfaLCAResults } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    if (mfaLCAResults.length === 0) throw new Error('No results to export')
    const safe = activeSystem.name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'system'
    const scope = mfaLCAResults[0].scope
    await exportMFALCA(activeSystem.id, `${safe}_impact_${scope}.xlsx`, year ?? null)
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
      const created = await importMFASystem(file)
      const [systems, state, result] = await Promise.all([
        listMFASystems(),
        getMFAState(created.id ?? ''),
        getMFAResults(created.id ?? '').catch(() => null),
      ])
      const firstNonAge = created.dimensions.find((d) => !d.is_age)
      set({
        systems,
        activeSystem: created,
        systemState: state,
        simulationResult: result,
        selectedYear: result?.years[0]?.year ?? created.time_horizon.start_year,
        stackByDimension: firstNonAge?.name ?? null,
        cohortMappings: {},
        mfaLCAResults: [],
        selectedResultIndex: 0,
        isLoading: false,
      })
      return created
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ error: msg, isLoading: false })
      throw e
    }
  },

  calcMaterialFlows: async (scope, yearStart, yearEnd, groupBy) => {
    const { activeSystem } = get()
    if (!activeSystem?.id) throw new Error('No active system')
    set({ materialFlows: null, materialFlowLoading: true, error: null })
    try {
      const result = await apiCalculateMaterialFlows(activeSystem.id, {
        scope,
        year_start: yearStart,
        year_end: yearEnd,
        group_by: groupBy,
      })
      set({ materialFlows: result, materialFlowLoading: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), materialFlowLoading: false })
      throw e
    }
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

  reset: () => set({
    systems: [],
    activeSystem: null,
    systemState: null,
    simulationResult: null,
    selectedYear: null,
    stackByDimension: null,
    cohortMappings: {},
    mfaLCAResults: [],
    selectedResultIndex: 0,
    materialFlows: null,
    materialFlowLoading: false,
    error: null,
  }),
}))

// Re-scope to current bw2 project whenever it changes: clear state and reload.
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  const store = useMFAStore.getState()
  store.reset()
  if (state.currentProject) {
    store.fetchSystems().catch(() => undefined)
  }
})
