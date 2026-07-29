/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { buildExportFilename, sanitizeForFilename } from '../src/utils/exportFilename'

// The ONE export-filename scheme: {system}+{subs}_{DOMAIN}.xlsx. The backend
// `build_export_filename` (bom.py) is the byte-for-byte mirror; PARITY_FIXTURES
// below are duplicated verbatim in
// mapper-backend/tests/test_export_filename_parity.py so the two can't drift.

/** [system, subsystems, domain, maxBase|null, expected] — shared with backend. */
export const PARITY_FIXTURES: [string, string[], string, number | null, string][] = [
  ['Car Fleet', [], 'LCA', null, 'Car_Fleet_LCA.xlsx'],
  ['Car Fleet', [], 'pLCA', null, 'Car_Fleet_pLCA.xlsx'],
  ['Car Fleet', [], 'AESA', null, 'Car_Fleet_AESA.xlsx'],
  ['Car Fleet', [], 'DSM', null, 'Car_Fleet_DSM.xlsx'],
  ['Car Fleet', [], 'MFA', null, 'Car_Fleet_MFA.xlsx'],
  ['Car Fleet', ['Fueling Infrastructure'], 'LCA', null, 'Car_Fleet+Fueling_Infrastructure_LCA.xlsx'],
  ['Car Fleet', ['Fueling Infrastructure'], 'pLCA', null, 'Car_Fleet+Fueling_Infrastructure_pLCA.xlsx'],
  // AESA + contributing subsystem — the SR numerator sums primary + subsystem
  // impacts, so the AESA export now names the subsystem too (bugfix parity).
  ['Car Fleet', ['Fueling Infrastructure'], 'AESA', null, 'Car_Fleet+Fueling_Infrastructure_AESA.xlsx'],
  ['Car Fleet', ['A', 'B'], 'LCA', null, 'Car_Fleet+A+B_LCA.xlsx'],
  ['Car Fleet', ['', '  '], 'LCA', null, 'Car_Fleet_LCA.xlsx'],
  ['Car Fleet / v2', [], 'LCA', null, 'Car_Fleet_v2_LCA.xlsx'],
  ['Fleet', ['Sub/One:*'], 'LCA', null, 'Fleet+SubOne_LCA.xlsx'],
  ['', [], 'LCA', null, 'system_LCA.xlsx'],
  ['Primary', ['abcdefghij', 'klmnopqrst', 'uvwxyzabcd', 'efghijklmn', 'opqrstuvwx', 'yzabcdefgh', 'ijklmnopqr'], 'LCA', null,
    'Primary+7_subsystems_LCA.xlsx'],
  ['BEV-LFP SUV', [], 'LCA', null, 'BEV-LFP_SUV_LCA.xlsx'],
  ['BEV-LFP SUV comparison', [], 'LCA', null, 'BEV-LFP_SUV_comparison_LCA.xlsx'],
  ['Multi-item comparison', [], 'LCA', null, 'Multi-item_comparison_LCA.xlsx'],
]

describe('buildExportFilename — the one shared scheme', () => {
  it('each domain token produces the right suffix', () => {
    expect(buildExportFilename('Car Fleet', [], 'LCA')).toBe('Car_Fleet_LCA.xlsx')
    expect(buildExportFilename('Car Fleet', [], 'pLCA')).toBe('Car_Fleet_pLCA.xlsx')
    expect(buildExportFilename('Car Fleet', [], 'AESA')).toBe('Car_Fleet_AESA.xlsx')
    expect(buildExportFilename('Car Fleet', [], 'DSM')).toBe('Car_Fleet_DSM.xlsx')
    expect(buildExportFilename('Car Fleet', [], 'MFA')).toBe('Car_Fleet_MFA.xlsx')
  })

  it('no subsystems → {system}_{DOMAIN}.xlsx', () => {
    expect(buildExportFilename('Car Fleet', [], 'LCA')).toBe('Car_Fleet_LCA.xlsx')
  })

  it('one and two subsystems join with +', () => {
    expect(buildExportFilename('Car Fleet', ['Fueling Infrastructure'], 'pLCA'))
      .toBe('Car_Fleet+Fueling_Infrastructure_pLCA.xlsx')
    expect(buildExportFilename('Car Fleet', ['A', 'B'], 'LCA')).toBe('Car_Fleet+A+B_LCA.xlsx')
  })

  it('an empty / unnamed subsystem is excluded', () => {
    expect(buildExportFilename('Car Fleet', ['', '   ', 'Real'], 'LCA'))
      .toBe('Car_Fleet+Real_LCA.xlsx')
  })

  it('sanitises: "Car Fleet / v2" → Car_Fleet_v2', () => {
    expect(buildExportFilename('Car Fleet / v2', [], 'LCA')).toBe('Car_Fleet_v2_LCA.xlsx')
    expect(sanitizeForFilename('Car Fleet / v2')).toBe('Car_Fleet_v2')
  })

  it('truncates past 80 chars of the base → {system}+{N}_subsystems_{DOMAIN}.xlsx', () => {
    const subs = Array.from({ length: 7 }, (_, i) => `subsystem_number_${i}_with_a_long_name`)
    expect(buildExportFilename('Primary', subs, 'LCA')).toBe(`Primary+${subs.length}_subsystems_LCA.xlsx`)
  })

  it('no date / timestamp / UUID / scenario count anywhere', () => {
    const fn = buildExportFilename('Car Fleet', ['Fueling Infrastructure'], 'pLCA')
    expect(fn).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(fn).not.toMatch(/scenario|multi_lci|_202\d/i)
  })

  it('PARITY_FIXTURES all match (shared verbatim with the backend parity test)', () => {
    for (const [system, subs, domain, maxBase, expected] of PARITY_FIXTURES) {
      const got = maxBase == null
        ? buildExportFilename(system, subs, domain)
        : buildExportFilename(system, subs, domain, maxBase)
      expect(got, `${system} / ${JSON.stringify(subs)} / ${domain}`).toBe(expected)
    }
  })
})
