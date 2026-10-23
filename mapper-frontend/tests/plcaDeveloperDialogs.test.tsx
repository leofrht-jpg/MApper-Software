// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * pLCA Developer: deleting a prospective database through the in-app dialog.
 *
 * Delete asked window.confirm (always false in the packaged WKWebView, so no
 * database could be deleted) and reported a failure with window.alert (which
 * showed nothing). Real page, real DialogHost; the store actions are spies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { PLCADeveloper } from '../src/pages/PLCADeveloper'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useProjectStore } from '../src/stores/projectStore'
import type { ProspectiveDB } from '../src/api/client'

const DB: ProspectiveDB = {
  name: 'ei_premise_remind_ssp2_2030', base_db: 'ei', iam: 'remind', ssp: 'SSP2-PkBudg1150',
  year: 2030, years: [2030], mode: 'separate', created_at: '2026-04-24T09:40:07Z',
}
let deleteDatabase: ReturnType<typeof vi.fn>

beforeEach(() => {
  __resetDialogsForTests()
  deleteDatabase = vi.fn(async () => {})
  useProjectStore.setState({ databases: [], currentProject: 'p' } as never)
  usePLCAStore.setState({
    databases: [DB], isLoading: false, error: null,
    fetchScenarios: vi.fn(async () => {}),
    fetchDatabases: vi.fn(async () => {}),
    deleteDatabase,
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const openDelete = async () => {
  render(<><PLCADeveloper /><DialogHost /></>)
  await click(screen.getByTitle('Delete'))
}

describe('delete a prospective database', () => {
  it('asks in-app, and Delete removes it', async () => {
    await openDelete()
    expect(screen.getByRole('alertdialog'))
      .toHaveAccessibleName('Delete prospective database "ei_premise_remind_ssp2_2030"?')
    expect(deleteDatabase).not.toHaveBeenCalled()
    await click(screen.getByTestId('dialog-confirm'))
    expect(deleteDatabase).toHaveBeenCalledWith('ei_premise_remind_ssp2_2030')
  })

  it('Cancel keeps it', async () => {
    await openDelete()
    await click(screen.getByTestId('dialog-cancel'))
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(deleteDatabase).not.toHaveBeenCalled()
  })

  it('a failed delete shows an error toast', async () => {
    deleteDatabase.mockRejectedValue(new Error('database in use'))
    await openDelete()
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Delete failed: database in use')
  })
})
