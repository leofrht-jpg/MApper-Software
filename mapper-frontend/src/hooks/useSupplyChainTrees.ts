/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  runContributionAnalysis,
  type ContributionAnalysisRequest,
  type ContributionAnalysisResult,
} from '../api/client'
import { useSessionState } from '../stores/sessionStateStore'

/** Most trees kept per surface. A tree is a large payload (Sankey, tree, tables); the
 *  oldest goes first. Keys carry the run id, so an older run's trees are only ever evicted,
 *  never shown. */
export const MAX_CACHED_TREES = 12

/**
 * The explicit "Build supply chain tree" request for Impact Assessment: one at a time,
 * cached per key, and dropped on the client when what the screen shows changes.
 *
 * - `key` identifies ONE tree: item, indicator, sensitivity case and the Calculate run it
 *   belongs to. The caller builds it from the frozen result, never from live inputs.
 * - `watchKey` is what the visible tree depends on (item set, indicator, case, run). When it
 *   changes, or the component unmounts, the request in flight is aborted and its late
 *   response is ignored. Abort frees the CLIENT only: the server keeps computing (a thread
 *   cannot be cancelled) and holds its compute lock until it finishes.
 * - Nothing is requested unless `build` is called.
 */
export function useSupplyChainTrees(sessionKey: string, watchKey: string | null) {
  const [cache, setCache] = useSessionState<Record<string, ContributionAnalysisResult>>(sessionKey, {})
  const abortRef = useRef<AbortController | null>(null)
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [discardedKey, setDiscardedKey] = useState<string | null>(null)
  const runningKeyRef = useRef<string | null>(null)

  const discard = useCallback((notify = true) => {
    const running = abortRef.current
    if (!running) return
    running.abort()
    abortRef.current = null
    const key = runningKeyRef.current
    runningKeyRef.current = null
    setRunningKey(null)
    if (notify) setDiscardedKey(key)
  }, [])

  // The cleanup runs when `watchKey` changes and on unmount.
  useEffect(() => () => discard(), [watchKey, discard])

  const build = useCallback(async (key: string, body: ContributionAnalysisRequest) => {
    if (abortRef.current) return // one tree at a time, across every item
    const controller = new AbortController()
    abortRef.current = controller
    runningKeyRef.current = key
    setRunningKey(key)
    setError(null)
    setDiscardedKey(null)
    try {
      const res = await runContributionAnalysis(body, controller.signal)
      if (controller.signal.aborted) return
      setCache((prev) => {
        const next = { ...prev, [key]: res }
        const keys = Object.keys(next)
        for (let i = 0; i < keys.length - MAX_CACHED_TREES; i++) delete next[keys[i]]
        return next
      })
    } catch (e: unknown) {
      if (controller.signal.aborted) return
      setError({ key, message: e instanceof Error ? e.message : String(e) })
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        runningKeyRef.current = null
        setRunningKey(null)
      }
    }
  }, [setCache])

  return {
    /** Any tree is being built: every Build button on the page is disabled. */
    running: runningKey !== null,
    runningKey,
    resultFor: (key: string) => cache[key] ?? null,
    errorFor: (key: string) => (error && error.key === key ? error.message : null),
    discardedFor: (key: string) => discardedKey === key,
    build,
    discard,
  }
}
