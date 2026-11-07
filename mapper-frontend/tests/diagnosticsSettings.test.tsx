/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SettingsPage } from '../src/pages/SettingsPage'
import { Diagnostic } from '../src/components/ui/Diagnostic'
import { Shell } from '../src/components/layout/Shell'
import { DIAGNOSTICS } from '../src/utils/diagnostics'
import { useDiagnosticHelpStore } from '../src/stores/diagnosticHelpStore'

/**
 * Settings > "Most frequent warnings/errors": a collapsed section (count in its header), a
 * search that filters by code, title and text, entries that open to cause and fix, and a Help
 * link on a <Diagnostic> that lands on and opens the right entry.
 *
 * jsdom cannot show scrolling to the entry, how the list looks, or the feel of the search.
 */
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

const N = Object.keys(DIAGNOSTICS).length

beforeEach(() => {
  // @ts-expect-error minimal stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useDiagnosticHelpStore.setState({ target: null })
})
afterEach(() => cleanup())

const sectionHeader = () => screen.getByText(new RegExp(`Most frequent warnings/errors \\(${N}\\)`))
const body = () => screen.getByTestId('diagnostics-section-body')
// ONE DOM query for all entries (the page holds one entry per registry code, so a getByTestId per
// code made every call a few hundred queries and the search test crept to its 5 s limit on CI).
// An entry is the element whose id is exactly `diagnostic-entry-<code>`; its own parts
// (`-summary`, `-details`, ...) carry longer ids. A missing entry throws, as getByTestId did.
const visibleEntries = () => {
  const byId = new Map<string, HTMLElement>()
  document.querySelectorAll<HTMLElement>('[data-testid^="diagnostic-entry-"]')
    .forEach((el) => byId.set(el.getAttribute('data-testid') as string, el))
  return Object.keys(DIAGNOSTICS).filter((c) => {
    const el = byId.get(`diagnostic-entry-${c}`)
    if (!el) throw new Error(`no entry on the page for ${c}`)
    return el.style.display !== 'none'
  })
}

describe('the Settings section', () => {
  it('is collapsed by default and shows the number of entries in its header', async () => {
    render(<SettingsPage />)
    expect(sectionHeader()).toBeInTheDocument()
    expect(body()).not.toBeVisible()
  })

  it('opens on click, and shows every entry, collapsed, with a search box', async () => {
    render(<SettingsPage />)
    fireEvent.click(sectionHeader())
    expect(body()).toBeVisible()
    expect(screen.getByTestId('diagnostics-search')).toBeVisible()
    expect(screen.getByTestId('diagnostics-count').textContent).toBe(`${N} entries`)
    expect(visibleEntries()).toHaveLength(N)
    // each entry is one line; its cause and fix are behind its toggle
    const entry = screen.getByTestId('diagnostic-entry-waste_sign')
    expect(within(entry).getByText(/credit, not a burden/)).not.toBeVisible()
  })

  it('an entry opens to its cause and fix', () => {
    render(<SettingsPage />)
    fireEvent.click(sectionHeader())
    const entry = screen.getByTestId('diagnostic-entry-code_truncated')
    fireEvent.click(screen.getByTestId('diagnostic-entry-code_truncated-details-toggle'))
    expect(within(entry).getByText(DIAGNOSTICS.code_truncated.cause)).toBeVisible()
    expect(within(entry).getByText(DIAGNOSTICS.code_truncated.fix)).toBeVisible()
    expect(entry.id).toBe('diag-code-truncated')
  })
})

describe('the search', () => {
  const type = (q: string) => fireEvent.change(screen.getByTestId('diagnostics-search'), { target: { value: q } })

  it('filters by code, by title and by text', () => {
    render(<SettingsPage />)
    fireEvent.click(sectionHeader())
    type('waste_sign')
    expect(visibleEntries()).toContain('waste_sign')
    expect(visibleEntries().length).toBeLessThan(5)
    type('truncated code')                                       // title
    expect(visibleEntries()).toContain('code_truncated')
    type('negative')                                             // text (summary / cause)
    expect(visibleEntries()).toEqual(expect.arrayContaining(['waste_sign', 'negative_amount']))
    expect(visibleEntries()).not.toContain('code_truncated')
    expect(screen.getByTestId('diagnostics-count').textContent).toMatch(/^\d+ of \d+ entries$/)
  }, 15000)   // backstop: it renders the whole Settings page and is the slowest test on a loaded CI runner

  it('every word must match, in any order, any case', () => {
    render(<SettingsPage />)
    fireEvent.click(sectionHeader())
    type('BIOSPHERE flow row')
    expect(visibleEntries()).toContain('biosphere_link')
    type('biosphere zzzznotaword')
    expect(visibleEntries()).toHaveLength(0)
    expect(screen.getByTestId('diagnostics-empty')).toBeVisible()
  })

  it('clearing the search brings every entry back; an open entry stays open while filtering', () => {
    render(<SettingsPage />)
    fireEvent.click(sectionHeader())
    fireEvent.click(screen.getByTestId('diagnostic-entry-waste_sign-details-toggle'))
    type('truncated')
    type('')
    expect(visibleEntries()).toHaveLength(N)
    expect(within(screen.getByTestId('diagnostic-entry-waste_sign')).getByText(DIAGNOSTICS.waste_sign.fix)).toBeVisible()
  })
})

describe('the Help link', () => {
  it('opens Settings at the entry for the code, section open and entry open', async () => {
    const view = render(<SettingsPage />)
    expect(body()).not.toBeVisible()
    // a Diagnostic elsewhere asks for its entry; the Settings page consumes the request
    view.unmount()
    render(<Diagnostic code="code_truncated" severity="error" message="m" />)
    fireEvent.click(screen.getByTestId('diagnostic-help'))
    expect(useDiagnosticHelpStore.getState().target).toBe('code_truncated')
    cleanup()
    render(<SettingsPage />)
    await act(async () => { await Promise.resolve() })
    expect(body()).toBeVisible()
    const entry = screen.getByTestId('diagnostic-entry-code_truncated')
    expect(within(entry).getByText(DIAGNOSTICS.code_truncated.cause)).toBeVisible()
    expect(useDiagnosticHelpStore.getState().target).toBeNull()      // consumed once
  })

  it('a request while Settings is already mounted opens the entry too', async () => {
    render(<SettingsPage />)
    await act(async () => { useDiagnosticHelpStore.getState().requestHelp('waste_sign') })
    expect(body()).toBeVisible()
    expect(within(screen.getByTestId('diagnostic-entry-waste_sign')).getByText(DIAGNOSTICS.waste_sign.fix)).toBeVisible()
  })

  it('the app shell switches to the Settings page on the navigate event', async () => {
    render(<Shell>{(item) => <div data-testid="page">{item}</div>}</Shell>)
    expect(screen.getByTestId('page').textContent).toBe('databases')
    await act(async () => { useDiagnosticHelpStore.getState().requestHelp('waste_sign') })
    expect(screen.getByTestId('page').textContent).toBe('settings')
  })
})
