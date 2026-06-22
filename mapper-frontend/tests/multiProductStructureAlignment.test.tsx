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
import { render, act } from '@testing-library/react'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type { ArchetypeSummary, MultiProductLCAResult } from '../src/api/client'
import type { ProductItem } from '../src/components/shared/productItem'

// Patch 5Q — structural alignment of Multi-item to the Single item tab:
// selection-first ordering (Items → Stage amounts → Configuration → Compute →
// Results), "Configuration" naming, and scope-stage labels standardized to the
// Single item tab's wording/casing. Lock the structure; existing behavior is
// covered by the other multi-product suites.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const ARCHETYPES: ArchetypeSummary[] = [
  { id: 'arc-a', name: 'BEV', description: null, category: 'pc', folder: 'PC', material_count: 1, unlinked_count: 0, stages: ['Manufacturing', 'Use Phase', 'End of Life'], stage_annual: { 'Use Phase': true }, created_at: '', updated_at: '' },
] as any

const arcItem = (id: string, name: string): ProductItem => ({ type: 'archetype', archetype_id: id, display_name: name } as ProductItem)

const RESULT: MultiProductLCAResult = {
  items: [{ type: 'archetype', item_id: 'arc-a', label: 'BEV', status: 'success',
    archetype_result: { archetype_id: 'arc-a', archetype_name: 'BEV', scope: 'all', amount: 1, stage_amounts: {}, stages_included: [], results: [{ method: ['EF', 'cc'], method_label: 'cc', score: 1, unit: 'kg', contributions: [] }], stage_breakdown: null, elapsed_seconds: 0 } }],
  elapsed_seconds: 0.1, success_count: 1, error_count: 0,
} as any

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

// a precedes b in document order?
const precedes = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('Multi-item structural alignment to Single item (Patch 5Q)', () => {
  it('renders sections selection-first: Items → Stage amounts → Configuration → Compute → Results', () => {
    act(() => { useMultiProductLCAStore.setState({ selectedItems: [arcItem('arc-a', 'BEV')], multiResult: RESULT } as any) })
    const { getByTestId } = render(<MultiProductLCA />)
    const items = getByTestId('multi-product-selection')
    const stage = getByTestId('multi-product-stage-amounts')
    const config = getByTestId('multi-product-config')
    const compute = getByTestId('multi-product-compute')
    const results = getByTestId('multi-product-results')
    expect(precedes(items, stage)).toBe(true)
    expect(precedes(stage, config)).toBe(true)
    expect(precedes(config, compute)).toBe(true)
    expect(precedes(compute, results)).toBe(true)
  })

  it('config section is titled "Configuration" (mirrors Single item), each section in a CollapsibleCard', () => {
    const { getByTestId, getByRole } = render(<MultiProductLCA />)
    // Configuration heading present + its body inside a <section> (CollapsibleCard).
    expect(getByRole('heading', { name: 'Configuration' })).toBeTruthy()
    expect(getByTestId('multi-product-config').closest('section')).not.toBeNull()
    expect(getByTestId('multi-product-selection').closest('section')).not.toBeNull()
  })

  it('scope-stage buttons use the Single item tab labels (Full Lifecycle / Operation / End of Life)', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    expect(getByTestId('multi-product-scope-all').textContent).toBe('Full Lifecycle')
    expect(getByTestId('multi-product-scope-inflows').textContent).toBe('Manufacturing')
    expect(getByTestId('multi-product-scope-stock').textContent).toBe('Operation')
    expect(getByTestId('multi-product-scope-outflows').textContent).toBe('End of Life')
  })

  it('MultiItemSelector (multi-select) is preserved at the top — not replaced by a single dropdown', () => {
    const { getByTestId } = render(<MultiProductLCA />)
    // The selection section still hosts the multi-select MultiItemSelector.
    const selection = getByTestId('multi-product-selection')
    expect(selection.querySelector('[data-testid="multi-item-selector"]')).not.toBeNull()
  })
})
