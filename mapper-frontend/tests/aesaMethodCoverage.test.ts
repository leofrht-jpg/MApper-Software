/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import {
  computeMethodCoverage, coverageSummary, isSubComponentOf,
} from '../src/utils/aesaMethodCoverage'

// The counter read "15 methods mapped · 10 unmapped", which reads as ten
// errors. Measured against a real EF v3.1 install and the Sala2020_EF set:
//
//   25 methods · 16 boundaries · auto-suggest maps 15 → 15 boundaries
//   9 of the 10 unmapped decompose an aggregate that IS mapped — correct
//   1  of the 10 is unrecognised, and it is the SAME fact as the 1 boundary
//      with no method: 'photochemical oxidant formation: human health'
//
// The old number could not distinguish those, and never showed the boundary
// gap at all — the shortfall that actually changes what AESA computes.
//
// Fixtures below are the real EF v3.1 indicator names.

const EF_METHODS = [
  'acidification',
  'climate change',
  'climate change: biogenic',
  'climate change: fossil',
  'climate change: land use and land use change',
  'ecotoxicity: freshwater',
  'ecotoxicity: freshwater, inorganics',
  'ecotoxicity: freshwater, organics',
  'energy resources: non-renewable',
  'eutrophication: freshwater',
  'eutrophication: marine',
  'eutrophication: terrestrial',
  'human toxicity: carcinogenic',
  'human toxicity: carcinogenic, inorganics',
  'human toxicity: carcinogenic, organics',
  'human toxicity: non-carcinogenic',
  'human toxicity: non-carcinogenic, inorganics',
  'human toxicity: non-carcinogenic, organics',
  'ionising radiation: human health',
  'land use',
  'material resources: metals/minerals',
  'ozone depletion',
  'particulate matter formation',
  'photochemical oxidant formation: human health',
  'water use',
].map((ind) => ({ method: ['EF v3.1', ind, 'x'] }))

/** What exact-match auto-suggest produces against Sala2020_EF. */
const MAPPED: Array<{ method_tuple: string[]; pb_id: string }> = [
  ['acidification', 'acidification'],
  ['climate change', 'climate_change'],
  ['ecotoxicity: freshwater', 'ecotoxicity_freshwater'],
  ['energy resources: non-renewable', 'resource_use_fossils'],
  ['eutrophication: freshwater', 'eutrophication_freshwater'],
  ['eutrophication: marine', 'eutrophication_marine'],
  ['eutrophication: terrestrial', 'eutrophication_terrestrial'],
  ['human toxicity: carcinogenic', 'human_toxicity_cancer'],
  ['human toxicity: non-carcinogenic', 'human_toxicity_non_cancer'],
  ['ionising radiation: human health', 'ionising_radiation'],
  ['land use', 'land_use'],
  ['material resources: metals/minerals', 'resource_use_minerals_metals'],
  ['ozone depletion', 'ozone_depletion'],
  ['particulate matter formation', 'particulate_matter'],
  ['water use', 'water_use'],
].map(([ind, pb]) => ({ method_tuple: ['EF v3.1', ind, 'x'], pb_id: pb }))

const SALA_16 = [
  'climate_change', 'acidification', 'ecotoxicity_freshwater',
  'resource_use_fossils', 'eutrophication_freshwater', 'eutrophication_marine',
  'eutrophication_terrestrial', 'human_toxicity_cancer',
  'human_toxicity_non_cancer', 'ionising_radiation', 'land_use',
  'resource_use_minerals_metals', 'ozone_depletion', 'particulate_matter',
  'photochemical_ozone_formation', 'water_use',
]

describe('the real EF v3.1 × Sala2020_EF picture', () => {
  const c = computeMethodCoverage(EF_METHODS, MAPPED, SALA_16)

  it('reports boundary coverage, which the old counter never showed', () => {
    expect(c.boundariesTotal).toBe(16)
    expect(c.boundariesCovered).toBe(15)
    expect(c.uncoveredBoundaryIds).toEqual(['photochemical_ozone_formation'])
  })

  it('still reports method counts', () => {
    expect(c.methodsTotal).toBe(25)
    expect(c.methodsMapped).toBe(15)
  })

  it('nine of the ten unmapped methods are expected sub-components', () => {
    expect(c.expectedUnmapped).toHaveLength(9)
    expect(c.expectedUnmapped.map((u) => u.indicator).sort()).toEqual([
      'climate change: biogenic',
      'climate change: fossil',
      'climate change: land use and land use change',
      'ecotoxicity: freshwater, inorganics',
      'ecotoxicity: freshwater, organics',
      'human toxicity: carcinogenic, inorganics',
      'human toxicity: carcinogenic, organics',
      'human toxicity: non-carcinogenic, inorganics',
      'human toxicity: non-carcinogenic, organics',
    ])
  })

  it('exactly one is unrecognised — and it is the uncovered boundary', () => {
    // Two views of ONE fact: the boundary set's ef_indicator
    // ('photochemical oxidant formation') does not match the installed
    // method's name ('…: human health'), so exact-match reaches neither.
    expect(c.unrecognised).toHaveLength(1)
    expect(c.unrecognised[0].indicator).toBe('photochemical oxidant formation: human health')
    expect(c.uncoveredBoundaryIds).toHaveLength(1)
  })

  it('every expected sub-component names the aggregate it decomposes', () => {
    for (const u of c.expectedUnmapped) {
      expect(u.parent, u.indicator).not.toBeNull()
      expect(u.indicator.startsWith(u.parent!)).toBe(true)
    }
  })

  it('summary leads with boundaries and surfaces the unrecognised count', () => {
    expect(coverageSummary(c)).toBe('15/16 boundaries · 15/25 methods · 1 unrecognised')
  })
})

describe('sub-component detection is structural, not a hand-written list', () => {
  it("recognises EF's two separators", () => {
    expect(isSubComponentOf('climate change: fossil', 'climate change')).toBe(true)
    expect(isSubComponentOf('ecotoxicity: freshwater, organics', 'ecotoxicity: freshwater')).toBe(true)
  })

  it('requires the separator — a bare prefix is not a sub-component', () => {
    // Without this, 'land use' would swallow 'land use change' and hide a real
    // gap behind an "expected" label.
    expect(isSubComponentOf('land use change', 'land use')).toBe(false)
    expect(isSubComponentOf('water use extra', 'water use')).toBe(false)
  })

  it('a method is not a sub-component of itself', () => {
    expect(isSubComponentOf('climate change', 'climate change')).toBe(false)
  })

  it('does not treat an unmapped aggregate as a sub-component', () => {
    // 'photochemical oxidant formation: human health' has no mapped parent, so
    // it must stay unrecognised rather than be excused as expected.
    const c = computeMethodCoverage(
      [{ method: ['EF v3.1', 'photochemical oxidant formation: human health', 'x'] }],
      [], ['photochemical_ozone_formation'],
    )
    expect(c.unrecognised).toHaveLength(1)
    expect(c.expectedUnmapped).toHaveLength(0)
  })
})

describe('edges', () => {
  it('full coverage omits the unrecognised clause', () => {
    const c = computeMethodCoverage(
      [{ method: ['EF v3.1', 'climate change', 'x'] }],
      [{ method_tuple: ['EF v3.1', 'climate change', 'x'], pb_id: 'climate_change' }],
      ['climate_change'],
    )
    expect(c.uncoveredBoundaryIds).toEqual([])
    expect(coverageSummary(c)).toBe('1/1 boundaries · 1/1 methods')
  })

  it('no methods at all falls back to a bare count', () => {
    const c = computeMethodCoverage([], [], SALA_16)
    expect(coverageSummary(c)).toBe('0 mapped')
    expect(c.boundariesCovered).toBe(0)
  })

  it('a mapping for a boundary outside the active set does not inflate coverage', () => {
    const c = computeMethodCoverage(
      [{ method: ['EF v3.1', 'climate change', 'x'] }],
      [{ method_tuple: ['EF v3.1', 'climate change', 'x'], pb_id: 'not_in_this_set' }],
      ['climate_change'],
    )
    expect(c.boundariesCovered).toBe(0)
    expect(c.uncoveredBoundaryIds).toEqual(['climate_change'])
  })
})
