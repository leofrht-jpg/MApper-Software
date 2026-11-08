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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LCACalculator } from '../src/pages/LCACalculator'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { SingleProductStaticPanel } from '../src/components/impact/SingleProductStaticPanel'
import { SingleProductProjectedPanel } from '../src/components/impact/SingleProductProjectedPanel'
import { ComputeOverlay, OVERLAY_REVEAL_MS } from '../src/components/ui/ComputeOverlay'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { useSessionStateStore } from '../src/stores/sessionStateStore'
import { useParameterStore } from '../src/stores/parameterStore'
import { useBOMStore } from '../src/stores/bomStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import * as client from '../src/api/client'
import type { ActivityLCAResult, ActivitySummary, ArchetypeLCACalculateResult, MultiProductLCAResult } from '../src/api/client'

// "Stop waiting" on the Calculating-LCA overlays: it ends the SCREEN's wait. The server cannot
// cancel (a thread), so every request here is a promise the test holds open. Mocks and
// synthetic results only; no project, database or network is touched.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const GWP = ['EF v3.1', 'climate change', 'GWP100']
const METHODS = [{
  family: 'EF v3.1', categories: [{ category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: GWP }] }],
}]
const ACT: ActivitySummary = {
  key: 'ei-3.10|c1', code: 'c1', name: 'market for battery', product: 'battery', location: 'GLO', unit: 'kg', database: 'ei-3.10',
}
const ACT_RESULT = {
  results: [{ method: GWP, method_label: 'GWP100', score: 12.3, unit: 'kg CO2 eq', contributions: [] }],
  elapsed_seconds: 0.4,
} as unknown as ActivityLCAResult
const archRes = (id: string, name: string): ArchetypeLCACalculateResult => ({
  archetype_id: id, archetype_name: name, scope: 'all', amount: 1, stage_amounts: {}, stages_included: [],
  results: [{ method: GWP, method_label: 'GWP100', score: 10, unit: 'kg CO2-eq', contributions: [] }],
  elapsed_seconds: 1, compute_database: null, parameter_scenario: null, warnings: [], stage_breakdown: null,
} as unknown as ArchetypeLCACalculateResult)
const multiRes = { items: [], success_count: 1, error_count: 0 } as unknown as MultiProductLCAResult

type Pending<T> = { signal: AbortSignal | undefined; resolve: (r: T) => void; reject: (e: unknown) => void }
function held<T>(opts: { ignoreAbort?: boolean } = {}): { pending: Pending<T>[]; impl: (...a: any[]) => Promise<T> } {
  const pending: Pending<T>[] = []
  const impl = (...a: any[]) => {
    const signal = [...a].reverse().find((x) => x && typeof x === 'object' && 'aborted' in x)
      ?? a.find((x) => x && typeof x === 'object' && x.signal)?.signal
    return new Promise<T>((resolve, reject) => {
      pending.push({ signal, resolve, reject })
      if (!opts.ignoreAbort) signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
  }
  return { pending, impl }
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useSessionStateStore.getState().reset()
  useMultiProductLCAStore.getState().reset()
  useSingleProductImpactStore.getState().reset()
  useParameterStore.setState({ table: null, selectedScenarios: [] } as any)
  useBOMStore.setState({ archetypes: [], folders: [], fetchArchetypes: vi.fn() } as any)
  usePLCAStore.setState({ databases: [] } as any)
  useActivityStore.setState({ activities: [], selectedDatabase: 'ei-3.10', searchActivities: vi.fn(), setDatabase: vi.fn() } as any)
  useProjectStore.setState({ databases: [{ name: 'ei-3.10', size_mb: 1, activity_count: 1 } as any] } as any)
  vi.spyOn(client, 'getDatabases').mockResolvedValue([{ name: 'ei-3.10', size_mb: 100, activity_count: 20000 } as any])
  vi.spyOn(client, 'getActivities').mockResolvedValue({ items: [ACT], total: 1 } as any)
  vi.spyOn(client, 'searchAllActivities').mockResolvedValue([ACT])
  vi.spyOn(client, 'getMethods').mockResolvedValue(METHODS as any)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const card = (id: string) => screen.queryByTestId(`${id}-card`)
const stopBtn = (id: string) => screen.queryByTestId(`${id}-cancel`) as HTMLButtonElement | null
const waitCard = (id: string) => waitFor(() => expect(card(id)).not.toBeNull(), { timeout: 3000 })

// ── The overlay itself ───────────────────────────────────────────────────────

describe('ComputeOverlay: the caller can add its own note, and a slow-run note', () => {
  it('shows the caller note under the button; the Monte Carlo wording is unchanged without it', async () => {
    const { rerender } = render(<ComputeOverlay active title="t" onCancel={() => {}} cancelNote="my note" data-testid="o" />)
    await waitCard('o')
    expect(screen.getByTestId('o-cancel-note').textContent).toBe('my note')
    rerender(<ComputeOverlay active title="t" onCancel={() => {}} cancelling data-testid="o" />)
    expect(screen.queryByTestId('o-cancel-note')).toBeNull()
    expect(screen.getByTestId('o-cancelling').textContent).toBe('Stopping: the calculation ends at its next checkpoint.')
  })

  it('adds the slow-run note to the detail line only after 20 seconds', async () => {
    vi.useFakeTimers()
    try {
      render(<ComputeOverlay active title="t" detail="1 indicator" slowNote="Large databases can take a few minutes." data-testid="o" />)
      await act(async () => { vi.advanceTimersByTime(OVERLAY_REVEAL_MS + 10) })
      expect(screen.getByTestId('o-detail').textContent).toBe('1 indicator')
      await act(async () => { vi.advanceTimersByTime(21_000) })
      expect(screen.getByTestId('o-detail').textContent).toContain('Large databases can take a few minutes.')
    } finally { vi.useRealTimers() }
  })
})

// ── LCA Architect: activity mode ─────────────────────────────────────────────

describe('LCA Architect, activity mode', () => {
  async function start(opts: { ignoreAbort?: boolean } = {}) {
    const h = held<ActivityLCAResult>(opts)
    vi.spyOn(client, 'calculateActivityLCA').mockImplementation(h.impl as any)
    const set = useSessionStateStore.getState().setValue
    set('lcaCalculator.fuMode', 'activity')
    set('lcaCalculator.actDemand', [{ act: ACT, amount: 1 }])
    const utils = render(<LCACalculator />)
    await waitFor(() => expect(utils.container.querySelector('select')).not.toBeNull())
    const btn = () => Array.from(utils.container.querySelectorAll('button')).find((b) => /^\s*Calculate/.test(b.textContent ?? '')) as HTMLButtonElement
    await waitFor(() => expect(btn().disabled).toBe(false))
    await act(async () => { fireEvent.click(btn()) })
    await waitFor(() => expect(h.pending.length).toBe(1))
    return { ...utils, h, btn }
  }

  it('the button is there from the first frame the card shows, and clicking it aborts the request', async () => {
    const { h } = await start()
    await waitCard('activity-lca-progress')
    const b = stopBtn('activity-lca-progress')!
    expect(b.textContent).toBe('Stop waiting')
    expect(screen.getByTestId('activity-lca-progress-cancel-note').textContent)
      .toBe('The calculation may keep running in the background; the next one can take longer.')
    await act(async () => { fireEvent.click(b) })
    expect(h.pending[0].signal!.aborted).toBe(true)
    expect(screen.queryByTestId('activity-lca-progress')).toBeNull()
    expect(screen.getByTestId('activity-lca-stopped').textContent).toMatch(/^Stopped/)
    expect(screen.queryByTestId('lca-error')).toBeNull()
  })

  it('a late resolution after Stop never reaches the screen', async () => {
    // The request ignores the abort and resolves anyway (as a response already on the wire would).
    const { h, container } = await start({ ignoreAbort: true })
    await waitCard('activity-lca-progress')
    await act(async () => { fireEvent.click(stopBtn('activity-lca-progress')!) })
    await act(async () => { h.pending[0].resolve(ACT_RESULT) })
    expect(container.querySelector('[data-testid="lca-build-tree"]')).toBeNull()
    expect(screen.getByTestId('activity-lca-stopped')).toBeInTheDocument()
    expect(screen.queryByTestId('activity-lca-progress')).toBeNull()
  })

  it('an aborted request never shows as an error', async () => {
    const { container } = await start()
    await waitCard('activity-lca-progress')
    await act(async () => { fireEvent.click(stopBtn('activity-lca-progress')!) })
    expect(container.textContent).not.toMatch(/abort/i)
  })

  it('the next calculation starts clean, with the timer at 0:00 and no Stopped line', async () => {
    const { h, btn } = await start()
    await waitCard('activity-lca-progress')
    await act(async () => { fireEvent.click(stopBtn('activity-lca-progress')!) })
    await act(async () => { fireEvent.click(btn()) })
    await waitFor(() => expect(h.pending.length).toBe(2))
    await waitCard('activity-lca-progress')
    expect(screen.queryByTestId('activity-lca-stopped')).toBeNull()
    expect(screen.getByTestId('activity-lca-progress-elapsed').textContent).toContain('0:00')
    expect(h.pending[1].signal!.aborted).toBe(false)
  })

  it('a response that arrives before Stop shows its result as normal', async () => {
    const { h, container } = await start()
    await act(async () => { h.pending[0].resolve(ACT_RESULT) })
    await waitFor(() => expect(container.querySelector('[data-testid="lca-build-tree"]')).not.toBeNull())
    expect(screen.queryByTestId('activity-lca-stopped')).toBeNull()
  })

  it('leaving the page aborts the request and sets no state afterwards', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { h, unmount } = await start()
    unmount()
    expect(h.pending[0].signal!.aborted).toBe(true)
    await act(async () => { h.pending[0].resolve(ACT_RESULT) })
    expect(err).not.toHaveBeenCalled()
  })
})

// ── LCA Architect: archetype mode, parallel requests ─────────────────────────

describe('LCA Architect, archetype mode', () => {
  it('one Stop aborts every parallel request', async () => {
    const h = held<ArchetypeLCACalculateResult>()
    vi.spyOn(client, 'calculateArchetypeLCA').mockImplementation(h.impl as any)
    const arcs = [{ id: 'a1', name: 'BEV', folder_id: null }, { id: 'a2', name: 'ICEV', folder_id: null }]
    useBOMStore.setState({ archetypes: arcs, folders: [], fetchArchetypes: vi.fn() } as any)
    const set = useSessionStateStore.getState().setValue
    set('lcaCalculator.fuMode', 'archetype')
    set('lcaCalculator.selectedArchetypes', arcs)
    const { container } = render(<LCACalculator />)
    await waitFor(() => expect(container.querySelector('select')).not.toBeNull())
    const calc = () => Array.from(container.querySelectorAll('button')).find((b) => /^\s*Calculate/.test(b.textContent ?? '')) as HTMLButtonElement
    await waitFor(() => expect(calc().disabled).toBe(false), { timeout: 3000 })
    await act(async () => { fireEvent.click(calc()) })
    await waitFor(() => expect(h.pending.length).toBe(2))
    await waitCard('archetype-lca-progress')
    await act(async () => { fireEvent.click(stopBtn('archetype-lca-progress')!) })
    expect(h.pending.every((p) => p.signal!.aborted)).toBe(true)
    expect(screen.getByTestId('archetype-lca-stopped')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/abort/i)
    await act(async () => { h.pending[0].resolve(archRes('a1', 'BEV')) })
    expect(container.querySelector('[data-testid="lca-build-tree"]')).toBeNull()
  })
})

// ── Multi-item ───────────────────────────────────────────────────────────────

describe('Multi-item comparison', () => {
  it('Stop waiting aborts the request, ends the loop over cases and applies nothing', async () => {
    const h = held<MultiProductLCAResult>()
    vi.spyOn(client, 'calculateMultiProductLCA').mockImplementation(h.impl as any)
    render(<MultiProductLCA />)
    const item = { type: 'archetype', archetype_id: 'a1', name: 'BEV' } as any
    act(() => { useMultiProductLCAStore.getState().addItem(item) })
    let done: Promise<void>
    act(() => { done = useMultiProductLCAStore.getState().compute({ scope: 'all', methods: [GWP], cases: ['sa_early'] }) })
    await waitFor(() => expect(h.pending.length).toBe(1))
    await waitCard('multi-product-compute-progress')
    await act(async () => { fireEvent.click(stopBtn('multi-product-compute-progress')!) })
    expect(h.pending[0].signal!.aborted).toBe(true)
    await act(async () => { await done })
    expect(h.pending.length).toBe(1)                       // the second case was never requested
    expect(useMultiProductLCAStore.getState().multiResult).toBeNull()
    expect(useMultiProductLCAStore.getState().multiError).toBeNull()
    expect(screen.getByTestId('multi-product-stopped')).toBeInTheDocument()
    // a late response is ignored
    await act(async () => { h.pending[0].resolve(multiRes) })
    expect(useMultiProductLCAStore.getState().multiResult).toBeNull()
  })

  it('a project switch (reset) abandons the run and clears the Stopped flag', async () => {
    const h = held<MultiProductLCAResult>()
    vi.spyOn(client, 'calculateMultiProductLCA').mockImplementation(h.impl as any)
    act(() => { useMultiProductLCAStore.getState().addItem({ type: 'archetype', archetype_id: 'a1', name: 'BEV' } as any) })
    act(() => { void useMultiProductLCAStore.getState().compute({ scope: 'all', methods: [GWP] }) })
    await waitFor(() => expect(h.pending.length).toBe(1))
    act(() => { useMultiProductLCAStore.getState().reset() })
    expect(h.pending[0].signal!.aborted).toBe(true)
    await act(async () => { h.pending[0].resolve(multiRes) })
    expect(useMultiProductLCAStore.getState().multiResult).toBeNull()
  })
})

// ── Single item: Static and Prospective loops ────────────────────────────────

describe('Single item, Static: sequential sensitivity cases', () => {
  it('Stop waiting aborts the case in flight, requests no further case and shows no result', async () => {
    const h = held<ArchetypeLCACalculateResult>()
    vi.spyOn(client, 'calculateArchetypeLCA').mockImplementation(h.impl as any)
    useParameterStore.setState({
      table: { parameters: { p1: { name: 'p1', base_value: 1, scenario_overrides: { sa_early: 2 } } }, scenarios: ['sa_early'], categories: [] },
      selectedScenarios: ['sa_early'],
    } as any)
    const { container } = render(<SingleProductStaticPanel archetypeId="a1" />)
    const calc = await screen.findByTestId('single-product-static-calculate')
    await waitFor(() => expect(calc).not.toBeDisabled(), { timeout: 4000 })
    await act(async () => { fireEvent.click(calc) })
    await waitFor(() => expect(h.pending.length).toBe(1))
    await act(async () => { h.pending[0].resolve(archRes('a1', 'BEV')) })     // Base is done
    await waitFor(() => expect(h.pending.length).toBe(2))                       // sa_early in flight
    await waitCard('single-product-static-progress')
    await act(async () => { fireEvent.click(stopBtn('single-product-static-progress')!) })
    expect(h.pending[1].signal!.aborted).toBe(true)
    expect(h.pending.length).toBe(2)
    expect(screen.getByTestId('single-product-static-stopped')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/abort/i)
    expect(container.querySelector('[data-testid="single-product-static-export"]')).toBeNull()   // nothing applied, not even Base
    await act(async () => { h.pending[1].resolve(archRes('a1', 'BEV')) })
    expect(container.querySelector('[data-testid="single-product-static-export"]')).toBeNull()
  })
})

describe('Single item, Prospective: sequential background databases', () => {
  it('Stop waiting aborts the database in flight, requests no further one and shows no result', async () => {
    const h = held<ArchetypeLCACalculateResult>()
    vi.spyOn(client, 'calculateArchetypeLCA').mockImplementation(h.impl as any)
    const dbs = [2030, 2040].map((year) => ({
      name: `ei310-remind-ssp2-${year}`, base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-PkBudg1150',
      year, years: [year], mode: 'separate', created_at: '2026-01-01',
    }))
    usePLCAStore.setState({ databases: dbs } as any)
    useSingleProductImpactStore.getState().setProjectedConfigForArc('a1', {
      scope: 'all', selectedMethods: [GWP], selectedDbs: dbs.map((d) => d.name),
    } as any)
    const { container } = render(<SingleProductProjectedPanel archetypeId="a1" />)
    const calc = await screen.findByTestId('single-product-projected-calculate')
    await waitFor(() => expect(calc).not.toBeDisabled(), { timeout: 4000 })
    await act(async () => { fireEvent.click(calc) })
    await waitFor(() => expect(h.pending.length).toBe(1))
    await act(async () => { h.pending[0].resolve(archRes('a1', 'BEV')) })
    await waitFor(() => expect(h.pending.length).toBe(2))
    await waitCard('single-product-projected-progress')
    await act(async () => { fireEvent.click(stopBtn('single-product-projected-progress')!) })
    expect(h.pending[1].signal!.aborted).toBe(true)
    expect(screen.getByTestId('single-product-projected-stopped')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/abort/i)
    await act(async () => { h.pending[1].resolve(archRes('a1', 'BEV')) })
    expect(container.querySelector('[data-testid="single-product-projected-export"]')).toBeNull()
    expect(h.pending.length).toBe(2)
  })
})
