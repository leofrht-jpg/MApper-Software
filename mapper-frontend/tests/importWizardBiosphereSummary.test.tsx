/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/react'
import { ImportWizard } from '../src/components/ImportWizard'

// An import that dropped biosphere exchanges used to end on "imported" with
// nothing else. The wizard now reads the import's summary when the task is done
// and shows the counts, and a warning when any exchange was dropped.

const SUMMARY = {
  coverage_checked: true,
  flows_added: 3,
  exchanges_found: 7,
  dropped_by_design: 1,
  exchanges_linked: 6,
  exchanges_dropped: 0,
  exchanges_stored: 6,
  warning: '',
  message: '3 flows added to biosphere3. Biosphere exchanges: 7 found, 1 dropped by design, 6 linked, 0 dropped.',
}

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
}))

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    browseEcoinventFolder: vi.fn(async (p: string) => ({ valid: true, spold_count: 3, path: p, message: 'ok' })),
    startEcoinventLocalImport: vi.fn(async () => ({ task_id: 'task-1', status: 'started' })),
    getEcoinventImportSummary: mocks.summary,
    connectToTask: vi.fn((_path: string, onMessage: (m: unknown) => void) => {
      queueMicrotask(() => onMessage({ step: 'done', progress: 1, message: 'imported' }))
      return { close: vi.fn() } as unknown as WebSocket
    }),
  }
})

vi.mock('../src/stores/projectStore', () => ({
  useProjectStore: () => ({ fetchDatabases: vi.fn() }),
}))

async function runLocalImport() {
  render(<ImportWizard onClose={() => {}} />)
  fireEvent.click(screen.getAllByText('Import from local files')[0])
  fireEvent.change(screen.getByPlaceholderText(/datasets$/), { target: { value: '/x/ecoinvent/datasets' } })
  fireEvent.click(screen.getByText('Verify'))
  await waitFor(() => screen.getByText('Continue'))
  fireEvent.click(screen.getByText('Continue'))
  fireEvent.click(await screen.findByText(/^Import 3 datasets$/))
}

describe('ImportWizard biosphere summary', () => {
  // braces: a returned mock would be run by vitest as the hook's teardown
  beforeEach(() => { mocks.summary.mockReset() })
  afterEach(cleanup)

  it('shows a warning and the counts when exchanges were dropped', async () => {
    mocks.summary.mockResolvedValue({
      ...SUMMARY, exchanges_linked: 3, exchanges_dropped: 3,
      warning: 'WARNING: 3 of 7 biosphere exchanges (42.86%) were dropped because their flow is not in biosphere3.',
      message: 'Biosphere exchanges: 7 found, 1 dropped by design, 3 linked, 3 dropped.',
    })
    await runLocalImport()
    const warn = await screen.findByTestId('import-biosphere-warning')
    expect(warn.textContent).toContain('3 of 7 biosphere exchanges')
    expect(screen.getByTestId('import-biosphere-counts').textContent).toContain('7 found')
    expect(mocks.summary).toHaveBeenCalledWith('task-1')
  })

  it('shows the counts and no warning when nothing was dropped', async () => {
    mocks.summary.mockResolvedValue(SUMMARY)
    await runLocalImport()
    expect((await screen.findByTestId('import-biosphere-counts')).textContent).toContain('6 linked, 0 dropped')
    expect(screen.queryByTestId('import-biosphere-warning')).toBeNull()
  })

  it('still ends on the done screen when the summary cannot be fetched', async () => {
    mocks.summary.mockRejectedValue(new Error('404'))
    await runLocalImport()
    await screen.findByText(/imported/)
    await waitFor(() => expect(mocks.summary.mock.calls.length).toBe(1))
    expect(screen.queryByTestId('import-biosphere-counts')).toBeNull()
    expect(screen.queryByTestId('import-biosphere-warning')).toBeNull()
  })
})
