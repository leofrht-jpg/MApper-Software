/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act, fireEvent } from '@testing-library/react'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'

// Change 1 — Multi-item comparison defaults to ALL indicators on a fresh mount
// (via <MethodPicker defaultAllSelected>, shared across archetype + activity-
// vintage/prospective modes). Locks that multi-item is NOT a non-all default.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const FAM = 'EF v3.1'
const T = (cat: string) => [FAM, cat, 'ind']
const MOCK_METHODS = [{
  family: FAM,
  categories: [
    { category: 'climate change', indicators: [{ indicator: 'ind', tuple: T('climate change') }] },
    { category: 'acidification', indicators: [{ indicator: 'ind', tuple: T('acidification') }] },
    { category: 'land use', indicators: [{ indicator: 'ind', tuple: T('land use') }] },
    { category: 'water use', indicators: [{ indicator: 'ind', tuple: T('water use') }] },
  ],
}]
const TOTAL = 4

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.spyOn(client, 'getMethods').mockResolvedValue(MOCK_METHODS as any)
  useBOMStore.setState({ archetypes: [], fetchArchetypes: vi.fn(() => Promise.resolve()) } as any)
  useActivityStore.setState({ activities: [], selectedDatabase: 'ei-3.10', searchActivities: vi.fn(), setDatabase: vi.fn(), setLocations: vi.fn(), setUnits: vi.fn(), distinctValues: { locations: [], units: [] } } as any)
  useProjectStore.setState({ databases: [{ name: 'ei-3.10' }], currentProject: 'p' } as any)
  usePLCAStore.setState({ databases: [], fetchDatabases: vi.fn() } as any)
  useMultiProductLCAStore.getState().reset()
})

const allChecked = (c: HTMLElement) => {
  const boxes = c.querySelectorAll('input[type=checkbox]')
  return boxes.length === TOTAL && c.querySelectorAll('input[type=checkbox]:checked').length === TOTAL
}

describe('Change 1 — Multi-item comparison defaults to all indicators', () => {
  it('fresh mount lands on all-N indicators (archetype mode)', async () => {
    const { container, findByText } = render(<MultiProductLCA />)
    // MethodPicker(defaultAllSelected) self-selects the whole family on load.
    expect(await findByText(new RegExp(`${TOTAL} of ${TOTAL} selected`))).toBeTruthy()
    await waitFor(() => expect(allChecked(container)).toBe(true))
  })

  it('all-N persists after switching to Activities (prospective vintages) mode', async () => {
    const { container, findByText, getByTestId } = render(<MultiProductLCA />)
    await findByText(new RegExp(`${TOTAL} of ${TOTAL} selected`))
    act(() => { fireEvent.click(getByTestId('multi-product-mode-activity')) })
    // Same shared MethodPicker → still all-N (the prospective path is not a
    // separate, non-all picker).
    await waitFor(() => expect(allChecked(container)).toBe(true))
  })
})
