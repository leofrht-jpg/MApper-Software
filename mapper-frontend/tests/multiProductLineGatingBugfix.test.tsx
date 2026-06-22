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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type { MultiProductLCAResult } from '../src/api/client'

// Patch 5S follow-up bugfix — Line availability is DATA-driven from the DISPLAYED
// results' year axis (≥2 distinct years across scenarios), snapshotted at compute
// (multiVintageCoords). It must NOT depend on the live selection or compareMode:
// keying it to the selection disabled Line on valid line-able results once the
// selection changed (e.g. cleared on a mode switch).

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const BASE = 'ei-3.10'
const CODE = 'elec'
const METHOD = 'EF v3.1 › cc'

function vintageResultItem(ssp: string, year: number, score: number) {
  const db = `${BASE}_premise_remind_${ssp.toLowerCase()}_${year}`
  return {
    item: { type: 'activity', item_id: `${db}|${CODE}`, label: `electricity, low voltage [${ssp} ${year}]`, status: 'success', activity_result: { results: [{ method: ['m'], method_label: METHOD, score, unit: 'kg', contributions: [] }], elapsed_seconds: 0 } } as any,
    coord: { key: `${db}|${CODE}`, label: `${ssp} ${year}`, database: db, base_database: BASE, iam: 'remind', ssp, year },
  }
}

// Seed ONLY the results + coords snapshot — NO selectedItems (mimics the bug:
// results outlive a cleared selection / mode switch).
function seedResultsOnly(spec: { ssp: string; year: number; score: number }[]) {
  const built = spec.map((s) => vintageResultItem(s.ssp, s.year, s.score))
  const result: MultiProductLCAResult = { items: built.map((b) => b.item), elapsed_seconds: 0.1, success_count: built.length, error_count: 0 } as any
  const multiVintageCoords: Record<string, any> = {}
  for (const b of built) multiVintageCoords[b.coord.key] = b.coord
  act(() => { useMultiProductLCAStore.setState({ selectedItems: [], multiResult: result, multiVintageCoords } as any) })
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  try { localStorage.clear() } catch { /* jsdom */ }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  useActivityStore.setState({ activities: [], selectedDatabase: BASE, searchActivities: vi.fn(), setDatabase: vi.fn(), setLocations: vi.fn(), setUnits: vi.fn(), distinctValues: { locations: [], units: [] } } as any)
  useProjectStore.setState({ databases: [{ name: BASE }] as any, currentProject: 'test-proj' } as any)
  usePLCAStore.setState({ databases: [], fetchDatabases: vi.fn() } as any)
  useMultiProductLCAStore.getState().reset()
  useBOMStore.setState({ archetypes: [], fetchArchetypes: vi.fn(() => Promise.resolve()) } as any)
})

describe('Line gating follows the displayed RESULTS, not the selection/mode (5S bugfix)', () => {
  it('Line is ENABLED for line-able results even when the selection is empty and mode is Archetypes', () => {
    // 6 vintages × 3 SSPs across 2 years — line-able. Selection empty; default mode Archetypes.
    seedResultsOnly([
      { ssp: 'SSP1-PkBudg1150', year: 2030, score: 0.11 }, { ssp: 'SSP1-PkBudg1150', year: 2040, score: 0.031 },
      { ssp: 'SSP2', year: 2030, score: 0.095 }, { ssp: 'SSP2', year: 2040, score: 0.023 },
    ])
    const { getByTestId } = render(<MultiProductLCA />)
    const lineBtn = getByTestId('multi-product-charttype-line') as HTMLButtonElement
    expect(lineBtn.disabled).toBe(false)  // gated on results' year axis, not the (empty) selection
    expect(useMultiProductLCAStore.getState().selectedItems).toHaveLength(0)
  })

  it('Line is DISABLED for multi-distinct-activity results (no year axis), even in Activities-shaped results', () => {
    // Two DISTINCT activities (no premise vintage coords / no year) → not line-able.
    const result: MultiProductLCAResult = {
      items: [
        { type: 'activity', item_id: `${BASE}|steel`, label: 'steel', status: 'success', activity_result: { results: [{ method: ['m'], method_label: METHOD, score: 1, unit: 'kg', contributions: [] }], elapsed_seconds: 0 } },
        { type: 'activity', item_id: `${BASE}|alu`, label: 'aluminium', status: 'success', activity_result: { results: [{ method: ['m'], method_label: METHOD, score: 2, unit: 'kg', contributions: [] }], elapsed_seconds: 0 } },
      ], elapsed_seconds: 0.1, success_count: 2, error_count: 0,
    } as any
    // No ssp/year coords → no year axis.
    const coords = { [`${BASE}|steel`]: { label: '', database: BASE, base_database: BASE, iam: null, ssp: null, year: null },
      [`${BASE}|alu`]: { label: '', database: BASE, base_database: BASE, iam: null, ssp: null, year: null } }
    act(() => { useMultiProductLCAStore.setState({ selectedItems: [], multiResult: result, multiVintageCoords: coords } as any) })
    const { getByTestId } = render(<MultiProductLCA />)
    const lineBtn = getByTestId('multi-product-charttype-line') as HTMLButtonElement
    expect(lineBtn.disabled).toBe(true)
    expect(lineBtn.title).toMatch(/multiple years/i)
  })

  it('Line is DISABLED for archetype results (no year axis)', () => {
    const result: MultiProductLCAResult = {
      items: [{ type: 'archetype', item_id: 'arc-a', label: 'BEV', status: 'success', archetype_result: { archetype_id: 'arc-a', archetype_name: 'BEV', scope: 'all', amount: 1, stage_amounts: {}, stages_included: [], results: [{ method: ['m'], method_label: METHOD, score: 1, unit: 'kg', contributions: [] }], stage_breakdown: null, elapsed_seconds: 0 } }],
      elapsed_seconds: 0.1, success_count: 1, error_count: 0,
    } as any
    act(() => { useMultiProductLCAStore.setState({ selectedItems: [], multiResult: result, multiVintageCoords: null } as any) })
    const { getByTestId } = render(<MultiProductLCA />)
    expect((getByTestId('multi-product-charttype-line') as HTMLButtonElement).disabled).toBe(true)
  })

  it('state hygiene: switching compareMode clears the results (no stale cross-mode chart) AND the selection', () => {
    seedResultsOnly([
      { ssp: 'SSP1-PkBudg1150', year: 2030, score: 0.11 }, { ssp: 'SSP1-PkBudg1150', year: 2040, score: 0.031 },
    ])
    // Put a selection in too, to confirm both clear.
    act(() => { useMultiProductLCAStore.setState({ selectedItems: [{ type: 'archetype', archetype_id: 'arc-a', display_name: 'BEV' } as any] } as any) })
    const { getByTestId, queryByTestId } = render(<MultiProductLCA />)
    expect(getByTestId('multi-product-results')).toBeInTheDocument()  // results visible
    // Switch mode (default Archetypes → Activities).
    act(() => { fireEvent.click(getByTestId('multi-product-mode-activity')) })
    expect(useMultiProductLCAStore.getState().multiResult).toBeNull()         // results cleared
    expect(useMultiProductLCAStore.getState().multiVintageCoords).toBeNull()  // coords cleared
    expect(useMultiProductLCAStore.getState().selectedItems).toHaveLength(0)  // selection still clears
    expect(queryByTestId('multi-product-results')).toBeNull()                 // no stale chart
  })
})
