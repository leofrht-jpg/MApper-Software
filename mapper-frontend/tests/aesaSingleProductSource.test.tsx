/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react'
import {
  ConfigSidebar,
  canComputeAESA,
  buildAESAComputeArgs,
} from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import * as client from '../src/api/client'

// Part C1 — single-LCA AESA source. The compute path is source-agnostic:
// fleet (DSM) is the default; single-product sends single_product_result +
// reference_year with the gate relaxed when a static single-product result
// is present (no DSM system required).

const SP_RESULT: any = {
  archetype_id: 'arc-1', archetype_name: 'Wind turbine 3MW', scope: 'all',
  amount: 1, stage_amounts: {}, stages_included: ['manufacturing'],
  results: [{ method: ['EF v3.1', 'climate change', 'ind'], method_label: 'climate change', score: 12, unit: 'kg', contributions: [] }],
  elapsed_seconds: 1, compute_database: 'ei-3.10',
}

describe('Part C1 — pure gate predicate (canComputeAESA)', () => {
  it('single-product: enabled with a static result, NO active system required', () => {
    expect(canComputeAESA({
      source: 'single_product', hasDraft: true, running: false,
      hasActiveSystem: false, hasImpact: false, hasSingleProduct: true,
    })).toBe(true)
  })
  it('single-product: disabled without a static result', () => {
    expect(canComputeAESA({
      source: 'single_product', hasDraft: true, running: false,
      hasActiveSystem: false, hasImpact: false, hasSingleProduct: false,
    })).toBe(false)
  })
  it('fleet gate unchanged: needs active system + impact', () => {
    expect(canComputeAESA({
      source: 'fleet', hasDraft: true, running: false,
      hasActiveSystem: true, hasImpact: true, hasSingleProduct: false,
    })).toBe(true)
    expect(canComputeAESA({
      source: 'fleet', hasDraft: true, running: false,
      hasActiveSystem: false, hasImpact: true, hasSingleProduct: true,
    })).toBe(false)
  })
  it('no draft / running always disables', () => {
    expect(canComputeAESA({ source: 'single_product', hasDraft: false, running: false, hasActiveSystem: false, hasImpact: false, hasSingleProduct: true })).toBe(false)
    expect(canComputeAESA({ source: 'single_product', hasDraft: true, running: true, hasActiveSystem: false, hasImpact: false, hasSingleProduct: true })).toBe(false)
  })
})

describe('Part C1 — pure payload builder (buildAESAComputeArgs)', () => {
  it('single-product: includes single_product_result + reference_year, empty mfaSystemId', () => {
    const args = buildAESAComputeArgs({
      source: 'single_product', activeSystemId: null, activeImpact: null,
      isMirror: false, isMultiLci: false,
      singleProductResult: SP_RESULT, referenceYear: 2025, runSensitivity: false,
    })
    expect(args).not.toBeNull()
    expect(args!.singleProductResult).toBe(SP_RESULT)
    expect(args!.referenceYear).toBe(2025)
    expect(args!.mfaSystemId).toBe('')
    expect(args!.impactTaskId).toBeUndefined()
  })
  it('single-product: returns null when no static result', () => {
    expect(buildAESAComputeArgs({
      source: 'single_product', activeSystemId: null, activeImpact: null,
      isMirror: false, isMultiLci: false,
      singleProductResult: null, referenceYear: 2025, runSensitivity: false,
    })).toBeNull()
  })
  it('fleet: unchanged — task id path, no single_product fields', () => {
    const impact: any = { task_id: 'task-9', results: [], meta: {} }
    const args = buildAESAComputeArgs({
      source: 'fleet', activeSystemId: 'sys-1', activeImpact: impact,
      isMirror: false, isMultiLci: false,
      singleProductResult: null, referenceYear: 2025, runSensitivity: true,
    })
    expect(args).toEqual({ mfaSystemId: 'sys-1', impactTaskId: 'task-9', impactInline: null, runSensitivity: true })
  })
  it('fleet: mirror/multi-LCI passes the result inline', () => {
    const impact: any = { task_id: 'dsm-mirror-1', results: [], meta: {} }
    const args = buildAESAComputeArgs({
      source: 'fleet', activeSystemId: 'sys-1', activeImpact: impact,
      isMirror: true, isMultiLci: false,
      singleProductResult: null, referenceYear: 2025, runSensitivity: false,
    })
    expect(args!.impactTaskId).toBeNull()
    expect(args!.impactInline).toBe(impact)
  })
})

// ── Render: toggle + visibility-toggle + relaxed gate ─────────────────────────

const SHARING: any = { id: 'preset-1', name: 'Ferhati 2026 Multi-D', built_in: true, principles: [], category_assignments: [], chain: { layers: [] } }
const DEFAULT_CB: any = {
  initial_budget_gt: 1150, budget_source: 'IPCC AR6', start_year: 2025, end_year: 2100,
  ssp_scenario: 'SSP1-2.6', projected_emissions: { 2025: 40, 2050: 10 },
  co2e_conversion: { kind: 'ratio', factor: 1.4846, source: 'x' }, provisional: true,
}
const DEFAULTS: any = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' }],
  multi_d_defaults: [], sharing_data: {},
  ssp_trajectories: [{ id: 'SSP1-2.6', name: 'SSP1-2.6', projected_emissions: DEFAULT_CB.projected_emissions }],
  carbon_budget_options: [{ id: 'IPCC_AR6_2C_50', name: '2C/50', remaining_gt_from_2025: 1150, source: 'IPCC AR6', co2e_conversion: DEFAULT_CB.co2e_conversion }],
  default_multi_d: { tiers: [] }, default_carbon_budget: DEFAULT_CB,
}

const display = (el: HTMLElement | null) => el && getComputedStyle(el).display

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.restoreAllMocks()
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  // Return a NON-EMPTY mapping: the auto-suggest effect re-fires until
  // method_mapping is non-empty (a [] mock would loop — new draft ref each pass).
  vi.spyOn(client, 'suggestAESAMethodMapping').mockResolvedValue(
    [{ method_tuple: ['EF v3.1', 'climate change', 'ind'], pb_id: 'climate_change' }] as any,
  )
  // No active DSM system — single-product must not need one.
  useDSMStore.setState({ systems: [], activeSystem: null, systemState: null } as any)
  useImpactStore.setState({ staticResult: null, projectedResult: null })
  useSingleProductImpactStore.setState({ staticResult: null } as any)
  useAESAStore.setState({
    defaults: DEFAULTS, defaultsLoading: false, presets: [SHARING], draft: null,
    configurations: [], activeConfigId: null, creatingNewConfig: true,
    activeSessionId: null, configLoadError: null, error: null, result: null, lastComputeArgs: null,
    source: 'fleet', referenceYear: 2025,
  } as any)
})

afterEach(cleanup)

describe('Part C1 — source toggle + visibility-toggle', () => {
  it('defaults to Fleet; fleet controls shown, single controls hidden (both mounted)', async () => {
    const { queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-source-toggle')).not.toBeNull())
    expect(queryByTestId('aesa-source-fleet')?.getAttribute('aria-checked')).toBe('true')
    expect(queryByTestId('aesa-source-single')?.getAttribute('aria-checked')).toBe('false')
    // Both mode blocks mounted; fleet visible, single hidden.
    expect(display(queryByTestId('aesa-source-fleet-controls'))).toBe('flex')
    expect(display(queryByTestId('aesa-source-single-controls'))).toBe('none')
  })

  it('switching to Single product reveals picker + reference-year, hides fleet (bodies stay mounted)', async () => {
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-source-single')).not.toBeNull())
    fireEvent.click(getByTestId('aesa-source-single'))
    expect(useAESAStore.getState().source).toBe('single_product')
    // Visibility flips; both blocks remain in the DOM.
    expect(display(queryByTestId('aesa-source-single-controls'))).toBe('flex')
    expect(display(queryByTestId('aesa-source-fleet-controls'))).toBe('none')
    expect(queryByTestId('aesa-source-fleet-controls')).not.toBeNull() // mounted
    expect(queryByTestId('aesa-reference-year')).not.toBeNull()
    // No static result yet → empty-state hint, not the picker.
    expect(queryByTestId('aesa-single-product-empty')).not.toBeNull()
  })
})

describe('Part C1 — relaxed gate (render)', () => {
  it('single-product with a static result: Compute enabled without activeSystem', async () => {
    useSingleProductImpactStore.setState({ staticResult: SP_RESULT } as any)
    useAESAStore.setState({ source: 'single_product' } as any)
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-single-product-picker')).not.toBeNull())
    expect(getByTestId('aesa-sidebar-compute').hasAttribute('disabled')).toBe(false)
    // The picker shows the archetype identity.
    expect(getByTestId('aesa-single-product-picker').textContent).toMatch(/Wind turbine 3MW/)
  })

  it('single-product without a static result: Compute disabled', async () => {
    useAESAStore.setState({ source: 'single_product' } as any)
    const { getByTestId, queryByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId('aesa-source-toggle')).not.toBeNull())
    expect(getByTestId('aesa-sidebar-compute').hasAttribute('disabled')).toBe(true)
  })
})
