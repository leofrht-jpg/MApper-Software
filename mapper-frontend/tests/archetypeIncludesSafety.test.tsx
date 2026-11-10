// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Archetype composition references survive a save from the BOM editor.
 *
 * The backend PUT used to default a missing `includes` to an empty list, and the
 * editor never sent the field, so every save wiped the references. The store
 * now attaches the active archetype's list to any save that does not mention it,
 * and the delete buttons show the server's 409 (which names the archetypes that
 * include the one being deleted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { Archetypes } from '../src/pages/Archetypes'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useBOMStore } from '../src/stores/bomStore'

const apiMock = vi.hoisted(() => ({
  updateArchetype: vi.fn(),
  createArchetype: vi.fn(),
  getArchetype: vi.fn(),
  listArchetypes: vi.fn(async () => []),
  deleteArchetype: vi.fn(),
}))

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, ...apiMock }
})

const INCLUDES = [{ archetype_id: 'batt', quantity: 450, quantity_expression: 'battery_mass' }]
const ACTIVE = {
  id: 'ev', name: 'EV A', description: null, category: null, folder: 'Vehicles',
  bom: [], includes: INCLUDES,
}

beforeEach(() => {
  __resetDialogsForTests()
  for (const m of Object.values(apiMock)) m.mockReset()
  apiMock.listArchetypes.mockResolvedValue([])
  apiMock.updateArchetype.mockResolvedValue({ ...ACTIVE })
  useBOMStore.setState({ active: ACTIVE as never, archetypes: [], error: null } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

const body = () => apiMock.updateArchetype.mock.calls[0][1] as Record<string, unknown>

describe('saveActive keeps the includes', () => {
  it('sends the active archetype\'s includes when the caller does not mention them', async () => {
    await useBOMStore.getState().saveActive({
      name: 'EV A renamed', folder: 'Vehicles', bom: [],
    })
    expect(apiMock.updateArchetype).toHaveBeenCalledTimes(1)
    expect(apiMock.updateArchetype.mock.calls[0][0]).toBe('ev')
    expect(body().includes).toEqual(INCLUDES)
  })

  it('an explicit list wins, and an explicit empty list is sent as empty', async () => {
    await useBOMStore.getState().saveActive({ name: 'EV A', bom: [], includes: [] })
    expect(body().includes).toEqual([])
    apiMock.updateArchetype.mockClear()
    const next = [{ archetype_id: 'batt2', quantity: 2 }]
    await useBOMStore.getState().saveActive({ name: 'EV A', bom: [], includes: next })
    expect(body().includes).toEqual(next)
  })

  it('sends nothing extra when the active archetype has no includes field (older server)', async () => {
    useBOMStore.setState({ active: { ...ACTIVE, includes: undefined } as never })
    await useBOMStore.getState().saveActive({ name: 'EV A', bom: [] })
    expect('includes' in body()).toBe(false)
  })
})

describe('Archetypes page', () => {
  const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }

  it('a duplicate carries the includes of the original', async () => {
    apiMock.getArchetype.mockResolvedValue({ ...ACTIVE })
    apiMock.createArchetype.mockResolvedValue({ ...ACTIVE, id: 'ev2' })
    useBOMStore.setState({
      archetypes: [{ id: 'ev', name: 'EV A', folder: null, category: '', description: '' }] as never,
      folders: [], active: null,
    } as never)
    render(<><Archetypes /><DialogHost /></>)
    await act(async () => { fireEvent.contextMenu(await screen.findByText('EV A'), { clientX: 40, clientY: 40 }) })
    await click(screen.getByText('Duplicate', { selector: 'button, button *' }))
    expect(apiMock.createArchetype).toHaveBeenCalledTimes(1)
    expect((apiMock.createArchetype.mock.calls[0][0] as Record<string, unknown>).includes).toEqual(INCLUDES)
  })

  it('the delete button in the archetype header shows a refused delete too', async () => {
    const msg = "Cannot delete 'EV A': it is included by 'Fleet' (root). Remove those references first."
    apiMock.deleteArchetype.mockRejectedValue(new Error(msg))
    useBOMStore.setState({
      archetypes: [{ id: 'ev', name: 'EV A', folder: 'Vehicles', category: '', description: '' }] as never,
      folders: ['Vehicles'], active: ACTIVE as never,
    } as never)
    render(<><Archetypes /><DialogHost /></>)
    await click(await screen.findByLabelText('Delete archetype'))
    await click(screen.getByTestId('dialog-confirm'))
    expect(apiMock.deleteArchetype).toHaveBeenCalledWith('ev')
    expect(screen.getByTestId('toast-error')).toHaveTextContent(msg)
  })

  it('a refused delete shows the server message, naming the includers', async () => {
    const msg = "Cannot delete 'Battery 1kg': it is included by 'EV A' (folder Vehicles). Remove those references first."
    apiMock.deleteArchetype.mockRejectedValue(new Error(msg))
    useBOMStore.setState({
      archetypes: [{ id: 'batt', name: 'Battery 1kg', folder: null, category: '', description: '' }] as never,
      folders: [], active: null,
    } as never)
    render(<><Archetypes /><DialogHost /></>)
    await act(async () => { fireEvent.contextMenu(await screen.findByText('Battery 1kg'), { clientX: 40, clientY: 40 }) })
    await click(screen.getByText('Delete', { selector: 'button, button *' }))
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByTestId('toast-error')).toHaveTextContent(msg)
  })
})
