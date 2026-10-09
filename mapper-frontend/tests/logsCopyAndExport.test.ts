/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Settings › Logs: "Copy all" and "Export" did nothing in the packaged app.
 *
 * Export: `<a download>` on a `blob:` URL. WKWebView needs a download delegate,
 * and the page is on a remote http origin (the backend serves the SPA at
 * localhost:8765), so the click produced no file, no error and no event. The
 * packaged app now asks the backend to write the file.
 *
 * Copy: `document.execCommand('copy')` RETURNS false when it does nothing — it
 * does not throw — and the old helper treated "did not throw" as success, so a
 * no-op copy reported success and the caller discarded even that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { downloadSystemLogs, isPackagedDesktop } from '../src/api/client'

const DEV_PORT = '5173'
const APP_PORT = '8765'

function setPort(port: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, port, origin: `http://localhost:${port}` },
    writable: true, configurable: true,
  })
}

let fetchSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('which save path runs', () => {
  it('the dev browser is not mistaken for the packaged app', () => {
    setPort(DEV_PORT)
    expect(isPackagedDesktop()).toBe(false)
    setPort(APP_PORT)
    expect(isPackagedDesktop()).toBe(true)
  })

  it('the packaged app asks the BACKEND to write the file', async () => {
    setPort(APP_PORT)
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ path: '/Users/x/Downloads/mapper_logs_2026-10-08.txt', bytes: 12 }),
      text: async () => '',
    })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    const res = await downloadSystemLogs()
    expect(fetchSpy.mock.calls[0][0]).toContain('/system/logs/save')
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('POST')
    expect(res.path).toBe('/Users/x/Downloads/mapper_logs_2026-10-08.txt')
    // The anchor download is the thing that silently failed there.
    expect(anchorClick, 'the packaged app must not rely on an <a download>')
      .not.toHaveBeenCalled()
    anchorClick.mockRestore()
  })

  it('the browser still gets its blob download, unchanged', async () => {
    setPort(DEV_PORT)
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      blob: async () => new Blob(['log text']),
      text: async () => '',
    })
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const res = await downloadSystemLogs()
    expect(fetchSpy.mock.calls[0][0]).toContain('/system/logs/export')
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(res.path, 'the browser path saves wherever the browser decides').toBeNull()
    anchorClick.mockRestore()
  })

  it('a backend failure reaches the caller instead of vanishing', async () => {
    setPort(APP_PORT)
    fetchSpy.mockResolvedValue({
      ok: false, status: 500,
      text: async () => '{"detail":"Could not write /x: read-only file system"}',
      json: async () => ({ detail: 'Could not write /x: read-only file system' }),
    })
    await expect(downloadSystemLogs()).rejects.toThrow(/read-only file system/)
  })
})
