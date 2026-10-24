// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * The navigation guard keeps the app page in place.
 *
 * In the packaged app a main-frame navigation replaces the whole app with no
 * way back (seen in the 0.3.2 dev build). jsdom never navigates, so these tests
 * assert what decides it: whether the click / drop event's default action was
 * cancelled when it reached the window, and what the user is told.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { installNavigationGuard, NAVIGATION_BLOCKED } from '../src/utils/navigationGuard'
import { downloadBlob, DOWNLOAD_MARKER } from '../src/utils/download'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { CSVUploader } from '../src/components/dsm/CSVUploader'

let uninstall: () => void
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetDialogsForTests()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  uninstall = installNavigationGuard()
})
afterEach(() => {
  uninstall()
  cleanup()
  __resetDialogsForTests()
  document.body.querySelectorAll('[data-test-anchor]').forEach((n) => n.remove())
  vi.restoreAllMocks()
})

/** Click an anchor the way a user would; returns whether its default ran. */
async function clickAnchor(href: string, attrs: Record<string, string> = {}): Promise<boolean> {
  const a = document.createElement('a')
  a.href = href
  a.textContent = 'link'
  a.setAttribute('data-test-anchor', '')
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
  document.body.appendChild(a)
  let notCancelled = true
  await act(async () => {
    notCancelled = a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  return notCancelled
}

describe('clicks that would replace the page', () => {
  it.each([
    ['blob:http://localhost/0b8e', 'blob: URL'],
    ['data:text/html,<h1>gone</h1>', 'data: URL'],
    ['file:///Users/me/Downloads/parameters.xlsx', 'file: URL'],
    ['https://example.org/x', 'external link to https://example.org'],
  ])('%s is cancelled and the user is told', async (href, type) => {
    render(<DialogHost />)
    expect(await clickAnchor(href)).toBe(false)
    expect(screen.getByTestId('toast-error')).toHaveTextContent(`${NAVIGATION_BLOCKED} (${type})`)
  })

  it('a click inside the anchor (an icon in a link) is caught too', async () => {
    render(<DialogHost />)
    const a = document.createElement('a')
    a.href = 'blob:http://localhost/1'
    a.setAttribute('data-test-anchor', '')
    const icon = document.createElement('span')
    a.appendChild(icon)
    document.body.appendChild(a)
    let notCancelled = true
    await act(async () => { notCancelled = icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    expect(notCancelled).toBe(false)
  })

  it('download attribute alone is not enough: only the shared helper is trusted', async () => {
    render(<DialogHost />)
    expect(await clickAnchor('blob:http://localhost/2', { download: 'x.xlsx' })).toBe(false)
    expect(screen.getByTestId('toast-error')).toBeInTheDocument()
  })

  it('a same-origin link is left alone', async () => {
    render(<DialogHost />)
    expect(await clickAnchor('#section')).toBe(true)
    expect(screen.queryByTestId('toast-error')).toBeNull()
  })
})

describe('the shared download helper still downloads', () => {
  it('its anchor carries download + the marker and its click is not cancelled', async () => {
    render(<DialogHost />)
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/xlsx') as never
    URL.revokeObjectURL = vi.fn() as never
    const seen: Array<{ cancelled: boolean; download: string | null; marked: boolean }> = []
    const spy = (e: Event) => {
      const a = e.target as HTMLAnchorElement
      seen.push({ cancelled: e.defaultPrevented, download: a.getAttribute('download'), marked: a.hasAttribute(DOWNLOAD_MARKER) })
    }
    window.addEventListener('click', spy)
    try {
      await act(async () => { downloadBlob(new Blob(['x']), 'parameters.xlsx') })
    } finally {
      window.removeEventListener('click', spy)
    }
    expect(seen).toEqual([{ cancelled: false, download: 'parameters.xlsx', marked: true }])
    expect(screen.queryByTestId('toast-error')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/xlsx')
  })
})

describe('files dropped on the window', () => {
  const file = () => new File(['year,count\n2025,1\n'], 'inflows.csv', { type: 'text/csv' })

  it('a drop on a dropzone still reaches the dropzone', async () => {
    const onUpload = vi.fn(async () => ({ summary: 'ok' }))
    render(<CSVUploader label="Inflows" onUpload={onUpload} />)
    const zone = screen.getByTestId('csv-dropzone')
    let reachedWindowAs: boolean | null = null
    const spy = (e: Event) => { reachedWindowAs = e.defaultPrevented }
    window.addEventListener('drop', spy)
    try {
      await act(async () => { fireEvent.drop(zone, { dataTransfer: { files: [file()], types: ['Files'] } }) })
    } finally {
      window.removeEventListener('drop', spy)
    }
    // The dropzone handled it (it cancels the default itself) and now shows the file.
    expect(reachedWindowAs).toBe(true)
    expect(await screen.findByText(/inflows\.csv/)).toBeInTheDocument()
  })

  it('a drop anywhere else is prevented, so the browser cannot open the file', async () => {
    const elsewhere = document.createElement('div')
    elsewhere.setAttribute('data-test-anchor', '')
    document.body.appendChild(elsewhere)
    const over = fireEvent.dragOver(elsewhere, { dataTransfer: { files: [file()], types: ['Files'], dropEffect: 'copy' } })
    const drop = fireEvent.drop(elsewhere, { dataTransfer: { files: [file()], types: ['Files'] } })
    expect(over).toBe(false)
    expect(drop).toBe(false)
  })
})

describe('beforeunload', () => {
  it('logs the unexpected unload to the console', () => {
    window.dispatchEvent(new Event('beforeunload'))
    expect(warn).toHaveBeenCalledWith('[mapper] the app page is unloading', expect.objectContaining({ href: expect.any(String) }))
  })
})
