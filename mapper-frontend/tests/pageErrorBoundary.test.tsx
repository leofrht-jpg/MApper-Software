/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * A tab that throws while rendering shows the error IN the content area and
 * leaves the sidebar working. Before, the only boundary was the root one,
 * which replaced the whole app, sidebar included.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../src/pages/MonteCarlo', () => ({
  MonteCarloPage: () => { throw new Error('probe: the Uncertainty tab failed to render') },
}))

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>()
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(actual)) {
    // Every read resolves empty, so App mounts without a backend.
    out[k] = typeof v === 'function' && /^(get|list|fetch|search)/.test(k) ? vi.fn().mockResolvedValue([]) : v
  }
  return out
})
vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
  new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })))

describe('per-tab error boundary', () => {
  it('keeps the sidebar and names the error when one tab throws', async () => {
    try { localStorage.setItem('mapper-onboarding-complete', '1') } catch { /* no storage */ }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const App = (await import('../src/App')).default
    render(<App />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

    await act(async () => { fireEvent.click(screen.getByLabelText('Uncertainty')) })
    const fallback = screen.getByTestId('page-error-uncertainty')
    expect(fallback.textContent).toContain('the Uncertainty tab failed to render')
    // The sidebar is still there and still navigates; leaving the tab clears the error.
    await act(async () => { fireEvent.click(screen.getByLabelText('Settings')) })
    expect(screen.queryByTestId('page-error-uncertainty')).toBeNull()
  })
})
