/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import { usePLCAStore } from '../src/stores/plcaStore'

// Patch 4P — elapsed-timer regression test for system-mode Static
// Background. Pre-Patch-4P bug: the timer's useEffect was keyed only
// on `isCalculatingLCA` (legacy single-task boolean). Multi-DSM
// fan-out (Patch 2E.2) and multi-parameter fan-out (Patch 2C) spawn
// parallel tasks under `staticDsmScenarioRuns` / `staticScenarioRuns`
// that don't flip `isCalculatingLCA` — so the timer stayed at "0:00"
// throughout the calculation.
//
// Fix: rewire the effect to depend on `isAnyCalculating`
// (= isCalculatingLCA || multiCalcRunning || dsmCalcRunning), the
// boolean the panel was already computing for other uses.
//
// Patch 5AL — the live elapsed counter now renders via the shared
// <ComputeProgress> card (fed by useElapsedSeconds), so the display is
// "{M:SS} elapsed" inside `data-testid="dsm-impact-progress-elapsed"`
// (was the bespoke "Elapsed: M:SS" banner). The regression intent is
// unchanged: ticks while a fan-out is in flight, absent when idle.
//
// Test strategy: stub the impactStore with a multi-DSM run-in-flight
// shape (no entry on `isCalculatingLCA`, only one job in
// `staticDsmScenarioRuns` with `done=false`), render the panel, and
// advance fake timers. Assert the elapsed display moves off "0:00".

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    exportImpact: vi.fn(),
  }
})

beforeEach(() => {
  // @ts-expect-error - jsdom stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  // Reset stores. Seed minimum state for the panel to render past its
  // "Select an DSM system first" short-circuit.
  useDSMStore.setState({
    activeSystem: {
      id: 'sys-test', name: 'Test',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      time_horizon: { start_year: 2020, end_year: 2030 } as any,
      dimensions: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    systemState: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scenarios: [{ id: 'base-1', name: 'Base', is_base: true } as any],
      active_scenario_id: 'base-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    isCalculatingLCA: false,
    simulationResult: null,
    cohortMappings: {},
    dsmLCAResults: [],
    dsmLCAWarnings: [],
    selectedResultIndex: 0,
  })
  useImpactStore.setState({
    staticScenarioOrder: [],
    staticScenarioRuns: {},
    staticDsmScenarioOrder: [],
    staticDsmScenarioRuns: {},
    activeStaticDsmScenario: null,
    activeStaticScenario: null,
  })
  usePLCAStore.setState({ databases: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DSMImpactPanel elapsed timer (Patch 4P)', () => {
  it('ticks while a multi-DSM fan-out is in flight (was stuck at 0:00 pre-fix)', async () => {
    // Stub a multi-DSM run-in-flight: two scenarios spawned, neither
    // done. `isCalculatingLCA` is false (the legacy single-task flag
    // never flips during fan-out — that's exactly the bug shape).
    useImpactStore.setState({
      staticDsmScenarioOrder: ['scen-a', 'scen-b'],
      staticDsmScenarioRuns: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'scen-a': { scenario: 'scen-a', scenarioName: 'Scen A',
          job: { taskId: 't-a', pct: 0.3, stage: 'computing', done: false } as any,
          result: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'scen-b': { scenario: 'scen-b', scenarioName: 'Scen B',
          job: { taskId: 't-b', pct: 0.0, stage: 'queued', done: false } as any,
          result: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    })

    const { DSMImpactPanel } = await import('../src/components/dsm/DSMImpactPanel')
    const { container } = render(<DSMImpactPanel />)

    // Initial render: the ComputeProgress card shows "0:00 elapsed".
    const elapsedEl = () => container.querySelector('[data-testid="dsm-impact-progress-elapsed"]')
    expect(elapsedEl()?.textContent).toContain('0:00')

    // Advance 2.5 seconds. useElapsedSeconds' interval fires at 1s and 2s →
    // elapsed updates to 1, then 2. (Date.now is also faked so the math
    // resolves deterministically against the mocked clock.)
    await act(async () => {
      vi.advanceTimersByTime(2500)
    })

    // The display should now read 0:02 (or higher), NOT 0:00.
    expect(elapsedEl()?.textContent).not.toContain('0:00')
    expect(elapsedEl()?.textContent).toMatch(/0:0[12] elapsed/)
  })

  it('ticks for multi-parameter fan-out the same way', async () => {
    // Multi-parameter axis (Patch 2C) lands in `staticScenarioRuns`,
    // not `staticDsmScenarioRuns`. Same bug class, same fix.
    useImpactStore.setState({
      staticScenarioOrder: ['Optimistic', 'Pessimistic'],
      staticScenarioRuns: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'Optimistic': { scenario: 'Optimistic',
          job: { taskId: 't-o', pct: 0.5, stage: 'computing', done: false } as any,
          result: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'Pessimistic': { scenario: 'Pessimistic',
          job: { taskId: 't-p', pct: 0.0, stage: 'queued', done: false } as any,
          result: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    })

    const { DSMImpactPanel } = await import('../src/components/dsm/DSMImpactPanel')
    const { container } = render(<DSMImpactPanel />)

    const elapsedEl = () => container.querySelector('[data-testid="dsm-impact-progress-elapsed"]')
    expect(elapsedEl()?.textContent).toContain('0:00')

    await act(async () => {
      vi.advanceTimersByTime(2500)
    })

    expect(elapsedEl()?.textContent).toMatch(/0:0[12] elapsed/)
  })

  it('does not start the timer when no task is running (idle state)', async () => {
    // Sanity: with all jobs done (or no jobs at all), the timer must
    // NOT tick. Otherwise we'd get a phantom elapsed display in idle
    // state.
    useImpactStore.setState({
      staticDsmScenarioOrder: [],
      staticDsmScenarioRuns: {},
      staticScenarioOrder: [],
      staticScenarioRuns: {},
    })

    const { DSMImpactPanel } = await import('../src/components/dsm/DSMImpactPanel')
    const { container } = render(<DSMImpactPanel />)

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    // The ComputeProgress card only renders while `isAnyCalculating` is true,
    // so in the idle state it's absent entirely (returns null).
    expect(container.querySelector('[data-testid="dsm-impact-progress"]')).toBeNull()
    expect(container.textContent).not.toMatch(/\d:\d\d elapsed/)
  })
})
