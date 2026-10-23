// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Archetypes page through the in-app dialogs (no native calls).
 *
 * Every delete, the new-folder and new-stage prompts, and every failure message
 * used window.confirm / prompt / alert, which do nothing in the packaged
 * WKWebView. The riskiest site is the context-menu delete: the menu closes on
 * click, so the dialog must work after the menu (and the button that had
 * focus) is gone. Real page, real DialogHost; store actions are spies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Archetypes } from '../src/pages/Archetypes'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useBOMStore } from '../src/stores/bomStore'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, getArchetype: vi.fn(async () => null) }
})

const ARCS = [{ id: 'a1', name: 'Sedan', folder: 'Cars', category: '', description: '' }]
const spies = {
  fetchArchetypes: vi.fn(async () => {}),
  removeArchetype: vi.fn(async (_id: string) => {}),
  deleteFolder: vi.fn(async (_p: string, _d?: boolean) => {}),
  createFolder: vi.fn(async (_p: string) => {}),
  moveArchetype: vi.fn(async (_id: string, _f: string | null) => {}),
}

beforeEach(() => {
  __resetDialogsForTests()
  for (const s of Object.values(spies)) s.mockReset().mockResolvedValue(undefined as never)
  try { localStorage.clear() } catch { /* ignore */ }
  useBOMStore.setState({
    archetypes: ARCS as never,
    folders: ['Cars'],
    active: null,
    isLoading: false,
    error: null,
    ...spies,
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const show = () => render(<><Archetypes /><DialogHost /></>)

/** Expand "Cars" if the Sedan row is not visible yet, and return the row label. */
async function sedanRow(): Promise<HTMLElement> {
  if (!screen.queryByText('Sedan')) await click(screen.getByText('Cars'))
  return await screen.findByText('Sedan')
}
async function openArcMenu() {
  const row = await sedanRow()
  await act(async () => { fireEvent.contextMenu(row, { clientX: 40, clientY: 40 }) })
}
async function openFolderMenu() {
  await act(async () => { fireEvent.contextMenu(screen.getByText('Cars'), { clientX: 40, clientY: 40 }) })
}
const menuItem = (label: string) => screen.getByText(label, { selector: 'button, button *' })

describe('delete an archetype from the context menu', () => {
  it('works after the menu has closed, and focus lands somewhere sane', async () => {
    show()
    await openArcMenu()
    const del = menuItem('Delete')
    ;(del.closest('button') as HTMLButtonElement).focus()
    await click(del)
    // The menu is gone (its other items with it) but the dialog is up.
    expect(screen.queryByText('Move to folder…')).toBeNull()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete "Sedan"?')
    expect(spies.removeArchetype).not.toHaveBeenCalled()
    await click(screen.getByTestId('dialog-confirm'))
    expect(spies.removeArchetype).toHaveBeenCalledWith('a1')
    // The menu button that had focus no longer exists; focus must not be left
    // on a detached node.
    expect((document.activeElement as HTMLElement).isConnected).toBe(true)
  })

  it('Cancel deletes nothing', async () => {
    show()
    await openArcMenu()
    await click(menuItem('Delete'))
    await click(screen.getByTestId('dialog-cancel'))
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(spies.removeArchetype).not.toHaveBeenCalled()
  })

  it('a failed delete shows an error toast', async () => {
    spies.removeArchetype.mockRejectedValue(new Error('locked'))
    show()
    await openArcMenu()
    await click(menuItem('Delete'))
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Delete failed: locked')
  })
})

describe('delete a folder with contents', () => {
  it('asks in-app, and Delete removes the folder and its archetypes', async () => {
    show()
    await openFolderMenu()
    await click(menuItem('Delete folder'))
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete folder "Cars" and all its contents?')
    await click(screen.getByTestId('dialog-confirm'))
    expect(spies.deleteFolder).toHaveBeenCalledWith('Cars', true)
  })

  it('Cancel keeps it', async () => {
    show()
    await openFolderMenu()
    await click(menuItem('Delete folder'))
    await click(screen.getByTestId('dialog-cancel'))
    expect(spies.deleteFolder).not.toHaveBeenCalled()
  })
})

describe('new subfolder', () => {
  it('an invalid path is refused inside the prompt; a valid one is created', async () => {
    show()
    await openFolderMenu()
    await click(menuItem('New subfolder'))
    const input = screen.getByTestId('dialog-input') as HTMLInputElement
    expect(input.value).toBe('Cars/')
    await act(async () => { fireEvent.change(input, { target: { value: 'Cars/bad*name' } }) })
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByTestId('dialog-error')).toHaveTextContent('Invalid segment "bad*name"')
    expect(spies.createFolder).not.toHaveBeenCalled()
    await act(async () => { fireEvent.change(input, { target: { value: 'Cars/Electric' } }) })
    await click(screen.getByTestId('dialog-confirm'))
    expect(spies.createFolder).toHaveBeenCalledWith('Cars/Electric')
  })

  it('Cancel creates nothing', async () => {
    show()
    await openFolderMenu()
    await click(menuItem('New subfolder'))
    await click(screen.getByTestId('dialog-cancel'))
    expect(spies.createFolder).not.toHaveBeenCalled()
  })
})

describe('moving an archetype', () => {
  it('a failed drag-and-drop move shows an error toast and re-reads the tree', async () => {
    spies.moveArchetype.mockRejectedValue(new Error('target gone'))
    show()
    await sedanRow()
    const fetchesBefore = spies.fetchArchetypes.mock.calls.length
    const dataTransfer = { getData: () => 'a1', dropEffect: 'move' }
    await act(async () => { fireEvent.drop(screen.getByText('Cars'), { dataTransfer }) })
    await waitFor(() => expect(screen.getByTestId('toast-error')).toHaveTextContent('Move failed: target gone'))
    expect(spies.moveArchetype).toHaveBeenCalledWith('a1', 'Cars')
    expect(spies.fetchArchetypes.mock.calls.length).toBeGreaterThan(fetchesBefore)
  })

  it('an invalid custom folder in the move dialog shows an inline message and moves nothing', async () => {
    show()
    await openArcMenu()
    await click(menuItem('Move to folder…'))
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Or type a new folder path…'), { target: { value: 'bad*name' } })
    })
    await click(screen.getByText('Move here'))
    expect(screen.getByTestId('folder-picker-error')).toHaveTextContent('Invalid segment "bad*name"')
    expect(spies.moveArchetype).not.toHaveBeenCalled()
    expect(screen.queryByTestId('dialog')).toBeNull()
  })
})
