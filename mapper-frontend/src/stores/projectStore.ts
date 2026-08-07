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
  type DatabaseResponse,
  type ProjectResponse,
  createProject as apiCreateProject,
  deleteProject as apiDeleteProject,
  duplicateProject as apiDuplicateProject,
  exportProject as apiExportProject,
  getDatabases,
  getProjects,
  importProject as apiImportProject,
  switchProject as apiSwitchProject,
  withTransientRetry,
} from '../api/client'

interface ProjectStore {
  currentProject: string | null
  projects: ProjectResponse[]
  databases: DatabaseResponse[]
  isLoading: boolean

  fetchProjects: () => Promise<void>
  switchProject: (name: string) => Promise<void>
  fetchDatabases: () => Promise<void>
  /**
   * Re-sync after the BACKEND's project changed underneath us (the demo
   * builder switches server-side; the project-guard 409 means bw2 is on a
   * different project than we thought). Refreshes the project list AND the
   * project-scoped `databases` atomically.
   *
   * Deliberately separate from `fetchProjects`, which must stay a
   * project-list-only call: it is the cold-boot mount fetch with a tuned
   * ~22.5 s retry budget, and awaiting a second request inside it changes its
   * timing contract.
   */
  resyncAfterProjectChange: () => Promise<void>

  createProject: (name: string) => Promise<void>
  duplicateProject: (sourceName: string, newName: string) => Promise<void>
  deleteProject: (name: string) => Promise<void>
  exportProject: (name: string) => Promise<void>
  importProject: (file: File) => Promise<void>
}

// Cold-boot retry budget for the initial project fetch. Exported so a test can
// assert the window actually covers a slow sidecar rather than just asserting
// that the retry helper is wired up.
export const PROJECT_FETCH_ATTEMPTS = 10
export const PROJECT_FETCH_BASE_DELAY_MS = 500

/** Total time `withTransientRetry` will wait across its (linear) backoff. */
export function projectFetchRetryWindowMs(
  attempts = PROJECT_FETCH_ATTEMPTS,
  baseDelayMs = PROJECT_FETCH_BASE_DELAY_MS,
): number {
  let total = 0
  for (let i = 0; i < attempts - 1; i++) total += baseDelayMs * (i + 1)
  return total
}

async function refreshProjectsAndDatabases(
  set: (partial: Partial<ProjectStore>) => void,
  currentOverride?: string,
) {
  const projects = await getProjects()
  const current = currentOverride ?? projects.find((p) => p.is_current)?.name ?? null
  // Publish the project and its databases in ONE set(). Two sets left an
  // intermediate render holding the NEW currentProject with the PREVIOUS
  // project's `databases`; DatabaseExplorer's initialise effect ran in that
  // window and re-selected a database belonging to the old project (which the
  // activity-store reset had just cleared), reinstating the stale view it was
  // supposed to fix. Keep this atomic.
  const databases = await getDatabases()
  set({ projects, currentProject: current, databases })
}

export const useProjectStore = create<ProjectStore>((set) => ({
  currentProject: null,
  projects: [],
  databases: [],
  isLoading: false,

  fetchProjects: async () => {
    set({ isLoading: true })
    try {
      // Retry transient network failures — on the desktop build the sidecar may
      // not be fully reachable the instant the SPA mounts (cold-boot / onefile
      // re-bind window). Without this a single early failure would leave the
      // project list empty forever ("No projects found") with no re-fetch.
      //
      // The window has to cover a real cold boot. `withTransientRetry` backs off
      // LINEARLY (baseDelayMs × attempt), so 6 × 400 ms was only
      // 400+800+1200+1600+2000 = 6.0 s of waiting. Measured time-to-first-200 on
      // the packaged macOS build is 5–15 s (bw2 + scipy imports, and a one-off
      // matplotlib font-cache rebuild on a fresh install), so the old window
      // expired before a slow-but-healthy sidecar answered. 10 × 500 ms gives
      // 500+1000+…+4500 = 22.5 s.
      const projects = await withTransientRetry(() => getProjects(), {
        attempts: PROJECT_FETCH_ATTEMPTS,
        baseDelayMs: PROJECT_FETCH_BASE_DELAY_MS,
      })
      const current = projects.find((p) => p.is_current)?.name ?? null
      set({ projects, currentProject: current })
    } catch {
      // Give up quietly after the bounded retries — do NOT clobber any
      // already-loaded projects, and do NOT rethrow (an unhandled rejection
      // would break App's mount fetch chain). A later fetch (dropdown open)
      // re-populates against the live backend.
    } finally {
      set({ isLoading: false })
    }
  },

  switchProject: async (name: string) => {
    set({ isLoading: true })
    try {
      await apiSwitchProject(name)
      await refreshProjectsAndDatabases(set, name)
    } finally {
      set({ isLoading: false })
    }
  },

  fetchDatabases: async () => {
    set({ isLoading: true })
    try {
      const databases = await getDatabases()
      set({ databases })
    } finally {
      set({ isLoading: false })
    }
  },

  resyncAfterProjectChange: async () => {
    set({ isLoading: true })
    try {
      await refreshProjectsAndDatabases(set)
    } catch {
      // Never rethrow — callers are fire-and-forget (demo load, guard re-sync).
    } finally {
      set({ isLoading: false })
    }
  },

  createProject: async (name: string) => {
    set({ isLoading: true })
    try {
      const res = await apiCreateProject(name)
      await refreshProjectsAndDatabases(set, res.name)
    } finally {
      set({ isLoading: false })
    }
  },

  duplicateProject: async (sourceName: string, newName: string) => {
    set({ isLoading: true })
    try {
      const res = await apiDuplicateProject(sourceName, newName)
      await refreshProjectsAndDatabases(set, res.name)
    } finally {
      set({ isLoading: false })
    }
  },

  deleteProject: async (name: string) => {
    set({ isLoading: true })
    try {
      const res = await apiDeleteProject(name)
      await refreshProjectsAndDatabases(set, res.current_project)
    } finally {
      set({ isLoading: false })
    }
  },

  exportProject: async (name: string) => {
    await apiExportProject(name)
  },

  importProject: async (file: File) => {
    set({ isLoading: true })
    try {
      const res = await apiImportProject(file)
      await refreshProjectsAndDatabases(set, res.name)
    } finally {
      set({ isLoading: false })
    }
  },
}))
