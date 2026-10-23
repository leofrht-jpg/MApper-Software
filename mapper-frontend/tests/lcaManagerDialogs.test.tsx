// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * LCA Architect Manager import/export through the in-app dialogs.
 *
 * Replace import asked window.confirm BEFORE opening the file picker; in the
 * packaged WKWebView that answered false, so Replace never ran. Now the picker
 * opens straight from the click (WebKit only opens a file picker during a user
 * activation, which an awaited dialog can use up) and Replace is confirmed
 * after the file is chosen. Failures show an error toast instead of an alert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { LCAManager } from '../src/pages/LCAManager'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useBOMStore } from '../src/stores/bomStore'
import * as client from '../src/api/client'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, downloadBOMTemplate: vi.fn(), exportAllArchetypes: vi.fn() }
})

const RESULT = {
  format: 'multi', mode: 'replace', created: 0, folders_created: 0, archetypes: [], warnings: [],
}
let importFromFile: ReturnType<typeof vi.fn>

beforeEach(() => {
  __resetDialogsForTests()
  vi.clearAllMocks()
  importFromFile = vi.fn().mockResolvedValue(RESULT)
  useBOMStore.setState({
    archetypes: [{ id: 'a1', name: 'Car', folder: null, material_count: 3, unlinked_count: 0 }],
    folders: [],
    isLoading: false,
    importFromFile,
    fetchArchetypes: vi.fn().mockResolvedValue(undefined),
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests(); vi.restoreAllMocks() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }
const file = new File(['x'], 'boms.xlsx')

function show() {
  const utils = render(<><LCAManager /><DialogHost /></>)
  const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement
  const choose = async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { fireEvent.change(input) })
  }
  return { ...utils, input, choose }
}

describe('Replace import', () => {
  it('opens the file picker first, with no dialog in the way', async () => {
    const { input } = show()
    const pickerClick = vi.spyOn(input, 'click').mockImplementation(() => {})
    await click(screen.getByText('Replace (delete missing)'))
    await click(screen.getByText('Import .xlsx'))
    expect(pickerClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('confirms Replace after the file is chosen, then imports in replace mode', async () => {
    const { choose } = show()
    await click(screen.getByText('Replace (delete missing)'))
    await choose()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Replace with "boms.xlsx"?')
    expect(importFromFile).not.toHaveBeenCalled()
    await click(screen.getByTestId('dialog-confirm'))
    expect(importFromFile).toHaveBeenCalledWith(file, 'replace')
  })

  it('Cancel aborts the import', async () => {
    const { choose } = show()
    await click(screen.getByText('Replace (delete missing)'))
    await choose()
    await click(screen.getByTestId('dialog-cancel'))
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(importFromFile).not.toHaveBeenCalled()
  })

  it('Merge imports without asking', async () => {
    const { choose } = show()
    await choose()
    expect(screen.queryByTestId('dialog')).toBeNull()
    expect(importFromFile).toHaveBeenCalledWith(file, 'merge')
  })
})

describe('failures show an error toast', () => {
  it('import failed', async () => {
    importFromFile.mockRejectedValue(new Error('bad workbook'))
    const { choose } = show()
    await choose()
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Import failed: bad workbook')
  })

  it('export failed', async () => {
    vi.mocked(client.exportAllArchetypes).mockRejectedValue(new Error('offline'))
    show()
    await click(screen.getByText(/^Export all \(1\)$/))
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Export failed: offline')
  })

  it('template download failed', async () => {
    vi.mocked(client.downloadBOMTemplate).mockRejectedValue(new Error('404'))
    show()
    await click(screen.getByText('Download template'))
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Download failed: 404')
  })
})
