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
import { useImpactStore } from '../src/stores/impactStore'

// Smoke test: the panel must mount without throwing. Catches temporal dead
// zone (TDZ) errors that tsc misses — e.g. a useEffect dep array referencing
// a `const` declared later in the render body. A previous regression had
// `mfaLCAResult` referenced ~120 lines before its declaration.

// Stub out the API client surface the panel calls. We only need imports to
// resolve; effects don't fire before the synchronous render-body executes.
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    exportImpact: vi.fn(),
  }
})

// jsdom doesn't implement ResizeObserver; recharts ResponsiveContainer needs it.
beforeEach(() => {
  // @ts-expect-error — minimal stub
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

// Seed the dsmStore with a minimal active system so the panels render past
// their early "Select an DSM system first." short-circuit. Tests that exercise
// the configuration card need this — pure mount-no-throw tests don't.
function seedActiveSystem() {
  useDSMStore.setState({
    activeSystem: {
      id: 'sys-test',
      name: 'Test System',
      time_horizon: { start_year: 2020, end_year: 2030 },
      dimensions: [],
    },
    systemState: {
      // Minimal shape — enough to satisfy panel reads.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scenarios: [{ id: 'base-1', name: 'Base', is_base: true } as any],
      active_scenario_id: 'base-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  })
}

// Projected panel additionally short-circuits when no prospective databases
// are loaded. Seed one minimal entry so the configuration card renders.
function seedProspectiveDB() {
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030',
      base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind',
      ssp: 'SSP2-PkBudg1150',
      year: 2030,
      years: [2030],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: 'separate' as any,
      created_at: '2026-01-01',
    }],
  })
}

describe('DSMImpactPanel — render smoke', () => {
  it('mounts without throwing (catches TDZ regressions)', async () => {
    const { DSMImpactPanel } = await import('../src/components/dsm/DSMImpactPanel')
    expect(() => render(<DSMImpactPanel />)).not.toThrow()
  })

  // Regression: the coordinate chip row was previously gated on
  // `simulationResult &&`, which hid the DSM-scenario chip on a fresh load
  // before any sim ran — leaving users no way to discover the multi-DSM
  // axis. Chip must render unconditionally.
  it('renders the DSM scenario chip even with no simulation result', async () => {
    seedActiveSystem()
    const { DSMImpactPanel } = await import('../src/components/dsm/DSMImpactPanel')
    const { getByTestId, getAllByText } = render(<DSMImpactPanel />)
    expect(getByTestId('impact-coord-chip-static')).toBeInTheDocument()
    expect(getAllByText(/DSM scenarios?/i).length).toBeGreaterThan(0)
  })

  // Diagnostic for "no scenario tab bar after multi-DSM Calculate". Seeds
  // the impact store's multi-DSM slot directly (bypassing the network) and
  // asserts the tab bar renders. Pass = render condition is sound; the
  // user-reported absence is environmental (slot not populated). Fail =
  // real frontend bug to chase.
  it('renders the multi-DSM tab bar when staticDsmScenarioRuns has multiple entries', async () => {
    seedActiveSystem()
    const fakeJob = { taskId: 't1', mode: 'static' as const, stage: 'done', pct: 1, done: true, error: null }
    useImpactStore.setState({
      staticDsmScenarioOrder: ['s1', 's2', 's3'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      staticDsmScenarioRuns: {
        s1: { scenario: 's1', scenarioName: 'SSP1', job: fakeJob, result: null },
        s2: { scenario: 's2', scenarioName: 'SSP2', job: fakeJob, result: null },
        s3: { scenario: 's3', scenarioName: 'SSP5', job: fakeJob, result: null },
      } as any,
      activeStaticDsmScenario: 's1',
    })
    const { DSMImpactPanel } = await import('../src/components/dsm/DSMImpactPanel')
    const { getByText } = render(<DSMImpactPanel />)
    expect(getByText('SSP1')).toBeInTheDocument()
    expect(getByText('SSP2')).toBeInTheDocument()
    expect(getByText('SSP5')).toBeInTheDocument()
  })
})

describe('ProjectedImpactPanel — render smoke', () => {
  it('mounts without throwing (catches TDZ regressions)', async () => {
    const { ProjectedImpactPanel } = await import(
      '../src/components/impact/ProjectedImpactPanel'
    )
    expect(() => render(<ProjectedImpactPanel />)).not.toThrow()
  })

  it('renders the DSM scenario chip even with no simulation result', async () => {
    seedActiveSystem()
    seedProspectiveDB()
    const { ProjectedImpactPanel } = await import(
      '../src/components/impact/ProjectedImpactPanel'
    )
    const { getByTestId, getAllByText } = render(<ProjectedImpactPanel />)
    expect(getByTestId('impact-coord-chip-projected')).toBeInTheDocument()
    expect(getAllByText(/DSM scenarios?/i).length).toBeGreaterThan(0)
  })
})
