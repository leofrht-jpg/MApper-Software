// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * BOM editing through the in-app dialogs (no native calls).
 *
 * BOMTree and the two bulk-evolution modals used window.alert for validation
 * and for apply failures. In the packaged WKWebView alert shows nothing, so a
 * refused save looked like a click that did nothing. Real components, real
 * DialogHost; the save callbacks are spies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { BOMTree } from '../src/components/bom/BOMTree'
import { BulkLearningRateModal } from '../src/components/bom/BulkLearningRateModal'
import { BulkReboundModal } from '../src/components/bom/BulkReboundModal'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useParameterStore } from '../src/stores/parameterStore'
import type { Archetype, BOMNode } from '../src/api/client'

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }

const steel: BOMNode = {
  id: 'n-steel', name: 'Steel', node_type: 'material', quantity: 100, unit: 'kg', children: [],
} as BOMNode

const archetype = {
  id: 'arc-1', name: 'Car',
  bom: [{
    id: 'n-mfg', name: 'Manufacturing', node_type: 'component', quantity: 1, unit: 'piece',
    children: [steel],
  }],
} as unknown as Archetype

beforeEach(() => {
  __resetDialogsForTests()
  useParameterStore.setState({ activeSet: null } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

describe('BOMTree quantity edit', () => {
  const edit = async (amount: string) => {
    const onPatch = vi.fn(async () => {})
    render(<><BOMTree node={steel} onPatch={onPatch} onAddChild={vi.fn()} onDelete={vi.fn()} /><DialogHost /></>)
    await click(screen.getByText('Steel'))
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('100 or mass_per_unit'), { target: { value: amount } })
    })
    await click(screen.getByRole('button', { name: 'Save' }))
    return onPatch
  }

  it('an invalid expression shows its message and does not save', async () => {
    const onPatch = await edit('unknown_param * 2')
    expect(screen.getByTestId('dialog')).toHaveAccessibleName('Expression error')
    expect(screen.getByTestId('dialog')).toHaveTextContent('unknown_param')
    expect(onPatch).not.toHaveBeenCalled()
    await click(screen.getByTestId('dialog-confirm'))
    // Still editing: the draft is kept for the user to fix.
    expect(screen.getByPlaceholderText('100 or mass_per_unit')).toHaveValue('unknown_param * 2')
  })

  it('a valid number saves without a dialog', async () => {
    const onPatch = await edit('250')
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(onPatch).toHaveBeenCalledWith('n-steel', { quantity: 250 })
  })
})

describe('BOMTree evolution milestones', () => {
  const open = async (onPatch = vi.fn(async () => {})) => {
    render(<><BOMTree node={steel} onPatch={onPatch} onAddChild={vi.fn()} onDelete={vi.fn()} /><DialogHost /></>)
    await click(screen.getByTitle(/^Quantity evolution:/))
    await click(screen.getByLabelText('Milestones'))
    return onPatch
  }
  const saveEvolution = async () => {
    const saves = screen.getAllByRole('button', { name: 'Save' })
    await click(saves[saves.length - 1])
  }

  it('fewer than two milestones shows the message and does not save', async () => {
    // The editor will not remove below two, so the only way to have one is a
    // stored evolution that already carries a single milestone (e.g. imported).
    const onPatch = vi.fn(async () => {})
    const oneMilestone = {
      ...steel,
      evolution: { method: 'milestones', milestones: [{ year: 2030, quantity: 80 }], base_year: 2025 },
    } as BOMNode
    render(<><BOMTree node={oneMilestone} onPatch={onPatch} onAddChild={vi.fn()} onDelete={vi.fn()} /><DialogHost /></>)
    await click(screen.getByTitle(/^Quantity evolution:/))
    await saveEvolution()
    expect(screen.getByTestId('dialog')).toHaveAccessibleName('Milestones require at least two (year, value) pairs.')
    expect(onPatch).not.toHaveBeenCalled()
  })

  it('two milestones save', async () => {
    const onPatch = await open()
    await saveEvolution()
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(onPatch).toHaveBeenCalledWith('n-steel', {
      evolution: expect.objectContaining({ method: 'milestones' }),
    })
  })
})

describe.each([
  ['BulkLearningRateModal', BulkLearningRateModal, /^Selected only/],
  ['BulkReboundModal', BulkReboundModal, /^Selected only/],
] as const)('%s', (_name, Modal, selectionLabel) => {
  const show = (onApply: ReturnType<typeof vi.fn>, onClose = vi.fn()) => {
    render(<><Modal archetype={archetype} onApply={onApply as never} onClose={onClose} /><DialogHost /></>)
    return onClose
  }

  it('nothing selected shows its message and applies nothing', async () => {
    const onApply = vi.fn(async () => {})
    const onClose = show(onApply)
    await click(screen.getByLabelText(selectionLabel))
    await click(screen.getByRole('button', { name: /Apply$/ }))
    expect(screen.getByTestId('dialog')).toHaveAccessibleName('Select at least one material or switch to "All materials".')
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a failed apply shows an error toast and keeps the modal open', async () => {
    const onApply = vi.fn(async () => { throw new Error('save rejected') })
    const onClose = show(onApply)
    await click(screen.getByRole('button', { name: /Apply$/ }))
    expect(onApply).toHaveBeenCalled()
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Apply failed: save rejected')
    expect(onClose).not.toHaveBeenCalled()
  })
})
