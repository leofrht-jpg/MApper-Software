/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MultiItemSelector } from '../src/components/shared/MultiItemSelector'
import type { ActivitySummary } from '../src/api/client'

// Patch 4AI — two bugfixes to <MultiItemSelector>:
//
// Bug 1: results dropdown overflowed parent layout.
//   Pre-Patch-4AI the results list relied on the outer
//   `maxHeight: 60vh` + flex chain to engage scroll. In some
//   parent layouts (LCA Calculator's two-column grid) the chain
//   didn't resolve to a usable height and the list grew
//   unbounded, visually overlapping adjacent page sections.
//   Fix: explicit `maxHeight: 400` on the inner scroll container.
//
// Bug 2: Location/Unit filter dropdowns showed options ONLY
//   from the currently-loaded page of search results. When
//   activity search returned 50 items per page and a desired
//   location (e.g. DK) wasn't in those 50, DK never appeared
//   as a filter option even though DK activities existed in
//   the database.
//   Fix: two parts — (a) `filterOptions` prop lets parent supply
//   the full universe of locations/units from database
//   metadata; (b) `onFiltersChange` callback lets the parent
//   re-fire the backend search with the new filter parameters
//   so results reflect (query × filters), not just the
//   currently-loaded subset.

const ACTIVITIES: ActivitySummary[] = [
  { key: 'k1', code: 'c1', name: 'electricity, low voltage',
    location: 'FR', unit: 'kWh', product: 'electricity', database: 'ei-3.10' },
  { key: 'k2', code: 'c2', name: 'electricity, low voltage',
    location: 'IT', unit: 'kWh', product: 'electricity', database: 'ei-3.10' },
]

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

describe('Bug 1 — results dropdown has bounded height + internal scroll (Patch 4AI)', () => {
  it('inner results container carries an explicit maxHeight', () => {
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    )
    const results = container.querySelector('[data-testid="multi-item-selector-results"]') as HTMLElement
    expect(results).not.toBeNull()
    // Explicit maxHeight + overflow-y: auto so the list scrolls
    // internally regardless of parent flex context.
    expect(results.style.maxHeight).toBe('400px')
    expect(results.style.overflowY).toBe('auto')
  })

  it('still renders all results within the bounded container', () => {
    // Many results → all rows in DOM; just scroll-bounded.
    const many: ActivitySummary[] = Array.from({ length: 80 }, (_, i) => ({
      key: `k${i}`, code: `c${i}`, name: `act ${i}`,
      product: `act ${i}`, location: 'GLO', unit: 'kg',
      database: 'ei-3.10',
    }))
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={many}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    )
    // Sanity: 80 result rows all rendered (scroll-bounded, not
    // virtualised in this component).
    const rows = container.querySelectorAll('[data-testid^="multi-item-selector-result-act:"]')
    expect(rows.length).toBe(80)
  })
})

describe('Bug 2 — filterOptions prop supplies database-level universe (Patch 4AI)', () => {
  it('Location filter shows the FULL set of locations when filterOptions.locations is supplied', () => {
    // The loaded page has only FR + IT. If the dropdown derived
    // from `availableActivities` alone (pre-Patch-4AI), DK would
    // never appear. With `filterOptions.locations` carrying the
    // full database universe, DK shows up as a selectable option.
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        filterOptions={{
          locations: ['CH', 'DE', 'DK', 'FR', 'IT', 'NO', 'SE'],
          units: ['kWh', 'm3', 'kg'],
        }}
      />,
    )
    // Open the location filter.
    const filter = container.querySelector('[data-testid="multi-item-selector-location-filter"]') as HTMLElement
    fireEvent.click(filter.querySelector('button')!)
    // DK option must be present in the dropdown menu, even though
    // no DK activity is in availableActivities.
    expect(container.querySelector(
      '[data-testid="multi-item-selector-location-filter-option-DK"]',
    )).not.toBeNull()
  })

  it('falls back to deriving from loaded activities when filterOptions is omitted (4AG.2 default)', () => {
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    )
    const filter = container.querySelector('[data-testid="multi-item-selector-location-filter"]') as HTMLElement
    fireEvent.click(filter.querySelector('button')!)
    // Only FR + IT appear (loaded page).
    expect(container.querySelector('[data-testid="multi-item-selector-location-filter-option-FR"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-location-filter-option-IT"]')).not.toBeNull()
    // DK is NOT in the loaded page → not in the dropdown.
    expect(container.querySelector('[data-testid="multi-item-selector-location-filter-option-DK"]')).toBeNull()
  })
})

describe('Bug 2 — onFiltersChange callback fires on filter selection (Patch 4AI)', () => {
  it('selecting a Location triggers onFiltersChange with the new selection', () => {
    const onFilters = vi.fn()
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        onFiltersChange={onFilters}
        filterOptions={{ locations: ['FR', 'IT', 'DK'], units: ['kWh'] }}
      />,
    )
    const filter = container.querySelector('[data-testid="multi-item-selector-location-filter"]') as HTMLElement
    fireEvent.click(filter.querySelector('button')!)
    const dkOption = container.querySelector(
      '[data-testid="multi-item-selector-location-filter-option-DK"]',
    ) as HTMLElement
    const dkCheckbox = dkOption.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(dkCheckbox)
    expect(onFilters).toHaveBeenCalledOnce()
    expect(onFilters.mock.calls[0][0]).toEqual({ locations: ['DK'], units: [] })
  })

  it('Clear filters notifies parent with empty arrays (refresh the backend search)', () => {
    const onFilters = vi.fn()
    const onSearch = vi.fn()
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        onFiltersChange={onFilters}
        onSearchChange={onSearch}
        filterOptions={{ locations: ['FR', 'IT'], units: ['kWh'] }}
      />,
    )
    // Set a filter to enable the Clear-filters button.
    const filter = container.querySelector('[data-testid="multi-item-selector-location-filter"]') as HTMLElement
    fireEvent.click(filter.querySelector('button')!)
    const frOption = container.querySelector(
      '[data-testid="multi-item-selector-location-filter-option-FR"]',
    ) as HTMLElement
    fireEvent.click(frOption.querySelector('input[type="checkbox"]')!)
    onFilters.mockClear()
    onSearch.mockClear()
    // Click Clear filters.
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-clear-filters"]') as HTMLElement)
    // Patch 4AI: both onSearchChange('') and onFiltersChange({})
    // fire so the parent can re-dispatch a clean search.
    expect(onSearch).toHaveBeenCalledWith('')
    expect(onFilters).toHaveBeenCalledWith({ locations: [], units: [] })
  })

  it('without onFiltersChange (4AG.2 backward compat) — filter still works client-side', () => {
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={ACTIVITIES}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    )
    // Apply FR filter; only the FR row should remain.
    const filter = container.querySelector('[data-testid="multi-item-selector-location-filter"]') as HTMLElement
    fireEvent.click(filter.querySelector('button')!)
    const frOption = container.querySelector(
      '[data-testid="multi-item-selector-location-filter-option-FR"]',
    ) as HTMLElement
    fireEvent.click(frOption.querySelector('input[type="checkbox"]')!)
    // Client-side filter applies — FR row visible, IT row gone.
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c2"]')).toBeNull()
  })
})

describe('Bug 2 — Location filter predicate is NOT inverted (Patch 4AI regression guard)', () => {
  it('selecting DK shows DK results (positive match, not exclusion)', () => {
    // Sanity: the predicate keeps rows whose location IS in the
    // selected set. Pre-existing behaviour from Patch 4AG.2 —
    // locked in here so a future "fix" doesn't accidentally
    // invert it.
    const activities: ActivitySummary[] = [
      { key: 'k-dk', code: 'cdk', name: 'electricity, low voltage',
        location: 'DK', unit: 'kWh', product: 'electricity', database: 'ei-3.10' },
      { key: 'k-fr', code: 'cfr', name: 'electricity, low voltage',
        location: 'FR', unit: 'kWh', product: 'electricity', database: 'ei-3.10' },
    ]
    const { container } = render(
      <MultiItemSelector
        mode="activity"
        availableActivities={activities}
        selectedItems={[]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    )
    const filter = container.querySelector('[data-testid="multi-item-selector-location-filter"]') as HTMLElement
    fireEvent.click(filter.querySelector('button')!)
    fireEvent.click(
      (container.querySelector('[data-testid="multi-item-selector-location-filter-option-DK"]')!
        .querySelector('input[type="checkbox"]') as HTMLInputElement),
    )
    // DK row visible; FR row hidden — predicate is "location IN
    // selected", not "location NOT IN selected".
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|cdk"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|cfr"]')).toBeNull()
  })
})
