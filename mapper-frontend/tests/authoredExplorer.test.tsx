/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Authored databases inside the Database Explorer, rendered as the page
// composes them (not the controls in isolation): the dropdown section, the
// per-database bar, the per-activity Edit/Delete, and the refusals that name
// the BOM rows a deletion would leave dangling.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor, within, act } from '@testing-library/react'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getDatabases: vi.fn(),
    getActivities: vi.fn(async () => ({ items: [], total: 0 })),
    getActivityDistinctValues: vi.fn(async () => ({ locations: [], units: [] })),
    getActivityDetail: vi.fn(),
    listAuthoredDatabases: vi.fn(),
    createAuthoredDatabase: vi.fn(),
    deleteAuthoredDatabase: vi.fn(),
    deleteAuthoredActivity: vi.fn(),
    reconcileAuthoredDatabases: vi.fn(async () => []),
    getPedigreeTable: vi.fn(async () => ({
      indicators: ['reliability'], factors: { reliability: [1, 1.05, 1.1, 1.2, 1.5] },
      default_basic_variance: 0.0006, convention: '',
    })),
  }
})

import * as client from '../src/api/client'
import { HttpError, type AuthoredDatabaseView } from '../src/api/client'
import { useProjectStore } from '../src/stores/projectStore'
import { useActivityStore } from '../src/stores/activityStore'
import { DatabaseExplorer } from '../src/pages/DatabaseExplorer'

const db = (name: string, records = 1) => ({ name, records, modified: '', is_prospective: false, prospective_meta: null })
const DATABASES = [db('ecoinvent-3.10-cutoff', 23000), db('biosphere3', 4709), db('mine', 1)]

const ACTIVITY = {
  code: 'abc', name: 'Boiler', reference_product: 'heat', unit: 'megajoule', location: 'DK', comment: '',
  scope: 'complete', scope_note: null, has_unfloored_exchange: false, exchanges: [],
}
const view = (state: 'in_sync' | 'pending' = 'in_sync'): AuthoredDatabaseView => ({
  database: { name: 'mine', description: '', created_at: '', updated_at: '', activities: [ACTIVITY as any] },
  status: { database: 'mine', state, detail: '' },
})

const linkRefusal = (error: string) => new HttpError(409, JSON.stringify({ detail: {
  error, message: 'Linked from BOM rows; relink or remove them first.',
  links: ['Heat pump > Boiler heat', 'District heating > Backup boiler'],
} }))

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useActivityStore.getState().reset()
  useProjectStore.setState({ projects: [], currentProject: 'P', databases: DATABASES, isLoading: false } as any)
  vi.mocked(client.getDatabases).mockResolvedValue(DATABASES as never)
  vi.mocked(client.listAuthoredDatabases).mockResolvedValue([view()])
  vi.mocked(client.getActivityDetail).mockImplementation(async (database: string, code: string) => ({
    key: `('${database}', '${code}')`, code, name: code === 'abc' ? 'Boiler' : 'steel', location: 'DK',
    unit: 'megajoule', product: 'heat', database, categories: [], exchanges: [], metadata: {},
  }) as any)
})

async function renderOn(database: string) {
  const r = render(<DatabaseExplorer />)
  await waitFor(() => expect(client.listAuthoredDatabases).toHaveBeenCalled())
  await act(async () => { useActivityStore.getState().setDatabase(database) })
  return { ...r, body: within(document.body) }
}

describe('authored databases in the Database Explorer', () => {
  it('lists authored databases in their own dropdown section', async () => {
    const { body } = await renderOn('mine')
    await waitFor(() => body.getByTestId('authored-db-bar'))
    fireEvent.click(body.getAllByText('mine')[0].closest('button')!)
    const heading = body.getByTestId('db-dropdown-authored')
    // Everything after the Authored heading is authored; biosphere3 is not there.
    const after = [...heading.parentElement!.children].slice([...heading.parentElement!.children].indexOf(heading) + 1)
    expect(after.map((e) => e.textContent)).toEqual([expect.stringContaining('mine')])
  })

  it('a technosphere or biosphere database gets no authored controls', async () => {
    const { body } = await renderOn('ecoinvent-3.10-cutoff')
    await waitFor(() => expect(client.listAuthoredDatabases).toHaveBeenCalled())
    expect(body.queryByTestId('authored-db-bar')).toBeNull()
    await act(async () => { await useActivityStore.getState().openDetail('ecoinvent-3.10-cutoff', 'x') })
    expect(body.queryByTestId('authored-activity-actions')).toBeNull()
  })

  it('a database not yet built says so and rebuilds on request', async () => {
    vi.mocked(client.listAuthoredDatabases).mockResolvedValue([view('pending')])
    const { body } = await renderOn('mine')
    await waitFor(() => body.getByTestId('authored-db-status'))
    expect(body.getByTestId('authored-db-status').textContent).toContain('Not yet built')
    vi.mocked(client.listAuthoredDatabases).mockResolvedValue([view('in_sync')])
    fireEvent.click(body.getByTestId('authored-db-rebuild'))
    await waitFor(() => expect(client.reconcileAuthoredDatabases).toHaveBeenCalled())
    await waitFor(() => expect(body.queryByTestId('authored-db-status')).toBeNull())
  })

  it('refusing to delete a linked database names the linking rows', async () => {
    vi.mocked(client.deleteAuthoredDatabase).mockRejectedValue(linkRefusal('authored_database_linked'))
    const { body } = await renderOn('mine')
    await waitFor(() => body.getByTestId('authored-db-bar'))
    fireEvent.click(body.getByTestId('authored-db-delete'))
    fireEvent.click(body.getByTestId('authored-db-delete-confirm'))
    await waitFor(() => body.getByTestId('authored-db-error-links'))
    expect(body.getByTestId('authored-db-error-links').textContent).toContain('Heat pump > Boiler heat')
    expect(body.getByTestId('authored-db-error-links').textContent).toContain('District heating > Backup boiler')
  })

  it('an authored activity can be edited, and a linked one is not deleted', async () => {
    vi.mocked(client.deleteAuthoredActivity).mockRejectedValue(linkRefusal('authored_activity_linked'))
    const { body } = await renderOn('mine')
    await waitFor(() => body.getByTestId('authored-db-bar'))
    await act(async () => { await useActivityStore.getState().openDetail('mine', 'abc') })
    await waitFor(() => body.getByTestId('authored-activity-actions'))

    fireEvent.click(body.getByTestId('authored-activity-delete'))
    fireEvent.click(body.getByTestId('authored-activity-delete-confirm'))
    await waitFor(() => body.getByTestId('authored-activity-error-links'))
    expect(client.deleteAuthoredActivity).toHaveBeenCalledWith('mine', 'abc')
    expect(body.getByTestId('authored-activity-error-links').textContent).toContain('Heat pump > Boiler heat')

    fireEvent.click(body.getByTestId('authored-activity-edit'))
    await waitFor(() => body.getByTestId('authored-editor'))
    expect((body.getByTestId('authored-name') as HTMLInputElement).value).toBe('Boiler')
  })

  it('Add activity opens an empty editor on that database', async () => {
    const { body } = await renderOn('mine')
    await waitFor(() => body.getByTestId('authored-db-bar'))
    fireEvent.click(body.getByTestId('authored-add-activity'))
    await waitFor(() => body.getByTestId('authored-editor'))
    expect((body.getByTestId('authored-name') as HTMLInputElement).value).toBe('')
    expect(body.getByTestId('authored-editor').textContent).toContain('New activity in mine')
  })

  it('creating a database refuses a name in use and selects the new one', async () => {
    vi.mocked(client.createAuthoredDatabase).mockResolvedValue({} as any)
    const { body } = await renderOn('biosphere3')
    fireEvent.click(body.getByTestId('authored-new-db-open'))
    fireEvent.change(body.getByTestId('authored-new-db-name'), { target: { value: 'biosphere3' } })
    expect(body.getByTestId('authored-new-db-create')).toBeDisabled()
    fireEvent.change(body.getByTestId('authored-new-db-name'), { target: { value: 'my flows' } })
    fireEvent.click(body.getByTestId('authored-new-db-create'))
    await waitFor(() => expect(client.createAuthoredDatabase).toHaveBeenCalledWith('my flows', ''))
    await waitFor(() => expect(useActivityStore.getState().selectedDatabase).toBe('my flows'))
    expect(body.queryByTestId('authored-new-db')).toBeNull()
  })
})
