/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useCallback, useRef, useState } from 'react'
import { cancelTask } from '../api/client'

export type CancellableState = 'idle' | 'running' | 'stopping'

interface UseCancellableTaskResult {
  /** Current task id, or null when idle. ``StopButton`` keys off this to
   *  decide whether to render. */
  taskId: string | null
  state: CancellableState
  /** Call when a new task starts. ``state`` flips to ``"running"`` and
   *  any prior task id is replaced (the worker for that one is
   *  presumably already terminal — late frames are filtered by id). */
  begin: (taskId: string) => void
  /** Call from ``StopButton``'s click handler. Issues the cancel POST and
   *  flips state to ``"stopping"``. Idempotent — clicking twice is
   *  harmless (backend treats second cancel as no-op). The terminal
   *  state arrives via the WS ``cancelled`` frame, NOT this call.
   *  404 from the cancel endpoint means the task already finished —
   *  the hook reverts to ``"idle"`` so the UI doesn't get stuck.
   */
  requestStop: () => Promise<void>
  /** Call from the WS ``cancelled`` / ``done`` / ``error`` handler to
   *  return to the idle state. The ``taskId`` parameter is matched
   *  against the current task; late frames from a previous task are
   *  ignored. This guard matters when the user starts task B while
   *  task A's cancellation is still in flight. */
  finish: (taskId: string) => void
  /** Returns true iff the given task_id matches the hook's current
   *  task_id. Use to guard WS frame handlers against late frames from
   *  superseded tasks. */
  isCurrent: (taskId: string | undefined | null) => boolean
}

export function useCancellableTask(): UseCancellableTaskResult {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [state, setState] = useState<CancellableState>('idle')
  // Mirror the task id in a ref so requestStop() reads the latest
  // value even if the click handler closed over a stale state snapshot.
  const taskIdRef = useRef<string | null>(null)

  const begin = useCallback((id: string) => {
    taskIdRef.current = id
    setTaskId(id)
    setState('running')
  }, [])

  const finish = useCallback((id: string) => {
    if (taskIdRef.current === id) {
      taskIdRef.current = null
      setTaskId(null)
      setState('idle')
    }
  }, [])

  const requestStop = useCallback(async () => {
    const id = taskIdRef.current
    if (id == null) return
    setState('stopping')
    try {
      const result = await cancelTask(id)
      if (result === null) {
        // 404: the worker beat the cancel POST. The terminal WS frame
        // (done/error) will already have fired or will fire imminently;
        // either way the hook should drop back to idle.
        if (taskIdRef.current === id) {
          taskIdRef.current = null
          setTaskId(null)
          setState('idle')
        }
      }
      // 200: stay in "stopping" — the WS ``cancelled`` frame will
      // finalize the state via finish(). This keeps the worker as the
      // single source of truth for terminal status.
    } catch (err) {
      // Network / 5xx — surface to console; revert state machine so the
      // user can retry. Real outcome will arrive via WS regardless.
      console.error('cancelTask failed', err)
      if (taskIdRef.current === id) setState('running')
    }
  }, [])

  const isCurrent = useCallback(
    (id: string | undefined | null) => id != null && id === taskIdRef.current,
    [],
  )

  return { taskId, state, begin, requestStop, finish, isCurrent }
}
