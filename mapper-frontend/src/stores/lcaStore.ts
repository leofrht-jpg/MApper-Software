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
  type ActivitySummary,
  type ContributionsResponse,
  type LCAResult,
  type SankeyData,
  type TaskProgressMessage,
  connectToTask,
  getLCAContributions,
  getLCAResult,
  getLCASupplyChain,
  startLCACalculation,
} from '../api/client'

type LCAStatus = 'idle' | 'calculating' | 'done' | 'error'

interface LCAStore {
  selectedActivity: ActivitySummary | null
  amount: number
  selectedMethod: string[] | null
  taskId: string | null
  status: LCAStatus
  progress: TaskProgressMessage | null
  result: LCAResult | null
  contributions: ContributionsResponse | null
  supplyChain: SankeyData | null
  error: string | null

  setFunctionalUnit: (activity: ActivitySummary, amount: number) => void
  setMethod: (method: string[]) => void
  calculate: () => Promise<void>
  reset: () => void
}

export const useLCAStore = create<LCAStore>((set, get) => ({
  selectedActivity: null,
  amount: 1,
  selectedMethod: null,
  taskId: null,
  status: 'idle',
  progress: null,
  result: null,
  contributions: null,
  supplyChain: null,
  error: null,

  setFunctionalUnit: (activity, amount) => set({ selectedActivity: activity, amount }),
  setMethod: (method) => set({ selectedMethod: method }),

  calculate: async () => {
    const { selectedActivity, amount, selectedMethod } = get()
    if (!selectedActivity || !selectedMethod) return

    set({ status: 'calculating', progress: null, result: null, contributions: null, supplyChain: null, error: null })

    const wsHolder: { ws: WebSocket | null } = { ws: null }
    try {
      const started = await startLCACalculation(selectedActivity.key, amount, selectedMethod)
      set({ taskId: started.task_id })

      await new Promise<void>((resolve, reject) => {
        wsHolder.ws = connectToTask(
          `/ws/lca/${started.task_id}`,
          (msg: TaskProgressMessage) => {
            set({ progress: msg })
            if (msg.step === 'done') resolve()
            else if (msg.step === 'error') reject(new Error(msg.message))
          },
          () => reject(new Error('WebSocket error')),
        )
      })

      const [result, contributions, supplyChain] = await Promise.all([
        getLCAResult(started.task_id),
        getLCAContributions(started.task_id, 10),
        getLCASupplyChain(started.task_id),
      ])
      set({ status: 'done', result, contributions, supplyChain })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ status: 'error', error: msg })
    } finally {
      wsHolder.ws?.close()
    }
  },

  reset: () =>
    set({
      taskId: null,
      status: 'idle',
      progress: null,
      result: null,
      contributions: null,
      supplyChain: null,
      error: null,
    }),
}))
