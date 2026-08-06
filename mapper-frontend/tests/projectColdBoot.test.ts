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
import {
  useProjectStore, PROJECT_FETCH_ATTEMPTS, PROJECT_FETCH_BASE_DELAY_MS,
  projectFetchRetryWindowMs,
} from '../src/stores/projectStore'
import * as client from '../src/api/client'

// The desktop sidecar is not reachable the instant the SPA mounts: the app
// window opens immediately while the frozen backend still imports bw2 and
// scipy. Measured time-to-first-200 on the packaged macOS build is 5–15 s.
//
// `App`'s mount effect fires `fetchProjects()` once, fire-and-forget. If that
// call gives up before the sidecar answers, the list stays empty FOREVER — the
// store swallows the error by design (rethrowing would break App's mount chain)
// and nothing re-fetches until the user opens the project dropdown.
//
// So the assertion that matters is not "the retry helper was called" — it is
// "with a sidecar that takes N seconds to come up, the store ends up holding
// the projects". These tests drive the real `fetchProjects` against a
// `getProjects` that rejects like an unreachable port and then succeeds.

const PROJECTS = [
  { name: 'default', is_current: true },
  { name: 'MAp-test', is_current: false },
  { name: 'MApper demo (synthetic data)', is_current: false },
]

/** What `fetch` rejects with when nothing is listening on the port. */
function connectionRefused(): Error {
  return new TypeError('Failed to fetch')
}

/** getProjects that fails `failures` times, then answers. */
function sidecarUpAfter(failures: number) {
  let calls = 0
  return vi.fn(async () => {
    calls += 1
    if (calls <= failures) throw connectionRefused()
    return PROJECTS as any
  })
}

beforeEach(() => {
  useProjectStore.setState({ projects: [], currentProject: null, isLoading: false } as any)
  vi.restoreAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Run fetchProjects to completion, flushing the retry backoff. */
async function runWithTimers(): Promise<void> {
  const p = useProjectStore.getState().fetchProjects()
  await vi.runAllTimersAsync()
  await p
}

describe('the project list survives a slow sidecar', () => {
  it('populates when the sidecar answers on the first try', async () => {
    vi.spyOn(client, 'getProjects').mockImplementation(sidecarUpAfter(0))
    await runWithTimers()
    expect(useProjectStore.getState().projects).toHaveLength(3)
    expect(useProjectStore.getState().currentProject).toBe('default')
  })

  it('populates when the sidecar refuses the first few connections', async () => {
    const getProjects = sidecarUpAfter(4)
    vi.spyOn(client, 'getProjects').mockImplementation(getProjects)
    await runWithTimers()
    expect(getProjects).toHaveBeenCalledTimes(5)
    // The list is POPULATED — not merely "the retry ran".
    expect(useProjectStore.getState().projects.map((p) => p.name))
      .toEqual(['default', 'MAp-test', 'MApper demo (synthetic data)'])
    expect(useProjectStore.getState().currentProject).toBe('default')
  })

  it('survives a sidecar that only answers on the last allowed attempt', async () => {
    const getProjects = sidecarUpAfter(PROJECT_FETCH_ATTEMPTS - 1)
    vi.spyOn(client, 'getProjects').mockImplementation(getProjects)
    await runWithTimers()
    expect(getProjects).toHaveBeenCalledTimes(PROJECT_FETCH_ATTEMPTS)
    expect(useProjectStore.getState().projects).toHaveLength(3)
  })

  it('leaves the list empty (not crashing) when the sidecar never comes up', async () => {
    vi.spyOn(client, 'getProjects').mockImplementation(
      vi.fn(async () => { throw connectionRefused() }),
    )
    await expect(runWithTimers()).resolves.toBeUndefined()  // never rethrows
    expect(useProjectStore.getState().projects).toEqual([])
    expect(useProjectStore.getState().isLoading).toBe(false)
  })

  it('does NOT clobber an already-loaded list when a later fetch fails', async () => {
    vi.spyOn(client, 'getProjects').mockImplementation(sidecarUpAfter(0))
    await runWithTimers()
    expect(useProjectStore.getState().projects).toHaveLength(3)

    vi.spyOn(client, 'getProjects').mockImplementation(
      vi.fn(async () => { throw connectionRefused() }),
    )
    await runWithTimers()
    expect(useProjectStore.getState().projects).toHaveLength(3)
  })

  it('gives up immediately on a real HTTP error — not a transient one', async () => {
    // A 500 is a real server response; retrying it would mask a genuine fault.
    const getProjects = vi.fn(async () => { throw new client.HttpError(500, 'boom') })
    vi.spyOn(client, 'getProjects').mockImplementation(getProjects as any)
    await runWithTimers()
    expect(getProjects).toHaveBeenCalledTimes(1)
  })
})

describe('the retry window covers a real cold boot', () => {
  it('waits longer than the slowest observed packaged-build start', () => {
    // Measured on the packaged macOS build: first 200 at 5–15 s, the tail being
    // bw2 + scipy imports plus a one-off matplotlib font-cache rebuild. The
    // window must clear that with margin, or a healthy-but-slow sidecar shows
    // an empty project list.
    const SLOWEST_OBSERVED_BOOT_MS = 15_000
    expect(projectFetchRetryWindowMs()).toBeGreaterThan(SLOWEST_OBSERVED_BOOT_MS)
  })

  it('the backoff is linear, so the window is the sum of baseDelay × attempt', () => {
    // Guards against reading the budget as exponential: 10 × 500 ms is 22.5 s
    // of waiting, not 500 × 2^9.
    expect(projectFetchRetryWindowMs(10, 500)).toBe(22_500)
    expect(projectFetchRetryWindowMs(6, 400)).toBe(6_000)  // the old, too-short budget
  })

  it('exposes the constants the store actually uses', () => {
    expect(PROJECT_FETCH_ATTEMPTS).toBe(10)
    expect(PROJECT_FETCH_BASE_DELAY_MS).toBe(500)
  })
})
