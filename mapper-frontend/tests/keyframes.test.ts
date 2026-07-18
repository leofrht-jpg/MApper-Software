/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import type { Archetype, Parameter } from '../src/api/client'
import {
  findLeverReferenceMaterials, interpolateKeyframes, lrFactor,
  resolveParameterAtYear, sortRowsByYear, trajectorySeries, validateKeyframeRows,
} from '../src/utils/keyframes'

describe('interpolateKeyframes (mirrors backend)', () => {
  const kf = [{ year: 2025, value: 1.0 }, { year: 2035, value: 0.95 }, { year: 2050, value: 0.9 }]
  it('returns anchor values at boundary years', () => {
    expect(interpolateKeyframes(kf, 2025)).toBeCloseTo(1.0)
    expect(interpolateKeyframes(kf, 2035)).toBeCloseTo(0.95)
    expect(interpolateKeyframes(kf, 2050)).toBeCloseTo(0.9)
  })
  it('interpolates linearly between anchors', () => {
    expect(interpolateKeyframes(kf, 2030)).toBeCloseTo(0.975)
  })
  it('clamps outside the range (no extrapolation)', () => {
    expect(interpolateKeyframes(kf, 2000)).toBeCloseTo(1.0)
    expect(interpolateKeyframes(kf, 2100)).toBeCloseTo(0.9)
  })
  it('sorts unsorted input', () => {
    const unsorted = [{ year: 2050, value: 0.9 }, { year: 2025, value: 1.0 }]
    expect(interpolateKeyframes(unsorted, 2025)).toBeCloseTo(1.0)
  })
})

describe('resolveParameterAtYear', () => {
  it('scalar param is year-invariant', () => {
    const p: Parameter = { name: 'x', base_value: 250 }
    expect(resolveParameterAtYear(p, null, 2040)).toBe(250)
  })
  it('keyframe param resolves at year', () => {
    const p: Parameter = { name: 'p_bp', base_value: 1, keyframes: [{ year: 2025, value: 1 }, { year: 2050, value: 0.5 }] }
    expect(resolveParameterAtYear(p, null, 2050)).toBeCloseTo(0.5)
  })
  it('scalar scenario override wins flat over the trajectory', () => {
    const p: Parameter = {
      name: 'p_bp', base_value: 1,
      keyframes: [{ year: 2025, value: 1 }, { year: 2050, value: 0.5 }],
      scenario_overrides: { Opt: 0.7 },
    }
    expect(resolveParameterAtYear(p, 'Opt', 2050)).toBeCloseTo(0.7)
    expect(resolveParameterAtYear(p, 'Base', 2050)).toBeCloseTo(0.5)
  })
})

describe('trajectorySeries', () => {
  it('emits one point per year 2025–2050 (26 points)', () => {
    const s = trajectorySeries([{ year: 2025, value: 1 }, { year: 2050, value: 0 }])
    expect(s).toHaveLength(26)
    expect(s[0]).toEqual({ year: 2025, value: 1 })
    expect(s[25]).toEqual({ year: 2050, value: 0 })
  })
})

describe('lrFactor', () => {
  it('compounds (1+rate)^(year-base_year)', () => {
    expect(lrFactor(-0.02, 2025, 2030)).toBeCloseTo(0.98 ** 5)
    expect(lrFactor(-0.02, 2025, 2025)).toBeCloseTo(1.0)
  })
})

describe('validateKeyframeRows', () => {
  it('requires at least 2 rows', () => {
    const v = validateKeyframeRows([{ year: '2025', value: '1' }])
    expect(v.valid).toBe(false)
    expect(v.errors.some((e) => /2 keyframes/.test(e))).toBe(true)
  })
  it('flags a year outside 2025–2050', () => {
    const v = validateKeyframeRows([{ year: '2025', value: '1' }, { year: '2060', value: '0' }])
    expect(v.valid).toBe(false)
    expect(v.rowErrors[1]).toMatch(/2025–2050/)
  })
  it('flags a non-integer year', () => {
    const v = validateKeyframeRows([{ year: '2025', value: '1' }, { year: '2030.5', value: '0' }])
    expect(v.valid).toBe(false)
  })
  it('flags duplicate years', () => {
    const v = validateKeyframeRows([{ year: '2025', value: '1' }, { year: '2025', value: '0' }])
    expect(v.valid).toBe(false)
    expect(Object.values(v.rowErrors).some((e) => /Duplicate/.test(e))).toBe(true)
  })
  it('passes a valid set', () => {
    const v = validateKeyframeRows([{ year: '2025', value: '1' }, { year: '2050', value: '0.9' }])
    expect(v.valid).toBe(true)
  })
})

describe('sortRowsByYear', () => {
  it('sorts by numeric year, blanks last', () => {
    const rows = [{ year: '2050', value: 'a' }, { year: '', value: 'b' }, { year: '2025', value: 'c' }]
    const sorted = sortRowsByYear(rows)
    expect(sorted.map((r) => r.year)).toEqual(['2025', '2050', ''])
  })
})

describe('findLeverReferenceMaterials', () => {
  const arc = (bom: Archetype['bom']): Archetype => ({ name: 'BEV-LFP Small', bom })
  it('finds nodes tagged with the lever AND carrying a learning_rate', () => {
    const archetypes = [arc([
      {
        name: 'pack', node_type: 'component', quantity: 1, unit: 'unit', children: [
          {
            name: 'cells', node_type: 'material', quantity: 100, unit: 'kg',
            global_levers: ['p_bp'],
            evolution: { method: 'learning_rate', learning_rate: -0.03, base_year: 2025 },
          },
          {
            name: 'steel', node_type: 'material', quantity: 50, unit: 'kg',
          },
        ],
      },
    ])]
    const mats = findLeverReferenceMaterials(archetypes, 'p_bp')
    expect(mats).toHaveLength(1)
    expect(mats[0]).toEqual({ archetypeName: 'BEV-LFP Small', nodeName: 'cells', learningRate: -0.03, baseYear: 2025 })
  })
  it('ignores tagged nodes without a learning_rate evolution', () => {
    const mats = findLeverReferenceMaterials([arc([
      { name: 'cells', node_type: 'material', quantity: 1, unit: 'kg', global_levers: ['p_bp'] },
    ])], 'p_bp')
    expect(mats).toHaveLength(0)
  })
  it('ignores nodes not tagged with the lever', () => {
    const mats = findLeverReferenceMaterials([arc([
      { name: 'cells', node_type: 'material', quantity: 1, unit: 'kg', evolution: { method: 'learning_rate', learning_rate: -0.03, base_year: 2025 } },
    ])], 'p_bp')
    expect(mats).toHaveLength(0)
  })
})
