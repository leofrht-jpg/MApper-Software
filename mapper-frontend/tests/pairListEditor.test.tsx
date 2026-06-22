/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PairListEditor } from '../src/components/impact/ProjectedImpactPanel'
import type { PairedDSMLCIRef } from '../src/api/client'

// jsdom doesn't implement ResizeObserver; some recharts tooling pulls it in
// when ProjectedImpactPanel module loads. Stub it before import resolution.
beforeEach(() => {
  // @ts-expect-error — minimal stub
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const dsmScenarios = [
  { id: 'sc-base', name: 'Base', is_base: true },
  { id: 'sc-ssp1', name: 'SSP1-Sustainability' },
  { id: 'sc-ssp2', name: 'SSP2-Middle' },
  { id: 'sc-no-ssp', name: 'Custom path' },
]

const lciScenarios = [
  { key: 'ecoinvent-3.10-cutoff|remind|SSP1-PkBudg1150', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP1-PkBudg1150', years: [2030] },
  { key: 'ecoinvent-3.10-cutoff|remind|SSP2-PkBudg1150', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-PkBudg1150', years: [2030] },
  { key: 'ecoinvent-3.10-cutoff|remind|SSP5-PkBudg1150', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP5-PkBudg1150', years: [2030] },
]

function setup(initial: PairedDSMLCIRef[] = [], duplicateKeys = new Set<string>()) {
  const onChange = vi.fn<[PairedDSMLCIRef[]], void>()
  let pairs = initial
  const rerender = (next: PairedDSMLCIRef[], dupes = duplicateKeys) => {
    pairs = next
    return result.rerender(
      <PairListEditor
        pairs={pairs}
        onChange={(p) => { onChange(p); pairs = p }}
        dsmScenarios={dsmScenarios}
        lciScenarios={lciScenarios}
        duplicateKeys={dupes}
      />,
    )
  }
  const result = render(
    <PairListEditor
      pairs={pairs}
      onChange={(p) => { onChange(p); pairs = p }}
      dsmScenarios={dsmScenarios}
      lciScenarios={lciScenarios}
      duplicateKeys={duplicateKeys}
    />,
  )
  return { onChange, rerender, getPairs: () => pairs }
}

describe('PairListEditor — Add / Remove rows', () => {
  it('starts with no rows when initial is empty', () => {
    setup()
    expect(screen.queryByTestId('pair-row-0')).toBeNull()
  })

  it('clicking Add pair appends a default row using first DSM and first LCI', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByTestId('pair-add-row'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const [next] = onChange.mock.calls[0]
    expect(next).toHaveLength(1)
    expect(next[0].dsm_scenario_id).toBe('sc-base')
    expect(next[0].lci_scenario.iam).toBe('remind')
    expect(next[0].lci_scenario.ssp).toBe('SSP1-PkBudg1150')
  })

  it('clicking Remove drops the targeted row', () => {
    const initial: PairedDSMLCIRef[] = [
      { dsm_scenario_id: 'sc-ssp1', lci_scenario: { base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP1-PkBudg1150' } },
      { dsm_scenario_id: 'sc-ssp2', lci_scenario: { base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-PkBudg1150' } },
    ]
    const { onChange } = setup(initial)
    fireEvent.click(screen.getByLabelText('Remove pair 1'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const [next] = onChange.mock.calls[0]
    expect(next).toHaveLength(1)
    expect(next[0].dsm_scenario_id).toBe('sc-ssp2')
  })
})

describe('PairListEditor — duplicate detection', () => {
  it('renders inline error banner when duplicateKeys is non-empty', () => {
    const dupKey = 'sc-ssp1::ecoinvent-3.10-cutoff::remind::SSP1-PkBudg1150'
    const initial: PairedDSMLCIRef[] = [
      { dsm_scenario_id: 'sc-ssp1', lci_scenario: { base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP1-PkBudg1150' } },
      { dsm_scenario_id: 'sc-ssp1', lci_scenario: { base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP1-PkBudg1150' } },
    ]
    setup(initial, new Set([dupKey]))
    expect(screen.getByText(/duplicate pair/i)).toBeInTheDocument()
  })

  it('no banner when duplicateKeys is empty', () => {
    setup([])
    expect(screen.queryByText(/duplicate pair/i)).toBeNull()
  })
})

describe('PairListEditor — Auto-pair by SSP removed (Patch 2I)', () => {
  // The Auto-pair-by-SSP button assumed an SSP-prefixed DSM scenario naming
  // convention that doesn't hold across user populations. It was removed in
  // Patch 2I because the affordance was discoverable-but-useless for most
  // users. Manual + Add pair is the universal pattern.
  it('does not render an Auto-pair button', () => {
    setup()
    expect(screen.queryByTestId('pair-auto-pair-by-ssp')).toBeNull()
  })
})
