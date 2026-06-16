/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { MultiProductLCA, scopeForMode } from '../src/components/impact/MultiProductLCA'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'

// Patch 5X Part 2 — lifecycle SCOPE is Archetypes-only. The selector must not
// render in Activities mode; the CONFIGURATION summary omits the scope token;
// activities lock to Full Lifecycle ('all') in the payload (scope is a no-op
// for activities — ActivityLCARequest has no scope field).

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
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
  // Set archetypes LAST (bomStore clears on currentProject change).
  useBOMStore.setState({ archetypes: [], fetchArchetypes: vi.fn(() => Promise.resolve()) } as any)
})

const toActivities = (g: any) => act(() => { fireEvent.click(g('multi-product-mode-activity')) })
const toArchetypes = (g: any) => act(() => { fireEvent.click(g('multi-product-mode-archetype')) })

describe('scopeForMode — payload rule (Patch 5X)', () => {
  it('activities always resolve to Full Lifecycle; archetypes keep the selected scope', () => {
    expect(scopeForMode('activity', 'inflows')).toBe('all')   // no leftover non-Full leaks
    expect(scopeForMode('activity', 'all')).toBe('all')
    expect(scopeForMode('archetype', 'inflows')).toBe('inflows')
    expect(scopeForMode('archetype', 'all')).toBe('all')
  })
})

describe('Multi-item SCOPE selector — Archetypes-only (Patch 5X)', () => {
  it('SCOPE selector is PRESENT in Archetypes mode (default) and ABSENT in Activities mode', () => {
    const { getByTestId, queryByTestId } = render(<MultiProductLCA />)
    // Default = Archetypes → scope row present.
    expect(queryByTestId('multi-product-scope-row')).not.toBeNull()
    expect(queryByTestId('multi-product-scope-all')).not.toBeNull()
    toActivities(getByTestId)
    expect(queryByTestId('multi-product-scope-row')).toBeNull()
    expect(queryByTestId('multi-product-scope-all')).toBeNull()
    // Round-trip back → present again.
    toArchetypes(getByTestId)
    expect(queryByTestId('multi-product-scope-row')).not.toBeNull()
  })

  it('CONFIGURATION collapsed summary omits the scope token in Activities, keeps it in Archetypes', () => {
    const { getByTestId, container } = render(<MultiProductLCA />)
    // The summary renders only when Configuration is COLLAPSED. Toggle via the
    // "Configuration" heading.
    const configHeading = () =>
      Array.from(container.querySelectorAll('h3')).find((h) => h.textContent === 'Configuration')!
    const toggleConfig = () => act(() => { fireEvent.click(configHeading()) })

    // Archetypes (default): collapse → summary includes the scope label.
    toggleConfig()
    expect(getByTestId('multi-product-scope-summary').textContent).toContain('Full Lifecycle')

    // Re-expand, switch to Activities, collapse again → no scope token, methods kept.
    toggleConfig() // expand
    toActivities(getByTestId)
    toggleConfig() // collapse
    const txt = getByTestId('multi-product-scope-summary').textContent || ''
    expect(txt).not.toContain('Full Lifecycle')
    expect(txt).toContain('No methods selected')
  })
})
