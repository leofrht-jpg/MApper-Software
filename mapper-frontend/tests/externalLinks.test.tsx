// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * External links in the packaged app open in the system default handler.
 *
 * The mailto link on the Premise panel printed "Navigation blocked ... (external
 * link to null)" and opened nothing: a mailto: URL has an opaque origin, which
 * prints as "null", and nothing opened external links at all. The guard now hands
 * a REAL user click on an https, http or mailto anchor to the backend, which asks
 * the OS; every other scheme stays blocked and the message shows the real URL.
 *
 * jsdom cannot make a trusted click, so the guard takes the "is this a user
 * click" test as an option; the default (the browser's `isTrusted`) is tested by
 * a synthetic click, which must be blocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import { installNavigationGuard, NAVIGATION_BLOCKED } from '../src/utils/navigationGuard'
import { allowedExternalUrl, openExternal, shownUrl } from '../src/utils/externalLink'
import { PremiseKeyManager } from '../src/components/PremiseKeyManager'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import * as client from '../src/api/client'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    openExternalUrl: vi.fn(async () => {}),
    getPremiseKeyStatus: vi.fn(async () => ({ configured: false, path: '' })),
  }
})

const opener = () => vi.mocked(client.openExternalUrl)

describe('allowedExternalUrl: the scheme allowlist', () => {
  it.each([
    ['https://github.com/polca/premise', 'https://github.com/polca/premise'],
    ['http://example.org/a?b=c', 'http://example.org/a?b=c'],
    ['mailto:romain.sacchi@psi.ch', 'mailto:romain.sacchi@psi.ch'],
    ['  https://example.org  ', 'https://example.org/'],
  ])('%s is allowed', (input, expected) => {
    expect(allowedExternalUrl(input)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<h1>x</h1>', 'blob:http://localhost/1',
    'ftp://example.org/x', 'tel:+4512345678', 'x-custom://thing', 'vscode://file/x',
    'https://', 'mailto:', '/relative/path', 'example.org', '', '   ',
    'https://exa mple.org', 'https://example.org/\nnext',
  ])('%j is blocked', (input) => {
    expect(allowedExternalUrl(input)).toBeNull()
  })

  it('null and undefined are blocked', () => {
    expect(allowedExternalUrl(null)).toBeNull()
    expect(allowedExternalUrl(undefined)).toBeNull()
  })

  it('shownUrl keeps a short URL whole and shortens a very long one', () => {
    expect(shownUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    const long = 'https://example.org/' + 'a'.repeat(300)
    expect(shownUrl(long).length).toBeLessThan(110)
    expect(shownUrl(long).startsWith('https://example.org/aaa')).toBe(true)
  })

  it('openExternal refuses a blocked URL without calling the backend', async () => {
    opener().mockClear()
    await expect(openExternal('javascript:alert(1)')).rejects.toThrow(/Only https, http and mailto/)
    expect(opener()).not.toHaveBeenCalled()
  })
})

describe('the guard and the opener', () => {
  let uninstall: () => void
  beforeEach(() => {
    __resetDialogsForTests()
    opener().mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    uninstall = installNavigationGuard({ isUserClick: () => true })
  })
  afterEach(() => {
    uninstall()
    cleanup()
    __resetDialogsForTests()
    document.body.querySelectorAll('[data-test-anchor]').forEach((n) => n.remove())
    vi.restoreAllMocks()
  })

  /** Click an anchor; returns whether its default (following the link) ran. */
  async function click(href: string, attrs: Record<string, string> = {}): Promise<boolean> {
    const a = document.createElement('a')
    a.href = href
    a.setAttribute('data-test-anchor', '')
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
    document.body.appendChild(a)
    let notCancelled = true
    await act(async () => { notCancelled = a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    return notCancelled
  }

  it('a click on a mailto anchor opens it in the mail client and keeps the page', async () => {
    expect(await click('mailto:romain.sacchi@psi.ch')).toBe(false)
    expect(opener()).toHaveBeenCalledTimes(1)
    expect(opener()).toHaveBeenCalledWith('mailto:romain.sacchi@psi.ch')
  })

  it('a click on an https anchor (target _blank) opens it in the default browser', async () => {
    expect(await click('https://github.com/polca/premise', { target: '_blank', rel: 'noreferrer' })).toBe(false)
    expect(opener()).toHaveBeenCalledWith('https://github.com/polca/premise')
  })

  it('an http anchor opens too', async () => {
    await click('http://example.org/page')
    expect(opener()).toHaveBeenCalledWith('http://example.org/page')
  })

  it.each([
    ['javascript:alert(1)', 'javascript:alert(1)'],
    ['ftp://example.org/x', 'ftp://example.org/x'],
    ['tel:+4512345678', 'tel:+4512345678'],
    ['x-custom://thing', 'x-custom://thing'],
    ['file:///Users/me/a.xlsx', 'file: URL'],
    ['data:text/html,<h1>gone</h1>', 'data: URL'],
    ['blob:http://localhost/0b8e', 'blob: URL'],
  ])('%s does not open, is blocked, and the message names the real URL', async (href, shown) => {
    render(<DialogHost />)
    expect(await click(href)).toBe(false)
    expect(opener()).not.toHaveBeenCalled()
    const text = screen.getByTestId('toast-error').textContent ?? ''
    expect(text).toContain(NAVIGATION_BLOCKED)
    expect(text).toContain(shown)
    expect(text).not.toMatch(/\bnull\b/)
  })

  it('a download anchor with the app marker is not an external link and still passes', async () => {
    expect(await click('blob:http://localhost/1', { download: 'a.xlsx', 'data-mapper-download': '' })).toBe(true)
    expect(opener()).not.toHaveBeenCalled()
  })

  it('a failed open says why', async () => {
    render(<DialogHost />)
    opener().mockRejectedValue(new Error('no handler'))
    await click('mailto:a@b.c')
    await act(async () => {})
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Could not open the link: no handler')
  })

  it('same-origin links are left alone', async () => {
    expect(await click(`${window.location.origin}/#section`)).toBe(true)
    expect(opener()).not.toHaveBeenCalled()
  })
})

describe('only a real user click opens a link', () => {
  beforeEach(() => { __resetDialogsForTests(); opener().mockReset().mockResolvedValue(undefined) })
  afterEach(() => { cleanup(); __resetDialogsForTests(); vi.restoreAllMocks() })

  it('a click a script made (default isTrusted) is blocked with the real URL, nothing opens', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const uninstall = installNavigationGuard()           // the default test: event.isTrusted
    render(<DialogHost />)
    const a = document.createElement('a')
    a.href = 'https://example.org/script-click'
    document.body.appendChild(a)
    let notCancelled = true
    await act(async () => { notCancelled = a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    a.remove(); uninstall()
    expect(notCancelled).toBe(false)
    expect(opener()).not.toHaveBeenCalled()
    expect(screen.getByTestId('toast-error')).toHaveTextContent('external link to https://example.org/script-click')
  })
})

describe('the Premise panel', () => {
  let uninstall: () => void
  beforeEach(() => {
    __resetDialogsForTests()
    opener().mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    uninstall = installNavigationGuard({ isUserClick: () => true })
  })
  afterEach(() => { uninstall(); cleanup(); __resetDialogsForTests(); vi.restoreAllMocks() })

  it('the banner email link opens the mail client', async () => {
    render(<><PremiseKeyManager variant="banner" /><DialogHost /></>)
    const link = await screen.findByText('request one from romain.sacchi@psi.ch')
    await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    expect(opener()).toHaveBeenCalledWith('mailto:romain.sacchi@psi.ch')
    expect(screen.queryByTestId('toast-error')).toBeNull()
  })

  it('the panel offers the address as plain selectable text next to the link', async () => {
    render(<><PremiseKeyManager variant="panel" /><DialogHost /></>)
    const text = await screen.findByTestId('premise-request-address')
    expect(text).toHaveTextContent('romain.sacchi@psi.ch')
    expect(text.tagName).toBe('CODE')
    expect(text.style.userSelect).toBe('text')
    expect(text.closest('a')).toBeNull()                 // text, not a link
    const link = screen.getByText('Request a key').closest('a')!
    await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    expect(opener()).toHaveBeenCalledWith('mailto:romain.sacchi@psi.ch')
  })
})
