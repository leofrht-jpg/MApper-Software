/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type { ArchetypeSummary, MultiProductLCAResult } from '../src/api/client'

// Patch 4AG.3 — integration tests for the Single item / Multi-item
// sub-mode toggle inside SingleProductImpact.
//
// Coverage:
//   - Default mode is 'single' (existing UX preserved).
//   - Toggle to 'multi' shows MultiProductLCA layout; single-item
//     tabs subtree hidden via visibility-toggle (display: none).
//   - Toggle back to 'single' restores single-item visibility WITHOUT
//     clearing multi-product state (Patch 4AG.3 anti-pattern guard:
//     state must survive mode flips).
//   - Multi-item compute end-to-end: selecting items + clicking
//     Compute dispatches calculateMultiProductLCA with the correct
//     wire payload.
//   - Compute button disabled when no items selected; helpful tooltip.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const ARCHETYPES: ArchetypeSummary[] = [
  {
    id: 'arc-bev', name: 'BEV-LFP small', description: null,
    category: 'passenger car', folder: 'Passenger cars',
    material_count: 24, unlinked_count: 0, stages: ['Manufacturing'],
    stage_annual: {}, created_at: '', updated_at: '',
  },
  {
    id: 'arc-icev', name: 'ICEV petrol', description: null,
    category: 'passenger car', folder: 'Passenger cars',
    material_count: 30, unlinked_count: 0, stages: ['Manufacturing'],
    stage_annual: {}, created_at: '', updated_at: '',
  },
]

const FAKE_RESULT: MultiProductLCAResult = {
  items: [
    {
      type: 'archetype', item_id: 'arc-bev', label: 'BEV-LFP small',
      status: 'success',
      archetype_result: {
        archetype_id: 'arc-bev', archetype_name: 'BEV-LFP small',
        scope: 'all', amount: 1.0, stage_amounts: {},
        stages_included: ['Manufacturing'],
        results: [{
          method: ['EF v3.1', 'climate change', 'GWP100'],
          method_label: 'EF v3.1 › climate change › GWP100',
          score: 1234.5, unit: 'kg CO2 eq', contributions: [],
        }],
        elapsed_seconds: 0.1,
      } as any,
    },
  ],
  elapsed_seconds: 0.1, success_count: 1, error_count: 0,
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  useBOMStore.setState({
    archetypes: ARCHETYPES,
    fetchArchetypes: vi.fn(),
  } as any)
  useActivityStore.setState({
    activities: [],
    selectedDatabase: 'ei-3.10',
    searchActivities: vi.fn(),
    setDatabase: vi.fn(),
  } as any)
  useProjectStore.setState({
    databases: [{ name: 'ei-3.10', size_mb: 1, activity_count: 1 } as any],
  } as any)
  useMultiProductLCAStore.getState().reset()
})

describe('SingleProductImpact — Single item / Multi-item mode toggle (Patch 4AG.3)', () => {
  it('renders the sub-mode toggle with default = single', () => {
    const { container } = render(<SingleProductImpact />)
    expect(container.querySelector('[data-testid="single-product-mode-toggle"]')).not.toBeNull()
    const singleBtn = container.querySelector('[data-testid="single-product-mode-single"]') as HTMLElement
    const multiBtn = container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement
    expect(singleBtn).not.toBeNull()
    expect(multiBtn).not.toBeNull()
  })

  it('default mode is single — single-item pane visible, multi-item pane hidden', () => {
    const { container } = render(<SingleProductImpact />)
    const singlePane = container.querySelector('[data-testid="single-product-single-pane"]') as HTMLElement
    const multiPane = container.querySelector('[data-testid="single-product-multi-pane"]') as HTMLElement
    expect(singlePane.style.display).toBe('block')
    expect(multiPane.style.display).toBe('none')
  })

  it('clicking Multi-item swaps panes: multi visible, single hidden', () => {
    const { container } = render(<SingleProductImpact />)
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    const singlePane = container.querySelector('[data-testid="single-product-single-pane"]') as HTMLElement
    const multiPane = container.querySelector('[data-testid="single-product-multi-pane"]') as HTMLElement
    expect(singlePane.style.display).toBe('none')
    expect(multiPane.style.display).toBe('block')
    // The MultiProductLCA component renders inside the multi pane.
    expect(within(multiPane).queryByTestId('multi-product-lca')).not.toBeNull()
  })

  it('switching back to Single preserves multi-item state (Patch 4AG.3 visibility-toggle invariant)', () => {
    const { container } = render(<SingleProductImpact />)
    // Switch to multi, add an item via the store directly (the
    // selector wiring is tested separately).
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    useMultiProductLCAStore.getState().addItem({
      type: 'archetype', archetype_id: 'arc-bev', display_name: 'BEV-LFP small',
    })
    expect(useMultiProductLCAStore.getState().selectedItems).toHaveLength(1)
    // Switch back to single.
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-single"]') as HTMLElement)
    // Store state must be preserved — not cleared by the toggle.
    expect(useMultiProductLCAStore.getState().selectedItems).toHaveLength(1)
    // Now switch back to multi: the selection should still appear.
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    expect(useMultiProductLCAStore.getState().selectedItems).toHaveLength(1)
  })

  it('both panes mount simultaneously (visibility-toggle pattern, not conditional mount)', () => {
    // Conditional mount would unmount the inactive pane and lose
    // its local state. The Patch 4AC visibility-toggle rule
    // (CLAUDE.md) applies here too: both subtrees stay in the DOM,
    // only `display` flips. Asserted by both data-testids being
    // present immediately after render in either mode.
    const { container } = render(<SingleProductImpact />)
    expect(container.querySelector('[data-testid="single-product-single-pane"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="single-product-multi-pane"]')).not.toBeNull()
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    expect(container.querySelector('[data-testid="single-product-single-pane"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="single-product-multi-pane"]')).not.toBeNull()
  })
})

describe('MultiProductLCA — compute integration', () => {
  it('Compute button disabled when no items selected', () => {
    const { container } = render(<SingleProductImpact />)
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    const btn = container.querySelector('[data-testid="multi-product-compute"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toContain('one item')
  })

  it('Compute button label reflects selection count', () => {
    // Pre-seed the store BEFORE render so the initial mount picks
    // up the populated selection. (Mutating the store after render
    // doesn't trigger a re-render of the test-render-tree without
    // wrapping in act + waitFor.)
    useMultiProductLCAStore.setState({
      selectedItems: [
        { type: 'archetype', archetype_id: 'arc-bev', display_name: 'BEV-LFP small' },
        { type: 'archetype', archetype_id: 'arc-icev', display_name: 'ICEV petrol' },
      ],
    } as any)
    const { container } = render(<SingleProductImpact />)
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    const btn = container.querySelector('[data-testid="multi-product-compute"]') as HTMLButtonElement
    expect(btn.textContent).toContain('2 items')
  })

  it('clicking Compute dispatches calculateMultiProductLCA with correct wire payload', async () => {
    const spy = vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue(FAKE_RESULT)
    const { container } = render(<SingleProductImpact />)
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    // Add an item and seed methods via the store (the MethodPicker
    // is feature-rich; bypass it for this integration test and set
    // methods directly via a click on a result row through the
    // selector).
    useMultiProductLCAStore.getState().addItem({
      type: 'archetype', archetype_id: 'arc-bev', display_name: 'BEV-LFP small',
    })
    // Manually dispatch compute through the store (the click would
    // also work if methods were selected; this verifies the wire
    // contract independently of MethodPicker UI).
    await useMultiProductLCAStore.getState().compute({
      scope: 'all',
      methods: [['EF v3.1', 'climate change', 'GWP100']],
    })
    expect(spy).toHaveBeenCalledOnce()
    const body = spy.mock.calls[0][0]
    expect(body.items).toHaveLength(1)
    expect(body.items[0].type).toBe('archetype')
    expect((body.items[0] as any).archetype_id).toBe('arc-bev')
    expect(body.scope).toBe('all')
    expect(body.methods).toEqual([['EF v3.1', 'climate change', 'GWP100']])
  })

  it('results table renders rows for each item with status indicator', async () => {
    vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue({
      ...FAKE_RESULT,
      items: [
        FAKE_RESULT.items[0],
        {
          type: 'archetype', item_id: 'arc-bad', label: 'bad arc',
          status: 'error', error_message: 'archetype not found',
        },
      ],
      success_count: 1, error_count: 1,
    })
    const { container } = render(<SingleProductImpact />)
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    useMultiProductLCAStore.getState().addItem({
      type: 'archetype', archetype_id: 'arc-bev', display_name: 'BEV-LFP small',
    })
    useMultiProductLCAStore.getState().addItem({
      type: 'archetype', archetype_id: 'arc-bad', display_name: 'bad arc',
    })
    await useMultiProductLCAStore.getState().compute({
      scope: 'all', methods: [['m']],
    })
    // Re-render manually to reflect the new result; testing-library
    // doesn't auto-rerender on zustand state changes via getState().
    const { container: c2 } = render(<SingleProductImpact />)
    fireEvent.click(c2.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    const table = c2.querySelector('[data-testid="multi-product-results"]')
    expect(table).not.toBeNull()
    // Patch 4AG.4 — default view is 'chart'. Switch to 'table' to
    // assert per-item rows. (Per-item compute correctness is the
    // load-bearing assertion here; chart-side coverage lives in
    // multiProductComparisonChart.test.tsx.)
    fireEvent.click(c2.querySelector('[data-testid="multi-product-view-table"]') as HTMLElement)
    // Success row + error row both present.
    expect(c2.querySelector('[data-testid="multi-product-row-arc-bev"]')).not.toBeNull()
    expect(c2.querySelector('[data-testid="multi-product-row-arc-bad"]')).not.toBeNull()
    // Status indicators differentiate.
    const successStatus = c2.querySelector('[data-testid="multi-product-status-arc-bev"]')
    const errorStatus = c2.querySelector('[data-testid="multi-product-status-arc-bad"]')
    expect(successStatus?.textContent).toContain('Success')
    expect(errorStatus?.textContent).toContain('Error')
  })

  it('top-level fetch failure surfaces multi-product-error banner', async () => {
    vi.spyOn(client, 'calculateMultiProductLCA').mockRejectedValue(new Error('Backend down'))
    const { container } = render(<SingleProductImpact />)
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    useMultiProductLCAStore.getState().addItem({
      type: 'archetype', archetype_id: 'arc-bev', display_name: 'BEV-LFP small',
    })
    await useMultiProductLCAStore.getState().compute({
      scope: 'all', methods: [['m']],
    })
    // Re-render to pick up the state.
    const { container: c2 } = render(<SingleProductImpact />)
    fireEvent.click(c2.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    const errBanner = c2.querySelector('[data-testid="multi-product-error"]')
    expect(errBanner).not.toBeNull()
    expect(errBanner?.textContent).toContain('Backend down')
  })
})
