/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, within } from '@testing-library/react'
import { LCACalculator } from '../src/pages/LCACalculator'
import { useBOMStore } from '../src/stores/bomStore'
import * as client from '../src/api/client'

// #4 (LCACalculator) — the activity-source MultiItemSelector gets sourceKey=
// {selectedDb}, so switching the source DB resets the stale location/unit/folder
// value-filters (re-emitting cleared filters → page-level filters reset + a
// fresh backend search of the NEW db with the preserved query). The DB list is
// NOT filtered — LCA Architect intentionally offers prospective DBs.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const DB1 = 'ecoinvent-3.10-cutoff'
const DB2 = 'ecoinvent-3.11-cutoff'
const ACTS = [
  { key: 'k-dk', code: 'cdk', name: 'market for electricity, low voltage', location: 'DK', unit: 'kWh', product: 'electricity, low voltage', database: DB1 },
  { key: 'k-fr', code: 'cfr', name: 'market for electricity, low voltage', location: 'FR', unit: 'kWh', product: 'electricity, low voltage', database: DB1 },
]

let getActivitiesSpy: any

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.spyOn(client, 'getDatabases').mockResolvedValue([{ name: DB1 }, { name: DB2 }] as any)
  vi.spyOn(client, 'getMethods').mockResolvedValue([] as any)
  vi.spyOn(client, 'searchAllActivities').mockResolvedValue([] as any)
  vi.spyOn(client, 'getActivityDistinctValues').mockResolvedValue({ locations: ['DK', 'FR'], units: ['kWh'] } as any)
  getActivitiesSpy = vi.spyOn(client, 'getActivities').mockResolvedValue({ items: ACTS, total: 2 } as any)
  useBOMStore.setState({ archetypes: [], folders: [], fetchArchetypes: vi.fn() } as any)
})

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const dbSelect = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('select')).find((s) =>
    Array.from(s.options).some((o) => o.value === DB2)) as HTMLSelectElement

async function renderActivityMode() {
  const utils = render(<LCACalculator />)
  await waitFor(() => expect(utils.container.querySelector('select')).not.toBeNull())
  // Switch FU to activity mode.
  fireEvent.click(Array.from(utils.container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'activity')!)
  return utils
}

async function searchAndFilterDK(container: HTMLElement) {
  const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
  fireEvent.change(search, { target: { value: 'electricity' } })
  await wait()
  // Apply DK location filter.
  const filter = container.querySelector('[data-testid="multi-item-selector-location-filter"]') as HTMLElement
  fireEvent.click(filter.querySelector('button')!)
  const dk = container.querySelector('[data-testid="multi-item-selector-location-filter-option-DK"]') as HTMLElement
  fireEvent.click(dk.querySelector('input[type="checkbox"]') as HTMLInputElement)
  await wait()
  return search
}

describe('#4 LCACalculator — stale value-filter reset on DB switch', () => {
  it('switching DB clears the location filter, re-searches the new DB, preserves the query', async () => {
    const { container } = await renderActivityMode()
    const search = await searchAndFilterDK(container)

    // The filter is active — last search composed the DK location.
    const dkCall = getActivitiesSpy.mock.calls.at(-1)
    expect(dkCall[0]).toBe(DB1)
    expect(dkCall[4].locations).toEqual(['DK'])

    getActivitiesSpy.mockClear()
    // Switch the source database.
    fireEvent.change(dbSelect(container), { target: { value: DB2 } })
    await wait()

    // The new DB was searched with the filter CLEARED and the query PRESERVED.
    await waitFor(() => {
      const last = getActivitiesSpy.mock.calls.at(-1)
      expect(last).toBeTruthy()
      expect(last[0]).toBe(DB2)            // new DB
      expect(last[3]).toBe('electricity')  // query preserved
      expect(last[4].locations).toBeUndefined()  // location filter reset
    })
    // Search box still shows the query.
    expect((container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement).value).toBe('electricity')
  })

  it('idle (no DB switch) keeps the location filter intact', async () => {
    const { container } = await renderActivityMode()
    await searchAndFilterDK(container)
    getActivitiesSpy.mockClear()
    // Re-trigger a search WITHOUT switching DB → DK filter must persist.
    const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'electricity, low' } })
    await wait()
    const last = getActivitiesSpy.mock.calls.at(-1)
    expect(last[0]).toBe(DB1)
    expect(last[4].locations).toEqual(['DK'])  // filter intact (no sourceKey change)
  })
})
