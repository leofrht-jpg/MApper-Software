/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MultiItemSelector } from '../src/components/shared/MultiItemSelector'
import type {
  ActivityProductItem, ArchetypeProductItem,
} from '../src/components/shared/productItem'
import type { ActivitySummary } from '../src/api/client'

// Patch 4AH — <MultiItemSelector> API extensions:
//   - chipAmountField (opt-in): render NumberInput + unit on
//     activity chips for functional-unit semantics.
//   - onItemAmountChange (controlled callback): parent receives
//     amount edits and updates its selectedItems.
//   - onSearchChange (controlled callback): parent receives search
//     input changes — lets the parent drive a backend search.
//
// Backward-compatibility invariants (load-bearing for Patch
// 4AG.2 / 4AG.3 / 4AG.4 callers, none of which use these props):
//   - Without chipAmountField → no NumberInput on chips
//   - Without onItemAmountChange → no callback fires
//   - Without onSearchChange → search remains purely client-side

const ACTIVITIES: ActivitySummary[] = [
  { key: 'k1', code: 'c1', name: 'battery, lithium-ion',
    location: 'GLO', unit: 'kg', product: 'battery, lithium-ion', database: 'ei-3.10' },
  { key: 'k2', code: 'c2', name: 'electricity, hydro',
    location: 'CH', unit: 'kWh', product: 'electricity', database: 'ei-3.10' },
]

const ACTIVITY_ITEM: ActivityProductItem = {
  type: 'activity', database: 'ei-3.10', code: 'c1', amount: 2.5,
  display_name: 'battery, lithium-ion', location: 'GLO', unit: 'kg',
}

const ARCHETYPE_ITEM: ArchetypeProductItem = {
  type: 'archetype', archetype_id: 'arc-1',
  display_name: 'BEV-LFP', folder: 'PC',
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

describe('chipAmountField — opt-in NumberInput on activity chips (Patch 4AH)', () => {
  it('omitted by default → no amount input renders', () => {
    // Backward-compat invariant: Patch 4AG.2 callers don't pass
    // this prop. Chips render bare (no NumberInput, no unit suffix).
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[ACTIVITY_ITEM]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    )
    const chip = container.querySelector('[data-testid="multi-item-selector-chip-act:ei-3.10|c1"]')
    expect(chip).not.toBeNull()
    expect(chip!.querySelector('[data-testid^="multi-item-selector-chip-amount-"]')).toBeNull()
  })

  it('chipAmountField=true → NumberInput + unit label render on activity chips', () => {
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[ACTIVITY_ITEM]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        chipAmountField={true}
        onItemAmountChange={vi.fn()}
      />,
    )
    const amountInput = container.querySelector(
      '[data-testid="multi-item-selector-chip-amount-act:ei-3.10|c1"]',
    ) as HTMLInputElement
    expect(amountInput).not.toBeNull()
    // NumberInput renders the formatted current value (2.5).
    expect(amountInput.value).toBe('2.5')
    // Unit label appears alongside.
    expect(container.querySelector('[data-testid="multi-item-selector-chip-act:ei-3.10|c1"]')!
      .textContent).toContain('kg')
  })

  it('archetype chips do NOT render NumberInput even when chipAmountField=true', () => {
    // Methodologically: archetypes don't have a per-item amount
    // (stage amounts are a different concept managed elsewhere).
    // The amount input is activity-only.
    const { container } = render(
      <MultiItemSelector
        mode="mixed"
        availableArchetypes={[]}
        availableActivities={[]}
        selectedItems={[ARCHETYPE_ITEM, ACTIVITY_ITEM]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        chipAmountField={true}
        onItemAmountChange={vi.fn()}
      />,
    )
    // Archetype chip: no amount input.
    const arcChip = container.querySelector('[data-testid="multi-item-selector-chip-arc:arc-1"]')!
    expect(arcChip.querySelector('input[type="text"]')).toBeNull()
    // Activity chip: amount input present.
    const actChip = container.querySelector('[data-testid="multi-item-selector-chip-act:ei-3.10|c1"]')!
    expect(actChip.querySelector('[data-testid^="multi-item-selector-chip-amount-"]')).not.toBeNull()
  })
})

describe('onItemAmountChange — controlled callback (Patch 4AH)', () => {
  it('fires with the matching item + new amount on blur', () => {
    const onAmount = vi.fn()
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[ACTIVITY_ITEM]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        chipAmountField={true}
        onItemAmountChange={onAmount}
      />,
    )
    const input = container.querySelector(
      '[data-testid="multi-item-selector-chip-amount-act:ei-3.10|c1"]',
    ) as HTMLInputElement
    // NumberInput commits on blur (not on every keystroke) per its
    // canonical-form rendering rule. Simulate user edit + blur.
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.blur(input)
    expect(onAmount).toHaveBeenCalled()
    const [item, amount] = onAmount.mock.calls[onAmount.mock.calls.length - 1]
    // Callback receives the SAME item that was passed in
    // selectedItems — parent can match against it by identity AND
    // by (database, code).
    expect(item.type).toBe('activity')
    expect(item.database).toBe('ei-3.10')
    expect(item.code).toBe('c1')
    expect(amount).toBe(7)
  })

  it('omitted callback → editing is a no-op (chip-amount input stays editable but parent gets no notification)', () => {
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[ACTIVITY_ITEM]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        chipAmountField={true}
        // no onItemAmountChange
      />,
    )
    // Input still renders; no error on edit.
    const input = container.querySelector(
      '[data-testid="multi-item-selector-chip-amount-act:ei-3.10|c1"]',
    ) as HTMLInputElement
    expect(input).not.toBeNull()
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    // No assertion on state — the controlled-value comes from the
    // parent's `item.amount`. Without a callback, the parent can't
    // update; this is the controlled-component contract.
  })
})

describe('onSearchChange — controlled callback (Patch 4AH)', () => {
  it('fires on every keystroke in the selector search input', () => {
    const onSearch = vi.fn()
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        onSearchChange={onSearch}
      />,
    )
    const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'batt' } })
    expect(onSearch).toHaveBeenCalledWith('batt')
    fireEvent.change(search, { target: { value: 'battery' } })
    expect(onSearch).toHaveBeenLastCalledWith('battery')
  })

  it('without onSearchChange, local search still works client-side', () => {
    // Backward-compat: Patch 4AG.2 callers expect client-side
    // search over availableActivities — typing narrows results.
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    )
    const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'hydro' } })
    // 'hydro' matches the electricity activity's name.
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c2"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]')).toBeNull()
  })
})
