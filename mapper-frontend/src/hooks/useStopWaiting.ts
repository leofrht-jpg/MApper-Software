/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * "Stop waiting" for a request that the server cannot cancel: one AbortController per run.
 * Aborting frees the SCREEN only; the server finishes the computation anyway.
 *
 *  - `begin()` starts a run (and abandons any run still held) and returns its controller.
 *  - `owns(run)` is true while that run is the live one: not stopped, not replaced, and the
 *    component still mounted. Every state update after an `await` is guarded by it, so a late
 *    response after Stop, a replaced run or an unmount never reaches the screen.
 *  - `stop()` aborts the live run and raises `stopped` (the neutral "Stopped" line).
 *  - Unmount aborts the live run and raises nothing.
 */
export function useStopWaiting() {
  const live = useRef<AbortController | null>(null)
  const [stopped, setStopped] = useState(false)

  useEffect(() => () => {
    const run = live.current
    live.current = null
    run?.abort()
  }, [])

  const begin = useCallback(() => {
    live.current?.abort()
    const run = new AbortController()
    live.current = run
    setStopped(false)
    return run
  }, [])

  const owns = useCallback((run: AbortController) => live.current === run && !run.signal.aborted, [])

  const end = useCallback((run: AbortController) => {
    if (live.current === run) live.current = null
  }, [])

  const stop = useCallback(() => {
    const run = live.current
    if (!run) return
    live.current = null
    run.abort()
    setStopped(true)
  }, [])

  return { begin, owns, end, stop, stopped }
}
