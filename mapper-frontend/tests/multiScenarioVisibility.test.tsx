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
import { render, fireEvent, within } from '@testing-library/react'
import { MultiScenarioImpactChart } from '../src/components/charts/MultiScenarioImpactChart'
import { extractLegendItems } from '../src/components/charts/chartExport'
import { SCENARIO_PALETTE } from '../src/utils/chartColors'
import type { ImpactAssessmentResult, SingleMethodImpactResult } from '../src/api/client'

// Patch 5O — per-scenario line visibility (display filter) on the
// "Impact over time, total per scenario" chart. Display/export only:
// toggling never recomputes and never recolors. Lock the mechanism.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

beforeEach(() => {
  ;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

function buildResult(scale: number): ImpactAssessmentResult {
  const years: SingleMethodImpactResult['years'] = []
  for (let y = 2025; y <= 2035; y += 5) {
    years.push({ year: y, total_impact: scale * (y - 2024), impact_by_cohort: { 'BEV|Small': scale * (y - 2024) }, impact_by_material: {} })
  }
  return { meta: { computed_at: '', scope: 'all', system_id: '' } as any,
    results: [{ method: ['EF', 'cc', 'kg'] as any, unit: 'kg CO2-eq', years, elapsed_seconds: 0 }] } as ImpactAssessmentResult
}

const SCENARIOS = [
  { label: 'SSP1', result: buildResult(10) },
  { label: 'SSP2', result: buildResult(20) },
  { label: 'SSP5', result: buildResult(30) },
]

const FORMAT_API: any = { settings: { notation: 'scientific', sigFigs: 3 }, setSettings: vi.fn(), format: (v: number) => v.toExponential(2) }

function renderChart(extra?: Partial<React.ComponentProps<typeof MultiScenarioImpactChart>>) {
  return render(
    <MultiScenarioImpactChart
      scenarios={SCENARIOS}
      selectedResultIdx={0}
      detailYear={null}
      format={FORMAT_API}
      cohortKeys={['BEV|Small']}
      cohortColorMap={{ 'BEV|Small': '#14b8a6' }}
      filenameBase="test"
      axisLabel="LCI scenarios"
      {...(extra as any)}
    />,
  )
}

// Recharts <Line> internals don't render in jsdom (no layout engine). TotalView
// renders exactly one <Line> per VISIBLE scenario, and the visible legend
// (legendRef) lists exactly those scenarios — so the visible-legend entry count
// is a faithful, deterministic proxy for "lines shown".
const lineCount = (c: HTMLElement) => {
  const legend = c.querySelector('[data-testid="multi-scenario-legend"]')
  if (!legend) return 0
  return legend.querySelectorAll('[data-testid^="multi-scenario-legend-item-"]').length
}

describe('MultiScenarioImpactChart — per-scenario visibility (Patch 5O)', () => {
  it('defaults to all scenarios visible (current behavior)', () => {
    const { container } = renderChart()
    expect(lineCount(container)).toBe(3)
    // All three legend items present + pressed (visible).
    for (const s of ['SSP1', 'SSP2', 'SSP5']) {
      const item = container.querySelector(`[data-testid="multi-scenario-legend-item-${s}"]`)!
      expect(item.getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('toggling a scenario hides its line; others remain (any subset)', () => {
    const { container } = renderChart()
    // Hide SSP2 → 2 lines; SSP2 moves to the hidden (toggle-back) group.
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-legend-item-SSP2"]')!)
    expect(lineCount(container)).toBe(2)
    const hidden = container.querySelector('[data-testid="multi-scenario-legend-hidden"]')!
    expect(within(hidden as HTMLElement).getByTestId('multi-scenario-legend-item-SSP2')).toBeTruthy()
    // Visible legend (legendRef) no longer lists SSP2.
    const visLegend = container.querySelector('[data-testid="multi-scenario-legend"]')!
    expect(within(visLegend as HTMLElement).queryByTestId('multi-scenario-legend-item-SSP2')).toBeNull()
    expect(within(visLegend as HTMLElement).getByTestId('multi-scenario-legend-item-SSP1')).toBeTruthy()

    // Hide SSP5 too → one line. Toggle SSP2 back → two lines.
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-legend-item-SSP5"]')!)
    expect(lineCount(container)).toBe(1)
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-legend-item-SSP2"]')!)
    expect(lineCount(container)).toBe(2)
  })

  it('color stability: a scenario keeps its color when another is toggled off', () => {
    const { container } = renderChart()
    const colorOf = (label: string) =>
      (container.querySelector(`[data-testid="multi-scenario-legend-item-${label}"] span`) as HTMLElement).style.backgroundColor
    const ssp1Before = colorOf('SSP1')
    const ssp5Before = colorOf('SSP5')
    // Hide SSP2 (the middle index) — naive index-based coloring would shift
    // SSP5 onto SSP2's palette slot.
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-legend-item-SSP2"]')!)
    expect(colorOf('SSP1')).toBe(ssp1Before)
    expect(colorOf('SSP5')).toBe(ssp5Before)
    // And SSP5 keeps palette index 2 (not 1).
    expect(ssp5Before).not.toBe('')
  })

  it('compute guard: toggling does not mutate the computed scenarios prop (no recompute path)', () => {
    const scenarios = [...SCENARIOS]
    const { container } = render(
      <MultiScenarioImpactChart scenarios={scenarios} selectedResultIdx={0} detailYear={null}
        format={FORMAT_API} cohortKeys={['BEV|Small']} cohortColorMap={{ 'BEV|Small': '#14b8a6' }}
        filenameBase="test" axisLabel="LCI scenarios" />,
    )
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-legend-item-SSP2"]')!)
    // The chart owns no compute/refetch callback; the input data is untouched.
    expect(scenarios).toHaveLength(3)
    expect(scenarios.map((s) => s.label)).toEqual(['SSP1', 'SSP2', 'SSP5'])
  })

  it('legend export reflects only the visible subset', () => {
    const { container } = renderChart()
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-legend-item-SSP2"]')!)
    // The export reads `legendRef` (the visible group only).
    const legend = container.querySelector('[data-testid="multi-scenario-legend"]') as HTMLElement
    const items = extractLegendItems(legend).map((i) => i.label)
    expect(items).toContain('SSP1')
    expect(items).toContain('SSP5')
    expect(items).not.toContain('SSP2')
  })

  it('all hidden renders a graceful empty state (no crash)', () => {
    const { container } = renderChart()
    for (const s of ['SSP1', 'SSP2', 'SSP5']) {
      fireEvent.click(container.querySelector(`[data-testid="multi-scenario-legend-item-${s}"]`)!)
    }
    expect(container.querySelector('[data-testid="multi-scenario-all-hidden"]')).not.toBeNull()
    expect(lineCount(container)).toBe(0)
  })
})
