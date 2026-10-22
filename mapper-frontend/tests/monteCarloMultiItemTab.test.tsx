/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * The Uncertainty tab from a MULTI-ITEM comparison, end to end.
 *
 * Every earlier test of this tab either rendered the single-item path, or
 * rendered the multi-item pieces (picker, pairwise card, box plot) on their
 * own. None went Multi-item comparison → "Run uncertainty" → the tab → a
 * finished paired run, which is the path reported as an empty tab in the
 * 0.3.1 walkthrough. This file walks it, against a result captured verbatim
 * from a live backend (tests/fixtures/monteCarloMultiResult.demo.json), not a
 * hand-written shape.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MonteCarloPage } from '../src/pages/MonteCarlo'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { PairwiseDifferences } from '../src/components/uncertainty/MultiItemUncertainty'
import { useMonteCarloStore, type MonteCarloMultiHandoff } from '../src/stores/monteCarloStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import type { MonteCarloMultiResult } from '../src/api/client'
import fixture from './fixtures/monteCarloMultiResult.demo.json'

const RESULT = fixture as unknown as MonteCarloMultiResult
const METHODS = RESULT.items[0].distributions.map((d) => d.method)

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>()
  const fx = (await import('./fixtures/monteCarloMultiResult.demo.json')).default
  return {
    ...actual,
    getMethods: vi.fn().mockResolvedValue([{
      family: 'EF v3.1',
      categories: fx.items[0].distributions.map((d: { method: string[] }) => ({
        category: d.method[1], indicators: [{ indicator: d.method[2], tuple: d.method }],
      })),
    }]),
    startMonteCarloMulti: vi.fn().mockResolvedValue({ task_id: 'task-1' }),
    getMonteCarloMultiResult: vi.fn().mockResolvedValue(fx),
    getPedigreeCoverage: vi.fn().mockRejectedValue(new Error('not used in multi mode')),
    exportMonteCarloMulti: vi.fn().mockResolvedValue(undefined),
    cancelTask: vi.fn(),
  }
})

/** A WebSocket that reports progress, then `done`, like the real task socket. */
class FakeTaskSocket {
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor() {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'progress', pct: 0.5, stage: 'sampling' }) }), 5)
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'done', task_id: 'task-1' }) }), 10)
  }
  close() { /* nothing to release */ }
}
vi.stubGlobal('WebSocket', FakeTaskSocket)

const CLEARED = {
  handoff: null, multiHandoff: null, multiResult: null, result: null, taskId: null,
  running: false, pct: 0, stage: '', error: null, cancelled: false,
}

const HANDOFF: MonteCarloMultiHandoff = {
  items: RESULT.items.map((i) => ({ archetypeId: i.archetype_id, archetypeName: i.archetype_name })),
  methods: METHODS,
  scope: 'all',
  stageAmounts: {},
  parameterScenario: null,
  computeDatabase: null,
}

beforeEach(() => {
  useMonteCarloStore.setState(CLEARED as never)
})

function expectResultsVisible(container: HTMLElement) {
  const multi = container.querySelector('[data-testid="monte-carlo-multi"]')
  expect(multi, 'the multi-item mode is drawn').not.toBeNull()
  // The headline of a paired run, and one box per item, in comparison order.
  expect(screen.getByTestId('mc-pairwise')).toBeInTheDocument()
  const boxes = container.querySelectorAll('[data-testid^="mc-box-"]')
  expect(boxes).toHaveLength(2)
  expect(boxes[0].textContent).toContain('DEMO combustion')
  expect(boxes[1].textContent).toContain('DEMO battery')
  expect(screen.getByTestId('mc-multi-export')).toBeInTheDocument()
}

describe('Uncertainty tab, multi-item', () => {
  it('draws a finished paired result already in the store', () => {
    useMonteCarloStore.setState({ ...CLEARED, multiHandoff: HANDOFF, multiResult: RESULT } as never)
    const { container } = render(<MonteCarloPage />)
    expectResultsVisible(container)
    // GWP100 is the first indicator in the fixture: the combustion vehicle is
    // lower in every iteration (deterministic Δ −672 kg CO2-Eq, no spread).
    expect(screen.getByTestId('mc-pair-claim').textContent).toMatch(/is lower than .* in 100% of iterations/)
  })

  it('goes Multi-item comparison → Run uncertainty → Run → results', async () => {
    useMultiProductLCAStore.setState({
      selectedItems: RESULT.items.map((i) => ({
        type: 'archetype', archetype_id: i.archetype_id, display_name: i.archetype_name,
      })),
      multiResult: {
        items: RESULT.items.map((i) => ({
          type: 'archetype', item_id: i.archetype_id, label: i.archetype_name, status: 'success',
          archetype_result: {
            archetype_id: i.archetype_id, archetype_name: i.archetype_name, scope: 'all',
            results: i.distributions.map((d) => ({ method: d.method, method_label: d.method_label, unit: d.unit, score: d.deterministic })),
          },
        })),
        success_count: 2, error_count: 0, elapsed_seconds: 0.1,
      },
      multiLoading: false, multiError: null, multiByCase: null, multiCaseOrder: [], multiVintageCoords: {},
    } as never)

    function Tabs() {
      const [tab, setTab] = useState('impact')
      return tab === 'impact'
        ? <MultiProductLCA onNavigate={setTab} />
        : <MonteCarloPage onNavigate={setTab} />
    }
    const { container } = render(<Tabs />)
    // Let the method picker load and select its indicators.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

    await act(async () => { fireEvent.click(screen.getByTestId('multi-product-run-uncertainty')) })
    expect(container.querySelector('[data-testid="monte-carlo-multi"]')).not.toBeNull()
    expect(screen.getByTestId('mc-item-picker').textContent).toContain('DEMO combustion vehicle')

    await act(async () => { fireEvent.click(screen.getByTestId('mc-multi-run')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

    expect(useMonteCarloStore.getState().running).toBe(false)
    expectResultsVisible(container)
  })

  it('drops a previous comparison\'s result when a DIFFERENT comparison arrives', () => {
    useMonteCarloStore.setState({ ...CLEARED, multiHandoff: HANDOFF, multiResult: RESULT } as never)
    act(() => {
      useMonteCarloStore.getState().setMultiHandoff({ ...HANDOFF, items: HANDOFF.items.slice(0, 1) })
    })
    expect(useMonteCarloStore.getState().multiResult).toBeNull()
  })

  it('keeps the finished result when the SAME comparison is handed over again', () => {
    useMonteCarloStore.setState({ ...CLEARED, multiHandoff: HANDOFF, multiResult: RESULT } as never)
    act(() => { useMonteCarloStore.getState().setMultiHandoff({ ...HANDOFF }) })
    expect(useMonteCarloStore.getState().multiResult).toBe(RESULT)
  })
})

describe('the pairwise claim', () => {
  it('reads a zero difference in every iteration as a tie, not "higher in 100%"', () => {
    // The fixture's acidification pair: both demo vehicles score 0, so the
    // difference is 0 every iteration and fraction_a_lower is 0.
    const acid = RESULT.differences.find((d) => d.method[1] === 'acidification')!
    expect(acid.fraction_a_lower).toBe(0)
    render(<PairwiseDifferences result={{ ...RESULT, differences: [acid] }} />)
    const claim = screen.getByTestId('mc-pair-claim').textContent ?? ''
    expect(claim).toMatch(/do not differ in any iteration/)
    expect(claim).not.toMatch(/higher/)
  })

  it('survives values the backend sent as null (non-finite)', () => {
    const d = { ...RESULT.differences[0], median: null, p2_5: null, correlation: null } as never
    const { container } = render(<PairwiseDifferences result={{ ...RESULT, differences: [d] }} />)
    expect(within(container).getByTestId('mc-pair-claim')).toBeInTheDocument()
    expect(container.textContent).toContain('—')
  })
})
