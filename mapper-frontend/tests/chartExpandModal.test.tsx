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
import { MultiScenarioImpactChart } from '../src/components/charts/MultiScenarioImpactChart'
import { ChartExpandModal } from '../src/components/ui/ChartExpandModal'
import type { ImpactAssessmentResult, SingleMethodImpactResult } from '../src/api/client'

// Patch 4AL — single-chart expand affordance.
//
// Coverage:
//   1. <ChartExpandModal> chrome — portal mount, backdrop / Esc / X
//      close, header layout (title + actions + close).
//   2. MultiScenarioImpactChart faceted view — each facet gets an
//      expand button; click opens modal; modal contains the correct
//      scenario's data + title.
//   3. Y-axis default: same scale as grid; Auto-fit toggle exposed in
//      the modal header.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } },
      React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

beforeEach(() => {
  // jsdom doesn't implement ResizeObserver; recharts ResponsiveContainer needs it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

// ── Fixture builders ─────────────────────────────────────────────────────────

function buildSingleMethodResult(opts: {
  scale: number
}): SingleMethodImpactResult {
  const years: SingleMethodImpactResult['years'] = []
  for (let y = 2025; y <= 2050; y += 5) {
    const cohort_a = opts.scale * (y - 2024)
    const cohort_b = opts.scale * 0.5 * (y - 2024)
    years.push({
      year: y,
      total_impact: cohort_a + cohort_b,
      impact_by_cohort: { 'BEV-LFP|Small': cohort_a, 'ICEV|Large': cohort_b },
      impact_by_material: {},
    })
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    method: ['EF v3.1', 'climate change', 'kg CO2-eq'] as any,
    unit: 'kg CO2-eq',
    years,
    elapsed_seconds: 0,
  }
}

function buildResult(scale: number): ImpactAssessmentResult {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta: { computed_at: '', scope: 'all', system_id: '' } as any,
    results: [buildSingleMethodResult({ scale })],
  } as ImpactAssessmentResult
}

const SCENARIOS = [
  { label: 'SSP1-2.6 · IMAGE', result: buildResult(10) },
  { label: 'SSP2-4.5 · MESSAGE', result: buildResult(20) },
  { label: 'SSP5-8.5 · REMIND', result: buildResult(40) },
]

const FORMAT_API: any = {
  settings: { notation: 'scientific', sigFigs: 3 },
  setSettings: vi.fn(),
  format: (v: number) => v.toExponential(2),
}

// ── ChartExpandModal chrome ──────────────────────────────────────────────────

describe('ChartExpandModal — chrome', () => {
  it('does not render when isOpen=false', () => {
    render(
      <ChartExpandModal isOpen={false} onClose={vi.fn()} title="X">
        <div>body</div>
      </ChartExpandModal>,
    )
    expect(document.body.querySelector('[data-testid="chart-expand-modal"]'))
      .toBeNull()
  })

  it('portals to document.body when isOpen=true', () => {
    render(
      <ChartExpandModal isOpen={true} onClose={vi.fn()} title="Hello">
        <div data-testid="modal-body-content">body</div>
      </ChartExpandModal>,
    )
    // Portalled — query document.body, NOT the test's container.
    expect(document.body.querySelector('[data-testid="chart-expand-modal"]'))
      .not.toBeNull()
    expect(document.body.querySelector('[data-testid="modal-body-content"]'))
      .not.toBeNull()
  })

  it('renders the title in the header', () => {
    render(
      <ChartExpandModal isOpen={true} onClose={vi.fn()} title="My chart">
        <div />
      </ChartExpandModal>,
    )
    const titleEl = document.body.querySelector('[data-testid="chart-expand-modal-title"]')
    expect(titleEl?.textContent).toBe('My chart')
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    render(
      <ChartExpandModal isOpen={true} onClose={onClose} title="X">
        <div />
      </ChartExpandModal>,
    )
    fireEvent.click(
      document.body.querySelector('[data-testid="chart-expand-modal-close"]') as HTMLElement,
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('backdrop click calls onClose; click on body does not', () => {
    const onClose = vi.fn()
    render(
      <ChartExpandModal isOpen={true} onClose={onClose} title="X">
        <div data-testid="modal-body-content">body</div>
      </ChartExpandModal>,
    )
    // Click inside the modal body — should NOT close.
    fireEvent.click(
      document.body.querySelector('[data-testid="modal-body-content"]') as HTMLElement,
    )
    expect(onClose).not.toHaveBeenCalled()
    // Click on the backdrop itself — closes.
    fireEvent.click(
      document.body.querySelector('[data-testid="chart-expand-modal-backdrop"]') as HTMLElement,
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape key calls onClose', () => {
    const onClose = vi.fn()
    render(
      <ChartExpandModal isOpen={true} onClose={onClose} title="X">
        <div />
      </ChartExpandModal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('renders the actions slot in the header', () => {
    render(
      <ChartExpandModal
        isOpen={true}
        onClose={vi.fn()}
        title="X"
        actions={<button data-testid="custom-action">Action</button>}
      >
        <div />
      </ChartExpandModal>,
    )
    expect(document.body.querySelector('[data-testid="custom-action"]'))
      .not.toBeNull()
  })
})

// ── FacetedView expand integration ───────────────────────────────────────────

describe('MultiScenarioImpactChart faceted view — expand integration', () => {
  function renderFaceted() {
    const result = render(
      <MultiScenarioImpactChart
        scenarios={SCENARIOS}
        selectedResultIdx={0}
        detailYear={null}
        format={FORMAT_API}
        cohortKeys={['BEV-LFP|Small', 'ICEV|Large']}
        cohortColorMap={{ 'BEV-LFP|Small': '#14b8a6', 'ICEV|Large': '#ef4444' }}
        filenameBase="test"
      />,
    )
    // Switch to faceted view (default is 'total'). ViewToggle exposes
    // buttons with role="tab"; find the "By cohort" tab by text.
    const tabs = Array.from(
      result.container.querySelectorAll('button[role="tab"]'),
    ) as HTMLElement[]
    const facetsBtn = tabs.find((b) => b.textContent === 'By cohort')
    if (facetsBtn) fireEvent.click(facetsBtn)
    return result
  }

  it('renders an expand button for each facet in the grid', () => {
    const { container } = renderFaceted()
    expect(container.querySelector('[data-testid="facet-expand-0"]'))
      .not.toBeNull()
    expect(container.querySelector('[data-testid="facet-expand-1"]'))
      .not.toBeNull()
    expect(container.querySelector('[data-testid="facet-expand-2"]'))
      .not.toBeNull()
  })

  it('clicking an expand button opens the modal with the correct scenario title', () => {
    const { container } = renderFaceted()
    // Click expand on the second scenario.
    fireEvent.click(
      container.querySelector('[data-testid="facet-expand-1"]') as HTMLElement,
    )
    const modal = document.body.querySelector('[data-testid="chart-expand-modal"]')
    expect(modal).not.toBeNull()
    const title = document.body.querySelector('[data-testid="chart-expand-modal-title"]')
    expect(title?.textContent).toBe('SSP2-4.5 · MESSAGE')
  })

  it('modal contains the Auto-fit Y-axis toggle (default off)', () => {
    const { container } = renderFaceted()
    fireEvent.click(
      container.querySelector('[data-testid="facet-expand-0"]') as HTMLElement,
    )
    const toggle = document.body.querySelector(
      '[data-testid="facet-expand-autofit"]',
    ) as HTMLElement
    expect(toggle).not.toBeNull()
    const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })

  it('Auto-fit toggle re-renders the modal chart when switched', () => {
    const { container } = renderFaceted()
    fireEvent.click(
      container.querySelector('[data-testid="facet-expand-0"]') as HTMLElement,
    )
    const checkbox = document.body.querySelector(
      '[data-testid="facet-expand-autofit"] input[type="checkbox"]',
    ) as HTMLInputElement
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    // The body re-renders; the body wrapper testid persists.
    expect(document.body.querySelector('[data-testid="facet-expand-body"]'))
      .not.toBeNull()
  })

  it('closing the modal returns the grid to its prior state', () => {
    const { container } = renderFaceted()
    fireEvent.click(
      container.querySelector('[data-testid="facet-expand-1"]') as HTMLElement,
    )
    expect(document.body.querySelector('[data-testid="chart-expand-modal"]'))
      .not.toBeNull()
    fireEvent.click(
      document.body.querySelector('[data-testid="chart-expand-modal-close"]') as HTMLElement,
    )
    expect(document.body.querySelector('[data-testid="chart-expand-modal"]'))
      .toBeNull()
    // Grid still rendered — expand buttons still present.
    expect(container.querySelector('[data-testid="facet-expand-1"]'))
      .not.toBeNull()
  })

  it('opening a different facet after closing shows the correct scenario', () => {
    const { container } = renderFaceted()
    // Open facet 0, close, open facet 2.
    fireEvent.click(
      container.querySelector('[data-testid="facet-expand-0"]') as HTMLElement,
    )
    fireEvent.click(
      document.body.querySelector('[data-testid="chart-expand-modal-close"]') as HTMLElement,
    )
    fireEvent.click(
      container.querySelector('[data-testid="facet-expand-2"]') as HTMLElement,
    )
    const title = document.body.querySelector('[data-testid="chart-expand-modal-title"]')
    expect(title?.textContent).toBe('SSP5-8.5 · REMIND')
  })
})
