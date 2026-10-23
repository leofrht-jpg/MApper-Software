// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * The in-app dialog helpers (src/components/ui/dialogs.tsx), through the real
 * <DialogHost/>: answers, keyboard, focus, queueing, project switch, toasts,
 * and that a missing host fails loudly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import {
  DialogHost, INFO_TOAST_MS, __resetDialogsForTests, choose, confirmDialog,
  messageDialog, notify, promptDialog,
} from '../src/components/ui/dialogs'
import { useProjectStore } from '../src/stores/projectStore'

function mount() {
  return render(
    <>
      <button data-testid="trigger">Delete</button>
      <DialogHost />
    </>,
  )
}

/** Open a dialog from the trigger, as a click handler would. */
async function open<T>(fn: () => Promise<T>): Promise<{ result: Promise<T> }> {
  screen.getByTestId('trigger').focus()
  let result!: Promise<T>
  await act(async () => { result = fn() })
  return { result }
}

beforeEach(() => {
  __resetDialogsForTests()
  useProjectStore.setState({ currentProject: 'P1' } as never)
})
afterEach(() => {
  cleanup()
  __resetDialogsForTests()
  vi.useRealTimers()
})

describe('confirmDialog', () => {
  it('resolves true on the confirm button', async () => {
    mount()
    const { result } = await open(() => confirmDialog('Proceed?'))
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-confirm')) })
    await expect(result).resolves.toBe(true)
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('resolves true on Enter (focus starts on OK for a non-destructive dialog)', async () => {
    mount()
    const { result } = await open(() => confirmDialog('Proceed?'))
    expect(document.activeElement).toBe(screen.getByTestId('dialog-confirm'))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }) })
    await expect(result).resolves.toBe(true)
  })

  it.each([
    ['the Cancel button', () => fireEvent.click(screen.getByTestId('dialog-cancel'))],
    ['Escape', () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' })],
    ['a backdrop click', () => fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'))],
  ])('resolves false on %s', async (_name, act_) => {
    mount()
    const { result } = await open(() => confirmDialog('Proceed?'))
    await act(async () => { act_() })
    await expect(result).resolves.toBe(false)
  })

  it('a destructive dialog: role alertdialog, danger button, focus on Cancel so Enter cancels', async () => {
    mount()
    const { result } = await open(() => confirmDialog({ title: 'Delete it?', destructive: true }))
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete it?')
    expect(screen.getByTestId('dialog-confirm').textContent).toBe('Delete')
    expect(screen.getByTestId('dialog-confirm').style.backgroundColor).toBe('var(--danger)')
    expect(document.activeElement).toBe(screen.getByTestId('dialog-cancel'))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }) })
    await expect(result).resolves.toBe(false)
  })

  it('a non-destructive dialog is role dialog, aria-modal', async () => {
    mount()
    await open(() => confirmDialog({ title: 'Proceed?', body: 'Details' }))
    const d = screen.getByRole('dialog')
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(d).toHaveAccessibleDescription('Details')
  })
})

describe('focus', () => {
  it('returns to the trigger when the dialog closes', async () => {
    mount()
    const { result } = await open(() => confirmDialog('Proceed?'))
    expect(document.activeElement).not.toBe(screen.getByTestId('trigger'))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    await result
    expect(document.activeElement).toBe(screen.getByTestId('trigger'))
  })

  it('a removed trigger does not throw and leaves focus out of the gone dialog', async () => {
    const { rerender } = mount()
    const { result } = await open(() => confirmDialog('Proceed?'))
    rerender(<DialogHost />) // the trigger unmounts while the dialog is open
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-confirm')) })
    await expect(result).resolves.toBe(true)
    expect(document.activeElement?.getAttribute('data-testid')).not.toBe('dialog-confirm')
  })

  it('Tab and Shift+Tab stay inside the dialog', async () => {
    mount()
    await open(() => confirmDialog('Proceed?'))
    const cancel = screen.getByTestId('dialog-cancel')
    const ok = screen.getByTestId('dialog-confirm')
    ok.focus()
    fireEvent.keyDown(ok, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(ok)
  })

  it('keys handled by the dialog do not reach the page', async () => {
    const pageKeys = vi.fn()
    window.addEventListener('keydown', pageKeys)
    mount()
    await open(() => confirmDialog('Proceed?'))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    window.removeEventListener('keydown', pageKeys)
    expect(pageKeys).not.toHaveBeenCalled()
  })
})

describe('promptDialog', () => {
  it('returns the trimmed value, focus starts in the input, Enter submits', async () => {
    mount()
    const { result } = await open(() => promptDialog({ title: 'Name', defaultValue: 'x' }))
    const input = screen.getByTestId('dialog-input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('x')
    fireEvent.change(input, { target: { value: '  Optimistic  ' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await expect(result).resolves.toBe('Optimistic')
  })

  it('returns null on Cancel and on Escape', async () => {
    mount()
    let r = await open(() => promptDialog('Name'))
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-cancel')) })
    await expect(r.result).resolves.toBeNull()
    r = await open(() => promptDialog('Name'))
    await act(async () => { fireEvent.keyDown(screen.getByTestId('dialog-input'), { key: 'Escape' }) })
    await expect(r.result).resolves.toBeNull()
  })

  it('stays open with the message while validate fails, then accepts', async () => {
    mount()
    const { result } = await open(() => promptDialog({
      title: 'Name', validate: (v) => (v ? null : 'Name is required'),
    }))
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-confirm')) })
    expect(screen.getByTestId('dialog-error').textContent).toBe('Name is required')
    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('dialog-input'), { target: { value: 'ok' } })
    expect(screen.queryByTestId('dialog-error')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-confirm')) })
    await expect(result).resolves.toBe('ok')
  })
})

describe('choose', () => {
  const opts = { title: 'Import mode', options: [{ value: 'replace', label: 'Replace' }, { value: 'merge', label: 'Merge' }] }

  it('returns the chosen value', async () => {
    mount()
    const { result } = await open(() => choose(opts))
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-choice-merge')) })
    await expect(result).resolves.toBe('merge')
  })

  it('Escape aborts with null, never a default branch; focus starts on Cancel', async () => {
    mount()
    const { result } = await open(() => choose(opts))
    expect(document.activeElement).toBe(screen.getByTestId('dialog-cancel'))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    await expect(result).resolves.toBeNull()
  })
})

describe('messageDialog', () => {
  it('resolves on OK and on Escape', async () => {
    mount()
    let r = await open(() => messageDialog({ title: 'Saved', body: 'line 1\nline 2' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Saved')
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-confirm')) })
    await expect(r.result).resolves.toBeUndefined()
    r = await open(() => messageDialog('Again'))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    await expect(r.result).resolves.toBeUndefined()
  })
})

describe('queue, project switch, host', () => {
  it('shows one dialog at a time, in order', async () => {
    mount()
    let a!: Promise<boolean>, b!: Promise<boolean>
    await act(async () => { a = confirmDialog('First'); b = confirmDialog('Second') })
    expect(screen.getAllByTestId('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('First')
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-confirm')) })
    await expect(a).resolves.toBe(true)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Second')
    await act(async () => { fireEvent.click(screen.getByTestId('dialog-cancel')) })
    await expect(b).resolves.toBe(false)
  })

  it('a project switch resolves every pending dialog as cancel', async () => {
    mount()
    let a!: Promise<boolean>, b!: Promise<string | null>
    await act(async () => { a = confirmDialog('Delete?'); b = promptDialog('Name') })
    await act(async () => { useProjectStore.setState({ currentProject: 'P2' } as never) })
    await expect(a).resolves.toBe(false)
    await expect(b).resolves.toBeNull()
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('throws when no host is mounted', () => {
    expect(() => confirmDialog('x')).toThrow(/DialogHost is not mounted/)
    expect(() => promptDialog('x')).toThrow(/DialogHost is not mounted/)
    expect(() => choose({ title: 'x', options: [] })).toThrow(/DialogHost is not mounted/)
    expect(() => messageDialog('x')).toThrow(/DialogHost is not mounted/)
    expect(() => notify('x')).toThrow(/DialogHost is not mounted/)
  })

  it('renders in document.body above ComputeOverlay (z 9998), outside an inert #root', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    render(<><button data-testid="trigger">x</button><DialogHost /></>, { container: root })
    root.setAttribute('inert', '')
    await open(() => confirmDialog('Proceed?'))
    const backdrop = screen.getByTestId('dialog-backdrop')
    expect(root.contains(backdrop)).toBe(false)
    expect(backdrop.parentElement).toBe(document.body)
    expect(Number(backdrop.style.zIndex)).toBeGreaterThan(9998)
    expect(backdrop.closest('[inert]')).toBeNull()
    root.remove()
  })

  it('a second host renders nothing (no duplicate dialogs)', async () => {
    render(<><button data-testid="trigger">x</button><DialogHost /><DialogHost /></>)
    await open(() => confirmDialog('Proceed?'))
    expect(screen.getAllByTestId('dialog')).toHaveLength(1)
  })
})

describe('notify', () => {
  it('an error toast stays until dismissed', async () => {
    vi.useFakeTimers()
    mount()
    act(() => notify('Export failed', { tone: 'error', detail: 'disk full' }))
    expect(screen.getByRole('alert').textContent).toContain('Export failed')
    expect(screen.getByRole('alert').textContent).toContain('disk full')
    act(() => { vi.advanceTimersByTime(INFO_TOAST_MS * 3) })
    expect(screen.getByTestId('toast-error')).toBeInTheDocument()
    act(() => { fireEvent.click(screen.getByTestId('toast-dismiss')) })
    expect(screen.queryByTestId('toast-error')).toBeNull()
  })

  it('an info toast expires', async () => {
    vi.useFakeTimers()
    mount()
    act(() => notify('Copied'))
    expect(screen.getByRole('status').textContent).toContain('Copied')
    act(() => { vi.advanceTimersByTime(INFO_TOAST_MS + 1) })
    expect(screen.queryByTestId('toast-info')).toBeNull()
  })
})
