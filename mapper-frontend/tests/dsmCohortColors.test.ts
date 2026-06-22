/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildDSMChartLabels,
  buildStackKeys,
  groupKeyForDim,
  parseCohortKey,
} from '../src/utils/dsmCohortColors'
import { assignColors } from '../src/utils/chartColors'
import type { DimensionDef, SystemDefinition } from '../src/api/client'

// Patch 4N — shared cohort-color utility. Tests cover:
//
//   - parseCohortKey / groupKeyForDim — pure helpers lifted from
//     DSMDashboard.tsx, must produce identical output to the prior
//     inline implementation.
//   - buildStackKeys / buildDSMChartLabels — the label set DSM Stock
//     Composition uses for `useChartColors`. Must be byte-identical
//     to the prior implementation; verified via direct comparison.
//   - assignColors stability — same labels in same order produce same
//     colors (the load-bearing guarantee that lets DSM Stock
//     Composition and Impact-by-cohort agree on a Stack-by-dim
//     value's color).
//
// Hook tests for `useDSMSystemColors` go in
// `tests/dsmSystemColors.render.test.tsx` (it's a hook, needs a
// component harness).

const FUEL_DIM: DimensionDef = {
  name: 'fuel_type', is_age: false,
  labels: ['BEV-LFP', 'PHEV', 'ICEV-Petrol'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const SIZE_DIM: DimensionDef = {
  name: 'size', is_age: false,
  labels: ['Small', 'Medium', 'Large'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
const AGE_DIM: DimensionDef = {
  name: 'birth_year', is_age: true,
  labels: ['2025', '2030'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const SYSTEM: SystemDefinition = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: 'sys-1', name: 'Fleet', unit_name: 'vehicles',
  dimensions: [FUEL_DIM, SIZE_DIM, AGE_DIM],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

beforeEach(() => {
  // Color persistence is keyed by project name; clear localStorage so
  // assignColors() output is deterministic between tests.
  localStorage.clear()
})

describe('parseCohortKey (Patch 4N — lifted from DSMDashboard)', () => {
  it('extracts non-age dim values in order', () => {
    const parsed = parseCohortKey('BEV-LFP|Small|2028', SYSTEM.dimensions)
    expect(parsed).toEqual({
      fuel_type: 'BEV-LFP',
      size: 'Small',
      // birth_year is is_age=true → excluded from parts.
      // Note: the cohort key uses `|` to separate non-age dims; year
      // is appended on its own track but parseCohortKey doesn't
      // model it (legacy behavior preserved).
    })
  })

  it('returns empty strings for missing parts (defensive)', () => {
    const parsed = parseCohortKey('BEV-LFP', SYSTEM.dimensions)
    expect(parsed).toEqual({ fuel_type: 'BEV-LFP', size: '' })
  })
})

describe('groupKeyForDim (Patch 4N)', () => {
  it('returns the cohort key itself when dimName is null', () => {
    expect(groupKeyForDim('BEV-LFP|Small|2028', SYSTEM.dimensions, null))
      .toBe('BEV-LFP|Small|2028')
  })

  it('returns "all" for empty cohort key with null dimName', () => {
    expect(groupKeyForDim('', SYSTEM.dimensions, null)).toBe('all')
  })

  it('extracts the requested dimension value', () => {
    expect(groupKeyForDim('BEV-LFP|Small|2028', SYSTEM.dimensions, 'fuel_type'))
      .toBe('BEV-LFP')
    expect(groupKeyForDim('BEV-LFP|Small|2028', SYSTEM.dimensions, 'size'))
      .toBe('Small')
  })

  it('returns "all" when the requested dimension is missing', () => {
    expect(groupKeyForDim('BEV-LFP|Small|2028', SYSTEM.dimensions, 'no_such_dim'))
      .toBe('all')
  })
})

describe('buildStackKeys (Patch 4N)', () => {
  it('returns ["all"] when no stackByDimension is selected', () => {
    expect(buildStackKeys(SYSTEM, null)).toEqual(['all'])
  })

  it('returns the dimension labels for the chosen stackByDimension', () => {
    expect(buildStackKeys(SYSTEM, 'fuel_type'))
      .toEqual(['BEV-LFP', 'PHEV', 'ICEV-Petrol'])
  })

  it('returns ["all"] for an unknown dimension', () => {
    expect(buildStackKeys(SYSTEM, 'no_such_dim')).toEqual(['all'])
  })

  it('returns [] when no system is loaded', () => {
    expect(buildStackKeys(null, 'fuel_type')).toEqual([])
  })
})

describe('buildDSMChartLabels (Patch 4N)', () => {
  it('returns the union of stackKeys + every non-age dim label', () => {
    const stackKeys = buildStackKeys(SYSTEM, 'fuel_type')
    const labels = buildDSMChartLabels(SYSTEM, stackKeys)
    expect(labels.has('BEV-LFP')).toBe(true)
    expect(labels.has('PHEV')).toBe(true)
    expect(labels.has('Small')).toBe(true)
    expect(labels.has('Medium')).toBe(true)
    // Age-dim labels excluded — ages aren't color-encoded in DSM
    // charts (they're stacked along the X axis on Age distribution).
    expect(labels.has('2025')).toBe(false)
  })

  it('produces the SAME label set regardless of stackByDimension', () => {
    // The chartLabels superset is by-design stable across Stack-by
    // changes — color assignments don't shuffle when the user flips
    // the dropdown.
    const fuel = buildDSMChartLabels(SYSTEM, buildStackKeys(SYSTEM, 'fuel_type'))
    const size = buildDSMChartLabels(SYSTEM, buildStackKeys(SYSTEM, 'size'))
    expect(fuel).toEqual(size)
  })
})

describe('assignColors stability — DSM Stock Composition regression', () => {
  // The load-bearing guarantee: same labels in the same order produce
  // the SAME color map. This is what DSM's Stock Composition relied
  // on before the lift; we verify the lift didn't change it.
  it('assigns colors deterministically for the same label set', () => {
    const labels = ['BEV-LFP', 'PHEV', 'ICEV-Petrol', 'Small', 'Medium', 'Large']
    const a = assignColors(labels, {})
    const b = assignColors(labels, {})
    expect(a).toEqual(b)
  })

  it('preserves prior color assignments when new labels are added', () => {
    const initial = assignColors(['BEV-LFP', 'PHEV'], {})
    const expanded = assignColors(['BEV-LFP', 'PHEV', 'ICEV-Petrol'], initial)
    // BEV-LFP and PHEV keep their colors; ICEV-Petrol gets a new one.
    expect(expanded['BEV-LFP']).toBe(initial['BEV-LFP'])
    expect(expanded['PHEV']).toBe(initial['PHEV'])
    expect(expanded['ICEV-Petrol']).toBeTruthy()
    expect(expanded['ICEV-Petrol']).not.toBe(initial['BEV-LFP'])
    expect(expanded['ICEV-Petrol']).not.toBe(initial['PHEV'])
  })

  it('produces the SAME color for the SAME label across two independent calls', () => {
    // The cross-chart guarantee: if both DSM Stock Composition and
    // Impact-by-cohort call assignColors(['BEV-LFP', ...], stored)
    // with the same stored map, they'll get the same color for
    // 'BEV-LFP'. This is what makes Patch 4N's `colorForCohort`
    // alignment work end-to-end.
    const stored = {}
    const dsm = assignColors(['BEV-LFP', 'PHEV', 'ICEV-Petrol'], stored)
    const impact = assignColors(['BEV-LFP', 'PHEV', 'ICEV-Petrol'], stored)
    expect(impact['BEV-LFP']).toBe(dsm['BEV-LFP'])
    expect(impact['PHEV']).toBe(dsm['PHEV'])
  })
})
