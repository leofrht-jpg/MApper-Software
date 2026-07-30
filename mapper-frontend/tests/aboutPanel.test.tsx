/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import { SettingsPage } from '../src/pages/SettingsPage'

// About panel: version is single-sourced from package.json (not a literal) and
// the exact DTU copyright is present. The external-link buttons (Website,
// GitHub, mailto:) are gone — the webview has no opener/shell plugin, so
// <a target="_blank"> external URLs are dropped instead of handed to the OS.
// The licence notice stays as plain text (DTU requirement) rather than a dead link.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getHealth: vi.fn(async () => ({ status: 'ok' })),
    getPremiseKeyStatus: vi.fn(async () => ({ configured: false, path: '~/.premise/premise_key' })),
    getGridIntensities: vi.fn(async () => []),
    getSystemLogs: vi.fn(async () => ({ lines: [], log_path: '' })),
  }
})

// Vitest runs from the mapper-frontend dir; read package.json off the fs
// (import.meta.url is an http URL under jsdom, not a file path).
const PKG_VERSION = JSON.parse(
  readFileSync(`${process.cwd()}/package.json`, 'utf-8'),
).version as string

beforeEach(() => {
  // @ts-expect-error minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

// The whole SettingsPage renders, and other cards legitimately keep their own
// links (e.g. Premise has a mailto: for the key request). Scope link assertions
// to the About card: the deepest element holding both its copyright and footer
// lines (querySelectorAll is document order, so ancestors come first).
function aboutCard(container: HTMLElement): HTMLElement {
  const matches = Array.from(container.querySelectorAll('div')).filter((el) => {
    const t = el.textContent ?? ''
    return t.includes('© Copyright 2026 Technical University of Denmark')
      && t.includes('Built with React · FastAPI · Brightway2 · Tauri')
  })
  const card = matches[matches.length - 1]
  expect(card).toBeTruthy()
  return card as HTMLElement
}

describe('Settings → About panel', () => {
  it('shows the version from package.json, not the old hardcoded literal', () => {
    const { container } = render(<SettingsPage />)
    const text = container.textContent ?? ''
    expect(PKG_VERSION).toBeTruthy()
    expect(text).toContain(`v${PKG_VERSION}`)     // e.g. "v0.1.3"
    expect(text).not.toContain('0.1.0-alpha')      // the stale literal is gone
  })

  it('keeps the exact DTU copyright notice and the MPL 2.0 name as plain text', () => {
    const { container } = render(<SettingsPage />)
    const text = container.textContent ?? ''
    expect(text).toContain('© Copyright 2026 Technical University of Denmark')
    // Licence notice intact...
    expect(text).toContain('Released under the Mozilla Public License 2.0')
    // ...but not a link, since the webview cannot open external URLs.
    const mplLink = Array.from(aboutCard(container).querySelectorAll('a')).find((a) =>
      (a.getAttribute('href') ?? '').includes('mozilla.org'),
    )
    expect(mplLink).toBeUndefined()
  })

  it('does not render the non-functional external-link buttons', () => {
    const { container } = render(<SettingsPage />)
    const card = aboutCard(container)
    const hrefs = Array.from(card.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '')

    // No links at all in the About card — every one of them was external.
    expect(hrefs).toEqual([])
    expect(hrefs).not.toContain('https://github.com/leofrht-jpg/MApper-Software')
    expect(hrefs).not.toContain('https://mapper.leonardoferhati.com')
    expect(hrefs.some((h) => h.startsWith('mailto:'))).toBe(false)

    const text = card.textContent ?? ''
    expect(text).not.toContain('Website')
    expect(text).not.toContain('GitHub')
    expect(text).not.toContain('coming soon')
  })

  it('still shows the contact address as selectable text and the internal tour action', () => {
    const { container } = render(<SettingsPage />)
    const text = container.textContent ?? ''
    expect(text).toContain('leo_frht@icloud.com')   // copyable, just not a link
    expect(text).toContain('Restart tour')          // internal action, unaffected
    expect(text).toContain('Developed by')
    expect(text).toContain('DTU Wind and Energy Systems')
    expect(text).toContain('DTU Centre for Absolute Sustainability')
    expect(text).toContain('Built with React · FastAPI · Brightway2 · Tauri')
  })
})
