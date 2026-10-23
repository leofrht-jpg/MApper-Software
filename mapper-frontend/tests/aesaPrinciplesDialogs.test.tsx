// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * AESA principles editor through the in-app dialogs (no native calls).
 *
 * The delete confirmation and the two validation messages used window.confirm
 * and window.alert: in the packaged WKWebView the delete never happened and the
 * messages never showed. Real PrinciplesEditor, real DialogHost, real store;
 * only updatePrinciples is a spy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { PrinciplesEditor } from '../src/components/aesa/PrinciplesEditor'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useAESAStore } from '../src/stores/aesaStore'

let updatePrinciples: ReturnType<typeof vi.fn>

const principles = [
  { id: 'EpC', name: 'Equal per capita', description: '' },
  { id: 'GDP', name: 'Economic output', description: '' },
]

beforeEach(() => {
  __resetDialogsForTests()
  updatePrinciples = vi.fn()
  useAESAStore.setState({
    draft: {
      sharing: {
        principles,
        // EpC is in use, GDP is free to delete.
        category_assignments: [{ pb_id: 'climate_change', principle_id: 'EpC' }],
        chain: { layers: [] },
      },
    },
    updatePrinciples,
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

async function renderExpanded() {
  render(<><PrinciplesEditor /><DialogHost /></>)
  await act(async () => { fireEvent.click(screen.getByText('2 principles')) })
}

const deleteButtons = () => screen.getAllByTitle(/^Delete$|^In use/) as HTMLButtonElement[]

describe('delete a principle', () => {
  it('asks in-app, and Delete removes it', async () => {
    await renderExpanded()
    const del = deleteButtons()[1] // GDP
    del.focus()
    await act(async () => { fireEvent.click(del) })
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete principle "GDP"?')
    expect(updatePrinciples).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-confirm')) })
    expect(updatePrinciples).toHaveBeenCalledWith([principles[0]])
    expect(document.activeElement).toBe(del)
  })

  it('Cancel (and Escape) leave it in place', async () => {
    await renderExpanded()
    await act(async () => { fireEvent.click(deleteButtons()[1]) })
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-cancel')) })
    await act(async () => { fireEvent.click(deleteButtons()[1]) })
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    expect(updatePrinciples).not.toHaveBeenCalled()
    expect(screen.queryByTestId('dialog')).toBeNull()
  })
})

describe('add-principle validation messages', () => {
  async function addWithId(id: string) {
    await renderExpanded()
    await act(async () => { fireEvent.click(screen.getByText('Add principle')) })
    const idInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(idInput, { target: { value: id } })
    await act(async () => { fireEvent.click(screen.getByText('Save')) })
  }

  it('a missing id shows "Principle id is required." and saves nothing', async () => {
    await addWithId('   ')
    expect(screen.getByRole('dialog', { name: 'Principle id is required.' })).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-confirm')) })
    expect(updatePrinciples).not.toHaveBeenCalled()
    expect(screen.getByText('Add principle', { selector: 'div' })).toBeInTheDocument() // edit modal still open
  })

  it('a duplicate id shows that it already exists and saves nothing', async () => {
    await addWithId('GDP')
    expect(screen.getByRole('dialog', { name: 'A principle with id "GDP" already exists.' })).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-confirm')) })
    expect(updatePrinciples).not.toHaveBeenCalled()
  })

  it('a new unique id is saved without any message', async () => {
    await addWithId('HDI')
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(updatePrinciples).toHaveBeenCalledWith([...principles, { id: 'HDI', name: 'HDI', description: '' }])
  })
})
