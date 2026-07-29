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

// About panel: version is single-sourced from package.json (not a literal), the
// exact DTU copyright is present, and the GitHub button is enabled with the repo
// href (no "coming soon").

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

describe('Settings → About panel', () => {
  it('shows the version from package.json, not the old hardcoded literal', () => {
    const { container } = render(<SettingsPage />)
    const text = container.textContent ?? ''
    expect(PKG_VERSION).toBeTruthy()
    expect(text).toContain(`v${PKG_VERSION}`)     // e.g. "v0.1.2"
    expect(text).not.toContain('0.1.0-alpha')      // the stale literal is gone
  })

  it('renders the exact DTU copyright notice + MPL 2.0 link', () => {
    const { container } = render(<SettingsPage />)
    expect(container.textContent).toContain('© Copyright 2026 Technical University of Denmark')
    const mpl = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === 'Mozilla Public License 2.0',
    )
    expect(mpl).toBeTruthy()
    expect(mpl?.getAttribute('href')).toBe('https://www.mozilla.org/en-US/MPL/2.0/')
    expect(mpl?.getAttribute('target')).toBe('_blank')
  })

  it('GitHub button is enabled with the repo href (no "coming soon")', () => {
    const { container } = render(<SettingsPage />)
    expect(container.textContent).not.toContain('coming soon')
    const gh = Array.from(container.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === 'https://github.com/leofrht-jpg/MApper-Software',
    )
    expect(gh).toBeTruthy()               // rendered as an <a> (enabled), not a disabled <span>
    expect(gh?.textContent).toContain('GitHub')
    expect(gh?.getAttribute('target')).toBe('_blank')
  })
})
