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
      const projects = await getProjects()
      const current = projects.find((p) => p.is_current)?.name ?? null
      set({ projects, currentProject: current })
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
