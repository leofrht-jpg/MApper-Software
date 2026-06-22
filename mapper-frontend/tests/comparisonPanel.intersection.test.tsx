/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useImpactStore } from '../src/stores/impactStore'

// Patch 2G: Comparison tab DSM-scenario intersection logic.
//
// Given staticDsmScenarioOrder=[A,B,C] and projectedDsmScenarioOrder=[B,C,D],
// the tab bar must show B and C (intersection), and the inline non-intersection
// note must list A as static-only and D as projected-only.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return { ...actual, exportImpact: vi.fn() }
})

beforeEach(() => {
  // @ts-expect-error — minimal stub
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // The vitest --localstorage-file flag installs a non-conforming
  // localStorage stub on window; ChartExportButton's getInitialBg() calls
  // getItem on mount and crashes. Force-replace with a working in-memory
  // implementation for these tests.
  if (typeof window !== 'undefined') {
    const store: Record<string, string> = {}
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = String(v) },
        removeItem: (k: string) => { delete store[k] },
        clear: () => { for (const k of Object.keys(store)) delete store[k] },
        key: (i: number) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length },
      },
    })
  }
  // Reset impact store to a clean slate between cases.
  useImpactStore.setState({
    staticResult: null,
    projectedResult: null,
    projectedMultiResult: null,
    compareResult: null,
    error: null,
    pairedScenarioOrder: [],
    pairedScenarioRuns: {},
    activePairedScenario: null,
    staticDsmScenarioOrder: [],
    staticDsmScenarioRuns: {},
    activeStaticDsmScenario: null,
    projectedDsmScenarioOrder: [],
    projectedDsmScenarioRuns: {},
    activeProjectedDsmScenario: null,
  })
})

// Minimal truthy stand-ins so the panel passes its early `!staticResult ||
// !projectedResult` guard. The tab bar render depends on store-derived
// intersection state, not on these contents.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubResult = { meta: {}, results: [] } as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubCompare = {
  mfa_system_id: 'sys-test',
  scope: 'all',
  methods: [{
    method: ['ef v3.1', 'climate change', 'gwp 100a'],
    method_label: 'EF v3.1 climate change',
    unit: 'kg CO2-eq',
    points: [{ year: 2020, static: 1, projected: 1, delta: 0, delta_pct: 0 }],
    total_static: 1,
    total_projected: 1,
    total_delta: 0,
    total_delta_pct: 0,
  }],
} as any

const fakeJob = (taskId: string) => ({
  taskId, mode: 'static' as const, stage: 'done', pct: 1, done: true, error: null,
})

const seedRuns = (
  ids: string[], names: Record<string, string>,
) => Object.fromEntries(
  ids.map((id) => [id, {
    scenario: id, scenarioName: names[id], job: fakeJob(`t-${id}`), result: null,
  }]),
)

describe('ComparisonPanel — DSM scenario intersection (Patch 2G)', () => {
  it('intersects staticDsmScenarioOrder=[A,B,C] × projectedDsmScenarioOrder=[B,C,D] to [B,C]', async () => {
    const staticIds = ['A', 'B', 'C']
    const projectedIds = ['B', 'C', 'D']
    const names = { A: 'SSP1', B: 'SSP2', C: 'SSP3', D: 'SSP5' }

    useImpactStore.setState({
      staticResult: stubResult,
      projectedResult: stubResult,
      compareResult: stubCompare,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      staticDsmScenarioRuns: seedRuns(staticIds, names) as any,
      staticDsmScenarioOrder: staticIds,
      activeStaticDsmScenario: 'B',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      projectedDsmScenarioRuns: seedRuns(projectedIds, names) as any,
      projectedDsmScenarioOrder: projectedIds,
      activeProjectedDsmScenario: 'B',
    })

    const { ComparisonPanel } = await import('../src/components/impact/ComparisonPanel')
    const { getByTestId, queryByText } = render(<ComparisonPanel />)

    const tabBar = getByTestId('comparison-dsm-tab-bar')
    expect(tabBar).toBeInTheDocument()
    // Intersection: B and C are tabs. A (static-only) and D (projected-only)
    // must NOT appear as tabs.
    expect(tabBar.textContent).toContain('SSP2')
    expect(tabBar.textContent).toContain('SSP3')
    expect(tabBar.textContent).not.toContain('SSP1')
    expect(tabBar.textContent).not.toContain('SSP5')

    // Non-intersection note lists A on Static and D on Projected.
    const note = getByTestId('comparison-non-intersection-note')
    expect(note).toBeInTheDocument()
    expect(note.textContent).toMatch(/SSP1.*Static/)
    expect(note.textContent).toMatch(/SSP5.*Projected/)
    expect(note.textContent).toContain('Showing 2 intersecting DSM scenarios')

    // Sanity: the panel didn't fall into the empty-intersection EmptyState.
    expect(queryByText(/No comparable DSM scenarios/i)).toBeNull()
  })

  it('renders empty-intersection EmptyState when static and projected DSM lists are disjoint', async () => {
    const names = { A: 'SSP1', B: 'SSP2', X: 'X', Y: 'Y' }

    useImpactStore.setState({
      staticResult: stubResult,
      projectedResult: stubResult,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      staticDsmScenarioRuns: seedRuns(['A', 'B'], names) as any,
      staticDsmScenarioOrder: ['A', 'B'],
      activeStaticDsmScenario: 'A',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      projectedDsmScenarioRuns: seedRuns(['X', 'Y'], names) as any,
      projectedDsmScenarioOrder: ['X', 'Y'],
      activeProjectedDsmScenario: 'X',
    })

    const { ComparisonPanel } = await import('../src/components/impact/ComparisonPanel')
    const { getByText, queryByTestId } = render(<ComparisonPanel />)

    expect(getByText(/No comparable DSM scenarios/i)).toBeInTheDocument()
    expect(queryByTestId('comparison-dsm-tab-bar')).toBeNull()
  })

  it('keeps the DSM tab bar visible when the Results card is collapsed (Patch 2I)', async () => {
    const sysId = 'sys-test'
    const ids = ['s1', 's2']
    const names = { s1: 'SSP1', s2: 'SSP2' }
    const mkResult = (total: number) => ({
      meta: { mfa_system_id: sysId, scope: 'all', mode: 'static' },
      results: [{
        method: ['ef v3.1', 'climate change', 'gwp 100a'],
        method_label: 'EF v3.1 climate change',
        unit: 'kg CO2-eq',
        years: [{ year: 2020, total_impact: total }],
      }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
    const fJob = { taskId: 't', mode: 'static' as const, stage: 'done', pct: 1, done: true, error: null }
    const sRuns = {
      s1: { scenario: 's1', scenarioName: 'SSP1', job: fJob, result: mkResult(100) },
      s2: { scenario: 's2', scenarioName: 'SSP2', job: fJob, result: mkResult(100) },
    }
    const pRuns = {
      s1: { scenario: 's1', scenarioName: 'SSP1', job: fJob, result: mkResult(110) },
      s2: { scenario: 's2', scenarioName: 'SSP2', job: fJob, result: mkResult(130) },
    }

    useImpactStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      staticDsmScenarioRuns: sRuns as any,
      staticDsmScenarioOrder: ids,
      activeStaticDsmScenario: 's1',
      staticResult: sRuns.s1.result,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      projectedDsmScenarioRuns: pRuns as any,
      projectedDsmScenarioOrder: ids,
      activeProjectedDsmScenario: 's1',
      projectedResult: pRuns.s1.result,
    })

    const { ComparisonPanel } = await import('../src/components/impact/ComparisonPanel')
    const { getByText, getByTestId } = render(<ComparisonPanel />)

    // Tab bar is present whether expanded or not.
    expect(getByTestId('comparison-dsm-tab-bar')).toBeInTheDocument()
    // Default expanded — chart subtitle visible (no display:none ancestor).
    const subtitleExpanded = getByText(/Impact per year — Static vs Projected/i)
    expect(subtitleExpanded.closest('[style*="display: none"]')).toBeNull()

    // Collapse the Results card. The tab bar (rendered above the
    // CollapsibleCard) must remain in the DOM; the chart titles inside the
    // collapsible body stay mounted via visibility-toggle (Patch 4A) but
    // gain a display: none ancestor — preserving component-local state
    // while hiding the body from the user.
    const { act, fireEvent } = await import('@testing-library/react')
    await act(async () => {
      fireEvent.click(getByText('Results'))
    })

    expect(getByTestId('comparison-dsm-tab-bar')).toBeInTheDocument()
    const subtitleCollapsed = getByText(/Impact per year — Static vs Projected/i)
    expect(subtitleCollapsed.closest('[style*="display: none"]')).not.toBeNull()
    // Summary line shows Cumulative difference + comparable-scenario count.
    expect(getByText(/Cumulative difference:/i)).toBeInTheDocument()
    expect(getByText(/comparable scenarios/i)).toBeInTheDocument()
  })

  it('does not render the tab bar in single-DSM-scenario backward-compat case', async () => {
    useImpactStore.setState({
      staticResult: stubResult,
      projectedResult: stubResult,
      compareResult: stubCompare,
      // No multi-DSM slots populated — single-scenario backward compat path.
    })

    const { ComparisonPanel } = await import('../src/components/impact/ComparisonPanel')
    const { queryByTestId } = render(<ComparisonPanel />)

    expect(queryByTestId('comparison-dsm-tab-bar')).toBeNull()
    expect(queryByTestId('comparison-non-intersection-note')).toBeNull()
  })
})
