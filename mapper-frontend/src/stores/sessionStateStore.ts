/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Panel state that must outlive the panel.
//
// App mounts ONE page at a time (`App.tsx` renders the active tab only), so
// every `useState` in a page is lost the moment the user opens another tab.
// For a form value that is merely annoying; for a computed result it means a
// finished calculation disappears when the user glances at another tab and
// comes back. `useSessionState` is a drop-in for `useState` that keeps the
// value in this store instead, under a caller-chosen key.
//
// Project-scoped, like every other project store: everything here belongs to
// the project it was computed in and is dropped when the project changes.
// Session-only: nothing is written to disk or localStorage.

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { create } from 'zustand'
import { useProjectStore } from './projectStore'

interface SessionStateStore {
  values: Record<string, unknown>
  setValue: (key: string, value: unknown) => void
  reset: () => void
}

export const useSessionStateStore = create<SessionStateStore>((set) => ({
  values: {},
  setValue: (key, value) => set((s) => ({ values: { ...s.values, [key]: value } })),
  reset: () => set({ values: {} }),
}))

/**
 * `useState`, but the value survives the component unmounting.
 *
 * `initial` is used only while nothing is stored under `key`; it is evaluated
 * once per key, so the returned default is reference-stable (an effect keyed
 * on it does not loop). Changing `key` (e.g. per archetype) switches to that
 * key's stored value, or to a fresh default.
 */
export function useSessionState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const has = useSessionStateStore((s) => Object.prototype.hasOwnProperty.call(s.values, key))
  const stored = useSessionStateStore((s) => s.values[key]) as T | undefined

  const defaultRef = useRef<{ key: string; value: T } | null>(null)
  if (defaultRef.current === null || defaultRef.current.key !== key) {
    defaultRef.current = {
      key,
      value: typeof initial === 'function' ? (initial as () => T)() : initial,
    }
  }
  const fallback = defaultRef.current.value
  const value = has ? (stored as T) : fallback

  const setter = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const st = useSessionStateStore.getState()
    const cur = Object.prototype.hasOwnProperty.call(st.values, key) ? (st.values[key] as T) : fallback
    const v = typeof next === 'function' ? (next as (p: T) => T)(cur) : next
    if (Object.is(v, cur) && Object.prototype.hasOwnProperty.call(st.values, key)) return
    st.setValue(key, v)
  }, [key, fallback])

  return [value, setter]
}

// Tests reset this between cases (tests/setup.ts) without importing it: kept
// state from one test must not satisfy the next, the frontend twin of the
// backend conftest clearing its registries.
;(globalThis as { __mapperResetSessionState?: () => void }).__mapperResetSessionState =
  () => useSessionStateStore.getState().reset()

let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useSessionStateStore.getState().reset()
})
