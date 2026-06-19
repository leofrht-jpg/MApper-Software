import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { SingleProductStaticPanel } from '../src/components/impact/SingleProductStaticPanel'
import { SingleProductProjectedPanel } from '../src/components/impact/SingleProductProjectedPanel'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useParameterStore } from '../src/stores/parameterStore'

// #2 — single-product Static must PUBLISH its defaultAllSelected selection to
// staticConfigByArc on a fresh arc, so the Projected live-mirror can inherit
// all-N (without it, Projected lands at 0/N). The fix: arm the restore effect's
// skip ref ONLY when a saved cfg exists; a fresh arc leaves it disarmed so the
// MethodPicker default-all mount-onChange flows through to the store.

const FAM = 'EF v3.1 (E,T)'
const T = (cat: string, ind: string) => [FAM, cat, ind]
const MOCK_METHODS = [{
  family: FAM,
  categories: [
    { category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: T('climate change', 'GWP100') }] },
    { category: 'acidification', indicators: [{ indicator: 'AE', tuple: T('acidification', 'AE') }] },
    { category: 'land use', indicators: [{ indicator: 'SQI', tuple: T('land use', 'SQI') }] },
    { category: 'water use', indicators: [{ indicator: 'UDP', tuple: T('water use', 'UDP') }] },
  ],
}]
const MOCK_TOTAL = 4

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, getMethods: vi.fn(() => Promise.resolve(MOCK_METHODS)) }
})

beforeEach(() => {
  // @ts-expect-error minimal jsdom stub for recharts
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useSingleProductImpactStore.getState().reset()
  useParameterStore.setState({ table: null, selectedScenarios: [] })
  usePLCAStore.setState({
    // one prospective DB so Projected mounts past its no-databases guard
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    databases: [{ name: 'ei-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030], mode: 'separate', created_at: 'x' }] as any,
  })
})

describe('#2 Static publishes default-all', () => {
  it('(a) fresh arc with no cfg → staticConfigByArc[arc] gets all-N, written exactly once', async () => {
    // Wrap the store action to count writes while still delegating to the real impl.
    const real = useSingleProductImpactStore.getState().setStaticConfigForArc
    const spy = vi.fn((arc: string, cfg: { scope: 'inflows'|'stock'|'outflows'|'all'; selectedMethods: string[][] }) => real(arc, cfg))
    useSingleProductImpactStore.setState({ setStaticConfigForArc: spy })

    render(<SingleProductStaticPanel archetypeId="arc-1" />)

    await waitFor(() => {
      expect(useSingleProductImpactStore.getState().staticConfigByArc['arc-1']?.selectedMethods.length).toBe(MOCK_TOTAL)
    })
    // Published exactly once (default-all flows through; not per-render).
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1].selectedMethods).toHaveLength(MOCK_TOTAL)
  })

  it('(b) integration: fresh load, no clicks → Projected inherits all-N via the mirror', async () => {
    render(
      <>
        <SingleProductStaticPanel archetypeId="arc-1" />
        <SingleProductProjectedPanel archetypeId="arc-1" />
      </>,
    )
    // Static publishes all-N → mirror writes projectedConfigByArc[arc] = all-N.
    await waitFor(() => {
      expect(useSingleProductImpactStore.getState().projectedConfigByArc['arc-1']?.selectedMethods.length).toBe(MOCK_TOTAL)
    })
    // The mirror must NOT have flipped Projected's freeze flag (no user edit).
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBeFalsy()
  })

  it('(c) arc-switch-back to a saved cfg restores it without a redundant write', async () => {
    // Seed a customized saved cfg for arc-1 (1 method) + a fresh arc-2.
    useSingleProductImpactStore.setState({
      staticConfigByArc: { 'arc-1': { scope: 'all', selectedMethods: [T('climate change', 'GWP100')] } },
    })
    const { rerender } = render(<SingleProductStaticPanel archetypeId="arc-1" />)
    await waitFor(() => expect(useSingleProductImpactStore.getState().staticConfigByArc['arc-1']?.selectedMethods.length).toBe(1))

    // Switch to a fresh arc, let it settle (default-all publishes for arc-2).
    await act(async () => { rerender(<SingleProductStaticPanel archetypeId="arc-2" />) })
    await waitFor(() => expect(useSingleProductImpactStore.getState().staticConfigByArc['arc-2']?.selectedMethods.length).toBe(MOCK_TOTAL))

    // Now spy on writes and switch BACK to arc-1 (has a saved cfg → restore, no write).
    const real = useSingleProductImpactStore.getState().setStaticConfigForArc
    const spy = vi.fn((arc: string, cfg: { scope: 'inflows'|'stock'|'outflows'|'all'; selectedMethods: string[][] }) => real(arc, cfg))
    useSingleProductImpactStore.setState({ setStaticConfigForArc: spy })
    await act(async () => { rerender(<SingleProductStaticPanel archetypeId="arc-1" />) })

    // Saved cfg preserved (not overwritten by a default-all), and no write fired
    // (the skip ref is armed because a cfg existed → the picker echo is swallowed).
    await waitFor(() => expect(useSingleProductImpactStore.getState().staticConfigByArc['arc-1']?.selectedMethods.length).toBe(1))
    expect(spy).not.toHaveBeenCalled()
  })
})
