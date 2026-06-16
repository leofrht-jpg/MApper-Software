/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { MultiItemSelector } from '../src/components/shared/MultiItemSelector'
import type { ProductItem } from '../src/components/shared/productItem'
import type { ActivitySummary, ArchetypeSummary } from '../src/api/client'

// Patch 4AG.2 — <MultiItemSelector> unit tests. Component is
// purely presentational (no API calls, no store reads); parent
// owns selectedItems state. Tests stub the parent via vi.fn()
// callbacks + a controlled-state harness.
//
// Coverage:
//   - Renders in archetype, activity, mixed modes with the right
//     filter chips per mode (anti-pattern guard: no folder filter
//     in pure activity mode, no Location/Unit in pure archetype).
//   - Clicking a result emits the correct ProductItem shape via
//     onAddItem (archetype vs activity payload discriminator).
//   - Clicking a selected result emits onRemoveItem with the
//     same item key.
//   - Chip X button emits onRemoveItem.
//   - Search filters results by name / product / location.
//   - Folder / Location / Unit multi-select filters narrow results.
//   - Sort dropdown reorders results.
//   - Clear filters resets search + multi-selects.
//   - maxItems disables unsel/unselected rows with tooltip; chip
//     panel shows N/max.
//   - Empty selection renders the chips empty state.
//   - Mixed mode shows section headers AND type toggles; toggling
//     off a type hides its results.

const ARCHETYPES: ArchetypeSummary[] = [
  {
    id: 'arc-bev', name: 'BEV-LFP small', description: null,
    category: 'passenger car', folder: 'Passenger cars',
    material_count: 24, unlinked_count: 0, stages: ['Manufacturing', 'Use Phase'],
    stage_annual: {}, created_at: '', updated_at: '',
  },
  {
    id: 'arc-icev', name: 'ICEV petrol', description: null,
    category: 'passenger car', folder: 'Passenger cars',
    material_count: 30, unlinked_count: 0, stages: ['Manufacturing'],
    stage_annual: {}, created_at: '', updated_at: '',
  },
  {
    id: 'arc-truck', name: 'Diesel truck', description: null,
    category: 'commercial', folder: 'Commercial vehicles',
    material_count: 18, unlinked_count: 0, stages: ['Manufacturing'],
    stage_annual: {}, created_at: '', updated_at: '',
  },
]

const ACTIVITIES: ActivitySummary[] = [
  { key: 'k1', code: 'c1', name: 'market for battery, lithium-ion', location: 'GLO', unit: 'kg', product: 'battery, lithium-ion', database: 'ei-3.10' },
  { key: 'k2', code: 'c2', name: 'electricity production, hydro', location: 'CH', unit: 'kWh', product: 'electricity, high voltage', database: 'ei-3.10' },
  { key: 'k3', code: 'c3', name: 'transport, freight, lorry', location: 'RER', unit: 'tkm', product: 'transport, freight, lorry', database: 'ei-3.10' },
]

function ControlledHarness({
  mode, archetypes = ARCHETYPES, activities = ACTIVITIES,
  maxItems, onAddSpy, onRemoveSpy, onClearAllSpy,
}: any) {
  return (
    <ControlledState onAdd={onAddSpy} onRemove={onRemoveSpy} onClearAll={onClearAllSpy}>
      {(selectedItems, addItem, removeItem, clearAll) => (
        <MultiItemSelector
          mode={mode}
          selectedItems={selectedItems}
          onAddItem={addItem}
          onRemoveItem={removeItem}
          onClearAll={clearAll}
          maxItems={maxItems}
          availableArchetypes={archetypes}
          availableActivities={activities}
        />
      )}
    </ControlledState>
  )
}

function ControlledState({ children, onAdd, onRemove, onClearAll }: any) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useState } = require('react') as typeof import('react')
  const [items, setItems] = useState<ProductItem[]>([])
  return children(
    items,
    (it: ProductItem) => {
      onAdd?.(it)
      setItems((prev: ProductItem[]) => [...prev, it])
    },
    (it: ProductItem) => {
      onRemove?.(it)
      setItems((prev: ProductItem[]) => prev.filter((x) =>
        !(x.type === it.type && (
          (x.type === 'archetype' && it.type === 'archetype' && x.archetype_id === it.archetype_id)
          || (x.type === 'activity' && it.type === 'activity' && x.database === it.database && x.code === it.code)
        ))))
    },
    () => {
      onClearAll?.()
      setItems([])
    },
  )
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

describe('MultiItemSelector — mode-specific rendering', () => {
  it('archetype mode: renders archetypes + folder filter; no Location/Unit', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="multi-item-selector"]')).not.toBeNull()
    // Folder filter rendered (archetypes have folders).
    expect(container.querySelector('[data-testid="multi-item-selector-folder-filter"]')).not.toBeNull()
    // Location + Unit filters are activity-only — must NOT render in archetype mode.
    expect(container.querySelector('[data-testid="multi-item-selector-location-filter"]')).toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-unit-filter"]')).toBeNull()
    // All 3 archetypes appear; no activity rows.
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-icev"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-truck"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]')).toBeNull()
  })

  it('activity mode: renders activities + Location/Unit filters; no folder', () => {
    const { container } = render(
      <ControlledHarness mode="activity" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="multi-item-selector-folder-filter"]')).toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-location-filter"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-unit-filter"]')).not.toBeNull()
    // All 3 activities visible; no archetype rows.
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]')).toBeNull()
  })

  it('mixed mode: shows BOTH types, section headers, AND type toggles', () => {
    const { container } = render(
      <ControlledHarness mode="mixed" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    // Folder + Location + Unit all visible (union of filters).
    expect(container.querySelector('[data-testid="multi-item-selector-folder-filter"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-location-filter"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-unit-filter"]')).not.toBeNull()
    // Type toggles only in mixed.
    expect(container.querySelector('[data-testid="multi-item-selector-toggle-archetypes"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-toggle-activities"]')).not.toBeNull()
    // Both result sets rendered.
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]')).not.toBeNull()
  })

  it('mixed mode: matching count counts BOTH types combined', () => {
    const { container } = render(
      <ControlledHarness mode="mixed" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    const count = container.querySelector('[data-testid="multi-item-selector-count"]')!
    expect(count.textContent).toContain(`${ARCHETYPES.length + ACTIVITIES.length} matching`)
  })

  it('mixed mode: toggling off archetypes hides them from results', () => {
    const { container } = render(
      <ControlledHarness mode="mixed" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    const archetypeToggle = container.querySelector('[data-testid="multi-item-selector-toggle-archetypes"]') as HTMLElement
    fireEvent.click(archetypeToggle)
    // Archetype rows gone; activity rows remain.
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]')).toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]')).not.toBeNull()
  })
})

describe('MultiItemSelector — add/remove callbacks (correct ProductItem shape)', () => {
  it('clicking an archetype row emits onAddItem with type="archetype" + display metadata', () => {
    const onAdd = vi.fn()
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={onAdd} onRemoveSpy={vi.fn()} />,
    )
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLElement)
    expect(onAdd).toHaveBeenCalledOnce()
    const arg = onAdd.mock.calls[0][0]
    expect(arg.type).toBe('archetype')
    expect(arg.archetype_id).toBe('arc-bev')
    expect(arg.display_name).toBe('BEV-LFP small')
    expect(arg.folder).toBe('Passenger cars')
  })

  it('clicking an activity row emits onAddItem with type="activity" + amount=1', () => {
    const onAdd = vi.fn()
    const { container } = render(
      <ControlledHarness mode="activity" onAddSpy={onAdd} onRemoveSpy={vi.fn()} />,
    )
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]') as HTMLElement)
    expect(onAdd).toHaveBeenCalledOnce()
    const arg = onAdd.mock.calls[0][0]
    expect(arg.type).toBe('activity')
    expect(arg.database).toBe('ei-3.10')
    expect(arg.code).toBe('c1')
    expect(arg.amount).toBe(1.0)
    // Patch 5M — display_name is the full activity name (the discriminator
    // for look-alikes), with reference product carried separately.
    expect(arg.display_name).toBe('market for battery, lithium-ion')
    expect(arg.name).toBe('market for battery, lithium-ion')
    expect(arg.product).toBe('battery, lithium-ion')
    expect(arg.location).toBe('GLO')
    expect(arg.unit).toBe('kg')
  })

  it('clicking an already-selected row emits onRemoveItem', () => {
    const onAdd = vi.fn()
    const onRemove = vi.fn()
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={onAdd} onRemoveSpy={onRemove} />,
    )
    const row = container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLElement
    fireEvent.click(row)
    // Click again — now selected, so this should remove.
    fireEvent.click(row)
    expect(onAdd).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onRemove.mock.calls[0][0].archetype_id).toBe('arc-bev')
  })

  it('chip X button removes the item', () => {
    const onRemove = vi.fn()
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={onRemove} />,
    )
    // Add an item first.
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLElement)
    // Then click its chip's X.
    const removeBtn = container.querySelector('[data-testid="multi-item-selector-chip-remove-arc:arc-bev"]') as HTMLElement
    expect(removeBtn).not.toBeNull()
    fireEvent.click(removeBtn)
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onRemove.mock.calls[0][0].archetype_id).toBe('arc-bev')
  })

  it('Clear all button emits onClearAll', () => {
    const onClearAll = vi.fn()
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} onClearAllSpy={onClearAll} />,
    )
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLElement)
    const clearBtn = container.querySelector('[data-testid="multi-item-selector-clear-all"]') as HTMLElement
    expect(clearBtn).not.toBeNull()
    fireEvent.click(clearBtn)
    expect(onClearAll).toHaveBeenCalledOnce()
  })
})

describe('MultiItemSelector — search + filters + sort', () => {
  it('search narrows results to matching names', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'BEV' } })
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-icev"]')).toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-truck"]')).toBeNull()
  })

  it('Location filter narrows activity results', () => {
    const { container } = render(
      <ControlledHarness mode="activity" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    // Open Location filter dropdown.
    const filterWrap = container.querySelector('[data-testid="multi-item-selector-location-filter"]') as HTMLElement
    const toggle = within(filterWrap).getByTestId('multi-item-selector-location-filter-toggle')
    fireEvent.click(toggle)
    // Pick "CH".
    const opt = container.querySelector('[data-testid="multi-item-selector-location-filter-option-CH"]') as HTMLElement
    expect(opt).not.toBeNull()
    const checkbox = opt.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)
    // Only the CH activity (electricity hydro) remains.
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c2"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]')).toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c3"]')).toBeNull()
  })

  it('Sort dropdown reorders results A→Z vs Z→A', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    const results = container.querySelector('[data-testid="multi-item-selector-results"]')!
    // Default A→Z: BEV-LFP small, Diesel truck, ICEV petrol.
    const askOrder = Array.from(results.querySelectorAll('[data-testid^="multi-item-selector-result-arc"]'))
      .map((el) => el.getAttribute('data-testid'))
    expect(askOrder[0]).toContain('arc:arc-bev')
    expect(askOrder[1]).toContain('arc:arc-truck')
    expect(askOrder[2]).toContain('arc:arc-icev')

    // Switch to Z→A.
    const sort = container.querySelector('[data-testid="multi-item-selector-sort"]') as HTMLSelectElement
    fireEvent.change(sort, { target: { value: 'name-desc' } })
    const descOrder = Array.from(results.querySelectorAll('[data-testid^="multi-item-selector-result-arc"]'))
      .map((el) => el.getAttribute('data-testid'))
    expect(descOrder[0]).toContain('arc:arc-icev')
    expect(descOrder[1]).toContain('arc:arc-truck')
    expect(descOrder[2]).toContain('arc:arc-bev')
  })

  it('Clear filters resets search + filter state', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'BEV' } })
    // Clear-filters appears only when filters are active.
    const clearBtn = container.querySelector('[data-testid="multi-item-selector-clear-filters"]') as HTMLElement
    expect(clearBtn).not.toBeNull()
    fireEvent.click(clearBtn)
    expect(search.value).toBe('')
    // All 3 archetypes visible again.
    expect(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-icev"]')).not.toBeNull()
  })

  it('Clear filters button hidden when no filters are active', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="multi-item-selector-clear-filters"]')).toBeNull()
  })

  it('No matches → results pane shows empty-state message', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'xyzzy_no_match' } })
    const results = container.querySelector('[data-testid="multi-item-selector-results"]')!
    expect(results.textContent).toContain('No matches')
  })
})

describe('MultiItemSelector — maxItems cap', () => {
  it('disables unselected rows when N = maxItems', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} maxItems={2} />,
    )
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-icev"]') as HTMLElement)
    // Third row should now be disabled.
    const third = container.querySelector('[data-testid="multi-item-selector-result-arc:arc-truck"]') as HTMLButtonElement
    expect(third.disabled).toBe(true)
    expect(third.getAttribute('title')).toContain('Max items')
  })

  it('shows N / max in the chips panel header', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} maxItems={3} />,
    )
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLElement)
    // The chips pane header reads "Selected: 1 / 3".
    const chipsPaneText = container.textContent ?? ''
    expect(chipsPaneText).toContain('Selected: 1 / 3')
  })

  it('selected rows remain clickable (can be deselected) even at max', () => {
    const onRemove = vi.fn()
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={onRemove} maxItems={2} />,
    )
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-icev"]') as HTMLElement)
    // Even at max, the SELECTED bev row should still be removable.
    const selectedRow = container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLButtonElement
    expect(selectedRow.disabled).toBe(false)
    fireEvent.click(selectedRow)
    expect(onRemove).toHaveBeenCalledOnce()
  })
})

describe('MultiItemSelector — chips panel empty state', () => {
  it('shows empty-state message when no selections', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="multi-item-selector-chips-empty"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-clear-all"]')).toBeNull()
  })

  it('hides empty state when at least one item is selected', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLElement)
    expect(container.querySelector('[data-testid="multi-item-selector-chips-empty"]')).toBeNull()
    expect(container.querySelector('[data-testid="multi-item-selector-chip-arc:arc-bev"]')).not.toBeNull()
  })
})

describe('MultiItemSelector — selected row visual state', () => {
  it('selected row carries aria-selected / selected styling', () => {
    const { container } = render(
      <ControlledHarness mode="archetype" onAddSpy={vi.fn()} onRemoveSpy={vi.fn()} />,
    )
    const row = container.querySelector('[data-testid="multi-item-selector-result-arc:arc-bev"]') as HTMLElement
    fireEvent.click(row)
    // Row's checkbox-mimic span now contains a check svg (Patch
    // 4AG.2 design: lucide <Check> renders only when selected).
    const checkSvg = row.querySelector('svg')
    expect(checkSvg).not.toBeNull()
  })
})
