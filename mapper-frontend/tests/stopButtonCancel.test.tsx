/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Stop reaches the task, and a 404 is never read as "finished".
 *
 * The backend cancel route was mounted at /api/api/tasks/{id}/cancel, so the
 * client's POST to /api/tasks/{id}/cancel was always a 404, and every caller
 * read a 404 as "the task already finished": Stop did nothing, silently. The
 * route is fixed in the backend; these tests pin the client side:
 *  - the URL the Stop button posts to;
 *  - a 404 while the task is still running keeps it running, says Stop
 *    failed and offers Stop again (Monte Carlo card + the shared hook);
 *  - an accepted Stop shows "Stopping" on the card and ends in a stopped
 *    state, not a card that just disappears.
 * Real client, real store, real ComputeOverlay; only fetch and WebSocket are
 * faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'

import * as client from '../src/api/client'
import { ComputeOverlay } from '../src/components/ui/ComputeOverlay'
import { useCancellableTask } from '../src/hooks/useCancellableTask'
import { useMonteCarloStore } from '../src/stores/monteCarloStore'

class FakeWS {
  static last: FakeWS | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(public url: string) { FakeWS.last = this }
  send() {}
  close() {}
  emit(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

let cancelStatus = 200
let fetchSpy: ReturnType<typeof vi.fn>

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => JSON.stringify(body),
  } as unknown as Response
}

beforeEach(() => {
  cancelStatus = 200
  FakeWS.last = null
  fetchSpy = vi.fn(async (url: string) => {
    if (url.endsWith('/lca/monte-carlo')) return json(200, { task_id: 't1' })
    if (/\/tasks\/[^/]+\/cancel$/.test(url)) {
      return cancelStatus === 200 ? json(200, { cancelled: true, task_id: 't1' }) : json(404, { detail: 'Unknown task' })
    }
    return json(200, {})
  })
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubGlobal('WebSocket', FakeWS)
  useMonteCarloStore.getState().reset()
})
afterEach(() => vi.unstubAllGlobals())

function cancelCalls() {
  return fetchSpy.mock.calls.filter(([u]) => /\/cancel$/.test(String(u)))
}

describe('the Stop URL', () => {
  it('posts to /api/tasks/{id}/cancel, never a doubled /api/api', async () => {
    await client.cancelTask('t 1')
    const [url, init] = cancelCalls()[0]
    expect(String(url)).toMatch(/\/api\/tasks\/t%201\/cancel$/)
    expect(String(url)).not.toContain('/api/api/')
    expect((init as RequestInit).method).toBe('POST')
  })
})

/** The Monte Carlo page's card, wired to the store exactly as MonteCarlo.tsx does. */
function McCard() {
  const { running, cancelling, cancelError, cancel } = useMonteCarloStore()
  return (
    <ComputeOverlay
      active={running}
      title="Monte Carlo"
      onCancel={() => void cancel()}
      cancelling={cancelling}
      cancelError={cancelError}
      data-testid="mc-progress"
    />
  )
}

async function startRun() {
  render(<McCard />)
  void useMonteCarloStore.getState().run({ archetype_id: 'a', methods: [['EF v3.1', 'cc', 'GWP100']] } as never)
  await waitFor(() => expect(FakeWS.last).not.toBeNull())
  return screen.findByTestId('mc-progress-cancel')
}

describe('Monte Carlo card', () => {
  it('an accepted Stop shows "Stopping" and ends in a stopped state', async () => {
    const stop = await startRun()
    await act(async () => { fireEvent.click(stop) })

    expect(cancelCalls()).toHaveLength(1)
    expect(screen.getByTestId('mc-progress-cancelling').textContent).toMatch(/Stopping/)
    expect((screen.getByTestId('mc-progress-cancel') as HTMLButtonElement).disabled).toBe(true)
    expect(useMonteCarloStore.getState().running).toBe(true) // only the task's own frame ends it

    await act(async () => { FakeWS.last!.emit({ type: 'cancelled', task_id: 't1' }) })
    expect(screen.queryByTestId('mc-progress')).toBeNull()
    expect(useMonteCarloStore.getState()).toMatchObject({ running: false, cancelled: true, cancelling: false })
  })

  it('a 404 while the task still runs is NOT "finished": it says so and offers Stop again', async () => {
    cancelStatus = 404
    const stop = await startRun()
    await act(async () => { fireEvent.click(stop) })

    const s = useMonteCarloStore.getState()
    expect(s.running).toBe(true)
    expect(s.cancelled).toBe(false)
    expect(screen.getByTestId('mc-progress-cancel-error').textContent).toMatch(/did not reach/)
    expect(screen.queryByTestId('mc-progress-cancelling')).toBeNull()
    const again = screen.getByTestId('mc-progress-cancel') as HTMLButtonElement
    expect(again.disabled).toBe(false)
    expect(again.textContent).toBe('Stop')
  })
})

describe('useCancellableTask (LCA Calculator multi-year, pLCA generate)', () => {
  it('a 404 while the task is still current goes back to running with an error, not idle', async () => {
    cancelStatus = 404
    const { result } = renderHook(() => useCancellableTask())
    act(() => result.current.begin('t1'))
    await act(async () => { await result.current.requestStop() })
    expect(result.current.state).toBe('running')
    expect(result.current.taskId).toBe('t1')
    expect(result.current.stopError).toMatch(/did not reach/)
    // The task's own terminal frame is what ends it.
    act(() => result.current.finish('t1'))
    expect(result.current.state).toBe('idle')
    expect(result.current.stopError).toBeNull()
  })

  it('a 200 stays "stopping" until the terminal frame', async () => {
    const { result } = renderHook(() => useCancellableTask())
    act(() => result.current.begin('t1'))
    await act(async () => { await result.current.requestStop() })
    expect(result.current.state).toBe('stopping')
    expect(result.current.stopError).toBeNull()
  })
})
