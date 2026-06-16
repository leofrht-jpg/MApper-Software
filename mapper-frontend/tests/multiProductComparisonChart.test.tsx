/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MultiProductComparisonChart } from '../src/components/impact/MultiProductComparisonChart'
import type { MultiProductLCAResult } from '../src/api/client'

// Patch 4AG.4 — <MultiProductComparisonChart> unit tests.
//
// Note on test surface: Recharts 3.x + jsdom (with mocked
// ResponsiveContainer) doesn't paint internal chart SVG elements
// reliably — `<Bar>` / `<XAxis>` / `<YAxis>` materialise only at
// real layout time. Tests therefore observe what IS rendered:
//   - the LEGEND (which the component owns as native HTML/SVG,
//     outside Recharts' rendering pipeline)
//   - empty-state and no-method placeholders
//   - the chart wrapper testid (presence)
//   - the format control + export button
// The chart-internals (bar counts, fill colors per stage) are
// covered by manual visual inspection — same pattern as the AESA
// Timeline Patch 4AF tests.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

const STAGED_RESULT: MultiProductLCAResult = {
  items: [
    {
      type: 'archetype', item_id: 'arc-bev', label: 'BEV-LFP',
      status: 'success',
      archetype_result: {
        archetype_id: 'arc-bev', archetype_name: 'BEV-LFP',
        scope: 'all', amount: 1.0, stage_amounts: {},
        stages_included: ['Manufacturing', 'Use Phase'],
        results: [{
          method: ['EF v3.1', 'climate change', 'GWP100'],
          method_label: 'EF v3.1 › climate change › GWP100',
          score: 1000, unit: 'kg CO2 eq', contributions: [],
        }],
        stage_breakdown: {
          'EF v3.1 › climate change › GWP100': { 'Manufacturing': 700, 'Use Phase': 300 },
        },
        elapsed_seconds: 0.1,
      } as any,
    },
  ],
  elapsed_seconds: 0.1, success_count: 1, error_count: 0,
}

const ACTIVITY_RESULT: MultiProductLCAResult = {
  items: [
    {
      type: 'activity', item_id: 'ei|c1', label: 'battery',
      status: 'success',
      activity_result: {
        results: [{
          method: ['EF v3.1', 'climate change', 'GWP100'],
          method_label: 'EF v3.1 › climate change › GWP100',
          score: 500, unit: 'kg CO2 eq', contributions: [],
        }],
        elapsed_seconds: 0.05,
      } as any,
    },
  ],
  elapsed_seconds: 0.05, success_count: 1, error_count: 0,
}

const MIXED_RESULT: MultiProductLCAResult = {
  items: [STAGED_RESULT.items[0], ACTIVITY_RESULT.items[0]],
  elapsed_seconds: 0.15, success_count: 2, error_count: 0,
}

describe('MultiProductComparisonChart — placeholders', () => {
  it('renders empty-state message when no successful items', () => {
    const allFailed: MultiProductLCAResult = {
      items: [{
        type: 'archetype', item_id: 'a', label: 'A',
        status: 'error', error_message: 'boom',
      }],
      elapsed_seconds: 0.1, success_count: 0, error_count: 1,
    }
    const { container } = render(
      <MultiProductComparisonChart
        result={allFailed}
        scope="all"
        selectedMethodLabel="any"
      />,
    )
    expect(container.querySelector('[data-testid="multi-product-chart-empty"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-product-chart"]')).toBeNull()
  })

  it('renders no-method placeholder when selectedMethodLabel is null', () => {
    const { container } = render(
      <MultiProductComparisonChart
        result={STAGED_RESULT}
        scope="all"
        selectedMethodLabel={null}
      />,
    )
    expect(container.querySelector('[data-testid="multi-product-chart-no-method"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-product-chart"]')).toBeNull()
  })

  it('renders the chart wrapper when valid data + method', () => {
    const { container } = render(
      <MultiProductComparisonChart
        result={STAGED_RESULT}
        scope="all"
        selectedMethodLabel="EF v3.1 › climate change › GWP100"
      />,
    )
    expect(container.querySelector('[data-testid="multi-product-chart"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-product-chart-legend"]')).not.toBeNull()
  })
})

describe('MultiProductComparisonChart — legend reflects shape mode', () => {
  it('stacked mode legend lists every stage name', () => {
    // scope='all' AND every successful archetype has stage_breakdown
    // → stacked. Legend renders one entry per stage. The
    // activity-items entry only appears when at least one activity
    // item is present.
    const { container } = render(
      <MultiProductComparisonChart
        result={STAGED_RESULT}
        scope="all"
        selectedMethodLabel="EF v3.1 › climate change › GWP100"
      />,
    )
    const legend = container.querySelector('[data-testid="multi-product-chart-legend"]')!
    expect(legend.textContent).toContain('Manufacturing')
    expect(legend.textContent).toContain('Use Phase')
    expect(legend.textContent).not.toContain('activity items')
  })

  it('solid mode legend lists one entry per item (stable per-item color)', () => {
    // All-activity → no stages anywhere → solid mode. The legend now lists
    // ITEMS (each its own stable color), not a single "Total" — so activity
    // vintages are distinguishable by color.
    const { container } = render(
      <MultiProductComparisonChart
        result={ACTIVITY_RESULT}
        scope="all"
        selectedMethodLabel="EF v3.1 › climate change › GWP100"
      />,
    )
    const legend = container.querySelector('[data-testid="multi-product-chart-legend"]')!
    // Per-item entry, keyed by item_id, labeled by the item's label.
    expect(legend.querySelector('[data-testid="multi-product-legend-item-ei|c1"]')).not.toBeNull()
    expect(legend.textContent).toContain('battery')
    expect(legend.textContent).not.toContain('Manufacturing')
    expect(legend.textContent).not.toContain('Use Phase')
    expect(legend.textContent).not.toContain('activity items')
  })

  it('mixed mode legend lists stages PLUS the activity-items entry', () => {
    // Mixed: archetype contributes stages; activity contributes the
    // ACTIVITY_TOTAL slot. Legend reflects both.
    const { container } = render(
      <MultiProductComparisonChart
        result={MIXED_RESULT}
        scope="all"
        selectedMethodLabel="EF v3.1 › climate change › GWP100"
      />,
    )
    const legend = container.querySelector('[data-testid="multi-product-chart-legend"]')!
    expect(legend.textContent).toContain('Manufacturing')
    expect(legend.textContent).toContain('Use Phase')
    expect(legend.textContent).toContain('activity items')
  })

  it('specific scope forces solid mode even with archetype items', () => {
    // scope='inflows' (or any non-'all') → stage_breakdown is null
    // even for archetypes → solid mode. The mode is determined by
    // whether ANY successful archetype carries stage_breakdown for
    // the selected method, AND by scope='all'.
    const inflowsResult: MultiProductLCAResult = {
      items: [{
        type: 'archetype', item_id: 'arc-x', label: 'X',
        status: 'success',
        archetype_result: {
          archetype_id: 'arc-x', archetype_name: 'X',
          scope: 'inflows', amount: 1.0, stage_amounts: {},
          stages_included: ['Manufacturing'],
          results: [{ method: ['m'], method_label: 'M', score: 100, unit: 'u', contributions: [] }],
          stage_breakdown: null,
          elapsed_seconds: 0.05,
        } as any,
      }],
      elapsed_seconds: 0.1, success_count: 1, error_count: 0,
    }
    const { container } = render(
      <MultiProductComparisonChart
        result={inflowsResult}
        scope="inflows"
        selectedMethodLabel="M"
      />,
    )
    const legend = container.querySelector('[data-testid="multi-product-chart-legend"]')!
    // Solid mode: one per-item entry (labeled 'X'), no stage names.
    expect(legend.querySelector('[data-testid="multi-product-legend-item-arc-x"]')).not.toBeNull()
    expect(legend.textContent).toContain('X')
    expect(legend.textContent).not.toContain('Manufacturing')
  })
})

describe('MultiProductComparisonChart — color discipline (legend swatches)', () => {
  it('stacked mode legend swatches use distinct stage colors', () => {
    const { container } = render(
      <MultiProductComparisonChart
        result={STAGED_RESULT}
        scope="all"
        selectedMethodLabel="EF v3.1 › climate change › GWP100"
      />,
    )
    const legend = container.querySelector('[data-testid="multi-product-chart-legend"]')!
    // Legend swatches are <span style="background-color: ..."> inline.
    const swatches = Array.from(legend.querySelectorAll('span > span'))
      .map((s) => (s as HTMLElement).style.backgroundColor)
      .filter((c) => c)
    // 2 distinct stage colors expected.
    const unique = new Set(swatches)
    expect(unique.size).toBeGreaterThanOrEqual(2)
  })

  it('mixed mode adds a neutral activity-totals swatch distinct from stage colors', () => {
    const { container } = render(
      <MultiProductComparisonChart
        result={MIXED_RESULT}
        scope="all"
        selectedMethodLabel="EF v3.1 › climate change › GWP100"
      />,
    )
    const legend = container.querySelector('[data-testid="multi-product-chart-legend"]')!
    const swatches = Array.from(legend.querySelectorAll('span > span'))
      .map((s) => (s as HTMLElement).style.backgroundColor)
      .filter((c) => c)
    // 2 stages + activity-totals = 3 distinct colors.
    expect(new Set(swatches).size).toBeGreaterThanOrEqual(3)
  })
})

describe('MultiProductComparisonChart — method-switching reactivity', () => {
  it('changing selectedMethodLabel re-renders with the new method\'s unit on Y-axis label', () => {
    const twoMethodResult: MultiProductLCAResult = {
      items: [{
        type: 'archetype', item_id: 'arc', label: 'arc',
        status: 'success',
        archetype_result: {
          archetype_id: 'arc', archetype_name: 'arc',
          scope: 'all', amount: 1.0, stage_amounts: {},
          stages_included: ['Manufacturing'],
          results: [
            { method: ['EF v3.1', 'climate change', 'GWP100'], method_label: 'climate', score: 100, unit: 'kg CO2 eq', contributions: [] },
            { method: ['EF v3.1', 'water use', 'depriv'], method_label: 'water', score: 5, unit: 'm3', contributions: [] },
          ],
          stage_breakdown: {
            'climate': { 'Manufacturing': 70 },
            'water':   { 'Manufacturing': 1 },
          },
          elapsed_seconds: 0.05,
        } as any,
      }],
      elapsed_seconds: 0.1, success_count: 1, error_count: 0,
    }
    const { rerender, container } = render(
      <MultiProductComparisonChart
        result={twoMethodResult} scope="all" selectedMethodLabel="climate"
      />,
    )
    // Y-axis label renders as a <text> element somewhere in the
    // chart subtree; jsdom does materialize it as part of Recharts'
    // declarative props pre-layout. Look for the unit text.
    expect(container.textContent).toContain('kg CO2 eq')
    rerender(
      <MultiProductComparisonChart
        result={twoMethodResult} scope="all" selectedMethodLabel="water"
      />,
    )
    expect(container.textContent).toContain('m3')
  })
})
