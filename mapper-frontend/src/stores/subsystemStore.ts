/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { create } from 'zustand'
import {
  type DependencyRule,
  type RuleValidationResult,
  type SimulationResult,
  type Subsystem,
  type SubsystemInitialStockUploadResult,
  clearSubsystemInitialStock,
  computeAllSubsystems,
  computeSubsystem,
  createSubsystem,
  deleteSubsystem,
  downloadSubsystemStockTemplate,
  getSubsystem,
  getSubsystemResult,
  listSubsystems,
  updateSubsystem,
  uploadSubsystemInitialStock,
  validateDependencyRule,
} from '../api/client'
import { useDSMStore } from './dsmStore'
import { useProjectStore } from './projectStore'

interface SubsystemStore {
  currentSystemId: string | null
  subsystems: Subsystem[]               // includes synthesized primary + dependents
  activeSubsystemId: string | null      // null → primary view (system itself)
  subsystemResults: Record<string, SimulationResult>
  isLoading: boolean
  isComputing: boolean
  error: string | null

  fetchForSystem: (systemId: string) => Promise<void>
  refresh: () => Promise<void>
  selectSubsystem: (id: string | null) => void
  addDependent: (body: Omit<Subsystem, 'id' | 'type' | 'depends_on'>) => Promise<Subsystem>
  saveDependent: (sub: Subsystem) => Promise<Subsystem>
  removeDependent: (id: string) => Promise<void>
  validateRule: (rule: DependencyRule) => Promise<RuleValidationResult>
  runCompute: (id: string, parameterSetId?: string | null) => Promise<SimulationResult>
  runComputeAll: (parameterSetId?: string | null) => Promise<void>
  loadResult: (id: string) => Promise<void>
  uploadInitialStock: (id: string, file: File) => Promise<SubsystemInitialStockUploadResult>
  clearInitialStock: (id: string) => Promise<void>
  downloadStockTemplate: (id: string) => Promise<void>
  reset: () => void
}

const initial = {
  currentSystemId: null as string | null,
  subsystems: [] as Subsystem[],
  activeSubsystemId: null as string | null,
  subsystemResults: {} as Record<string, SimulationResult>,
  isLoading: false,
  isComputing: false,
  error: null as string | null,
}

export const useSubsystemStore = create<SubsystemStore>((set, get) => ({
  ...initial,

  fetchForSystem: async (systemId) => {
    set({ isLoading: true, error: null, currentSystemId: systemId })
    try {
      const { subsystems } = await listSubsystems(systemId)
      set({ subsystems, isLoading: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
    }
  },

  refresh: async () => {
    const sysId = get().currentSystemId
    if (!sysId) return
    try {
      const { subsystems } = await listSubsystems(sysId)
      set({ subsystems })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  selectSubsystem: (id) => set({ activeSubsystemId: id }),

  addDependent: async (body) => {
    const sysId = get().currentSystemId
    if (!sysId) throw new Error('No active system')
    const created = await createSubsystem(sysId, {
      ...body,
      id: '',
      type: 'dependent',
      depends_on: sysId,
    })
    await get().refresh()
    set({ activeSubsystemId: created.id })
    return created
  },

  saveDependent: async (sub) => {
    const sysId = get().currentSystemId
    if (!sysId) throw new Error('No active system')
    const updated = await updateSubsystem(sysId, sub.id, sub)
    const next = get().subsystems.map((s) => (s.id === updated.id ? updated : s))
    // Invalidate cached result — server also drops it.
    const results = { ...get().subsystemResults }
    delete results[updated.id]
    set({ subsystems: next, subsystemResults: results })
    return updated
  },

  removeDependent: async (id) => {
    const sysId = get().currentSystemId
    if (!sysId) throw new Error('No active system')
    await deleteSubsystem(sysId, id)
    const next = get().subsystems.filter((s) => s.id !== id)
    const results = { ...get().subsystemResults }
    delete results[id]
    const active = get().activeSubsystemId === id ? null : get().activeSubsystemId
    set({ subsystems: next, subsystemResults: results, activeSubsystemId: active })
  },

  validateRule: async (rule) => {
    const sysId = get().currentSystemId
    if (!sysId) throw new Error('No active system')
    return validateDependencyRule(sysId, rule)
  },

  runCompute: async (id, parameterSetId = null) => {
    const sysId = get().currentSystemId
    if (!sysId) throw new Error('No active system')
    set({ isComputing: true, error: null })
    try {
      const result = await computeSubsystem(sysId, id, parameterSetId)
      set({
        subsystemResults: { ...get().subsystemResults, [id]: result },
        isComputing: false,
      })
      return result
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isComputing: false })
      throw e
    }
  },

  runComputeAll: async (parameterSetId = null) => {
    const sysId = get().currentSystemId
    if (!sysId) throw new Error('No active system')
    set({ isComputing: true, error: null })
    try {
      const { subsystem_results } = await computeAllSubsystems(sysId, parameterSetId)
      set({
        subsystemResults: { ...get().subsystemResults, ...subsystem_results },
        isComputing: false,
      })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), isComputing: false })
      throw e
    }
  },

  loadResult: async (id) => {
    const sysId = get().currentSystemId
    if (!sysId) return
    try {
      const result = await getSubsystemResult(sysId, id)
      set({ subsystemResults: { ...get().subsystemResults, [id]: result } })
    } catch {
      // 404 is expected before first compute — leave cache untouched.
    }
  },

  uploadInitialStock: async (id, file) => {
    const sysId = get().currentSystemId
    if (!sysId) throw new Error('No active system')
    const summary = await uploadSubsystemInitialStock(sysId, id, file)
    await get().refresh()
    const results = { ...get().subsystemResults }
    delete results[id]
    set({ subsystemResults: results })
    return summary
  },

  clearInitialStock: async (id) => {
    const sysId = get().currentSystemId
    if (!sysId) throw new Error('No active system')
    await clearSubsystemInitialStock(sysId, id)
    await get().refresh()
    const results = { ...get().subsystemResults }
    delete results[id]
    set({ subsystemResults: results })
  },

  downloadStockTemplate: async (id) => {
    const sysId = get().currentSystemId
    if (!sysId) throw new Error('No active system')
    await downloadSubsystemStockTemplate(sysId, id, id)
  },

  reset: () => set({ ...initial }),
}))

// Suppress unused warning in environments without TS's noUnusedLocals. The helper
// is exported for tests/future use.
void getSubsystem

// ── Scope: reset & reload when DSM active system or project changes. ────────

let _lastSystemId: string | null = useDSMStore.getState().activeSystem?.id ?? null
useDSMStore.subscribe((state) => {
  const id = state.activeSystem?.id ?? null
  if (id === _lastSystemId) return
  _lastSystemId = id
  const store = useSubsystemStore.getState()
  store.reset()
  if (id) {
    store.fetchForSystem(id).catch(() => undefined)
  }
})

let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useSubsystemStore.getState().reset()
})
