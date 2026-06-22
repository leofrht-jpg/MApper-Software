/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { SingleProductComparisonPanel } from '../src/components/impact/SingleProductComparisonPanel'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import type { ArchetypeLCACalculateResult } from '../src/api/client'

// Patch 4H — regression test for the "Rendered more hooks than during
// the previous render" bug introduced by Patch 4G.
//
// Cause: Patch 4G placed `useState(isExporting)` + `useCallback(handleExport)`
// AFTER the early-return guards on archetypeId/staticResult/projectedRuns
// in SingleProductComparisonPanel. Single-render tests passed because they
// stubbed the store either fully (full path) or empty (early-return path)
// before mount — so each test only exercised ONE of the two hook counts
// per component instance. The runtime bug only surfaced when the user
// transitioned within the same component instance from "no results" to
// "both results present" — N hooks → N+2 hooks → React throws.
//
// Fix: hooks are unconditional at the top of the component. This file
// asserts:
//   1. No throw in the empty (archetypeId null) state.
//   2. No throw in the partial (Static only) state.
//   3. No throw in the full (both) state.
//   4. No throw across a same-instance transition empty → full.
//
// (4) is the load-bearing assertion — it's the only path that reproduces
// the original bug. (1)-(3) round out single-state coverage.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    exportSingleProductComparison: vi.fn(async () => undefined),
  }
})

const STATIC_RESULT: ArchetypeLCACalculateResult = {
  archetype_id: 'arc-1',
  archetype_name: 'BEV-LFP|Small',
  scope: 'all',
  amount: 1,
  stage_amounts: { Manufacturing: 1, 'Use Phase': 15, Maintenance: 15, 'End of Life': 1 },
  stages_included: ['Manufacturing', 'Use Phase', 'Maintenance', 'End of Life'],
  results: [{
    method: ['EF v3.1', 'climate change', 'GWP100'],
    method_label: 'EF v3.1 › climate change › GWP100',
    score: 1234.5,
    unit: 'kg CO2-eq',
    contributions: [],
  }],
  elapsed_seconds: 1.0,
  compute_database: null,
  parameter_scenario: null,
  warnings: [],
  stage_breakdown: null,
}

const PROJECTED_RUN = {
  dbName: 'ei310-remind-ssp2-2030',
  year: 2030,
  iam: 'remind',
  ssp: 'SSP2-PkBudg1150',
  result: {
    ...STATIC_RESULT,
    compute_database: 'ei310-remind-ssp2-2030',
    results: [{ ...STATIC_RESULT.results[0], score: 800.0 }],
  },
}

beforeEach(() => {
  // @ts-expect-error - jsdom stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  useSingleProductImpactStore.getState().reset()
})

describe('SingleProductComparisonPanel — hook-order invariant (Patch 4H)', () => {
  it('renders cleanly with no archetype id', () => {
    expect(() => {
      render(<SingleProductComparisonPanel archetypeId={null} />)
    }).not.toThrow()
  })

  it('renders cleanly with archetype but no Static / no Projected', () => {
    expect(() => {
      render(<SingleProductComparisonPanel archetypeId="arc-1" />)
    }).not.toThrow()
  })

  it('renders cleanly with Static set but no Projected (partial state)', () => {
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')
    useSingleProductImpactStore.getState().setStaticResult(STATIC_RESULT)
    expect(() => {
      render(<SingleProductComparisonPanel archetypeId="arc-1" />)
    }).not.toThrow()
  })

  it('renders cleanly with both Static and Projected (full state)', () => {
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')
    useSingleProductImpactStore.getState().setStaticResult(STATIC_RESULT)
    useSingleProductImpactStore.getState().setProjectedRuns([PROJECTED_RUN])
    expect(() => {
      render(<SingleProductComparisonPanel archetypeId="arc-1" />)
    }).not.toThrow()
  })

  it('does NOT throw when transitioning empty → full within one component instance', () => {
    // The bug was specifically: same component instance, hook count
    // changes between renders. Mount in the empty state, then mutate
    // the store (which triggers a re-render of the SAME instance) into
    // the full state. If hook ordering is wrong, React throws on the
    // second render path with hooks count mismatch.
    useSingleProductImpactStore.getState().setArchetypeId('arc-1')

    let caught: unknown = null
    // React's hook-order error is thrown synchronously during render —
    // wrap the offending state mutation in expect-not-to-throw rather
    // than a try/catch around render itself, since the throw fires on
    // the re-render triggered by the store update, not the render call.
    expect(() => {
      const { rerender } = render(<SingleProductComparisonPanel archetypeId="arc-1" />)
      // First render — neither result is set; component takes the
      // early-return path (fewer hooks).
      // Now flip the store into the full path and force a re-render.
      act(() => {
        useSingleProductImpactStore.getState().setStaticResult(STATIC_RESULT)
        useSingleProductImpactStore.getState().setProjectedRuns([PROJECTED_RUN])
      })
      rerender(<SingleProductComparisonPanel archetypeId="arc-1" />)
    }).not.toThrow()
    expect(caught).toBeNull()
  })
})
