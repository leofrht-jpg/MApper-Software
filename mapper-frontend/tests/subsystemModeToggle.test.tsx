/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { DependentSubsystemView } from '../src/components/subsystems/DependentSubsystemView'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useParameterStore } from '../src/stores/parameterStore'
import type { Subsystem } from '../src/api/client'

// CHANGE 1 — subsystem rules/flows mode selector: Dependency rules vs Manual
// inflows/outflows. Visibility-toggle (both bodies mounted), warning on switch
// when the current mode has data, persisted via saveDependent (mode field).

const updateSubsystem = vi.fn()

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, updateSubsystem: (...a: unknown[]) => updateSubsystem(...a) }
})

const DIMS = [{ name: 'charger', display_name: 'Charger', labels: ['home', 'public'] }]

function makeSub(over: Partial<Subsystem> = {}): Subsystem {
  return {
    id: 'sub1', name: 'Chargers', type: 'dependent', depends_on: 'sys1',
    dimensions: DIMS, dependency_rules: [], mode: 'rules',
    manual_inflows: {}, manual_outflows: {}, cohort_mappings: {}, initial_stock: {},
    ...over,
  }
}

function seed(sub: Subsystem) {
  useSubsystemStore.setState({
    currentSystemId: 'sys1',
    subsystems: [sub] as never,
    subsystemResults: {},
    // Neutralise mount side-effects.
    loadResult: (async () => undefined) as never,
    isComputing: false,
    error: '',
  })
  useDSMStore.setState({ activeSystem: { id: 'sys1', name: 'F', dimensions: DIMS, time_horizon: { start_year: 2025, end_year: 2030 } } as never })
  useParameterStore.setState({ activeSet: { id: 'Base', name: 'Base', parameters: [] } as never, activeSetId: 'Base' })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateSubsystem.mockImplementation(async (_s: string, _i: string, body: Subsystem) => body)
})

describe('subsystem rules/flows mode selector', () => {
  it('renders both mode bodies mounted (visibility-toggle), rules default visible', async () => {
    const sub = makeSub()
    seed(sub)
    const { getByTestId, findByTestId } = render(
      <DependentSubsystemView subsystemId="sub1" activeTab="dynamics" onTabChange={() => {}} />,
    )
    // Nudge the store so the component re-reads the seeded subsystems.
    await act(async () => { useSubsystemStore.setState({ subsystems: [sub] as never }) })
    const rulesBody = await findByTestId('subsystem-rules-body')
    const manualBody = getByTestId('subsystem-manual-body')
    // Both mounted (visibility-toggle)…
    expect(rulesBody).toBeTruthy()
    expect(manualBody).toBeTruthy()
    // …rules visible, manual hidden by default.
    expect(rulesBody.style.display).not.toBe('none')
    expect(manualBody.style.display).toBe('none')
  })

  it('switching to manual with rules present warns, then persists mode on confirm', async () => {
    seed(makeSub({
      dependency_rules: [{ id: 'r1', dependent_archetype_id: 'home', driver_filter: {}, expression: 'filtered_stock', description: null }],
    }))
    const { container, getByTestId, queryByTestId } = render(
      <DependentSubsystemView subsystemId="sub1" activeTab="dynamics" onTabChange={() => {}} />,
    )
    await act(async () => { fireEvent.click(getByTestId('subsystem-mode-manual')) })
    // Warning shown; nothing saved yet.
    expect(getByTestId('subsystem-mode-switch-warning')).toBeTruthy()
    expect(updateSubsystem).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(getByTestId('subsystem-mode-switch-confirm')) })
    await waitFor(() => expect(updateSubsystem).toHaveBeenCalledTimes(1))
    expect((updateSubsystem.mock.calls[0][2] as Subsystem).mode).toBe('manual')
    await waitFor(() => expect(queryByTestId('subsystem-mode-switch-warning')).toBeNull())
    void container
  })

  it('switching with NO data in the current mode is silent (no warning, saves directly)', async () => {
    seed(makeSub()) // rules mode, no rules, no manual data
    const { getByTestId, queryByTestId } = render(
      <DependentSubsystemView subsystemId="sub1" activeTab="dynamics" onTabChange={() => {}} />,
    )
    await act(async () => { fireEvent.click(getByTestId('subsystem-mode-manual')) })
    expect(queryByTestId('subsystem-mode-switch-warning')).toBeNull()
    await waitFor(() => expect(updateSubsystem).toHaveBeenCalledTimes(1))
    expect((updateSubsystem.mock.calls[0][2] as Subsystem).mode).toBe('manual')
  })
})
