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
import { render, fireEvent, act } from '@testing-library/react'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type { ActivitySummary, ArchetypeSummary } from '../src/api/client'

// Bugfix — Multi-item comparison activity search returned "0 matching" for a
// valid ecoinvent activity ("market for electricity, low voltage") because the
// selector only filtered the loaded first page (50 rows) client-side; the
// backend (which matches name OR reference product OR location) was never
// re-queried. The fix wires the selector's onSearchChange/onFiltersChange to
// useActivityStore (same path as Database Explorer), so typing re-queries the
// backend. These tests lock the round-trip + the name/product matching.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const ELEC: ActivitySummary = {
  name: 'market for electricity, low voltage',
  product: 'electricity, low voltage',
  location: 'DK', unit: 'kWh', database: 'ei-3.10',
  code: 'elec-lv-dk', key: 'ei-3.10|elec-lv-dk',
} as any
const ELEC_TESTID = `multi-item-selector-result-act:${ELEC.database}|${ELEC.code}`

const ARCHETYPES: ArchetypeSummary[] = [
  { id: 'arc-bev', name: 'BEV-LFP', description: null, category: 'pc', folder: 'PC', material_count: 1, unlinked_count: 0, stages: ['Manufacturing'], stage_annual: {}, created_at: '', updated_at: '' },
] as any

// Mimics the backend matcher: case-insensitive substring on name OR reference
// product OR location. The whole point of the fix is that the typed query
// reaches THIS path (the backend), not just the in-memory page.
const backendMatch = (q: string): ActivitySummary[] => {
  const ql = q.trim().toLowerCase()
  if (!ql) return []
  return [ELEC].filter((a) =>
    a.name.toLowerCase().includes(ql)
    || a.product.toLowerCase().includes(ql)
    || a.location.toLowerCase().includes(ql))
}

let searchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])

  // searchActivities re-queries the backend; the spy updates the store's
  // `activities` slot with the matching rows (what fetchActivities would do).
  searchSpy = vi.fn((q: string) => {
    act(() => useActivityStore.setState({ activities: backendMatch(q) } as any))
  })

  useBOMStore.setState({ archetypes: ARCHETYPES, fetchArchetypes: vi.fn() } as any)
  useActivityStore.setState({
    activities: [],                       // first page is NOT pre-loaded with ELEC
    selectedDatabase: 'ei-3.10',
    searchActivities: searchSpy,
    setDatabase: vi.fn(),
    setLocations: vi.fn(),
    setUnits: vi.fn(),
    distinctValues: { locations: ['DK', 'DE'], units: ['kWh'] },
  } as any)
  useProjectStore.setState({ databases: [{ name: 'ei-3.10', size_mb: 1, activity_count: 1 } as any] } as any)
  // Component calls fetchDatabases() on mount for the vintage picker — stub it
  // so no real network call fires (deterministic; cf. the 5L flake lesson).
  usePLCAStore.setState({ databases: [], fetchDatabases: vi.fn() } as any)
  useMultiProductLCAStore.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

// Activity rows only render in Activities mode (within-type toggle, default
// Archetypes). Switch first, then search.
const enterActivityMode = (getByTestId: any) => {
  act(() => { fireEvent.click(getByTestId('multi-product-mode-activity')) })
}
const typeSearch = (getByTestId: any, value: string) => {
  fireEvent.change(getByTestId('multi-item-selector-search'), { target: { value } })
  act(() => { vi.advanceTimersByTime(300) }) // flush the debounce
}

describe('Multi-item comparison — activity search round-trips to the backend', () => {
  it('searching by the ACTIVITY-NAME phrasing re-queries the backend and returns the activity', () => {
    const { getByTestId, queryByTestId } = render(<MultiProductLCA />)
    enterActivityMode(getByTestId)
    // Not present before searching (first page empty).
    expect(queryByTestId(ELEC_TESTID)).toBeNull()

    typeSearch(getByTestId, 'market for electricity, low voltage')

    // Backend was queried with the typed phrase (not silently client-filtered).
    expect(searchSpy).toHaveBeenCalledWith('market for electricity, low voltage')
    // …and the matched activity row now renders.
    expect(getByTestId(ELEC_TESTID)).toBeInTheDocument()
  })

  it('searching by the REFERENCE-PRODUCT phrasing also matches', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    enterActivityMode(getByTestId)
    typeSearch(getByTestId, 'electricity, low voltage')
    expect(searchSpy).toHaveBeenCalledWith('electricity, low voltage')
    expect(getByTestId(ELEC_TESTID)).toBeInTheDocument()
  })

  it('regression: archetype search still works (client-side over loaded archetypes)', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    typeSearch(getByTestId, 'BEV')
    expect(getByTestId('multi-item-selector-result-arc:arc-bev')).toBeInTheDocument()
  })

  it('does not rely on a stale first page: empty initial activities + no query → activity hidden', () => {
    const { queryByTestId } = render(<MultiProductLCA />)
    // No search typed → nothing dispatched, ELEC not in the (empty) page.
    expect(queryByTestId(ELEC_TESTID)).toBeNull()
  })
})
