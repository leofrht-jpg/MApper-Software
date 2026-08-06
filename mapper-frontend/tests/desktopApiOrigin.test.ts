/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// `import.meta.url` is not a file:// URL under Vitest's transform; resolve from
// the project root instead (vitest runs with cwd = mapper-frontend).
const fromRoot = (rel: string) => resolve(process.cwd(), rel)
import {
  DESKTOP_API_ORIGIN, DEV_API_ORIGIN, apiOriginForMode,
} from '../apiOrigin.config'

// The v0.1.6 build shipped pointing at the DEV port.
//
// The desktop app serves the SPA from the sidecar on :8765, so the packaged
// bundle must call :8765. That was carried only by the environment —
// DESKTOP.md's `VITE_API_BASE=http://localhost:8765 npm run build`, and
// `build:desktop` (`vite build --mode desktop`) expecting a `.env.desktop` that
// is gitignored and absent from the repo. Miss either and the build still
// SUCCEEDS, silently baking in `http://localhost:8000`; the packaged app then
// calls a port nothing is listening on and every screen comes up empty.
//
// The default is now baked in per build mode, so the desktop build is correct
// by construction. These tests pin that.

describe('the desktop build points at the sidecar, not the dev port', () => {
  it('mode "desktop" resolves to the sidecar origin', () => {
    expect(apiOriginForMode('desktop')).toBe(DESKTOP_API_ORIGIN)
    expect(DESKTOP_API_ORIGIN).toBe('http://localhost:8765')
  })

  it('the two origins are different — this is the whole bug', () => {
    expect(DESKTOP_API_ORIGIN).not.toBe(DEV_API_ORIGIN)
  })

  it('every non-desktop mode keeps the dev origin', () => {
    for (const mode of ['development', 'production', 'test', '']) {
      expect(apiOriginForMode(mode)).toBe(DEV_API_ORIGIN)
    }
  })

  it('the desktop origin matches the port the sidecar actually binds', () => {
    // desktop_entry.py binds 8765; mapper-tauri/src/main.rs has `const PORT`.
    const rs = readFileSync(fromRoot('../mapper-tauri/src/main.rs'), 'utf-8')
    const m = rs.match(/const PORT:\s*u16\s*=\s*(\d+)/)
    expect(m).not.toBeNull()
    expect(DESKTOP_API_ORIGIN).toContain(m![1])
  })
})

describe('client.ts has no hardcoded dev-origin fallback', () => {
  const src = readFileSync(fromRoot('src/api/client.ts'), 'utf-8')

  it('resolves its origin from the build-time default, not a literal', () => {
    expect(src).toContain('import.meta.env.VITE_API_BASE ?? __API_ORIGIN_DEFAULT__')
  })

  it('does not fall back to a literal localhost:8000', () => {
    // The construct that shipped the bug:
    //   import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'
    expect(src).not.toMatch(/VITE_API_BASE\s*\?\?\s*['"]http/)
  })
})
