/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// The Database Explorer's list is fed by activityStore. A page response used to be
// applied whatever query it was asked for, so a slow page of the previous search
// landed on the new search's rows, and its `finally` cleared `isLoading` while the
// new request ran. Pages are now applied only to the query they were asked for.

type Page = { items: ReturnType<typeof act>[]; total: number }
const calls: { offset: number; search?: string; signal?: AbortSignal; resolve: (p: Page) => void; reject: (e: unknown) => void }[] = []

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getActivityDistinctValues: vi.fn(async () => ({ locations: [], units: [] })),
    getActivities: vi.fn((_db: string, offset: number, _limit: number, search: string | undefined, _o: unknown, signal?: AbortSignal) =>
      new Promise<Page>((resolve, reject) => { calls.push({ offset, search, signal, resolve, reject }) })),
  }
})

import { useActivityStore } from '../src/stores/activityStore'

const act = (name: string, db = 'ei') => ({
  key: `('${db}', '${name}')`, code: name, name, location: 'GLO', unit: 'kg', product: name, database: db,
})
const page = (names: string[], total = names.length): Page => ({ items: names.map((n) => act(n)), total })
const flush = () => new Promise((r) => setTimeout(r, 0))
const state = () => useActivityStore.getState()

beforeEach(async () => {
  calls.length = 0
  state().reset()
  // select a database; its first page is asked for
  useActivityStore.setState({ selectedDatabase: 'ei' })
})

async function loadFirstPage(names: string[], total: number) {
  const p = state().fetchActivities()
  calls[calls.length - 1].resolve(page(names, total))
  await p
}

describe('activityStore paging', () => {
  it('appends the next page to the rows it already holds, in order, without a duplicate', async () => {
    await loadFirstPage(['a', 'b', 'c'], 6)
    const more = state().loadMore()
    expect(calls[calls.length - 1].offset).toBe(3)            // starts after the rows held
    calls[calls.length - 1].resolve(page(['c', 'd', 'e'], 6)) // 'c' repeated by the server
    await more
    expect(state().activities.map((a) => a.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(new Set(state().activities.map((a) => a.key)).size).toBe(state().activities.length)
    expect(state().offset).toBe(5)
  })

  it('a page of the previous search that arrives after a new search is ignored', async () => {
    await loadFirstPage(['old-1', 'old-2'], 100)
    const stale = state().loadMore()                         // page 2 of the old query, in flight
    const staleCall = calls[calls.length - 1]

    state().searchActivities('poly')                         // a new query
    const fresh = calls[calls.length - 1]
    expect(fresh.search).toBe('poly')
    expect(state().activities).toEqual([])

    fresh.resolve(page(['poly-1'], 1))
    await flush()
    staleCall.resolve(page(['old-3', 'old-4'], 100))         // the old page lands last
    await stale
    await flush()

    expect(state().activities.map((a) => a.name)).toEqual(['poly-1'])
    expect(state().totalActivities).toBe(1)
  })

  it('an old search that is answered after a newer one cannot overwrite it', async () => {
    state().searchActivities('a')
    const first = calls[calls.length - 1]
    state().searchActivities('ab')
    const second = calls[calls.length - 1]

    second.resolve(page(['ab-1'], 1))
    await flush()
    first.resolve(page(['a-1', 'a-2', 'a-3'], 3))
    await flush()

    expect(state().activities.map((a) => a.name)).toEqual(['ab-1'])
    expect(state().totalActivities).toBe(1)
  })

  it('the previous request is aborted when the query changes', async () => {
    state().searchActivities('a')
    const first = calls[calls.length - 1]
    expect(first.signal?.aborted).toBe(false)
    state().searchActivities('ab')
    expect(first.signal?.aborted).toBe(true)
    first.reject(new DOMException('aborted', 'AbortError'))  // must not surface as an error
    await flush()
    expect(state().isLoading).toBe(true)                     // the newer request is still running
  })

  it('a stale request settling does not clear isLoading while the newest one runs', async () => {
    await loadFirstPage(['a', 'b'], 100)
    const stale = state().loadMore()
    const staleCall = calls[calls.length - 1]
    state().searchActivities('x')
    staleCall.resolve(page(['c'], 100))
    await stale
    expect(state().isLoading).toBe(true)                     // 'x' is not answered yet
    // and so a scroll cannot start a second page request meanwhile
    const before = calls.length
    await state().loadMore()
    expect(calls.length).toBe(before)
    calls[calls.length - 1].resolve(page(['x-1'], 1))
    await flush()
    expect(state().isLoading).toBe(false)
  })

  it('a project reset drops a response that is still on its way', async () => {
    state().searchActivities('a')
    const pending = calls[calls.length - 1]
    state().reset()
    pending.resolve(page(['late'], 1))
    await flush()
    expect(state().activities).toEqual([])
  })
})
