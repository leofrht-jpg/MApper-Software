/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { exportAESA, exportImpact } from '../src/api/client'

// The export download helpers must PREFER the backend's Content-Disposition
// filename over the client-built fallback — the server name carries the
// contributing subsystem (e.g. AESA passes []). This is the JS half of the
// cross-origin fix: the backend now exposes the header (CORS expose_headers),
// so the browser can read it here. Assert the anchor's `download` = server name.

let lastAnchor: { download: string; href: string; click: () => void }

function makeFetchMock(contentDisposition: string | null) {
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-disposition' ? contentDisposition : null) },
    blob: async () => new Blob(['x']),
  })
}

beforeEach(() => {
  lastAnchor = { download: '', href: '', click: () => {} }
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'a') {
      lastAnchor = { download: '', href: '', click: vi.fn() }
      return lastAnchor as unknown as HTMLElement
    }
    return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement
  }) as typeof document.createElement)
  vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n as never)
  vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n as never)
  ;(globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:fake')
  ;(globalThis as any).URL.revokeObjectURL = vi.fn()
})

afterEach(() => vi.restoreAllMocks())

const SERVER_NAME = 'Car_Fleet+Fueling_Infrastructure_AESA.xlsx'

describe('export downloads prefer the server Content-Disposition filename', () => {
  it('exportAESA uses the server name when the header is present', async () => {
    ;(globalThis as any).fetch = makeFetchMock(`attachment; filename="${SERVER_NAME}"`)
    await exportAESA({} as any, { results: [] } as any, 'Car_Fleet_AESA.xlsx')
    // Server name (with subsystem) wins over the client fallback (without it).
    expect(lastAnchor.download).toBe(SERVER_NAME)
  })

  it('exportAESA falls back to the client name when the header is absent', async () => {
    // The pre-fix cross-origin state: header hidden → null → fallback used.
    ;(globalThis as any).fetch = makeFetchMock(null)
    await exportAESA({} as any, { results: [] } as any, 'Car_Fleet_AESA.xlsx')
    expect(lastAnchor.download).toBe('Car_Fleet_AESA.xlsx')
  })

  it('exportImpact uses the server name when the header is present', async () => {
    const name = 'Car_Fleet+Fueling_Infrastructure_pLCA.xlsx'
    ;(globalThis as any).fetch = makeFetchMock(`attachment; filename="${name}"`)
    await exportImpact({ result: {} as any }, 'Car_Fleet_pLCA.xlsx')
    expect(lastAnchor.download).toBe(name)
  })
})
