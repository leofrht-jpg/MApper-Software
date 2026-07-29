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
  buildCombinedRowColorOverrides,
  cohortDisplayLabel,
  subsystemMappingCounts,
} from '../src/utils/dsmCohortColors'

describe('buildCombinedRowColorOverrides', () => {
  it('emits primary colors under bare + system-prefixed keys, and subsystem colors prefixed', () => {
    const out = buildCombinedRowColorOverrides(
      'sys1',
      { 'BEV-LFP|Small': '#111111' },
      [{ id: 'sub1', cohort_mappings: { 'CNG Station|Default': { color: '#222222' } } }],
    )
    expect(out['BEV-LFP|Small']).toBe('#111111')
    expect(out['sys1::BEV-LFP|Small']).toBe('#111111')
    expect(out['sub1::CNG Station|Default']).toBe('#222222')
  })

  it('ignores subsystem cohorts without a color and empty primary colors', () => {
    const out = buildCombinedRowColorOverrides(
      'sys1',
      {},
      [{ id: 'sub1', cohort_mappings: { A: { color: null }, B: {} } }],
    )
    expect(Object.keys(out)).toHaveLength(0)
  })
})

describe('subsystemMappingCounts', () => {
  it('counts total cohort space and mapped entries across subsystems', () => {
    const subs = [{
      dimensions: [{ name: 'station', display_name: 'Station', labels: ['A', 'B', 'C'], is_age: false }],
      dependency_rules: [],
      // 2 of 3 cartesian cohorts mapped.
      cohort_mappings: { A: { archetype_id: 'x' }, B: { archetype_id: 'y' }, C: {} as { archetype_id?: string } },
    }]
    expect(subsystemMappingCounts(subs)).toEqual({ total: 3, mapped: 2 })
  })

  it('the task scenario: 24 cohorts, 18 mapped', () => {
    const cm: Record<string, { archetype_id?: string }> = {}
    // 24-cohort space: 4 × 6 labels; map 18 of them.
    const d1 = { name: 'a', display_name: 'A', labels: ['a1', 'a2', 'a3', 'a4'], is_age: false }
    const d2 = { name: 'b', display_name: 'B', labels: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], is_age: false }
    let n = 0
    for (const a of d1.labels) for (const b of d2.labels) {
      if (n < 18) cm[`${a}|${b}`] = { archetype_id: 'arc' }
      n++
    }
    const res = subsystemMappingCounts([{ dimensions: [d1, d2], dependency_rules: [], cohort_mappings: cm }])
    expect(res).toEqual({ total: 24, mapped: 18 })
  })

  it('sums across TWO dependent subsystems (24/18 + 10/5 → total 34, mapped 23)', () => {
    // With primary 51/51 this is the task\'s "74 of 85" (51+23 mapped / 51+34).
    const build = (nDims: [number, number], mapped: number) => {
      const [na, nb] = nDims
      const d1 = { name: 'a', display_name: 'A', labels: Array.from({ length: na }, (_, i) => `a${i}`), is_age: false }
      const d2 = { name: 'b', display_name: 'B', labels: Array.from({ length: nb }, (_, i) => `b${i}`), is_age: false }
      const cm: Record<string, { archetype_id?: string }> = {}
      let n = 0
      for (const a of d1.labels) for (const b of d2.labels) { if (n < mapped) cm[`${a}|${b}`] = { archetype_id: 'arc' }; n++ }
      return { type: 'dependent', dimensions: [d1, d2], dependency_rules: [], cohort_mappings: cm }
    }
    const sub24 = build([4, 6], 18) // 24 cohorts, 18 mapped
    const sub10 = build([2, 5], 5)  // 10 cohorts, 5 mapped
    expect(subsystemMappingCounts([sub24, sub10])).toEqual({ total: 34, mapped: 23 })
  })

  it('EXCLUDES the synthesized primary (type "primary") — the store list mixes it in', () => {
    // The store's `subsystems` includes a synthesized primary alongside
    // dependents; counting it here would double-count the primary's cohorts
    // (the "69 of 126" bug). Only dependents contribute.
    const primary = {
      type: 'primary',
      dimensions: [
        { name: 'fuel', display_name: 'F', labels: ['BEV', 'ICEV'], is_age: false },
        { name: 'size', display_name: 'S', labels: ['S', 'L'], is_age: false },
      ],
      dependency_rules: [],
      cohort_mappings: {},
    }
    const dependent = {
      type: 'dependent',
      dimensions: [{ name: 'station', display_name: 'St', labels: ['A', 'B', 'C'], is_age: false }],
      dependency_rules: [],
      cohort_mappings: { A: { archetype_id: 'x' }, B: { archetype_id: 'y' } },
    }
    // Only the dependent's 3 cohorts / 2 mapped — the primary's 4 are NOT added.
    expect(subsystemMappingCounts([primary, dependent])).toEqual({ total: 3, mapped: 2 })
  })
})

describe('cohortDisplayLabel — never shows the UUID', () => {
  const opts = {
    systemId: 'e5442abf-fa89-4804',
    primaryMappings: { 'BEV-LFP|SUV': { archetype_id: 'arc-bev' } } as Record<string, { archetype_id?: string }>,
    subsystems: [{ id: 'sub-charge', cohort_mappings: { 'CNG Station|Default': { archetype_id: 'arc-charge' } } }],
    archetypeName: (id: string) => ({ 'arc-bev': 'BEV-LFP SUV', 'arc-charge': 'Charging Infrastructure' } as Record<string, string>)[id],
  }

  it('strips the system-prefix UUID and shows cohort + archetype', () => {
    const d = cohortDisplayLabel('e5442abf-fa89-4804::BEV-LFP|SUV', opts)
    expect(d.label).toBe('BEV-LFP SUV')
    // archetype name equals the label here → collapsed to null (no redundancy).
    expect(d.archetype).toBeNull()
    expect(JSON.stringify(d)).not.toContain('e5442abf')
  })

  it('resolves a subsystem cohort to its BOM archetype name', () => {
    const d = cohortDisplayLabel('sub-charge::CNG Station|Default', opts)
    expect(d.label).toBe('CNG Station Default')
    expect(d.archetype).toBe('Charging Infrastructure')
    expect(JSON.stringify(d)).not.toContain('sub-charge')
  })

  it('unmapped / unknown-id key falls back to the cohort suffix, never the UUID', () => {
    const d = cohortDisplayLabel('some-unknown-uuid::PHEV|Small', opts)
    expect(d.label).toBe('PHEV Small')
    expect(d.archetype).toBeNull()
    expect(JSON.stringify(d)).not.toContain('some-unknown-uuid')
  })

  it('non-prefixed key is shown as-is (pipe→space)', () => {
    const d = cohortDisplayLabel('BEV-LFP|SUV', opts)
    expect(d.label).toBe('BEV-LFP SUV')
  })
})
