/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { DependentSubsystemView } from '../src/components/subsystems/DependentSubsystemView'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useParameterStore } from '../src/stores/parameterStore'
import type { Subsystem, SimulationResult } from '../src/api/client'

// Subsystem DSM export split-button: secondary Button + scope menu (Main system
// + subsystem / Subsystem only). Disabled until a compute result exists.

const exportSubsystemDSM = vi.fn()
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, exportSubsystemDSM: (...a: unknown[]) => exportSubsystemDSM(...a) }
})

const DIMS = [{ name: 'charger', display_name: 'Charger', labels: ['home', 'public'] }]

function makeSub(over: Partial<Subsystem> = {}): Subsystem {
  return {
    id: 'sub1', name: 'Fueling Infrastructure', type: 'dependent', depends_on: 'sys1',
    dimensions: DIMS, dependency_rules: [], mode: 'rules',
    manual_inflows: {}, manual_outflows: {}, cohort_mappings: {}, initial_stock: {},
    ...over,
  }
}

const RESULT: SimulationResult = {
  system_id: 'sub1',
  years: [{ year: 2030, stock: { home: 5 }, stock_by_age: {}, inflow: { home: 5 }, outflow: {}, outflow_by_age: {} }],
  summary: { total_stock_start: 0, total_stock_end: 5, total_inflows: 5, total_outflows: 0 },
} as never

function seed(sub: Subsystem, withResult: boolean) {
  // Set DSM/params FIRST: changing activeSystem fires a cross-store subscription
  // that clears subsystemStore.subsystems (fires only on the first null→sys1
  // change). Populate subsystems LAST so that clear can't wipe the seed.
  useDSMStore.setState({ activeSystem: { id: 'sys1', name: 'Car Fleet', dimensions: DIMS, time_horizon: { start_year: 2025, end_year: 2030 } } as never })
  useParameterStore.setState({ activeSet: { id: 'Base', name: 'Base', parameters: [] } as never, activeSetId: 'Base' })
  useSubsystemStore.setState({
    currentSystemId: 'sys1',
    subsystems: [sub] as never,
    subsystemResults: (withResult ? { sub1: RESULT } : {}) as never,
    loadResult: (async () => undefined) as never,
    loadSubsystems: (async () => undefined) as never,
    isComputing: false,
    error: '',
  })
}

const view = () => <DependentSubsystemView subsystemId="sub1" activeTab="dynamics" onTabChange={() => {}} />

beforeEach(() => vi.clearAllMocks())

describe('subsystem DSM export button', () => {
  it('renders in the header as a secondary Button, disabled before compute', () => {
    seed(makeSub(), false)
    const { getByTestId, queryByTestId } = render(view())
    const btn = getByTestId('subsystem-export') as HTMLButtonElement
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.disabled).toBe(true)
    // Secondary variant (elevated bg + border) — the result-export convention.
    expect(btn.style.backgroundColor).toBe('var(--bg-elevated)')
    expect(btn.style.border).toBe('1px solid var(--border-default)')
    // Menu not open.
    expect(queryByTestId('subsystem-export-menu')).toBeNull()
  })

  it('enables after compute and the scope menu lists both scopes', () => {
    seed(makeSub(), true)
    const { getByTestId } = render(view())
    const btn = getByTestId('subsystem-export') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    act(() => { fireEvent.click(btn) })
    expect(getByTestId('subsystem-export-menu')).toBeTruthy()
    expect(getByTestId('subsystem-export-combined').textContent).toContain('Main system + subsystem')
    expect(getByTestId('subsystem-export-subsystem').textContent).toContain('Subsystem only')
  })

  it('clicking "Subsystem only" exports scope=subsystem for this system+subsystem', () => {
    seed(makeSub(), true)
    const { getByTestId } = render(view())
    act(() => { fireEvent.click(getByTestId('subsystem-export')) })
    act(() => { fireEvent.click(getByTestId('subsystem-export-subsystem')) })
    expect(exportSubsystemDSM).toHaveBeenCalledTimes(1)
    const [sysId, subId, scope, fallback] = exportSubsystemDSM.mock.calls[0]
    expect(sysId).toBe('sys1')
    expect(subId).toBe('sub1')
    expect(scope).toBe('subsystem')
    expect(fallback).toBe('Fueling_Infrastructure_DSM.xlsx')
  })

  it('clicking "Main system + subsystem" exports scope=combined with the combined filename', () => {
    seed(makeSub(), true)
    const { getByTestId } = render(view())
    act(() => { fireEvent.click(getByTestId('subsystem-export')) })
    act(() => { fireEvent.click(getByTestId('subsystem-export-combined')) })
    const [, , scope, fallback] = exportSubsystemDSM.mock.calls[0]
    expect(scope).toBe('combined')
    expect(fallback).toBe('Car_Fleet+Fueling_Infrastructure_DSM.xlsx')
  })
})
