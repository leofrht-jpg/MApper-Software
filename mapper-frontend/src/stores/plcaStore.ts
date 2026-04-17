import { create } from 'zustand'
import {
  type PLCAScenarios,
  type PLCAProgressMessage,
  type ProspectiveDB,
  connectToPLCATask,
  deletePLCADatabase,
  getPLCADatabases,
  getPLCAScenarios,
  startPLCAGeneration,
} from '../api/client'
import { useProjectStore } from './projectStore'

export interface GenerationJob {
  taskId: string
  baseDb: string
  iam: string
  ssp: string
  years: number[]
  plannedNames: string[]
  stage: string
  pct: number
  done: boolean
  error: string | null
  written: string[]
  startedAt: number
}

interface PLCAStore {
  scenarios: PLCAScenarios | null
  databases: ProspectiveDB[]
  activeJob: GenerationJob | null
  isLoading: boolean
  error: string | null

  fetchScenarios: () => Promise<void>
  fetchDatabases: () => Promise<void>
  generate: (args: { baseDb: string; iam: string; ssp: string; years: number[] }) => Promise<void>
  deleteDatabase: (name: string) => Promise<void>
  clearJob: () => void
  reset: () => void
}

export const usePLCAStore = create<PLCAStore>((set, get) => {
  let socket: WebSocket | null = null

  const closeSocket = () => {
    try { socket?.close() } catch { /* ignore */ }
    socket = null
  }

  return {
    scenarios: null,
    databases: [],
    activeJob: null,
    isLoading: false,
    error: null,

    fetchScenarios: async () => {
      try {
        const scenarios = await getPLCAScenarios()
        set({ scenarios })
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
      }
    },

    fetchDatabases: async () => {
      set({ isLoading: true, error: null })
      try {
        const databases = await getPLCADatabases()
        set({ databases, isLoading: false })
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e), isLoading: false })
      }
    },

    generate: async ({ baseDb, iam, ssp, years }) => {
      if (!years.length) throw new Error('Select at least one year')
      set({ error: null })
      const res = await startPLCAGeneration({ base_db: baseDb, iam, ssp, years })
      const job: GenerationJob = {
        taskId: res.task_id,
        baseDb,
        iam,
        ssp,
        years,
        plannedNames: res.planned_names,
        stage: 'queued',
        pct: 0,
        done: false,
        error: null,
        written: [],
        startedAt: Date.now(),
      }
      set({ activeJob: job })

      closeSocket()
      socket = connectToPLCATask(res.task_id, (msg: PLCAProgressMessage) => {
        const cur = get().activeJob
        if (!cur || cur.taskId !== res.task_id) return
        if (msg.type === 'progress') {
          set({ activeJob: { ...cur, stage: msg.stage ?? cur.stage, pct: msg.pct ?? cur.pct } })
        } else if (msg.type === 'done') {
          set({ activeJob: { ...cur, done: true, pct: 1, stage: 'done', written: msg.written ?? [] } })
          get().fetchDatabases().catch(() => undefined)
          useProjectStore.getState().fetchDatabases().catch(() => undefined)
          closeSocket()
        } else if (msg.type === 'error') {
          set({ activeJob: { ...cur, done: true, error: msg.error ?? 'unknown error' } })
          closeSocket()
        }
      }, () => {
        const cur = get().activeJob
        if (cur && !cur.done) set({ activeJob: { ...cur, error: 'connection lost' } })
      })
    },

    deleteDatabase: async (name) => {
      await deletePLCADatabase(name)
      await get().fetchDatabases()
      useProjectStore.getState().fetchDatabases().catch(() => undefined)
    },

    clearJob: () => {
      closeSocket()
      set({ activeJob: null })
    },

    reset: () => {
      closeSocket()
      set({ databases: [], activeJob: null, error: null })
    },
  }
})

// Reset when project changes.
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  const store = usePLCAStore.getState()
  store.reset()
  if (state.currentProject) store.fetchDatabases().catch(() => undefined)
})
