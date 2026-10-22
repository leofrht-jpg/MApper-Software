/* SPDX-License-Identifier: MPL-2.0 */
/**
 * Settings › Logs: after Export in the packaged app, a "Reveal in Finder"
 * button beside the saved path asks the backend to show the file.
 *
 * Through the REAL client (`downloadSystemLogs`, `revealSavedFile`, `request`)
 * with only `fetch` answered, so the URL and body the backend receives are the
 * ones asserted. The backend half is tests/test_reveal_saved_file.py.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { LogsPanel } from '../src/pages/SettingsPage'

const SAVED = '/Users/me/Downloads/mapper_logs_2026-10-21.txt'

function serve(port: string) {
  vi.stubGlobal('location', { ...window.location, port })
  const calls: { url: string; body?: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body as string | undefined })
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (String(url).includes('/system/logs/save')) return json({ path: SAVED, bytes: 3 })
    if (String(url).includes('/system/reveal')) return json({ revealed: SAVED })
    if (String(url).includes('/system/logs/export')) return new Response('log', { status: 200 })
    return json({ lines: [], total: 0, log_path: '/tmp/mapper.log' })
  }))
  return calls
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Reveal in Finder', () => {
  it('appears beside the saved path in the packaged app and reveals THAT file', async () => {
    const calls = serve('8765')
    render(<LogsPanel version="0.3.0" />)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^export$/i })) })
    await waitFor(() => expect(screen.getByTestId('logs-saved-path').textContent).toContain(SAVED))
    await act(async () => { fireEvent.click(screen.getByTestId('logs-reveal')) })
    const reveal = calls.find((c) => c.url.includes('/system/reveal'))
    expect(reveal, 'the button must reach the backend').toBeTruthy()
    expect(JSON.parse(reveal!.body!)).toEqual({ path: SAVED })
  })

  it('is absent in a browser, where the download has no path to show', async () => {
    serve('5173')
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    render(<LogsPanel version="0.3.0" />)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^export$/i })) })
    expect(screen.queryByTestId('logs-reveal')).toBeNull()
  })
})
