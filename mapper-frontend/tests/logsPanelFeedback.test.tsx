/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Settings › Logs: both buttons must SAY something.
 *
 * In the packaged app "Copy all" and "Export" produced no file, no message and
 * no error. Two separate causes, one shared shape: a failure with no outcome on
 * screen. These assertions are on the rendered text, never on whether a handler
 * ran — a handler that runs and shows nothing is the bug.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

vi.mock('../src/api/client', () => ({
  getSystemLogs: vi.fn(async () => ({ lines: [], total: 0, log_path: '/tmp/mapper.log' })),
  downloadSystemLogs: vi.fn(async () => ({ path: null })),
}))
import { downloadSystemLogs } from '../src/api/client'

import { LogsPanel } from '../src/pages/SettingsPage'
import { useLogStore } from '../src/stores/logStore'

const COPY_ALL = /copy all|^copied$/i

async function mount() {
  render(<LogsPanel version="0.3.0" />)
  await waitFor(() => expect(screen.getByRole('button', { name: COPY_ALL })).toBeTruthy())
}

beforeEach(() => {
  // One entry so there is something to copy and export.
  useLogStore.setState({
    entries: [{
      id: '1', timestamp: '2026-10-08T10:00:00.000Z', level: 'error',
      module: 'test', message: 'something broke',
    }] as never,
  })
  vi.mocked(downloadSystemLogs).mockResolvedValue({ path: null })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Copy all tells you which way it went', () => {
  it('a copy that did nothing shows an error instead of looking dead', async () => {
    // execCommand RETURNS false rather than throwing. That return was ignored.
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    document.execCommand = vi.fn(() => false)

    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: COPY_ALL })) })

    await waitFor(() => expect(screen.getByText(/could not copy to the clipboard/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^copied$/i }),
      'a failed copy must not claim success').toBeNull()
  })

  it('a real copy confirms on the button', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: COPY_ALL })) })

    await waitFor(() => expect(screen.getByRole('button', { name: /^copied$/i })).toBeTruthy())
    expect(writeText.mock.calls[0][0]).toContain('something broke')
    expect(screen.queryByText(/could not copy/i)).toBeNull()
  })

  it('a clipboard that rejects still falls back, and the fallback is believed', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => { throw new Error('NotAllowedError') }) },
    })
    document.execCommand = vi.fn(() => true)

    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: COPY_ALL })) })

    await waitFor(() => expect(screen.getByRole('button', { name: /^copied$/i })).toBeTruthy())
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })
})

describe('Export says where the file went', () => {
  it('the packaged path reports the written path', async () => {
    vi.mocked(downloadSystemLogs).mockResolvedValue({ path: '/Users/x/Downloads/mapper_logs.txt' })

    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /export/i })) })

    const line = await screen.findByTestId('logs-saved-path')
    expect(line.textContent).toContain('/Users/x/Downloads/mapper_logs.txt')
  })

  it('a save failure is shown, not swallowed', async () => {
    vi.mocked(downloadSystemLogs).mockRejectedValue(
      new Error('Could not write the log file: read-only file system'),
    )

    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /export/i })) })

    await waitFor(() => expect(screen.getByText(/read-only file system/i)).toBeTruthy())
    expect(screen.queryByTestId('logs-saved-path')).toBeNull()
  })

  it('the browser path claims no path (the browser decides where it lands)', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /export/i })) })

    await waitFor(() => expect(downloadSystemLogs).toHaveBeenCalled())
    expect(screen.queryByTestId('logs-saved-path')).toBeNull()
    expect(screen.queryByText(/could not/i)).toBeNull()
  })
})
