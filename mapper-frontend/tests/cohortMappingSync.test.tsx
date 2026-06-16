import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'

/**
 * Patch 5F — cohort → archetype mapping is a single source of truth owned by
 * the DSM store. The IA Static Background surface (DSMImpactPanel) is now
 * READ-ONLY and derives its "N of M mapped" count DIRECTLY from the store
 * slice (no local snapshot), so a DSM edit propagates to IA without a remount.
 * These tests lock the mechanism, not pixel layout.
 */

// Mock the client surface the panel touches. getCohortMappings resolves empty
// so the mount-time fetch settles deterministically to {}; tests then drive
// the store explicitly. runDSMLCA is a spy for the compute-input assertion.
const runDSMLCASpy = vi.fn(async () => ({ results: [], warnings: [] }))
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getCohortMappings: vi.fn(async () => ({ mfa_system_id: 'sys-test', mappings: [], row_colors: {} })),
    runDSMLCA: (...args: unknown[]) => runDSMLCASpy(...(args as [])),
    exportImpact: vi.fn(),
  }
})

beforeEach(() => {
  runDSMLCASpy.mockClear()
  // @ts-expect-error — minimal ResizeObserver stub for recharts
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  // Seed an active system with two non-age dims → 4 cohort keys (the M in N/M).
  useDSMStore.setState({
    activeSystem: {
      id: 'sys-test',
      name: 'Test System',
      time_horizon: { start_year: 2020, end_year: 2030 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dimensions: [
        { name: 'fuel', display_name: 'Fuel', is_age: false, labels: ['BEV', 'ICEV'] },
        { name: 'size', display_name: 'Size', is_age: false, labels: ['Small', 'Large'] },
      ] as any,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemState: { scenarios: [{ id: 'base-1', name: 'Base', is_base: true }], active_scenario_id: 'base-1' } as any,
    cohortMappings: {},
  })
})

const map = (n: number): Record<string, { archetype_id: string; scaling_factor: number }> => {
  const keys = ['BEV|Small', 'BEV|Large', 'ICEV|Small', 'ICEV|Large']
  const out: Record<string, { archetype_id: string; scaling_factor: number }> = {}
  for (let i = 0; i < n; i++) out[keys[i]] = { archetype_id: `arc-${i}`, scaling_factor: 1 }
  return out
}

async function renderPanel() {
  const { DSMImpactPanel } = await import('../src/components/dsm/DSMImpactPanel')
  const utils = render(<DSMImpactPanel />)
  // Let the mount-time fetchCohortMappings() promise settle (to {}).
  await act(async () => { await Promise.resolve() })
  return utils
}

describe('cohort-mapping sync — single source of truth', () => {
  it('propagation: a store edit updates the IA count without remounting', async () => {
    const { getByTestId } = await renderPanel()

    act(() => { useDSMStore.setState({ cohortMappings: map(2) }) })
    const node = getByTestId('ia-cohort-mapped-count')
    expect(node.textContent).toContain('2 of 4 mapped')

    // Simulate an edit made from the DSM surface (writes the shared slice).
    act(() => { useDSMStore.setState({ cohortMappings: map(4) }) })
    // Same DOM node — the panel re-read the store, it did not remount.
    expect(getByTestId('ia-cohort-mapped-count')).toBe(node)
    expect(node.textContent).toContain('4 of 4 mapped')
  })

  it('regression guard (root cause A): the count reflects a store value set AFTER mount (subscribes, not snapshots)', async () => {
    const { getByTestId } = await renderPanel()
    // Nothing mapped at mount → 0 of 4.
    expect(getByTestId('ia-cohort-mapped-count').textContent).toContain('0 of 4 mapped')
    // Mutate the store post-mount; a mount-time snapshot would stay at 0.
    act(() => { useDSMStore.setState({ cohortMappings: map(3) }) })
    expect(getByTestId('ia-cohort-mapped-count').textContent).toContain('3 of 4 mapped')
  })

  it('single source: IA count equals the count derived from the DSM store slice; no duplicate slice in impactStore', async () => {
    const { getByTestId } = await renderPanel()
    act(() => { useDSMStore.setState({ cohortMappings: map(2) }) })

    const fromStore = Object.values(useDSMStore.getState().cohortMappings).filter((v) => v?.archetype_id).length
    expect(getByTestId('ia-cohort-mapped-count').textContent).toContain(`${fromStore} of 4 mapped`)

    // The mapping must not be duplicated into the impact store.
    expect('cohortMappings' in useImpactStore.getState()).toBe(false)
  })

  it('compute-input: the Calculate path keys the mapping by system id and carries NO mapping payload', async () => {
    await act(async () => {
      await useDSMStore.getState().runDSMLCA([['EF v3.1', 'climate change']], 'all', { yearStart: 2020, yearEnd: 2030 })
    })
    await waitFor(() => expect(runDSMLCASpy).toHaveBeenCalledTimes(1))

    const [systemId, methods, opts] = runDSMLCASpy.mock.calls[0] as [string, string[][], Record<string, unknown>]
    // Backend reads the persisted (shared) mapping for this system — the
    // request selects it by id, never sends an independent client snapshot.
    expect(systemId).toBe('sys-test')
    expect(methods).toEqual([['EF v3.1', 'climate change']])
    const serialized = JSON.stringify({ systemId, methods, opts })
    expect(serialized.toLowerCase()).not.toContain('cohort_mapping')
    expect(serialized.toLowerCase()).not.toContain('"mappings"')
    expect(serialized).not.toContain('archetype_id')
  })
})
