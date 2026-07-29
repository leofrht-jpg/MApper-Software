/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { buildImpactExportFilename, sanitizeForFilename } from '../src/utils/exportFilename'

describe('sanitizeForFilename', () => {
  it('strips filename-invalid chars and collapses spaces', () => {
    expect(sanitizeForFilename('Car Fleet')).toBe('Car_Fleet')
    expect(sanitizeForFilename('Car/Fleet:*?"<>|')).toBe('CarFleet')
    expect(sanitizeForFilename('  trim  me  ')).toBe('trim_me')
  })
})

describe('buildImpactExportFilename', () => {
  it('zero subsystems → unchanged original pattern', () => {
    expect(buildImpactExportFilename('Car Fleet', [], 'all')).toBe('Car_Fleet_impact_all.xlsx')
  })

  it('one subsystem appended with no UUID', () => {
    expect(buildImpactExportFilename('Car Fleet', ['Fueling Infrastructure'], 'all'))
      .toBe('Car_Fleet+Fueling_Infrastructure_impact_all.xlsx')
  })

  it('two subsystems joined with +', () => {
    expect(buildImpactExportFilename('Car Fleet', ['A', 'B'], 'all')).toBe('Car_Fleet+A+B_impact_all.xlsx')
  })

  it('sanitises subsystem names too', () => {
    const fn = buildImpactExportFilename('Car Fleet', ['Sub/One:*'], 'all')
    for (const bad of '/\\:*?"<>|') expect(fn).not.toContain(bad)
    expect(fn).toBe('Car_Fleet+SubOne_impact_all.xlsx')
  })

  it('truncates to N_subsystems when the base exceeds 100 chars', () => {
    const subs = Array.from({ length: 6 }, (_, i) => `Very_Long_Subsystem_Name_Number_${i}`)
    const fn = buildImpactExportFilename('Primary', subs, 'all')
    expect(fn).toBe('Primary+6_subsystems_impact_all.xlsx')
    expect(fn.replace('.xlsx', '').length).toBeLessThanOrEqual(100)
  })

  it('scope flows through (e.g. inflows)', () => {
    expect(buildImpactExportFilename('Fleet', [], 'inflows')).toBe('Fleet_impact_inflows.xlsx')
  })
})
