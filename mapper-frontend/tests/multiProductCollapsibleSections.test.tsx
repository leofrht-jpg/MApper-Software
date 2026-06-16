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
import type { ArchetypeSummary, MultiProductLCAResult } from '../src/api/client'
import type { ProductItem } from '../src/components/shared/productItem'

// Patch 5H — Scope / Items to compare / Results are wrapped in the shared
// <CollapsibleCard> (visibility-toggle). Lock the mechanism, not pixels.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const ARCHETYPES: ArchetypeSummary[] = [{
  id: 'arc-bev', name: 'BEV-LFP', description: null, category: 'pc',
  folder: 'Passenger cars', material_count: 10, unlinked_count: 0,
  stages: ['Manufacturing'], stage_annual: {}, created_at: '', updated_at: '',
}]

const RESULT: MultiProductLCAResult = {
  items: [{
    type: 'archetype', item_id: 'arc-bev', label: 'BEV-LFP', status: 'success',
    archetype_result: {
      archetype_id: 'arc-bev', archetype_name: 'BEV-LFP', scope: 'all',
      amount: 1.0, stage_amounts: {}, stages_included: ['Manufacturing'],
      results: [{ method: ['EF v3.1', 'climate change'], method_label: 'climate', score: 1234.5, unit: 'kg CO2 eq', contributions: [] }],
      stage_breakdown: { climate: { Manufacturing: 1234.5 } }, elapsed_seconds: 0.1,
    } as any,
  }],
  elapsed_seconds: 0.1, success_count: 1, error_count: 0,
}

const arcItem = (id: string): ProductItem => ({ type: 'archetype', archetype_id: id, display_name: id } as ProductItem)

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

// CollapsibleCard renders `<div style={{display}}>{children}</div>`; the section
// body content is that wrapper's direct child, so its parentElement IS the
// collapse-signal node.
const bodyWrapperOf = (node: HTMLElement) => node.parentElement as HTMLElement
const toggleCard = (getByRole: any, title: string) =>
  fireEvent.click(getByRole('heading', { name: title }))

describe('Multi-item comparison — collapsible sections', () => {
  it('each section renders inside the CollapsibleCard primitive', () => {
    useMultiProductLCAStore.setState({ multiResult: RESULT } as any)
    const { getByTestId } = render(<MultiProductLCA />)
    for (const [bodyId, title] of [
      // Patch 5Q — the config card is now titled "Configuration" (was "Scope")
      // to mirror the Single item tab.
      ['multi-product-config', 'Configuration'],
      ['multi-product-selection', 'Items to compare'],
      ['multi-product-results', 'Results'],
    ] as const) {
      const section = getByTestId(bodyId).closest('section') as HTMLElement
      expect(section).not.toBeNull()
      expect(within(section).getByRole('heading', { name: title })).toBeTruthy()
    }
  })

  it('toggling collapse flips the body-wrapper display (not body absence)', () => {
    const { getByTestId, getByRole } = render(<MultiProductLCA />)
    const body = getByTestId('multi-product-selection')
    expect(bodyWrapperOf(body).style.display).toBe('block') // expanded by default

    toggleCard(getByRole, 'Items to compare')
    expect(bodyWrapperOf(body).style.display).toBe('none')   // collapsed
    expect(getByTestId('multi-product-selection')).toBeInTheDocument() // still mounted

    toggleCard(getByRole, 'Items to compare')
    expect(bodyWrapperOf(body).style.display).toBe('block')  // expanded again
  })

  it('visibility-toggle guard: collapsing does not unmount the body (same node persists)', () => {
    const { getByTestId, getByRole } = render(<MultiProductLCA />)
    const before = getByTestId('multi-product-selection')
    toggleCard(getByRole, 'Items to compare')
    const after = getByTestId('multi-product-selection')
    // Identical DOM node across collapse → selection/search state not destroyed.
    expect(after).toBe(before)
    expect(after).toBeInTheDocument()
  })

  it('live-summary guard: collapsed Items header reflects the CURRENT store count, not a snapshot', () => {
    act(() => { useMultiProductLCAStore.setState({ selectedItems: [arcItem('a'), arcItem('b'), arcItem('c')] } as any) })
    const { getByTestId, getByRole } = render(<MultiProductLCA />)

    toggleCard(getByRole, 'Items to compare') // collapse → summary shows
    expect(getByTestId('multi-product-items-summary').textContent).toContain('3 selected')

    // Mutate the store WHILE collapsed — a snapshot-at-collapse would stay at 3.
    act(() => { useMultiProductLCAStore.setState({ selectedItems: [arcItem('a'), arcItem('b'), arcItem('c'), arcItem('d')] } as any) })
    expect(getByTestId('multi-product-items-summary').textContent).toContain('4 selected')
  })

  it('Configuration collapsed summary reads scope + selected method count live', () => {
    const { getByTestId, getByRole } = render(<MultiProductLCA />)
    toggleCard(getByRole, 'Configuration')
    // No methods selected yet (bare picker, parent has []) → explicit copy.
    // Scope label standardized to single-item's "Full Lifecycle" (Patch 5Q).
    expect(getByTestId('multi-product-scope-summary').textContent).toContain('Full Lifecycle')
    expect(getByTestId('multi-product-scope-summary').textContent).toContain('No methods selected')
  })

  it('regression: Results renders post-compute, expanded, and the chart/table toggle still works', () => {
    useMultiProductLCAStore.setState({ multiResult: RESULT } as any)
    const { getByTestId, queryByTestId } = render(<MultiProductLCA />)
    // Results body present + expanded (display block).
    const results = getByTestId('multi-product-results')
    expect(bodyWrapperOf(results).style.display).toBe('block')
    // Default chart view → table absent; toggle to table → table appears.
    expect(queryByTestId('multi-product-results-table')).toBeNull()
    fireEvent.click(getByTestId('multi-product-view-table'))
    expect(getByTestId('multi-product-results-table')).toBeInTheDocument()
  })

  it('Results section is absent before any compute', () => {
    const { queryByTestId, queryByRole } = render(<MultiProductLCA />)
    expect(queryByTestId('multi-product-results')).toBeNull()
    expect(queryByRole('heading', { name: 'Results' })).toBeNull()
  })
})
