// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * A modal must survive a mid-edit mouse press and a dialog stacked on top.
 *
 * Seen in a walk: the parameters panel's "Add parameter" window closed several
 * times while a capital letter in the name was being fixed. The cause: a press
 * that starts in the Name field (selecting the letter) and is released over
 * the dark backdrop makes the browser fire `click` on the backdrop itself, the
 * common ancestor of press and release, and the backdrop closed the modal.
 * Second half: a dialog stacked above a modal must own the keyboard, so Enter
 * or Escape meant for the dialog never reaches the modal's own listener even
 * when focus was left on the modal. Real panel, real DialogHost.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ParameterManagerPanel } from '../src/components/parameters/ParameterManagerPanel'
import { DialogHost, __resetDialogsForTests, messageDialog, isDialogOpen } from '../src/components/ui/dialogs'
import { useParameterStore } from '../src/stores/parameterStore'

const upsertParameter = vi.fn()

beforeEach(() => {
  __resetDialogsForTests()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  try { localStorage.setItem('mapper.param-panel-open', '1') } catch { /* ignore */ }
  upsertParameter.mockClear()
  useParameterStore.setState({
    table: { parameters: {}, scenarios: [], categories: [] },
    isSaving: false, error: null,
    fetchTable: vi.fn(async () => {}), upsertParameter,
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests(); vi.unstubAllGlobals() })

const nameInput = () => document.querySelector('input[placeholder="e.g. battery_mass_lfp"]') as HTMLInputElement | null
const modalOpen = () => nameInput() !== null

async function openAddParameter() {
  render(<><ParameterManagerPanel /><DialogHost /></>)
  await act(async () => { fireEvent.click(screen.getAllByText('Add parameter')[0].closest('button')!) })
  expect(modalOpen()).toBe(true)
}
const submitButton = () => screen.getAllByText('Add parameter').at(-1)!.closest('button')!

describe('the Add parameter modal', () => {
  it('a capital letter is refused inline, naming the rule, and the modal stays', async () => {
    await openAddParameter()
    await act(async () => { fireEvent.change(nameInput()!, { target: { value: 'Battery_mass' } }) })
    await act(async () => { fireEvent.click(submitButton()) })
    expect(modalOpen()).toBe(true)
    expect(document.body.textContent).toMatch(/lowercase letters, digits, underscores/)
    expect(upsertParameter).not.toHaveBeenCalled()
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('a press in the Name field released over the backdrop does NOT close it', async () => {
    await openAddParameter()
    await act(async () => { fireEvent.change(nameInput()!, { target: { value: 'Battery' } }) })
    const backdrop = screen.getByTestId('add-parameter-backdrop')
    // What a browser does for a drag-select ending outside the panel: the
    // click lands on the common ancestor of press and release.
    await act(async () => {
      fireEvent.mouseDown(nameInput()!)
      fireEvent.mouseUp(backdrop)
      fireEvent.click(backdrop)
    })
    expect(modalOpen()).toBe(true)
    expect(nameInput()!.value).toBe('Battery')
  })

  it('a real click on the backdrop still closes it', async () => {
    await openAddParameter()
    const backdrop = screen.getByTestId('add-parameter-backdrop')
    await act(async () => { fireEvent.mouseDown(backdrop); fireEvent.mouseUp(backdrop); fireEvent.click(backdrop) })
    expect(modalOpen()).toBe(false)
  })
})

describe('a dialog stacked on the modal owns the keyboard and the clicks', () => {
  async function stackDialog() {
    await openAddParameter()
    await act(async () => { fireEvent.change(nameInput()!, { target: { value: 'battery' } }) })
    act(() => { void messageDialog({ title: 'Something to acknowledge' }) })
    expect(screen.getByTestId('dialog')).toBeInTheDocument()
  }

  it.each(['Enter', 'Escape'])('%s on the dialog closes the dialog only', async (key) => {
    await stackDialog()
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key }) })
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(modalOpen()).toBe(true)
    expect(upsertParameter).not.toHaveBeenCalled()
  })

  it('a click on the dialog backdrop closes the dialog only', async () => {
    await stackDialog()
    const top = screen.getByTestId('dialog-backdrop')
    await act(async () => { fireEvent.mouseDown(top); fireEvent.mouseUp(top); fireEvent.click(top) })
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(modalOpen()).toBe(true)
  })

  it('Escape with focus left on the modal underneath goes to the dialog, not the modal', async () => {
    await stackDialog()
    await act(async () => { fireEvent.keyDown(nameInput()!, { key: 'Escape' }) })
    expect(modalOpen()).toBe(true)
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('Enter with focus left on the modal does nothing: no submit, dialog stays', async () => {
    await stackDialog()
    await act(async () => { fireEvent.keyDown(submitButton(), { key: 'Enter' }) })
    expect(modalOpen()).toBe(true)
    expect(isDialogOpen()).toBe(true)
    expect(upsertParameter).not.toHaveBeenCalled()
  })

  it('a backdrop click on the modal while a dialog is open does not close the modal', async () => {
    await stackDialog()
    const backdrop = screen.getByTestId('add-parameter-backdrop')
    await act(async () => { fireEvent.mouseDown(backdrop); fireEvent.click(backdrop) })
    expect(modalOpen()).toBe(true)
  })
})
