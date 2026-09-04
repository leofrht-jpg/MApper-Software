// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

// TEMPLATE_PARITY_FIXTURES is duplicated VERBATIM from
// mapper-backend/tests/test_template_filename_parity.py — same inputs, same
// expected strings. The backend sets Content-Disposition and the frontend sets
// `a.download`; whichever wins, the user must see one name.
//
// Same discipline as exportFilename.test.ts, for the same reason.

import { describe, expect, it } from 'vitest'
import { buildTemplateFilename, sanitizeFilenamePart } from '../src/utils/exportFilename'

// [entity, artifact, suffix, template, expected]
const TEMPLATE_PARITY_FIXTURES: [string, string, string, boolean, string][] = [
  ['Car Fleet', 'cohort_mappings', 'xlsx', true, 'Car_Fleet_cohort_mappings_template.xlsx'],
  ['Fueling Infrastructure', 'cohort_mappings', 'xlsx', true,
    'Fueling_Infrastructure_cohort_mappings_template.xlsx'],
  ['Fueling Infrastructure', 'dependency_rules', 'xlsx', true,
    'Fueling_Infrastructure_dependency_rules_template.xlsx'],
  ['Fueling Infrastructure', 'initial_stock', 'xlsx', true,
    'Fueling_Infrastructure_initial_stock_template.xlsx'],
  ['Car Fleet', 'stock', 'xlsx', true, 'Car_Fleet_stock_template.xlsx'],
  ['Car Fleet', 'outflows', 'xlsx', true, 'Car_Fleet_outflows_template.xlsx'],
  ['Fueling Infrastructure', 'manual_inflows', 'csv', true,
    'Fueling_Infrastructure_manual_inflows_template.csv'],
  // PARENTHESES ARE KEPT — `Fleet (EU)` must not collide with `Fleet EU`.
  ['Fleet (EU)', 'stock', 'xlsx', true, 'Fleet_(EU)_stock_template.xlsx'],
  ['WP5 - DK (2025-50)', 'dependency_rules', 'xlsx', true,
    'WP5_-_DK_(2025-50)_dependency_rules_template.xlsx'],
  // THE TRAILING-UNDERSCORE CASE — the one real behavioural change.
  ['Car Fleet (EU) ', 'stock', 'xlsx', true, 'Car_Fleet_(EU)_stock_template.xlsx'],
  ['  Fleet  ', 'initial_stock', 'xlsx', true, 'Fleet_initial_stock_template.xlsx'],
  ['Car Fleet', 'cohort_mappings', 'xlsx', false, 'Car_Fleet_cohort_mappings.xlsx'],
  ['', 'stock', 'xlsx', true, 'entity_stock_template.xlsx'],
]

describe('buildTemplateFilename — parity with the backend', () => {
  it.each(TEMPLATE_PARITY_FIXTURES)(
    '%s + %s -> %s',
    (entity, artifact, suffix, template, expected) => {
      expect(buildTemplateFilename(entity, artifact, { suffix, template })).toBe(expected)
    },
  )

  it('keeps parentheses so two systems cannot collide', () => {
    expect(sanitizeFilenamePart('Fleet (EU)')).not.toBe(sanitizeFilenamePart('Fleet EU'))
  })

  it('leaves no trailing underscore', () => {
    // The `parameters` variant never stripped; this is the row that catches it.
    expect(sanitizeFilenamePart('Car Fleet (EU) ')).toBe('Car_Fleet_(EU)')
  })

  it('gives a system and a subsystem the same shape for one artifact', () => {
    const sys = buildTemplateFilename('Car Fleet', 'cohort_mappings')
    const sub = buildTemplateFilename('Fueling Infrastructure', 'cohort_mappings')
    expect(sys.slice(sanitizeFilenamePart('Car Fleet').length))
      .toBe(sub.slice(sanitizeFilenamePart('Fueling Infrastructure').length))
  })
})
