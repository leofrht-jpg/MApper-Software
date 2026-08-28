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
  getProjectSettings,
  saveProjectSettings,
  type ProjectSettings,
  type UsePhaseBasis,
} from '../api/client'
import { useProjectStore } from './projectStore'

interface ProjectSettingsStore {
  settings: ProjectSettings | null
  isLoading: boolean
  error: string | null
  fetchSettings: () => Promise<void>
  setUsePhaseBasis: (basis: UsePhaseBasis) => Promise<void>
  reset: () => void
}

export const useProjectSettingsStore = create<ProjectSettingsStore>((set, get) => ({
  settings: null,
  isLoading: false,
  error: null,

  fetchSettings: async () => {
    set({ isLoading: true, error: null })
    try {
      set({ settings: await getProjectSettings(), isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
    }
  },

  setUsePhaseBasis: async (basis) => {
    const next = { ...(get().settings ?? { use_phase_basis: basis }), use_phase_basis: basis }
    set({ settings: next })            // optimistic; the control is a toggle
    try {
      set({ settings: await saveProjectSettings(next) })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      await get().fetchSettings()      // resync on failure
    }
  },

  reset: () => set({ settings: null, isLoading: false, error: null }),
}))

// Project-scoped store: reset on project change. Every project-keyed store ends
// with this block -- omitting it is what left Database Explorer showing the
// previous project's data.
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useProjectSettingsStore.getState().reset()
  void useProjectSettingsStore.getState().fetchSettings()
})
