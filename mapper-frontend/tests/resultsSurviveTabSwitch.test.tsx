/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A finished single-product result survives leaving the tab and coming back.
 *
 * App mounts ONE page at a time, so leaving Impact Assessment (or LCA
 * Architect) unmounts the whole page. Reported in the 0.3.1 walkthrough: the
 * result was gone on return. Two causes, both fixed:
 *  - Impact Assessment kept the selected archetype in local state; on remount
 *    it restarted at null and was mirrored into the store, whose setter clears
 *    the results;
 *  - the panels (and the LCA Calculator) held their runs in local state.
 *
 * Each case here computes, UNMOUNTS, remounts, and requires the result back.
 */
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { LCACalculator } from '../src/pages/LCACalculator'
import { useBOMStore } from '../src/stores/bomStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { useSessionStateStore } from '../src/stores/sessionStateStore'
import * as client from '../src/api/client'
import type { ArchetypeLCACalculateResult, ArchetypeSummary, DatabaseResponse } from '../src/api/client'

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const FAM = 'EF v3.1'
const TUPLE = [FAM, 'climate change', 'GWP100']
const METHODS = [{ family: FAM, categories: [
  { category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: TUPLE }] },
] }]

const ARC: ArchetypeSummary = {
  id: 'arc-ev', name: 'EV9', folder: null, material_count: 2, unlinked_count: 0,
  stages: ['Manufacturing'], stage_annual: {}, validation_error_rows: 0,
} as any

function resultFor(score: number, db: string | null = null): ArchetypeLCACalculateResult {
  return {
    archetype_id: 'arc-ev', archetype_name: 'EV9', scope: 'all', compute_database: db,
    parameter_scenario: null, warnings: [], elapsed_seconds: 0.1, stages_included: ['Manufacturing'], total_materials: 2, linked_materials: 2,
    results: [{ method: TUPLE, method_label: 'GWP100', unit: 'kg CO2-Eq', score, contributions: [] }],
    stage_breakdown: null,
  } as any
}

const PDB = { name: 'ei-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030], mode: 'separate', created_at: 'x' }

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error minimal jsdom stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useProjectStore.setState({ currentProject: 'EVS40' })
  useSessionStateStore.getState().reset()
  useSingleProductImpactStore.getState().reset()
  useBOMStore.setState({ archetypes: [ARC], folders: [], fetchArchetypes: vi.fn(async () => {}) } as any)
  usePLCAStore.setState({ databases: [PDB], fetchDatabases: async () => {} } as any)
  vi.spyOn(client, 'getMethods').mockResolvedValue(METHODS as any)
  vi.spyOn(client, 'calculateArchetypeLCA').mockImplementation(
    async (_id: string, _scope: any, _m: any, opts?: any) => resultFor(opts?.computeDatabase ? 4321 : 1234, opts?.computeDatabase ?? null),
  )
})

describe('Impact Assessment, single product', () => {
  it('Static: the result is still there after the page unmounts and remounts', async () => {
    const first = render(<SingleProductImpact />)
    const pane = screen.getByTestId('single-product-tab-pane-static')
    const calc = within(pane).getByTestId('single-product-static-calculate') as HTMLButtonElement
    await waitFor(() => expect(calc.disabled).toBe(false))
    await act(async () => { fireEvent.click(calc) })
    await waitFor(() => expect(pane.textContent).toContain('1.23'))
    expect(useSingleProductImpactStore.getState().staticResult?.results[0].score).toBe(1234)

    first.unmount() // the user opened another tab
    render(<SingleProductImpact />)

    expect(useSingleProductImpactStore.getState().archetypeId).toBe('arc-ev')
    expect(useSingleProductImpactStore.getState().staticResult?.results[0].score).toBe(1234)
    const again = screen.getByTestId('single-product-tab-pane-static')
    await waitFor(() => expect(again.textContent).toContain('1.23'))
    expect(within(again).getByTestId('single-product-run-uncertainty')).toBeInTheDocument()
  })

  it('Prospective: the runs and the selected tab survive too', async () => {
    const first = render(<SingleProductImpact />)
    fireEvent.click(screen.getByTestId('single-product-tab-projected'))
    const pane = screen.getByTestId('single-product-tab-pane-projected')
    await waitFor(() => expect(pane.querySelectorAll('input[type=checkbox]:checked').length).toBeGreaterThan(0))
    fireEvent.click(within(within(pane).getByTestId('single-product-projected-db-list')).getAllByRole('checkbox')[0])
    await act(async () => { fireEvent.click(within(pane).getByTestId('single-product-projected-calculate')) })
    await waitFor(() => expect(useSingleProductImpactStore.getState().projectedRuns).toHaveLength(1))

    first.unmount()
    render(<SingleProductImpact />)

    expect(useSingleProductImpactStore.getState().projectedRuns).toHaveLength(1)
    expect(useSingleProductImpactStore.getState().projectedRuns[0].result.results[0].score).toBe(4321)
    // Came back on the Prospective tab, not the default Static one.
    expect(screen.getByTestId('single-product-tab-pane-projected').style.display).not.toBe('none')
  })

  it('a project change still drops the kept results', async () => {
    const first = render(<SingleProductImpact />)
    const calc = within(screen.getByTestId('single-product-tab-pane-static'))
      .getByTestId('single-product-static-calculate') as HTMLButtonElement
    await waitFor(() => expect(calc.disabled).toBe(false))
    await act(async () => { fireEvent.click(calc) })
    await waitFor(() => expect(useSingleProductImpactStore.getState().staticResult).not.toBeNull())
    first.unmount()

    await act(async () => { useProjectStore.setState({ currentProject: 'Battery Circularity' }) })
    expect(useSingleProductImpactStore.getState().staticResult).toBeNull()
    expect(Object.keys(useSessionStateStore.getState().values)).toHaveLength(0)
  })
})

describe('LCA Architect, Single-product LCA', () => {
  it('the archetype result is still there after the page unmounts and remounts', async () => {
    vi.spyOn(client, 'getDatabases').mockResolvedValue([{ name: 'ei-3.10', records: 10, modified: null } as unknown as DatabaseResponse])
    vi.spyOn(client, 'getActivityDistinctValues').mockResolvedValue({ locations: [], units: [] } as any)
    const first = render(<LCACalculator />)
    const row = (await screen.findByText('EV9')).closest('label, div') as HTMLElement
    fireEvent.click(row.querySelector('input[type=checkbox]') ?? row)
    const calcBtn = () => Array.from(first.container.querySelectorAll('button'))
      .find((b) => /^Calculate/.test((b.textContent ?? '').trim())) as HTMLButtonElement
    await waitFor(() => expect(calcBtn()?.disabled).toBe(false))
    await act(async () => { fireEvent.click(calcBtn()) })
    await waitFor(() => expect(first.container.textContent).toContain('Results'))
    const before = first.container.textContent ?? ''
    expect(before).toMatch(/1[.,]23/)

    first.unmount()
    const second = render(<LCACalculator />)
    await waitFor(() => expect(second.container.textContent).toMatch(/1[.,]23/))
    expect(client.calculateArchetypeLCA).toHaveBeenCalledTimes(1)
  })
})
