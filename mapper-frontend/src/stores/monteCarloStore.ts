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
  cancelTask,
  getMonteCarloMultiResult,
  getMonteCarloResult,
  monteCarloWsUrl,
  startMonteCarlo,
  startMonteCarloMulti,
  type MonteCarloMultiRequest,
  type MonteCarloMultiResult,
  type MonteCarloRequest,
  type MonteCarloResult,
} from '../api/client'
import { useProjectStore } from './projectStore'

/**
 * A configuration handed over from a Single-product result so the Monte Carlo
 * tab opens ready to run. Arriving from a result must never require
 * re-specifying anything -- that is the whole point of the entry point.
 */
/** Items handed over from a Multi-item comparison, in comparison order. */
export interface MonteCarloMultiHandoff {
  items: { archetypeId: string; archetypeName: string }[]
  methods: string[][]
  scope: 'inflows' | 'stock' | 'outflows' | 'all'
  stageAmounts: Record<string, Record<string, number>>
  parameterScenario: string | null
  computeDatabase: string | null
}

export interface MonteCarloHandoff {
  archetypeId: string
  archetypeName: string
  methods: string[][]
  scope: 'inflows' | 'stock' | 'outflows' | 'all'
  stageAmounts: Record<string, number>
  basisAmounts?: Record<string, number> | null
  parameterScenario: string | null
  computeDatabase: string | null
}

interface MonteCarloState {
  handoff: MonteCarloHandoff | null
  multiHandoff: MonteCarloMultiHandoff | null
  multiResult: MonteCarloMultiResult | null
  taskId: string | null
  running: boolean
  pct: number
  stage: string
  error: string | null
  cancelled: boolean
  result: MonteCarloResult | null

  /** Called from a Single-product results panel. Stores the configuration; the
   *  caller then navigates to the tab. Does NOT auto-run -- iterations and
   *  seed are the user's to set before spending a minute of compute. */
  setHandoff: (h: MonteCarloHandoff) => void
  setMultiHandoff: (h: MonteCarloMultiHandoff) => void
  runMulti: (body: MonteCarloMultiRequest) => Promise<void>
  run: (body: MonteCarloRequest) => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
}

export const useMonteCarloStore = create<MonteCarloState>((set, get) => ({
  handoff: null,
  multiHandoff: null,
  multiResult: null,
  taskId: null,
  running: false,
  pct: 0,
  stage: '',
  error: null,
  cancelled: false,
  result: null,

  setHandoff: (handoff) => set({ handoff, multiHandoff: null }),

  // Multi-item and single-item handoffs are mutually exclusive: the tab shows
  // one comparison or one product, never both.
  setMultiHandoff: (multiHandoff) => set({ multiHandoff, handoff: null }),

  runMulti: async (body) => {
    set({ running: true, pct: 0, stage: 'queued', error: null, cancelled: false, multiResult: null })
    let taskId: string
    try {
      taskId = (await startMonteCarloMulti(body)).task_id
      set({ taskId })
    } catch (e) {
      set({ running: false, error: e instanceof Error ? e.message : String(e) })
      return
    }
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(monteCarloWsUrl(taskId))
      let settled = false
      const finish = () => { if (settled) return; settled = true; try { ws.close() } catch { /* closing */ } resolve() }
      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'progress') set({ pct: msg.pct ?? 0, stage: msg.stage ?? '' })
        else if (msg.type === 'done') {
          try {
            set({ multiResult: await getMonteCarloMultiResult(taskId), running: false, pct: 1 })
          } catch (e) {
            set({ running: false, error: e instanceof Error ? e.message : String(e) })
          }
          finish()
        } else if (msg.type === 'cancelled') { set({ running: false, cancelled: true }); finish() }
        else if (msg.type === 'error') { set({ running: false, error: msg.error ?? 'Run failed' }); finish() }
      }
      ws.onerror = () => {
        if (!settled && get().running) set({ running: false, error: 'Lost connection to the Monte Carlo task' })
        finish()
      }
      ws.onclose = () => { if (!settled && get().running) set({ running: false }); finish() }
    })
  },

  run: async (body) => {
    set({ running: true, pct: 0, stage: 'queued', error: null, cancelled: false, result: null })
    let taskId: string
    try {
      const started = await startMonteCarlo(body)
      taskId = started.task_id
      set({ taskId })
    } catch (e) {
      set({ running: false, error: e instanceof Error ? e.message : String(e) })
      return
    }

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(monteCarloWsUrl(taskId))
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        try { ws.close() } catch { /* already closing */ }
        resolve()
      }
      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'progress') {
          set({ pct: msg.pct ?? 0, stage: msg.stage ?? '' })
        } else if (msg.type === 'done') {
          try {
            const result = await getMonteCarloResult(taskId)
            set({ result, running: false, pct: 1 })
          } catch (e) {
            set({ running: false, error: e instanceof Error ? e.message : String(e) })
          }
          finish()
        } else if (msg.type === 'cancelled') {
          set({ running: false, cancelled: true })
          finish()
        } else if (msg.type === 'error') {
          set({ running: false, error: msg.error ?? 'Monte Carlo run failed' })
          finish()
        }
      }
      // A socket that dies without a terminal frame must not leave the UI
      // stuck on "running" forever.
      ws.onerror = () => {
        if (!settled && get().running) {
          set({ running: false, error: 'Lost connection to the Monte Carlo task' })
        }
        finish()
      }
      ws.onclose = () => {
        if (!settled && get().running) set({ running: false })
        finish()
      }
    })
  },

  cancel: async () => {
    const id = get().taskId
    if (!id) return
    set({ stage: 'stopping…' })
    await cancelTask(id)
  },

  reset: () =>
    set({
      taskId: null, running: false, pct: 0, stage: '',
      error: null, cancelled: false, result: null, multiResult: null,
    }),
}))

// Project-scoped: a result belongs to the project it was computed in. Same
// reset-on-project-change block every project-scoped store carries.
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useMonteCarloStore.setState({ handoff: null, multiHandoff: null })
  useMonteCarloStore.getState().reset()
})
