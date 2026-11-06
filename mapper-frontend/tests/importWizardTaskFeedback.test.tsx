/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react'
import { ImportWizard } from '../src/components/ImportWizard'

// A long import used to leave the wizard on its last progress line when the
// socket dropped (a laptop sleeping, a proxy cutting an idle connection), and a
// failed import showed the last progress line instead of the cause. The wizard now
// says the connection was lost, polls the task's state, shows a final state it
// finds, and shows the error text.

type Cb = {
  onMessage: (m: Record<string, unknown>) => void
  onError?: () => void
  onClose?: () => void
}

const mocks = vi.hoisted(() => ({
  state: vi.fn(),
  sockets: [] as unknown[],
}))

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    browseEcoinventFolder: vi.fn(async (p: string) => ({ valid: true, spold_count: 3, path: p, message: 'ok' })),
    startEcoinventLocalImport: vi.fn(async () => ({ task_id: 'task-1', status: 'started' })),
    getEcoinventImportSummary: vi.fn(async () => { throw new Error('no summary') }),
    getTaskState: mocks.state,
    connectToTask: vi.fn((_path: string, onMessage: Cb['onMessage'], onError?: () => void, onClose?: () => void) => {
      const sock = { onMessage, onError, onClose, readyState: 1, close: vi.fn() }
      mocks.sockets.push(sock)
      return sock as unknown as WebSocket
    }),
  }
})

vi.mock('../src/stores/projectStore', () => ({
  useProjectStore: () => ({ fetchDatabases: vi.fn() }),
}))

const sock = (i = mocks.sockets.length - 1) => mocks.sockets[i] as Cb & { readyState: number }
const LOST = 'Connection lost. The import may still be running; check Database Explorer.'

async function startImport() {
  render(<ImportWizard onClose={() => {}} />)
  fireEvent.click(screen.getAllByText('Import from local files')[0])
  fireEvent.change(screen.getByPlaceholderText(/datasets$/), { target: { value: '/x/ecoinvent-3.10-cutoff/datasets' } })
  await act(async () => { fireEvent.click(screen.getByText('Verify')) })
  await act(async () => { fireEvent.click(screen.getByText('Continue')) })
  await act(async () => { fireEvent.click(screen.getByText(/^Import 3 datasets$/)) })
}

const tick = async (ms = 3000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('ImportWizard task feedback', () => {
  beforeEach(() => {
    mocks.state.mockReset()
    mocks.sockets.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('shows "Connection lost" when the socket closes, and picks up the final state by polling', async () => {
    await startImport()
    await act(async () => { sock().onMessage({ step: 'writing', progress: 0.9, message: 'Writing database…' }) })
    expect(screen.queryByTestId('import-connection-lost')).toBeNull()

    mocks.state.mockResolvedValue({ task_id: 'task-1', status: 'done', step: 'done', progress: 1, message: 'imported' })
    await act(async () => { sock().onClose?.() })
    expect(screen.getByTestId('import-connection-lost').textContent).toBe(LOST)
    expect(screen.getByText('Writing database…')).toBeTruthy()

    await tick()
    expect(mocks.state).toHaveBeenCalledWith('task-1')
    expect(screen.getByText(/Database "ecoinvent-3.10-cutoff" imported/)).toBeTruthy()
    expect(screen.queryByTestId('import-connection-lost')).toBeNull()

    const calls = mocks.state.mock.calls.length
    await tick(10000)
    expect(mocks.state.mock.calls.length).toBe(calls) // the poll stopped at the final state
  })

  it('a socket error is handled like a close', async () => {
    await startImport()
    mocks.state.mockResolvedValue({ task_id: 'task-1', status: 'running', step: 'importing', progress: 0.5, message: 'Reading…' })
    await act(async () => { sock().onError?.() })
    expect(screen.getByTestId('import-connection-lost').textContent).toBe(LOST)
  })

  it('shows the failure text found by polling, not the last progress line', async () => {
    await startImport()
    await act(async () => { sock().onMessage({ step: 'writing', progress: 0.9, message: 'Writing database…' }) })
    mocks.state.mockResolvedValue({
      task_id: 'task-1', status: 'error', step: 'error', progress: 0.9,
      message: 'Writing database…', error: 'database is locked',
    })
    await act(async () => { sock().onClose?.() })
    await tick()
    expect(screen.getByText(/Import failed: database is locked/)).toBeTruthy()
  })

  it('keeps the warning and keeps polling while the task runs, and re-opens the socket', async () => {
    await startImport()
    mocks.state.mockResolvedValue({ task_id: 'task-1', status: 'running', step: 'writing', progress: 0.9, message: 'Writing database… (60s elapsed)' })
    await act(async () => { sock().readyState = 3; sock().onClose?.() })
    expect(mocks.sockets.length).toBe(1)

    await tick()
    expect(screen.getByTestId('import-connection-lost')).toBeTruthy()
    expect(screen.getByText('Writing database… (60s elapsed)')).toBeTruthy()
    expect(mocks.sockets.length).toBe(2) // tried to get the live socket back

    await act(async () => { sock().onMessage({ step: 'writing', progress: 0.9, message: 'Writing database… (65s elapsed)' }) })
    expect(screen.queryByTestId('import-connection-lost')).toBeNull()
  })

  it('says so when the backend no longer knows the task', async () => {
    await startImport()
    mocks.state.mockResolvedValue(null)
    await act(async () => { sock().onClose?.() })
    await tick()
    expect(screen.getByText(/backend no longer knows this import/)).toBeTruthy()
  })

  it('shows the error text of a failure the socket delivers', async () => {
    await startImport()
    await act(async () => {
      sock().onMessage({ step: 'error', progress: 0.45, message: 'Reading 3 .spold files…', error: 'No .spold files found' })
    })
    expect(screen.getByText(/Import failed: No \.spold files found/)).toBeTruthy()
    expect(screen.queryByText(/Import failed: Reading 3/)).toBeNull()
  })

  it('falls back to the message for an older backend that sends no error field', async () => {
    await startImport()
    await act(async () => { sock().onMessage({ step: 'error', progress: 0, message: 'Something broke' }) })
    expect(screen.getByText(/Import failed: Something broke/)).toBeTruthy()
  })

  it('highlights the downloading step', async () => {
    await startImport()
    await act(async () => { sock().onMessage({ step: 'downloading', progress: 0.1, message: 'Downloading and extracting…' }) })
    const color = (t: string) => (screen.getByText(t) as HTMLElement).style.color
    expect(color('downloading')).toBe('var(--text-primary)')   // active
    expect(color('connecting')).toBe('var(--success)')         // done
    expect(color('biosphere')).toBe('var(--text-tertiary)')    // still to come
  })
})
