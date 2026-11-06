/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { create } from 'zustand'
import {
  type ActivityDetail,
  type ActivityDistinctValues,
  type ActivitySortBy,
  type ActivitySummary,
  getActivities,
  getActivityDetail,
  getActivityDistinctValues,
} from '../api/client'
import { useProjectStore } from './projectStore'

interface ActivityStore {
  selectedDatabase: string | null
  activities: ActivitySummary[]
  totalActivities: number
  offset: number
  searchQuery: string

  // Filter state
  selectedLocations: string[]
  selectedUnits: string[]
  sortBy: ActivitySortBy
  distinctValues: ActivityDistinctValues
  isLoadingDistinct: boolean

  // Selection (multi-select) state
  selectedKeys: string[]                // activity.key values, insertion order
  selectedActivitiesByKey: Record<string, ActivitySummary>
  lastClickIndex: number | null         // for shift-click range select

  // Detail view state
  selectedActivity: ActivityDetail | null   // when non-null, right panel shows detail
  isLoadingDetail: boolean
  isLoading: boolean

  // Actions
  setDatabase: (name: string) => void
  fetchActivities: (append?: boolean) => Promise<void>
  searchActivities: (query: string) => void
  setLocations: (locations: string[]) => void
  setUnits: (units: string[]) => void
  setSortBy: (sort: ActivitySortBy) => void
  clearFilters: () => void

  toggleActivity: (act: ActivitySummary, index: number) => void
  rangeSelect: (act: ActivitySummary, index: number) => void
  replaceSelection: (act: ActivitySummary, index: number) => void
  removeFromSelection: (key: string) => void
  clearSelection: () => void

  openDetail: (database: string, code: string) => Promise<void>
  closeDetail: () => void

  loadMore: () => Promise<void>

  /** Clear every project-scoped slot. Fired when the bw2 project changes. */
  reset: () => void
}

const PAGE_SIZE = 50

// Which query the list currently belongs to. A search, a filter, a sort or a
// database change starts a new generation; a page response is applied only if
// it was asked for in the current one. Without this a slow page of the previous
// query landed on the new query's rows (and its `finally` cleared `isLoading`
// while the new request was still running, which let a second page request
// start for the same offset).
let generation = 0
let inflight: AbortController | null = null

function supersede(): void {
  generation += 1
  inflight?.abort()
  inflight = null
}

const INITIAL_DISTINCT: ActivityDistinctValues = { locations: [], units: [] }

export const useActivityStore = create<ActivityStore>((set, get) => ({
  selectedDatabase: null,
  activities: [],
  totalActivities: 0,
  offset: 0,
  searchQuery: '',
  selectedLocations: [],
  selectedUnits: [],
  sortBy: 'name_asc',
  distinctValues: INITIAL_DISTINCT,
  isLoadingDistinct: false,
  selectedKeys: [],
  selectedActivitiesByKey: {},
  lastClickIndex: null,
  selectedActivity: null,
  isLoadingDetail: false,
  isLoading: false,

  setDatabase: (name) => {
    // Database change clears selection + detail + filters' chosen values AND
    // the search query — a stale query from a prior db can make the new one
    // look empty (e.g. it had matches in ecoinvent but none in a premise
    // variant where activities are renamed). Sort preference is preserved.
    set({
      selectedDatabase: name,
      activities: [],
      totalActivities: 0,
      offset: 0,
      searchQuery: '',
      selectedActivity: null,
      selectedKeys: [],
      selectedActivitiesByKey: {},
      lastClickIndex: null,
      selectedLocations: [],
      selectedUnits: [],
      distinctValues: INITIAL_DISTINCT,
      isLoadingDistinct: true,
    })
    get().fetchActivities()
    getActivityDistinctValues(name)
      .then((dv) => set({ distinctValues: dv, isLoadingDistinct: false }))
      .catch(() => set({ isLoadingDistinct: false }))
  },

  fetchActivities: async (append = false) => {
    const { selectedDatabase, searchQuery, selectedLocations, selectedUnits, sortBy } = get()
    if (!selectedDatabase) return
    // A fresh load replaces whatever is in flight; a page append belongs to the
    // query it was asked for and is dropped if that query has been replaced.
    if (!append) supersede()
    const gen = generation
    const controller = new AbortController()
    inflight = controller
    // The next page starts after the rows actually held, not after a counter
    // that a stale response could have moved.
    const offset = append ? get().activities.length : 0
    set({ isLoading: true })
    try {
      const page = await getActivities(
        selectedDatabase,
        offset,
        PAGE_SIZE,
        searchQuery || undefined,
        { locations: selectedLocations, units: selectedUnits, sortBy },
        controller.signal,
      )
      if (gen !== generation) return
      set((s) => {
        if (!append) return { activities: page.items, totalActivities: page.total, offset: page.items.length }
        // Append, never replace; a row already held (same database + code) is not added twice.
        const held = new Set(s.activities.map((a) => a.key))
        const next = [...s.activities, ...page.items.filter((a) => !held.has(a.key))]
        return { activities: next, totalActivities: page.total, offset: next.length }
      })
    } catch (e) {
      // An aborted request belongs to a query that was replaced: not an error.
      if (gen !== generation || (e instanceof DOMException && e.name === 'AbortError')) return
      throw e
    } finally {
      if (gen === generation) {
        set({ isLoading: false })
        if (inflight === controller) inflight = null
      }
    }
  },

  searchActivities: (query) => {
    set({ searchQuery: query, activities: [], offset: 0 })
    get().fetchActivities()
  },

  setLocations: (locations) => {
    set({ selectedLocations: locations, activities: [], offset: 0 })
    get().fetchActivities()
  },

  setUnits: (units) => {
    set({ selectedUnits: units, activities: [], offset: 0 })
    get().fetchActivities()
  },

  setSortBy: (sort) => {
    set({ sortBy: sort, activities: [], offset: 0 })
    get().fetchActivities()
  },

  clearFilters: () => {
    set({
      searchQuery: '',
      selectedLocations: [],
      selectedUnits: [],
      sortBy: 'name_asc',
      activities: [],
      offset: 0,
    })
    get().fetchActivities()
  },

  toggleActivity: (act, index) => {
    set((s) => {
      const exists = !!s.selectedActivitiesByKey[act.key]
      if (exists) {
        const { [act.key]: _removed, ...rest } = s.selectedActivitiesByKey
        return {
          selectedKeys: s.selectedKeys.filter((k) => k !== act.key),
          selectedActivitiesByKey: rest,
          lastClickIndex: index,
        }
      }
      return {
        selectedKeys: [...s.selectedKeys, act.key],
        selectedActivitiesByKey: { ...s.selectedActivitiesByKey, [act.key]: act },
        lastClickIndex: index,
      }
    })
  },

  rangeSelect: (_act, index) => {
    const { lastClickIndex, activities, selectedKeys, selectedActivitiesByKey } = get()
    const anchor = lastClickIndex ?? index
    const [lo, hi] = anchor <= index ? [anchor, index] : [index, anchor]
    const keys = new Set(selectedKeys)
    const map = { ...selectedActivitiesByKey }
    const orderedKeys = [...selectedKeys]
    for (let i = lo; i <= hi; i++) {
      const a = activities[i]
      if (!a || keys.has(a.key)) continue
      keys.add(a.key)
      map[a.key] = a
      orderedKeys.push(a.key)
    }
    set({ selectedKeys: orderedKeys, selectedActivitiesByKey: map, lastClickIndex: index })
  },

  replaceSelection: (act, index) => {
    set({
      selectedKeys: [act.key],
      selectedActivitiesByKey: { [act.key]: act },
      lastClickIndex: index,
    })
  },

  removeFromSelection: (key) => {
    set((s) => {
      const { [key]: _r, ...rest } = s.selectedActivitiesByKey
      return {
        selectedKeys: s.selectedKeys.filter((k) => k !== key),
        selectedActivitiesByKey: rest,
      }
    })
  },

  clearSelection: () => set({
    selectedKeys: [],
    selectedActivitiesByKey: {},
    lastClickIndex: null,
    selectedActivity: null,
  }),

  openDetail: async (database, code) => {
    set({ isLoadingDetail: true })
    try {
      const detail = await getActivityDetail(database, code)
      set({ selectedActivity: detail })
    } finally {
      set({ isLoadingDetail: false })
    }
  },

  closeDetail: () => set({ selectedActivity: null }),

  loadMore: async () => {
    const { activities, totalActivities, isLoading } = get()
    if (isLoading || activities.length >= totalActivities) return
    await get().fetchActivities(true)
  },

  reset: () => {
    supersede()
    set({
      selectedDatabase: null,
      activities: [],
      totalActivities: 0,
      offset: 0,
      searchQuery: '',
      selectedLocations: [],
      selectedUnits: [],
      distinctValues: INITIAL_DISTINCT,
      isLoadingDistinct: false,
      selectedKeys: [],
      selectedActivitiesByKey: {},
      lastClickIndex: null,
      selectedActivity: null,
      isLoadingDetail: false,
      isLoading: false,
    })
  },
}))

// Reset when project changes.
//
// This store is project-scoped (a database name and an activity page are only
// meaningful within one bw2 project) but was the ONLY such store without this
// subscription — bomStore / dsmStore / aesaStore / impactStore / plcaStore /
// parameterStore / subsystemStore all have it.
//
// Without it, switching projects left `selectedDatabase` pointing at the old
// project's db and `activities` holding the old page. DatabaseExplorer's
// initialise effect is guarded by `!selectedDatabase`, so a stale-but-truthy
// value made it a no-op: no re-select, no refetch, no clear. The picker then
// rendered no matching option, and because the empty state is gated on
// `activities.length === 0`, a stale non-empty page hid it — taking the
// "Load demo project" button, which lives inside that empty state, with it.
//
// Reset only: the explorer's own effect re-selects `databases[0]` once
// `selectedDatabase` is null and the new project's database list has landed,
// so the selection logic stays in one place.
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useActivityStore.getState().reset()
})
