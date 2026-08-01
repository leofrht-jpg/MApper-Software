/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import '@testing-library/jest-dom/vitest'

// No unit test should perform real network I/O. Several components fire
// fire-and-forget API calls from mount effects (getHealth, getGridIntensities,
// …); under jsdom those reach Node's real fetch, fail with ECONNREFUSED against
// the dev backend on :8000, and surface as *unhandled rejections* — nothing
// awaits them, so no component catch is attached. Vitest then exits non-zero
// with "caught N unhandled errors" even though every test passes, which would
// make CI permanently red.
//
// Install a default fetch that never settles: the mount effects stay pending
// for the lifetime of the test instead of rejecting. Tests that need real API
// behaviour are unaffected — they either vi.mock('../src/api/client') (the
// common pattern here) or assign their own globalThis.fetch, and both take
// precedence over this default.
if (typeof globalThis.fetch !== 'undefined') {
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch
}

// jsdom in vitest 4 occasionally fails to wire up window.localStorage
// (the `--localstorage-file` warning at runner startup). Components like
// ChartExportButton call localStorage.getItem during render — install a
// minimal in-memory shim so tests don't blow up at mount.
if (typeof window !== 'undefined' && typeof window.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>()
  const shim: Storage = {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k) },
    setItem: (k, v) => { store.set(k, String(v)) },
  }
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true })
}
