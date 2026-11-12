/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, act, waitFor, within } from '@testing-library/react'
import { useBOMStore } from '../src/stores/bomStore'
import { Archetypes } from '../src/pages/Archetypes'

// BUG (CASE C): folder "Rename folder" existed in the "..." menu and the
// backend route existed, but the handler used window.prompt() — a no-op in the
// Tauri WKWebView desktop app, so rename silently did nothing there. Fix:
// inline editable input. These tests lock in the inline-rename flow (confirm
// calls the API + updates the label; Escape reverts with no API call).

const renameFolder = vi.fn()
const listArchetypes = vi.fn()
const listFolders = vi.fn()

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    listArchetypes: (...a: unknown[]) => listArchetypes(...a),
    listFolders: (...a: unknown[]) => listFolders(...a),
    renameFolder: (...a: unknown[]) => renameFolder(...a),
    getArchetype: vi.fn(async () => null),
  }
})

const ARCS = [
  { id: 'a1', name: 'Sedan', folder: 'Cars', category: '', description: '' },
]

beforeEach(() => {
  vi.clearAllMocks()
  listArchetypes.mockResolvedValue(ARCS)
  listFolders.mockResolvedValue(['Cars', 'Charging Infrastructures'])
  // Default: rename succeeds and returns the post-rename folder set.
  renameFolder.mockResolvedValue({ renamed: 1, folders: ['Vehicles', 'Charging Infrastructures'] })
  useBOMStore.setState({
    archetypes: ARCS as never,
    folders: ['Cars', 'Charging Infrastructures'],
    active: null,
    isLoading: false,
    error: null,
  })
})

async function openFolderRename(container: HTMLElement, leafName = 'Cars') {
  // Find the folder row whose OWN label (direct span) is `leafName`, and click
  // its "..." (Folder actions) button.
  const actionBtn = await waitFor(() => {
    const rows = Array.from(container.querySelectorAll('div')).filter((d) => {
      const span = Array.from(d.children).find(
        (c) => c.tagName === 'SPAN' && c.textContent === leafName,
      )
      return span && d.querySelector(':scope > button[title="Folder actions"]')
    })
    const btn = rows[0]?.querySelector(':scope > button[title="Folder actions"]') as HTMLButtonElement
    if (!btn) throw new Error(`folder actions button for "${leafName}" not found`)
    return btn
  })
  await act(async () => { fireEvent.click(actionBtn) })
  // Click the "Rename folder" menu item.
  const renameItem = await waitFor(() => {
    const el = Array.from(document.querySelectorAll('*')).find(
      (n) => n.textContent === 'Rename folder' && n.children.length <= 2,
    )
    if (!el) throw new Error('Rename folder menu item not found')
    return el as HTMLElement
  })
  await act(async () => { fireEvent.click(renameItem) })
}

describe('archetype folder inline rename', () => {
  it('rename → type → Enter: calls the API with (oldPath,newPath) and updates the label', async () => {
    const { container } = render(<Archetypes />)
    await openFolderRename(container)

    const input = await waitFor(() =>
      container.querySelector('[data-testid="folder-rename-input"]') as HTMLInputElement,
    )
    expect(input).toBeTruthy()
    expect(input.value).toBe('Cars') // leaf segment prefilled

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Vehicles' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    await waitFor(() => expect(renameFolder).toHaveBeenCalledTimes(1))
    expect(renameFolder).toHaveBeenCalledWith('Cars', 'Vehicles')

    // Store folders updated from the API response → label reflects the new name.
    await waitFor(() => {
      expect(useBOMStore.getState().folders).toContain('Vehicles')
      expect(container.textContent).toContain('Vehicles')
    })
  })

  describe('a second commit while the first is saving', () => {
    /** An API call the test settles by hand. */
    function holdRename() {
      let finish!: (v: unknown) => void
      let fail!: (e: Error) => void
      renameFolder.mockImplementationOnce(() => new Promise((res, rej) => { finish = res; fail = rej }))
      return { finish: (v: unknown) => finish(v), fail: (e: Error) => fail(e) }
    }
    async function typeNewName(container: HTMLElement) {
      await openFolderRename(container)
      const input = await waitFor(() => container.querySelector('[data-testid="folder-rename-input"]') as HTMLInputElement)
      await act(async () => { fireEvent.change(input, { target: { value: 'Vehicles' } }) })
      return input
    }

    it('Enter, then a blur while the API is pending: the API is called exactly once', async () => {
      const held = holdRename()
      const { container } = render(<Archetypes />)
      const input = await typeNewName(container)
      await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
      await act(async () => { fireEvent.blur(input) })      // what an engine sends when the input becomes disabled
      await act(async () => { fireEvent.blur(input) })      // and again: any repeat is ignored
      expect(renameFolder).toHaveBeenCalledTimes(1)
      await act(async () => { held.finish({ renamed: 1, folders: ['Vehicles', 'Charging Infrastructures'] }) })
      await waitFor(() => expect(useBOMStore.getState().folders).toContain('Vehicles'))
      expect(renameFolder).toHaveBeenCalledTimes(1)
    })

    it('Enter and blur in the same tick (before React re-renders): still once', async () => {
      const held = holdRename()
      const { container } = render(<Archetypes />)
      const input = await typeNewName(container)
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' })
        fireEvent.blur(input)
      })
      expect(renameFolder).toHaveBeenCalledTimes(1)
      await act(async () => { held.finish({ renamed: 1, folders: ['Vehicles'] }) })
    })

    it('a rename that fails shows why and can be retried, by Enter and by blur', async () => {
      const held = holdRename()
      const { container } = render(<Archetypes />)
      const input = await typeNewName(container)
      await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
      await act(async () => { held.fail(new Error('folder is locked')) })
      await waitFor(() => expect(container.querySelector('[data-testid="folder-rename-input"]')!.getAttribute('title')).toBe('folder is locked'))
      expect(renameFolder).toHaveBeenCalledTimes(1)

      const again = container.querySelector('[data-testid="folder-rename-input"]') as HTMLInputElement
      expect(again.disabled).toBe(false)                      // editable again
      await act(async () => { fireEvent.keyDown(again, { key: 'Enter' }) })   // retry by Enter: the default mock succeeds
      await waitFor(() => expect(renameFolder).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(useBOMStore.getState().folders).toContain('Vehicles'))
    })

    it('a failed rename can also be retried by leaving the field', async () => {
      const held = holdRename()
      const { container } = render(<Archetypes />)
      const input = await typeNewName(container)
      await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
      await act(async () => { held.fail(new Error('folder is locked')) })
      await waitFor(() => expect(container.querySelector('[data-testid="folder-rename-input"]')!.getAttribute('title')).toBe('folder is locked'))
      await act(async () => { fireEvent.blur(container.querySelector('[data-testid="folder-rename-input"]')!) })
      await waitFor(() => expect(renameFolder).toHaveBeenCalledTimes(2))
    })
  })

  it('Escape during rename reverts the label and makes NO API call', async () => {
    const { container } = render(<Archetypes />)
    await openFolderRename(container)

    const input = await waitFor(() =>
      container.querySelector('[data-testid="folder-rename-input"]') as HTMLInputElement,
    )
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Vehicles' } })
      fireEvent.keyDown(input, { key: 'Escape' })
    })

    // Input gone, original label back, no API call.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="folder-rename-input"]')).toBeNull(),
    )
    expect(renameFolder).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Cars')
  })

  it('a nested folder rename reconstructs the full path (parent preserved)', async () => {
    // Pre-expand "Cars" so the child "Electric" row renders without a toggle click.
    localStorage.setItem('mapper.archetype-folder-expansion', JSON.stringify(['Cars']))
    listFolders.mockResolvedValue(['Cars/Electric', 'Charging Infrastructures'])
    useBOMStore.setState({ folders: ['Cars/Electric', 'Charging Infrastructures'] })
    const { container } = render(<Archetypes />)
    await openFolderRename(container, 'Electric')

    const input = await waitFor(() =>
      container.querySelector('[data-testid="folder-rename-input"]') as HTMLInputElement,
    )
    expect(input.value).toBe('Electric') // leaf only
    await act(async () => {
      fireEvent.change(input, { target: { value: 'EV' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await waitFor(() => expect(renameFolder).toHaveBeenCalledWith('Cars/Electric', 'Cars/EV'))
    void within
  })
})
