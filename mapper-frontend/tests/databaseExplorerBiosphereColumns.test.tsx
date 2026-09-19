/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import {
  ActivityDetailPanel, CompareModal, PlaceCell, compartmentLabel,
} from '../src/pages/DatabaseExplorer'
import type { ActivityDetail, ActivitySummary } from '../src/api/client'

// Biosphere flows in the Database Explorer. Nitrogen oxides has five flows in
// biosphere3 that differ ONLY by compartment; before this, the list showed
// five identical rows (blank location) and the compare view's Reference
// product repeated the name, which reads as data.

const nox = (cats: string[], code: string): ActivitySummary => ({
  key: `('biosphere3', '${code}')`, code, name: 'Nitrogen oxides', location: '',
  unit: 'kilogram', product: '', database: 'biosphere3', categories: cats,
})
const URBAN = nox(['air', 'urban air close to ground'], 'u')
const STACK = nox(['air', 'non-urban air or from high stacks'], 's')
const STEEL: ActivitySummary = {
  key: "('ei', 'x')", code: 'x', name: 'market for steel', location: 'GLO',
  unit: 'kilogram', product: 'steel', database: 'ei',
}

describe('compartment display', () => {
  it('joins the compartment path; empty for a technosphere activity', () => {
    expect(compartmentLabel(URBAN.categories)).toBe('air › urban air close to ground')
    expect(compartmentLabel(undefined)).toBe('')
    expect(compartmentLabel([])).toBe('')
  })

  it('a list row shows the compartment for a flow and the location for an activity', () => {
    // Scope each query to its own render: screen-level queries would find the
    // first render's cell while checking the second.
    const flow = render(<PlaceCell location={URBAN.location} categories={URBAN.categories} />)
    expect(within(flow.container).getByTestId('compartment-cell').textContent)
      .toBe('air › urban air close to ground')
    const act = render(<PlaceCell location="GLO" categories={[]} />)
    expect(within(act.container).queryByTestId('compartment-cell')).toBeNull()
    expect(act.container.textContent).toBe('GLO')
  })

  it('the compare view tells same-named flows apart and shows a dash for reference product', () => {
    const { container } = render(<CompareModal activities={[URBAN, STACK, STEEL]} onClose={() => {}} />)
    const row = (label: string) => {
      const tr = [...container.querySelectorAll('tr')].find((r) => r.firstElementChild?.textContent === label)!
      return [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent)
    }
    expect(row('Compartment')).toEqual([
      'air › urban air close to ground', 'air › non-urban air or from high stacks', '—',
    ])
    // A flow has no reference product: a dash, never a copy of the name.
    expect(row('Reference product')).toEqual(['—', '—', 'steel'])
  })

  it('the detail header shows the compartment and exchanges show each flow\'s compartment', () => {
    const detail: ActivityDetail = {
      key: "('ei', 'x')", code: 'x', name: 'transport, passenger car', location: 'RER',
      unit: 'kilometer', product: 'transport, passenger car', database: 'ei', metadata: {},
      exchanges: [
        { input_key: 'k1', input_name: 'Nitrogen oxides', input_location: '', input_categories: URBAN.categories,
          input_unit: 'kilogram', input_database: 'biosphere3', amount: 0.0001, type: 'biosphere' },
        { input_key: 'k2', input_name: 'petrol', input_location: 'RER', input_categories: [],
          input_unit: 'kilogram', input_database: 'ei', amount: 0.05, type: 'technosphere' },
      ],
    }
    const { container } = render(<ActivityDetailPanel detail={detail} onBack={() => {}} />)
    const places = within(container).getAllByTestId('exchange-place').map((e) => e.textContent)
    expect(places).toContain('air › urban air close to ground')
    expect(places).toContain('RER')
  })
})
