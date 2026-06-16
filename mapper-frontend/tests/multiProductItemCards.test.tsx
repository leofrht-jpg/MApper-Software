/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type { ArchetypeSummary } from '../src/api/client'
import type { ProductItem } from '../src/components/shared/productItem'

// Patch 5W — per-item STAGE AMOUNTS cards get the elevated variant + a 1-based
// number badge; structural cards (ITEMS TO COMPARE / CONFIGURATION) stay on the
// base surface. Lock variant token + badge text + re-sequencing.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const mkArc = (id: string, name: string): ArchetypeSummary => ({
  id, name, description: null, category: 'pc', folder: 'PC',
  material_count: 5, unlinked_count: 0,
  stages: ['Manufacturing', 'Use Phase', 'End of Life'], stage_annual: { 'Use Phase': true },
  created_at: '', updated_at: '',
} as any)

const arcItem = (id: string, name: string): ProductItem =>
  ({ type: 'archetype', archetype_id: id, display_name: name } as ProductItem)

const STAGE_ENTRY = { preset: '1year', lifetime: 15, amounts: { Manufacturing: 1, 'Use Phase': 1, 'End of Life': 1 } }

// Seed selection + per-item stage entries explicitly (deterministic — don't
// depend on the reconcile-effect timing; matches multiProductStageAmounts).
const seedItems = (items: ProductItem[]) => act(() => {
  const stageAmountsByItem: Record<string, any> = {}
  for (const it of items) if (it.type === 'archetype') stageAmountsByItem[`arc:${it.archetype_id}`] = { ...STAGE_ENTRY }
  useMultiProductLCAStore.setState({ selectedItems: items, stageAmountsByItem } as any)
})

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.spyOn(client, 'getMethods').mockResolvedValue([])
  useActivityStore.setState({ activities: [], selectedDatabase: 'ei-3.10', searchActivities: vi.fn(), setDatabase: vi.fn(), setLocations: vi.fn(), setUnits: vi.fn(), distinctValues: { locations: [], units: [] } } as any)
  useProjectStore.setState({ databases: [{ name: 'ei-3.10' }] as any, currentProject: 'test-proj' } as any)
  usePLCAStore.setState({ databases: [], fetchDatabases: vi.fn() } as any)
  useMultiProductLCAStore.getState().reset()
  // Set archetypes LAST: bomStore subscribes to currentProject and clears
  // archetypes on change (real app re-fetches; our fetchArchetypes is a stub),
  // so seed after currentProject is set to avoid the first-test clobber.
  useBOMStore.setState({ archetypes: [mkArc('arc-a', 'PHEV-NMC622'), mkArc('arc-b', 'BEV-LFP')], fetchArchetypes: vi.fn(() => Promise.resolve()) } as any)
})

const badge = (c: HTMLElement, key: string) => c.querySelector(`[data-testid="multi-product-item-badge-${key}"]`) as HTMLElement
const sectionFor = (el: HTMLElement) => el.closest('section') as HTMLElement
// Structural card section by its heading text.
const cardByHeading = (c: HTMLElement, text: string): HTMLElement => {
  const headings = Array.from(c.querySelectorAll('h3'))
  const h = headings.find((x) => x.textContent === text)!
  return h.closest('section') as HTMLElement
}

describe('Multi-item per-item cards — elevated + numbered (Patch 5W)', () => {
  it('per-item cards use the elevated variant and carry sequential number badges (1, 2)', () => {
    seedItems([arcItem('arc-a', 'PHEV-NMC622'), arcItem('arc-b', 'BEV-LFP')])
    const { container } = render(<MultiProductLCA />)

    const a = badge(container, 'arc:arc-a')
    const b = badge(container, 'arc:arc-b')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    // 1-based, in render order.
    expect(a.textContent).toBe('1')
    expect(b.textContent).toBe('2')
    // Per-item card sits on the elevated surface.
    expect(sectionFor(a).style.backgroundColor).toBe('var(--bg-elevated)')
    expect(sectionFor(b).style.backgroundColor).toBe('var(--bg-elevated)')
  })

  it('badges re-sequence after removing the first item (remaining shows "1")', () => {
    seedItems([arcItem('arc-a', 'PHEV-NMC622'), arcItem('arc-b', 'BEV-LFP')])
    const { container } = render(<MultiProductLCA />)
    expect(badge(container, 'arc:arc-b').textContent).toBe('2')
    // Remove the first item → arc-b becomes #1.
    seedItems([arcItem('arc-b', 'BEV-LFP')])
    expect(badge(container, 'arc:arc-a')).toBeNull()
    expect(badge(container, 'arc:arc-b').textContent).toBe('1')
  })

  it('regression: structural cards (ITEMS TO COMPARE / CONFIGURATION) stay on the base surface', () => {
    seedItems([arcItem('arc-a', 'PHEV-NMC622')])
    const { container } = render(<MultiProductLCA />)
    expect(cardByHeading(container, 'Items to compare').style.backgroundColor).toBe('var(--bg-surface)')
    expect(cardByHeading(container, 'Configuration').style.backgroundColor).toBe('var(--bg-surface)')
    // And the per-item card is NOT on the base surface (hierarchy preserved).
    expect(sectionFor(badge(container, 'arc:arc-a')).style.backgroundColor).toBe('var(--bg-elevated)')
  })
})
