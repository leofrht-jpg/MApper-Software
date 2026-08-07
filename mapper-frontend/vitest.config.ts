/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { apiOriginForMode } from './apiOrigin.config'

// Mirror vite.config.ts's version injection so `__APP_VERSION__` (single-sourced
// from package.json) resolves under Vitest too.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Mirror vite.config.ts. Tests run as mode 'test', i.e. the dev origin;
    // without this the app code's `__API_ORIGIN_DEFAULT__` is undefined and
    // every module that imports the API client throws on load.
    __API_ORIGIN_DEFAULT__: JSON.stringify(apiOriginForMode('test')),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
