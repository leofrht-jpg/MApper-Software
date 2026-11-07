/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { LCACalculator } from '../src/pages/LCACalculator'
import { Button } from '../src/components/ui/Button'
import { useBOMStore } from '../src/stores/bomStore'
import { useSessionStateStore } from '../src/stores/sessionStateStore'
import * as client from '../src/api/client'
import type { ActivityPage, ActivitySummary, DatabaseResponse, ActivityLCAResult } from '../src/api/client'

// LCA Architect > Single-product LCA. The supply chain tree is a slow, separate request
// (15 s to a minute on ecoinvent), so it is built only when the user clicks
// "Build supply chain tree", from a snapshot taken at Calculate. The tree panel itself is
// stubbed: what is under test is WHEN a request is made, with WHAT, and what happens to
// its response.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})
vi.mock('../src/components/lca/ContributionAnalysisPanel', () => ({
  ContributionAnalysisPanel: ({ result }: any) => (
    <div data-testid="tree-panel">{result.target_label}|{result.score}</div>
  ),
}))

const DBS: DatabaseResponse[] = [{ name: 'ei-3.10', size_mb: 100, activity_count: 20000 } as any]
const ACT: ActivitySummary = {
  key: 'ei-3.10|c1', code: 'c1', name: 'market for battery', product: 'battery', location: 'GLO', unit: 'kg', database: 'ei-3.10',
}
const METHODS = [{
  family: 'EF v3.1', categories: [{
    category: 'climate change',
    indicators: [{ indicator: 'GWP100', tuple: ['EF v3.1', 'climate change', 'GWP100'] }],
  }],
}]
const ACT_RESULT: ActivityLCAResult = {
  results: [{ method: ['EF v3.1', 'climate change', 'GWP100'], method_label: 'EF v3.1 › climate change › GWP100', score: 12.3, unit: 'kg CO2 eq', contributions: [] }],
  elapsed_seconds: 0.4,
} as any
const tree = (label: string): client.ContributionAnalysisResult => ({ target_label: label, score: 12.3 } as any)

type Pending = { body: any; signal: AbortSignal | undefined; resolve: (r: any) => void; reject: (e: unknown) => void }
let pending: Pending[]

beforeEach(() => {
  vi.restoreAllMocks()
  pending = []
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  useSessionStateStore.getState().reset()
  vi.spyOn(client, 'getDatabases').mockResolvedValue(DBS)
  vi.spyOn(client, 'getActivities').mockResolvedValue({ items: [ACT], total: 1 } as ActivityPage)
  vi.spyOn(client, 'searchAllActivities').mockResolvedValue([ACT])
  vi.spyOn(client, 'getMethods').mockResolvedValue(METHODS as any)
  vi.spyOn(client, 'calculateActivityLCA').mockResolvedValue(ACT_RESULT)
  vi.spyOn(client, 'runContributionAnalysis').mockImplementation(
    (body: any, signal?: AbortSignal) => new Promise((resolve, reject) => { pending.push({ body, signal, resolve, reject }) }),
  )
  useBOMStore.setState({ archetypes: [], folders: [], fetchArchetypes: vi.fn() } as any)
  const set = useSessionStateStore.getState().setValue
  set('lcaCalculator.fuMode', 'activity')
  set('lcaCalculator.actDemand', [{ act: ACT, amount: 1 }])
})
afterEach(() => { cleanup() })

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const setDemand = (amount: number) =>
  act(() => { useSessionStateStore.getState().setValue('lcaCalculator.actDemand', [{ act: ACT, amount }]) })

async function mount() {
  const utils = render(<LCACalculator />)
  await waitFor(() => expect(utils.container.querySelector('select')).not.toBeNull())
  return utils
}
async function calculate(c: HTMLElement) {
  const btn = Array.from(c.querySelectorAll('button')).find((b) => /^\s*Calculate/.test(b.textContent ?? '')) as HTMLButtonElement
  await waitFor(() => expect(btn.disabled).toBe(false))
  const before = vi.mocked(client.calculateActivityLCA).mock.calls.length
  await click(btn)
  await waitFor(() => expect(vi.mocked(client.calculateActivityLCA).mock.calls.length).toBe(before + 1))
  await waitFor(() => expect(q(c, 'lca-build-tree') || q(c, 'tree-panel')).not.toBeNull())
}
const answer = async (i: number, label = 'tree') => { await act(async () => { pending[i].resolve(tree(label)) }) }

describe('Supply chain tree: explicit button', () => {
  it('Calculate makes no tree request; the button and its hint are shown instead', async () => {
    const { container } = await mount()
    await calculate(container)
    await new Promise((r) => setTimeout(r, 50))
    expect(pending).toHaveLength(0)
    expect(client.runContributionAnalysis).not.toHaveBeenCalled()
    const btn = q(container, 'lca-build-tree') as HTMLButtonElement
    expect(btn.textContent).toContain('Build supply chain tree')
    expect(btn.disabled).toBe(false)
    expect(q(container, 'lca-tree-hint')!.textContent).toBe('Up to a minute on large databases.')
    expect(q(container, 'tree-panel')).toBeNull()
    expect(q(container, 'lca-activity-contribution-progress')).toBeNull()
  })

  it('one click is one request; the button is disabled and a real elapsed counter shows while it runs', async () => {
    const { container } = await mount()
    await calculate(container)
    await click(q(container, 'lca-build-tree')!)
    expect(pending).toHaveLength(1)

    const btn = q(container, 'lca-build-tree') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await click(btn)                       // a click on a disabled button does nothing
    expect(pending).toHaveLength(1)

    const progress = q(container, 'lca-activity-contribution-progress')!
    expect(progress.textContent).toContain('Building the supply chain tree…')
    expect(q(container, 'lca-activity-contribution-progress-elapsed')!.textContent).toMatch(/\d+:\d{2} elapsed/)
    // no invented phases
    for (const phase of ['Computing inventory', 'Top processes', 'Top emissions']) {
      expect(container.textContent).not.toContain(phase)
    }
    // honest wording: Discard, never Stop/Cancel
    expect(progress.textContent).toContain('Discard')
    expect(progress.textContent).not.toMatch(/\b(Stop|Cancel)\b/)
    expect(q(container, 'lca-tree-discard-note')).toBeNull()      // behind the (i) until opened
    await click(q(container, 'lca-tree-discard-info')!)
    expect(q(container, 'lca-tree-discard-note')!.textContent).toContain('The server may keep computing')

    await answer(0)
    await waitFor(() => expect(q(container, 'tree-panel')).not.toBeNull())
    expect(q(container, 'lca-build-tree')).toBeNull()
    expect(client.runContributionAnalysis).toHaveBeenCalledTimes(1)
  })

  it('the request uses the Calculate-time snapshot, not the live inputs', async () => {
    const { container } = await mount()
    await calculate(container)            // calculated with amount 1
    await setDemand(5)                    // the user edits the amount afterwards, without recalculating
    await click(q(container, 'lca-build-tree')!)
    expect(pending).toHaveLength(1)
    expect(pending[0].body).toMatchObject({
      target_type: 'activity', database: 'ei-3.10', code: 'c1', amount: 1,
      method: ['EF v3.1', 'climate change', 'GWP100'],
    })
    // the score on screen is still for 1 unit of the one activity
    await answer(0)
    await waitFor(() => expect(q(container, 'tree-panel')).not.toBeNull())
  })

  it('a cached tree shows at once, without a request, when the page is opened again', async () => {
    const first = await mount()
    await calculate(first.container)
    await click(q(first.container, 'lca-build-tree')!)
    await answer(0, 'cached-tree')
    await waitFor(() => expect(q(first.container, 'tree-panel')).not.toBeNull())
    first.unmount()

    const { container } = await mount()   // session state keeps the result, snapshot and cache
    await waitFor(() => expect(q(container, 'tree-panel')).not.toBeNull())
    expect(q(container, 'tree-panel')!.textContent).toContain('cached-tree')
    expect(q(container, 'lca-build-tree')).toBeNull()
    expect(client.runContributionAnalysis).toHaveBeenCalledTimes(1)
  })

  it('a new Calculate with different inputs shows the button again, never the old tree', async () => {
    const { container } = await mount()
    await calculate(container)
    await click(q(container, 'lca-build-tree')!)
    await answer(0, 'tree-for-1')
    await waitFor(() => expect(q(container, 'tree-panel')).not.toBeNull())

    await setDemand(2)
    await calculate(container)            // new snapshot (amount 2)
    expect(q(container, 'tree-panel')).toBeNull()
    expect(q(container, 'lca-build-tree')).not.toBeNull()
    expect(client.runContributionAnalysis).toHaveBeenCalledTimes(1)   // and nothing was requested by itself
  })

  it('a recalculation discards the request in flight; its late response is ignored', async () => {
    const { container } = await mount()
    await calculate(container)
    await click(q(container, 'lca-build-tree')!)
    expect(pending[0].signal!.aborted).toBe(false)

    await setDemand(2)
    await calculate(container)
    expect(pending[0].signal!.aborted).toBe(true)

    await answer(0, 'late-tree')          // the old response arrives after the recalculation
    await new Promise((r) => setTimeout(r, 30))
    expect(q(container, 'tree-panel')).toBeNull()
    expect(q(container, 'lca-build-tree')).not.toBeNull()
    expect((q(container, 'lca-build-tree') as HTMLButtonElement).disabled).toBe(false)
    expect(pending).toHaveLength(1)
  })

  it('"Discard" ends the wait, says the server may keep going, and ignores the late response', async () => {
    const { container } = await mount()
    await calculate(container)
    await click(q(container, 'lca-build-tree')!)
    const discard = Array.from(q(container, 'lca-activity-contribution-progress')!.querySelectorAll('button'))
      .find((b) => b.textContent === 'Discard')!
    await click(discard)

    expect(pending[0].signal!.aborted).toBe(true)
    expect(q(container, 'lca-activity-contribution-progress')).toBeNull()
    expect(q(container, 'lca-tree-discarded')!.textContent).toContain('The server may still be computing it')
    await answer(0, 'late')
    await new Promise((r) => setTimeout(r, 30))
    expect(q(container, 'tree-panel')).toBeNull()
    // the button works again
    await click(q(container, 'lca-build-tree')!)
    expect(pending).toHaveLength(2)
  })

  it('leaving the page discards the request in flight', async () => {
    const { container, unmount } = await mount()
    await calculate(container)
    await click(q(container, 'lca-build-tree')!)
    unmount()
    expect(pending[0].signal!.aborted).toBe(true)
  })

  it('an error shows the red line and a "Try again" button that asks once more', async () => {
    const { container } = await mount()
    await calculate(container)
    await click(q(container, 'lca-build-tree')!)
    await act(async () => { pending[0].reject(new Error('backend exploded')) })

    expect(q(container, 'lca-tree-error')!.textContent).toContain('Contribution analysis failed: backend exploded')
    const retry = q(container, 'lca-build-tree') as HTMLButtonElement
    expect(retry.textContent).toContain('Try again')
    expect(retry.disabled).toBe(false)
    await click(retry)
    expect(pending).toHaveLength(2)
    await answer(1)
    await waitFor(() => expect(q(container, 'tree-panel')).not.toBeNull())
    expect(q(container, 'lca-tree-error')).toBeNull()
  })
})

describe('LCA Architect: Export XLSX header button', () => {
  it('is the standard Button, secondary, with no inline overrides', async () => {
    const ref = render(<Button variant="secondary">x</Button>)
    const reference = (ref.container.querySelector('button') as HTMLElement).style.cssText
    ref.unmount()

    const set = useSessionStateStore.getState().setValue
    set('lcaCalculator.fuMode', 'archetype')
    set('lcaCalculator.arcResults', [{
      archetype_id: 'a1', archetype_name: 'BEV-LFP', scope: 'all', amount: 1, stage_amounts: {}, stages_included: [],
      results: [{ method: ['EF v3.1', 'climate change', 'GWP100'], method_label: 'EF', score: 1, unit: 'kg', contributions: [] }],
      elapsed_seconds: 1,
    }])
    const { container } = await mount()
    const btn = Array.from(container.querySelectorAll('button')).find((b) => /Export XLSX/.test(b.textContent ?? '')) as HTMLElement
    expect(btn).toBeTruthy()
    expect(btn.style.cssText).toBe(reference)
  })
})
