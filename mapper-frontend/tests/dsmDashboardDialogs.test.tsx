// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * DSM Dashboard through the in-app dialogs (no native calls).
 *
 * Deleting a system asked window.confirm (always false in the packaged
 * WKWebView); the simulation-import result and the import failures used
 * window.alert (which showed nothing). The import result with its warnings is
 * a message dialog, because the list needs room; failures are error toasts.
 * Real page, real DialogHost; the store actions are spies.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { DSMDashboard } from '../src/pages/DSMDashboard'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useDSMStore } from '../src/stores/dsmStore'

const SYSTEM = {
  id: 'sys1', name: 'Danish Fleet', description: null,
  dimensions: [{ name: 'fuel', display_name: 'Fuel', labels: ['BEV'] }],
  time_horizon: { start_year: 2025, end_year: 2030 },
} as any

const spies = {
  fetchSystems: vi.fn(async () => {}),
  fetchScalingRules: vi.fn(async () => {}),
  removeSystem: vi.fn(async (_id: string) => {}),
  importSystem: vi.fn(async (_f: File) => {}),
  importSimulation: vi.fn(async (_f: File) => ({ years_imported: 6, cohorts_found: 2, warnings: [] as string[] })),
}

function seed(active: boolean) {
  useDSMStore.setState({
    systems: [SYSTEM],
    activeSystem: active ? SYSTEM : null,
    systemState: active ? { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' } : null,
    simulationResult: null,
    ...spies,
  } as never)
}

beforeEach(() => {
  __resetDialogsForTests()
  for (const s of Object.values(spies)) s.mockClear()
  spies.removeSystem.mockReset().mockResolvedValue(undefined)
  spies.importSystem.mockReset().mockResolvedValue(undefined)
  // @ts-expect-error minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => { cleanup(); __resetDialogsForTests(); vi.unstubAllGlobals() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const show = () => render(<><DSMDashboard /><DialogHost /></>)
async function pickFile(input: HTMLInputElement, name: string) {
  const file = new File(['x'], name)
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { fireEvent.change(input) })
  return file
}
const fileInputs = () => Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[]

describe('delete a DSM system', () => {
  const openDelete = async () => {
    seed(true)
    show()
    await click(screen.getByText('Switch'))
    await click(screen.getByRole('button', { name: 'Delete' }))
  }

  it('asks in-app, and Delete removes it', async () => {
    await openDelete()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete system "Danish Fleet"?')
    expect(spies.removeSystem).not.toHaveBeenCalled()
    await click(screen.getByTestId('dialog-confirm'))
    expect(spies.removeSystem).toHaveBeenCalledWith('sys1')
  })

  it('Cancel keeps it', async () => {
    await openDelete()
    await click(screen.getByTestId('dialog-cancel'))
    expect(spies.removeSystem).not.toHaveBeenCalled()
  })

  it('a failed delete shows an error toast', async () => {
    spies.removeSystem.mockRejectedValue(new Error('in use'))
    await openDelete()
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Delete failed: in use')
  })
})

describe('import a DSM simulation', () => {
  it('shows the result and every warning in a message dialog', async () => {
    spies.importSimulation.mockResolvedValue({
      years_imported: 6, cohorts_found: 2, warnings: ['Year 2027 missing', 'Cohort X unknown'],
    })
    seed(true)
    show()
    const input = fileInputs().find((i) => i.accept === '.xlsx,.xls')!
    const file = await pickFile(input, 'sim.xlsx')
    expect(spies.importSimulation).toHaveBeenCalledWith(file)
    const dialog = screen.getByTestId('dialog')
    expect(dialog).toHaveAccessibleName('Imported 6 years, 2 cohorts.')
    const list = within(dialog).getByTestId('dsm-import-warnings')
    expect(list.querySelectorAll('li')).toHaveLength(2)
    expect(list).toHaveTextContent('Year 2027 missing')
    expect(list).toHaveTextContent('Cohort X unknown')
    await click(screen.getByTestId('dialog-confirm'))
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('a failed simulation import shows an error toast', async () => {
    spies.importSimulation.mockRejectedValue(new Error('not a MApper export'))
    seed(true)
    show()
    await pickFile(fileInputs().find((i) => i.accept === '.xlsx,.xls')!, 'sim.xlsx')
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Import failed: not a MApper export')
  })

  it('a failed system import (empty state) shows an error toast', async () => {
    spies.importSystem.mockRejectedValue(new Error('bad workbook'))
    seed(false)
    show()
    await pickFile(fileInputs()[0], 'system.xlsx')
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Import failed: bad workbook')
  })
})
