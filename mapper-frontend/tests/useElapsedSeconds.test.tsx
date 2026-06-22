/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useElapsedSeconds } from '../src/hooks/useElapsedSeconds'

// Patch 5S Part C — the live compute timer reuses useElapsedSeconds. Lock the
// LIFECYCLE (interval created while active, cleared on completion AND unmount),
// never specific displayed seconds. Fake timers are isolated to this file and
// torn down in afterEach.

describe('useElapsedSeconds — timer lifecycle', () => {
  let setSpy: ReturnType<typeof vi.spyOn>
  let clearSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    setSpy = vi.spyOn(globalThis, 'setInterval')
    clearSpy = vi.spyOn(globalThis, 'clearInterval')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts an interval while active and ticks upward', () => {
    const { result } = renderHook(({ active }) => useElapsedSeconds(active), {
      initialProps: { active: true },
    })
    expect(setSpy).toHaveBeenCalled()      // interval created while pending
    expect(result.current).toBe(0)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current).toBeGreaterThan(0)  // ticks upward (don't assert exact)
  })

  it('clears the interval on completion (active → false)', () => {
    const { rerender } = renderHook(({ active }) => useElapsedSeconds(active), {
      initialProps: { active: true },
    })
    clearSpy.mockClear()
    act(() => { rerender({ active: false }) })
    expect(clearSpy).toHaveBeenCalled()    // interval cleared when compute finishes
  })

  it('clears the interval on unmount (no leak)', () => {
    const { unmount } = renderHook(({ active }) => useElapsedSeconds(active), {
      initialProps: { active: true },
    })
    clearSpy.mockClear()
    act(() => { unmount() })
    expect(clearSpy).toHaveBeenCalled()    // interval cleared on unmount
  })

  it('does NOT start an interval while inactive', () => {
    setSpy.mockClear()
    renderHook(({ active }) => useElapsedSeconds(active), { initialProps: { active: false } })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('resets to 0 on each active→true transition', () => {
    const { result, rerender } = renderHook(({ active }) => useElapsedSeconds(active), {
      initialProps: { active: true },
    })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBeGreaterThan(0)
    act(() => { rerender({ active: false }) })
    expect(result.current).toBe(0)
    act(() => { rerender({ active: true }) })
    expect(result.current).toBe(0)        // fresh run starts from 0
  })
})
