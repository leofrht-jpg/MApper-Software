// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * EF v3.1 in the Method Library: a one-click Install that works offline, shows
 * what it did, and warns when characterisation factors were skipped.
 *
 * A project imported from ecoinvent has no LCIA methods. The entry installs the 25
 * EF v3.1 methods from the software already on the computer and links them to the
 * project's biosphere3. Factors on flows biosphere3 does not hold are skipped; the
 * count and the ten most frequent flows must reach the screen, and so must a
 * failure's message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { MethodLibrary } from '../src/components/impact/MethodLibrary'
import * as client from '../src/api/client'

const EF: client.LCIAMethodInfo = {
  id: 'ef_v3_1', name: 'EF v3.1', description: 'Environmental Footprint 3.1',
  long_description: 'Installs the 25 EF v3.1 methods; works offline.',
  source: 'downloadable', installed: false, category_count: null, size_mb: null,
  source_url: null, citation: null, installer: 'bundled_ef', notes: 'Offline.',
  detected_ei_version: null, available_variants: null, unit: null, offline: true, removable: null,
}

const SKIPPED = Array.from({ length: 10 }, (_, i) => ({ name: `Flow ${i}`, categories: ['air', 'stratosphere'], cfs: 9 - i }))
const REPORT: client.LCIAInstallReport = {
  family: 'EF v3.1', methods_registered: 25, methods_already_present: 0,
  cfs_found: 11414, cfs_linked: 10375, cfs_linked_by_code: 10375, cfs_linked_by_name: 0,
  cfs_skipped: 1039, skipped_flows: 312, top_skipped: SKIPPED,
}
const WARNINGS = [
  '1,039 of 11,414 characterisation factors (9.1%) were skipped because their flow is not in this project\'s biosphere3. The 10 most frequent skipped flows:',
  ...SKIPPED.map((t) => `${t.name} [air / stratosphere]: ${t.cfs} factors`),
]

let onMessage: (m: client.LCIAInstallMessage) => void
let library: client.LCIAMethodInfo[]

beforeEach(() => {
  library = [EF]
  vi.spyOn(client, 'getLcaMethodLibrary').mockImplementation(async () => ({
    detected_ecoinvent_version: '3.11', supported_ecoinvent_versions: ['3.11'], methods: library,
  }))
  vi.spyOn(client, 'installLcaMethod').mockResolvedValue({ task_id: 't1', method_id: 'ef_v3_1' })
  vi.spyOn(client, 'connectToLcaInstallTask').mockImplementation((_id, cb) => {
    onMessage = cb
    return { close: vi.fn() } as unknown as WebSocket
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }

async function startInstall() {
  render(<MethodLibrary onClose={() => {}} />)
  await click(await screen.findByRole('button', { name: /Install/ }))
  await waitFor(() => expect(onMessage).toBeDefined())
}

describe('EF v3.1 library entry', () => {
  it('says it is offline and offers a one-click Install', async () => {
    render(<MethodLibrary onClose={() => {}} />)
    expect(await screen.findByText('EF v3.1')).toBeTruthy()
    expect(screen.getByText(/Offline: installs from the installed software/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Install/ })).toBeTruthy()
    expect(screen.queryByTestId('installed-ef_v3_1')).toBeNull()
  })

  it('Install starts exactly that method, with no ecoinvent version prompt', async () => {
    await startInstall()
    expect(client.installLcaMethod).toHaveBeenCalledWith('ef_v3_1', undefined)
  })

  it('shows the counts and the skipped-factor warning with the 10 flows', async () => {
    await startInstall()
    library = [{ ...EF, installed: true, category_count: 25, removable: true }]
    await act(async () => {
      onMessage({ type: 'done', method_tuples: [], warnings: WARNINGS, report: REPORT })
    })
    const report = await screen.findByTestId('install-report-ef_v3_1')
    expect(report.textContent).toContain('25 methods registered')
    expect(report.textContent).toContain('11,414 characterisation factors found')
    expect(report.textContent).toContain('10,375 linked')
    expect(report.textContent).toContain('1,039 skipped')
    expect(screen.getByTestId('install-warnings-ef_v3_1').textContent).toContain('Installed with warnings')
    expect(screen.getByText(/1,039 of 11,414 characterisation factors \(9.1%\) were skipped/)).toBeTruthy()
    for (const t of SKIPPED) expect(screen.getByText(`${t.name} [air / stratosphere]: ${t.cfs} factors`)).toBeTruthy()
  })

  it('no warning box when nothing was skipped', async () => {
    await startInstall()
    await act(async () => {
      onMessage({ type: 'done', method_tuples: [], warnings: [], report: { ...REPORT, cfs_linked: 11414, cfs_skipped: 0, top_skipped: [] } })
    })
    expect((await screen.findByTestId('install-report-ef_v3_1')).textContent).toContain('0 skipped')
    expect(screen.queryByTestId('install-warnings-ef_v3_1')).toBeNull()
  })

  it('a failure message reaches the screen', async () => {
    await startInstall()
    await act(async () => {
      onMessage({ type: 'error', error: "This project has no 'biosphere3'. Import an ecoinvent database into the project first." })
    })
    expect(await screen.findByText(/no 'biosphere3'\. Import an ecoinvent database/)).toBeTruthy()
  })

  it('a refused start (already installed, 409) shows its message', async () => {
    vi.spyOn(client, 'installLcaMethod').mockRejectedValue(new Error('EF v3.1 is already installed'))
    render(<MethodLibrary onClose={() => {}} />)
    await click(await screen.findByRole('button', { name: /Install/ }))
    expect(await screen.findByText(/EF v3.1 is already installed/)).toBeTruthy()
  })
})

describe('EF v3.1 already installed', () => {
  it('shows Installed and no Install button', async () => {
    library = [{ ...EF, installed: true, category_count: 25, removable: true }]
    render(<MethodLibrary onClose={() => {}} />)
    expect(await screen.findByTestId('installed-ef_v3_1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Install$/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Uninstall/ })).toBeTruthy()
  })

  it('offers no Uninstall for methods this app did not install (a bw2setup project)', async () => {
    library = [{ ...EF, installed: true, category_count: 25, removable: false }]
    render(<MethodLibrary onClose={() => {}} />)
    expect(await screen.findByTestId('installed-ef_v3_1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Uninstall/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Install$/ })).toBeNull()
  })
})
