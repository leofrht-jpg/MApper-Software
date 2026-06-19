/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MultiItemSelector } from '../src/components/shared/MultiItemSelector'
import type { ActivitySummary } from '../src/api/client'

// #4 — value-filters (location/unit/folder) are keyed to the SOURCE database's
// distinct-value universe; left stale across a DB switch they filter the new
// DB's rows to zero ("no matches after switching DB"). The `sourceKey` prop
// drives a reset of those filters when it changes — but the SEARCH TEXT is
// preserved (DB-independent user intent).

const DK = { key: 'k-dk', code: 'cdk', name: 'market for electricity, low voltage',
  location: 'DK', unit: 'kWh', product: 'electricity, low voltage', database: 'ei-3.10' }
const FR = { key: 'k-fr', code: 'cfr', name: 'market for electricity, low voltage',
  location: 'FR', unit: 'kWh', product: 'electricity, low voltage', database: 'ei-3.10' }
const ACTIVITIES: ActivitySummary[] = [DK, FR]

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

function applyDkFilter(container: HTMLElement) {
  const filter = container.querySelector('[data-testid="multi-item-selector-location-filter"]') as HTMLElement
  fireEvent.click(filter.querySelector('button')!)
  const dk = container.querySelector('[data-testid="multi-item-selector-location-filter-option-DK"]') as HTMLElement
  fireEvent.click(dk.querySelector('input[type="checkbox"]') as HTMLInputElement)
}

describe('#4 sourceKey resets stale value-filters on DB switch', () => {
  it('changing sourceKey clears the location filter so the new DB rows return; re-emits empty filters', () => {
    const onFilters = vi.fn()
    const { container, rerender } = render(
      <MultiItemSelector mode="activity" availableActivities={ACTIVITIES}
        selectedItems={[]} onAddItem={vi.fn()} onRemoveItem={vi.fn()}
        onFiltersChange={onFilters} sourceKey="ecoinvent-3.10-cutoff" />,
    )
    // No filter-reset emit on mount (preserves any pre-set filter).
    expect(onFilters).not.toHaveBeenCalled()

    // Apply DK filter → FR row filtered out (client-side).
    applyDkFilter(container)
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|cdk"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|cfr"]')).toBeNull()
    onFilters.mockClear()

    // Switch source DB (sourceKey change) → value-filter cleared, both rows back.
    rerender(
      <MultiItemSelector mode="activity" availableActivities={ACTIVITIES}
        selectedItems={[]} onAddItem={vi.fn()} onRemoveItem={vi.fn()}
        onFiltersChange={onFilters} sourceKey="ecoinvent-3.11-cutoff" />,
    )
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|cdk"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|cfr"]')).not.toBeNull()
    // Store parity: cleared filters re-emitted.
    expect(onFilters).toHaveBeenCalledWith({ locations: [], units: [] })
  })

  it('preserves the search text across a sourceKey change (DB-independent intent)', () => {
    const { container, rerender } = render(
      <MultiItemSelector mode="activity" availableActivities={ACTIVITIES}
        selectedItems={[]} onAddItem={vi.fn()} onRemoveItem={vi.fn()}
        sourceKey="ecoinvent-3.10-cutoff" />,
    )
    const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'market for electricity, low voltage' } })
    expect(search.value).toBe('market for electricity, low voltage')

    rerender(
      <MultiItemSelector mode="activity" availableActivities={ACTIVITIES}
        selectedItems={[]} onAddItem={vi.fn()} onRemoveItem={vi.fn()}
        sourceKey="ecoinvent-3.11-cutoff" />,
    )
    const search2 = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
    // Search text retained — switching DB is often done to re-find the same term.
    expect(search2.value).toBe('market for electricity, low voltage')
  })

  it('idle (no sourceKey change) leaves the value-filter intact', () => {
    const { container, rerender } = render(
      <MultiItemSelector mode="activity" availableActivities={ACTIVITIES}
        selectedItems={[]} onAddItem={vi.fn()} onRemoveItem={vi.fn()}
        sourceKey="ecoinvent-3.10-cutoff" />,
    )
    applyDkFilter(container)
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|cfr"]')).toBeNull()
    // Re-render with the SAME sourceKey → filter must persist.
    rerender(
      <MultiItemSelector mode="activity" availableActivities={ACTIVITIES}
        selectedItems={[]} onAddItem={vi.fn()} onRemoveItem={vi.fn()}
        sourceKey="ecoinvent-3.10-cutoff" />,
    )
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|cdk"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|cfr"]')).toBeNull()
  })
})
