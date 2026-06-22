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

// Change 2 — the Static Background tab is Base-only: it must NOT render the
// Base/Optimistic/Pessimistic sensitivity-cases selector. Static computes one
// base-ecoinvent run (parameterSetId = Base), no fan-out.
// Change 3 — wherever the selector DOES remain (Prospective), its label is the
// canonical "Sensitivity cases" (never "Scenarios", which collides with the
// LCI Scenarios picker).

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
    systemState: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scenarios: [{ id: 'base-1', name: 'Base', is_base: true } as any],
      active_scenario_id: 'base-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  })
})

function seedProspectiveDB() {
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: 'separate' as any, created_at: '2026-01-01',
    }],
  })
}

describe('Change 2 — Static Background does not expose the sensitivity-cases selector', () => {
  it('DSMImpactPanel (Static) renders no Sensitivity cases box', async () => {
    const { DSMImpactPanel } = await import('../src/components/dsm/DSMImpactPanel')
    const { queryByText, queryAllByText } = render(<DSMImpactPanel />)
    // The sensitivity-cases label is gone entirely on Static.
    expect(queryByText(/Sensitivity cases/i)).toBeNull()
    // No Optimistic/Pessimistic checklist rows.
    expect(queryAllByText(/Optimistic|Pessimistic/i)).toHaveLength(0)
  })
})

describe('Change 3 — Prospective sensitivity-cases selector uses the canonical label', () => {
  it('ProjectedImpactPanel renders the "Sensitivity cases" label (not "Scenarios")', async () => {
    seedProspectiveDB()
    const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
    const { getByTestId } = render(<ProjectedImpactPanel />)
    const label = getByTestId('projected-sensitivity-cases-label')
    expect(label.textContent).toMatch(/Sensitivity cases/i)
    expect(label.textContent).not.toMatch(/^Scenarios/)
  })
})
