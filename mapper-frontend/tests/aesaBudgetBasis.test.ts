/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAESAStore } from '../src/stores/aesaStore'
import * as client from '../src/api/client'

// Phase 3 — CO₂ vs CO₂-eq budget-basis toggle.
//  - Fresh drafts default to the CO₂-eq basis.
//  - setBudgetBasis flips the draft's carbon_budget.budget_basis and, when a
//    result is on screen, re-runs the last compute against the new basis (so
//    the climate SR is re-derived). Only the climate SR responds (backend).

const DEFAULT_BUDGET = {
  initial_budget_gt: 1150, budget_source: 'IPCC AR6 2C/50', start_year: 2025, end_year: 2100,
  projected_emissions: { 2025: 40, 2030: 36 }, ssp_scenario: 'SSP2-4.5', provisional: true,
  budget_basis: 'CO2' as const,
  co2e_conversion: { kind: 'ratio' as const, factor: 1.4846, source: 'AR6 2C-analog' },
}
const DEFAULTS: any = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020', boundaries: [], computable: true }],
  multi_d_defaults: [], sharing_data: {}, ssp_trajectories: [], carbon_budget_options: [],
  default_multi_d: { layer1: {}, layer2_sector_share: 0.1, layer2_source: 'x' },
  default_carbon_budget: DEFAULT_BUDGET,
}
const PRESET: any = { id: 'ferhati_2026_multi_d', name: 'Multi-D', principles: [], category_assignments: [], chain: { layers: [] } }

beforeEach(() => {
  vi.restoreAllMocks()
  useAESAStore.setState({ defaults: null, draft: null, presets: [PRESET], result: null, lastComputeArgs: null, running: false } as any)
})

describe('Phase 3 — budget-basis default + toggle', () => {
  it('fresh draft defaults to the CO₂-eq basis', () => {
    // Cached-defaults + null-draft path rebuilds the draft via draftFromDefaults.
    useAESAStore.setState({ defaults: DEFAULTS, draft: null } as any)
    void useAESAStore.getState().loadDefaults()
    const cb = useAESAStore.getState().draft?.carbon_budget
    expect(cb?.budget_basis).toBe('CO2e_GHG')
    // The per-budget conversion factor is carried through (basis is selectable).
    expect(cb?.co2e_conversion?.factor).toBeCloseTo(1.4846, 4)
  })

  it('setBudgetBasis flips the draft basis (no result → no recompute)', () => {
    const spy = vi.spyOn(client, 'computeAESA')
    useAESAStore.setState({
      draft: { name: 'd', boundary_set_id: 'Sala2020_EF', sharing: PRESET, sharing_preset_id: PRESET.id,
               carbon_budget: { ...DEFAULT_BUDGET, budget_basis: 'CO2e_GHG' }, method_mapping: [], impact_mode: 'static', dsm_scenario_id: null },
      result: null,
    } as any)
    useAESAStore.getState().setBudgetBasis('CO2')
    expect(useAESAStore.getState().draft?.carbon_budget?.budget_basis).toBe('CO2')
    expect(spy).not.toHaveBeenCalled()   // no result on screen → nothing to re-derive
  })

  it('toggling with a result re-runs compute against the new basis (climate SR updates)', async () => {
    const computed: any = {
      results: [{ pb_id: 'climate_change', year: 2030, sr: 0.5 }], summary_by_year: [], missing_categories: [],
    }
    const spy = vi.spyOn(client, 'computeAESA').mockResolvedValue(computed)
    useAESAStore.setState({
      draft: { name: 'd', boundary_set_id: 'Sala2020_EF', sharing: PRESET, sharing_preset_id: PRESET.id,
               carbon_budget: { ...DEFAULT_BUDGET, budget_basis: 'CO2e_GHG' }, method_mapping: [], impact_mode: 'static', dsm_scenario_id: null },
      result: { results: [], summary_by_year: [], missing_categories: [] } as any,
      lastComputeArgs: { mfaSystemId: 'sys-1', impactInline: { task_id: 't', meta: {}, results: [] } as any, runSensitivity: false },
    } as any)

    useAESAStore.getState().setBudgetBasis('CO2')
    // basis patched synchronously; compute is async (void-dispatched).
    expect(useAESAStore.getState().draft?.carbon_budget?.budget_basis).toBe('CO2')
    await new Promise((r) => setTimeout(r, 0))

    expect(spy).toHaveBeenCalledTimes(1)
    // The re-run carried the NEW basis to the backend.
    expect(spy.mock.calls[0][0].config.carbon_budget?.budget_basis).toBe('CO2')
    // Result refreshed from the re-run.
    expect(useAESAStore.getState().result).toEqual(computed)
  })

  it('toggling to the same basis is a no-op (no recompute)', () => {
    const spy = vi.spyOn(client, 'computeAESA')
    useAESAStore.setState({
      draft: { name: 'd', boundary_set_id: 'Sala2020_EF', sharing: PRESET, sharing_preset_id: PRESET.id,
               carbon_budget: { ...DEFAULT_BUDGET, budget_basis: 'CO2e_GHG' }, method_mapping: [], impact_mode: 'static', dsm_scenario_id: null },
      result: { results: [], summary_by_year: [], missing_categories: [] } as any,
      lastComputeArgs: { mfaSystemId: 'sys-1' },
    } as any)
    useAESAStore.getState().setBudgetBasis('CO2e_GHG')   // already CO2e
    expect(spy).not.toHaveBeenCalled()
  })
})
