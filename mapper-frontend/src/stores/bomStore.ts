import { create } from 'zustand'
import { useProjectStore } from './projectStore'
import {
  type Archetype,
  type ArchetypeLCAResult,
  type ArchetypeSummary,
  type ArchetypeTimeline,
  type BOMNode,
  type EcoinventLink,
  type FlattenedBOM,
  type MaterialEvolution,
  type MultiImportResult,
  type QuantityMilestone,
  addBOMNode,
  applyLearningRate as apiApplyLearningRate,
  applyMilestones as apiApplyMilestones,
  applyReboundEffect as apiApplyReboundEffect,
  createArchetype,
  createFolder as apiCreateFolder,
  deleteArchetype,
  deleteBOMNode,
  deleteFolder as apiDeleteFolder,
  exportArchetype,
  fetchArchetypeTimeline,
  flattenArchetype,
  getArchetype,
  importArchetype,
  listArchetypes,
  listFolders,
  moveArchetype as apiMoveArchetype,
  renameFolder as apiRenameFolder,
  runArchetypeLCA,
  updateArchetype,
  updateBOMNode,
} from '../api/client'

interface BOMStore {
  archetypes: ArchetypeSummary[]
  folders: string[]
  active: Archetype | null
  flattened: FlattenedBOM | null
  flattenYear: number | null
  timeline: ArchetypeTimeline | null
  standaloneLCA: ArchetypeLCAResult | null
  isLoading: boolean
  isSaving: boolean
  error: string | null

  fetchArchetypes: () => Promise<void>
  fetchFolders: () => Promise<void>
  selectArchetype: (id: string) => Promise<void>
  createNew: (data: { name: string; description?: string | null; category?: string | null; folder?: string | null; bom: BOMNode[] }) => Promise<Archetype>
  saveActive: (data: { name: string; description?: string | null; category?: string | null; folder?: string | null; bom: BOMNode[] }) => Promise<void>
  removeArchetype: (id: string) => Promise<void>

  addNode: (parentId: string | null, node: BOMNode) => Promise<void>
  addRootStage: (name: string) => Promise<void>
  patchNode: (nodeId: string, patch: { name?: string; quantity?: number; unit?: string; is_annual?: boolean; ecoinvent_activity?: EcoinventLink | null; evolution?: MaterialEvolution | null }) => Promise<void>
  removeNode: (nodeId: string) => Promise<void>

  flatten: (year?: number | null) => Promise<void>
  setFlattenYear: (year: number | null) => Promise<void>
  runLCA: (method: string[], amount?: number) => Promise<void>

  fetchTimeline: (years: number[]) => Promise<ArchetypeTimeline | null>
  applyLearningRateToAll: (learningRate: number | null, baseYear: number, nodeIds?: string[] | null) => Promise<void>
  applyReboundEffectToAll: (reboundRate: number | null, baseYear: number, nodeIds?: string[] | null, appliesToStages?: string[] | null) => Promise<void>
  setMilestones: (nodeId: string, milestones: QuantityMilestone[]) => Promise<void>

  exportActive: () => Promise<void>
  importFromFile: (file: File) => Promise<MultiImportResult>

  createFolder: (path: string) => Promise<void>
  renameFolder: (oldPath: string, newPath: string) => Promise<void>
  deleteFolder: (path: string, deleteArchetypes?: boolean) => Promise<void>
  moveArchetype: (archetypeId: string, newFolder: string | null) => Promise<void>

  clear: () => void
}

export const useBOMStore = create<BOMStore>((set, get) => ({
  archetypes: [],
  folders: [],
  active: null,
  flattened: null,
  flattenYear: null,
  timeline: null,
  standaloneLCA: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchArchetypes: async () => {
    set({ isLoading: true, error: null })
    try {
      const [list, folders] = await Promise.all([listArchetypes(), listFolders()])
      set({ archetypes: list, folders, isLoading: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
    }
  },

  fetchFolders: async () => {
    try {
      const folders = await listFolders()
      set({ folders })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  selectArchetype: async (id) => {
    set({ isLoading: true, error: null, standaloneLCA: null, flattened: null })
    try {
      const arc = await getArchetype(id)
      set({ active: arc, isLoading: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
    }
  },

  createNew: async (data) => {
    set({ isSaving: true, error: null })
    try {
      const arc = await createArchetype(data)
      const list = await listArchetypes()
      set({ active: arc, archetypes: list, isSaving: false, standaloneLCA: null, flattened: null })
      return arc
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isSaving: false })
      throw e
    }
  },

  saveActive: async (data) => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    set({ isSaving: true, error: null })
    try {
      const arc = await updateArchetype(active.id, data)
      const list = await listArchetypes()
      set({ active: arc, archetypes: list, isSaving: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isSaving: false })
      throw e
    }
  },

  removeArchetype: async (id) => {
    await deleteArchetype(id)
    const list = await listArchetypes()
    const { active } = get()
    set({
      archetypes: list,
      active: active?.id === id ? null : active,
      flattened: active?.id === id ? null : get().flattened,
      standaloneLCA: active?.id === id ? null : get().standaloneLCA,
    })
  },

  addNode: async (parentId, node) => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    const updated = await addBOMNode(active.id, parentId, node)
    set({ active: updated, flattened: null, standaloneLCA: null })
  },

  addRootStage: async (name) => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    const updated = await addBOMNode(active.id, null, {
      name,
      node_type: 'component',
      quantity: 1,
      unit: 'piece',
      children: [],
    })
    const list = await listArchetypes()
    set({ active: updated, archetypes: list, flattened: null, standaloneLCA: null })
  },

  patchNode: async (nodeId, patch) => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    await updateBOMNode(active.id, nodeId, patch)
    const refreshed = await getArchetype(active.id)
    set({ active: refreshed, flattened: null, standaloneLCA: null })
  },

  removeNode: async (nodeId) => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    const updated = await deleteBOMNode(active.id, nodeId)
    set({ active: updated, flattened: null, standaloneLCA: null })
  },

  flatten: async (year = null) => {
    const { active } = get()
    if (!active?.id) return
    const f = await flattenArchetype(active.id, year)
    set({ flattened: f, flattenYear: year })
  },

  setFlattenYear: async (year) => {
    const { active } = get()
    if (!active?.id) { set({ flattenYear: year }); return }
    const f = await flattenArchetype(active.id, year)
    set({ flattened: f, flattenYear: year })
  },

  fetchTimeline: async (years) => {
    const { active } = get()
    if (!active?.id) return null
    const t = await fetchArchetypeTimeline(active.id, { years })
    set({ timeline: t })
    return t
  },

  applyLearningRateToAll: async (learningRate, baseYear, nodeIds = null) => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    const arc = await apiApplyLearningRate(active.id, {
      node_ids: nodeIds,
      learning_rate: learningRate,
      base_year: baseYear,
      reset: learningRate === null,
    })
    const list = await listArchetypes()
    set({ active: arc, archetypes: list, flattened: null, timeline: null })
  },

  applyReboundEffectToAll: async (reboundRate, baseYear, nodeIds = null, appliesToStages = null) => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    const arc = await apiApplyReboundEffect(active.id, {
      node_ids: nodeIds,
      rebound_rate: reboundRate,
      base_year: baseYear,
      applies_to_stages: appliesToStages,
      reset: reboundRate === null,
    })
    const list = await listArchetypes()
    set({ active: arc, archetypes: list, flattened: null, timeline: null })
  },

  setMilestones: async (nodeId, milestones) => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    await apiApplyMilestones(active.id, nodeId, milestones)
    const refreshed = await getArchetype(active.id)
    set({ active: refreshed, flattened: null, timeline: null })
  },

  runLCA: async (method, amount = 1) => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    set({ isSaving: true, error: null })
    try {
      const res = await runArchetypeLCA(active.id, method, amount)
      set({ standaloneLCA: res, isSaving: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isSaving: false })
      throw e
    }
  },

  exportActive: async () => {
    const { active } = get()
    if (!active?.id) throw new Error('No active archetype')
    await exportArchetype(active.id, active.name)
  },

  importFromFile: async (file) => {
    set({ isSaving: true, error: null })
    try {
      const res = await importArchetype(file)
      const [list, folders] = await Promise.all([listArchetypes(), listFolders()])
      // Select the first imported archetype (if any) so the BOM editor opens with fresh content.
      const firstId = res.archetypes[0]?.id
      const arc = firstId ? await getArchetype(firstId) : null
      set({
        active: arc,
        archetypes: list,
        folders,
        isSaving: false,
        flattened: null,
        standaloneLCA: null,
      })
      return res
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isSaving: false })
      throw e
    }
  },

  createFolder: async (path) => {
    const res = await apiCreateFolder(path)
    set({ folders: res.folders })
  },

  renameFolder: async (oldPath, newPath) => {
    const res = await apiRenameFolder(oldPath, newPath)
    const [list, active] = await Promise.all([
      listArchetypes(),
      get().active?.id ? getArchetype(get().active!.id!) : Promise.resolve(get().active),
    ])
    set({ folders: res.folders, archetypes: list, active: active ?? null })
  },

  deleteFolder: async (path, deleteArchetypes = false) => {
    const res = await apiDeleteFolder(path, deleteArchetypes)
    const list = await listArchetypes()
    const { active } = get()
    // If the active archetype was deleted or moved, refresh or clear it.
    let refreshedActive: Archetype | null = active
    if (active?.id) {
      const stillExists = list.some((a) => a.id === active.id)
      refreshedActive = stillExists ? await getArchetype(active.id) : null
    }
    set({ folders: res.folders, archetypes: list, active: refreshedActive })
  },

  moveArchetype: async (archetypeId, newFolder) => {
    const arc = await apiMoveArchetype(archetypeId, newFolder)
    const [list, folders] = await Promise.all([listArchetypes(), listFolders()])
    const { active } = get()
    set({
      archetypes: list,
      folders,
      active: active?.id === archetypeId ? arc : active,
    })
  },

  clear: () => set({ archetypes: [], folders: [], active: null, flattened: null, flattenYear: null, timeline: null, standaloneLCA: null, error: null }),
}))

// Re-scope to current bw2 project whenever it changes: clear state and reload.
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  const store = useBOMStore.getState()
  store.clear()
  if (state.currentProject) {
    store.fetchArchetypes().catch(() => undefined)
  }
})
