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

// Patch 5V — the multi-item database selector is Activities-mode-only. It scopes
// the activity search + is the base for the 5R vintages; archetypes resolve
// against their BOM's base ecoinvent links (compute_database is null). So the
// dropdown must NOT render in Archetypes mode, but must survive a mode switch
// (selectedDatabase is store-backed).

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const DB1 = 'ecoinvent-3.10-cutoff'
const DB2 = 'ecoinvent-3.11-cutoff'
const SELECT = 'multi-product-database-select'

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  useBOMStore.setState({ archetypes: [], fetchArchetypes: vi.fn(() => Promise.resolve()) } as any)
  // setDatabase actually updates selectedDatabase so the persistence test is real.
  useActivityStore.setState({
    activities: [], selectedDatabase: DB1,
    searchActivities: vi.fn(),
    setDatabase: vi.fn((name: string) => act(() => useActivityStore.setState({ selectedDatabase: name } as any))),
    setLocations: vi.fn(), setUnits: vi.fn(),
    distinctValues: { locations: [], units: [] },
  } as any)
  // >1 database so the selector's `databases.length > 1` gate can pass.
  useProjectStore.setState({ databases: [{ name: DB1 }, { name: DB2 }] as any, currentProject: 'test-proj' } as any)
  usePLCAStore.setState({ databases: [], fetchDatabases: vi.fn() } as any)
  useMultiProductLCAStore.getState().reset()
})

const toActivities = (g: any) => act(() => { fireEvent.click(g('multi-product-mode-activity')) })
const toArchetypes = (g: any) => act(() => { fireEvent.click(g('multi-product-mode-archetype')) })

describe('Multi-item database selector — Activities-mode-only (Patch 5V)', () => {
  it('is ABSENT in Archetypes mode (default) and PRESENT in Activities mode', () => {
    const { getByTestId, queryByTestId } = render(<MultiProductLCA />)
    // Default mode is Archetypes → no database dropdown.
    expect(queryByTestId(SELECT)).toBeNull()
    toActivities(getByTestId)
    expect(getByTestId(SELECT)).toBeInTheDocument()
  })

  it('preserves the Activities database selection across Archetypes ↔ Activities switches', () => {
    const { getByTestId, queryByTestId } = render(<MultiProductLCA />)
    toActivities(getByTestId)
    // Change to the 2nd database in Activities mode.
    act(() => { fireEvent.change(getByTestId(SELECT), { target: { value: DB2 } }) })
    expect(useActivityStore.getState().selectedDatabase).toBe(DB2)
    // Switch to Archetypes (dropdown gone) and back — selection intact.
    toArchetypes(getByTestId)
    expect(queryByTestId(SELECT)).toBeNull()
    expect(useActivityStore.getState().selectedDatabase).toBe(DB2)  // store-backed, not reset
    toActivities(getByTestId)
    expect((getByTestId(SELECT) as HTMLSelectElement).value).toBe(DB2)
  })

  it('archetype compute payload is unchanged — compute_database is null (no orphaned database)', async () => {
    const spy = vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue({ items: [], elapsed_seconds: 0, success_count: 0, error_count: 0 } as any)
    // Drive the store compute directly with an archetype item (the panel's
    // handleCompute sends only {scope, methods} — never selectedDatabase).
    act(() => { useMultiProductLCAStore.setState({ selectedItems: [{ type: 'archetype', archetype_id: 'arc-a', display_name: 'BEV' }] } as any) })
    await act(async () => {
      await useMultiProductLCAStore.getState().compute({ scope: 'all', methods: [['EF', 'cc']] })
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const body = spy.mock.calls[0][0]
    expect(body.compute_database).toBeNull()  // archetype background is NOT selectedDatabase
    expect(body.items[0]).toMatchObject({ type: 'archetype', archetype_id: 'arc-a' })
  })

  it('Activities-mode regression: the selector renders and changing it re-fires the search', () => {
    const searchSpy = vi.fn()
    useActivityStore.setState({ searchActivities: searchSpy } as any)
    const { getByTestId } = render(<MultiProductLCA />)
    toActivities(getByTestId)
    const sel = getByTestId(SELECT) as HTMLSelectElement
    expect(sel).toBeInTheDocument()
    act(() => { fireEvent.change(sel, { target: { value: DB2 } }) })
    // Changing the DB triggers a fresh first-page search (Activities flow intact).
    expect(searchSpy).toHaveBeenCalledWith('')
  })
})
