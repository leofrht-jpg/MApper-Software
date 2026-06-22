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
import { MultiProductComparisonChart } from '../src/components/impact/MultiProductComparisonChart'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type { ActivitySummary, ProspectiveDB, MultiProductLCAResult } from '../src/api/client'

// Per-item-vintage activity comparison (activity mode): one activity added at
// multiple vintages (ecoinvent + premise SSP×year) → N distinct items, each
// with its own DB + stable color. Plus within-type enforcement (mode toggle)
// and superstructure-disabled.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const BASE_DB = 'ei-3.10'
const ELEC: ActivitySummary = {
  name: 'market for electricity, low voltage', product: 'electricity, low voltage',
  location: 'DK', unit: 'kWh', database: BASE_DB, code: 'elec', key: `${BASE_DB}|elec`,
} as any
const ELEC_ROW = `multi-item-selector-result-act:${BASE_DB}|elec`

const SSP1_DB = `${BASE_DB}_premise_remind_ssp1-pkbudg1150_2040`
const SSP5_DB = `${BASE_DB}_premise_remind_ssp5-pkbudg1150_2040`

const PLCA_DBS: ProspectiveDB[] = [
  { name: SSP1_DB, base_db: BASE_DB, iam: 'remind', ssp: 'SSP1-PkBudg1150', year: 2040, years: [2040], mode: 'separate', created_at: '' } as any,
  { name: SSP5_DB, base_db: BASE_DB, iam: 'remind', ssp: 'SSP5-PkBudg1150', year: 2040, years: [2040], mode: 'separate', created_at: '' } as any,
  { name: `${BASE_DB}_premise_remind_ssp2_super`, base_db: BASE_DB, iam: 'remind', ssp: 'SSP2', year: null, years: [2030, 2040], mode: 'superstructure', created_at: '' } as any,
]

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  try { localStorage.clear() } catch { /* jsdom */ }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  // fetchArchetypes returns a promise: bomStore subscribes to currentProject
  // and calls fetchArchetypes().catch(...) when it changes.
  useBOMStore.setState({ archetypes: [], fetchArchetypes: vi.fn(() => Promise.resolve()) } as any)
  useActivityStore.setState({
    activities: [ELEC], selectedDatabase: BASE_DB,
    searchActivities: vi.fn(), setDatabase: vi.fn(), setLocations: vi.fn(), setUnits: vi.fn(),
    distinctValues: { locations: ['DK'], units: ['kWh'] },
  } as any)
  useProjectStore.setState({ databases: [{ name: BASE_DB } as any], currentProject: 'test-proj' } as any)
  usePLCAStore.setState({ databases: PLCA_DBS, fetchDatabases: vi.fn() } as any)
  useMultiProductLCAStore.getState().reset()
})

const enterActivityMode = (getByTestId: any) =>
  act(() => { fireEvent.click(getByTestId('multi-product-mode-activity')) })

describe('Multi-item — activity vintage picker (per-item DB)', () => {
  it('picking an activity opens the vintage picker showing static + premise vintages', () => {
    const { getByTestId, queryByTestId } = render(<MultiProductLCA />)
    enterActivityMode(getByTestId)
    expect(queryByTestId('activity-vintage-picker')).toBeNull()

    act(() => { fireEvent.click(getByTestId(ELEC_ROW)) })
    expect(getByTestId('activity-vintage-picker')).toBeInTheDocument()
    // ecoinvent (static) + both separate premise vintages offered.
    expect(getByTestId(`vintage-option-${BASE_DB}`)).toBeInTheDocument()
    expect(getByTestId(`vintage-option-${SSP1_DB}`)).toBeInTheDocument()
    expect(getByTestId(`vintage-option-${SSP5_DB}`)).toBeInTheDocument()
  })

  it('superstructure vintages are shown DISABLED (per-year compute unavailable)', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    enterActivityMode(getByTestId)
    act(() => { fireEvent.click(getByTestId(ELEC_ROW)) })
    // Patch 5Z — grouped picker: the year-checkbox testid is on the <input>
    // itself (inside its scenario group), disabled for superstructure.
    const checkbox = getByTestId(`vintage-option-${BASE_DB}_premise_remind_ssp2_super`) as HTMLInputElement
    expect(checkbox.disabled).toBe(true)
  })

  it('checking N vintages creates N comparison items, each with its own DB + vintage label', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    enterActivityMode(getByTestId)
    act(() => { fireEvent.click(getByTestId(ELEC_ROW)) })

    // Check ecoinvent + SSP1 + SSP5.
    act(() => { fireEvent.click(getByTestId(`vintage-option-${BASE_DB}`)) })
    act(() => { fireEvent.click(getByTestId(`vintage-option-${SSP1_DB}`)) })
    act(() => { fireEvent.click(getByTestId(`vintage-option-${SSP5_DB}`)) })
    act(() => { fireEvent.click(getByTestId('vintage-picker-add')) })

    const items = useMultiProductLCAStore.getState().selectedItems
    expect(items).toHaveLength(3)
    const byDb = Object.fromEntries(items.map((i: any) => [i.database, i]))
    // Each vintage item names its own database (the per-item DB).
    expect(byDb[BASE_DB]).toBeTruthy()
    expect(byDb[SSP1_DB]).toBeTruthy()
    expect(byDb[SSP5_DB]).toBeTruthy()
    // Labels are vintage-aware (frontend display_name + vintage_label).
    expect(byDb[BASE_DB].vintage_label).toBe('ecoinvent')
    expect(byDb[SSP1_DB].vintage_label).toContain('2040')
    expect(byDb[BASE_DB].display_name).toBe('electricity, low voltage [ecoinvent]')
    // Premise provenance carried for export (sub-patch 3).
    expect(byDb[SSP1_DB].ssp).toBe('SSP1-PkBudg1150')
    expect(byDb[SSP1_DB].year).toBe(2040)
    // Picker closes after add.
    expect(useMultiProductLCAStore.getState().selectedItems.length).toBe(3)
  })

  it('within-type: switching to Archetypes clears the activity selection', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    enterActivityMode(getByTestId)
    act(() => { fireEvent.click(getByTestId(ELEC_ROW)) })
    act(() => { fireEvent.click(getByTestId(`vintage-option-${SSP1_DB}`)) })
    act(() => { fireEvent.click(getByTestId('vintage-picker-add')) })
    expect(useMultiProductLCAStore.getState().selectedItems.length).toBe(1)

    act(() => { fireEvent.click(getByTestId('multi-product-mode-archetype')) })
    expect(useMultiProductLCAStore.getState().selectedItems.length).toBe(0)
  })

  it('export request carries per-item vintage provenance keyed by item_id', async () => {
    const exportSpy = vi.spyOn(client, 'exportMultiProductComparison').mockResolvedValue(undefined)
    // Seed two activity-vintage items + a computed result so the Export button renders.
    act(() => {
      useMultiProductLCAStore.setState({
        selectedItems: [
          { type: 'activity', database: BASE_DB, code: 'elec', amount: 1, display_name: 'electricity, low voltage [ecoinvent]', vintage_label: 'ecoinvent', base_database: BASE_DB, iam: null, ssp: null, year: null },
          { type: 'activity', database: SSP1_DB, code: 'elec', amount: 1, display_name: 'electricity, low voltage [SSP1-PKBUDG1150 2040]', vintage_label: 'SSP1-PKBUDG1150 2040', base_database: BASE_DB, iam: 'remind', ssp: 'SSP1-PkBudg1150', year: 2040 },
        ],
        multiResult: {
          items: [
            { type: 'activity', item_id: `${BASE_DB}|elec`, label: 'electricity, low voltage [ecoinvent]', status: 'success', activity_result: { results: [{ method: ['EF', 'cc'], method_label: 'cc', score: 0.5, unit: 'kg', contributions: [] }], elapsed_seconds: 0 } },
            { type: 'activity', item_id: `${SSP1_DB}|elec`, label: 'electricity, low voltage [SSP1-PKBUDG1150 2040]', status: 'success', activity_result: { results: [{ method: ['EF', 'cc'], method_label: 'cc', score: 0.031, unit: 'kg', contributions: [] }], elapsed_seconds: 0 } },
          ],
          elapsed_seconds: 0.1, success_count: 2, error_count: 0,
        } as any,
        // Export provenance now reads the compute-time snapshot (results-aligned),
        // not the live selection.
        multiVintageCoords: {
          [`${BASE_DB}|elec`]: { label: 'ecoinvent', database: BASE_DB, base_database: BASE_DB, iam: null, ssp: null, year: null },
          [`${SSP1_DB}|elec`]: { label: 'SSP1-PKBUDG1150 2040', database: SSP1_DB, base_database: BASE_DB, iam: 'remind', ssp: 'SSP1-PkBudg1150', year: 2040 },
        },
      } as any)
    })
    const { getByTestId } = render(<MultiProductLCA />)
    await act(async () => { fireEvent.click(getByTestId('multi-product-export')) })

    expect(exportSpy).toHaveBeenCalledTimes(1)
    const opts = exportSpy.mock.calls[0][2] as any
    expect(opts.activityVintageMeta[`${SSP1_DB}|elec`]).toEqual({
      label: 'SSP1-PKBUDG1150 2040', database: SSP1_DB,
      base_database: BASE_DB, iam: 'remind', ssp: 'SSP1-PkBudg1150', year: 2040,
    })
    expect(opts.activityVintageMeta[`${BASE_DB}|elec`].label).toBe('ecoinvent')
    expect(opts.activityVintageMeta[`${BASE_DB}|elec`].year).toBeNull()
  })
})

// ── Per-item color stability ────────────────────────────────────────────────

function activityVintageResult(labels: string[]): MultiProductLCAResult {
  return {
    items: labels.map((label, i) => ({
      type: 'activity', item_id: `db${i}|elec`, label, status: 'success',
      activity_result: { results: [{ method: ['m'], method_label: 'M', score: 10 * (i + 1), unit: 'kg', contributions: [] }], elapsed_seconds: 0 } as any,
    })),
    elapsed_seconds: 0.1, success_count: labels.length, error_count: 0,
  } as any
}

describe('Multi-item — per-item color stability', () => {
  beforeEach(() => { useProjectStore.setState({ currentProject: 'test-proj' } as any) })

  it('removing the middle item does not recolor the survivors (stable per-label color)', () => {
    const three = activityVintageResult([
      'electricity, low voltage [ecoinvent]',
      'electricity, low voltage [SSP1 2040]',
      'electricity, low voltage [SSP5 2040]',
    ])
    const swatch = (c: HTMLElement, id: string) =>
      (c.querySelector(`[data-testid="multi-product-legend-item-${id}"] span`) as HTMLElement).style.backgroundColor

    const { container, rerender } = render(
      <MultiProductComparisonChart result={three} scope="all" selectedMethodLabel="M" />,
    )
    const ecoBefore = swatch(container, 'db0|elec')
    const ssp5Before = swatch(container, 'db2|elec')

    // Drop the middle item (SSP1) — naive positional coloring would shift SSP5.
    const two = activityVintageResult([
      'electricity, low voltage [ecoinvent]',
      'electricity, low voltage [SSP5 2040]',
    ])
    // item_ids must match the surviving items so the legend testids line up.
    two.items[1].item_id = 'db2|elec'
    rerender(<MultiProductComparisonChart result={two} scope="all" selectedMethodLabel="M" />)

    expect(swatch(container, 'db0|elec')).toBe(ecoBefore)
    expect(swatch(container, 'db2|elec')).toBe(ssp5Before)
    expect(ssp5Before).not.toBe('')
  })
})
