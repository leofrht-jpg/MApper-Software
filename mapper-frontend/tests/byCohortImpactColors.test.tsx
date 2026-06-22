/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDSMSystemColors } from '../src/utils/dsmCohortColors'
import { colorFor } from '../src/utils/chartColors'
import { useProjectStore } from '../src/stores/projectStore'

// Patch 5AG — the system-level "By cohort" impact facets build their cohort-key
// → color map via the SHARED resolver (`useDSMSystemColors.colorForCohort`),
// matching the DSM charts + cohort mapping (two-layer base + override), NOT a
// generic/index palette. This mirrors how ProjectedImpactPanel now builds
// `cohortColorMap` ({ ck: dsmColors.colorForCohort(ck, i) }), which the facets
// consume as `cohortColorMap[ck]`.

const FUEL = { name: 'fuel_type', is_age: false, labels: ['BEV-LFP', 'PHEV', 'ICEV-Petrol'] }
const SIZE = { name: 'size', is_age: false, labels: ['Small', 'Large'] }
const SYSTEM: any = { id: 'sys', name: 'Fleet', dimensions: [FUEL, SIZE], time_horizon: { start_year: 2025, end_year: 2050 } }

const COHORTS = ['BEV-LFP|Small', 'BEV-LFP|Large', 'PHEV|Small']

// Mirror the panel's map-building so the test exercises exactly what the facets receive.
const buildByCohortMap = (colorForCohort: (ck: string, i?: number) => string, keys: string[]) => {
  const m: Record<string, string> = {}
  keys.forEach((ck, i) => { m[ck] = colorForCohort(ck, i) })
  return m
}

beforeEach(() => {
  try { localStorage.clear() } catch { /* jsdom */ }
  useProjectStore.setState({ currentProject: 'test-proj' } as any)
})

describe('By-cohort impact band colors resolve via useDSMSystemColors (Patch 5AG)', () => {
  it('bands inherit the shared dim-value color (stack-by fuel) — same cohort group → same color, matching DSM', () => {
    const { result } = renderHook(() => useDSMSystemColors(SYSTEM, 'fuel_type'))
    const { colorForCohort, colorMap } = result.current
    const map = buildByCohortMap(colorForCohort, COHORTS)
    // Two BEV-LFP cohorts share the fuel color (identity-keyed, not index).
    expect(map['BEV-LFP|Small']).toBe(map['BEV-LFP|Large'])
    expect(map['BEV-LFP|Small']).not.toBe(map['PHEV|Small'])
    // …and it's the SAME color the DSM stock-composition chart uses for that
    // fuel value (both go through colorFor(colorMap, 'BEV-LFP')).
    expect(map['BEV-LFP|Small']).toBe(colorFor(colorMap, 'BEV-LFP'))
    expect(map['PHEV|Small']).toBe(colorFor(colorMap, 'PHEV'))
  })

  it('a per-cohort row OVERRIDE flows through to the band (cohort-key stacking)', () => {
    const override = '#abcdef'
    const { result } = renderHook(() =>
      useDSMSystemColors(SYSTEM, null, { rowColorOverrides: { 'BEV-LFP|Small': override } }),
    )
    const map = buildByCohortMap(result.current.colorForCohort, COHORTS)
    expect(map['BEV-LFP|Small']).toBe(override)            // override wins
    expect(map['BEV-LFP|Large']).not.toBe(override)        // others unaffected
  })

  it('color stability: a cohort\'s resolved color is identity-keyed, not index-dependent', () => {
    const { result } = renderHook(() => useDSMSystemColors(SYSTEM, 'fuel_type'))
    const { colorForCohort } = result.current
    // Same cohort key resolves to the same color regardless of position/index
    // (the dim value resolves in colorMap → fallbackIndex unused).
    expect(colorForCohort('PHEV|Small', 0)).toBe(colorForCohort('PHEV|Small', 7))
    // Dropping a band from the input map doesn't recolor a survivor.
    const full = buildByCohortMap(colorForCohort, COHORTS)
    const fewer = buildByCohortMap(colorForCohort, ['BEV-LFP|Large', 'PHEV|Small'])
    expect(fewer['PHEV|Small']).toBe(full['PHEV|Small'])
  })

  it('the facets read cohortColorMap[ck] = the resolver color (no generic-palette fallback hit)', () => {
    const { result } = renderHook(() => useDSMSystemColors(SYSTEM, 'fuel_type'))
    const map = buildByCohortMap(result.current.colorForCohort, COHORTS)
    // Every cohort key has a resolved color (so FacetView's `?? CHART_PALETTE`
    // fallback is never reached for known cohorts).
    for (const ck of COHORTS) expect(typeof map[ck]).toBe('string')
  })
})
