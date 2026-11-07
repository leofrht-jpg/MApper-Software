// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * ReCiPe 2016 and CML v4.8 in the Method Library, and the factor-source sentence.
 *
 * Four more one-click offline entries on the installer EF v3.1 uses. Every entry
 * shows one plain sentence on where its characterisation factors come from, and
 * the sentence is only the "ecoinvent 3.9 LCIA implementation bundled with the
 * installed software" one on the entries it is true for. An install that lost
 * factors must name the indicators that lost the most.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { MethodLibrary } from '../src/components/impact/MethodLibrary'
import * as client from '../src/api/client'

const BUNDLED_SOURCE =
  'The characterisation factors come from the ecoinvent 3.9 LCIA implementation bundled with the installed software; ' +
  'flows that ecoinvent added after 3.9 have no factors, factors on flows removed or renamed since are skipped, and the ' +
  'install report shows how many factors were linked and skipped for this project.'

const entry = (id: string, name: string, extra: Partial<client.LCIAMethodInfo> = {}): client.LCIAMethodInfo => ({
  id, name, description: `${name} description`, long_description: null, source: 'downloadable',
  installed: false, category_count: null, size_mb: null, source_url: null, citation: null,
  installer: 'bundled_ef', notes: null, detected_ei_version: null, available_variants: null, unit: null,
  offline: true, removable: null, factor_source: BUNDLED_SOURCE, ...extra,
})

const MID = entry('recipe_2016_midpoint', 'ReCiPe 2016 midpoint (H, I, E)')
const END = entry('recipe_2016_endpoint', 'ReCiPe 2016 endpoint (H, I, E)')
const CML = entry('cml_v4_8_2016', 'CML v4.8 2016')
const CML_NOLT = entry('cml_v4_8_2016_no_lt', 'CML v4.8 2016, no long-term')
const IW = entry('impact_world_plus_2_2_1', 'IMPACT World+ 2.2.1', {
  installer: 'bw2package', offline: false, available_variants: ['3.10', '3.11'],
  factor_source: 'The characterisation factors come from the IMPACT World+ 2.2.1 Brightway package published on Zenodo, downloaded when you install.',
})

const REPORT: client.LCIAInstallReport = {
  family: 'CML v4.8 2016', families: ['CML v4.8 2016'], methods_registered: 11, methods_already_present: 0,
  cfs_found: 4022, cfs_linked: 3645, cfs_linked_by_code: 3645, cfs_linked_by_name: 0, cfs_skipped: 377, skipped_flows: 204,
  top_skipped: [{ name: 'Chloroform', categories: ['air', 'stratosphere'], cfs: 6 }],
  worst_methods: [{ name: ['CML v4.8 2016', 'material resources: metals/minerals', 'ADP elements'], cfs_found: 129, cfs_skipped: 80, share: 0.62 }],
}
const WARNINGS = [
  '377 of 4,022 characterisation factors (9.4%) were skipped because their flow is not in this project\'s biosphere3. The 1 most frequent skipped flows:',
  'Chloroform [air / stratosphere]: 6 factors',
  'Indicators that lost at least 25% of their factors (whether their results lose anything depends on whether your inventory uses the skipped flows):',
  'material resources: metals/minerals / ADP elements (CML v4.8 2016): 80 of 129 factors skipped',
]

let library: client.LCIAMethodInfo[]
let onMessage: (m: client.LCIAInstallMessage) => void

beforeEach(() => {
  library = [MID, END, CML, CML_NOLT, IW]
  vi.spyOn(client, 'getLcaMethodLibrary').mockImplementation(async () => ({
    detected_ecoinvent_version: '3.11', supported_ecoinvent_versions: ['3.11'], methods: library,
  }))
  vi.spyOn(client, 'installLcaMethod').mockImplementation(async (id: string) => ({ task_id: 't1', method_id: id }))
  vi.spyOn(client, 'connectToLcaInstallTask').mockImplementation((_id, cb) => {
    onMessage = cb
    return { close: vi.fn() } as unknown as WebSocket
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }

/** Open an entry's (i), read its text, close it again (one popover at a time). */
async function aboutText(id: string): Promise<string> {
  await click(screen.getByTestId(`method-info-${id}`))
  const text = screen.getByTestId(`method-about-${id}`).textContent ?? ''
  await click(screen.getByTestId(`method-info-${id}`))
  return text
}

describe('the four new entries', () => {
  it('are listed, each offline with its own one-click Install', async () => {
    render(<MethodLibrary onClose={() => {}} />)
    for (const e of [MID, END, CML, CML_NOLT]) expect(await screen.findByText(e.name)).toBeTruthy()
    for (const e of [MID, END, CML, CML_NOLT]) {
      expect((await aboutText(e.id)).match(/Offline/g)).toHaveLength(1)     // said once, behind the (i)
    }
    expect(screen.getAllByRole('button', { name: /Install/ })).toHaveLength(5) // four offline + IMPACT World+
  })

  it.each([MID, END, CML, CML_NOLT])('Install on $name starts exactly that entry, no version prompt', async (e) => {
    render(<MethodLibrary onClose={() => {}} />)
    await screen.findByText(e.name)
    const row = screen.getByText(e.name).closest('div[style*="border"]') as HTMLElement
    const button = Array.from(row.querySelectorAll('button')).find((b) => /Install/.test(b.textContent ?? ''))!
    await click(button)
    expect(client.installLcaMethod).toHaveBeenCalledWith(e.id, undefined)
  })

  it('an installed entry shows Installed and no Install; a bw2setup one has no Uninstall', async () => {
    library = [
      { ...MID, installed: true, category_count: 54, removable: true },
      { ...CML, installed: true, category_count: 11, removable: false },
    ]
    render(<MethodLibrary onClose={() => {}} />)
    expect(await screen.findByTestId('installed-recipe_2016_midpoint')).toBeTruthy()
    expect(screen.getByTestId('installed-cml_v4_8_2016')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Install$/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /Uninstall/ })).toHaveLength(1)
  })
})

describe('the factor-source sentence', () => {
  it('is shown on every entry', async () => {
    render(<MethodLibrary onClose={() => {}} />)
    await screen.findByText(MID.name)
    for (const e of [MID, END, CML, CML_NOLT, IW]) {
      await click(screen.getByTestId(`method-info-${e.id}`))
      expect(screen.getByTestId(`factor-source-${e.id}`)).toBeTruthy()
      await click(screen.getByTestId(`method-info-${e.id}`))
    }
  })

  it('is the ecoinvent 3.9 bundled sentence on the offline entries, and the real source on the others', async () => {
    render(<MethodLibrary onClose={() => {}} />)
    await screen.findByText(MID.name)
    for (const e of [MID, END, CML, CML_NOLT]) {
      await click(screen.getByTestId(`method-info-${e.id}`))
      const text = screen.getByTestId(`factor-source-${e.id}`).textContent ?? ''
      await click(screen.getByTestId(`method-info-${e.id}`))
      expect(text).toContain('ecoinvent 3.9 LCIA implementation bundled with the installed software')
      expect(text).toContain('flows that ecoinvent added after 3.9 have no factors')
      expect(text).toContain('how many factors were linked and skipped for this project')
    }
    await click(screen.getByTestId('method-info-impact_world_plus_2_2_1'))
    const iw = screen.getByTestId('factor-source-impact_world_plus_2_2_1').textContent ?? ''
    expect(iw).toContain('Zenodo')
    expect(iw).not.toContain('ecoinvent 3.9')
  })

  it('also appears on a method row that was already in the project', async () => {
    library = [{
      id: 'bundled::TRACI v2.1', name: 'TRACI v2.1', description: '', long_description: null, source: 'bundled',
      installed: true, category_count: 9, size_mb: null, source_url: null, citation: null, installer: null,
      notes: null, detected_ei_version: null, available_variants: null, unit: null,
      factor_source: 'Already in this project and not installed by this app.',
    }]
    render(<MethodLibrary onClose={() => {}} />)
    expect((await screen.findByTestId('factor-source-bundled::TRACI v2.1')).textContent).toContain('not installed by this app')
  })
})

describe('an install that lost factors', () => {
  async function finish(report: client.LCIAInstallReport, warnings: string[]) {
    render(<MethodLibrary onClose={() => {}} />)
    const row = (await screen.findByText(CML.name)).closest('div[style*="border"]') as HTMLElement
    await click(Array.from(row.querySelectorAll('button')).find((b) => /Install/.test(b.textContent ?? ''))!)
    await waitFor(() => expect(onMessage).toBeDefined())
    await act(async () => { onMessage({ type: 'done', method_tuples: [], warnings, report }) })
  }

  it('shows the counts, the skipped flows and the indicators that lost the most', async () => {
    await finish(REPORT, WARNINGS)
    const report = await screen.findByTestId('install-report-cml_v4_8_2016')
    expect(report.textContent).toContain('11 methods registered')
    expect(report.textContent).toContain('3,645 linked')
    expect(report.textContent).toContain('377 skipped')
    expect(screen.getByText(/377 of 4,022 characterisation factors \(9.4%\) were skipped/)).toBeTruthy()
    expect(screen.getByText('Chloroform [air / stratosphere]: 6 factors')).toBeTruthy()
    expect(screen.getByText(/ADP elements \(CML v4.8 2016\): 80 of 129 factors skipped/)).toBeTruthy()
  })

  it('shows a failure message in the row', async () => {
    render(<MethodLibrary onClose={() => {}} />)
    const row = (await screen.findByText(CML.name)).closest('div[style*="border"]') as HTMLElement
    await click(Array.from(row.querySelectorAll('button')).find((b) => /Install/.test(b.textContent ?? ''))!)
    await waitFor(() => expect(onMessage).toBeDefined())
    await act(async () => { onMessage({ type: 'error', error: "This project has no 'biosphere3'. Import an ecoinvent database into the project first." }) })
    expect(await screen.findByText(/no 'biosphere3'\. Import an ecoinvent database/)).toBeTruthy()
  })
})
