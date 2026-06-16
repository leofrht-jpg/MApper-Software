/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { exportAESA } from '../src/api/client'
import type { AESAComputeResult, AESAConfiguration, SustainabilityRatioResult } from '../src/api/client'

// Patch 4T — exportAESA wire-format under the display filter.
//
// Contract:
//   - When `displayedIndicators` is null/undefined → POST the full
//     `result` unchanged (legacy behaviour, the explicit "Export all
//     computed indicators" override path).
//   - When `displayedIndicators.length < result.results.length` →
//     POST a filtered shape: `result.results`, `summary_by_year`,
//     and `sensitivity` all subset to the listed pb_ids.
//     `summary_by_year` is recomputed from the filtered set so zone
//     counts match what the user sees on screen.
//   - When the filter list equals the full set → still triggers
//     subset path? No — the call site collapses an
//     "all-explicitly-selected" filter back to null upstream, so
//     this case shouldn't occur in practice. We document the wire
//     contract here: equal-length list IS the no-op short-circuit
//     in `exportAESA` (see ".length < result.results.length"
//     condition); below we test the strict subset case.

const FULL_RESULTS: SustainabilityRatioResult[] = [
  ...['climate_change', 'biosphere_integrity', 'land_use_change'].flatMap(
    (pb_id) => [2030, 2040].map((year) => ({
      year, pb_id, pb_name: pb_id.replace(/_/g, ' '),
      ef_indicator: 'EF v3.1',
      impact: 1.0, allocated_sos: 1.0,
      sr: 0.7, zone: 'safe' as const,
      sharing_principle: null,
      layer_factors: [], total_sharing_factor: 0,
      sharing_factor_l1: 0, sharing_factor_l2: 1,
      boundary_type: 'cumulative' as const,
      confidence: 'high' as const,
      unit: '', impact_by_cohort: {}, method_label: '',
    } as SustainabilityRatioResult)),
  ),
]

const FULL_RESULT: AESAComputeResult = {
  config_id: 'cfg-test',
  results: FULL_RESULTS,
  summary_by_year: [
    { year: 2030, safe: 3, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 3 },
    { year: 2040, safe: 3, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 3 },
  ],
  missing_categories: [],
  sensitivity: {
    EpC: FULL_RESULTS,
    AR: FULL_RESULTS,
  } as any,
  compute_metrics: null,
}

const CFG: AESAConfiguration = {
  id: 'cfg-test',
  name: 'Test config',
  mfa_system_id: 'sys',
  impact_mode: 'static',
  boundary_set_id: 'Sala2020_EF',
  sharing: null as any,
  sharing_preset_id: null,
  carbon_budget: null,
  method_mapping: [],
  created_at: '2026-05-01',
}

describe('exportAESA filter wire format (Patch 4T)', () => {
  let fetchMock: any
  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x']),
    })
    ;(globalThis as any).fetch = fetchMock
    // jsdom shims for the click-to-download dance.
    ;(globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:fake')
    ;(globalThis as any).URL.revokeObjectURL = vi.fn()
  })

  it('null filter → posts full result unchanged', async () => {
    await exportAESA(CFG, FULL_RESULT, 'all.xlsx', null)
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.result.results).toHaveLength(FULL_RESULTS.length)  // unchanged
    expect(body.result.summary_by_year[0].total_assessed).toBe(3)
    expect(Object.keys(body.result.sensitivity)).toEqual(['EpC', 'AR'])
  })

  it('strict subset → posts filtered results + recomputed summary + filtered sensitivity', async () => {
    await exportAESA(CFG, FULL_RESULT, 'subset.xlsx', ['climate_change'])
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    // Only climate_change rows survive — 2 years × 1 indicator = 2 rows.
    expect(body.result.results).toHaveLength(2)
    expect(body.result.results.every((r: any) => r.pb_id === 'climate_change')).toBe(true)
    // summary_by_year recomputed: 1 indicator per year, all safe.
    expect(body.result.summary_by_year).toHaveLength(2)
    expect(body.result.summary_by_year[0].total_assessed).toBe(1)
    expect(body.result.summary_by_year[0].safe).toBe(1)
    // sensitivity arrays subset to the same id set.
    expect(body.result.sensitivity.EpC).toHaveLength(2)
    expect(body.result.sensitivity.EpC.every((r: any) => r.pb_id === 'climate_change')).toBe(true)
  })

  it('equal-length filter (no-op) → posts full result unchanged', async () => {
    // The "<" guard inside exportAESA short-circuits when the
    // filter list isn't strictly smaller than the result. The UI
    // upstream would normally collapse an "all-selected" filter to
    // `null`, but the wire contract still tolerates it.
    const allIds = ['climate_change', 'biosphere_integrity', 'land_use_change']
    await exportAESA(CFG, FULL_RESULT, 'all-explicit.xlsx', allIds)
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.result.results).toHaveLength(FULL_RESULTS.length)
  })
})
