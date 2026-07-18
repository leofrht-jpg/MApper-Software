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
import { SubsystemTabs, OVERALL_ID, resolveActiveSubsystem } from '../src/components/subsystems/SubsystemTabs'
import { EditSubsystemModal } from '../src/components/subsystems/EditSubsystemModal'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useDSMStore } from '../src/stores/dsmStore'
import type { Subsystem } from '../src/api/client'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, updateSubsystem: vi.fn() }
})

const DIMS = [{ name: 'charger', display_name: 'Charger', labels: ['home', 'public'] }]

function dep(over: Partial<Subsystem> = {}): Subsystem {
  return {
    id: 'sub1', name: 'Fuel Infrastructure', type: 'dependent', depends_on: 'sys1',
    dimensions: DIMS, dependency_rules: [], cohort_mappings: {}, initial_stock: {},
    unit_name: 'chargers', integer_units: true, ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useDSMStore.setState({ activeSystem: { id: 'sys1', name: 'Danish Fleet', dimensions: DIMS, time_horizon: { start_year: 2025, end_year: 2050 } } as never })
})

describe('CHANGE 2 — primary tab label reads from system name', () => {
  beforeEach(() => {
    useSubsystemStore.setState({ subsystems: [dep()] as never, activeSubsystemId: null })
  })

  it('primary tab shows the system name (not the hardcoded "Primary system")', () => {
    const { getByText, queryByText } = render(
      <SubsystemTabs primarySystemId="sys1" primarySystemName="Danish Fleet" />,
    )
    expect(getByText('Danish Fleet')).toBeTruthy()
    expect(queryByText('Primary system')).toBeNull()
    // Subsystem tab still reads from its own name.
    expect(getByText('Fuel Infrastructure')).toBeTruthy()
  })

  it('falls back to "Main system" when the name is empty', () => {
    const { getByText } = render(<SubsystemTabs primarySystemId="sys1" primarySystemName="" />)
    expect(getByText('Main system')).toBeTruthy()
  })
})

describe('CHANGE 1 — Edit button targets the active tab', () => {
  const subs = [dep({ id: 'sub1', name: 'A' }), dep({ id: 'sub2', name: 'B' })]

  it('primary tab active (null) → edits the primary system (helper returns null)', () => {
    expect(resolveActiveSubsystem(null, subs)).toBeNull()
  })

  it('subsystem tab active → edits THAT subsystem', () => {
    expect(resolveActiveSubsystem('sub2', subs)?.id).toBe('sub2')
  })

  it('Overall tab active → edits the primary system (helper returns null)', () => {
    expect(resolveActiveSubsystem(OVERALL_ID, subs)).toBeNull()
  })

  it('unknown id → null (falls back to primary)', () => {
    expect(resolveActiveSubsystem('nope', subs)).toBeNull()
  })
})

describe('CHANGE 1 — editing a subsystem', () => {
  it('EditSubsystemModal renames the subsystem via saveDependent', async () => {
    const saveDependent = vi.fn(async (s: Subsystem) => s)
    useSubsystemStore.setState({ subsystems: [dep()] as never, saveDependent: saveDependent as never, currentSystemId: 'sys1' })
    const { getByTestId, getByText } = render(<EditSubsystemModal subsystem={dep()} onClose={() => {}} />)
    // It's the subsystem editor, not the primary system editor.
    expect(getByText('Edit subsystem')).toBeTruthy()

    const nameInput = getByTestId('edit-subsystem-name') as HTMLInputElement
    expect(nameInput.value).toBe('Fuel Infrastructure')
    await act(async () => { fireEvent.change(nameInput, { target: { value: 'Charging Infrastructure' } }) })
    await act(async () => { fireEvent.click(getByText('Save changes')) })

    await waitFor(() => expect(saveDependent).toHaveBeenCalledTimes(1))
    expect(saveDependent.mock.calls[0][0].name).toBe('Charging Infrastructure')
    expect(saveDependent.mock.calls[0][0].id).toBe('sub1')
  })
})
