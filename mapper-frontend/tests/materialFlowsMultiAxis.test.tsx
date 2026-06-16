import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDSMStore } from '../src/stores/dsmStore'
import * as client from '../src/api/client'
import type { MaterialFlowResult, SystemDefinition } from '../src/api/client'

// Patch 4M — multi-axis fan-out for Material Flows. Frontend tests
// cover:
//   - Store routes to the legacy single endpoint when both axes have
//     ≤1 selection (backward compat for the existing MFA flow).
//   - Store routes to the multi endpoint when DSM axis has N>1.
//   - Store routes to the multi endpoint when parameter axis has N>1.
//   - axisConflict throws client-side before any HTTP call when both
//     axes are multi-select (defence in depth — server enforces too).
//   - selectMaterialFlowScenario mirrors the picked scenario's result
//     into the legacy ``materialFlows`` slot so existing render code
//     reads from the right run.

const ACTIVE_SYSTEM: SystemDefinition = {
  id: 'sys-1',
  name: 'Test fleet',
  unit_name: 'vehicles',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dimensions: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  time_horizon: { start_year: 2020, end_year: 2050 } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const EMPTY_RESULT: MaterialFlowResult = {
  scope: 'stock',
  stages_included: ['Use Phase'],
  year_start: 2030,
  year_end: 2030,
  group_by: 'material',
  materials: [],
  elapsed_seconds: 0.01,
  unit_name: 'vehicles',
}

beforeEach(() => {
  vi.restoreAllMocks()
  // Reset store state between tests — leave activeSystem populated so
  // the action doesn't bail with "No active system".
  useDSMStore.setState({
    activeSystem: ACTIVE_SYSTEM,
    materialFlows: null,
    materialFlowsRuns: [],
    materialFlowAxis: null,
    activeMaterialFlowScenario: null,
    materialFlowLoading: false,
    error: null,
  })
})

describe('calcMaterialFlows — multi-axis routing (Patch 4M)', () => {
  it('routes to the single endpoint with no scenario fields when both axes are empty', async () => {
    const single = vi.spyOn(client, 'calculateMaterialFlows').mockResolvedValue(EMPTY_RESULT)
    const multi = vi.spyOn(client, 'calculateMaterialFlowsMulti').mockResolvedValue({
      axis: 'dsm', runs: [], elapsed_seconds: 0,
    })
    await useDSMStore.getState().calcMaterialFlows('stock', null, null, 'material')
    expect(single).toHaveBeenCalledTimes(1)
    expect(multi).not.toHaveBeenCalled()
    const call = single.mock.calls[0][1]
    expect(call.dsm_scenario_id).toBeNull()
    expect(call.parameter_scenario).toBeNull()
  })

  it('routes to the single endpoint when DSM axis has exactly one selection', async () => {
    const single = vi.spyOn(client, 'calculateMaterialFlows').mockResolvedValue(EMPTY_RESULT)
    const multi = vi.spyOn(client, 'calculateMaterialFlowsMulti').mockResolvedValue({
      axis: 'dsm', runs: [], elapsed_seconds: 0,
    })
    await useDSMStore.getState().calcMaterialFlows('stock', null, null, 'material', {
      dsmScenarioIds: ['scen-a'],
    })
    expect(single).toHaveBeenCalledTimes(1)
    expect(multi).not.toHaveBeenCalled()
    // The single id is threaded through the in-task field.
    expect(single.mock.calls[0][1].dsm_scenario_id).toBe('scen-a')
  })

  it('routes to the multi endpoint when DSM axis has N > 1', async () => {
    const single = vi.spyOn(client, 'calculateMaterialFlows').mockResolvedValue(EMPTY_RESULT)
    const multi = vi.spyOn(client, 'calculateMaterialFlowsMulti').mockResolvedValue({
      axis: 'dsm',
      runs: [
        { axis: 'dsm', scenario_id: 'a', scenario_label: 'A', result: EMPTY_RESULT },
        { axis: 'dsm', scenario_id: 'b', scenario_label: 'B', result: EMPTY_RESULT },
      ],
      elapsed_seconds: 0.05,
    })
    await useDSMStore.getState().calcMaterialFlows('stock', null, null, 'material', {
      dsmScenarioIds: ['a', 'b'],
    })
    expect(multi).toHaveBeenCalledTimes(1)
    expect(single).not.toHaveBeenCalled()
    expect(multi.mock.calls[0][1].dsm_scenario_ids).toEqual(['a', 'b'])
    // Parameter axis is null on the multi call (one axis only).
    expect(multi.mock.calls[0][1].parameter_scenarios).toBeNull()
    // Results land in the multi-axis slots; first run mirrored to
    // legacy ``materialFlows`` so existing render code keeps working.
    const state = useDSMStore.getState()
    expect(state.materialFlowsRuns).toHaveLength(2)
    expect(state.materialFlowAxis).toBe('dsm')
    expect(state.activeMaterialFlowScenario).toBe('a')
    expect(state.materialFlows).toBeTruthy()
  })

  it('routes to the multi endpoint when parameter axis has N > 1', async () => {
    const multi = vi.spyOn(client, 'calculateMaterialFlowsMulti').mockResolvedValue({
      axis: 'parameter',
      runs: [
        { axis: 'parameter', scenario_id: 'Optimistic', scenario_label: 'Optimistic', result: EMPTY_RESULT },
        { axis: 'parameter', scenario_id: 'Pessimistic', scenario_label: 'Pessimistic', result: EMPTY_RESULT },
      ],
      elapsed_seconds: 0.05,
    })
    await useDSMStore.getState().calcMaterialFlows('stock', null, null, 'material', {
      parameterScenarios: ['Optimistic', 'Pessimistic'],
    })
    expect(multi).toHaveBeenCalledTimes(1)
    expect(multi.mock.calls[0][1].parameter_scenarios).toEqual(['Optimistic', 'Pessimistic'])
    expect(multi.mock.calls[0][1].dsm_scenario_ids).toBeNull()
    expect(useDSMStore.getState().materialFlowAxis).toBe('parameter')
  })

  it('throws client-side when both axes are multi-select (axisConflict)', async () => {
    const single = vi.spyOn(client, 'calculateMaterialFlows').mockResolvedValue(EMPTY_RESULT)
    const multi = vi.spyOn(client, 'calculateMaterialFlowsMulti').mockResolvedValue({
      axis: 'dsm', runs: [], elapsed_seconds: 0,
    })
    await expect(
      useDSMStore.getState().calcMaterialFlows('stock', null, null, 'material', {
        dsmScenarioIds: ['a', 'b'],
        parameterScenarios: ['Optimistic', 'Pessimistic'],
      }),
    ).rejects.toThrow(/axes simultaneously/)
    // No HTTP calls fired — defence-in-depth before reaching the
    // server's 400 path.
    expect(single).not.toHaveBeenCalled()
    expect(multi).not.toHaveBeenCalled()
  })
})

describe('selectMaterialFlowScenario (Patch 4M)', () => {
  it('mirrors the selected scenario\'s result into the legacy slot', () => {
    const runA: MaterialFlowResult = { ...EMPTY_RESULT, scope: 'inflows', stages_included: ['Mfg'] }
    const runB: MaterialFlowResult = { ...EMPTY_RESULT, scope: 'outflows', stages_included: ['EoL'] }
    useDSMStore.setState({
      materialFlowsRuns: [
        { axis: 'dsm', scenario_id: 'a', scenario_label: 'A', result: runA },
        { axis: 'dsm', scenario_id: 'b', scenario_label: 'B', result: runB },
      ],
      materialFlowAxis: 'dsm',
      activeMaterialFlowScenario: 'a',
      materialFlows: runA,
    })
    useDSMStore.getState().selectMaterialFlowScenario('b')
    const state = useDSMStore.getState()
    expect(state.activeMaterialFlowScenario).toBe('b')
    // Existing rendering code reads ``state.materialFlows`` — must be
    // run B's payload now, not run A's.
    expect(state.materialFlows).toBe(runB)
  })

  it('leaves materialFlows unchanged when the id is unknown', () => {
    const runA: MaterialFlowResult = { ...EMPTY_RESULT }
    useDSMStore.setState({
      materialFlowsRuns: [
        { axis: 'dsm', scenario_id: 'a', scenario_label: 'A', result: runA },
      ],
      activeMaterialFlowScenario: 'a',
      materialFlows: runA,
    })
    useDSMStore.getState().selectMaterialFlowScenario('not-a-real-id')
    expect(useDSMStore.getState().materialFlows).toBe(runA)
  })
})
