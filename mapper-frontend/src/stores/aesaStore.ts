import { create } from 'zustand'
import {
  type AESAConfiguration,
  type AESAConfigurationCreate,
  type AESAResult,
  type ImpactAssessmentResult,
  assessAESA,
  createAESAConfiguration,
  deleteAESAConfiguration,
  getAESAConfigurations,
  updateAESAConfiguration,
} from '../api/client'
import { useProjectStore } from './projectStore'

interface AESAStore {
  configurations: AESAConfiguration[]
  activeConfigId: string | null
  result: AESAResult | null
  loading: boolean
  assessing: boolean
  error: string | null

  loadConfigurations: () => Promise<void>
  createConfig: (body: AESAConfigurationCreate) => Promise<AESAConfiguration>
  updateConfig: (id: string, body: AESAConfigurationCreate) => Promise<AESAConfiguration>
  deleteConfig: (id: string) => Promise<void>
  setActiveConfig: (id: string | null) => void
  assess: (args: { configId: string; taskId?: string | null; inline?: ImpactAssessmentResult | null }) => Promise<void>
  clearResult: () => void
  reset: () => void
}

export const useAESAStore = create<AESAStore>((set, get) => ({
  configurations: [],
  activeConfigId: null,
  result: null,
  loading: false,
  assessing: false,
  error: null,

  loadConfigurations: async () => {
    set({ loading: true, error: null })
    try {
      const configs = await getAESAConfigurations()
      set({ configurations: configs, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  createConfig: async (body) => {
    const created = await createAESAConfiguration(body)
    set((s) => ({ configurations: [created, ...s.configurations], activeConfigId: created.id }))
    return created
  },

  updateConfig: async (id, body) => {
    const updated = await updateAESAConfiguration(id, body)
    set((s) => ({
      configurations: s.configurations.map((c) => (c.id === id ? updated : c)),
    }))
    return updated
  },

  deleteConfig: async (id) => {
    await deleteAESAConfiguration(id)
    set((s) => ({
      configurations: s.configurations.filter((c) => c.id !== id),
      activeConfigId: s.activeConfigId === id ? null : s.activeConfigId,
      result: s.activeConfigId === id ? null : s.result,
    }))
  },

  setActiveConfig: (id) => set({ activeConfigId: id, result: null }),

  assess: async ({ configId, taskId, inline }) => {
    set({ assessing: true, error: null })
    try {
      const result = await assessAESA({
        config_id: configId,
        impact_task_id: taskId ?? null,
        impact_result: inline ?? null,
      })
      set({ result, assessing: false, activeConfigId: configId })
    } catch (e) {
      set({ assessing: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  clearResult: () => set({ result: null }),

  reset: () => set({
    configurations: [],
    activeConfigId: null,
    result: null,
    loading: false,
    assessing: false,
    error: null,
  }),
}))

let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useAESAStore.getState().reset()
})
