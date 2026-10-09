/* SPDX-License-Identifier: MPL-2.0 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { useBOMStore } from '../src/stores/bomStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import { calculateArchetypeLCA, type ArchetypeSummary } from '../src/api/client'

/**
 * A project switch must not carry the previous project's archetype id.
 *
 * Reported walking 0.3.0: in MAp-test, Single-product > Prospective showed
 * "Archetype '9e9a2b56-...' not found" while the dropdown read BEV-NCA. The id
 * belongs to v030-demo-check, open before the switch. The selection lived in
 * SingleProductImpact's local state (an always-mounted subtree) and
 * useSingleProductImpactStore had no project-change reset, so after the switch
 * the stale id stayed selected, Calculate stayed enabled and sent it, and the
 * error banner outlived a later pick of BEV-NCA.
 */

const FAM = 'EF v3.1'
const MOCK = [{ family: FAM, categories: [
  { category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: [FAM, 'climate change', 'GWP100'] }] },
] }]

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getMethods: vi.fn(() => Promise.resolve(MOCK)),
    calculateArchetypeLCA: vi.fn((id: string) => Promise.reject(new Error(`Archetype '${id}' not found`))),
  }
})

const mk = (id: string, name: string): ArchetypeSummary => ({
  id, name, folder: null, material_count: 2, unlinked_count: 0,
  stages: ['Manufacturing'], stage_annual: {}, validation_error_rows: 0,
} as any)

const PDBS = [{ name: 'ei-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030], mode: 'separate', created_at: 'x' }]
const DEMO_ID = '9e9a2b56-0537-4e00-9ab1-21c93ac8a301'
const DEMO = [mk(DEMO_ID, 'Enclosure (worked example)')]
const MAPTEST = [mk('bev-nca', 'BEV-NCA'), mk('icev', 'ICEV-Petrol')]

beforeEach(() => {
  // @ts-expect-error minimal jsdom stub for recharts
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.mocked(calculateArchetypeLCA).mockClear()
  useProjectStore.setState({ currentProject: 'v030-demo-check' })
  useBOMStore.setState({
    archetypes: DEMO,
    fetchArchetypes: async () => { useBOMStore.setState({ archetypes: MAPTEST }) },
  } as any)
  useSingleProductImpactStore.getState().reset()
  usePLCAStore.setState({ databases: PDBS } as any)
})

describe('switching project in Single-product', () => {
  async function switchToMapTest() {
    render(<SingleProductImpact />)
    expect(useSingleProductImpactStore.getState().archetypeId).toBe(DEMO_ID)
    await act(async () => { useProjectStore.setState({ currentProject: 'MAp-test' }) })
    // plcaStore resets on the switch (correctly); MAp-test has its own premise DBs.
    await act(async () => { usePLCAStore.setState({ databases: PDBS, fetchDatabases: async () => {} } as any) })
  }

  it('drops the previous project selection and picks one from the new project', async () => {
    await switchToMapTest()
    await waitFor(() => expect(screen.getByTestId('archetype-select-button').textContent).toBe('BEV-NCA'))
    expect(useSingleProductImpactStore.getState().archetypeId).toBe('bev-nca')
  })

  it('never sends the previous project archetype id on a Prospective run', async () => {
    await switchToMapTest()
    fireEvent.click(screen.getByTestId('single-product-tab-projected'))
    const pane = screen.getByTestId('single-product-tab-pane-projected')
    await waitFor(() => expect(pane.querySelectorAll('input[type=checkbox]:checked').length).toBeGreaterThan(0))
    fireEvent.click(within(within(pane).getByTestId('single-product-projected-db-list')).getAllByRole('checkbox')[0])
    await act(async () => { fireEvent.click(within(pane).getByTestId('single-product-projected-calculate')) })
    const sent = vi.mocked(calculateArchetypeLCA).mock.calls.map((c) => c[0])
    expect(sent).not.toContain(DEMO_ID)
    expect(sent).toEqual(['bev-nca'])
  })

  it('clears the per-archetype single-product store', async () => {
    useSingleProductImpactStore.getState().setStaticConfigForArc(DEMO_ID, { scope: 'all', selectedMethods: [] })
    await act(async () => { useProjectStore.setState({ currentProject: 'MAp-test' }) })
    expect(useSingleProductImpactStore.getState().staticConfigByArc[DEMO_ID]).toBeUndefined()
  })

  it('clears Multi-item selections, which are archetype ids from one project too', async () => {
    useMultiProductLCAStore.setState({
      selectedItems: [{ type: 'archetype', archetype_id: DEMO_ID, display_name: 'Enclosure' }],
    } as any)
    await act(async () => { useProjectStore.setState({ currentProject: 'MAp-test' }) })
    expect(useMultiProductLCAStore.getState().selectedItems).toEqual([])
  })
})
