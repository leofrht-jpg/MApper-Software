/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useCallback, useRef, useState } from 'react'
import { CANCEL_NOT_FOUND_MESSAGE, cancelTask } from '../api/client'

export type CancellableState = 'idle' | 'running' | 'stopping'

interface UseCancellableTaskResult {
  /** Current task id, or null when idle. ``StopButton`` keys off this to
   *  decide whether to render. */
  taskId: string | null
  state: CancellableState
  /** Set when Stop did not reach the task (404 or network). Cleared on
   *  ``begin``, ``finish`` and the next ``requestStop``. */
  stopError: string | null
  /** Call when a new task starts. ``state`` flips to ``"running"`` and
   *  any prior task id is replaced (the worker for that one is
   *  presumably already terminal — late frames are filtered by id). */
  begin: (taskId: string) => void
  /** Call from ``StopButton``'s click handler. Issues the cancel POST and
   *  flips state to ``"stopping"``. Idempotent — clicking twice is
   *  harmless (backend treats second cancel as no-op). The terminal
   *  state arrives via the WS ``cancelled`` frame, NOT this call.
   *  A 404 means the server has no such task. That is NOT treated as
   *  "finished": the hook goes back to ``"running"`` (Stop available
   *  again) and sets ``stopError``. If the task really did just finish, its
   *  terminal frame calls ``finish()`` and clears both.
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
  const [stopError, setStopError] = useState<string | null>(null)
  // Mirror the task id in a ref so requestStop() reads the latest
  // value even if the click handler closed over a stale state snapshot.
  const taskIdRef = useRef<string | null>(null)

  const begin = useCallback((id: string) => {
    taskIdRef.current = id
    setTaskId(id)
    setState('running')
    setStopError(null)
  }, [])

  const finish = useCallback((id: string) => {
    if (taskIdRef.current === id) {
      taskIdRef.current = null
      setTaskId(null)
      setState('idle')
      setStopError(null)
    }
  }, [])

  const requestStop = useCallback(async () => {
    const id = taskIdRef.current
    if (id == null) return
    setState('stopping')
    setStopError(null)
    try {
      const result = await cancelTask(id)
      if (result === null && taskIdRef.current === id) {
        // 404 while this task is still ours, i.e. no terminal frame yet. Do
        // NOT drop to idle: that is what made every Stop a silent no-op when
        // the route was mis-mounted. Say so and keep Stop available.
        setState('running')
        setStopError(CANCEL_NOT_FOUND_MESSAGE)
      }
      // 200: stay in "stopping" — the WS ``cancelled`` frame will
      // finalize the state via finish(). This keeps the worker as the
      // single source of truth for terminal status.
    } catch (err) {
      console.error('cancelTask failed', err)
      if (taskIdRef.current === id) {
        setState('running')
        setStopError(`Stop failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }, [])

  const isCurrent = useCallback(
    (id: string | undefined | null) => id != null && id === taskIdRef.current,
    [],
  )

  return { taskId, state, stopError, begin, requestStop, finish, isCurrent }
}
