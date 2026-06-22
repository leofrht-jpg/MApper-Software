/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MultiItemSelector } from '../src/components/shared/MultiItemSelector'
import type { ActivitySummary } from '../src/api/client'

// Patch 5X Part 1 — BOTH scroll panes (left results list, right Selected
// panel) carry the same explicit bounded maxHeight + overflow-y:auto so each
// scrolls internally (no card inflation, no nested outer scroll). Lock the
// mechanism, not pixels.

const ACT: ActivitySummary[] = Array.from({ length: 30 }, (_, i) => ({
  key: `k${i}`, code: `c${i}`, name: `act ${i}`, product: `act ${i}`,
  location: 'GLO', unit: 'kg', database: 'ei-3.10',
})) as any

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

describe('MultiItemSelector — bounded scroll panes (Patch 5X)', () => {
  it('results list AND Selected panel both have the same bounded maxHeight + overflow-y:auto', () => {
    const { container } = render(
      <MultiItemSelector mode="activity" availableActivities={ACT} selectedItems={[]} onAddItem={vi.fn()} onRemoveItem={vi.fn()} />,
    )
    const results = container.querySelector('[data-testid="multi-item-selector-results"]') as HTMLElement
    const chips = container.querySelector('[data-testid="multi-item-selector-chips"]') as HTMLElement
    expect(results.style.maxHeight).toBe('400px')
    expect(results.style.overflowY).toBe('auto')
    expect(chips.style.maxHeight).toBe('400px')   // same bound → columns align
    expect(chips.style.overflowY).toBe('auto')
  })

  it('the Selected panel bound applies even with many items (grouped override)', () => {
    const { container } = render(
      <MultiItemSelector
        mode="activity" availableActivities={ACT}
        selectedItems={[{ type: 'activity', database: 'ei-3.10', code: 'c0', amount: 1, display_name: 'act 0' } as any]}
        onAddItem={vi.fn()} onRemoveItem={vi.fn()}
        renderSelectedItems={<div data-testid="custom-selected">tall content</div>}
      />,
    )
    const chips = container.querySelector('[data-testid="multi-item-selector-chips"]') as HTMLElement
    expect(chips.style.maxHeight).toBe('400px')
    expect(chips.style.overflowY).toBe('auto')
    // The display-only override still renders inside the bounded scroll area.
    expect(container.querySelector('[data-testid="custom-selected"]')).not.toBeNull()
  })
})
