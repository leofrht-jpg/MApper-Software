/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * One list, one header.
 *
 * #171 put every impact-category list inside the shared CollapsibleBlock
 * ("IMPACT CATEGORIES · x of y selected"). Two system-level panels already had
 * their own collapsible "INDICATOR SELECTION · x of y selected" around the
 * picker, so the list carried two headers and two summaries. The LCA
 * calculator did the same with an "All indicators" heading above each of its
 * three results tables.
 *
 * The render half mounts the real panels and counts headers in the DOM, so a
 * wrapper reintroduced under any name fails here. The source half covers the
 * calculator, whose tables only exist after a computation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getMethods: vi.fn(async () => [{ family: 'EF v3.1', categories: [
      { category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: ['EF v3.1', 'climate change', 'GWP100'] }] },
      { category: 'acidification', indicators: [{ indicator: 'AE', tuple: ['EF v3.1', 'acidification', 'AE'] }] },
    ] }]),
  }
})

beforeEach(() => {
  window.localStorage.clear()
  // @ts-expect-error minimal stub; recharts needs it
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useDSMStore.setState({
    activeSystem: { id: 'sys', name: 'S', time_horizon: { start_year: 2020, end_year: 2030 }, dimensions: [] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemState: { scenarios: [{ id: 'b', name: 'Base', is_base: true } as any], active_scenario_id: 'b' } as any,
  })
  usePLCAStore.setState({
    databases: [{
      name: 'ei-remind-2030', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2', year: 2030,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      years: [2030], mode: 'separate' as any, created_at: '2026-01-01',
    }],
  })
})

function assertOneHeader(container: HTMLElement) {
  const text = container.textContent ?? ''
  expect(text).not.toMatch(/indicator selection/i)
  // The picker's block, once, and its "x of y selected" summary, once.
  expect(container.querySelectorAll('[data-testid="indicator-checklist"]')).toHaveLength(1)
  expect(text.match(/\d+ of \d+ selected/g) ?? []).toHaveLength(1)
}

describe('system-level pickers carry one header', () => {
  it('Static Background', async () => {
    const { DSMImpactPanel } = await import('../src/components/dsm/DSMImpactPanel')
    const { container, findByTestId } = render(<DSMImpactPanel />)
    await findByTestId('indicator-checklist-summary')
    assertOneHeader(container)
  })

  it('Prospective Background', async () => {
    const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
    const { container, findByTestId } = render(<ProjectedImpactPanel />)
    await findByTestId('indicator-checklist-summary')
    assertOneHeader(container)
  })
})

describe('the calculator tables carry no second heading', () => {
  it('no "All indicators" heading above a CollapsibleBlock', () => {
    const src = readFileSync('src/pages/LCACalculator.tsx', 'utf-8')
    // A comment may still describe the table; a rendered heading may not.
    expect(src).not.toMatch(/>\s*All indicators\s*</)
    expect(src.match(/<CollapsibleBlock/g) ?? []).toHaveLength(3)
  })
})
