/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within, act } from '@testing-library/react'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    searchBiosphereFlows: vi.fn(),
    getProjects: vi.fn(async () => [{ name: 'P', is_current: true }]),
    getDatabases: vi.fn(),
    getActivities: vi.fn(async () => ({ items: [], total: 0 })),
    getActivityDistinctValues: vi.fn(async () => ({ locations: [], units: [] })),
    getActivityDetail: vi.fn(async () => ({
      key: "('biosphere3', 's')", code: 's', name: 'Nitrogen oxides', location: '', unit: 'kilogram',
      product: '', database: 'biosphere3', categories: ['air', 'non-urban air or from high stacks'],
      exchanges: [], metadata: {},
    })),
  }
})

import * as client from '../src/api/client'
import {
  BiosphereFlowPicker, ORDER_NOTE, USAGE_TOOLTIP,
} from '../src/components/authored/BiosphereFlowPicker'
import type { FlowCandidate, FlowSearchResponse } from '../src/api/client'

// Real MAp-test numbers for Nitrogen oxides, measured when the picker was built.
const cand = (code: string, cats: string[], pm: number | undefined, used: number, floor: number | null,
  extra: Record<string, number> = { acidification: 0.74 }): FlowCandidate => ({
  database: 'biosphere3', code, name: 'Nitrogen oxides', categories: cats, unit: 'kilogram',
  type: 'emission', ecoinvent_exchanges: used, floor_available: floor !== null, floor_gsd2: floor,
  floor_n: floor === null ? 0 : 100,
  characterised: Object.keys(extra).length + (pm === undefined ? 0 : 1),
  factors: pm === undefined ? extra : { ...extra, 'particulate matter formation': pm },
})

const EF: FlowSearchResponse = {
  database: 'biosphere3', family: 'EF v3.1', families: ['EF v3.1', 'EF v3.1 no LT'], truncated: false,
  groups: [{
    name: 'Nitrogen oxides', database: 'biosphere3', units: ['kilogram'], family_indicator_count: 25,
    // Server order: alphabetical by compartment. Usage deliberately NOT monotone.
    candidates: [
      cand('l', ['air', 'low population density, long-term'], 1.6e-6, 65, null),
      cand('s', ['air', 'non-urban air or from high stacks'], 2.1e-7, 2793, 1.93),
      cand('u', ['air', 'urban air close to ground'], 1.6e-6, 1770, 1.889),
    ],
    varying_methods: [{ label: 'particulate matter formation', method: ['EF v3.1', 'particulate matter formation', 'x'] }],
    uniform_methods: [{ label: 'acidification', method: ['EF v3.1', 'acidification', 'x'] }],
  }],
}

const NO_LT: FlowSearchResponse = {
  ...EF, family: 'EF v3.1 no LT',
  groups: [{
    ...EF.groups[0], family_indicator_count: 20,
    candidates: [
      cand('l', ['air', 'low population density, long-term'], undefined, 65, null, {}),
      cand('s', ['air', 'non-urban air or from high stacks'], undefined, 2793, 1.93, { 'acidification no LT': 0.74 }),
      cand('u', ['air', 'urban air close to ground'], undefined, 1770, 1.889, { 'acidification no LT': 0.74 }),
    ],
    varying_methods: [{ label: 'acidification no LT', method: ['EF v3.1 no LT', 'acidification no LT', 'x'] }],
    uniform_methods: [],
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

async function typeQuery(container: HTMLElement, q: string) {
  await act(async () => {
    fireEvent.change(within(container).getByTestId('flow-picker-search'), { target: { value: q } })
    await new Promise((r) => setTimeout(r, 5))
  })
}

function expand(container: HTMLElement) {
  fireEvent.click(within(container).getByTestId('flow-picker-group-toggle-Nitrogen-oxides'))
}

async function renderSearched(response = EF, onSelect = vi.fn()) {
  vi.mocked(client.searchBiosphereFlows).mockResolvedValue(response)
  const r = render(<BiosphereFlowPicker database="biosphere3" onSelect={onSelect} debounceMs={0} />)
  await typeQuery(r.container, 'nitrogen')
  return { ...r, onSelect }
}

describe('BiosphereFlowPicker', () => {
  it('asks for two letters and does not search on one', async () => {
    const r = render(<BiosphereFlowPicker database="biosphere3" debounceMs={0} />)
    expect(within(r.container).getByTestId('flow-picker-hint')).toBeTruthy()
    await typeQuery(r.container, 'n')
    expect(client.searchBiosphereFlows).not.toHaveBeenCalled()
  })

  it('groups start collapsed and expand on click', async () => {
    const { container } = await renderSearched()
    const body = within(container).getByTestId('flow-picker-group-body-Nitrogen-oxides')
    expect(body.style.display).toBe('none')
    fireEvent.click(within(container).getByTestId('flow-picker-group-toggle-Nitrogen-oxides'))
    expect(body.style.display).toBe('block')
  })

  it('shows only the factors that differ, and lists the rest on one line', async () => {
    const { container } = await renderSearched()
    const cols = within(container).getAllByTestId('flow-picker-varying-col').map((e) => e.textContent)
    expect(cols).toEqual(['particulate matter formation'])
    expect(within(container).getByTestId('flow-picker-uniform').textContent)
      .toBe('Same factor in every compartment: acidification')
  })

  it('states that the order means nothing, and labels usage as information', async () => {
    const { container } = await renderSearched()
    expect(within(container).getByTestId('flow-picker-order-note').textContent).toBe(ORDER_NOTE)
    expect(within(container).getByTestId('flow-picker-usage-header').getAttribute('title')).toBe(USAGE_TOOLTIP)
    // Rows keep the server's alphabetical order even though usage is not monotone.
    expand(container)
    const rows = within(container).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'flow-picker-candidate-l', 'flow-picker-candidate-s', 'flow-picker-candidate-u',
    ])
  })

  it('warns on a compartment the family does not characterise, naming the indicator', async () => {
    const ef = await renderSearched()
    expect(within(ef.container).queryAllByTestId('flow-picker-coverage-warning')).toHaveLength(0)
    ef.unmount()
    const { container } = await renderSearched(NO_LT)
    const warnings = within(container).getAllByTestId('flow-picker-coverage-warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].textContent).toContain('acidification no LT')
    expect(within(container).getByTestId('flow-picker-candidate-l').textContent).toContain('Not characterised')
  })

  it('says so when the family has no coverage gap, and does not when it has one', async () => {
    const ef = await renderSearched()
    expect(within(ef.container).getByTestId('flow-picker-no-gap').textContent).toBe(
      'No coverage gap: every compartment is characterised by the same 2 of 25 EF v3.1 indicators.')
    ef.unmount()
    const { container } = await renderSearched(NO_LT)
    expect(within(container).queryByTestId('flow-picker-no-gap')).toBeNull()
    expect(within(container).getAllByTestId('flow-picker-coverage-warning')).toHaveLength(1)
  })

  it('selects nothing until the user clicks, then returns the flow', async () => {
    const { container, onSelect } = await renderSearched()
    expand(container)
    const rows = within(container).getAllByRole('row').slice(1)
    expect(rows.every((r) => r.getAttribute('aria-selected') === 'false')).toBe(true)
    fireEvent.click(within(container).getByTestId('flow-picker-candidate-s'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    const picked = onSelect.mock.calls[0][0] as FlowCandidate
    expect([picked.database, picked.code, picked.categories]).toEqual(
      ['biosphere3', 's', ['air', 'non-urban air or from high stacks']])
    expect(within(container).getByTestId('flow-picker-candidate-s').getAttribute('aria-selected')).toBe('true')
  })

  it('switching family searches again with that family', async () => {
    const { container } = await renderSearched()
    vi.mocked(client.searchBiosphereFlows).mockResolvedValue(NO_LT)
    await act(async () => {
      fireEvent.change(within(container).getByTestId('flow-picker-family'), { target: { value: 'EF v3.1 no LT' } })
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(vi.mocked(client.searchBiosphereFlows).mock.calls.at(-1)?.[0]).toMatchObject({
      q: 'nitrogen', database: 'biosphere3', family: 'EF v3.1 no LT',
    })
  })
})

// ── Mounted in the Database Explorer ────────────────────────────────────────

import { useProjectStore } from '../src/stores/projectStore'
import { useActivityStore } from '../src/stores/activityStore'
import { DatabaseExplorer } from '../src/pages/DatabaseExplorer'

describe('Database Explorer: Browse by substance', () => {
  async function mountWith(databases: string[]) {
    vi.mocked(client.getDatabases).mockResolvedValue(
      databases.map((name) => ({ name, records: 1, modified: '', is_prospective: false, prospective_meta: null })) as never)
    useActivityStore.getState().reset()
    await act(async () => { await useProjectStore.getState().resyncAfterProjectChange() })
    const r = render(<DatabaseExplorer />)
    await act(async () => { await new Promise((res) => setTimeout(res, 5)) })
    return r
  }

  it('offers the substance view only for a biosphere database, hiding (not unmounting) the list', async () => {
    const { container } = await mountWith(['biosphere3'])
    const list = within(container).getByTestId('explorer-list-view')
    const substance = within(container).getByTestId('explorer-substance-view')
    expect(list.style.display).toBe('flex')
    expect(substance.style.display).toBe('none')
    fireEvent.click(within(container).getByTestId('explorer-view-substance'))
    expect(list.style.display).toBe('none')
    expect(substance.style.display).toBe('flex')
    expect(within(container).getByTestId('explorer-list-view')).toBe(list)  // still mounted
  })

  it('does not offer it for a technosphere database', async () => {
    const { container } = await mountWith(['ecoinvent-3.10-cutoff'])
    expect(within(container).queryByTestId('explorer-view-toggle')).toBeNull()
    expect(within(container).queryByTestId('explorer-substance-view')).toBeNull()
  })
})
