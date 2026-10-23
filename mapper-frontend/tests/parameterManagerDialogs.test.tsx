// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Parameter manager through the in-app dialogs (no native calls).
 *
 * Every confirm / prompt / alert here was a no-op in the packaged WKWebView: a
 * sensitivity case could not be added (prompt returned null), deletes never
 * happened (confirm answered false), and an import ALWAYS merged, because
 * Cancel on the old OK/Cancel confirm meant Merge. Real ParameterManagerPanel,
 * real DialogHost, real store; only its actions are spies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ParameterManagerPanel } from '../src/components/parameters/ParameterManagerPanel'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useParameterStore } from '../src/stores/parameterStore'

const spies = {
  fetchTable: vi.fn(async () => {}),
  addScenario: vi.fn(async (_n: string, _c?: string | null) => {}),
  removeScenario: vi.fn(async (_n: string) => {}),
  removeCategory: vi.fn((_n: string) => {}),
  setParameters: vi.fn(),
  importFile: vi.fn(async (_f: File, _m?: 'replace' | 'merge') => {}),
  exportFile: vi.fn(async () => {}),
}

beforeEach(() => {
  __resetDialogsForTests()
  // The pedigree table fetch is irrelevant here; leave it pending.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  try { localStorage.setItem('mapper.param-panel-open', '1') } catch { /* ignore */ }
  for (const s of Object.values(spies)) s.mockClear()
  spies.addScenario.mockImplementation(async () => {})
  spies.exportFile.mockImplementation(async () => {})
  useParameterStore.setState({
    table: {
      parameters: {
        mass: { name: 'mass', base_value: 1, category: 'Vehicle', scenario_overrides: {} },
      },
      scenarios: ['Low'],
      categories: ['Vehicle'],
    },
    isSaving: false,
    error: null,
    ...spies,
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests(); vi.unstubAllGlobals() })

const show = () => render(<><ParameterManagerPanel /><DialogHost /></>)
const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const type = async (v: string) => {
  await act(async () => { fireEvent.change(screen.getByTestId('dialog-input'), { target: { value: v } }) })
}

describe('add a sensitivity case', () => {
  it('asks for a name, then where to start from; Start empty adds a fresh column', async () => {
    show()
    await click(screen.getByTitle('Add a sensitivity case column'))
    await type('  Optimistic ')
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Start "Optimistic" from an existing case?')
    await click(screen.getByTestId('dialog-choice-start-empty:'))
    expect(spies.addScenario).toHaveBeenCalledWith('Optimistic', null)
  })

  it('copies overrides from the existing case picked', async () => {
    show()
    await click(screen.getByTitle('Add a sensitivity case column'))
    await type('High')
    await click(screen.getByTestId('dialog-confirm'))
    await click(screen.getByTestId('dialog-choice-Low'))
    expect(spies.addScenario).toHaveBeenCalledWith('High', 'Low')
  })

  it('an invalid name is refused inside the prompt, and Cancel adds nothing', async () => {
    show()
    await click(screen.getByTitle('Add a sensitivity case column'))
    await type('Low')
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByTestId('dialog-error')).toHaveTextContent('"Low" already exists')
    await click(screen.getByTestId('dialog-cancel'))
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(spies.addScenario).not.toHaveBeenCalled()
  })

  it('Escape at the "start from" question adds nothing', async () => {
    show()
    await click(screen.getByTitle('Add a sensitivity case column'))
    await type('High')
    await click(screen.getByTestId('dialog-confirm'))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(spies.addScenario).not.toHaveBeenCalled()
  })

  it('a save failure shows an error toast', async () => {
    spies.addScenario.mockImplementation(async () => { throw new Error('disk full') })
    show()
    await click(screen.getByTitle('Add a sensitivity case column'))
    await type('High')
    await click(screen.getByTestId('dialog-confirm'))
    await click(screen.getByTestId('dialog-choice-start-empty:'))
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Add case failed: disk full')
  })
})

describe('delete a case column', () => {
  const openDelete = async () => {
    await click(screen.getByTitle('Low · click for rename / delete'))
    await click(screen.getByText('Delete column'))
  }

  it('asks in-app, and Delete removes it', async () => {
    show()
    await openDelete()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete case column "Low"?')
    expect(spies.removeScenario).not.toHaveBeenCalled()
    await click(screen.getByTestId('dialog-confirm'))
    expect(spies.removeScenario).toHaveBeenCalledWith('Low')
  })

  it('Cancel keeps it', async () => {
    show()
    await openDelete()
    await click(screen.getByTestId('dialog-cancel'))
    expect(spies.removeScenario).not.toHaveBeenCalled()
  })
})

describe('delete a category that still has parameters', () => {
  const openDelete = async () => {
    const header = screen.getByText('Vehicle').closest('div')!
    await act(async () => { fireEvent.mouseEnter(header) })
    await click(screen.getByTitle('Category actions'))
    await click(screen.getByText('Delete category'))
  }

  it('asks in-app, and Delete moves the parameters and removes the group', async () => {
    show()
    await openDelete()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete the "Vehicle" group?')
    expect(spies.removeCategory).not.toHaveBeenCalled()
    await click(screen.getByTestId('dialog-confirm'))
    expect(spies.setParameters).toHaveBeenCalledWith({
      mass: expect.objectContaining({ name: 'mass', category: null }),
    })
    expect(spies.removeCategory).toHaveBeenCalledWith('Vehicle')
  })

  it('Cancel changes nothing', async () => {
    show()
    await openDelete()
    await click(screen.getByTestId('dialog-cancel'))
    expect(spies.setParameters).not.toHaveBeenCalled()
    expect(spies.removeCategory).not.toHaveBeenCalled()
  })
})

describe('import mode', () => {
  const file = new File(['x'], 'params.xlsx')
  const pick = async () => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
  }

  it('Replace imports in replace mode', async () => {
    show()
    await pick()
    expect(screen.getByTestId('dialog')).toHaveAccessibleName('Import "params.xlsx"')
    await click(screen.getByTestId('dialog-choice-replace'))
    expect(spies.importFile).toHaveBeenCalledWith(file, 'replace')
  })

  it('Merge imports in merge mode', async () => {
    show()
    await pick()
    await click(screen.getByTestId('dialog-choice-merge'))
    expect(spies.importFile).toHaveBeenCalledWith(file, 'merge')
  })

  it('Escape and Cancel abort: no import at all (Cancel used to mean Merge)', async () => {
    show()
    await pick()
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    await pick()
    await click(screen.getByTestId('dialog-cancel'))
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(spies.importFile).not.toHaveBeenCalled()
  })
})

it('an export failure shows an error toast', async () => {
  spies.exportFile.mockImplementation(async () => { throw new Error('offline') })
  show()
  await click(screen.getByTitle('Download table as .xlsx'))
  expect(screen.getByTestId('toast-error')).toHaveTextContent('Export failed: offline')
})
