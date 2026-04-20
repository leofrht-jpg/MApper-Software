import { create } from 'zustand'
import {
  type AESAComputeResult,
  type AESAConfiguration,
  type AESAConfigurationCreate,
  type AESADefaultsBundle,
  type CarbonBudgetConfig,
  type ImpactAssessmentResult,
  type MethodPBMapping,
  type MultiDConfig,
  computeAESA,
  createAESAConfiguration,
  deleteAESAConfiguration,
  getAESAConfigurations,
  getAESADefaults,
  suggestAESAMethodMapping,
  updateAESAConfiguration,
} from '../api/client'
import { useProjectStore } from './projectStore'

/** Draft shape used by the config sidebar — not yet persisted. */
export interface AESAConfigDraft {
  name: string
  boundary_set_id: string
  multi_d: MultiDConfig
  carbon_budget: CarbonBudgetConfig | null
  method_mapping: MethodPBMapping[]
  impact_mode: 'static' | 'projected'
}

interface AESAStore {
  // Defaults hydrated from /aesa/defaults
  defaults: AESADefaultsBundle | null
  defaultsLoading: boolean

  // Persisted configurations for the current project
  configurations: AESAConfiguration[]
  activeConfigId: string | null

  // Working draft (shown in sidebar), kept in sync with active config when loaded
  draft: AESAConfigDraft | null

  // Compute state
  result: AESAComputeResult | null
  lastRunAt: string | null
  running: boolean
  error: string | null

  // Actions
  loadDefaults: () => Promise<void>
  loadConfigurations: () => Promise<void>
  setActiveConfig: (id: string | null) => void
  setDraft: (d: AESAConfigDraft | null) => void
  updateDraft: (patch: Partial<AESAConfigDraft>) => void
  updateMultiD: (patch: Partial<MultiDConfig>) => void
  updateLayer1: (pbId: string, patch: Partial<MultiDConfig['layer1'][string]>) => void
  updateCarbonBudget: (patch: Partial<CarbonBudgetConfig> | null) => void
  resetDraftToDefaults: () => void
  suggestMapping: (methods: string[][]) => Promise<void>
  saveConfig: (mfaSystemId: string) => Promise<AESAConfiguration | null>
  deleteConfig: (id: string) => Promise<void>
  compute: (args: {
    mfaSystemId: string
    impactTaskId?: string | null
    impactInline?: ImpactAssessmentResult | null
    runSensitivity?: boolean
  }) => Promise<void>
  clearResult: () => void
  reset: () => void
}

function draftFromConfig(c: AESAConfiguration): AESAConfigDraft {
  return {
    name: c.name,
    boundary_set_id: c.boundary_set_id,
    multi_d: c.multi_d,
    carbon_budget: c.carbon_budget,
    method_mapping: c.method_mapping,
    impact_mode: c.impact_mode,
  }
}

function draftFromDefaults(defaults: AESADefaultsBundle): AESAConfigDraft {
  return {
    name: 'New AESA configuration',
    boundary_set_id: defaults.boundary_sets[0]?.id ?? 'Sala2020_EF',
    multi_d: defaults.default_multi_d,
    carbon_budget: defaults.default_carbon_budget,
    method_mapping: [],
    impact_mode: 'static',
  }
}

export const useAESAStore = create<AESAStore>((set, get) => ({
  defaults: null,
  defaultsLoading: false,
  configurations: [],
  activeConfigId: null,
  draft: null,
  result: null,
  lastRunAt: null,
  running: false,
  error: null,

  loadDefaults: async () => {
    if (get().defaults || get().defaultsLoading) return
    set({ defaultsLoading: true })
    try {
      const defaults = await getAESADefaults()
      set({
        defaults,
        defaultsLoading: false,
        draft: get().draft ?? draftFromDefaults(defaults),
      })
    } catch (e) {
      set({ defaultsLoading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  loadConfigurations: async () => {
    try {
      const configs = await getAESAConfigurations()
      set({ configurations: configs })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  setActiveConfig: (id) => {
    const { configurations, defaults } = get()
    const cfg = configurations.find((c) => c.id === id) ?? null
    set({
      activeConfigId: id,
      draft: cfg
        ? draftFromConfig(cfg)
        : defaults
          ? draftFromDefaults(defaults)
          : null,
      result: null,
    })
  },

  setDraft: (d) => set({ draft: d }),
  updateDraft: (patch) => set((s) => ({ draft: s.draft ? { ...s.draft, ...patch } : s.draft })),
  updateMultiD: (patch) => set((s) => {
    if (!s.draft) return {}
    return { draft: { ...s.draft, multi_d: { ...s.draft.multi_d, ...patch } } }
  }),
  updateLayer1: (pbId, patch) => set((s) => {
    if (!s.draft) return {}
    const existing = s.draft.multi_d.layer1[pbId]
    if (!existing) return {}
    return {
      draft: {
        ...s.draft,
        multi_d: {
          ...s.draft.multi_d,
          layer1: { ...s.draft.multi_d.layer1, [pbId]: { ...existing, ...patch } },
        },
      },
    }
  }),
  updateCarbonBudget: (patch) => set((s) => {
    if (!s.draft) return {}
    if (patch === null) return { draft: { ...s.draft, carbon_budget: null } }
    const base = s.draft.carbon_budget ?? s.defaults?.default_carbon_budget
    if (!base) return {}
    return { draft: { ...s.draft, carbon_budget: { ...base, ...patch } } }
  }),

  resetDraftToDefaults: () => set((s) => ({
    draft: s.defaults ? draftFromDefaults(s.defaults) : null,
  })),

  suggestMapping: async (methods) => {
    const { draft } = get()
    if (!draft) return
    try {
      const mapping = await suggestAESAMethodMapping(methods, draft.boundary_set_id)
      set({ draft: { ...draft, method_mapping: mapping } })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  saveConfig: async (mfaSystemId) => {
    const { draft, activeConfigId } = get()
    if (!draft) return null
    const body: AESAConfigurationCreate = {
      name: draft.name,
      mfa_system_id: mfaSystemId,
      impact_mode: draft.impact_mode,
      boundary_set_id: draft.boundary_set_id,
      multi_d: draft.multi_d,
      carbon_budget: draft.carbon_budget,
      method_mapping: draft.method_mapping,
    }
    try {
      const saved = activeConfigId
        ? await updateAESAConfiguration(activeConfigId, body)
        : await createAESAConfiguration(body)
      set((s) => {
        const others = s.configurations.filter((c) => c.id !== saved.id)
        return {
          configurations: [saved, ...others],
          activeConfigId: saved.id,
        }
      })
      return saved
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  deleteConfig: async (id) => {
    try {
      await deleteAESAConfiguration(id)
      set((s) => ({
        configurations: s.configurations.filter((c) => c.id !== id),
        activeConfigId: s.activeConfigId === id ? null : s.activeConfigId,
        result: s.activeConfigId === id ? null : s.result,
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  compute: async ({ mfaSystemId, impactTaskId, impactInline, runSensitivity }) => {
    const { draft } = get()
    if (!draft) {
      set({ error: 'No configuration loaded' })
      return
    }
    set({ running: true, error: null })
    try {
      const inlineConfig: AESAConfiguration = {
        id: get().activeConfigId ?? 'draft',
        name: draft.name,
        mfa_system_id: mfaSystemId,
        impact_mode: draft.impact_mode,
        boundary_set_id: draft.boundary_set_id,
        multi_d: draft.multi_d,
        carbon_budget: draft.carbon_budget,
        method_mapping: draft.method_mapping,
        created_at: new Date().toISOString(),
      }
      const result = await computeAESA({
        config: inlineConfig,
        impact_task_id: impactTaskId ?? null,
        impact_result: impactInline ?? null,
        run_sensitivity: !!runSensitivity,
      })
      set({ result, running: false, lastRunAt: new Date().toISOString() })
    } catch (e) {
      set({ running: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  clearResult: () => set({ result: null, lastRunAt: null }),

  reset: () => set({
    configurations: [],
    activeConfigId: null,
    draft: null,
    result: null,
    lastRunAt: null,
    running: false,
    error: null,
  }),
}))

let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useAESAStore.getState().reset()
})
