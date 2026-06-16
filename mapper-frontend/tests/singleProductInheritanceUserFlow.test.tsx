import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act, fireEvent, waitFor, within } from '@testing-library/react'
import { SingleProductStaticPanel } from '../src/components/impact/SingleProductStaticPanel'
import { SingleProductProjectedPanel } from '../src/components/impact/SingleProductProjectedPanel'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useParameterStore } from '../src/stores/parameterStore'

// Patch 4F — user-click-driven inheritance regression. The Patch 4E test
// suite seeded staticConfigByArc directly via the store, which doesn't
// exercise the actual click → MethodPicker.onChange → Static.handleMethodsChange
// → setStaticConfigForArc → slice-selector → Projected effect path. The
// real-world bug appeared only when the user toggled multiple indicators
// in sequence on the Static panel and switched to Projected — the panel
// stayed pinned to whatever state was committed at the FIRST inheritance
// trigger. This file walks the end-to-end click sequence so the
// regression can't escape behind a stub-state pass.

const GWP_TUPLE = ['EF v3.1 (E,T)', 'climate change', 'global warming potential (GWP100)']
const ACID_TUPLE = ['EF v3.1 (E,T)', 'acidification', 'accumulated exceedance']
const LANDUSE_TUPLE = ['EF v3.1 (E,T)', 'land use', 'soil quality index']
const WATER_TUPLE = ['EF v3.1 (E,T)', 'water use', 'user deprivation potential']

const MOCK_METHODS = [
  {
    family: 'EF v3.1 (E,T)',
    categories: [
      {
        category: 'climate change',
        indicators: [
          { indicator: 'global warming potential (GWP100)', tuple: GWP_TUPLE },
        ],
      },
      {
        category: 'acidification',
        indicators: [
          { indicator: 'accumulated exceedance', tuple: ACID_TUPLE },
        ],
      },
      {
        category: 'land use',
        indicators: [
          { indicator: 'soil quality index', tuple: LANDUSE_TUPLE },
        ],
      },
      {
        category: 'water use',
        indicators: [
          { indicator: 'user deprivation potential', tuple: WATER_TUPLE },
        ],
      },
    ],
  },
]

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    getMethods: vi.fn(() => Promise.resolve(MOCK_METHODS)),
  }
})

beforeEach(() => {
  // @ts-expect-error — minimal stub for jsdom (recharts ResponsiveContainer)
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  useSingleProductImpactStore.getState().reset()
  // Parameter store is read by SingleProductStaticPanel for the sensitivity
  // case checklist; reset to a clean default so BASE_SCENARIO is the only
  // selectable option.
  useParameterStore.setState({ table: null, selectedScenarios: [] })
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030',
      base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind',
      ssp: 'SSP2-PkBudg1150',
      year: 2030,
      years: [2030],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: 'separate' as any,
      created_at: '2026-01-01',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }] as any,
  })
})

// Helper: find an indicator checkbox in a MethodPicker by its label text.
// MethodPicker renders each indicator as a <label> wrapping <input
// type="checkbox"> + <span>{indicator}</span>.
async function clickIndicator(container: HTMLElement, indicatorLabel: string) {
  const span = await within(container).findByText(indicatorLabel, undefined, { timeout: 3000 })
  const label = span.closest('label')
  if (!label) throw new Error(`no <label> ancestor for "${indicatorLabel}"`)
  const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement | null
  if (!checkbox) throw new Error(`no checkbox under label for "${indicatorLabel}"`)
  fireEvent.click(checkbox)
}

describe('Static→Projected inheritance — user-click flow (Patch 4F)', () => {
  it('mirrors multiple Static indicator clicks into Projected', async () => {
    // Both panels mounted simultaneously for the same archetype. This
    // matches the real wrapper (SingleProductImpact) which uses
    // visibility-toggle on the per-tab panes — both Static and Projected
    // are alive while the user is on Static.
    const { getAllByTestId } = render(
      <>
        <div data-testid="pane-static"><SingleProductStaticPanel archetypeId="arc-1" /></div>
        <div data-testid="pane-projected"><SingleProductProjectedPanel archetypeId="arc-1" /></div>
      </>,
    )

    // Sanity: both panels rendered, no static/projected config yet.
    expect(useSingleProductImpactStore.getState().staticConfigByArc['arc-1']).toBeUndefined()
    expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']).toBeUndefined()

    // The Static panel sits at index 0 of the matched panes; locate it via
    // its testid wrapper to scope the indicator search.
    const [staticPaneRoot] = getAllByTestId('pane-static')

    // Click GWP. setStaticConfigForArc fires (with selectedMethods = [GWP]).
    // The Projected effect's slice selector returns the new ref; the
    // effect runs and inherits.
    await clickIndicator(staticPaneRoot, 'global warming potential (GWP100)')
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().staticConfigByArc['arc-1']?.selectedMethods,
      ).toEqual([GWP_TUPLE])
    })

    // Click acidification — STATIC now has [GWP, ACID]. Projected MUST
    // also see both. Pre-Patch-4F the Patch-4E inheritedForArcRef guard
    // froze Projected at [GWP] after the first inheritance and any
    // subsequent Static edit was silently ignored.
    await clickIndicator(staticPaneRoot, 'accumulated exceedance')
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().staticConfigByArc['arc-1']?.selectedMethods,
      ).toEqual([GWP_TUPLE, ACID_TUPLE])
    })
    // The actual regression assertion: Projected mirrored both clicks.
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']?.selectedMethods,
      ).toEqual([GWP_TUPLE, ACID_TUPLE])
    })

    // Add two more for a 4-indicator total — mimics the user's reported
    // workflow ("configured Static Background with 4 indicators selected").
    await clickIndicator(staticPaneRoot, 'soil quality index')
    await clickIndicator(staticPaneRoot, 'user deprivation potential')
    await waitFor(() => {
      const projCfg = useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']
      expect(projCfg?.selectedMethods).toHaveLength(4)
      expect(projCfg?.selectedMethods).toEqual(
        expect.arrayContaining([GWP_TUPLE, ACID_TUPLE, LANDUSE_TUPLE, WATER_TUPLE]),
      )
    })

    // Customized flag stays false because the user only edited Static —
    // Projected never received a direct user-click on its own controls.
    expect(
      useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1'],
    ).toBeFalsy()
  })

  it('stops mirroring after the user customizes Projected directly', async () => {
    const { getAllByTestId, getByTestId } = render(
      <>
        <div data-testid="pane-static"><SingleProductStaticPanel archetypeId="arc-1" /></div>
        <div data-testid="pane-projected"><SingleProductProjectedPanel archetypeId="arc-1" /></div>
      </>,
    )

    const [staticPaneRoot] = getAllByTestId('pane-static')

    // Configure Static with two indicators — both should mirror to Projected.
    await clickIndicator(staticPaneRoot, 'global warming potential (GWP100)')
    await clickIndicator(staticPaneRoot, 'accumulated exceedance')
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']?.selectedMethods,
      ).toEqual([GWP_TUPLE, ACID_TUPLE])
    })

    // User now customizes Projected directly — flips scope on the
    // Projected panel. handleScopeClick sets projectedCustomized=true.
    act(() => {
      getByTestId('single-product-projected-scope-outflows').click()
    })
    expect(
      useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1'],
    ).toBe(true)

    // Now add a third indicator to Static. Pre-customization this would
    // mirror; post-customization it must NOT — Projected has drifted.
    await clickIndicator(staticPaneRoot, 'soil quality index')
    await waitFor(() => {
      // Static reflects the new pick.
      expect(
        useSingleProductImpactStore.getState().staticConfigByArc['arc-1']?.selectedMethods,
      ).toHaveLength(3)
    })
    // Projected is frozen at the pre-customization snapshot ([GWP, ACID]).
    // Scope is the user's outflows pick; methods are the inherited two.
    const projCfg = useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']
    expect(projCfg?.scope).toBe('outflows')
    expect(projCfg?.selectedMethods).toEqual([GWP_TUPLE, ACID_TUPLE])
  })
})
