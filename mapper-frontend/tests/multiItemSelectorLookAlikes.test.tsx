/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { MultiItemSelector } from '../src/components/shared/MultiItemSelector'
import type { ProductItem } from '../src/components/shared/productItem'
import type { ActivitySummary } from '../src/api/client'

// Patch 5M — look-alike ecoinvent activities (same reference product +
// location + unit) must be tellable apart in BOTH the search-results list
// and the Selected panel. The discriminator is the full activity `name`
// (distinct production routes) plus the unique `code`. Lock the mechanism.

// Six activities sharing product + location + unit; differ by name and code.
const LOOK_ALIKES: ActivitySummary[] = [
  { key: 'k1', code: 'aaaa-1111', name: 'electricity production, hard coal', location: 'DK', unit: 'kWh', product: 'electricity, low voltage', database: 'ei-3.10' },
  { key: 'k2', code: 'bbbb-2222', name: 'electricity production, hydro, run-of-river', location: 'DK', unit: 'kWh', product: 'electricity, low voltage', database: 'ei-3.10' },
  { key: 'k3', code: 'cccc-3333', name: 'electricity production, wind, onshore', location: 'DK', unit: 'kWh', product: 'electricity, low voltage', database: 'ei-3.10' },
  { key: 'k4', code: 'dddd-4444', name: 'market for electricity, low voltage', location: 'DK', unit: 'kWh', product: 'electricity, low voltage', database: 'ei-3.10' },
  { key: 'k5', code: 'eeee-5555', name: 'electricity production, natural gas', location: 'DK', unit: 'kWh', product: 'electricity, low voltage', database: 'ei-3.10' },
  { key: 'k6', code: 'ffff-6666', name: 'electricity production, nuclear', location: 'DK', unit: 'kWh', product: 'electricity, low voltage', database: 'ei-3.10' },
]

function Harness({ activities = LOOK_ALIKES }: { activities?: ActivitySummary[] }) {
  const [items, setItems] = React.useState<ProductItem[]>([])
  return (
    <MultiItemSelector
      mode="activity"
      selectedItems={items}
      onAddItem={(it) => setItems((p) => [...p, it])}
      onRemoveItem={(it) => setItems((p) => p.filter((x) =>
        !(x.type === 'activity' && it.type === 'activity' && x.code === it.code)))}
      onClearAll={() => setItems([])}
      availableArchetypes={[]}
      availableActivities={activities}
      chipAmountField
      onItemAmountChange={(it, n) => setItems((p) => p.map((x) =>
        x.type === 'activity' && it.type === 'activity' && x.code === it.code ? { ...x, amount: n } : x))}
    />
  )
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

describe('MultiItemSelector — look-alike activities are distinguishable', () => {
  it('search-results rows show the distinguishing full name + code (not just shared product)', () => {
    const { container } = render(<Harness />)
    for (const a of LOOK_ALIKES) {
      const row = container.querySelector(`[data-testid="multi-item-selector-result-act:ei-3.10|${a.code}"]`) as HTMLElement
      expect(row).not.toBeNull()
      // Full activity name (the discriminator) renders, untruncated in markup.
      expect(row.textContent).toContain(a.name)
      // Unique code renders so even identical names stay distinguishable.
      expect(row.textContent).toContain(a.code)
    }
  })

  it('selected chips show the full name + code per item, so look-alikes are tellable apart', () => {
    const { container } = render(<Harness />)
    // Select all six look-alikes.
    for (const a of LOOK_ALIKES) {
      fireEvent.click(container.querySelector(`[data-testid="multi-item-selector-result-act:ei-3.10|${a.code}"]`) as HTMLElement)
    }
    for (const a of LOOK_ALIKES) {
      const chip = container.querySelector(`[data-testid="multi-item-selector-chip-act:ei-3.10|${a.code}"]`) as HTMLElement
      expect(chip).not.toBeNull()
      expect(chip.textContent).toContain(a.name)        // distinguishing name
      const code = within(chip).getByTestId(`multi-item-selector-chip-code-act:ei-3.10|${a.code}`)
      expect(code.textContent).toBe(a.code)             // guaranteed-unique code
    }
    // The shared product still appears, but it is NOT the only thing shown.
    const firstChip = container.querySelector('[data-testid="multi-item-selector-chip-act:ei-3.10|aaaa-1111"]') as HTMLElement
    expect(firstChip.textContent).toContain('electricity, low voltage')
  })

  it('amount input and remove control still work per selected chip', () => {
    const { container } = render(<Harness />)
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|aaaa-1111"]') as HTMLElement)
    const chipId = 'act:ei-3.10|aaaa-1111'
    // Amount input present + editable.
    const amount = container.querySelector(`[data-testid="multi-item-selector-chip-amount-${chipId}"]`) as HTMLInputElement
    expect(amount).not.toBeNull()
    fireEvent.change(amount, { target: { value: '2.5' } })
    fireEvent.blur(amount)
    expect(amount.value).toBe('2.5')
    // Remove: clicking the selected row again deselects (chip disappears).
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|aaaa-1111"]') as HTMLElement)
    expect(container.querySelector(`[data-testid="multi-item-selector-chip-${chipId}"]`)).toBeNull()
  })
})
