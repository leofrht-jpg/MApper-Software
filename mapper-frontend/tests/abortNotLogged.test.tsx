/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { installGlobalErrorHandlers, isCallerAbort, useLogStore } from '../src/stores/logStore'
import { runContributionAnalysis, type ContributionAnalysisRequest } from '../src/api/client'
import { useSupplyChainTrees } from '../src/hooks/useSupplyChainTrees'
import { useStopWaiting } from '../src/hooks/useStopWaiting'

// An abort the app asks for itself (Stop waiting, Discard, unmount, a replaced query) is not an error
// and is not logged; a real network failure, a server error and a timeout still are. fetch is a mock
// that rejects the way a browser does when the request's signal aborts; no backend, project or database.

type Impl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
let impl: Impl = () => Promise.reject(new Error('no fetch mock set'))

/** Rejects with the signal's reason when it aborts, like fetch() does. */
const abortable: Impl = (_input, init) => new Promise<Response>((_resolve, reject) => {
  const s = init?.signal
  if (!s) return
  if (s.aborted) return reject(s.reason)
  s.addEventListener('abort', () => reject(s.reason), { once: true })
})

const entries = () => useLogStore.getState().entries
const BODY = {} as unknown as ContributionAnalysisRequest

beforeAll(() => {
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => impl(input, init)) as typeof window.fetch
  installGlobalErrorHandlers()
})

beforeEach(() => {
  useLogStore.getState().clear()
  impl = abortable
})

afterEach(() => { impl = abortable })

describe('the app cancelling its own request is not logged', () => {
  it('an aborted request writes no log entry (no error, no warning, no info)', async () => {
    const c = new AbortController()
    const p = runContributionAnalysis(BODY, c.signal)
    c.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(entries()).toEqual([])
  })

  it('an abort with a custom reason is quiet too', async () => {
    const c = new AbortController()
    const p = runContributionAnalysis(BODY, c.signal)
    c.abort('replaced')
    await expect(p).rejects.toBe('replaced')
    expect(entries()).toEqual([])
  })

  it('a request already aborted before it starts is quiet', async () => {
    const c = new AbortController()
    c.abort()
    await expect(runContributionAnalysis(BODY, c.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(entries()).toEqual([])
  })

  it('an AbortError nobody caught is not logged as an unhandled rejection; another rejection still is', () => {
    const fire = (reason: unknown) => {
      const ev = new Event('unhandledrejection')
      Object.assign(ev, { reason })
      window.dispatchEvent(ev)
    }
    fire(new DOMException('signal is aborted without reason', 'AbortError'))
    expect(entries()).toEqual([])
    fire(new Error('boom'))
    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toMatchObject({ level: 'error', module: 'promise' })
  })
})

describe('real failures are still logged as before', () => {
  it('a network failure logs one error with the endpoint', async () => {
    impl = () => Promise.reject(new TypeError('Failed to fetch'))
    await expect(runContributionAnalysis(BODY)).rejects.toThrow('Failed to fetch')
    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toMatchObject({
      level: 'error', source: 'backend', module: '/api/lca/contribution-analysis',
    })
    expect(entries()[0].message).toBe('POST /api/lca/contribution-analysis → network error: Failed to fetch')
  })

  it('a network failure with a signal that was NOT aborted is logged', async () => {
    impl = () => Promise.reject(new TypeError('Failed to fetch'))
    const c = new AbortController()
    await expect(runContributionAnalysis(BODY, c.signal)).rejects.toThrow()
    expect(entries()).toHaveLength(1)
  })

  it('a network failure that arrives after the app aborted is quiet only if it is the abort itself', async () => {
    const c = new AbortController()
    impl = () => { c.abort(); return Promise.reject(new TypeError('Failed to fetch')) }
    await expect(runContributionAnalysis(BODY, c.signal)).rejects.toThrow('Failed to fetch')
    expect(entries()).toHaveLength(1)
  })

  it('a server error (500) logs one error with the status', async () => {
    impl = () => Promise.resolve(new Response(JSON.stringify({ detail: 'broke' }), { status: 500 }))
    await expect(runContributionAnalysis(BODY)).rejects.toThrow()
    expect(entries()).toHaveLength(1)
    expect(entries()[0].message).toContain('→ 500: broke')
  })

  it('a timeout (TimeoutError reason) logs an error', async () => {
    const c = new AbortController()
    const p = runContributionAnalysis(BODY, c.signal)
    c.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    await expect(p).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toMatchObject({ level: 'error' })
    expect(entries()[0].message).toContain('network error: TimeoutError: The operation timed out.')
  })

  it('an AbortSignal.timeout() that fires logs an error', async () => {
    const p = runContributionAnalysis(BODY, AbortSignal.timeout(5))
    await expect(p).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(entries()).toHaveLength(1)
  })
})

describe('isCallerAbort', () => {
  it('is true only for the caller aborting its own signal', () => {
    const c = new AbortController()
    expect(isCallerAbort(new DOMException('x', 'AbortError'), c.signal)).toBe(false) // signal not aborted
    c.abort()
    expect(isCallerAbort(c.signal.reason, c.signal)).toBe(true)
    expect(isCallerAbort(new DOMException('x', 'AbortError'), c.signal)).toBe(true)
    expect(isCallerAbort(new TypeError('Failed to fetch'), c.signal)).toBe(false)
    expect(isCallerAbort(c.signal.reason, undefined)).toBe(false)
    const t = new AbortController()
    t.abort(new DOMException('t', 'TimeoutError'))
    expect(isCallerAbort(t.signal.reason, t.signal)).toBe(false)
    expect(isCallerAbort(new DOMException('x', 'AbortError'), t.signal)).toBe(false)
  })
})

describe('Stop waiting and the tree Discard end quietly', () => {
  it('Discard of the supply chain tree: no error shown, nothing logged', async () => {
    const { result } = renderHook(() => useSupplyChainTrees('test.abortNotLogged.trees', 'w1'))
    let built: Promise<void> = Promise.resolve()
    act(() => { built = result.current.build('k1', BODY) })
    await waitFor(() => expect(result.current.runningKey).toBe('k1'))
    act(() => result.current.discard())
    await act(async () => { await built })
    expect(result.current.errorFor('k1')).toBeNull()
    expect(result.current.discardedFor('k1')).toBe(true)
    expect(result.current.running).toBe(false)
    expect(entries()).toEqual([])
  })

  it('the tree request is also quiet when the watched key changes (project or item switch) and on unmount', async () => {
    const { result, rerender, unmount } = renderHook(({ w }) => useSupplyChainTrees('test.abortNotLogged.trees2', w), { initialProps: { w: 'w1' } })
    act(() => { void result.current.build('k1', BODY) })
    await waitFor(() => expect(result.current.runningKey).toBe('k1'))
    rerender({ w: 'w2' })
    await waitFor(() => expect(result.current.running).toBe(false))
    expect(result.current.errorFor('k1')).toBeNull()
    act(() => { void result.current.build('k2', BODY) })
    await waitFor(() => expect(result.current.runningKey).toBe('k2'))
    unmount()
    await new Promise((r) => setTimeout(r, 10))
    expect(entries()).toEqual([])
  })

  it('Stop waiting: the neutral "stopped" state, nothing logged', async () => {
    const { result } = renderHook(() => useStopWaiting())
    let run!: AbortController
    let settled: unknown = 'pending'
    act(() => {
      run = result.current.begin()
      void runContributionAnalysis(BODY, run.signal).then(() => { settled = 'ok' }, (e) => { settled = e })
    })
    act(() => result.current.stop())
    await waitFor(() => expect(settled).not.toBe('pending'))
    expect(result.current.stopped).toBe(true)
    expect(result.current.owns(run)).toBe(false)
    expect(entries()).toEqual([])
  })
})
