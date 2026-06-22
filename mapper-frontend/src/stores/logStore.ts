/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { create } from 'zustand'

export interface LogEntry {
  id: number
  timestamp: string // ISO 8601
  level: 'error' | 'warning' | 'info'
  source: 'frontend' | 'backend'
  module: string
  message: string
  stack?: string
}

interface LogStore {
  entries: LogEntry[]
  log: (e: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: string }) => void
  clear: () => void
}

const MAX_ENTRIES = 50

let _nextId = 1

export const useLogStore = create<LogStore>((set) => ({
  entries: [],
  log: (e) => {
    const entry: LogEntry = {
      id: _nextId++,
      timestamp: e.timestamp ?? new Date().toISOString(),
      level: e.level,
      source: e.source,
      module: e.module,
      message: e.message,
      stack: e.stack,
    }
    set((s) => {
      const next = [...s.entries, entry]
      if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES)
      return { entries: next }
    })
  },
  clear: () => set({ entries: [] }),
}))

// Plain helper usable outside React components (e.g. in client.ts, main.tsx).
export function logEvent(e: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: string }) {
  useLogStore.getState().log(e)
}

let _installed = false

/**
 * Install global handlers once. Captures:
 *   - window.onerror (uncaught JS errors during render or async)
 *   - window.onunhandledrejection (Promise rejections not caught)
 *   - fetch() failures (network errors + non-2xx responses) via a wrapper
 */
export function installGlobalErrorHandlers() {
  if (_installed || typeof window === 'undefined') return
  _installed = true

  window.addEventListener('error', (event) => {
    // Skip ResizeObserver noise and cross-origin script errors ("Script error.")
    if (!event.message || event.message === 'Script error.') return
    logEvent({
      level: 'error',
      source: 'frontend',
      module: event.filename ? fileBaseName(event.filename) : 'window',
      message: event.message,
      stack: event.error?.stack,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : JSON.stringify(reason)
    logEvent({
      level: 'error',
      source: 'frontend',
      module: 'promise',
      message: `Unhandled rejection: ${message}`,
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  // Wrap fetch so API failures land in the store with the endpoint + status.
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method || (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')).toUpperCase()
    try {
      const res = await originalFetch(...args)
      if (!res.ok) {
        // Clone before reading so callers still get a usable body.
        let detail = ''
        try {
          detail = await res.clone().text()
        } catch {
          // ignore — body already consumed or not readable
        }
        logEvent({
          level: 'error',
          source: 'backend',
          module: shortPath(url),
          message: `${method} ${shortPath(url)} → ${res.status}: ${truncate(extractDetail(detail), 240)}`,
        })
      }
      return res
    } catch (err) {
      // Network error, CORS failure, server down, etc.
      const message = err instanceof Error ? err.message : String(err)
      logEvent({
        level: 'error',
        source: 'backend',
        module: shortPath(url),
        message: `${method} ${shortPath(url)} → network error: ${message}`,
        stack: err instanceof Error ? err.stack : undefined,
      })
      throw err
    }
  }
}

function extractDetail(body: string): string {
  const trimmed = (body || '').trim()
  if (!trimmed) return ''
  if (!trimmed.startsWith('{')) return trimmed
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed?.detail === 'string') return parsed.detail
  } catch {
    // fall through
  }
  return trimmed
}

function shortPath(url: string): string {
  try {
    const u = new URL(url, window.location.origin)
    return u.pathname
  } catch {
    return url
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function fileBaseName(url: string): string {
  const short = shortPath(url)
  const parts = short.split('/')
  return parts[parts.length - 1] || short
}
