/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Walkthrough 4: "nothing appeared for Prospective Calculate".
//
// The request is not the cause -- POST /impact/calculate answers with a task id
// in ~0.01 s (measured on MAp-test Car Fleet). The cause: the panel's running
// flag was
//     scenarioProgress ? done < total : projectedJob running || ...
// and a single-scenario run() never clears projectedScenarioOrder. So after
// one Sensitivity-cases run on this tab (its fan-out runs all done), every
// later plain Calculate read "not running": no card, no Stop.
import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import { usePLCAStore } from '../src/stores/plcaStore'

beforeEach(() => {
  // @ts-expect-error minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useDSMStore.setState({
    activeSystem: { id: 'sys', name: 'Car Fleet', time_horizon: { start_year: 2025, end_year: 2050 }, dimensions: [] },
    systemState: { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' } as any,
  } as any)
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp1-base-2030', base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind', ssp: 'SSP1-Base', year: 2030, years: [2030],
      mode: 'separate' as any, created_at: '2026-01-01',
    }],
  } as any)
})

const done = (id: string) => ({ scenario: id, job: { taskId: `t-${id}`, mode: 'projected', stage: 'done', pct: 1, done: true, error: null }, result: null })

describe('System-level Prospective: the card shows after a Sensitivity-cases run', () => {
  it('a running single Calculate is seen even with finished fan-out runs in the store', async () => {
    useImpactStore.setState({
      // left over from an earlier Sensitivity-cases run, all finished
      projectedScenarioOrder: ['Base', 'Optimistic'],
      projectedScenarioRuns: { Base: done('Base'), Optimistic: done('Optimistic') } as any,
      // the plain Calculate now in flight
      projectedJob: { taskId: 't-now', mode: 'projected', stage: 'running projected LCA', pct: 0.2, done: false, error: null },
    } as any)
    const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
    render(<ProjectedImpactPanel />)
    await act(async () => { await new Promise((r) => setTimeout(r, 300)) })
    expect(screen.getByTestId('projected-impact-progress-title').textContent).toBe('Calculating Prospective impact')
    expect(screen.getByTestId('projected-impact-progress-detail').textContent).toContain('running projected LCA')
    expect(screen.getByTestId('projected-impact-progress-cancel')).toBeTruthy()
  })

  it('and goes away when that run finishes', async () => {
    useImpactStore.setState({
      projectedScenarioOrder: ['Base'],
      projectedScenarioRuns: { Base: done('Base') } as any,
      projectedJob: { taskId: 't-now', mode: 'projected', stage: 'done', pct: 1, done: true, error: null },
    } as any)
    const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
    render(<ProjectedImpactPanel />)
    expect(screen.queryByTestId('projected-impact-progress')).toBeNull()
  })
})
