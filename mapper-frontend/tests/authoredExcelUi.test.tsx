/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Authored databases through Excel, as the Database Explorer composes them: the header buttons,
// the two-step import dialog (validate, then confirm), and "Export to Excel" on an authored
// database. Nothing is requested until the user acts, and nothing is imported without a confirm.

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
    reconcileAuthoredDatabases: vi.fn(async () => []),
    validateAuthoredExcel: vi.fn(),
    importAuthoredExcel: vi.fn(),
    downloadAuthoredTemplate: vi.fn(),
    exportAuthoredDatabase: vi.fn(),
  }
})

import * as client from '../src/api/client'
import { HttpError, type AuthoredDatabaseView, type AuthoredExcelValidation } from '../src/api/client'
import { useProjectStore } from '../src/stores/projectStore'
import { useActivityStore } from '../src/stores/activityStore'
import { DatabaseExplorer } from '../src/pages/DatabaseExplorer'
import { Button } from '../src/components/ui/Button'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'

const db = (name: string, records = 1) => ({ name, records, modified: '', is_prospective: false, prospective_meta: null })
const DATABASES = [db('ecoinvent-3.10-cutoff', 23000), db('biosphere3', 4709), db('mine', 1)]
const view = (): AuthoredDatabaseView => ({
  database: { name: 'mine', description: '', created_at: '', updated_at: '', activities: [] },
  status: { database: 'mine', state: 'in_sync', detail: '' },
})

const GOOD: AuthoredExcelValidation = {
  ok: true, errors: [], warnings: ["Exchanges: the 'Comment' column is not supported yet and was ignored."],
  preview: {
    database: 'cathode-db', description: '', activities: 2, exchanges: 5, partial: 1, flows_resolved_by_name: 2,
    resolved_by_name: [{ row: 2, name: 'Ammonia', compartment: 'air', code: 'nh3' }, { row: 3, name: 'Carbon dioxide, fossil', compartment: 'air', code: 'co2' }],
    activity_list: [{ key: 'a1', name: 'NaNFM442 cathode', scope: 'partial', exchanges: 3 }, { key: 'a2', name: 'LATP electrolyte', scope: 'complete', exchanges: 2 }],
  },
}
const BAD: AuthoredExcelValidation = {
  ok: false, warnings: [],
  errors: [
    { sheet: 'Exchanges', row: 2, column: 'Flow code', code: 'unknown_flow', message: 'no such biosphere flow is installed in this project' },
    { sheet: 'Activities', row: 3, column: 'Scope note', code: 'scope_note_required', message: 'A partial inventory needs a scope note.' },
    { sheet: 'Database', row: null, column: null, code: 'x', message: 'file-level problem' },
  ],
  preview: { ...GOOD.preview, database: 'cathode-db' },
}

const file = new File(['x'], 'cathode.xlsx')
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

beforeEach(() => {
  vi.clearAllMocks()
  __resetDialogsForTests()
  ;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useActivityStore.getState().reset()
  useProjectStore.setState({ projects: [], currentProject: 'P', databases: DATABASES, isLoading: false } as any)
  vi.mocked(client.getDatabases).mockResolvedValue(DATABASES as never)
  vi.mocked(client.listAuthoredDatabases).mockResolvedValue([view()])
})

async function renderOn(database = 'mine') {
  const r = render(<><DatabaseExplorer /><DialogHost /></>)
  await waitFor(() => expect(client.listAuthoredDatabases).toHaveBeenCalled())
  await act(async () => { useActivityStore.getState().setDatabase(database) })
  const body = within(document.body)
  const input = () => document.querySelector('[data-testid="authored-xl-file"]') as HTMLInputElement
  const choose = async (f: File = file) => {
    Object.defineProperty(input(), 'files', { value: [f], configurable: true })
    await act(async () => { fireEvent.change(input()) })
  }
  return { ...r, body, input, choose }
}

describe('the buttons', () => {
  it('"Import from Excel" and "Download template" sit beside "New authored database", as standard secondary Buttons', async () => {
    const { body } = await renderOn()
    const ref = render(<Button variant="secondary">x</Button>)
    const refCss = (ref.container.querySelector('button') as HTMLElement).style.cssText
    const imp = body.getByTestId('authored-xl-import-open'), tpl = body.getByTestId('authored-xl-template')
    const neu = body.getByTestId('authored-new-db-open')
    expect(imp.textContent).toContain('Import from Excel')
    expect(tpl.textContent).toContain('Download template')
    expect(imp.style.cssText).toBe(refCss)                       // the primitive, no hand-rolled style
    expect(tpl.style.cssText).toBe(refCss)
    expect(imp.parentElement).toBe(neu.parentElement)
    const order = [...imp.parentElement!.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'))
    expect(order.indexOf('authored-xl-import-open')).toBeLessThan(order.indexOf('authored-new-db-open'))
  })

  it('makes no request when the page opens', async () => {
    await renderOn()
    expect(client.validateAuthoredExcel).not.toHaveBeenCalled()
    expect(client.importAuthoredExcel).not.toHaveBeenCalled()
    expect(client.downloadAuthoredTemplate).not.toHaveBeenCalled()
    expect(client.exportAuthoredDatabase).not.toHaveBeenCalled()
  })

  it('Download template makes one request, shows it is busy, and reports a failure', async () => {
    const d = deferred<void>()
    vi.mocked(client.downloadAuthoredTemplate).mockReturnValue(d.promise)
    const { body } = await renderOn()
    fireEvent.click(body.getByTestId('authored-xl-template'))
    expect(client.downloadAuthoredTemplate).toHaveBeenCalledTimes(1)
    expect(body.getByTestId('authored-xl-template')).toBeDisabled()
    await act(async () => { d.reject(new Error('offline')) })
    expect(body.getByTestId('toast-error')).toHaveTextContent('Download failed: offline')
    expect(body.getByTestId('authored-xl-template')).not.toBeDisabled()
  })

  it('"Import from Excel" opens the file picker straight from the click, with nothing in the way', async () => {
    const { body, input } = await renderOn()
    const open = vi.spyOn(input(), 'click').mockImplementation(() => {})
    fireEvent.click(body.getByTestId('authored-xl-import-open'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(body.queryByTestId('authored-xl-dialog')).toBeNull()
    expect(client.validateAuthoredExcel).not.toHaveBeenCalled()
  })
})

describe('the import dialog: validate first, confirm second', () => {
  it('shows a busy state while validating, then every error with sheet, row and column in a scrollable list', async () => {
    const d = deferred<AuthoredExcelValidation>()
    vi.mocked(client.validateAuthoredExcel).mockReturnValue(d.promise)
    const { body, choose } = await renderOn()
    await choose()
    expect(body.getByTestId('authored-xl-validating')).toHaveTextContent('Validating')
    expect(body.getByTestId('authored-xl-confirm')).toBeDisabled()
    expect(client.validateAuthoredExcel).toHaveBeenCalledWith(file)
    await act(async () => { d.resolve(BAD) })
    expect(body.queryByTestId('authored-xl-validating')).toBeNull()
    expect(body.getByTestId('authored-xl-error-count')).toHaveTextContent('3 errors: nothing can be imported')
    const items = within(body.getByTestId('authored-xl-errors')).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Exchanges, row 2, column Flow code: no such biosphere flow is installed')
    expect(items[1]).toHaveTextContent('Activities, row 3, column Scope note: A partial inventory needs a scope note.')
    expect(items[2]).toHaveTextContent('Database: file-level problem')
    const list = body.getByTestId('authored-xl-errors') as HTMLElement
    expect(list.style.overflowY).toBe('auto')
    expect(list.style.maxHeight).toBe('220px')
    expect(body.getByTestId('authored-xl-confirm')).toBeDisabled()          // errors: no confirm
    expect(client.importAuthoredExcel).not.toHaveBeenCalled()
  })

  it('a clean file shows the preview, and still imports NOTHING until Confirm is pressed', async () => {
    vi.mocked(client.validateAuthoredExcel).mockResolvedValue(GOOD)
    const { body, choose } = await renderOn()
    await choose()
    await waitFor(() => body.getByTestId('authored-xl-preview'))
    expect(body.getByTestId('authored-xl-counts')).toHaveTextContent('2 activities · 5 exchanges · 1 partial · 2 flows found by name')
    expect(body.getByTestId('authored-xl-by-name')).toHaveTextContent('row 2: Ammonia [air] → nh3')
    expect(body.getByTestId('authored-xl-warnings')).toHaveTextContent("'Comment' column is not supported yet")
    expect((body.getByTestId('authored-xl-name') as HTMLInputElement).value).toBe('cathode-db')
    expect(client.importAuthoredExcel).not.toHaveBeenCalled()               // validating is a dry run
    expect(body.getByTestId('authored-xl-confirm')).not.toBeDisabled()
  })

  it('Confirm sends one import, shows a busy state, then closes and selects the new database', async () => {
    vi.mocked(client.validateAuthoredExcel).mockResolvedValue(GOOD)
    const d = deferred<any>()
    vi.mocked(client.importAuthoredExcel).mockReturnValue(d.promise)
    const { body, choose } = await renderOn()
    await choose()
    await waitFor(() => body.getByTestId('authored-xl-preview'))
    const lists = vi.mocked(client.listAuthoredDatabases).mock.calls.length
    fireEvent.click(body.getByTestId('authored-xl-confirm'))
    fireEvent.click(body.getByTestId('authored-xl-confirm'))
    expect(client.importAuthoredExcel).toHaveBeenCalledTimes(1)
    expect(client.importAuthoredExcel).toHaveBeenCalledWith(file, undefined)
    expect(body.getByTestId('authored-xl-importing')).toHaveTextContent('Importing')
    expect(body.getByTestId('authored-xl-confirm')).toBeDisabled()
    expect(body.getByTestId('authored-xl-cancel')).toBeDisabled()
    await act(async () => { d.resolve({ database: { name: 'cathode-db' }, preview: GOOD.preview, warnings: [] }) })
    expect(body.queryByTestId('authored-xl-dialog')).toBeNull()
    await waitFor(() => expect(vi.mocked(client.listAuthoredDatabases).mock.calls.length).toBeGreaterThan(lists))
  })

  it('an edited name is re-validated with it and imported with it', async () => {
    vi.mocked(client.validateAuthoredExcel).mockResolvedValue(GOOD)
    vi.mocked(client.importAuthoredExcel).mockResolvedValue({ database: { name: 'copy' }, preview: GOOD.preview, warnings: [] } as any)
    const { body, choose } = await renderOn()
    await choose()
    await waitFor(() => body.getByTestId('authored-xl-preview'))
    fireEvent.change(body.getByTestId('authored-xl-name'), { target: { value: 'copy' } })
    await act(async () => { fireEvent.click(body.getByTestId('authored-xl-validate-again')) })
    expect(client.validateAuthoredExcel).toHaveBeenLastCalledWith(file, 'copy')
    await act(async () => { fireEvent.click(body.getByTestId('authored-xl-confirm')) })
    expect(client.importAuthoredExcel).toHaveBeenCalledWith(file, 'copy')
  })

  it('a refusal from the server (the import validates again) is shown as the same list and the dialog stays', async () => {
    vi.mocked(client.validateAuthoredExcel).mockResolvedValue(GOOD)
    vi.mocked(client.importAuthoredExcel).mockRejectedValue(new HttpError(422, JSON.stringify({ detail: {
      error: 'authored_excel_invalid', message: 'The workbook has 1 error(s), so nothing was imported.',
      errors: [BAD.errors[0]],
    } })))
    const { body, choose } = await renderOn()
    await choose()
    await waitFor(() => body.getByTestId('authored-xl-preview'))
    await act(async () => { fireEvent.click(body.getByTestId('authored-xl-confirm')) })
    expect(body.getByTestId('authored-xl-failed')).toHaveTextContent('nothing was imported')
    expect(within(body.getByTestId('authored-xl-errors')).getAllByRole('listitem')).toHaveLength(1)
    expect(body.getByTestId('authored-xl-dialog')).toBeInTheDocument()
  })

  it('a file the server rejects outright (not an xlsx) says so', async () => {
    vi.mocked(client.validateAuthoredExcel).mockRejectedValue(new HttpError(400, JSON.stringify({ detail: {
      error: 'authored_excel_rejected', message: 'This is not an Excel .xlsx workbook (it is not a valid zip file).',
    } })))
    const { body, choose } = await renderOn()
    await choose(new File(['hello'], 'notes.txt'))
    await waitFor(() => body.getByTestId('authored-xl-failed'))
    expect(body.getByTestId('authored-xl-failed')).toHaveTextContent('not an Excel .xlsx workbook')
    expect(body.getByTestId('authored-xl-confirm')).toBeDisabled()
    fireEvent.click(body.getByTestId('authored-xl-cancel'))
    expect(body.queryByTestId('authored-xl-dialog')).toBeNull()
    expect(client.importAuthoredExcel).not.toHaveBeenCalled()
  })

  it('Cancel closes the dialog and imports nothing', async () => {
    vi.mocked(client.validateAuthoredExcel).mockResolvedValue(GOOD)
    const { body, choose } = await renderOn()
    await choose()
    await waitFor(() => body.getByTestId('authored-xl-preview'))
    fireEvent.click(body.getByTestId('authored-xl-cancel'))
    expect(body.queryByTestId('authored-xl-dialog')).toBeNull()
    expect(client.importAuthoredExcel).not.toHaveBeenCalled()
  })
})

describe('Export to Excel', () => {
  it('is on an authored database, is a standard secondary Button, and exports that database', async () => {
    const { body } = await renderOn('mine')
    await waitFor(() => body.getByTestId('authored-db-bar'))
    const btn = body.getByTestId('authored-xl-export')
    const ref = render(<Button variant="secondary">x</Button>)
    expect(btn.style.cssText).toBe((ref.container.querySelector('button') as HTMLElement).style.cssText)
    const d = deferred<void>()
    vi.mocked(client.exportAuthoredDatabase).mockReturnValue(d.promise)
    fireEvent.click(btn)
    expect(client.exportAuthoredDatabase).toHaveBeenCalledWith('mine')
    expect(btn).toBeDisabled()
    await act(async () => { d.resolve() })
    expect(btn).not.toBeDisabled()
  })

  it('is not offered on a technosphere or biosphere database', async () => {
    const { body } = await renderOn('ecoinvent-3.10-cutoff')
    await waitFor(() => expect(client.listAuthoredDatabases).toHaveBeenCalled())
    expect(body.queryByTestId('authored-xl-export')).toBeNull()
  })

  it('a failed export is shown, not swallowed', async () => {
    vi.mocked(client.exportAuthoredDatabase).mockRejectedValue(new Error('disk full'))
    const { body } = await renderOn('mine')
    await waitFor(() => body.getByTestId('authored-db-bar'))
    await act(async () => { fireEvent.click(body.getByTestId('authored-xl-export')) })
    expect(body.getByTestId('toast-error')).toHaveTextContent('Export failed: disk full')
  })
})

describe('the real client calls', () => {
  it('upload with the project header and the name override; failures keep their structure', async () => {
    const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
    actual.configureProjectGuard(() => 'proj-x', () => {})
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await actual.validateAuthoredExcel(file, 'a b')
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/authored-databases/excel/validate?name=a%20b')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect(new Headers(init.headers).get('X-Mapper-Project')).toBe('proj-x')
    spy.mockResolvedValue(new Response(JSON.stringify({ detail: { error: 'authored_excel_invalid', errors: [] } }), { status: 422 }))
    const e: unknown = await actual.importAuthoredExcel(file).catch((x) => x)
    expect(actual.structuredErrorDetail(e)?.error).toBe('authored_excel_invalid')
    expect(String(spy.mock.calls[1][0])).toContain('/authored-databases/excel/import')
    actual.configureProjectGuard(() => null, () => {})
    spy.mockRestore()
  })
})
