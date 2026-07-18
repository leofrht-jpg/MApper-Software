/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'

// Prospective Background: the "Calculate" button was moved from an inline
// left-aligned row (next to Sensitivity cases) to a footer action area at the
// bottom-right of the Configuration card — BELOW all configuration sections
// (incl. Sensitivity cases), matching the Static tab. Layout only.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, exportImpact: vi.fn() }
})

beforeEach(() => {
  // @ts-expect-error — minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useDSMStore.setState({
    activeSystem: {
      id: 'sys-test', name: 'Test System',
      time_horizon: { start_year: 2020, end_year: 2030 }, dimensions: [],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemState: { scenarios: [{ id: 'base-1', name: 'Base', is_base: true } as any], active_scenario_id: 'base-1' } as any,
  })
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: 'separate' as any, created_at: '2026-01-01',
    }],
  })
})

describe('Prospective Calculate button position', () => {
  it('renders the Calculate button in a bottom-right footer, AFTER Sensitivity cases', async () => {
    const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
    const { getByTestId } = render(<ProjectedImpactPanel />)

    const sensitivity = getByTestId('projected-sensitivity-cases-label')
    const footer = getByTestId('projected-calculate-footer')

    // Footer holds the Calculate button…
    expect(footer.textContent).toMatch(/Calculate/i)
    // …is right-aligned…
    expect((footer as HTMLElement).style.justifyContent).toBe('flex-end')
    // …and comes AFTER the Sensitivity cases section in DOM order.
    const rel = sensitivity.compareDocumentPosition(footer)
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
