/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { useProjectStore } from '../src/stores/projectStore'

// Bug: the project dropdown showed "No projects found" even though the backend
// returned projects — the mount fetch raced an unready sidecar, failed, and was
// never retried. Fixes: (A) fetchProjects retries transient network failures and
// never clobbers/rethrows; (B) opening the dropdown re-fetches fresh.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, getProjects: vi.fn(), getDatabases: vi.fn() }
})

const PROJECTS = [
  { name: 'default', is_current: true },
  { name: 'MAp-test', is_current: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  useProjectStore.setState({ projects: [], currentProject: null, isLoading: false })
})

describe('project list resilience', () => {
  it('A: a delayed/unready sidecar is retried — the list populates once the backend responds', async () => {
    const client = await import('../src/api/client')
    // First attempt fails at the network layer (sidecar not ready); the retry
    // succeeds — the real withTransientRetry backoff runs (~400ms).
    vi.mocked(client.getProjects)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(PROJECTS as never)

    await useProjectStore.getState().fetchProjects()

    const s = useProjectStore.getState()
    expect(s.projects).toHaveLength(2)
    expect(s.currentProject).toBe('default')
    expect(vi.mocked(client.getProjects).mock.calls.length).toBeGreaterThanOrEqual(2)
  }, 10000)

  it('A2: a persistent failure does NOT clobber existing projects and does NOT throw', async () => {
    const client = await import('../src/api/client')
    // Seed a populated list, then have every attempt fail transiently.
    useProjectStore.setState({ projects: PROJECTS as never, currentProject: 'default' })
    vi.mocked(client.getProjects).mockRejectedValue(new TypeError('Failed to fetch'))

    // Must resolve (not reject) so App's mount chain isn't broken.
    await expect(useProjectStore.getState().fetchProjects()).resolves.toBeUndefined()
    expect(useProjectStore.getState().projects).toHaveLength(2) // not clobbered to []
  }, 10000)

  it('B: opening the dropdown re-fetches fresh (closing does not)', async () => {
    const fetchProjects = vi.fn().mockResolvedValue(undefined)
    useProjectStore.setState({
      projects: [], currentProject: null, isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchProjects: fetchProjects as any,
    })
    const { ProjectSwitcher } = await import('../src/components/ProjectSwitcher')
    const { getByText, container } = render(<ProjectSwitcher />)

    const toggle = getByText('Select project').closest('button') as HTMLButtonElement
    fireEvent.click(toggle) // open → re-fetch
    await waitFor(() => expect(fetchProjects).toHaveBeenCalledTimes(1))

    fireEvent.click(toggle) // close → no re-fetch
    expect(fetchProjects).toHaveBeenCalledTimes(1)
    void container
  })
})
