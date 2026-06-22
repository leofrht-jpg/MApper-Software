/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Patch 5AH — favicon set (bolt in teal circle + light-green aura). No rendered-
// pixel assertion (static assets); just lock that the head + manifest reference
// the assets and the files exist, so a path typo can't silently ship.

const root = resolve(__dirname, '..')
const pub = (f: string) => resolve(root, 'public', f)

const ASSETS = [
  'favicon.svg', 'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png',
  'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest',
]

describe('favicon assets (Patch 5AH)', () => {
  it('all favicon assets exist in public/', () => {
    for (const a of ASSETS) expect(existsSync(pub(a)), `${a} missing`).toBe(true)
  })

  it('index.html head references the favicon set', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8')
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"')
    expect(html).toContain('href="/favicon.ico"')
    expect(html).toContain('href="/favicon-32.png"')
    expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"')
    expect(html).toContain('rel="manifest" href="/site.webmanifest"')
  })

  it('manifest is valid JSON and references the 192/512 PWA icons + theme color', () => {
    const m = JSON.parse(readFileSync(pub('site.webmanifest'), 'utf8'))
    const srcs = m.icons.map((i: { src: string }) => i.src)
    expect(srcs).toContain('/icon-192.png')
    expect(srcs).toContain('/icon-512.png')
    expect(m.theme_color).toBe('#14b8a6')  // brand teal
  })

  it('favicon.svg uses the brand colors (teal circle, green aura, purple bolt)', () => {
    const svg = readFileSync(pub('favicon.svg'), 'utf8')
    expect(svg).toContain('#14b8a6')  // circle (accent teal)
    expect(svg).toContain('#34D399')  // aura (success green)
    expect(svg).toContain('#863bff')  // bolt (logo purple)
  })
})
