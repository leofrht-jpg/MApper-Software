// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * DSM scenario manager through the in-app dialogs (no native calls).
 *
 * New, duplicate and delete used window.prompt / window.confirm, which do
 * nothing in the packaged WKWebView: no scenario could be created, duplicated
 * or deleted there. The old "OK = fork Base, Cancel = start empty" confirm is
 * now an explicit choice, and Escape aborts. The modal itself closes on
 * Escape; Escape inside a dialog must not close it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ScenarioManagerModal } from '../src/components/dsm/ScenarioManagerModal'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useDSMStore } from '../src/stores/dsmStore'

const spies = {
  createScenario: vi.fn(async (_a: { name: string; copyFrom?: string }) => {}),
  duplicateScenario: vi.fn(async (_id: string, _n: string) => {}),
  deleteScenario: vi.fn(async (_id: string) => {}),
}

beforeEach(() => {
  __resetDialogsForTests()
  for (const s of Object.values(spies)) s.mockReset().mockResolvedValue(undefined as never)
  useDSMStore.setState({
    systemState: {
      scenarios: [
        { id: 'base', name: 'Base', is_base: true },
        { id: 's1', name: 'SSP2', is_base: false },
      ],
      active_scenario_id: 'base',
    },
    ...spies,
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const type = async (v: string) => {
  await act(async () => { fireEvent.change(screen.getByTestId('dialog-input'), { target: { value: v } }) })
}
function show() {
  const onClose = vi.fn()
  render(<><ScenarioManagerModal onClose={onClose} /><DialogHost /></>)
  return onClose
}

describe('new scenario', () => {
  it('asks a name, then Fork Base or Start empty', async () => {
    show()
    await click(screen.getByText('New scenario'))
    await type(' Low demand ')
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByTestId('dialog')).toHaveAccessibleName('Start "Low demand" from the Base scenario?')
    await click(screen.getByTestId('dialog-choice-fork'))
    expect(spies.createScenario).toHaveBeenCalledWith({ name: 'Low demand', copyFrom: 'base' })
  })

  it('Start empty creates without copying', async () => {
    show()
    await click(screen.getByText('New scenario'))
    await type('Empty one')
    await click(screen.getByTestId('dialog-confirm'))
    await click(screen.getByTestId('dialog-choice-empty'))
    expect(spies.createScenario).toHaveBeenCalledWith({ name: 'Empty one', copyFrom: undefined })
  })

  it('an empty name is refused; Escape at the fork question creates nothing and keeps the manager open', async () => {
    const onClose = show()
    await click(screen.getByText('New scenario'))
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByTestId('dialog-error')).toHaveTextContent('Scenario name is required')
    await type('High')
    await click(screen.getByTestId('dialog-confirm'))
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(spies.createScenario).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a failed create shows its error in the manager (not a native alert)', async () => {
    spies.createScenario.mockRejectedValue(new Error('name taken'))
    show()
    await click(screen.getByText('New scenario'))
    await type('SSP2')
    await click(screen.getByTestId('dialog-confirm'))
    await click(screen.getByTestId('dialog-choice-empty'))
    expect(await screen.findByText('name taken')).toBeInTheDocument()
  })
})

describe('duplicate a scenario', () => {
  it('prefills "<name> copy" and duplicates under the given name', async () => {
    show()
    await click(screen.getAllByTitle(/^Duplicate/)[1])
    expect(screen.getByTestId('dialog-input')).toHaveValue('SSP2 copy')
    await click(screen.getByTestId('dialog-confirm'))
    expect(spies.duplicateScenario).toHaveBeenCalledWith('s1', 'SSP2 copy')
  })

  it('Cancel duplicates nothing', async () => {
    show()
    await click(screen.getAllByTitle(/^Duplicate/)[1])
    await click(screen.getByTestId('dialog-cancel'))
    expect(spies.duplicateScenario).not.toHaveBeenCalled()
  })
})

describe('delete a scenario', () => {
  const deleteButton = () => screen.getAllByTitle(/delete/i).find((b) => !(b as HTMLButtonElement).disabled)!

  it('asks in-app, and Delete removes it', async () => {
    show()
    await click(deleteButton())
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete scenario "SSP2"?')
    await click(screen.getByTestId('dialog-confirm'))
    expect(spies.deleteScenario).toHaveBeenCalledWith('s1')
  })

  it('Cancel keeps it', async () => {
    show()
    await click(deleteButton())
    await click(screen.getByTestId('dialog-cancel'))
    expect(spies.deleteScenario).not.toHaveBeenCalled()
  })
})
