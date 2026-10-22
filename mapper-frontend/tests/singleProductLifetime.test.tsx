/* SPDX-License-Identifier: MPL-2.0 */
/**
 * EVS40 bug report, item 1: an export read "Lifetime (yr) 15" beside stage
 * amounts of 16. Two desyncs, both fixed here:
 *
 *  - the export read the LIVE editor entry, not what the run was computed
 *    with, so any edit after a run made the two disagree (the panels now
 *    freeze the meta at compute time);
 *  - a lifetime referenced from a parameter was fixed when it was picked, so
 *    editing that parameter (EVS40's `lifetime_yr = 16`) left the label showing
 *    16 while the stored lifetime and amounts stayed old (now re-derived).
 *
 * Plus the Prospective panel says when its year range and the lifetime differ
 * that they are independent inputs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { SingleProductStaticPanel } from '../src/components/impact/SingleProductStaticPanel'
import { SingleProductProjectedPanel } from '../src/components/impact/SingleProductProjectedPanel'
import { useBOMStore } from '../src/stores/bomStore'
import { useParameterStore } from '../src/stores/parameterStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useProjectSettingsStore } from '../src/stores/projectSettingsStore'
import { toStageAmountsMeta, useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { calculateArchetypeLCA } from '../src/api/client'

const FAM = 'EF v3.1'
const GWP = [FAM, 'climate change', 'GWP100']
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getMethods: vi.fn(async () => [{ family: FAM, categories: [{ category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: GWP }] }] }]),
    calculateArchetypeLCA: vi.fn(async () => ({
      archetype_id: 'ev9', archetype_name: 'EV9', scope: 'all', amount: 1,
      stage_amounts: { Manufacturing: 1, 'Use Phase': 16 }, stages_included: [], elapsed_seconds: 0, results: [],
    })),
  }
})

const ARC = {
  id: 'ev9', name: 'EV9', folder: null, material_count: 2, unlinked_count: 0,
  stages: ['Manufacturing', 'Use Phase'], stage_annual: {},
  stage_basis: { Manufacturing: 'per_unit', 'Use Phase': 'per_year' },
  stage_ids: {}, validation_error_rows: 0,
} as any

function paramTable(value: number) {
  return { parameters: { lifetime_yr: { name: 'lifetime_yr', base_value: value } }, scenarios: [] } as any
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.mocked(calculateArchetypeLCA).mockClear()
  useSingleProductImpactStore.getState().reset()
  useBOMStore.setState({ archetypes: [ARC] } as any)
  useProjectSettingsStore.setState({ settings: { use_phase_basis: 'one_year' } } as any)
  useParameterStore.setState({ table: paramTable(16), selectedScenarios: [] } as any)
})

describe('a parameter-sourced lifetime follows its parameter', () => {
  it('re-derives the stored lifetime and amounts when the parameter changes', async () => {
    useSingleProductImpactStore.getState().setStageAmountsForArc('ev9', {
      preset: 'custom', lifetime: 15, lifetimeParam: 'lifetime_yr',
      amounts: { Manufacturing: 1, 'Use Phase': 15 },
    })
    render(<SingleProductImpact />)
    await waitFor(() => {
      const e = useSingleProductImpactStore.getState().stageAmountsByArc.ev9
      expect(e.lifetime).toBe(16)
      expect(e.amounts).toEqual({ Manufacturing: 1, 'Use Phase': 16 })
    })
  })

  it('leaves a typed lifetime alone', async () => {
    useSingleProductImpactStore.getState().setStageAmountsForArc('ev9', {
      preset: 'custom', lifetime: 15, lifetimeParam: null,
      amounts: { Manufacturing: 1, 'Use Phase': 15 },
    })
    render(<SingleProductImpact />)
    await new Promise((r) => setTimeout(r, 20))
    expect(useSingleProductImpactStore.getState().stageAmountsByArc.ev9.lifetime).toBe(15)
  })
})

describe('the run freezes its own stage-amount meta', () => {
  it('Static: the meta is captured at Calculate and does not follow later edits', async () => {
    const entry = { preset: 'custom' as const, lifetime: 16, lifetimeParam: 'lifetime_yr', amounts: { Manufacturing: 1, 'Use Phase': 16 } }
    useSingleProductImpactStore.getState().setStageAmountsForArc('ev9', entry)
    useSingleProductImpactStore.getState().setStaticConfigForArc('ev9', { scope: 'all', selectedMethods: [GWP] })
    render(<SingleProductStaticPanel archetypeId="ev9" />)
    await act(async () => { fireEvent.click(await screen.findByTestId('single-product-static-calculate')) })
    await waitFor(() => expect(useSingleProductImpactStore.getState().staticRunMeta).toEqual(toStageAmountsMeta(entry)))
    useSingleProductImpactStore.getState().setStageAmountsForArc('ev9', { ...entry, lifetime: 15, amounts: { Manufacturing: 1, 'Use Phase': 15 } })
    expect(useSingleProductImpactStore.getState().staticRunMeta!.lifetime).toBe(16)
  })
})

describe('year range vs lifetime', () => {
  const DBS = [2025, 2030, 2035, 2040].map((y) => ({
    name: `db${y}`, base_db: 'ei', iam: 'remind', ssp: 'SSP2-Base', year: y, years: [y], mode: 'separate', created_at: 'x',
  }))
  beforeEach(() => { usePLCAStore.setState({ databases: DBS, fetchDatabases: async () => {} } as any) })

  function pickAll() {
    fireEvent.click(screen.getByTestId('single-product-projected-traj-all-ei|remind|SSP2-Base'))
  }

  it('says they are independent when the span and the lifetime differ', async () => {
    useSingleProductImpactStore.getState().setStageAmountsForArc('ev9', { preset: 'custom', lifetime: 15, amounts: { Manufacturing: 1, 'Use Phase': 15 } })
    render(<SingleProductProjectedPanel archetypeId="ev9" />)
    await act(async () => { pickAll() })
    const note = screen.getByTestId('single-product-projected-lifetime-vs-range').textContent!
    expect(note).toContain('2025–2040 covers 16 background years')
    expect(note).toContain('lifetime is 15 yr')
    expect(note).toMatch(/independent/)
  })

  it('stays quiet when they agree, and with no years entered', async () => {
    useSingleProductImpactStore.getState().setStageAmountsForArc('ev9', { preset: 'custom', lifetime: 16, amounts: { Manufacturing: 1, 'Use Phase': 16 } })
    const { unmount } = render(<SingleProductProjectedPanel archetypeId="ev9" />)
    await act(async () => { pickAll() })
    expect(screen.queryByTestId('single-product-projected-lifetime-vs-range')).toBeNull()
    unmount()
    useSingleProductImpactStore.getState().setStageAmountsForArc('ev9', { preset: '1year', lifetime: 15, amounts: { Manufacturing: 1, 'Use Phase': 1 } })
    render(<SingleProductProjectedPanel archetypeId="ev9" />)
    await act(async () => { pickAll() })
    expect(screen.queryByTestId('single-product-projected-lifetime-vs-range')).toBeNull()
  })
})
