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
}

const PAGE_SIZE = 50

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
    // Database change clears selection + detail + filters' chosen values but
    // keeps the sort preference. Distinct values refetch in parallel.
    set({
      selectedDatabase: name,
      activities: [],
      totalActivities: 0,
      offset: 0,
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
    const { selectedDatabase, searchQuery, offset, selectedLocations, selectedUnits, sortBy } = get()
    if (!selectedDatabase) return
    set({ isLoading: true })
    try {
      const page = await getActivities(
        selectedDatabase,
        append ? offset : 0,
        PAGE_SIZE,
        searchQuery || undefined,
        { locations: selectedLocations, units: selectedUnits, sortBy },
      )
      set((s) => ({
        activities: append ? [...s.activities, ...page.items] : page.items,
        totalActivities: page.total,
        offset: append ? offset + page.items.length : page.items.length,
      }))
    } finally {
      set({ isLoading: false })
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
}))
