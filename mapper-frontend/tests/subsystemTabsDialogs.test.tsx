// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Deleting a dependent subsystem through the in-app dialog.
 *
 * The delete asked window.confirm, which answers false in the packaged
 * WKWebView, so a subsystem could never be deleted there; a failed delete was
 * an unhandled rejection. Real SubsystemTabs, real DialogHost; the store's
 * removeDependent is a spy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { SubsystemTabs } from '../src/components/subsystems/SubsystemTabs'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useDSMStore } from '../src/stores/dsmStore'
import type { Subsystem } from '../src/api/client'

const DIMS = [{ name: 'charger', display_name: 'Charger', labels: ['home', 'public'] }]
const DEP: Subsystem = {
  id: 'sub1', name: 'Fuel Infrastructure', type: 'dependent', depends_on: 'sys1',
  dimensions: DIMS, dependency_rules: [], cohort_mappings: {}, initial_stock: {},
  unit_name: 'chargers', integer_units: true,
} as Subsystem
let removeDependent: ReturnType<typeof vi.fn>

beforeEach(() => {
  __resetDialogsForTests()
  removeDependent = vi.fn(async () => {})
  useDSMStore.setState({ activeSystem: { id: 'sys1', name: 'Danish Fleet', dimensions: DIMS, time_horizon: { start_year: 2025, end_year: 2050 } } as never })
  useSubsystemStore.setState({ subsystems: [DEP] as never, activeSubsystemId: 'sub1', removeDependent } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const openDelete = async () => {
  render(<><SubsystemTabs primarySystemId="sys1" primarySystemName="Danish Fleet" /><DialogHost /></>)
  await click(screen.getByTitle('Delete subsystem'))
}

describe('delete a subsystem', () => {
  it('asks in-app, and Delete removes it', async () => {
    await openDelete()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete subsystem "Fuel Infrastructure"?')
    expect(removeDependent).not.toHaveBeenCalled()
    await click(screen.getByTestId('dialog-confirm'))
    expect(removeDependent).toHaveBeenCalledWith('sub1')
  })

  it('Cancel keeps it', async () => {
    await openDelete()
    await click(screen.getByTestId('dialog-cancel'))
    expect(removeDependent).not.toHaveBeenCalled()
  })

  it('a failed delete shows an error toast', async () => {
    removeDependent.mockRejectedValue(new Error('has dependents'))
    await openDelete()
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Delete failed: has dependents')
  })
})
