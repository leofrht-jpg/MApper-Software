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
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { MAX_CACHED_TREES, useSupplyChainTrees } from '../src/hooks/useSupplyChainTrees'
import { SingleProductStaticPanel } from '../src/components/impact/SingleProductStaticPanel'
import { SingleProductProjectedPanel } from '../src/components/impact/SingleProductProjectedPanel'
import { SingleProductComparisonPanel } from '../src/components/impact/SingleProductComparisonPanel'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import { useParameterStore } from '../src/stores/parameterStore'
import { useSessionStateStore } from '../src/stores/sessionStateStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { methodKey } from '../src/utils/methodLabels'
import * as client from '../src/api/client'
import { relPosix } from './helpers/relPosix'
import type {
  ArchetypeLCACalculateResult, ContributionAnalysisResult, MultiProductItemResult, MultiProductLCAResult,
} from '../src/api/client'

// The supply chain tree in Impact Assessment is an explicit button: Single item > Static and
// the Multi-item results, nothing else. These tests drive the real panels with synthetic
// results; no project, database or network is touched. jsdom cannot show the real 16-60 s
// cost, the layout, or the abort in the Tauri webview (see the PR description).

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

// The tree panel itself is heavy (Sankey, tabs) and covered elsewhere; a stub that names what
// it was given is enough to tell WHICH item's tree is on screen.
vi.mock('../src/components/lca/ContributionAnalysisPanel', () => ({
  ContributionAnalysisPanel: ({ result }: { result: ContributionAnalysisResult }) => (
    <div data-testid="tree-panel">{result.target_label}|{result.method.join('>')}|{result.parameter_scenario ?? 'none'}</div>
  ),
}))

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getMethods: vi.fn(async () => []),
    calculateArchetypeLCA: vi.fn(),
    runContributionAnalysis: vi.fn(),
  }
})

const GWP = ['EF v3.1', 'climate change', 'global warming potential (GWP100)']
const ACID = ['EF v3.1', 'acidification', 'accumulated exceedance (AE)']
const ECHO = { Manufacturing: 1, 'Use Phase': 15 }

function archRes(id: string, name: string, over: Partial<ArchetypeLCACalculateResult> = {}): ArchetypeLCACalculateResult {
  return {
    archetype_id: id, archetype_name: name, scope: 'all', amount: 1,
    stage_amounts: { ...ECHO }, stages_included: ['Manufacturing', 'Use Phase'],
    results: [
      { method: GWP, method_label: 'climate change › GWP100', score: 10, unit: 'kg CO2-eq', contributions: [] },
      { method: ACID, method_label: 'acidification › AE', score: 2, unit: 'mol H+-eq', contributions: [] },
    ],
    elapsed_seconds: 1, compute_database: null, parameter_scenario: null, warnings: [], stage_breakdown: null,
    ...over,
  } as ArchetypeLCACalculateResult
}

function tree(label: string, method: string[] = GWP, scenario: string | null = null): ContributionAnalysisResult {
  return { target_type: 'archetype', target_label: label, method, parameter_scenario: scenario } as any
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const run = () => vi.mocked(client.runContributionAnalysis)
const buildBtn = (prefix: string) => screen.queryByTestId(`${prefix}-build-tree`) as HTMLButtonElement | null

beforeEach(() => {
  vi.restoreAllMocks()
  run().mockReset()
  // @ts-expect-error jsdom stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useSingleProductImpactStore.getState().reset()
  useMultiProductLCAStore.getState().reset()
  useSessionStateStore.getState().reset()
  useParameterStore.setState({ table: null, selectedScenarios: [] } as any)
  useBOMStore.setState({ archetypes: [], fetchArchetypes: vi.fn(async () => {}) } as any)
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-PkBudg1150',
      year: 2030, years: [2030], mode: 'separate', created_at: '2026-01-01',
    }] as any,
  })
  useActivityStore.setState({
    activities: [], selectedDatabase: 'ei-3.10', searchActivities: vi.fn(), setDatabase: vi.fn(),
  } as any)
  useProjectStore.setState({ databases: [{ name: 'ei-3.10', size_mb: 1, activity_count: 1 } as any] } as any)
})

afterEach(() => { vi.restoreAllMocks() })

// ── Single item · Static ─────────────────────────────────────────────────────

const S = 'single-product-static'

function seedStatic(cases: Record<string, ArchetypeLCACalculateResult>, active = 'Base', runId = 1) {
  const set = useSessionStateStore.getState().setValue
  useSingleProductImpactStore.getState().setArchetypeId('a1')
  set('singleProduct.static.a1.results', cases)
  set('singleProduct.static.a1.order', Object.keys(cases))
  set('singleProduct.static.a1.active', active)
  set('singleProduct.static.a1.runId', runId)
}

describe('Static: the tree is a button, never automatic', () => {
  it('a real Calculate makes no tree request and then offers the button', async () => {
    vi.mocked(client.getMethods).mockResolvedValue([{
      family: 'EF v3.1',
      categories: [{ category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: GWP }] }],
    }] as any)
    vi.mocked(client.calculateArchetypeLCA).mockResolvedValue(archRes('a1', 'BEV'))
    render(<SingleProductStaticPanel archetypeId="a1" />)
    const calc = await screen.findByTestId('single-product-static-calculate')
    await waitFor(() => expect(calc).not.toBeDisabled(), { timeout: 4000 })
    fireEvent.click(calc)
    await waitFor(() => expect(buildBtn(S)).not.toBeNull(), { timeout: 5000 })
    expect(client.calculateArchetypeLCA).toHaveBeenCalledTimes(1)
    expect(run()).not.toHaveBeenCalled()
    expect(screen.queryByTestId('tree-panel')).toBeNull()
  })

  it('exactly one request per click, and the button is disabled while it runs', async () => {
    seedStatic({ Base: archRes('a1', 'BEV') })
    const d = deferred<ContributionAnalysisResult>()
    run().mockReturnValue(d.promise)
    render(<SingleProductStaticPanel archetypeId="a1" />)
    const b = buildBtn(S)!
    fireEvent.click(b)
    fireEvent.click(b)
    fireEvent.click(buildBtn(S)!)
    expect(run()).toHaveBeenCalledTimes(1)
    expect(buildBtn(S)).toBeDisabled()
    expect(screen.getByTestId('single-product-static-contribution-progress')).toBeInTheDocument()
    await act(async () => { d.resolve(tree('BEV')) })
    await waitFor(() => expect(screen.getByTestId('tree-panel')).toBeInTheDocument())
    expect(run()).toHaveBeenCalledTimes(1)
  })

  it('carries the frozen stage amounts and the case, even if the live inputs changed after the run', async () => {
    seedStatic({ Base: archRes('a1', 'BEV'), sa_early: archRes('a1', 'BEV', { parameter_scenario: 'sa_early' }) }, 'sa_early')
    // The editor now holds different amounts than the result was calculated with.
    useSingleProductImpactStore.setState({
      stageAmountsByArc: { a1: { preset: 'custom', lifetime: null, amounts: { Manufacturing: 1, 'Use Phase': 99 } } },
    } as any)
    run().mockResolvedValue(tree('BEV'))
    render(<SingleProductStaticPanel archetypeId="a1" />)
    fireEvent.click(buildBtn(S)!)
    await waitFor(() => expect(run()).toHaveBeenCalledTimes(1))
    const body = run().mock.calls[0][0] as any
    expect(body.target_type).toBe('archetype')
    expect(body.archetype_id).toBe('a1')
    expect(body.scope).toBe('all')
    expect(body.stage_amounts).toEqual(ECHO)             // the result's echo, not the live 99
    expect(body.parameter_scenario).toBe('sa_early')     // the active case
    expect(body.method).toEqual(GWP)
    expect(run().mock.calls[0][1]).toBeInstanceOf(AbortSignal)
  })

  it('Base is sent as no scenario, and the indicator picked is the one requested', async () => {
    seedStatic({ Base: archRes('a1', 'BEV') })
    run().mockResolvedValue(tree('BEV', ACID))
    render(<SingleProductStaticPanel archetypeId="a1" />)
    fireEvent.change(screen.getByTestId(`${S}-tree-indicator`), { target: { value: methodKey(ACID) } })
    fireEvent.click(buildBtn(S)!)
    await waitFor(() => expect(run()).toHaveBeenCalledTimes(1))
    const body = run().mock.calls[0][0] as any
    expect(body.parameter_scenario).toBeNull()
    expect(body.method).toEqual(ACID)
  })

  it('keeps one tree per case: another case offers the button again, the first is still cached', async () => {
    seedStatic({ Base: archRes('a1', 'BEV'), sa_early: archRes('a1', 'BEV', { parameter_scenario: 'sa_early' }) })
    run().mockResolvedValueOnce(tree('BEV', GWP, null))
    render(<SingleProductStaticPanel archetypeId="a1" />)
    fireEvent.click(buildBtn(S)!)
    await waitFor(() => expect(screen.getByTestId('tree-panel').textContent).toContain('|none'))

    const tabs = screen.getByTestId('single-product-static-scenario-tabs')
    fireEvent.click(within(tabs).getByText('sa_early'))
    expect(screen.queryByTestId('tree-panel')).toBeNull()      // not Base's tree
    expect(buildBtn(S)).not.toBeNull()
    expect(run()).toHaveBeenCalledTimes(1)                      // switching built nothing

    fireEvent.click(within(tabs).getByText('Base'))
    expect(screen.getByTestId('tree-panel')).toBeInTheDocument() // cached, no new request
    expect(run()).toHaveBeenCalledTimes(1)
  })

  it('a recalculation (new run id) never shows the previous run\'s tree', async () => {
    seedStatic({ Base: archRes('a1', 'BEV') }, 'Base', 1)
    run().mockResolvedValue(tree('BEV'))
    const view = render(<SingleProductStaticPanel archetypeId="a1" />)
    fireEvent.click(buildBtn(S)!)
    await waitFor(() => expect(screen.getByTestId('tree-panel')).toBeInTheDocument())
    view.unmount()
    // Same inputs, calculated again: a different run.
    seedStatic({ Base: archRes('a1', 'BEV') }, 'Base', 2)
    render(<SingleProductStaticPanel archetypeId="a1" />)
    expect(screen.queryByTestId('tree-panel')).toBeNull()
    expect(buildBtn(S)).not.toBeNull()
  })
})

describe('Static: abort, late responses, errors', () => {
  it('aborts on a case change and ignores the late response', async () => {
    seedStatic({ Base: archRes('a1', 'BEV'), sa_early: archRes('a1', 'BEV', { parameter_scenario: 'sa_early' }) })
    const d = deferred<ContributionAnalysisResult>()
    run().mockReturnValue(d.promise)
    render(<SingleProductStaticPanel archetypeId="a1" />)
    fireEvent.click(buildBtn(S)!)
    const signal = run().mock.calls[0][1] as AbortSignal
    expect(signal.aborted).toBe(false)
    fireEvent.click(within(screen.getByTestId('single-product-static-scenario-tabs')).getByText('sa_early'))
    expect(signal.aborted).toBe(true)
    await act(async () => { d.resolve(tree('LATE')) })
    expect(screen.queryByTestId('tree-panel')).toBeNull()
    fireEvent.click(within(screen.getByTestId('single-product-static-scenario-tabs')).getByText('Base'))
    expect(screen.queryByTestId('tree-panel')).toBeNull()   // the late answer was dropped, not cached
  })

  it('aborts on an indicator change', async () => {
    seedStatic({ Base: archRes('a1', 'BEV') })
    run().mockReturnValue(new Promise(() => {}))
    render(<SingleProductStaticPanel archetypeId="a1" />)
    fireEvent.click(buildBtn(S)!)
    const signal = run().mock.calls[0][1] as AbortSignal
    fireEvent.change(screen.getByTestId(`${S}-tree-indicator`), { target: { value: methodKey(ACID) } })
    expect(signal.aborted).toBe(true)
  })

  it('aborts on unmount (leaving the page)', () => {
    seedStatic({ Base: archRes('a1', 'BEV') })
    run().mockReturnValue(new Promise(() => {}))
    const view = render(<SingleProductStaticPanel archetypeId="a1" />)
    fireEvent.click(buildBtn(S)!)
    const signal = run().mock.calls[0][1] as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('Discard stops waiting, says the server may keep computing, and the button comes back', async () => {
    seedStatic({ Base: archRes('a1', 'BEV') })
    const d = deferred<ContributionAnalysisResult>()
    run().mockReturnValue(d.promise)
    render(<SingleProductStaticPanel archetypeId="a1" />)
    fireEvent.click(buildBtn(S)!)
    // The note sits behind the (i) next to Discard: not on screen until it is opened.
    expect(screen.queryByTestId(`${S}-tree-discard-note`)).toBeNull()
    fireEvent.click(screen.getByTestId(`${S}-tree-discard-info`))
    expect(screen.getByTestId(`${S}-tree-discard-note`).textContent).toContain('server may keep computing')
    fireEvent.click(screen.getByText('Discard'))
    expect((run().mock.calls[0][1] as AbortSignal).aborted).toBe(true)
    expect(buildBtn(S)).not.toBeDisabled()
    expect(screen.getByTestId(`${S}-tree-discarded`)).toBeInTheDocument()
    await act(async () => { d.resolve(tree('LATE')) })
    expect(screen.queryByTestId('tree-panel')).toBeNull()
  })

  it('shows the error and offers Try again, which sends one more request', async () => {
    seedStatic({ Base: archRes('a1', 'BEV') })
    run().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(tree('BEV'))
    render(<SingleProductStaticPanel archetypeId="a1" />)
    fireEvent.click(buildBtn(S)!)
    await waitFor(() => expect(screen.getByTestId(`${S}-tree-error`).textContent).toContain('boom'))
    expect(buildBtn(S)!.textContent).toContain('Try again')
    fireEvent.click(buildBtn(S)!)
    await waitFor(() => expect(screen.getByTestId('tree-panel')).toBeInTheDocument())
    expect(run()).toHaveBeenCalledTimes(2)
  })

  it('uses the wording of the LCA Architect button', () => {
    seedStatic({ Base: archRes('a1', 'BEV') })
    render(<SingleProductStaticPanel archetypeId="a1" />)
    expect(buildBtn(S)!.textContent).toContain('Build supply chain tree')
    expect(screen.getByTestId(`${S}-tree-hint`).textContent).toBe('Up to a minute on large databases.')
  })
})

// ── Multi-item ───────────────────────────────────────────────────────────────

function archItem(id: string, label: string, over: Partial<ArchetypeLCACalculateResult> = {}): MultiProductItemResult {
  return {
    type: 'archetype', item_id: id, label, status: 'success',
    archetype_result: archRes(id, label, { parameter_scenario: 'Base', ...over }),
  }
}
function envelope(items: MultiProductItemResult[]): MultiProductLCAResult {
  return {
    items, elapsed_seconds: 0.1,
    success_count: items.filter((i) => i.status === 'success').length,
    error_count: items.filter((i) => i.status !== 'success').length,
  }
}
const mid = (id: string) => `multi-tree-${id}`

function renderMulti(base: MultiProductLCAResult, extra: Record<string, unknown> = {}) {
  useMultiProductLCAStore.setState({
    multiResult: base, multiByCase: { Base: base }, multiCaseOrder: ['Base'],
    multiRun: { id: 1, computeDatabase: null, activities: {} },
    ...extra,
  } as any)
  const view = render(<SingleProductImpact />)
  fireEvent.click(view.container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
  return view
}

describe('Multi-item: one button per item, one tree at a time', () => {
  it('shows a button for each successful item and makes no request by itself', () => {
    renderMulti(envelope([archItem('arc-a', 'Alpha'), archItem('arc-b', 'Beta')]))
    expect(buildBtn(mid('arc-a'))).not.toBeNull()
    expect(buildBtn(mid('arc-b'))).not.toBeNull()
    expect(run()).not.toHaveBeenCalled()
    expect(screen.queryByTestId('tree-panel')).toBeNull()
    // The note is behind an (i), not permanently on the screen.
    expect(screen.queryByTestId('multi-product-trees-note')).toBeNull()
    fireEvent.click(screen.getByTestId('multi-product-trees-info'))
    expect(screen.getByTestId('multi-product-trees-note').textContent).toContain('one at a time')
    expect(screen.getByTestId('multi-product-trees-note').textContent).toContain('up to a minute on a large database')
  })

  it('builds A then B: each keeps its own tree, B never shows A\'s, and every button waits while one runs', async () => {
    renderMulti(envelope([archItem('arc-a', 'Alpha'), archItem('arc-b', 'Beta')]))
    const da = deferred<ContributionAnalysisResult>()
    run().mockReturnValueOnce(da.promise)
    fireEvent.click(buildBtn(mid('arc-a'))!)
    expect(run()).toHaveBeenCalledTimes(1)
    expect(buildBtn(mid('arc-a'))).toBeDisabled()
    expect(buildBtn(mid('arc-b'))).toBeDisabled()           // any running tree disables all
    fireEvent.click(buildBtn(mid('arc-b'))!)
    expect(run()).toHaveBeenCalledTimes(1)                  // and a click on it does nothing

    await act(async () => { da.resolve(tree('TREE-OF-ALPHA')) })
    await waitFor(() => expect(screen.getAllByTestId('tree-panel')).toHaveLength(1))
    expect(screen.getByTestId('tree-panel').textContent).toContain('TREE-OF-ALPHA')
    expect(buildBtn(mid('arc-b'))).not.toBeDisabled()
    expect(screen.getByTestId(`${mid('arc-b')}-tree-block`).textContent).not.toContain('TREE-OF-ALPHA')

    run().mockResolvedValueOnce(tree('TREE-OF-BETA'))
    fireEvent.click(buildBtn(mid('arc-b'))!)
    await waitFor(() => expect(screen.getAllByTestId('tree-panel')).toHaveLength(2))
    const texts = screen.getAllByTestId('tree-panel').map((n) => n.textContent)
    expect(texts[0]).toContain('TREE-OF-ALPHA')
    expect(texts[1]).toContain('TREE-OF-BETA')
    expect(run()).toHaveBeenCalledTimes(2)
  })

  it('each request carries that item\'s own frozen inputs, scenario and indicator', async () => {
    renderMulti(envelope([
      archItem('arc-a', 'Alpha', { stage_amounts: { Manufacturing: 1, 'Use Phase': 15 } }),
      archItem('arc-b', 'Beta', { stage_amounts: { Manufacturing: 1, 'Use Phase': 7 }, scope: 'inflows' }),
    ]))
    // Live inputs changed after the run: the request must not read them.
    useMultiProductLCAStore.setState({
      stageAmountsByItem: { 'arc:arc-a': { preset: 'custom', lifetime: null, amounts: { Manufacturing: 5, 'Use Phase': 5 } } },
    } as any)
    run().mockResolvedValue(tree('x'))
    fireEvent.click(buildBtn(mid('arc-b'))!)
    await waitFor(() => expect(run()).toHaveBeenCalledTimes(1))
    const body = run().mock.calls[0][0] as any
    expect(body).toMatchObject({
      target_type: 'archetype', archetype_id: 'arc-b', scope: 'inflows',
      stage_amounts: { Manufacturing: 1, 'Use Phase': 7 }, parameter_scenario: 'Base',
    })
    expect(body.method).toEqual(GWP)
  })

  it('a stale response for another item is ignored when the indicator changes meanwhile', async () => {
    renderMulti(envelope([archItem('arc-a', 'Alpha'), archItem('arc-b', 'Beta')]))
    const da = deferred<ContributionAnalysisResult>()
    run().mockReturnValueOnce(da.promise)
    fireEvent.click(buildBtn(mid('arc-a'))!)
    const signal = run().mock.calls[0][1] as AbortSignal
    fireEvent.change(screen.getByTestId('multi-product-tree-indicator'), { target: { value: methodKey(ACID) } })
    expect(signal.aborted).toBe(true)
    await act(async () => { da.resolve(tree('STALE-ALPHA')) })
    expect(screen.queryByTestId('tree-panel')).toBeNull()
    expect(buildBtn(mid('arc-a'))).not.toBeDisabled()
    expect(buildBtn(mid('arc-b'))).not.toBeDisabled()
  })

  it('aborts on unmount', () => {
    const view = renderMulti(envelope([archItem('arc-a', 'Alpha')]))
    run().mockReturnValue(new Promise(() => {}))
    fireEvent.click(buildBtn(mid('arc-a'))!)
    const signal = run().mock.calls[0][1] as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('error path: the item shows the failure and Try again, the other item is unaffected', async () => {
    renderMulti(envelope([archItem('arc-a', 'Alpha'), archItem('arc-b', 'Beta')]))
    run().mockRejectedValueOnce(new Error('no memory'))
    fireEvent.click(buildBtn(mid('arc-a'))!)
    await waitFor(() => expect(screen.getByTestId(`${mid('arc-a')}-tree-error`).textContent).toContain('no memory'))
    expect(buildBtn(mid('arc-a'))!.textContent).toContain('Try again')
    expect(screen.queryByTestId(`${mid('arc-b')}-tree-error`)).toBeNull()
    expect(buildBtn(mid('arc-b'))!.textContent).toContain('Build supply chain tree')
  })

  it('follows the sensitivity case: one tree per item and case, the case goes in the request', async () => {
    const base = envelope([archItem('arc-a', 'Alpha')])
    const high = envelope([archItem('arc-a', 'Alpha', { parameter_scenario: 'High', stage_amounts: { Manufacturing: 2, 'Use Phase': 15 } })])
    renderMulti(base, { multiByCase: { Base: base, High: high }, multiCaseOrder: ['Base', 'High'] })
    run().mockResolvedValueOnce(tree('A-BASE', GWP, 'Base')).mockResolvedValueOnce(tree('A-HIGH', GWP, 'High'))
    fireEvent.click(buildBtn(mid('arc-a'))!)
    await waitFor(() => expect(screen.getByTestId('tree-panel').textContent).toContain('A-BASE'))

    fireEvent.change(screen.getByTestId('multi-product-tree-case'), { target: { value: 'High' } })
    expect(screen.queryByTestId('tree-panel')).toBeNull()
    fireEvent.click(buildBtn(mid('arc-a'))!)
    await waitFor(() => expect(screen.getByTestId('tree-panel').textContent).toContain('A-HIGH'))
    const second = run().mock.calls[1][0] as any
    expect(second.parameter_scenario).toBe('High')
    expect(second.stage_amounts).toEqual({ Manufacturing: 2, 'Use Phase': 15 })

    fireEvent.change(screen.getByTestId('multi-product-tree-case'), { target: { value: 'Base' } })
    expect(screen.getByTestId('tree-panel').textContent).toContain('A-BASE')   // cached
    expect(run()).toHaveBeenCalledTimes(2)
  })

  it('an activity item is requested from the run snapshot (database, code, amount, year)', async () => {
    const act: MultiProductItemResult = {
      type: 'activity', item_id: 'ei-ssp1-2040|c9', label: 'steel 2040', status: 'success',
      activity_result: { results: [{ method: GWP, method_label: 'gwp', score: 3, unit: 'kg', contributions: [] }], elapsed_seconds: 0.1 } as any,
    }
    renderMulti(envelope([act]), {
      multiRun: { id: 4, computeDatabase: null, activities: { 'ei-ssp1-2040|c9': { database: 'ei-ssp1-2040', code: 'c9', amount: 2.5, year: 2040 } } },
    })
    run().mockResolvedValue({ ...tree('steel'), target_type: 'activity' } as any)
    fireEvent.click(buildBtn(mid('ei-ssp1-2040|c9'))!)
    await waitFor(() => expect(run()).toHaveBeenCalledTimes(1))
    const body = run().mock.calls[0][0] as any
    expect(body).toMatchObject({
      target_type: 'activity', database: 'ei-ssp1-2040', code: 'c9', amount: 2.5, year: 2040, compute_database: null,
    })
    expect('parameter_scenario' in body).toBe(false)   // an activity has no BOM to resolve
  })

  it('no button for failed or empty items, nor for an activity whose run inputs were not kept', () => {
    const failed: MultiProductItemResult = { type: 'archetype', item_id: 'bad', label: 'Bad', status: 'error', error_message: 'x' }
    const empty: MultiProductItemResult = {
      type: 'archetype', item_id: 'empty', label: 'Empty', status: 'success',
      archetype_result: { ...archRes('empty', 'Empty'), results: [] },
    }
    const orphan: MultiProductItemResult = {
      type: 'activity', item_id: 'db|orphan', label: 'Orphan', status: 'success',
      activity_result: { results: [{ method: GWP, method_label: 'gwp', score: 1, unit: 'kg', contributions: [] }], elapsed_seconds: 0 } as any,
    }
    renderMulti(envelope([archItem('ok', 'Fine'), failed, empty, orphan]))
    expect(buildBtn(mid('ok'))).not.toBeNull()
    expect(buildBtn(mid('bad'))).toBeNull()
    expect(buildBtn(mid('empty'))).toBeNull()
    expect(buildBtn(mid('db|orphan'))).toBeNull()
  })

  it('no trees section at all when no item can have one', () => {
    renderMulti(envelope([{ type: 'archetype', item_id: 'bad', label: 'Bad', status: 'error', error_message: 'x' }]))
    expect(screen.queryByTestId('multi-product-trees')).toBeNull()
  })
})

// ── Where the button must NOT be ─────────────────────────────────────────────

describe('no supply chain tree button elsewhere in Impact Assessment', () => {
  const PROJECTED_RUN = {
    dbName: 'ei310-remind-ssp2-2030', year: 2030, iam: 'remind', ssp: 'SSP2-PkBudg1150',
    result: { ...archRes('a1', 'BEV'), compute_database: 'ei310-remind-ssp2-2030' },
  }
  const anyBuild = (c: HTMLElement) => c.querySelector('[data-testid$="build-tree"]')

  it('Comparison tab (Static and Projected both computed): none', () => {
    useSingleProductImpactStore.getState().setArchetypeId('a1')
    useSingleProductImpactStore.getState().setStaticResult(archRes('a1', 'BEV'))
    useSingleProductImpactStore.getState().setProjectedRuns([PROJECTED_RUN as any])
    const { container } = render(<SingleProductComparisonPanel archetypeId="a1" />)
    expect(container.querySelector('[data-testid="single-product-compare-export"]')).not.toBeNull()   // it did render results
    expect(anyBuild(container)).toBeNull()
  })

  it('Projected tab with a finished run: none', () => {
    useSingleProductImpactStore.getState().setArchetypeId('a1')
    const set = useSessionStateStore.getState().setValue
    set('singleProduct.projected.a1.runs', [PROJECTED_RUN])
    set('singleProduct.projected.a1.active', 0)
    const { container } = render(<SingleProductProjectedPanel archetypeId="a1" />)
    expect(container.querySelector('[data-testid="single-product-projected-export"]')).not.toBeNull()
    expect(anyBuild(container)).toBeNull()
  })

  it('Static with no result yet: none', () => {
    useSingleProductImpactStore.getState().setArchetypeId('a1')
    const { container } = render(<SingleProductStaticPanel archetypeId="a1" />)
    expect(anyBuild(container)).toBeNull()
  })
})

// The System-level assessment is not rendered here (it needs a DSM system and the whole
// scenario pipeline). The guarantee is structural: the shared pieces are imported by exactly
// the two surfaces above, so no other panel can show the button.
describe('the tree pieces are used by the two intended surfaces only', () => {
  it('SupplyChainTreeBlock and useSupplyChainTrees are imported only by Static and Multi-item', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '../src')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(e.name)) continue
        const src = fs.readFileSync(p, 'utf8')
        if (/from '[^']*(SupplyChainTreeBlock|useSupplyChainTrees)'/.test(src)) {
          hits.push(relPosix(root, p))
        }
      }
    }
    walk(root)
    expect(hits.sort()).toEqual([
      'components/impact/MultiProductLCA.tsx',
      'components/impact/SingleProductStaticPanel.tsx',
    ])
  })
})

// ── The real request function ────────────────────────────────────────────────

describe('the request itself', () => {
  it('sends parameter_scenario and the project header on a real fetch, with the abort signal', async () => {
    const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
    // The header comes from the guard App.tsx configures at startup.
    actual.configureProjectGuard(() => 'proj-x', () => {})
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const controller = new AbortController()
    await actual.runContributionAnalysis(
      { target_type: 'archetype', archetype_id: 'a1', method: GWP, parameter_scenario: 'sa_early', stage_amounts: ECHO },
      controller.signal,
    )
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/lca/contribution-analysis')
    expect(JSON.parse(init.body as string)).toMatchObject({ parameter_scenario: 'sa_early', stage_amounts: ECHO })
    expect(new Headers(init.headers).get('X-Mapper-Project')).toBe('proj-x')
    expect(init.signal).toBe(controller.signal)
    actual.configureProjectGuard(() => null, () => {})
  })
})

// ── The hook on its own (the buttons' disabled state must not be the only guard) ──────────

describe('useSupplyChainTrees', () => {
  const REQ = { target_type: 'archetype' as const, archetype_id: 'a', method: GWP }

  it('refuses a second build while one is running, even when called directly', async () => {
    const d = deferred<ContributionAnalysisResult>()
    run().mockReturnValue(d.promise)
    const { result } = renderHook(() => useSupplyChainTrees('hook.one', 'w'))
    await act(async () => { void result.current.build('k1', REQ); void result.current.build('k2', REQ) })
    expect(run()).toHaveBeenCalledTimes(1)
    expect(result.current.running).toBe(true)
    expect(result.current.runningKey).toBe('k1')
    await act(async () => { d.resolve(tree('one')) })
    expect(result.current.running).toBe(false)
    expect(result.current.resultFor('k1')).not.toBeNull()
    expect(result.current.resultFor('k2')).toBeNull()
  })

  it('requests nothing until build is called', () => {
    renderHook(() => useSupplyChainTrees('hook.two', 'w'))
    expect(run()).not.toHaveBeenCalled()
  })

  it('keeps at most MAX_CACHED_TREES trees, the oldest goes first', async () => {
    run().mockImplementation(async () => tree('t'))
    const { result } = renderHook(() => useSupplyChainTrees('hook.three', 'w'))
    for (let i = 0; i < MAX_CACHED_TREES + 2; i++) {
      await act(async () => { await result.current.build(`k${i}`, REQ) })
    }
    expect(result.current.resultFor('k0')).toBeNull()
    expect(result.current.resultFor('k1')).toBeNull()
    expect(result.current.resultFor(`k${MAX_CACHED_TREES + 1}`)).not.toBeNull()
    expect(result.current.resultFor('k2')).not.toBeNull()
  })

  it('a watch-key change aborts the request in flight', async () => {
    run().mockReturnValue(new Promise(() => {}))
    const { result, rerender } = renderHook(({ w }) => useSupplyChainTrees('hook.four', w), { initialProps: { w: 'a' } })
    await act(async () => { void result.current.build('k', REQ) })
    const signal = run().mock.calls[0][1] as AbortSignal
    rerender({ w: 'b' })
    expect(signal.aborted).toBe(true)
    expect(result.current.running).toBe(false)
  })
})
