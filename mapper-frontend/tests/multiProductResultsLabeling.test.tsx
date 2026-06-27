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
import { MultiProductComparisonChart } from '../src/components/impact/MultiProductComparisonChart'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type { MultiProductLCAResult } from '../src/api/client'

// Fix 2 — every column/series in a 2+ item comparison is labelled by its
// activity, with a disambiguator when look-alike ecoinvent activities share a
// reference product but differ by geography/database. The backend
// (`disambiguate_item_labels`) is the single source of truth for `label`; this
// asserts the disambiguated label reaches both the CHART and the TABLE.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const METHOD = 'EF v3.1 › climate change › GWP100'
const mres = (score: number) => ({
  results: [{ method: ['EF v3.1', 'climate change', 'GWP100'], method_label: METHOD, score, unit: 'kg CO2 eq', contributions: [] }],
  elapsed_seconds: 0.05,
})

// Two look-alike activities: same PROCESS NAME + product, different geography.
// The backend label now leads with the activity name (Issue 1) and the location
// disambiguates (prior work) — no redundant product repetition.
const LOOKALIKE: MultiProductLCAResult = {
  items: [
    { type: 'activity', item_id: 'ei|cDK', label: 'market for electricity, low voltage {DK}', status: 'success', activity_result: mres(0.11) as any },
    { type: 'activity', item_id: 'ei|cFR', label: 'market for electricity, low voltage {FR}', status: 'success', activity_result: mres(0.06) as any },
  ],
  elapsed_seconds: 0.1, success_count: 2, error_count: 0,
}

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  useBOMStore.setState({ archetypes: [], fetchArchetypes: vi.fn() } as any)
  useActivityStore.setState({ activities: [], selectedDatabase: 'ei-3.10', searchActivities: vi.fn(), setDatabase: vi.fn() } as any)
  useProjectStore.setState({ databases: [{ name: 'ei-3.10', size_mb: 1, activity_count: 1 } as any] } as any)
  useMultiProductLCAStore.getState().reset()
})

describe('Fix 2 — CHART labels each series with its disambiguated activity', () => {
  it('solid-mode legend carries a distinct entry + disambiguator per item', () => {
    const { container } = render(
      <MultiProductComparisonChart result={LOOKALIKE} scope="all" selectedMethodLabel={METHOD} />,
    )
    const legend = container.querySelector('[data-testid="multi-product-chart-legend"]')!
    // One legend entry per item, keyed by item_id (color-stable identity).
    expect(legend.querySelector('[data-testid="multi-product-legend-item-ei|cDK"]')).not.toBeNull()
    expect(legend.querySelector('[data-testid="multi-product-legend-item-ei|cFR"]')).not.toBeNull()
    // The disambiguator (geography) survives display-shortening → identifiable.
    expect(legend.textContent).toContain('{DK}')
    expect(legend.textContent).toContain('{FR}')
    // The two series are NOT identical (no ambiguous duplicate columns).
    const dk = legend.querySelector('[data-testid="multi-product-legend-item-ei|cDK"]')!.textContent
    const fr = legend.querySelector('[data-testid="multi-product-legend-item-ei|cFR"]')!.textContent
    expect(dk).not.toBe(fr)
  })

  it('the activity name is shown (as the shared chart subtitle when prefixes collapse)', () => {
    // Both bars are the same process at different geographies → the common
    // activity name is surfaced once as the subtitle (Issue 1: the process is
    // identifiable, not just the product/db/location).
    const { container } = render(
      <MultiProductComparisonChart result={LOOKALIKE} scope="all" selectedMethodLabel={METHOD} />,
    )
    const subtitle = container.querySelector('[data-testid="multi-product-chart-subtitle"]')!
    expect(subtitle.textContent).toContain('market for electricity, low voltage')
  })
})

describe('Fix 2 — TABLE labels each row with its disambiguated activity', () => {
  it('table view shows both full disambiguated labels', () => {
    useMultiProductLCAStore.setState({ multiResult: LOOKALIKE } as any)
    const { container } = render(<SingleProductImpact />)
    fireEvent.click(container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-testid="multi-product-view-table"]') as HTMLElement)
    const table = container.querySelector('[data-testid="multi-product-results-table"]')!
    // Full activity-name label (Issue 1) + geography disambiguator, per row.
    expect(table.textContent).toContain('market for electricity, low voltage {DK}')
    expect(table.textContent).toContain('market for electricity, low voltage {FR}')
    // Each item has its own row (no collapsed/ambiguous column).
    expect(container.querySelector('[data-testid="multi-product-row-ei|cDK"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-product-row-ei|cFR"]')).not.toBeNull()
  })
})
