/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * System-level Prospective: Stop on the card reaches the running task(s).
 *
 *  - a multi-DSM fan-out showed Stop (isRunning covers it) but requestStop
 *    collected only the single-run and parameter fan-out tasks, so it sent
 *    no cancel at all;
 *  - a 404 must not close the "stopping" state as if finished;
 *  - an accepted Stop shows "Stopping" on the card, then a stopped note.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useSubsystemStore } from '../src/stores/subsystemStore'

let cancelStatus = 200
let fetchSpy: ReturnType<typeof vi.fn>
const json = (status: number, body: unknown) => ({
  ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
}) as unknown as Response

const PDB = {
  name: 'ei310-remind-ssp1-base-2030', base_db: 'ecoinvent-3.10-cutoff',
  iam: 'remind', ssp: 'SSP1-Base', year: 2030, years: [2030], mode: 'separate', created_at: '2026-01-01',
}

const job = (taskId: string, extra: object = {}) =>
  ({ taskId, mode: 'projected', stage: 'running', pct: 0.3, done: false, error: null, ...extra })

beforeEach(() => {
  cancelStatus = 200
  // @ts-expect-error minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  fetchSpy = vi.fn(async (u: string) => {
    const url = String(u).split('?')[0]
    if (/\/cancel$/.test(url)) {
      return cancelStatus === 200 ? json(200, { cancelled: true }) : json(404, { detail: 'Unknown task' })
    }
    return /\/subsystems$/.test(url) ? json(200, { subsystems: [] }) : json(200, [])
  })
  vi.stubGlobal('fetch', fetchSpy)
  useDSMStore.setState({
    activeSystem: { id: 'sys', name: 'Car Fleet', time_horizon: { start_year: 2025, end_year: 2050 }, dimensions: [] },
    systemState: { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' } as any,
  } as any)
  // The panel shows an empty state without prospective databases.
  usePLCAStore.setState({ databases: [PDB], fetchDatabases: async () => {} } as any)
  useSubsystemStore.setState({ subsystems: [], fetchForSystem: async () => {} } as any)
  useImpactStore.setState({
    projectedJob: null, projectedScenarioOrder: [], projectedScenarioRuns: {},
    pairedScenarioOrder: [], pairedScenarioRuns: {},
    projectedDsmScenarioOrder: ['s1', 's2'],
    projectedDsmScenarioRuns: {
      s1: { job: job('d1'), result: null, scenarioName: 'S1' },
      s2: { job: job('d2'), result: null, scenarioName: 'S2' },
    },
  } as any)
})
afterEach(() => vi.unstubAllGlobals())

const cancelled = () => fetchSpy.mock.calls.map(([u]) => String(u)).filter((u) => u.endsWith('/cancel'))

async function renderAndStop() {
  const { ProjectedImpactPanel } = await import('../src/components/impact/ProjectedImpactPanel')
  render(<ProjectedImpactPanel />)
  await act(async () => { await new Promise((r) => setTimeout(r, 300)) }) // card reveal
  await act(async () => { fireEvent.click(screen.getByTestId('projected-impact-progress-cancel')) })
}

describe('Prospective Stop', () => {
  it('cancels every running multi-DSM task, then shows "Stopping" and a stopped end state', async () => {
    await renderAndStop()
    expect(cancelled().sort()).toEqual([
      expect.stringMatching(/\/api\/tasks\/d1\/cancel$/),
      expect.stringMatching(/\/api\/tasks\/d2\/cancel$/),
    ])
    expect(screen.getByTestId('projected-impact-progress-cancelling').textContent).toMatch(/Stopping/)

    await act(async () => {
      useImpactStore.setState({
        projectedDsmScenarioRuns: {
          s1: { job: job('d1', { done: true, cancelled: true }), result: null, scenarioName: 'S1' },
          s2: { job: job('d2', { done: true, cancelled: true }), result: null, scenarioName: 'S2' },
        },
      } as any)
    })
    expect(screen.queryByTestId('projected-impact-progress')).toBeNull()
    expect(screen.getByTestId('projected-stopped').textContent).toMatch(/Calculation stopped/)
  })

  it('a 404 while the tasks still run is not "finished": the card says Stop failed and offers it again', async () => {
    cancelStatus = 404
    await renderAndStop()
    expect(screen.getByTestId('projected-impact-progress-cancel-error').textContent).toMatch(/did not reach/)
    expect(screen.queryByTestId('projected-impact-progress-cancelling')).toBeNull()
    expect((screen.getByTestId('projected-impact-progress-cancel') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByTestId('projected-stopped')).toBeNull()
  })
})
