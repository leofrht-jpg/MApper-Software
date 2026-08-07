/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'

// Switching bw2 projects left the Database Explorer showing the PREVIOUS
// project's database picker and activity table until a full webview reload.
// Two independent causes, both fixed together — fixing one leaves half the bug:
//
//   A. `useActivityStore` had no project-change reset (the only project-scoped
//      store missing one). `selectedDatabase` stayed truthy, so the explorer's
//      initialise effect — guarded by `!selectedDatabase` — never re-selected
//      or cleared. Because the empty state is gated on `activities.length === 0`,
//      a stale non-empty page also HID the empty state, and with it the
//      "Load demo project" button that lives inside it.
//
//   B. DemoLoadButton (and the project-guard 409 re-sync) called
//      `projectStore.fetchProjects`, which updates `currentProject` but NOT the
//      project-scoped `databases`. The demo builds its own project and switches
//      to it server-side, so the licence-free path showed "No databases in this
//      project yet" on a project that had just been populated. Both now call
//      `resyncAfterProjectChange`, which refreshes both atomically.
//      `fetchProjects` is deliberately left alone — it is the cold-boot mount
//      fetch with a tuned retry budget, and awaiting a second request inside it
//      breaks its timing contract (it took projectColdBoot's 4 tests down).
//
// The existing projectSwitcherRefetch / projectColdBoot tests pass against both
// bugs: they only exercise `fetchProjects` resilience, never render
// DatabaseExplorer, and assert nothing downstream of a project CHANGE. So the
// load-bearing thing here is that the explorer stays MOUNTED across the switch.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getProjects: vi.fn(),
    getDatabases: vi.fn(),
    getActivities: vi.fn(),
    getActivityDistinctValues: vi.fn(async () => ({ locations: [], units: [] })),
    switchProject: vi.fn(async () => undefined),
  }
})

import { useProjectStore } from '../src/stores/projectStore'
import { useActivityStore } from '../src/stores/activityStore'
import { DatabaseExplorer } from '../src/pages/DatabaseExplorer'
import * as client from '../src/api/client'

const DB_A = [{ name: 'biosphere3', records: 4362, modified: '', is_prospective: false, prospective_meta: null }]
const DB_DEMO = [
  { name: 'biosphere3', records: 4709, modified: '', is_prospective: false, prospective_meta: null },
  { name: 'demo-synthetic-technosphere', records: 5, modified: '', is_prospective: false, prospective_meta: null },
]

function activity(name: string) {
  return { name, product: name, location: 'GLO', unit: 'kilogram', code: name, key: `db|${name}`, database: 'biosphere3' }
}

/** A page of N activities, as `getActivities` returns it. */
function page(n: number, label = 'act') {
  return { items: Array.from({ length: n }, (_, i) => activity(`${label}-${i}`)), total: n }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  }
  useActivityStore.getState().reset()
  useProjectStore.setState({ projects: [], currentProject: null, databases: [], isLoading: false } as any)
})

/** Drive a project change the way the app does: backend answers, store syncs. */
async function switchTo(name: string, databases: any[]) {
  vi.mocked(client.getProjects).mockResolvedValue([
    { name: 'default', is_current: name === 'default' },
    { name: 'zz-empty', is_current: name === 'zz-empty' },
    { name: 'MApper demo (synthetic data)', is_current: name === 'MApper demo (synthetic data)' },
  ] as never)
  vi.mocked(client.getDatabases).mockResolvedValue(databases as never)
  await act(async () => {
    await useProjectStore.getState().resyncAfterProjectChange()
  })
}

describe('DatabaseExplorer follows the project across a switch (already mounted)', () => {
  it('has-databases → no-databases: picker and activity table both follow', async () => {
    // Land on a populated project first.
    vi.mocked(client.getActivities).mockResolvedValue(page(12, 'old') as never)
    await switchTo('default', DB_A)

    const { container } = render(<DatabaseExplorer />)

    // The explorer auto-selects the first database and loads its page.
    await waitFor(() => {
      expect(useActivityStore.getState().selectedDatabase).toBe('biosphere3')
      expect(useActivityStore.getState().activities.length).toBe(12)
    })
    expect(container.textContent).toContain('12 activities')

    // Now switch to a project with NO databases, WITHOUT unmounting.
    vi.mocked(client.getActivities).mockResolvedValue(page(0) as never)
    await switchTo('zz-empty', [])

    await waitFor(() => {
      // Table followed: the stale page is gone.
      expect(useActivityStore.getState().activities).toHaveLength(0)
      // Picker followed: no stale selection pointing at the old project's db.
      expect(useActivityStore.getState().selectedDatabase).toBeNull()
    })

    // And because the table is empty, the empty state renders — which is the
    // ONLY place the licence-free demo button exists.
    await waitFor(() => {
      expect(container.textContent).toContain('No databases in this project yet')
      expect(container.textContent).toContain('Load demo project')
    })
    expect(container.textContent).not.toContain('12 activities')
  })

  it('no-databases → has-databases (the demo path): picker and table follow', async () => {
    // Start on an empty project showing the demo button.
    await switchTo('zz-empty', [])
    const { container } = render(<DatabaseExplorer />)
    await waitFor(() => {
      expect(container.textContent).toContain('No databases in this project yet')
    })

    // DemoLoadButton's flow: the demo project is built + switched server-side,
    // then the frontend calls fetchProjects(). `databases` must follow.
    vi.mocked(client.getActivities).mockResolvedValue(page(7, 'demo') as never)
    await switchTo('MApper demo (synthetic data)', DB_DEMO)

    await waitFor(() => {
      expect(useProjectStore.getState().databases).toHaveLength(2)
      expect(useActivityStore.getState().selectedDatabase).toBe('biosphere3')
      expect(useActivityStore.getState().activities).toHaveLength(7)
    })

    // The "empty project" message must be gone — that was the reported symptom
    // immediately after clicking Load demo project.
    await waitFor(() => {
      expect(container.textContent).not.toContain('No databases in this project yet')
    })
    expect(container.textContent).toContain('7 activities')
  })
})

describe('the two underlying contracts', () => {
  it('A: activityStore resets when the project changes', async () => {
    useActivityStore.setState({
      selectedDatabase: 'biosphere3',
      activities: [activity('stale')],
      totalActivities: 1,
      searchQuery: 'steel',
      selectedKeys: ['db|stale'],
    } as any)

    await switchTo('zz-empty', [])

    const s = useActivityStore.getState()
    expect(s.selectedDatabase).toBeNull()
    expect(s.activities).toHaveLength(0)
    expect(s.searchQuery).toBe('')
    expect(s.selectedKeys).toHaveLength(0)
  })

  it('A2: a no-op fetchProjects (same project) does NOT wipe the activity table', async () => {
    await switchTo('default', DB_A)
    useActivityStore.setState({
      selectedDatabase: 'biosphere3',
      activities: [activity('keep')],
      totalActivities: 1,
    } as any)

    // e.g. opening the project dropdown re-fetches the list; project unchanged.
    await switchTo('default', DB_A)

    expect(useActivityStore.getState().activities).toHaveLength(1)
    expect(useActivityStore.getState().selectedDatabase).toBe('biosphere3')
  })

  it('B: resyncAfterProjectChange refreshes databases, not just the project list', async () => {
    await switchTo('default', DB_A)
    expect(useProjectStore.getState().databases).toHaveLength(1)

    await switchTo('MApper demo (synthetic data)', DB_DEMO)
    expect(useProjectStore.getState().currentProject).toBe('MApper demo (synthetic data)')
    expect(useProjectStore.getState().databases).toHaveLength(2)
  })

  it('B2: the demo button uses the resync (plain fetchProjects leaves databases stale)', async () => {
    // Land on a populated project, then have the backend move to the demo
    // project the way loadDemoProject() does (server-side switch).
    await switchTo('default', DB_A)
    vi.mocked(client.getProjects).mockResolvedValue([
      { name: 'default', is_current: false },
      { name: 'MApper demo (synthetic data)', is_current: true },
    ] as never)
    vi.mocked(client.getDatabases).mockResolvedValue(DB_DEMO as never)

    // fetchProjects alone: project follows, databases DON'T — the old bug.
    await act(async () => { await useProjectStore.getState().fetchProjects() })
    expect(useProjectStore.getState().currentProject).toBe('MApper demo (synthetic data)')
    expect(useProjectStore.getState().databases).toHaveLength(1) // stale

    // The resync the button now calls fixes it.
    await act(async () => { await useProjectStore.getState().resyncAfterProjectChange() })
    expect(useProjectStore.getState().databases).toHaveLength(2)
  })

  it('B3: fetchProjects keeps its project-list-only contract (cold-boot budget)', async () => {
    // Guards the regression that broke projectColdBoot: fetchProjects must not
    // await a databases request. getDatabases would be called if it did.
    vi.mocked(client.getProjects).mockResolvedValue([
      { name: 'default', is_current: true },
    ] as never)
    vi.mocked(client.getDatabases).mockClear()

    await act(async () => { await useProjectStore.getState().fetchProjects() })

    expect(vi.mocked(client.getDatabases)).not.toHaveBeenCalled()
  })
})
