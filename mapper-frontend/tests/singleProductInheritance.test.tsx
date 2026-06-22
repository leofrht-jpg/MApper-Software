/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { SingleProductProjectedPanel } from '../src/components/impact/SingleProductProjectedPanel'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { usePLCAStore } from '../src/stores/plcaStore'

// Patch 4D — inherit-on-first-visit (Static → Projected). Single-shot copy
// when Projected is first opened for an archetype that has a Static config
// set. After inheritance, the user's Projected customizations drift
// independently — Static changes do not auto-update Projected. The store's
// `projectedCustomizedByArc` flag prevents re-inheritance even if the user
// later clears Projected back to empty.

const GWP_TUPLE = ['EF v3.1 (E,T)', 'climate change', 'global warming potential (GWP100)']
const ACID_TUPLE = ['EF v3.1 (E,T)', 'acidification', 'accumulated exceedance']

// Mock `getMethods` so the MethodPicker resolves deterministically without a
// network call. The picker's seed-onChange path fires synchronously from
// `useState` initializer + the mount effect; family/category loading happens
// async but doesn't gate the assertions we're making (we read the panel's
// local state via the store, not picker checkboxes).
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    getMethods: vi.fn(async () => ([
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
        ],
      },
    ])),
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

describe('SingleProductProjectedPanel — inherit-on-first-visit (Patch 4D)', () => {
  it('inherits scope and selectedMethods from Static on first visit', () => {
    // Pre-configure Static for arc-1.
    useSingleProductImpactStore.getState().setStaticConfigForArc('arc-1', {
      scope: 'stock',
      selectedMethods: [GWP_TUPLE],
    })

    const { getByTestId } = render(<SingleProductProjectedPanel archetypeId="arc-1" />)

    // Banner appears once at inheritance time.
    expect(getByTestId('single-product-projected-inherit-banner')).toBeInTheDocument()

    // Store reflects the inherited config — written by the inherit branch
    // so subsequent visits hit path 1 (restore) and don't re-show the banner.
    const projCfg = useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']
    expect(projCfg).toBeDefined()
    expect(projCfg.scope).toBe('stock')
    expect(projCfg.selectedMethods).toEqual([GWP_TUPLE])
    expect(projCfg.selectedDbs).toEqual([])

    // Inheritance does NOT mark customized — the user hasn't touched it.
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBeFalsy()
  })

  it('does not re-inherit after Projected customization, even when Static changes', () => {
    // Static configured.
    useSingleProductImpactStore.getState().setStaticConfigForArc('arc-1', {
      scope: 'stock',
      selectedMethods: [GWP_TUPLE],
    })
    const { getByTestId } = render(<SingleProductProjectedPanel archetypeId="arc-1" />)
    // Inherited.
    expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1'].scope).toBe('stock')

    // User modifies Projected scope.
    act(() => {
      getByTestId('single-product-projected-scope-outflows').click()
    })
    // Projected is now customized; store reflects user's pick.
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBe(true)
    expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1'].scope).toBe('outflows')

    // Static changes after Projected was initialized.
    act(() => {
      useSingleProductImpactStore.getState().setStaticConfigForArc('arc-1', {
        scope: 'inflows',
        selectedMethods: [ACID_TUPLE],
      })
    })

    // Projected's stored config remains the user's customization. Patch
    // 4F semantic: live mirror runs WHILE projectedCustomized is false;
    // once the user clicks scope-outflows the customized flag flips true
    // and Static changes no longer propagate.
    expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1'].scope).toBe('outflows')
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBe(true)
  })

  it('does not inherit when Static has no configured methods', () => {
    // No staticConfigByArc seed — user never configured Static for arc-1.
    const { queryByTestId } = render(<SingleProductProjectedPanel archetypeId="arc-1" />)

    expect(queryByTestId('single-product-projected-inherit-banner')).toBeNull()
    // Path 3: defaults. We deliberately do NOT write defaults to
    // projectedConfigByArc — that would block path 2 if the user later
    // configures Static and revisits Projected.
    expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']).toBeUndefined()
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBeFalsy()
  })

  it('inherits when Static is configured AFTER Projected was mounted (Patch 4E bug)', () => {
    // Bug repro: the user mounts the Projected panel for an archetype with
    // no Static config yet (path 3 → defaults), THEN goes to Static and
    // configures it. Pre-Patch-4E the inherit effect was keyed on
    // [archetypeId] only, so it didn't re-fire when staticConfigByArc
    // changed mid-session — Projected stayed on defaults forever.
    //
    // Both panels are visibility-toggle-mounted (same impact-mode wrapper),
    // so archetypeId is NOT the only state transition that matters; the
    // staticConfigByArc[arc] slice must also drive the trigger.

    // Mount with no Static config seeded — path 3 fires.
    const { getByTestId, queryByTestId } = render(
      <SingleProductProjectedPanel archetypeId="arc-1" />,
    )
    expect(queryByTestId('single-product-projected-inherit-banner')).toBeNull()
    expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']).toBeUndefined()

    // User now configures Static (simulated by writing the store directly,
    // matching what SingleProductStaticPanel.handleMethodsChange does).
    act(() => {
      useSingleProductImpactStore.getState().setStaticConfigForArc('arc-1', {
        scope: 'stock',
        selectedMethods: [GWP_TUPLE, ACID_TUPLE],
      })
    })

    // The sliced staticCfgForArc selector returns a new reference, so the
    // inherit effect re-fires. projCfg was still undefined, customized
    // falsy, inheritedForArcRef !== arc-1 → path 2 inherits.
    expect(getByTestId('single-product-projected-inherit-banner')).toBeInTheDocument()
    const projCfg = useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']
    expect(projCfg).toBeDefined()
    expect(projCfg.scope).toBe('stock')
    expect(projCfg.selectedMethods).toEqual([GWP_TUPLE, ACID_TUPLE])
    expect(projCfg.selectedDbs).toEqual([])
    // Inheritance does not flip customized — user hasn't touched Projected.
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBeFalsy()
  })

  it('live-mirrors subsequent Static edits while Projected is uncustomized (Patch 4F semantic)', () => {
    // Patch 4F flipped from "one-shot at first slice change" to live
    // mirror until customized. The original 4E test asserted no
    // double-inheritance; that semantic broke the user workflow of
    // adding indicators sequentially on Static (only the first inherited).
    // Live mirror is the correct contract: until the user customizes
    // Projected, every Static edit propagates.
    render(<SingleProductProjectedPanel archetypeId="arc-1" />)
    act(() => {
      useSingleProductImpactStore.getState().setStaticConfigForArc('arc-1', {
        scope: 'stock',
        selectedMethods: [GWP_TUPLE],
      })
    })
    const cfgAfterFirst = useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']
    expect(cfgAfterFirst.selectedMethods).toEqual([GWP_TUPLE])

    // Second Static edit propagates because Projected hasn't been
    // customized — staticCfg slice change re-fires the mirror.
    act(() => {
      useSingleProductImpactStore.getState().setStaticConfigForArc('arc-1', {
        scope: 'inflows',
        selectedMethods: [GWP_TUPLE, ACID_TUPLE],
      })
    })
    const cfgAfterSecond = useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']
    expect(cfgAfterSecond.scope).toBe('inflows')
    expect(cfgAfterSecond.selectedMethods).toEqual([GWP_TUPLE, ACID_TUPLE])
    // Customized still false — the user only edited Static.
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBeFalsy()
  })

  it('inherits per archetype — switching archetypes preserves prior arcs unchanged', () => {
    // Two archetypes with distinct Static configs.
    const store = useSingleProductImpactStore.getState()
    store.setStaticConfigForArc('arc-1', { scope: 'stock', selectedMethods: [GWP_TUPLE] })
    store.setStaticConfigForArc('arc-2', { scope: 'outflows', selectedMethods: [ACID_TUPLE] })

    // Mount for arc-1, customize.
    const { getByTestId, rerender } = render(
      <SingleProductProjectedPanel archetypeId="arc-1" />,
    )
    expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1'].scope).toBe('stock')
    act(() => {
      getByTestId('single-product-projected-scope-inflows').click()
    })
    expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1'].scope).toBe('inflows')
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBe(true)

    // Switch to arc-2 — fresh inheritance from arc-2's static, not a
    // leak from arc-1's customization.
    rerender(<SingleProductProjectedPanel archetypeId="arc-2" />)
    const arc2Cfg = useSingleProductImpactStore.getState().projectedConfigByArc['arc-2']
    expect(arc2Cfg).toBeDefined()
    expect(arc2Cfg.scope).toBe('outflows')
    expect(arc2Cfg.selectedMethods).toEqual([ACID_TUPLE])
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-2']).toBeFalsy()

    // arc-1's customized state preserved untouched.
    expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1'].scope).toBe('inflows')
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBe(true)
  })
})
