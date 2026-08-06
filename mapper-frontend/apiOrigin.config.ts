/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Where the API lives when `VITE_API_BASE` is not set explicitly.
 *
 * The desktop app serves the SPA from the sidecar itself on :8765, so a
 * packaged bundle MUST call :8765; a dev server runs the backend separately on
 * :8000.
 *
 * This used to be carried only by the environment — DESKTOP.md's
 * `VITE_API_BASE=http://localhost:8765 npm run build`, and `build:desktop`
 * (`vite build --mode desktop`) expecting a `.env.desktop` that is gitignored
 * and not in the repo. Miss either and the build still SUCCEEDS while baking in
 * the dev origin; the packaged app then calls a port nothing is listening on
 * and every screen comes up empty. Baking the default in per mode makes the
 * desktop build correct by construction.
 *
 * Deliberately its own module, with no `import.meta.url` and no I/O, so
 * vite.config, vitest.config and the tests can all import it.
 */
export const DESKTOP_API_ORIGIN = 'http://localhost:8765'
export const DEV_API_ORIGIN = 'http://localhost:8000'

export function apiOriginForMode(mode: string): string {
  return mode === 'desktop' ? DESKTOP_API_ORIGIN : DEV_API_ORIGIN
}
