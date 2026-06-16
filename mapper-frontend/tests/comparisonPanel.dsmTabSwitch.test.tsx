import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { useImpactStore } from '../src/stores/impactStore'

// Patch 2H regression: switching DSM scenario tabs on the Comparison tab
// must update Cumulative Difference + chart values, not just the active-tab
// border colour. The bug was: selectStaticDsmScenario / selectProjectedDsmScenario
// bridged staticResult/projectedResult correctly but never cleared
// compareResult, so the useEffect's `!compareResult` recompute gate kept
// the original tab's compareResult alive forever.

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
  useImpactStore.setState({
    staticResult: null, projectedResult: null, projectedMultiResult: null,
    compareResult: null, error: null,
    pairedScenarioOrder: [], pairedScenarioRuns: {}, activePairedScenario: null,
    staticDsmScenarioOrder: [], staticDsmScenarioRuns: {}, activeStaticDsmScenario: null,
    projectedDsmScenarioOrder: [], projectedDsmScenarioRuns: {}, activeProjectedDsmScenario: null,
  })
})

const METHOD = ['ef v3.1', 'climate change', 'gwp 100a']

// Shape: ImpactAssessmentResult — buildCompareClientSide reads .meta and .results.
// Each result has years: [{year, total_impact}]. Producing a distinct
// projected total per scenario yields a distinct total_delta in compareResult.
const makeResult = (sysId: string, projectedTotal: number) => ({
  meta: { mfa_system_id: sysId, scope: 'all', mode: 'static' },
  results: [{
    method: METHOD,
    method_label: 'EF v3.1 climate change',
    unit: 'kg CO2-eq',
    years: [
      { year: 2020, total_impact: projectedTotal / 2 },
      { year: 2021, total_impact: projectedTotal / 2 },
    ],
  }],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

// Static side is identical across scenarios so the delta is purely a
// function of which projected scenario is active.
const STATIC_TOTAL = 100
const PROJECTED_TOTALS: Record<string, number> = {
  s1: 110, // SSP1: delta +10
  s2: 130, // SSP2: delta +30
  s3: 200, // SSP5: delta +100
}

const fakeJob = (taskId: string) => ({
  taskId, mode: 'static' as const, stage: 'done', pct: 1, done: true, error: null,
})

const makeRuns = (
  sysId: string, totals: Record<string, number>, names: Record<string, string>,
) => Object.fromEntries(Object.keys(totals).map((id) => [id, {
  scenario: id, scenarioName: names[id], job: fakeJob(`t-${id}`),
  result: makeResult(sysId, totals[id]),
}]))

describe('ComparisonPanel — DSM tab switch updates results (Patch 2H)', () => {
  it('cumulative-difference text changes when switching DSM scenario tabs', async () => {
    const sysId = 'sys-test'
    const ids = ['s1', 's2', 's3']
    const names = { s1: 'SSP1', s2: 'SSP2', s3: 'SSP5' }
    const staticTotals = { s1: STATIC_TOTAL, s2: STATIC_TOTAL, s3: STATIC_TOTAL }
    const staticRuns = makeRuns(sysId, staticTotals, names)
    const projectedRuns = makeRuns(sysId, PROJECTED_TOTALS, names)

    useImpactStore.setState({
      staticDsmScenarioOrder: ids,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      staticDsmScenarioRuns: staticRuns as any,
      activeStaticDsmScenario: 's1',
      staticResult: staticRuns.s1.result,
      projectedDsmScenarioOrder: ids,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      projectedDsmScenarioRuns: projectedRuns as any,
      activeProjectedDsmScenario: 's1',
      projectedResult: projectedRuns.s1.result,
    })

    const { ComparisonPanel } = await import('../src/components/impact/ComparisonPanel')
    const { container, queryByText } = render(<ComparisonPanel />)

    // Initial render — useEffect fires compare(), populating compareResult
    // for SSP1 (delta +10 → "+1.00e+1" in scientific format).
    await waitFor(() => {
      expect(queryByText(/Cumulative difference/i)).toBeInTheDocument()
    })
    // Read the compareResult straight from the store — the chart-level
    // assertion is that the rendered DOM picks it up, which we sanity-check
    // by asserting the formatted value appears once in the document.
    const deltaSSP1 = useImpactStore.getState().compareResult?.methods[0].total_delta
    expect(deltaSSP1).toBe(10)
    expect(container.textContent).toContain('+1.00e+1')

    // Switch to SSP2 — compareResult should clear, useEffect re-fires,
    // delta becomes +30.
    await act(async () => {
      useImpactStore.getState().selectStaticDsmScenario('s2')
      useImpactStore.getState().selectProjectedDsmScenario('s2')
    })
    await waitFor(() => {
      const d = useImpactStore.getState().compareResult?.methods[0].total_delta
      expect(d).toBe(30)
    })
    expect(container.textContent).toContain('+3.00e+1')
    expect(container.textContent).not.toContain('+1.00e+1')

    // Switch to SSP5 — delta becomes +100.
    await act(async () => {
      useImpactStore.getState().selectStaticDsmScenario('s3')
      useImpactStore.getState().selectProjectedDsmScenario('s3')
    })
    await waitFor(() => {
      const d = useImpactStore.getState().compareResult?.methods[0].total_delta
      expect(d).toBe(100)
    })
    expect(container.textContent).toContain('+1.00e+2')
    expect(container.textContent).not.toContain('+3.00e+1')
  })

  it('selector clears compareResult so the recompute gate fires', () => {
    // Lower-level guard: bridging a new scenario must clear compareResult,
    // otherwise the Comparison useEffect's `!compareResult` gate keeps the
    // stale comparison alive.
    const sysId = 'sys-test'
    const ids = ['s1', 's2']
    const names = { s1: 'A', s2: 'B' }
    const staticRuns = makeRuns(sysId, { s1: 100, s2: 100 }, names)
    const projectedRuns = makeRuns(sysId, { s1: 110, s2: 130 }, names)

    useImpactStore.setState({
      staticDsmScenarioOrder: ids,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      staticDsmScenarioRuns: staticRuns as any,
      activeStaticDsmScenario: 's1',
      staticResult: staticRuns.s1.result,
      projectedDsmScenarioOrder: ids,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      projectedDsmScenarioRuns: projectedRuns as any,
      activeProjectedDsmScenario: 's1',
      projectedResult: projectedRuns.s1.result,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compareResult: { mfa_system_id: sysId, scope: 'all', methods: [] } as any,
    })

    expect(useImpactStore.getState().compareResult).not.toBeNull()
    useImpactStore.getState().selectStaticDsmScenario('s2')
    expect(useImpactStore.getState().compareResult).toBeNull()
  })
})
