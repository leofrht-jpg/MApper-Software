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
import { render, fireEvent } from '@testing-library/react'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type { ArchetypeSummary, MultiProductLCAResult } from '../src/api/client'

// Patch 4AG.4 — integration tests for the multi-product results
// section: method picker, view toggle (chart/table), Export button,
// errors banner.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const ARCHETYPES: ArchetypeSummary[] = [
  {
    id: 'arc-bev', name: 'BEV-LFP', description: null,
    category: 'pc', folder: 'Passenger cars',
    material_count: 10, unlinked_count: 0, stages: ['Manufacturing'],
    stage_annual: {}, created_at: '', updated_at: '',
  },
]

const RESULT_FULL_SUCCESS: MultiProductLCAResult = {
  items: [{
    type: 'archetype', item_id: 'arc-bev', label: 'BEV-LFP',
    status: 'success',
    archetype_result: {
      archetype_id: 'arc-bev', archetype_name: 'BEV-LFP',
      scope: 'all', amount: 1.0, stage_amounts: {},
      stages_included: ['Manufacturing'],
      results: [
        { method: ['EF v3.1', 'climate change', 'GWP100'], method_label: 'climate', score: 1234.5, unit: 'kg CO2 eq', contributions: [] },
        { method: ['EF v3.1', 'water use', 'depriv'], method_label: 'water', score: 7.8, unit: 'm3', contributions: [] },
      ],
      stage_breakdown: { 'climate': { Manufacturing: 1234.5 }, 'water': { Manufacturing: 7.8 } },
      elapsed_seconds: 0.1,
    } as any,
  }],
  elapsed_seconds: 0.1, success_count: 1, error_count: 0,
}

const RESULT_PARTIAL: MultiProductLCAResult = {
  items: [
    RESULT_FULL_SUCCESS.items[0],
    { type: 'archetype', item_id: 'arc-bad', label: 'bad arc', status: 'error', error_message: 'not found' },
  ],
  elapsed_seconds: 0.15, success_count: 1, error_count: 1,
}

const RESULT_ALL_FAILED: MultiProductLCAResult = {
  items: [
    { type: 'archetype', item_id: 'a', label: 'A', status: 'error', error_message: 'x' },
    { type: 'archetype', item_id: 'b', label: 'B', status: 'error', error_message: 'y' },
  ],
  elapsed_seconds: 0.1, success_count: 0, error_count: 2,
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  useBOMStore.setState({ archetypes: ARCHETYPES, fetchArchetypes: vi.fn() } as any)
  useActivityStore.setState({
    activities: [], selectedDatabase: 'ei-3.10',
    searchActivities: vi.fn(), setDatabase: vi.fn(),
  } as any)
  useProjectStore.setState({
    databases: [{ name: 'ei-3.10', size_mb: 1, activity_count: 1 } as any],
  } as any)
  useMultiProductLCAStore.getState().reset()
})

function renderInMultiMode(seedResult?: MultiProductLCAResult) {
  if (seedResult) {
    useMultiProductLCAStore.setState({ multiResult: seedResult } as any)
  }
  const utils = render(<SingleProductImpact />)
  fireEvent.click(utils.container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
  return utils
}

describe('multi-product results section — view toggle (Patch 4AG.4)', () => {
  it('default view is chart', () => {
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    // Chart wrapper present.
    expect(container.querySelector('[data-testid="multi-product-chart"]')).not.toBeNull()
    // Table NOT present.
    expect(container.querySelector('[data-testid="multi-product-results-table"]')).toBeNull()
  })

  it('switching to table view hides the chart and shows the table', () => {
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    fireEvent.click(container.querySelector('[data-testid="multi-product-view-table"]') as HTMLElement)
    expect(container.querySelector('[data-testid="multi-product-chart"]')).toBeNull()
    expect(container.querySelector('[data-testid="multi-product-results-table"]')).not.toBeNull()
  })

  it('switching back to chart hides the table', () => {
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    fireEvent.click(container.querySelector('[data-testid="multi-product-view-table"]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-testid="multi-product-view-chart"]') as HTMLElement)
    expect(container.querySelector('[data-testid="multi-product-chart"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-product-results-table"]')).toBeNull()
  })
})

describe('multi-product method picker (Patch 4AG.4)', () => {
  it('renders only in chart view, listing every method present in the result', () => {
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    const picker = container.querySelector('[data-testid="multi-product-method-picker"]') as HTMLSelectElement
    expect(picker).not.toBeNull()
    const optionTexts = Array.from(picker.options).map((o) => o.textContent ?? '')
    expect(optionTexts).toContain('climate')
    expect(optionTexts).toContain('water')
  })

  it('disappears in table view (the table shows all methods at once)', () => {
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    fireEvent.click(container.querySelector('[data-testid="multi-product-view-table"]') as HTMLElement)
    expect(container.querySelector('[data-testid="multi-product-method-picker"]')).toBeNull()
  })

  it('changing selection re-renders chart with the new method\'s unit', () => {
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    // Initial selection auto-pins to "climate" (first method).
    expect(container.textContent).toContain('kg CO2 eq')
    const picker = container.querySelector('[data-testid="multi-product-method-picker"]') as HTMLSelectElement
    fireEvent.change(picker, { target: { value: 'water' } })
    expect(container.textContent).toContain('m3')
  })

  it('default selection is the first method in the result\'s method order', () => {
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    const picker = container.querySelector('[data-testid="multi-product-method-picker"]') as HTMLSelectElement
    expect(picker.value).toBe('climate')
  })
})

describe('multi-product export button (Patch 4AG.4)', () => {
  it('disabled when no successful results', () => {
    const { container } = renderInMultiMode(RESULT_ALL_FAILED)
    const btn = container.querySelector('[data-testid="multi-product-export"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toContain('No successful results')
  })

  it('enabled when at least one successful result', () => {
    const { container } = renderInMultiMode(RESULT_PARTIAL)
    const btn = container.querySelector('[data-testid="multi-product-export"]') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('clicking Export dispatches the multi-product export client call with the result + scope', async () => {
    const spy = vi.spyOn(client, 'exportMultiProductComparison').mockResolvedValue(undefined)
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    fireEvent.click(container.querySelector('[data-testid="multi-product-export"]') as HTMLElement)
    // The export client is async; allow microtasks to flush.
    await Promise.resolve()
    expect(spy).toHaveBeenCalledOnce()
    const [resultArg, scopeArg] = spy.mock.calls[0]
    expect(resultArg).toBe(RESULT_FULL_SUCCESS)
    // Default scope after switching to multi-mode is 'all'.
    expect(scopeArg).toBe('all')
  })

  it('has descriptive title + aria-label (icon-only convention from Patch 4Z)', () => {
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    const btn = container.querySelector('[data-testid="multi-product-export"]') as HTMLButtonElement
    expect(btn.getAttribute('aria-label')).toContain('xlsx')
    expect(btn.getAttribute('title')).toContain('xlsx')
  })
})

describe('multi-product errors banner (Patch 4AG.4)', () => {
  it('renders with per-item failure list when partial success', () => {
    const { container } = renderInMultiMode(RESULT_PARTIAL)
    const banner = container.querySelector('[data-testid="multi-product-errors-banner"]')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toContain('bad arc')
    expect(banner!.textContent).toContain('not found')
  })

  it('hidden when full success', () => {
    const { container } = renderInMultiMode(RESULT_FULL_SUCCESS)
    expect(container.querySelector('[data-testid="multi-product-errors-banner"]')).toBeNull()
  })

  it('renders even when all items failed (chart shows empty state alongside)', () => {
    const { container } = renderInMultiMode(RESULT_ALL_FAILED)
    expect(container.querySelector('[data-testid="multi-product-errors-banner"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-product-chart-empty"]')).not.toBeNull()
  })
})
