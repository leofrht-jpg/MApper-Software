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
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'

// #3 — the activity-SOURCE dropdown offers only ORIGINAL/base DBs (uploaded
// ecoinvent + biosphere), never the premise-derived prospective DBs. Those are
// the LCI year-vintages, picked AFTER an activity is chosen, and live solely in
// the vintage picker (fed usePLCAStore.databases — a separate source).
// Classification: a DB is prospective iff its name ∈ usePLCAStore.databases.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const ECO = 'ecoinvent-3.10-cutoff'
const BIO = 'biosphere3'
const PREM1 = 'ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030'
const PREM2 = 'ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2050'
const SELECT = 'multi-product-database-select'

const prospective = (name: string, year: number) => ({
  name, base_db: ECO, iam: 'remind', ssp: 'SSP2-PkBudg1150',
  year, years: [year], mode: 'separate', created_at: 'x',
})

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  useBOMStore.setState({ archetypes: [], fetchArchetypes: vi.fn(() => Promise.resolve()) } as any)
  useActivityStore.setState({
    activities: [], selectedDatabase: ECO,
    searchActivities: vi.fn(),
    setDatabase: vi.fn((name: string) => act(() => useActivityStore.setState({ selectedDatabase: name } as any))),
    setLocations: vi.fn(), setUnits: vi.fn(),
    distinctValues: { locations: [], units: [] },
  } as any)
  // Project registry = base ecoinvent + biosphere + TWO premise prospective DBs.
  useProjectStore.setState({
    databases: [{ name: ECO }, { name: BIO }, { name: PREM1 }, { name: PREM2 }] as any,
    currentProject: 'test-proj',
  } as any)
  // pLCA registry classifies PREM1/PREM2 as prospective.
  usePLCAStore.setState({ databases: [prospective(PREM1, 2030), prospective(PREM2, 2050)] as any, fetchDatabases: vi.fn() } as any)
  useMultiProductLCAStore.getState().reset()
})

const toActivities = (g: any) => act(() => { fireEvent.click(g('multi-product-mode-activity')) })

describe('#3 source dropdown excludes premise prospective DBs', () => {
  it('lists only base DBs (ecoinvent + biosphere); prospective DBs are absent', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    toActivities(getByTestId)
    const sel = getByTestId(SELECT) as HTMLSelectElement
    const options = Array.from(sel.options).map((o) => o.value)
    expect(options).toEqual([ECO, BIO])           // base only, in registry order
    expect(options).not.toContain(PREM1)
    expect(options).not.toContain(PREM2)
  })

  it('LCI-picker source (usePLCAStore.databases) still holds ALL vintages — filter is dropdown-only', () => {
    render(<MultiProductLCA />)
    const lciNames = usePLCAStore.getState().databases.map((d) => d.name)
    expect(lciNames).toEqual([PREM1, PREM2])      // untouched: vintages remain available to the vintage picker
  })

  it('a selectedDatabase that is prospective is corrected to a base DB (guard)', async () => {
    // Land on a prospective DB (e.g. a value persisted earlier) → the guard
    // effect re-picks the first base DB so the source never stays prospective.
    act(() => { useActivityStore.setState({ selectedDatabase: PREM1 } as any) })
    render(<MultiProductLCA />)
    await waitFor(() => expect(useActivityStore.getState().selectedDatabase).toBe(ECO))
  })
})
