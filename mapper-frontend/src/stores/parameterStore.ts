import { create } from 'zustand'
import {
  BASE_SCENARIO,
  createScenario as apiCreateScenario,
  deleteScenario as apiDeleteScenario,
  downloadParameterTemplate,
  exportParameterTable,
  getParameterTable,
  importParameterTable,
  renameScenario as apiRenameScenario,
  resolveParameterValue,
  updateParameterTable,
  type Parameter,
  type ParameterSet,
  type ParameterSetSummary,
  type ParameterTable,
} from '../api/client'
import { useProjectStore } from './projectStore'

const ACTIVE_SCENARIO_KEY = 'mapper.active-scenario'
const SELECTED_SCENARIOS_KEY = 'mapper.selected-scenarios'
const SAVE_DEBOUNCE_MS = 400

/** Minimal draft shape for the multi-column editor — the UI mutates a copy of
 *  this and the store flushes it back to the server through updateTable. */
interface ParameterStore {
  table: ParameterTable | null
  /** The scenario currently shown as the "active" column elsewhere in the app
   *  (BOMTree, DependencyRulesEditor, legacy DSM/impact panels). Always one
   *  of ``table.list_scenarios()`` — ``"Base"`` when no table is loaded. */
  activeScenario: string
  /** Multi-select set used by Impact Assessment to sweep scenarios. */
  selectedScenarios: string[]
  isLoading: boolean
  isSaving: boolean
  error: string | null

  // ── Core table actions ──────────────────────────────────────────────────
  fetchTable: () => Promise<void>
  setParameters: (params: Record<string, Parameter>) => void
  setScenarios: (scenarios: string[]) => void
  setCategories: (categories: string[]) => void
  addCategory: (name: string) => void
  removeCategory: (name: string) => void
  renameCategory: (oldName: string, newName: string) => void
  upsertParameter: (p: Parameter) => void
  removeParameter: (name: string) => void
  patchOverride: (paramName: string, scenario: string, value: number | null) => void
  flushPendingSave: () => Promise<void>

  // ── Scenario management ─────────────────────────────────────────────────
  addScenario: (name: string, copyFrom?: string | null) => Promise<void>
  removeScenario: (name: string) => Promise<void>
  renameScenario: (oldName: string, newName: string) => Promise<void>
  setActiveScenario: (name: string) => void
  toggleSelectedScenario: (name: string, on: boolean) => void

  // ── Excel + template ────────────────────────────────────────────────────
  importFile: (file: File, mode?: 'replace' | 'merge') => Promise<void>
  exportFile: () => Promise<void>
  downloadTemplate: () => Promise<void>

  clear: () => void

  // ── Legacy shims (keep BOMTree/DependencyRulesEditor/ProjectedImpactPanel
  // and DSMImpactPanel working unchanged; these are computed from ``table``). ─
  sets: ParameterSetSummary[]
  activeSetId: string | null
  activeSet: ParameterSet | null
  fetchSets: () => Promise<void>
  selectSet: (id: string | null) => Promise<void>
}

/** Map the JSON ``ParameterTable`` into the legacy ``ParameterSet`` the rest
 *  of the app reads. ``scenario`` selects which column is exposed as the
 *  active set; ``"Base"`` returns base values untouched. */
function synthesizeSet(table: ParameterTable, scenario: string): ParameterSet {
  const paramsArr = Object.values(table.parameters).map((p) => {
    const v = resolveParameterValue(p, scenario)
    return {
      ...p,
      // Populate the legacy ``value`` alias so ``p.value`` keeps reading the
      // right number in BOMTree, DependencyRulesEditor, and tests.
      value: v,
      base_value: p.base_value,
    }
  })
  return {
    id: scenario,
    name: scenario,
    parameters: paramsArr,
    created_at: table.created_at,
    updated_at: table.updated_at,
  }
}

function listScenarios(table: ParameterTable | null): string[] {
  return [BASE_SCENARIO, ...(table?.scenarios ?? [])]
}

function synthesizeSummaries(table: ParameterTable | null): ParameterSetSummary[] {
  if (!table) return []
  const categories = Array.from(new Set([
    ...(table.categories ?? []),
    ...Object.values(table.parameters)
      .map((p) => p.category)
      .filter((c): c is string => !!c),
  ])).sort()
  return listScenarios(table).map((s) => ({
    id: s,
    name: s,
    parameter_count: Object.keys(table.parameters).length,
    categories,
    created_at: table.created_at ?? '',
    updated_at: table.updated_at ?? '',
  }))
}

function loadPersistedScenarios(available: string[]): string[] {
  try {
    const raw = localStorage.getItem(SELECTED_SCENARIOS_KEY)
    if (!raw) return [BASE_SCENARIO]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [BASE_SCENARIO]
    const filtered = parsed.filter((s): s is string => typeof s === 'string' && available.includes(s))
    if (!filtered.includes(BASE_SCENARIO)) filtered.unshift(BASE_SCENARIO)
    return filtered
  } catch {
    return [BASE_SCENARIO]
  }
}

export const useParameterStore = create<ParameterStore>((set, get) => {
  let saveTimer: number | null = null

  const scheduleSave = () => {
    if (saveTimer != null) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      saveTimer = null
      void doSave()
    }, SAVE_DEBOUNCE_MS)
  }

  const doSave = async () => {
    const { table } = get()
    if (!table) return
    set({ isSaving: true, error: null })
    try {
      const updated = await updateParameterTable({
        parameters: table.parameters,
        scenarios: table.scenarios,
        categories: table.categories ?? [],
      })
      set({ table: updated, isSaving: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isSaving: false })
    }
  }

  const applyTable = (table: ParameterTable, { persistSelected = false } = {}) => {
    const scenarios = listScenarios(table)
    const { activeScenario, selectedScenarios } = get()
    const nextActive = scenarios.includes(activeScenario) ? activeScenario : BASE_SCENARIO
    const nextSelected = persistSelected
      ? selectedScenarios.filter((s) => scenarios.includes(s))
      : loadPersistedScenarios(scenarios)
    if (!nextSelected.includes(BASE_SCENARIO)) nextSelected.unshift(BASE_SCENARIO)
    set({
      table,
      activeScenario: nextActive,
      selectedScenarios: nextSelected,
      sets: synthesizeSummaries(table),
      activeSetId: nextActive,
      activeSet: synthesizeSet(table, nextActive),
    })
  }

  return {
    table: null,
    activeScenario: BASE_SCENARIO,
    selectedScenarios: [BASE_SCENARIO],
    isLoading: false,
    isSaving: false,
    error: null,

    // ── Core ───────────────────────────────────────────────────────────────
    fetchTable: async () => {
      set({ isLoading: true, error: null })
      try {
        const table = await getParameterTable()
        applyTable(table)
        set({ isLoading: false })
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
      }
    },

    setParameters: (params) => {
      const { table } = get()
      if (!table) return
      const next: ParameterTable = { ...table, parameters: params }
      applyTable(next, { persistSelected: true })
      scheduleSave()
    },

    setScenarios: (scenarios) => {
      const { table } = get()
      if (!table) return
      const next: ParameterTable = { ...table, scenarios }
      applyTable(next, { persistSelected: true })
      scheduleSave()
    },

    setCategories: (categories) => {
      const { table } = get()
      if (!table) return
      const seen = new Set<string>()
      const norm: string[] = []
      for (const c of categories) {
        const t = (c ?? '').trim()
        if (t && !seen.has(t)) {
          seen.add(t)
          norm.push(t)
        }
      }
      const next: ParameterTable = { ...table, categories: norm }
      applyTable(next, { persistSelected: true })
      scheduleSave()
    },

    addCategory: (name) => {
      const { table } = get()
      if (!table) return
      const trimmed = (name ?? '').trim()
      if (!trimmed) return
      const current = table.categories ?? []
      if (current.includes(trimmed)) return
      get().setCategories([...current, trimmed])
    },

    removeCategory: (name) => {
      const { table } = get()
      if (!table) return
      const current = table.categories ?? []
      if (!current.includes(name)) return
      get().setCategories(current.filter((c) => c !== name))
    },

    renameCategory: (oldName, newName) => {
      const { table } = get()
      if (!table) return
      const trimmed = (newName ?? '').trim()
      if (!trimmed || oldName === trimmed) return
      const current = table.categories ?? []
      const renamed = current.map((c) => (c === oldName ? trimmed : c))
      get().setCategories(renamed)
    },

    upsertParameter: (p) => {
      const { table } = get()
      if (!table) return
      const next = { ...table.parameters, [p.name]: p }
      get().setParameters(next)
    },

    removeParameter: (name) => {
      const { table } = get()
      if (!table) return
      const next = { ...table.parameters }
      delete next[name]
      get().setParameters(next)
    },

    patchOverride: (paramName, scenario, value) => {
      const { table } = get()
      if (!table) return
      const p = table.parameters[paramName]
      if (!p) return
      const nextOverrides = { ...(p.scenario_overrides ?? {}) }
      if (value === null || value === undefined || Number.isNaN(value)) {
        delete nextOverrides[scenario]
      } else {
        nextOverrides[scenario] = value
      }
      get().upsertParameter({ ...p, scenario_overrides: nextOverrides })
    },

    flushPendingSave: async () => {
      if (saveTimer != null) {
        window.clearTimeout(saveTimer)
        saveTimer = null
        await doSave()
      }
    },

    // ── Scenario management ────────────────────────────────────────────────
    addScenario: async (name, copyFrom = null) => {
      await get().flushPendingSave()
      try {
        const table = await apiCreateScenario({ name, copy_from: copyFrom })
        applyTable(table, { persistSelected: true })
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : String(e) })
        throw e
      }
    },

    removeScenario: async (name) => {
      await get().flushPendingSave()
      try {
        const table = await apiDeleteScenario(name)
        applyTable(table, { persistSelected: true })
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : String(e) })
        throw e
      }
    },

    renameScenario: async (oldName, newName) => {
      await get().flushPendingSave()
      try {
        const table = await apiRenameScenario({ old_name: oldName, new_name: newName })
        applyTable(table, { persistSelected: true })
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : String(e) })
        throw e
      }
    },

    setActiveScenario: (name) => {
      const { table } = get()
      if (!table) return
      const scenarios = listScenarios(table)
      if (!scenarios.includes(name)) return
      set({
        activeScenario: name,
        activeSetId: name,
        activeSet: synthesizeSet(table, name),
      })
      try { localStorage.setItem(ACTIVE_SCENARIO_KEY, name) } catch { /* ignore */ }
    },

    toggleSelectedScenario: (name, on) => {
      const { selectedScenarios, table } = get()
      if (!table) return
      let next = selectedScenarios.slice()
      if (on && !next.includes(name)) next.push(name)
      if (!on) next = next.filter((s) => s !== name)
      // Base is always selected.
      if (!next.includes(BASE_SCENARIO)) next.unshift(BASE_SCENARIO)
      // Preserve order: Base first, then table scenarios in their declared order.
      const order = listScenarios(table)
      next.sort((a, b) => order.indexOf(a) - order.indexOf(b))
      set({ selectedScenarios: next })
      try { localStorage.setItem(SELECTED_SCENARIOS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    },

    // ── Excel ──────────────────────────────────────────────────────────────
    importFile: async (file, mode = 'replace') => {
      await get().flushPendingSave()
      const table = await importParameterTable(file, mode)
      applyTable(table, { persistSelected: true })
    },

    exportFile: async () => {
      await exportParameterTable()
    },

    downloadTemplate: async () => {
      await downloadParameterTemplate()
    },

    clear: () => {
      if (saveTimer != null) {
        window.clearTimeout(saveTimer)
        saveTimer = null
      }
      set({
        table: null,
        activeScenario: BASE_SCENARIO,
        selectedScenarios: [BASE_SCENARIO],
        error: null,
        sets: [],
        activeSetId: null,
        activeSet: null,
      })
    },

    // ── Legacy shims ───────────────────────────────────────────────────────
    sets: [],
    activeSetId: null,
    activeSet: null,

    fetchSets: async () => {
      await get().fetchTable()
    },

    selectSet: async (id) => {
      if (!id) {
        set({ activeSet: null, activeSetId: null })
        return
      }
      get().setActiveScenario(id)
    },
  }
})

// Re-scope on project change.
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  const store = useParameterStore.getState()
  store.clear()
  if (state.currentProject) {
    store.fetchTable().catch(() => undefined)
  }
})
