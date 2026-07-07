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

  createProject: (name: string) => Promise<void>
  duplicateProject: (sourceName: string, newName: string) => Promise<void>
  deleteProject: (name: string) => Promise<void>
  exportProject: (name: string) => Promise<void>
  importProject: (file: File) => Promise<void>
}

async function refreshProjectsAndDatabases(
  set: (partial: Partial<ProjectStore>) => void,
  currentOverride?: string,
) {
  const projects = await getProjects()
  const current = currentOverride ?? projects.find((p) => p.is_current)?.name ?? null
  set({ projects, currentProject: current })
  const databases = await getDatabases()
  set({ databases })
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
      const projects = await withTransientRetry(() => getProjects(), {
        attempts: 6,
        baseDelayMs: 400,
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
