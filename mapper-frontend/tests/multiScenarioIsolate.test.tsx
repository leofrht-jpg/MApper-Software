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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { MultiScenarioImpactChart } from '../src/components/charts/MultiScenarioImpactChart'
import { extractLegendItems } from '../src/components/charts/chartExport'
import type { ImpactAssessmentResult, SingleMethodImpactResult } from '../src/api/client'

// Patch 5AE — discoverability for isolating ONE scenario line to download just
// that one. The 5O mechanism (clickable legend + visible-only export) already
// works; 5AE adds "Isolate" (solo) + "Show all" controls OUTSIDE legendRef so
// the visible-only export contract is untouched. Lock: isolate hides the
// others, the export legend then carries only the soloed scenario, Show all
// resets, and colors stay stable.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

beforeEach(() => { (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
afterEach(() => { /* noop */ })

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

function renderChart() {
  return render(
    <MultiScenarioImpactChart
      scenarios={SCENARIOS} selectedResultIdx={0} detailYear={null} format={FORMAT_API}
      cohortKeys={['BEV|Small']} cohortColorMap={{ 'BEV|Small': '#14b8a6' }}
      filenameBase="test" axisLabel="LCI scenarios"
    />,
  )
}

const visibleLegend = (c: HTMLElement) => c.querySelector('[data-testid="multi-scenario-legend"]') as HTMLElement
const visibleCount = (c: HTMLElement) =>
  within(visibleLegend(c)).queryAllByTestId(/multi-scenario-legend-item-/).length

describe('MultiScenarioImpactChart — isolate one line for download (Patch 5AE)', () => {
  it('discoverability controls render with a hint about visible-only download', () => {
    const { container } = renderChart()
    const controls = container.querySelector('[data-testid="multi-scenario-legend-controls"]')!
    expect(controls).not.toBeNull()
    expect(controls.textContent).toMatch(/only visible/i)
  })

  it('"Isolate" hides the other scenarios; the export legend then carries only that one', () => {
    const { container } = renderChart()
    expect(visibleCount(container)).toBe(3)
    // Isolate SSP2 → only SSP2 visible.
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-isolate-SSP2"]')!)
    expect(visibleCount(container)).toBe(1)
    // The export reads legendRef (visible group) → only the soloed scenario.
    const items = extractLegendItems(visibleLegend(container)).map((i) => i.label)
    expect(items).toEqual(['SSP2'])
    // SSP1 + SSP5 moved to the hidden (toggle-back) group, outside legendRef.
    const hidden = container.querySelector('[data-testid="multi-scenario-legend-hidden"]')!
    expect(within(hidden as HTMLElement).getByTestId('multi-scenario-legend-item-SSP1')).toBeTruthy()
    expect(within(hidden as HTMLElement).getByTestId('multi-scenario-legend-item-SSP5')).toBeTruthy()
  })

  it('"Show all" resets to all visible', () => {
    const { container } = renderChart()
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-isolate-SSP1"]')!)
    expect(visibleCount(container)).toBe(1)
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-show-all"]')!)
    expect(visibleCount(container)).toBe(3)
  })

  it('color stability: isolating then showing all keeps each scenario its original color', () => {
    const { container } = renderChart()
    const colorOf = (label: string) =>
      (container.querySelector(`[data-testid="multi-scenario-legend-item-${label}"] span`) as HTMLElement).style.backgroundColor
    const ssp5Before = colorOf('SSP5')
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-isolate-SSP5"]')!)
    expect(colorOf('SSP5')).toBe(ssp5Before)  // soloed scenario keeps its original-index color
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-show-all"]')!)
    expect(colorOf('SSP5')).toBe(ssp5Before)
  })

  it('isolate buttons appear only while >1 scenario is visible (gone once soloed)', () => {
    const { container } = renderChart()
    expect(container.querySelector('[data-testid="multi-scenario-isolate-SSP1"]')).not.toBeNull()
    fireEvent.click(container.querySelector('[data-testid="multi-scenario-isolate-SSP1"]')!)
    // Only one visible → no isolate buttons (nothing to isolate from); Show all present.
    expect(container.querySelector('[data-testid="multi-scenario-isolate-SSP1"]')).toBeNull()
    expect(container.querySelector('[data-testid="multi-scenario-show-all"]')).not.toBeNull()
  })
})
