/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, within } from '@testing-library/react'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'
import type {
  AESAConfiguration, AESADefaultsBundle, DSMSystemState,
  ImpactAssessmentResult, SharingPreset, SystemDefinition,
} from '../src/api/client'

// Patch 4AA — regression test for the cascade description desync.
//
// Before Patch 4AA: `dsmScenarioName` in ConfigSidebar.tsx derived
// from `activeView?.scenarioId ?? systemState.active_scenario_id`
// (DSM store's notion of "active"). The cascade Scenario dropdown
// writes to `draft.dsm_scenario_id` in useAESAStore and explicitly
// does NOT touch the DSM store's active flag (Patch 4O contract).
// So when the user picked SSP5 in the cascade, the description
// strings stayed pinned to whatever the DSM page's active scenario
// was — typically SSP1.
//
// Methodological scope check (done in the patch report): compute()
// always read from `draft.dsm_scenario_id`. So the bug was COSMETIC,
// not methodological — the dropdown drove compute correctly even
// when the description string was stale.
//
// Fix: derive `dsmScenarioName` from `draft.dsm_scenario_id` FIRST,
// falling back to `activeView`/`active_scenario_id` only when the
// draft hasn't pinned a scenario.

const SYSTEM: SystemDefinition = {
  id: 'sys-1', name: 'WP5', unit_name: 'vehicles',
  dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } as any,
} as any

const SYSTEM_STATE: DSMSystemState = {
  scenarios: [
    { id: 'base', name: 'Base', is_base: true } as any,
    { id: 'ssp1', name: 'SSP1', is_base: false } as any,
    { id: 'ssp5', name: 'SSP5', is_base: false } as any,
  ],
  // DSM page's notion of "active" — Patch 4O preserves this even
  // when the cascade scenario differs. Deliberately set to SSP1 so
  // the regression-vector scenario (cascade=SSP5, DSM active=SSP1)
  // is exercised.
  active_scenario_id: 'ssp1',
} as any

const SHARING: SharingPreset = {
  id: 'p1', name: 'Preset', description: '',
  principles: [], category_assignments: [],
  chain: { layers: [] } as any,
} as any

const DEFAULTS: AESADefaultsBundle = {
  boundary_sets: [{ id: 'Sala2020_EF', name: 'Sala 2020 EF', source: 'EF v3.1' } as any],
  default_multi_d: { tiers: [] } as any,
  default_carbon_budget: null as any,
} as any

const CFG: AESAConfiguration = {
  id: 'cfg-1', name: 'cfg', mfa_system_id: 'sys-1',
  impact_mode: 'projected', boundary_set_id: 'Sala2020_EF',
  sharing: SHARING, sharing_preset_id: SHARING.id,
  carbon_budget: null, method_mapping: [], created_at: '2026-05-11T10:00:00Z',
  dsm_scenario_id: 'ssp5',
} as any

// Two impact results, both representing the cascade-picked SSP5 view —
// what the live runs map should mirror once the cascade selector
// fires. The description strings READ from these results' meta.
const STATIC_RESULT: ImpactAssessmentResult = {
  meta: {
    base_db: 'ecoinvent-3.10-cutoff',
    parameter_set_id: 'Base',
    scenario: null,
  } as any,
  results: [],
} as any

const PROJECTED_RESULT: ImpactAssessmentResult = {
  meta: {
    base_db: 'ecoinvent-3.10-cutoff',
    parameter_set_id: 'Base',
    scenario: { iam: 'remind', ssp: 'SSP5-PkBudg1150' },
  } as any,
  results: [],
} as any

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([CFG])
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  useDSMStore.setState({
    systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never],
    activeSystem: SYSTEM, systemState: SYSTEM_STATE,
    activeView: { scenarioId: 'ssp1' } as any,  // DSM page pinned to SSP1
  } as any)
  useImpactStore.setState({
    staticResult: STATIC_RESULT, projectedResult: PROJECTED_RESULT,
    staticDsmScenarioRuns: {}, projectedDsmScenarioRuns: {},
  } as any)
  useAESAStore.setState({
    defaults: DEFAULTS, presets: [SHARING],
    configurations: [CFG], activeConfigId: CFG.id,
    creatingNewConfig: false,
    sessions: [], sessionsLoading: false, activeSessionId: null,
    // Draft pinned to SSP5 — the cascade-visible selection.
    draft: {
      name: 'cfg', boundary_set_id: 'Sala2020_EF', sharing: SHARING,
      sharing_preset_id: SHARING.id, carbon_budget: null,
      method_mapping: [], impact_mode: 'projected',
      dsm_scenario_id: 'ssp5',
    },
    result: null, lastRunAt: null,
    running: false, error: null, displayedIndicators: null,
  } as any)
})

describe('cascade Background description tracks draft.dsm_scenario_id (Patch 4AA)', () => {
  it('description reflects cascade scenario (SSP5), not DSM page active (SSP1)', () => {
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    const html = container.innerHTML
    // The Background-option descriptions are built from
    // describeStatic/describeProjected. With Patch 4AA, the "DSM
    // scenario:" suffix must show SSP5 (the cascade pick), NOT
    // SSP1 (DSM page's active).
    expect(html).toContain('DSM scenario: SSP5')
    expect(html).not.toContain('DSM scenario: SSP1')
  })

  it('updates the description when draft.dsm_scenario_id changes (re-derives reactively)', () => {
    const { container, rerender } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(container.innerHTML).toContain('DSM scenario: SSP5')
    // User picks SSP1 in the cascade — write through draft.
    useAESAStore.setState({
      draft: { ...useAESAStore.getState().draft!, dsm_scenario_id: 'ssp1' },
    } as any)
    rerender(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(container.innerHTML).toContain('DSM scenario: SSP1')
    expect(container.innerHTML).not.toContain('DSM scenario: SSP5')
  })

  it('falls back to activeView.scenarioId when draft.dsm_scenario_id is null', () => {
    // Backward-compat: pre-Patch-4O saved configs may carry
    // dsm_scenario_id=null ("use whatever's active"). The fallback
    // chain must still reach activeView/active_scenario_id.
    useAESAStore.setState({
      draft: { ...useAESAStore.getState().draft!, dsm_scenario_id: null },
    } as any)
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    // activeView is SSP1 → description should show SSP1.
    expect(container.innerHTML).toContain('DSM scenario: SSP1')
  })

  it('Prospective LCI database name renders from the impact result meta (independent of cascade)', () => {
    // The LCI name comes from projectedResult.meta.scenario, not
    // from draft. The selector-mirror flow (Patch 2E.2) keeps that
    // in sync separately. This assertion is the smoke check for
    // the description's two halves staying coherent — the LCI
    // half from result.meta, the DSM-scenario half from draft.
    const { container } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    expect(container.innerHTML).toContain('REMIND / SSP5-PkBudg1150')
  })
})

describe('cascade Compute uses draft.dsm_scenario_id (methodological correctness, Patch 4AA verification)', () => {
  it('compute() builds inline config with draft.dsm_scenario_id, not active_scenario_id', async () => {
    // This is the methodological-correctness assertion: even when
    // the description WAS stale (pre-Patch-4AA), Compute used the
    // right scenario. Test it explicitly so a future refactor
    // doesn't accidentally introduce the methodological version of
    // this bug.
    const spy = vi.spyOn(client, 'computeAESA').mockResolvedValue({
      config_id: 'x', results: [], summary_by_year: [], missing_categories: [],
    } as any)
    useAESAStore.setState({
      draft: { ...useAESAStore.getState().draft!, dsm_scenario_id: 'ssp5' },
    } as any)
    // Trigger compute through the store action directly (avoids
    // having to click through the sidebar UI).
    await useAESAStore.getState().compute({
      mfaSystemId: 'sys-1',
      impactInline: { meta: {}, results: [] } as any,
    })
    expect(spy).toHaveBeenCalledOnce()
    const body = spy.mock.calls[0][0] as any
    expect(body.config.dsm_scenario_id).toBe('ssp5')
    // And — crucial — not equal to the DSM page's active_scenario_id.
    expect(body.config.dsm_scenario_id).not.toBe('ssp1')
  })
})

// Suppress an unused-variable warning when removing the unused
// `within` import; vitest tolerates the unused import but cleaner
// to reference it.
void within
