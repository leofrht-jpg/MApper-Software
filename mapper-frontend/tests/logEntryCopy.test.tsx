/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { LogsPanel } from '../src/pages/SettingsPage'
import { useLogStore, type LogEntry } from '../src/stores/logStore'

// Patch — per-entry Copy button in the Logs section. Smoke test: render
// SettingsPage with a seeded log entry that has a stack, expand the
// entry, click the per-entry Copy button, and assert the clipboard
// received the expected per-entry text. Also covers the brief
// "Copied ✓" feedback flip.
//
// Determinism (Patch 5L). ROOT CAUSE: the mock named the WRONG function.
// `LogsPanel`'s mount effect calls `getSystemLogs(500)`, but this test mocked
// `fetchSystemLogs` (a name the panel never calls). So the REAL `getSystemLogs`
// ran on mount → a real network `fetch` whose resolve/reject timing varies
// with machine load → `setLoading`/`setLoadError`/`setBackendLines` fired at
// unpredictable moments DURING the test, re-rendering the row mid-interaction.
// That is the load-dependent, order-independent flake (looked like "writeText
// 0 times" / "Copied ✓ not found" / the row's button vanishing). Mocking the
// CORRECT function makes the mount resolve immediately and deterministically —
// no stray network call, no mid-test re-render.
//
// Belt-and-suspenders: the copy click is flushed inside `await act(async …)`
// and assertions run synchronously after, so they also can't race the
// component's 1500ms "Copied ✓" → "Copy" revert. No real network, no waitFor,
// no fake timers.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    // The panel's mount fetch — correct name + return shape (`log_path`).
    getSystemLogs: vi.fn(async () => ({ lines: [], total: 0, log_path: '/tmp/mapper.log' })),
    downloadSystemLogs: vi.fn(async () => undefined),
  }
})

const SAMPLE_ENTRY: LogEntry = {
  id: 1,
  timestamp: '2026-05-04T12:34:56.000Z',
  level: 'error',
  source: 'frontend',
  module: 'react',
  message: 'Boom — something exploded',
  stack: 'Error: Boom — something exploded\n  at App (App.tsx:1:1)',
}

// LogRow keys frontend entries as `f-${id}` in SettingsPage's
// translation step; mirror that here for the testid lookup.
const SAMPLE_KEY = `f-${SAMPLE_ENTRY.id}`
const COPY_ID = `log-entry-copy-${SAMPLE_KEY}`

beforeEach(() => {
  // @ts-expect-error - jsdom stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  useLogStore.setState({ entries: [SAMPLE_ENTRY] })
  // jsdom doesn't ship with a real Clipboard API; define a stub so the
  // primary `navigator.clipboard.writeText` path runs (vs the textarea
  // execCommand fallback, which jsdom also doesn't support cleanly).
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  })
})

describe('Logs section — per-entry Copy button', () => {
  it('copies the formatted entry text and flips the label to Copied', async () => {
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>
    const { findByText, findByTestId, getByTestId } = render(<LogsPanel version="0.0.0-test" />)

    // Expand the entry's stack box so the per-entry Copy button renders.
    fireEvent.click(await findByText('Show details'))
    await findByTestId(COPY_ID)
    expect(getByTestId(COPY_ID)).toHaveTextContent('Copy')

    // Click + flush the async copy handler in one act: the awaited clipboard
    // write and the resulting "Copied ✓" state update both settle before act
    // returns. The inner microtask yields drain the await chain
    // (handler → copyToClipboard → writeText) defensively.
    await act(async () => {
      fireEvent.click(getByTestId(COPY_ID))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Clipboard received the formatted entry text (deterministic — act flushed
    // the write; no waitFor window to lose under load).
    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain('[ERROR]')
    expect(text).toContain('frontend/react')
    expect(text).toContain('Boom — something exploded')
    expect(text).toContain('at App (App.tsx:1:1)')

    // Label has flipped to "Copied ✓". Asserted synchronously right after the
    // act flush, so it can't race the component's 1500ms revert-to-"Copy".
    expect(getByTestId(COPY_ID)).toHaveTextContent('Copied ✓')
  })
})
