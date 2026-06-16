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
import type { ArchetypeSummary } from '../src/api/client'
import type { ProductItem } from '../src/components/shared/productItem'

// Patch 5I — per-item (per-archetype) stage amounts in Multi-item comparison.
// Reuses the Single-item <StageAmountsEditor>; per-item amounts thread into
// the wire payload (the backend applies them via the shared function).

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const ARCHETYPES: ArchetypeSummary[] = [
  { id: 'arc-a', name: 'BEV', description: null, category: 'pc', folder: 'PC', material_count: 1, unlinked_count: 0, stages: ['Manufacturing', 'Use Phase', 'End of Life'], stage_annual: { 'Use Phase': true }, created_at: '', updated_at: '' },
  { id: 'arc-b', name: 'ICEV', description: null, category: 'pc', folder: 'PC', material_count: 1, unlinked_count: 0, stages: ['Manufacturing', 'Use Phase', 'End of Life'], stage_annual: { 'Use Phase': true }, created_at: '', updated_at: '' },
] as any

const arcItem = (id: string, name: string): ProductItem => ({ type: 'archetype', archetype_id: id, display_name: name } as ProductItem)

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  useBOMStore.setState({ archetypes: ARCHETYPES, fetchArchetypes: vi.fn() } as any)
  useActivityStore.setState({ activities: [], selectedDatabase: 'ei-3.10', searchActivities: vi.fn(), setDatabase: vi.fn() } as any)
  usePLCAStore.setState({ databases: [], fetchDatabases: vi.fn() } as any)
  useProjectStore.setState({ databases: [{ name: 'ei-3.10', size_mb: 1, activity_count: 1 } as any] } as any)
  useMultiProductLCAStore.getState().reset()
})

const seedItems = (...items: ProductItem[]) => act(() => { useMultiProductLCAStore.setState({ selectedItems: items } as any) })

describe('Multi-item per-item stage amounts', () => {
  it('renders one stage-amounts editor per selected archetype item', () => {
    seedItems(arcItem('arc-a', 'BEV'), arcItem('arc-b', 'ICEV'))
    const { getAllByTestId } = render(<MultiProductLCA />)
    // One CollapsibleCard summary per item (default collapsed).
    expect(getAllByTestId(/^multi-product-stage-summary-/).length).toBe(2)
  })

  it('seeds new items from the global preset and prunes removed items', () => {
    const { rerender } = render(<MultiProductLCA />)
    seedItems(arcItem('arc-a', 'BEV'))
    rerender(<MultiProductLCA />)
    // Reconcile effect seeded arc-a with the default '1year' preset (all 1).
    let map = useMultiProductLCAStore.getState().stageAmountsByItem
    expect(map['arc:arc-a']).toBeTruthy()
    expect(map['arc:arc-a'].amounts).toEqual({ Manufacturing: 1, 'Use Phase': 1, 'End of Life': 1 })

    // Add a second item → seeded; remove the first → pruned.
    seedItems(arcItem('arc-a', 'BEV'), arcItem('arc-b', 'ICEV'))
    rerender(<MultiProductLCA />)
    seedItems(arcItem('arc-b', 'ICEV'))
    rerender(<MultiProductLCA />)
    map = useMultiProductLCAStore.getState().stageAmountsByItem
    expect(map['arc:arc-a']).toBeUndefined()
    expect(map['arc:arc-b']).toBeTruthy()
  })

  it('global preset applies to all; a per-item override changes only that item', () => {
    seedItems(arcItem('arc-a', 'BEV'), arcItem('arc-b', 'ICEV'))
    const { getByTestId, getByRole } = render(<MultiProductLCA />)

    // Apply global Lifetime → annual Use Phase scales to 15 for BOTH items.
    fireEvent.click(getByTestId('multi-product-global-preset-lifetime'))
    let map = useMultiProductLCAStore.getState().stageAmountsByItem
    expect(map['arc:arc-a'].amounts['Use Phase']).toBe(15)
    expect(map['arc:arc-b'].amounts['Use Phase']).toBe(15)
    expect(map['arc:arc-a'].amounts['Manufacturing']).toBe(1) // one-time unaffected

    // Override only arc-a via its editor: expand its card (title "BEV"), then
    // edit Use Phase within that card (both editors stay mounted, so scope the
    // query to the BEV section).
    const bevSection = getByRole('heading', { name: 'BEV' }).closest('section') as HTMLElement
    fireEvent.click(within(bevSection).getByRole('heading', { name: 'BEV' }))
    const input = within(bevSection).getByTestId('stage-amounts-input-Use Phase') as HTMLInputElement
    fireEvent.change(input, { target: { value: '8' } })
    fireEvent.blur(input)
    map = useMultiProductLCAStore.getState().stageAmountsByItem
    expect(map['arc:arc-a'].amounts['Use Phase']).toBe(8)
    expect(map['arc:arc-b'].amounts['Use Phase']).toBe(15) // other item untouched
  })

  it('per-item collapsed summary reflects live values', () => {
    seedItems(arcItem('arc-a', 'BEV'))
    const { getByTestId } = render(<MultiProductLCA />)
    expect(getByTestId('multi-product-stage-summary-arc:arc-a').textContent).toContain('1 year')
    fireEvent.click(getByTestId('multi-product-global-preset-lifetime'))
    const txt = getByTestId('multi-product-stage-summary-arc:arc-a').textContent ?? ''
    expect(txt).toContain('Lifetime')
    expect(txt).toContain('Use 15')
  })

  it('compute request carries the per-item stage_amounts map', async () => {
    const spy = vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue({
      items: [], elapsed_seconds: 0, success_count: 0, error_count: 0,
    } as any)
    seedItems(arcItem('arc-a', 'BEV'), arcItem('arc-b', 'ICEV'))
    render(<MultiProductLCA />)
    // Set arc-a to lifetime-15 directly on its entry; arc-b stays default.
    act(() => {
      useMultiProductLCAStore.getState().setItemStageAmounts('arc:arc-a', {
        preset: 'lifetime', lifetime: 15, amounts: { Manufacturing: 1, 'Use Phase': 15, 'End of Life': 1 },
      })
    })
    await act(async () => {
      await useMultiProductLCAStore.getState().compute({ scope: 'all', methods: [['EF', 'cc']] })
    })
    const payload = spy.mock.calls[0][0] as any
    const byId = Object.fromEntries(payload.items.map((it: any) => [it.archetype_id, it.stage_amounts]))
    expect(byId['arc-a']).toEqual({ Manufacturing: 1, 'Use Phase': 15, 'End of Life': 1 })
    expect(byId['arc-b']).toEqual({ Manufacturing: 1, 'Use Phase': 1, 'End of Life': 1 })
  })

  it('no stage-amounts section when no archetype items are selected', () => {
    const { queryByTestId } = render(<MultiProductLCA />)
    expect(queryByTestId('multi-product-stage-amounts')).toBeNull()
  })

  it('export request carries the per-item stage-amounts meta keyed by archetype_id', async () => {
    const exportSpy = vi.spyOn(client, 'exportMultiProductComparison').mockResolvedValue(undefined)
    // A computed result so the Results section (with the Export button) renders.
    act(() => {
      useMultiProductLCAStore.setState({
        selectedItems: [arcItem('arc-a', 'BEV'), arcItem('arc-b', 'ICEV')],
        stageAmountsByItem: {
          'arc:arc-a': { preset: 'lifetime', lifetime: 15, amounts: { Manufacturing: 1, 'Use Phase': 15, 'End of Life': 1 } },
          'arc:arc-b': { preset: 'lifetime', lifetime: 10, amounts: { Manufacturing: 1, 'Use Phase': 10, 'End of Life': 1 } },
        },
        multiResult: {
          items: [
            { type: 'archetype', item_id: 'arc-a', label: 'BEV', status: 'success', archetype_result: { archetype_id: 'arc-a', archetype_name: 'BEV', scope: 'all', amount: 1, stage_amounts: {}, stages_included: [], results: [{ method: ['EF', 'cc'], method_label: 'cc', score: 1, unit: 'kg', contributions: [] }], stage_breakdown: null, elapsed_seconds: 0 } },
          ],
          elapsed_seconds: 0.1, success_count: 1, error_count: 0,
        } as any,
      } as any)
    })
    const { getByTestId } = render(<MultiProductLCA />)
    await act(async () => {
      fireEvent.click(getByTestId('multi-product-export'))
    })
    expect(exportSpy).toHaveBeenCalledTimes(1)
    const opts = exportSpy.mock.calls[0][2] as any
    // Keyed by archetype_id (= item_id), carrying preset + lifetime + amounts.
    expect(opts.stageAmountsMeta['arc-a']).toEqual({ preset: 'lifetime', lifetime: 15, amounts: { Manufacturing: 1, 'Use Phase': 15, 'End of Life': 1 } })
    expect(opts.stageAmountsMeta['arc-b'].lifetime).toBe(10)
  })
})
