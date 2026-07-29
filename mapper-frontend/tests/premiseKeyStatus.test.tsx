/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { getPremiseKeyStatus } from '../src/api/client'

// The premise key-status endpoint is project-independent (always 200s when
// reached), so a "Load failed" is a first-paint network race, NOT a real
// failure. getPremiseKeyStatus retries transiently; a persistent failure shows
// a plain "couldn't reach the backend" message, never the raw "Load failed".

describe('getPremiseKeyStatus — transient retry', () => {
  afterEach(() => vi.restoreAllMocks())

  it('recovers when the first fetch is a transient network error', async () => {
    let calls = 0
    ;(globalThis as any).fetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('Load failed')          // WKWebView network reject
      return { ok: true, json: async () => ({ configured: true, path: '~/.premise/premise_key' }) }
    })
    const s = await getPremiseKeyStatus()
    expect(calls).toBe(2)
    expect(s.configured).toBe(true)
  })
})

describe('PremiseKeyManager — messaging on persistent network failure', () => {
  beforeEach(() => {
    // @ts-expect-error minimal stub
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows a plain reachability message, not raw "Load failed"', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => { throw new TypeError('Load failed') })
    const { PremiseKeyManager } = await import('../src/components/PremiseKeyManager')
    const { container } = render(<PremiseKeyManager variant="panel" />)
    await waitFor(() => {
      expect(container.textContent).toContain("Couldn't reach the backend")
    })
    expect(container.textContent).not.toContain('Load failed')
  })
})
