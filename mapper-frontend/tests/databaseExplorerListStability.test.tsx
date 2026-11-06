/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup, fireEvent, waitFor } from '@testing-library/react'

// The Database Explorer list, with the real virtualizer (@tanstack/react-virtual) and a
// stubbed layout: jsdom has none, so the scroll container is given a 400 px
// viewport and a settable scrollTop. This proves the LOGIC of the list (which rows
// are rendered where, whether the scroll position is reset or kept, which element
// survives an append). It cannot prove real layout, real scrolling or the webview:
// those are walked by hand.

const pending: { offset: number; search?: string; resolve: (p: any) => void }[] = []

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getActivities: vi.fn((_db: string, offset: number, _l: number, search?: string) =>
      new Promise((resolve) => { pending.push({ offset, search, resolve }) })),
    getActivityDistinctValues: vi.fn(async () => ({ locations: [], units: [] })),
  }
})

import { useProjectStore } from '../src/stores/projectStore'
import { useActivityStore } from '../src/stores/activityStore'
import { DatabaseExplorer } from '../src/pages/DatabaseExplorer'

const row = (name: string) => ({
  key: `('ecoinvent-3.11-cutoff', '${name}')`, code: name, name, product: name,
  location: 'GLO', unit: 'kilogram', database: 'ecoinvent-3.11-cutoff',
})
const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => row(`act-${from + i}`))

let scrollTo: ReturnType<typeof vi.fn>

beforeEach(() => {
  pending.length = 0
  ;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  // a 400 px high, 600 px wide scroll viewport for every element
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) } as DOMRect)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 400 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 600 })
  scrollTo = vi.fn(function (this: HTMLElement, opts: { top: number }) { this.scrollTop = opts.top })
  ;(Element.prototype as any).scrollTo = scrollTo
  useActivityStore.getState().reset()
  useProjectStore.setState({
    projects: [], currentProject: null, isLoading: false,
    databases: [{ name: 'ecoinvent-3.11-cutoff', records: 25000, modified: '', is_prospective: false, prospective_meta: null }],
  } as any)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const answer = async (i: number, items: any[], total: number) => {
  await act(async () => { pending[i].resolve({ items, total }) })
}
const scroller = (c: HTMLElement) => c.querySelector('[data-testid="db-row"]')!.parentElement!.parentElement as HTMLElement
const rowEls = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-testid="db-row"]')]
const scrollTo_ = async (el: HTMLElement, top: number) => {
  await act(async () => { el.scrollTop = top; fireEvent.scroll(el) })
}

async function mountWithFirstPage(total = 200) {
  const r = render(<DatabaseExplorer />)
  await waitFor(() => expect(pending.length).toBe(1))
  await answer(0, rows(0, 50), total)
  await waitFor(() => expect(rowEls(r.container).length).toBeGreaterThan(0))
  return r
}

describe('Database Explorer list: a result set that shrinks', () => {
  it('50 rows scrolled far down, then a search with one match: one row, at the top, scroll reset', async () => {
    const { container } = await mountWithFirstPage()
    const el = scroller(container)
    await scrollTo_(el, 1400)
    expect(el.scrollTop).toBe(1400)
    expect(rowEls(container).length).toBeGreaterThan(1)

    await act(async () => { useActivityStore.getState().searchActivities('polypropyle') })
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2)) // the scroll asked for page 2, then the search
    await answer(pending.length - 1, [row('polypropylene production')], 1)

    const shown = rowEls(container)
    expect(shown).toHaveLength(1)
    expect(shown[0].textContent).toContain('polypropylene production')
    expect(shown[0].style.top).toBe('0px')
    expect(scroller(container).scrollTop).toBe(0)
    // no two rendered rows share a position
    expect(new Set(rowEls(container).map((e) => e.style.top)).size).toBe(rowEls(container).length)
  })

  it('says "matching activities" for a narrowed list and never "matching filters"', async () => {
    const { container } = await mountWithFirstPage(146)
    expect(container.textContent).toContain('146 activities')
    await act(async () => { useActivityStore.getState().searchActivities('polypropyle') })
    await answer(pending.length - 1, rows(0, 50), 146)
    expect(container.textContent).toContain('146 matching activities')
    expect(container.textContent).not.toContain('matching filters')
    await act(async () => { useActivityStore.getState().searchActivities('zzzz') })
    await answer(pending.length - 1, [row('only one')], 1)
    expect(container.textContent).toContain('1 matching activity')
  })

  it('sorting alone is not "matching": the count stays "N activities"', async () => {
    const { container } = await mountWithFirstPage(146)
    await act(async () => { useActivityStore.getState().setSortBy('name_desc') })
    await answer(pending.length - 1, rows(0, 50), 146)
    expect(container.textContent).toContain('146 activities')
    expect(container.textContent).not.toContain('matching')
  })
})

describe('Database Explorer list: the next page is appended', () => {
  it('keeps the scroll position: no scroll back to the focused row when a page arrives', async () => {
    const { container } = await mountWithFirstPage()
    const el = scroller(container)
    // the user clicked a row near the top, then scrolled on
    await act(async () => { fireEvent.click(rowEls(container)[3]) })
    await scrollTo_(el, 1400)           // near the end of the 50 held rows: asks for page 2
    await waitFor(() => expect(pending.length).toBe(2))
    expect(pending[1].offset).toBe(50)
    scrollTo.mockClear()

    await answer(1, rows(50, 50), 200)

    expect(useActivityStore.getState().activities).toHaveLength(100)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(el.scrollTop).toBe(1400)
  })

  it('keeps each existing row element (stable keys), and React sees no duplicate key', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = await mountWithFirstPage()
    const before = new Map(rowEls(container).map((e) => [e.dataset.activityKey, e]))
    expect(before.size).toBeGreaterThan(3)

    await scrollTo_(scroller(container), 600)
    await waitFor(() => expect(pending.length).toBe(2))
    await answer(1, rows(50, 50), 200)

    for (const e of rowEls(container)) {
      const earlier = before.get(e.dataset.activityKey)
      if (earlier) expect(e).toBe(earlier) // same DOM node, not re-created
    }
    const keys = rowEls(container).map((e) => e.dataset.activityKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(errors.mock.calls.filter((c) => String(c[0]).includes('same key'))).toHaveLength(0)
  })

  it('a duplicate page (the same rows twice) does not create duplicate rows', async () => {
    const { container } = await mountWithFirstPage()
    await scrollTo_(scroller(container), 600)
    await waitFor(() => expect(pending.length).toBe(2))
    await answer(1, rows(0, 50), 200)                      // the server repeats page 1
    expect(useActivityStore.getState().activities).toHaveLength(50)
  })
})

describe('Database Explorer list: a stale response', () => {
  it('an old page that arrives after a new search does not reach the table', async () => {
    const { container } = await mountWithFirstPage()
    await scrollTo_(scroller(container), 1400)
    await waitFor(() => expect(pending.length).toBe(2))      // page 2 of the old list, in flight
    await act(async () => { useActivityStore.getState().searchActivities('poly') })
    const search = pending.length - 1
    await answer(search, [row('polyethylene')], 1)
    await answer(1, rows(50, 50), 200)                         // the old page lands last

    expect(rowEls(container).map((e) => e.textContent).join('|')).toContain('polyethylene')
    expect(rowEls(container)).toHaveLength(1)
    expect(container.textContent).toContain('1 matching activity')
  })
})
