// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Method Library: one entry shows its name, a one-line description and its status; everything
 * else is behind a collapsed "Details" toggle. The install warning is one line. Uninstalling
 * clears the install report and the warning (the stale "Installed with warnings" bug).
 *
 * jsdom has no layout: "collapsed" means display:none on the Details body (toBeVisible reads
 * that). That the line really fits on one line, and how it looks, needs the packaged app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { MethodLibrary } from '../src/components/impact/MethodLibrary'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import * as client from '../src/api/client'

const ID = 'ef_v3_1'
const EF: client.LCIAMethodInfo = {
  id: ID, name: 'EF v3.1', description: 'Environmental Footprint 3.1',
  long_description: 'LONG: installs the 25 EF v3.1 methods; works offline.',
  source: 'downloadable', installed: false, category_count: null, size_mb: null,
  source_url: 'https://example.org/ef', citation: null, installer: 'bundled_ef', notes: 'NOTE: offline.',
  detected_ei_version: null, available_variants: null, unit: null, offline: true, removable: null,
  factor_source: 'FACTOR SOURCE: bundled with the installed software.',
}
const REPORT: client.LCIAInstallReport = {
  family: 'EF v3.1', methods_registered: 25, methods_already_present: 0,
  cfs_found: 11414, cfs_linked: 10375, cfs_linked_by_code: 10375, cfs_linked_by_name: 0,
  cfs_skipped: 1039, skipped_flows: 312, top_skipped: [],
}
const WARNINGS = [
  "1,039 of 11,414 characterisation factors (9.1%) were skipped because their flow is not in this project's biosphere3.",
  'Flow 0 [air / stratosphere]: 9 factors',
]

let onMessage: (m: client.LCIAInstallMessage) => void
let library: client.LCIAMethodInfo[]
let uninstall: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetDialogsForTests()
  library = [EF]
  vi.spyOn(client, 'getLcaMethodLibrary').mockImplementation(async () => ({
    detected_ecoinvent_version: '3.11', supported_ecoinvent_versions: ['3.11'], methods: library,
  }))
  vi.spyOn(client, 'installLcaMethod').mockResolvedValue({ task_id: 't1', method_id: ID })
  uninstall = vi.spyOn(client, 'uninstallLcaMethod').mockImplementation(async () => {
    library = [{ ...EF, installed: false, category_count: null, removable: null }]
    return undefined as never
  })
  vi.spyOn(client, 'connectToLcaInstallTask').mockImplementation((_id, cb) => {
    onMessage = cb
    return { close: vi.fn() } as unknown as WebSocket
  })
})
afterEach(() => { cleanup(); __resetDialogsForTests(); vi.restoreAllMocks() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }

async function installedWithWarnings() {
  render(<><MethodLibrary onClose={() => {}} /><DialogHost /></>)
  await click(await screen.findByRole('button', { name: /Install/ }))
  await waitFor(() => expect(onMessage).toBeDefined())
  library = [{ ...EF, installed: true, category_count: 25, removable: true }]
  await act(async () => { onMessage({ type: 'done', method_tuples: [], warnings: WARNINGS, report: REPORT }) })
  await screen.findByTestId(`install-warnings-${ID}`)
}

describe('an entry shows name, one-line description and status; the rest is behind Details', () => {
  it('collapsed by default: the long text, notes, source, counts and the offline note are not visible', async () => {
    render(<MethodLibrary onClose={() => {}} />)
    expect(await screen.findByText('EF v3.1')).toBeVisible()
    expect(screen.getByText('Environmental Footprint 3.1')).toBeVisible()
    expect(screen.getByTestId(`not-installed-${ID}`)).toBeVisible()
    for (const hidden of [/LONG: installs/, /NOTE: offline/, /FACTOR SOURCE/, /Offline: installs from the installed software/]) {
      expect(screen.getByText(hidden)).not.toBeVisible()
    }
    expect(screen.getByTestId(`method-details-${ID}-body`)).not.toBeVisible()
  })

  it('Details shows every fact that used to be on the entry, and toggles back', async () => {
    render(<MethodLibrary onClose={() => {}} />)
    await screen.findByText('EF v3.1')
    await click(screen.getByTestId(`method-details-${ID}-toggle`))
    for (const shown of [/LONG: installs/, /NOTE: offline/, /FACTOR SOURCE/, /Offline: installs from the installed software/]) {
      expect(screen.getByText(shown)).toBeVisible()
    }
    expect(screen.getByRole('link', { name: /Source/ })).toBeVisible()
    await click(screen.getByTestId(`method-details-${ID}-toggle`))
    expect(screen.getByTestId(`method-details-${ID}-body`)).not.toBeVisible()
  })

  it('the description is one line (nowrap, ellipsis), not a paragraph', async () => {
    render(<MethodLibrary onClose={() => {}} />)
    const d = (await screen.findByText('Environmental Footprint 3.1')) as HTMLElement
    expect(d.style.whiteSpace).toBe('nowrap')
    expect(d.style.textOverflow).toBe('ellipsis')
  })
})

describe('"Installed with warnings" is one line, collapsed by default', () => {
  it('shows the skipped share and a Details toggle; the list and the counts are reachable', async () => {
    await installedWithWarnings()
    const box = screen.getByTestId(`install-warnings-${ID}`)
    expect(box).toBeVisible()
    expect(screen.getByTestId(`install-warnings-${ID}-summary`).textContent).toBe('Installed with warnings: 9.1% of factors skipped')
    // the detailed list is collapsed
    expect(screen.getByText(/1,039 of 11,414 characterisation factors/)).not.toBeVisible()
    expect(screen.getByText(/Flow 0 \[air \/ stratosphere\]/)).not.toBeVisible()
    await click(screen.getByTestId(`install-warnings-${ID}-details-toggle`))
    expect(screen.getByText(/1,039 of 11,414 characterisation factors/)).toBeVisible()
    expect(screen.getByText(/Flow 0 \[air \/ stratosphere\]/)).toBeVisible()
    // the factor counts sit in the entry's Details
    expect(screen.getByTestId(`install-report-${ID}`)).not.toBeVisible()
    await click(screen.getByTestId(`method-details-${ID}-toggle`))
    expect(screen.getByTestId(`install-report-${ID}`)).toBeVisible()
    expect(screen.getByTestId(`install-report-${ID}`).textContent).toContain('1,039 skipped')
  })

  it('an install failure shows one line; its message is in Details', async () => {
    render(<MethodLibrary onClose={() => {}} />)
    await click(await screen.findByRole('button', { name: /Install/ }))
    await waitFor(() => expect(onMessage).toBeDefined())
    await act(async () => { onMessage({ type: 'error', error: "This project has no 'biosphere3'." }) })
    expect(await screen.findByText('Install failed')).toBeVisible()
    expect(screen.getByText(/no 'biosphere3'/)).not.toBeVisible()
    await click(screen.getByTestId(`install-error-${ID}-details-toggle`))
    expect(screen.getByText(/no 'biosphere3'/)).toBeVisible()
  })
})

describe('Uninstall clears the install report and its warning', () => {
  it('the warning box and the report are gone, the entry offers Install again, and they do not come back', async () => {
    await installedWithWarnings()
    expect(screen.getByTestId(`install-report-${ID}`)).toBeInTheDocument()

    await click(screen.getByRole('button', { name: /Uninstall/ }))
    await click(screen.getByTestId('dialog-confirm'))
    await waitFor(() => expect(uninstall).toHaveBeenCalledWith(ID))

    await waitFor(() => expect(screen.getByRole('button', { name: /^Install$/ })).toBeInTheDocument())
    expect(screen.queryByTestId(`install-warnings-${ID}`)).toBeNull()
    expect(screen.queryByTestId(`install-report-${ID}`)).toBeNull()
    expect(screen.queryByText(/Installed with warnings/)).toBeNull()
    expect(screen.queryByText(/characterisation factors/)).toBeNull()
    // a later reload (the app re-lists the library) does not bring a stale report back
    await act(async () => { window.dispatchEvent(new CustomEvent('lcia-library-changed')) })
    expect(screen.queryByTestId(`install-warnings-${ID}`)).toBeNull()
  })

  it('a failed uninstall keeps what is on screen (nothing was removed)', async () => {
    await installedWithWarnings()
    uninstall.mockRejectedValueOnce(new Error('Uninstall failed: locked'))
    await click(screen.getByRole('button', { name: /Uninstall/ }))
    await click(screen.getByTestId('dialog-confirm'))
    expect(await screen.findByText(/locked/)).toBeInTheDocument()
    expect(screen.getByTestId(`install-warnings-${ID}`)).toBeInTheDocument()
  })

  it('the Uninstall button is the danger variant', async () => {
    library = [{ ...EF, installed: true, category_count: 25, removable: true }]
    render(<MethodLibrary onClose={() => {}} />)
    const row = await screen.findByTestId(`method-row-${ID}`)
    const btn = within(row).getByRole('button', { name: /Uninstall/ }) as HTMLButtonElement
    expect(btn.style.backgroundColor).toBe('var(--danger)')
  })
})
