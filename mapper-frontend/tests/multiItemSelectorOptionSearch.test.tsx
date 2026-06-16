/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { MultiItemSelector } from '../src/components/shared/MultiItemSelector'
import type { ActivitySummary } from '../src/api/client'

// Patch 5T — threshold-gated, client-side option search inside the shared
// FilterDropdown (Location / Unit). View-only over the in-memory options:
// never a backend query, never changes the selection. Lock the mechanism.

const ACT: ActivitySummary[] = [
  { key: 'k1', code: 'c1', name: 'electricity, low voltage', location: 'FR', unit: 'kWh', product: 'electricity', database: 'ei-3.10' },
] as any

const MANY_LOCS = ['AE', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'CH', 'DE', 'DK', 'FR', 'IT']  // 12 > threshold(8)

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

function renderSelector(extra?: any) {
  return render(
    <MultiItemSelector
      mode="activity"
      availableActivities={ACT}
      selectedItems={[]}
      onAddItem={vi.fn()}
      onRemoveItem={vi.fn()}
      filterOptions={{ locations: MANY_LOCS, units: ['kWh', 'm3'] }}
      {...extra}
    />,
  )
}

const LOC = 'multi-item-selector-location-filter'
const UNIT = 'multi-item-selector-unit-filter'

const openLocation = (container: HTMLElement) => {
  const filter = container.querySelector(`[data-testid="${LOC}"]`) as HTMLElement
  fireEvent.click(filter.querySelector('button')!)
  return container.querySelector(`[data-testid="${LOC}-menu"]`) as HTMLElement
}

describe('FilterDropdown option search (Patch 5T)', () => {
  it('typing filters the visible options (case-insensitive substring); clearing restores all', () => {
    const { container } = renderSelector()
    openLocation(container)
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    expect(search).not.toBeNull()

    // Lowercase query matches uppercase codes.
    fireEvent.change(search, { target: { value: 'd' } })
    expect(container.querySelector(`[data-testid="${LOC}-option-DK"]`)).not.toBeNull()
    expect(container.querySelector(`[data-testid="${LOC}-option-DE"]`)).not.toBeNull()
    expect(container.querySelector(`[data-testid="${LOC}-option-FR"]`)).toBeNull()  // no 'd'
    expect(container.querySelector(`[data-testid="${LOC}-option-AE"]`)).toBeNull()

    // Clearing restores the full list.
    fireEvent.change(search, { target: { value: '' } })
    expect(container.querySelector(`[data-testid="${LOC}-option-FR"]`)).not.toBeNull()
    expect(container.querySelector(`[data-testid="${LOC}-option-AE"]`)).not.toBeNull()
  })

  it('a selected option stays selected when filtered out of view and after clearing', () => {
    const onFiltersChange = vi.fn()
    const { container } = renderSelector({ onFiltersChange })
    openLocation(container)

    // Select DK (this fires onFiltersChange — the real filter application).
    const dk = container.querySelector(`[data-testid="${LOC}-option-DK"] input`) as HTMLInputElement
    fireEvent.click(dk)
    expect((container.querySelector(`[data-testid="${LOC}-option-DK"] input`) as HTMLInputElement).checked).toBe(true)
    expect(onFiltersChange).toHaveBeenCalledTimes(1)

    // Search hides DK from view — selection must NOT change, no filter call.
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'fr' } })
    expect(container.querySelector(`[data-testid="${LOC}-option-DK"]`)).toBeNull()  // out of view
    expect(onFiltersChange).toHaveBeenCalledTimes(1)  // search did NOT touch the filter

    // Clear search → DK reappears, still checked.
    fireEvent.change(search, { target: { value: '' } })
    expect((container.querySelector(`[data-testid="${LOC}-option-DK"] input`) as HTMLInputElement).checked).toBe(true)
  })

  it('search input is hidden when options ≤ threshold (Unit has 2), shown when > threshold (Location has 12)', () => {
    const { container } = renderSelector()
    // Unit filter: 2 options → no search.
    const unit = container.querySelector(`[data-testid="${UNIT}"]`) as HTMLElement
    fireEvent.click(unit.querySelector('button')!)
    expect(container.querySelector(`[data-testid="${UNIT}-search"]`)).toBeNull()
    // Location filter: 12 options → search present.
    openLocation(container)
    expect(container.querySelector(`[data-testid="${LOC}-search"]`)).not.toBeNull()
  })

  it('renders "No matches" when nothing matches', () => {
    const { container } = renderSelector()
    openLocation(container)
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'zzzz' } })
    expect(container.querySelector(`[data-testid="${LOC}-no-matches"]`)).not.toBeNull()
    expect(container.querySelector(`[data-testid="${LOC}-option-DK"]`)).toBeNull()
  })

  it('autofocuses the search on open and resets the text on close (fresh each open)', () => {
    const { container } = renderSelector()
    const menu = openLocation(container)
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    expect(document.activeElement).toBe(search)
    fireEvent.change(search, { target: { value: 'dk' } })
    // Close (re-click the toggle) then reopen — search text is fresh.
    const filterBtn = (container.querySelector(`[data-testid="${LOC}"]`) as HTMLElement).querySelector('button')!
    fireEvent.click(filterBtn)  // close
    fireEvent.click(filterBtn)  // reopen
    const reopened = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    expect(reopened.value).toBe('')
    void menu; void within
  })

  it('regression: search is view-only — typing never fires onFiltersChange; selecting an option still does', () => {
    const onFiltersChange = vi.fn()
    const { container } = renderSelector({ onFiltersChange })
    openLocation(container)
    const search = container.querySelector(`[data-testid="${LOC}-search"]`) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'dk' } })
    fireEvent.change(search, { target: { value: 'd' } })
    expect(onFiltersChange).not.toHaveBeenCalled()  // pure view filter
    // Selecting a filtered-to option applies the real filter.
    fireEvent.click(container.querySelector(`[data-testid="${LOC}-option-DK"] input`) as HTMLInputElement)
    expect(onFiltersChange).toHaveBeenCalledTimes(1)
  })
})
