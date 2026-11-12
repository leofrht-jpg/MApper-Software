// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * The Includes editor on the archetype page.
 *
 * A vehicle archetype includes battery archetypes from another folder and scales
 * them (450 of a 1 kg battery). Every change sends the whole list through the
 * archetype update; the backend's refusals (cycle, depth, missing, duplicate) are
 * shown by the page's error line. Real page and store; only the client is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Archetypes } from '../src/pages/Archetypes'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useBOMStore } from '../src/stores/bomStore'
import { useParameterStore } from '../src/stores/parameterStore'

const apiMock = vi.hoisted(() => ({
  updateArchetype: vi.fn(),
  listArchetypes: vi.fn(),
  listFolders: vi.fn(async () => []),
  exportArchetype: vi.fn(async () => {}),
  getArchetype: vi.fn(),
}))

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, ...apiMock }
})

const row = (id: string, name: string, folder: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, name, folder, category: '', description: '', material_count: 1, unlinked_count: 0, stages: [], ...extra })

let LIST: ReturnType<typeof row>[] = []
const EV = { id: 'ev', name: 'EV A', description: null, category: null, folder: 'Vehicles', bom: [], includes: [] as unknown[] }

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const type = async (el: Element, value: string) => { await act(async () => { fireEvent.change(el, { target: { value } }) }) }
const blur = async (el: Element) => { await act(async () => { fireEvent.blur(el) }) }
const sent = () => apiMock.updateArchetype.mock.calls.at(-1)![1] as { includes?: unknown[]; quantity?: number } & Record<string, unknown>

function show(active: Record<string, unknown> = EV) {
  useBOMStore.setState({ archetypes: LIST as never, folders: [], active: active as never, error: null } as never)
  return render(<><Archetypes /><DialogHost /></>)
}

beforeEach(() => {
  __resetDialogsForTests()
  for (const m of Object.values(apiMock)) m.mockReset()
  LIST = [
    row('ev', 'EV A', 'Vehicles'),
    row('b1', 'Battery 1kg NMC', 'Batteries'),
    row('b2', 'Battery 1kg LFP', 'Batteries/Small'),
  ]
  apiMock.listArchetypes.mockImplementation(async () => LIST)
  apiMock.listFolders.mockResolvedValue([])
  apiMock.updateArchetype.mockImplementation(async (id: string, data: Record<string, unknown>) => ({ ...EV, ...data, id }))
  useParameterStore.setState({ activeSet: { parameters: [{ name: 'battery_mass', value: 450 }] } } as never)
  try { localStorage.clear() } catch { /* ignore */ }
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

describe('the picker', () => {
  it('lists every other archetype of the project, any folder, with its folder path', async () => {
    show()
    await click(screen.getByTestId('include-add'))
    expect(screen.getByTestId('include-candidate-b1')).toHaveTextContent('Battery 1kg NMC')
    expect(screen.getByTestId('include-candidate-b1')).toHaveTextContent('Batteries')
    expect(screen.getByTestId('include-candidate-b2')).toHaveTextContent('Batteries/Small')
  })

  it('never offers the archetype itself', async () => {
    show()
    await click(screen.getByTestId('include-add'))
    expect(screen.queryByTestId('include-candidate-ev')).toBeNull()
  })

  it('never offers an archetype that is already included (the server refuses duplicates)', async () => {
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 450 }] })
    await click(screen.getByTestId('include-add'))
    expect(screen.queryByTestId('include-candidate-b1')).toBeNull()
    expect(screen.getByTestId('include-candidate-b2')).toBeInTheDocument()
  })

  it('is searchable by name and by folder', async () => {
    show()
    await click(screen.getByTestId('include-add'))
    await type(screen.getByTestId('include-search'), 'lfp')
    expect(screen.queryByTestId('include-candidate-b1')).toBeNull()
    expect(screen.getByTestId('include-candidate-b2')).toBeInTheDocument()
    await type(screen.getByTestId('include-search'), 'batteries/small')
    expect(screen.getByTestId('include-candidate-b2')).toBeInTheDocument()
    await type(screen.getByTestId('include-search'), 'zzz')
    expect(screen.getByText('No archetype to include.')).toBeInTheDocument()
  })

  it('has the text-input attributes that stop the web view suggestion bubble', async () => {
    show()
    await click(screen.getByTestId('include-add'))
    const el = screen.getByTestId('include-search')
    expect(el).toHaveAttribute('autocomplete', 'off')
    expect(el).toHaveAttribute('autocapitalize', 'off')
    expect(el).toHaveAttribute('autocorrect', 'off')
    expect(el).toHaveAttribute('spellcheck', 'false')
  })
})

describe('add, edit, remove', () => {
  it('adds an include with quantity 1 and sends the whole list explicitly', async () => {
    show()
    await click(screen.getByTestId('include-add'))
    await click(screen.getByTestId('include-candidate-b1'))
    expect(apiMock.updateArchetype).toHaveBeenCalledTimes(1)
    expect(apiMock.updateArchetype.mock.calls[0][0]).toBe('ev')
    expect(sent().includes).toEqual([{ archetype_id: 'b1', quantity: 1, quantity_expression: null }])
    expect(await screen.findByTestId('include-row-0')).toHaveTextContent('Battery 1kg NMC')
  })

  it('edits the quantity (450 of a 1 kg battery) on blur and keeps the other includes', async () => {
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 1 }, { archetype_id: 'b2', quantity: 3 }] })
    const qty = screen.getByTestId('include-qty-0')
    await type(qty, '450')
    await blur(qty)
    expect(sent().includes).toEqual([
      { archetype_id: 'b1', quantity: 450, quantity_expression: null },
      { archetype_id: 'b2', quantity: 3 },
    ])
  })

  it('refuses a quantity of 0 with one line and saves nothing', async () => {
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 5 }] })
    const qty = screen.getByTestId('include-qty-0')
    await type(qty, '0')
    await blur(qty)
    expect(screen.getByTestId('include-error-0')).toHaveTextContent('The quantity must be above 0.')
    expect(apiMock.updateArchetype).not.toHaveBeenCalled()
  })

  it('edits the expression: resolves it in the parameter context and sends both', async () => {
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 1 }] })
    const expr = screen.getByTestId('include-expr-0')
    await type(expr, 'battery_mass')
    await blur(expr)
    expect(sent().includes).toEqual([{ archetype_id: 'b1', quantity: 450, quantity_expression: 'battery_mass' }])
  })

  it('an unknown parameter in the expression is one line and saves nothing', async () => {
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 1 }] })
    const expr = screen.getByTestId('include-expr-0')
    await type(expr, 'no_such_param')
    await blur(expr)
    expect(screen.getByTestId('include-error-0').textContent).toMatch(/^Expression: /)
    expect(apiMock.updateArchetype).not.toHaveBeenCalled()
  })

  it('clearing the expression goes back to the typed quantity', async () => {
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 450, quantity_expression: 'battery_mass' }] })
    await type(screen.getByTestId('include-expr-0'), '')
    await blur(screen.getByTestId('include-expr-0'))
    expect(sent().includes).toEqual([{ archetype_id: 'b1', quantity: 450, quantity_expression: null }])
  })

  it('removes an include with the Delete template and sends an explicit empty list', async () => {
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 450 }] })
    const remove = screen.getByTestId('include-remove-0')
    expect(remove).toHaveAttribute('aria-label', 'Remove Battery 1kg NMC')
    await click(remove)
    expect(sent().includes).toEqual([])
  })

  it('explains the quantity and the stage prefix in two sentences behind the (i)', async () => {
    show()
    expect(screen.queryByText(/Child::Stage/)).toBeNull()
    await click(screen.getByTestId('includes-info'))
    expect(screen.getByText(/450 kg/)).toHaveTextContent('1 kg battery archetype with quantity 450 gives 450 kg')
    expect(screen.getByText(/Child::Stage/)).toBeInTheDocument()
  })
})

describe('a second commit while the first is saving', () => {
  it('Enter then blur on the expression, and a repeated blur on the quantity, save once', async () => {
    let finish!: () => void
    apiMock.updateArchetype.mockImplementationOnce(() => new Promise((res) => { finish = () => res({ ...EV, includes: [] }) }))
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 1 }] })
    const expr = screen.getByTestId('include-expr-0')
    await type(expr, 'battery_mass')
    await act(async () => { fireEvent.keyDown(expr, { key: 'Enter' }) })
    await act(async () => { fireEvent.blur(expr) })           // what an engine sends when the field is disabled
    await act(async () => { fireEvent.blur(expr) })
    expect(apiMock.updateArchetype).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
  })

  // Unlike the folder rename, this editor's props come from the store, which re-renders in the same
  // microtask as the save, so a late blur sees the new quantity and does nothing. Kept as a regression test.
  it('a blur right after the save resolves, before React has rendered it: still once', async () => {
    let finish!: () => void
    apiMock.updateArchetype.mockImplementationOnce((id: string, data: Record<string, unknown>) => new Promise((res) => {
      finish = () => res({ ...EV, ...data, id })
    }))
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 1 }] })
    const qty = screen.getByTestId('include-qty-0')
    await type(qty, '450')
    await blur(qty)
    expect(apiMock.updateArchetype).toHaveBeenCalledTimes(1)

    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    env.IS_REACT_ACT_ENVIRONMENT = false
    try {
      finish()
      for (let i = 0; i < 500; i++) await Promise.resolve()  // the save is over, React has not rendered it
      fireEvent.blur(qty)                                     // the old handler, still comparing with the old quantity
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true
    }
    expect(apiMock.updateArchetype).toHaveBeenCalledTimes(1)
    await act(async () => {})
  })

  it('a save that fails can be tried again', async () => {
    apiMock.updateArchetype.mockRejectedValueOnce(new Error('cycle'))
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 1 }] })
    const qty = screen.getByTestId('include-qty-0')
    await type(qty, '450')
    await blur(qty)
    await screen.findByText('cycle')
    expect(apiMock.updateArchetype).toHaveBeenCalledTimes(1)
    await blur(screen.getByTestId('include-qty-0'))
    await waitFor(() => expect(apiMock.updateArchetype).toHaveBeenCalledTimes(2))
  })
})

describe('errors from the server', () => {
  it.each([
    ['cycle', 'Archetype include cycle: ev -> b1 -> ev'],
    ['depth', 'Archetype includes nested deeper than MAX_INCLUDE_DEPTH=4: a -> b -> c -> d -> e'],
    ['missing', "Archetype 'EV A' includes archetype id 'gone', which does not exist in this project."],
    ['duplicate', "Archetype 'EV A' includes 'Battery 1kg NMC' more than once. Include it once and set the quantity instead."],
  ])('shows the %s message in the page error line', async (_name, message) => {
    apiMock.updateArchetype.mockRejectedValue(new Error(message))
    show()
    await click(screen.getByTestId('include-add'))
    await click(screen.getByTestId('include-candidate-b1'))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})

describe('composition on the page', () => {
  it('a save from the BOM editor after adding an include still sends the includes', async () => {
    show()
    await click(screen.getByTestId('include-add'))
    await click(screen.getByTestId('include-candidate-b1'))
    await screen.findByTestId('include-row-0')
    apiMock.updateArchetype.mockClear()
    await act(async () => {
      await useBOMStore.getState().saveActive({ name: 'EV A renamed', folder: 'Vehicles', bom: [] })
    })
    expect(sent().includes).toEqual([{ archetype_id: 'b1', quantity: 1, quantity_expression: null }])
  })

  it('a dangling include shows a one-line warning on its row', async () => {
    show({ ...EV, includes: [{ archetype_id: 'gone', quantity: 2 }] })
    expect(screen.getByTestId('include-name-0')).toHaveTextContent('Missing archetype')
    expect(screen.getByTestId('include-dangling-0')).toHaveTextContent('This archetype no longer exists. Remove this include.')
    // It can be removed like any other row.
    await click(screen.getByTestId('include-remove-0'))
    expect(sent().includes).toEqual([])
  })

  it('an include that resolves shows no warning', async () => {
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 2 }] })
    expect(screen.queryByTestId('include-dangling-0')).toBeNull()
  })

  it('the list shows "includes N", "used by N" and a warning marker for a dangling include', async () => {
    LIST = [
      row('ev', 'EV A', null, { includes_count: 2, dangling_includes: 1 }),
      row('b1', 'Battery 1kg NMC', null, { included_by_count: 3 }),
      row('plain', 'Plain', null),
    ]
    show()
    expect(await screen.findByTestId('arc-includes-ev')).toHaveTextContent('includes 2')
    expect(screen.getByTestId('arc-dangling-ev')).toBeInTheDocument()
    expect(screen.getByTestId('arc-used-by-b1')).toHaveTextContent('used by 3')
    expect(screen.queryByTestId('arc-includes-plain')).toBeNull()
    expect(screen.queryByTestId('arc-used-by-plain')).toBeNull()
  })

  it('exporting a composed archetype says includes are not exported yet and sends nothing', async () => {
    show({ ...EV, includes: [{ archetype_id: 'b1', quantity: 2 }] })
    await click(screen.getByLabelText('Export archetype'))
    expect(await screen.findByText('Includes are not exported to Excel yet.')).toBeInTheDocument()
    expect(apiMock.exportArchetype).not.toHaveBeenCalled()
  })

  it('exporting a plain archetype still exports', async () => {
    show()
    await click(screen.getByLabelText('Export archetype'))
    await waitFor(() => expect(apiMock.exportArchetype).toHaveBeenCalledTimes(1))
  })
})
