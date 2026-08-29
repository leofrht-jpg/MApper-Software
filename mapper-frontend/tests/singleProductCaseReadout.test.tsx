/* SPDX-License-Identifier: MPL-2.0 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, renderHook, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { SingleProductStaticPanel } from '../src/components/impact/SingleProductStaticPanel'
import { StageBreakdownChart } from '../src/components/charts/StageBreakdownChart'
import { useNumberFormatter } from '../src/components/charts/numberFormat'
import { useParameterStore } from '../src/stores/parameterStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'

const FAM = 'EF v3.1'
const MOCK_METHODS = [{ family: FAM, categories: [
  { category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: [FAM, 'climate change', 'GWP100'] }] },
]}]

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual,
    getMethods: vi.fn(() => Promise.resolve(MOCK_METHODS)),
    calculateArchetypeLCA: vi.fn(),
  }
})

const LABEL = 'climate change | GWP100'
function res(sc: string, total: number, mfg: number, use: number) {
  return {
    archetype_id: 'a1', archetype_name: 'A - Circular EV', scope: 'all', amount: 1,
    stage_amounts: {}, stages_included: ['Manufacturing', 'Use Phase'],
    results: [{ method: [FAM, 'climate change', 'GWP100'], method_label: LABEL, score: total, unit: 'kg CO2-eq', contributions: [] }],
    elapsed_seconds: 1, compute_database: null,
    parameter_scenario: sc === 'Base' ? null : sc, warnings: [],
    stage_breakdown: { [LABEL]: { 'Manufacturing': mfg, 'Use Phase': use } },
  }
}

beforeEach(() => {
  // @ts-expect-error jsdom stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useSingleProductImpactStore.getState().reset()
  useParameterStore.setState({
    table: {
      parameters: { p1: { name: 'p1', base_value: 1, scenario_overrides: { sa_early: 2 } } },
      scenarios: ['sa_early', 'sa_inert'], categories: [],
    },
    selectedScenarios: ['sa_early', 'sa_inert'],
  } as never)
})

async function computeMulti() {
  const c = await import('../src/api/client')
  vi.mocked(c.calculateArchetypeLCA).mockImplementation((async (
    _a: string, _s: string, _m: unknown, o?: { parameterScenario?: string | null },
  ) => {
    const sc = o?.parameterScenario ?? 'Base'
    return sc === 'sa_early' ? res('sa_early', 900, 700, 200) : res('Base', 500, 300, 200)
  }) as never)

  const view = render(<SingleProductStaticPanel archetypeId="a1" />)
  const btn = await screen.findByTestId('single-product-static-calculate')
  await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 4000 })
  fireEvent.click(btn)
  await waitFor(
    () => expect(screen.queryByTestId('single-product-static-scenario-tabs')).not.toBeNull(),
    { timeout: 5000 },
  )
  return view
}

describe('the stage breakdown already follows the case tab bar', () => {
  it('switching case re-renders the stacked chart with that case\'s subtotals', async () => {
    // This was believed unreachable. It is not: `activeResult` drives the
    // stage chart, and the tab bar sets it. Pinned so a refactor that pins
    // the chart to Base would fail here rather than silently regress.
    const { container } = await computeMulti()
    const tabs = screen.getByTestId('single-product-static-scenario-tabs')

    expect(container.textContent).toContain('5.00e+2')   // Base total
    fireEvent.click(within(tabs).getByText('sa_early'))
    await waitFor(() => expect(container.textContent).toContain('9.00e+2'))  // case total
  })
})

describe('an exported chart cannot be mistaken for Base', () => {
  it('names the active case on the chart', async () => {
    await computeMulti()
    const badge = screen.getByTestId('stage-breakdown-case')
    expect(badge.textContent).toContain('Base')

    fireEvent.click(within(screen.getByTestId('single-product-static-scenario-tabs')).getByText('sa_early'))
    await waitFor(() => expect(screen.getByTestId('stage-breakdown-case').textContent).toContain('sa_early'))
  })

  it('puts the case in the export filename', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { container } = render(
      <StageBreakdownChart
        stageBreakdown={{ [LABEL]: { Manufacturing: 300 } }}
        methods={[{ method_label: LABEL, score: 300, unit: 'kg' }]}
        format={result.current}
        filenameBase="a_circular_ev"
        caseLabel="sa_early_repurpose_120kkm"
      />,
    )
    // The filename is the export button's contract; assert it is threaded.
    const btn = container.querySelector('[data-testid="chart-export-button"], button')
    expect(btn).not.toBeNull()
    expect(container.querySelector('[data-testid="stage-breakdown-case"]')?.textContent)
      .toContain('sa_early_repurpose_120kkm')
  })

  it('renders no case badge for a single-case run, so nothing changes', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { container } = render(
      <StageBreakdownChart
        stageBreakdown={{ [LABEL]: { Manufacturing: 300 } }}
        methods={[{ method_label: LABEL, score: 300, unit: 'kg' }]}
        format={result.current}
        filenameBase="x"
      />,
    )
    expect(container.querySelector('[data-testid="stage-breakdown-case"]')).toBeNull()
  })
})

describe('inert cases are marked, as in the checklist', () => {
  // An inert case is filtered out BEFORE a run, so it can never be selected
  // into the tab bar directly. The marking is still reachable, and this is the
  // route: run a case that varies, then edit the parameter table so it stops
  // varying. The results are still on screen, and the tab is now inert.
  async function makeActiveCaseInert() {
    await computeMulti()
    useParameterStore.setState({
      table: {
        parameters: { p1: { name: 'p1', base_value: 1, scenario_overrides: {} } },
        scenarios: ['sa_early'], categories: [],
      },
    } as never)
  }

  it('marks a case the table no longer varies over', async () => {
    await makeActiveCaseInert()
    await waitFor(() => {
      const tab = screen.getByTestId('single-product-static-scenario-sa_early')
      expect(tab.textContent).toContain('inert')
      expect(tab.getAttribute('title')).toMatch(/duplicates Base/i)
    })
    // Base is never inert.
    expect(screen.getByTestId('single-product-static-scenario-Base').textContent)
      .not.toContain('inert')
  })

  it('carries the mark onto the chart badge', async () => {
    await makeActiveCaseInert()
    fireEvent.click(screen.getByTestId('single-product-static-scenario-sa_early'))
    await waitFor(() =>
      expect(screen.getByTestId('stage-breakdown-case').textContent).toContain('inert'))
  })
})

describe('the results table states which case its rows are', () => {
  it('adds a Sensitivity case column, matching the Excel export header', async () => {
    const { container } = await computeMulti()
    const headers = Array.from(container.querySelectorAll('th')).map((t) => t.textContent)
    expect(headers).toContain('Sensitivity case')
    expect(screen.getByTestId('single-product-static-row-case').textContent).toBe('Base')

    fireEvent.click(within(screen.getByTestId('single-product-static-scenario-tabs')).getByText('sa_early'))
    await waitFor(() =>
      expect(screen.getByTestId('single-product-static-row-case').textContent).toBe('sa_early'))
  })
})
