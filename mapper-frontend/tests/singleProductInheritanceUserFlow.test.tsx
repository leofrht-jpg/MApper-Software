/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

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
  // The indicator text appears in two places once default-all pre-selects: the
  // checklist row (a <label> wrapping <input type="checkbox">) AND the selected-
  // indicator chips (no checkbox). Pick the checklist row — the one with a box.
  const spans = await within(container).findAllByText(indicatorLabel, undefined, { timeout: 3000 })
  for (const span of spans) {
    const checkbox = span.closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    if (checkbox) {
      fireEvent.click(checkbox)
      return
    }
  }
  throw new Error(`no checkbox-bearing label for "${indicatorLabel}"`)
}

describe('Static→Projected inheritance — user-click flow (Patch 4F, default-all start)', () => {
  // Default-all (Stage A): the Static picker starts with ALL of the method's
  // categories selected, and Projected inherits them via the live-mirror. The
  // 4F guard is unchanged — Static EDITS (now deselections) keep propagating to
  // Projected until Projected is customized; only the starting selection flipped
  // empty→full and the user operation flipped click-to-ADD → click-to-REMOVE.
  const ALL4 = [GWP_TUPLE, ACID_TUPLE, LANDUSE_TUPLE, WATER_TUPLE]

  it('mirrors multiple Static deselections into Projected', async () => {
    const { getAllByTestId } = render(
      <>
        <div data-testid="pane-static"><SingleProductStaticPanel archetypeId="arc-1" /></div>
        <div data-testid="pane-projected"><SingleProductProjectedPanel archetypeId="arc-1" /></div>
      </>,
    )
    const [staticPaneRoot] = getAllByTestId('pane-static')

    // Default-all settles: Static = all 4, Projected inherits all 4.
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().staticConfigByArc['arc-1']?.selectedMethods,
      ).toEqual(ALL4)
    })
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']?.selectedMethods,
      ).toEqual(ALL4)
    })

    // Deselect WATER on Static → Static [GWP, ACID, LANDUSE]; Projected mirrors.
    await clickIndicator(staticPaneRoot, 'user deprivation potential')
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().staticConfigByArc['arc-1']?.selectedMethods,
      ).toEqual([GWP_TUPLE, ACID_TUPLE, LANDUSE_TUPLE])
    })
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']?.selectedMethods,
      ).toEqual([GWP_TUPLE, ACID_TUPLE, LANDUSE_TUPLE])
    })

    // Deselect LANDUSE too — a SECOND Static edit must also propagate (the
    // don't-freeze guard: pre-Patch-4F the mirror froze after the first edit).
    await clickIndicator(staticPaneRoot, 'soil quality index')
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']?.selectedMethods,
      ).toEqual([GWP_TUPLE, ACID_TUPLE])
    })

    // Only Static was edited → Projected was never directly customized.
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

    // Default-all settles: Projected inherits all 4.
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']?.selectedMethods,
      ).toEqual(ALL4)
    })

    // User customizes Projected directly — flips scope. handleScopeClick sets
    // projectedCustomized=true.
    act(() => {
      getByTestId('single-product-projected-scope-outflows').click()
    })
    expect(
      useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1'],
    ).toBe(true)

    // Now deselect an indicator on Static. Pre-customization this would mirror;
    // post-customization it must NOT — Projected has drifted (frozen at the
    // pre-customization snapshot: all 4 methods + the user's outflows scope).
    await clickIndicator(staticPaneRoot, 'user deprivation potential')
    await waitFor(() => {
      expect(
        useSingleProductImpactStore.getState().staticConfigByArc['arc-1']?.selectedMethods,
      ).toHaveLength(3)
    })
    const projCfg = useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']
    expect(projCfg?.scope).toBe('outflows')
    expect(projCfg?.selectedMethods).toEqual(ALL4)  // frozen — deselection did NOT propagate
  })
})
