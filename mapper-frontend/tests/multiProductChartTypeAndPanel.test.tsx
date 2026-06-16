/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act, within } from '@testing-library/react'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type { MultiProductLCAResult } from '../src/api/client'

// Patch 5S — Bar|Line toggle + gating (Part A) and grouped selected-panel
// (Part B). Render-level: lock the gating + the grouped panel being
// display-only. (Series-mapping/ordering is in multiProductLineModel.test.ts.)

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const BASE = 'ei-3.10'
const CODE = 'elec'
const METHOD = 'EF v3.1 › climate change › GWP100'

function vintageItem(ssp: string, year: number, score: number) {
  const db = `${BASE}_premise_remind_${ssp.toLowerCase()}_${year}`
  return {
    selected: { type: 'activity', database: db, code: CODE, amount: 1, display_name: `electricity, low voltage [${ssp} ${year}]`, name: 'market for electricity, low voltage', product: 'electricity, low voltage', location: 'DK', unit: 'kWh', vintage_label: `${ssp} ${year}`, base_database: BASE, iam: 'remind', ssp, year } as any,
    result: { type: 'activity', item_id: `${db}|${CODE}`, label: `electricity, low voltage [${ssp} ${year}]`, status: 'success', activity_result: { results: [{ method: ['m'], method_label: METHOD, score, unit: 'kg CO2-eq', contributions: [] }], elapsed_seconds: 0 } } as any,
  }
}

function seed(spec: { ssp: string; year: number; score: number }[]) {
  const built = spec.map((s) => vintageItem(s.ssp, s.year, s.score))
  const result: MultiProductLCAResult = {
    items: built.map((b) => b.result), elapsed_seconds: 0.1, success_count: built.length, error_count: 0,
  } as any
  // multiVintageCoords is the COMPUTE-time snapshot the Line gate/chart/export
  // now read (results-aligned, decoupled from the live selection).
  const multiVintageCoords: Record<string, any> = {}
  for (const b of built) {
    const s = b.selected
    multiVintageCoords[`${s.database}|${s.code}`] = {
      label: s.vintage_label, database: s.database, base_database: s.base_database,
      iam: s.iam, ssp: s.ssp, year: s.year,
    }
  }
  act(() => {
    useMultiProductLCAStore.setState({ selectedItems: built.map((b) => b.selected), multiResult: result, multiVintageCoords } as any)
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  try { localStorage.clear() } catch { /* jsdom */ }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  useBOMStore.setState({ archetypes: [{ id: 'arc-a', name: 'BEV', description: null, category: 'pc', folder: 'PC', material_count: 1, unlinked_count: 0, stages: ['Manufacturing'], stage_annual: {}, created_at: '', updated_at: '' }] as any, fetchArchetypes: vi.fn(() => Promise.resolve()) } as any)
  useActivityStore.setState({ activities: [], selectedDatabase: BASE, searchActivities: vi.fn(), setDatabase: vi.fn(), setLocations: vi.fn(), setUnits: vi.fn(), distinctValues: { locations: ['DK'], units: ['kWh'] } } as any)
  useProjectStore.setState({ databases: [{ name: BASE } as any], currentProject: 'test-proj' } as any)
  usePLCAStore.setState({ databases: [], fetchDatabases: vi.fn() } as any)
  useMultiProductLCAStore.getState().reset()
})

const enterActivityMode = (getByTestId: any) => act(() => { fireEvent.click(getByTestId('multi-product-mode-activity')) })

describe('Bar|Line chart-type toggle + gating (Part A)', () => {
  it('Line is ENABLED when the selection spans ≥2 distinct years', () => {
    seed([{ ssp: 'SSP1-PkBudg1150', year: 2030, score: 0.11 }, { ssp: 'SSP1-PkBudg1150', year: 2040, score: 0.031 }])
    const { getByTestId } = render(<MultiProductLCA />)
    const lineBtn = getByTestId('multi-product-charttype-line') as HTMLButtonElement
    expect(lineBtn.disabled).toBe(false)
    act(() => { fireEvent.click(lineBtn) })
    expect(getByTestId('multi-product-line-chart')).toBeInTheDocument()
  })

  it('Line is DISABLED (tooltip) when <2 distinct years', () => {
    seed([{ ssp: 'SSP1-PkBudg1150', year: 2030, score: 0.11 }])  // one year only
    const { getByTestId } = render(<MultiProductLCA />)
    const lineBtn = getByTestId('multi-product-charttype-line') as HTMLButtonElement
    expect(lineBtn.disabled).toBe(true)
    expect(lineBtn.title).toMatch(/multiple years/i)
  })

  it('Line legend reflects SCENARIOS (3), not per-item (6)', () => {
    seed([
      { ssp: 'SSP1-PkBudg1150', year: 2030, score: 0.11 }, { ssp: 'SSP1-PkBudg1150', year: 2040, score: 0.031 },
      { ssp: 'SSP2', year: 2030, score: 0.095 }, { ssp: 'SSP2', year: 2040, score: 0.023 },
      { ssp: 'SSP5-PkBudg1150', year: 2030, score: 0.072 }, { ssp: 'SSP5-PkBudg1150', year: 2040, score: 0.020 },
    ])
    const { getByTestId, container } = render(<MultiProductLCA />)
    act(() => { fireEvent.click(getByTestId('multi-product-charttype-line')) })
    const legend = getByTestId('multi-product-line-legend')
    const entries = within(legend).getAllByTestId(/multi-product-line-legend-item-/)
    expect(entries).toHaveLength(3)  // 6 items → 3 SSP scenarios
    void container
  })

  it('clicking a Line legend entry hides that scenario (display-only, no recompute)', () => {
    const computeSpy = vi.spyOn(client, 'calculateMultiProductLCA')
    seed([
      { ssp: 'SSP1-PkBudg1150', year: 2030, score: 0.11 }, { ssp: 'SSP1-PkBudg1150', year: 2040, score: 0.031 },
      { ssp: 'SSP2', year: 2030, score: 0.095 }, { ssp: 'SSP2', year: 2040, score: 0.023 },
    ])
    const { getByTestId } = render(<MultiProductLCA />)
    act(() => { fireEvent.click(getByTestId('multi-product-charttype-line')) })
    const legend = getByTestId('multi-product-line-legend')
    expect(within(legend).getAllByTestId(/multi-product-line-legend-item-/)).toHaveLength(2)
    act(() => { fireEvent.click(getByTestId('multi-product-line-legend-item-SSP2')) })
    // SSP2 leaves the visible legend; the hidden (toggle-back) group holds it.
    expect(within(getByTestId('multi-product-line-legend')).queryAllByTestId(/multi-product-line-legend-item-/)).toHaveLength(1)
    expect(getByTestId('multi-product-line-legend-hidden')).toBeInTheDocument()
    expect(computeSpy).not.toHaveBeenCalled()  // toggling never recomputes
    void enterActivityMode
  })
})

describe('Grouped selected-items panel (Part B)', () => {
  it('groups vintages of one activity under a single header (identity once)', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    enterActivityMode(getByTestId)
    seed([
      { ssp: 'SSP1-PkBudg1150', year: 2030, score: 0.11 }, { ssp: 'SSP1-PkBudg1150', year: 2040, score: 0.031 },
      { ssp: 'SSP2', year: 2030, score: 0.095 },
    ])
    // One group (same code), three vintage chips.
    const panel = getByTestId('grouped-vintage-panel')
    expect(within(panel).getAllByTestId(/^vintage-group-/)).toHaveLength(1)
    expect(within(panel).getAllByTestId(/^vintage-chip-/).filter((e) => !e.getAttribute('data-testid')!.includes('remove'))).toHaveLength(3)
    // The unique code appears once (the group header), not per chip.
    expect(within(panel).getAllByText(CODE)).toHaveLength(1)
  })

  it('removing a vintage chip is display-only: selection shrinks, identity intact', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    enterActivityMode(getByTestId)
    seed([
      { ssp: 'SSP1-PkBudg1150', year: 2030, score: 0.11 }, { ssp: 'SSP1-PkBudg1150', year: 2040, score: 0.031 },
    ])
    expect(useMultiProductLCAStore.getState().selectedItems).toHaveLength(2)
    const db = `${BASE}_premise_remind_ssp1-pkbudg1150_2030`
    act(() => { fireEvent.click(getByTestId(`vintage-chip-remove-${db}|${CODE}`)) })
    expect(useMultiProductLCAStore.getState().selectedItems).toHaveLength(1)
    // Remaining item identity (code/database) unchanged.
    expect((useMultiProductLCAStore.getState().selectedItems[0] as any).code).toBe(CODE)
  })

  it('archetype mode regression: default chips, no grouped panel', () => {
    const { getByTestId, queryByTestId } = render(<MultiProductLCA />)
    // Default mode is archetype. Seed an archetype selection.
    act(() => {
      useMultiProductLCAStore.setState({
        selectedItems: [{ type: 'archetype', archetype_id: 'arc-a', display_name: 'BEV' } as any],
      } as any)
    })
    expect(queryByTestId('grouped-vintage-panel')).toBeNull()
    // Default SelectedChip is present for the archetype.
    expect(getByTestId('multi-item-selector-chip-arc:arc-a')).toBeInTheDocument()
  })
})
