/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Boundary naming has ONE source: the `PlanetaryBoundary` record in
// boundary_sets.json, served through /aesa/defaults and stamped onto each SR
// row by the engine. No component may carry its own category-name → short-form
// table.
//
// This is the same guard shape as tests/cohortColorSingleResolver.test.ts and
// tests/carbonBudgetSingleImplementation.test.ts, and for the same reason: the
// failures this codebase keeps repeating are second copies of a rule, not
// wrong rules. `shortPbName` was one such copy — a hand-written truncation
// living in zones.ts, invisible to anyone changing the data file.
//
// The conventional acronyms (AP, HTP-c, ODP…) are the sharper risk. They are
// CML/ILCD convention, not EF: Zampori & Pant (2019), EUR 29682 EN, Table 2
// gives category names, indicators and units, and defines no per-category
// acronyms. MApper therefore never labels with them — a label would assert a
// naming EF does not define. They exist only as `conventional_acronym` on the
// boundary record, shown in the glossary as "commonly written". A literal in a
// component would be both a second copy AND a claim we have decided not to
// make.

const SRC = resolve(process.cwd(), 'src')

/** Every acronym the shipped data carries, read from the data file so a new
 *  one is covered the moment it is added. */
const ACRONYMS: string[] = (() => {
  const json = JSON.parse(readFileSync(
    resolve(process.cwd(), '../mapper-backend/mapper/data/aesa/boundary_sets.json'),
    'utf-8',
  ))
  const out = new Set<string>()
  for (const set of json.sets) {
    const bs = set.boundaries
    for (const b of (Array.isArray(bs) ? bs : Object.values(bs)) as Array<{ conventional_acronym?: string }>) {
      if (b.conventional_acronym) out.add(b.conventional_acronym)
    }
  }
  return [...out]
})()

/**
 * Files permitted to contain one of those strings as a literal.
 *
 * An entry is a claim that the string is NOT an impact-category abbreviation
 * in that file. Say what it is instead — that sentence is the check.
 */
const ACRONYM_LITERAL_ALLOWED: Record<string, string> = {
  'components/impact/MethodLibrary.tsx':
    'Placeholder text for a custom Brightway2 LCIA method NAME TUPLE '
    + '("MyLab, Climate change, GWP100"). It illustrates the shape of a bw2 '
    + 'method key the user types, not an AESA boundary label.',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** Strip comments so prose explaining the rule isn't read as breaking it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const files = walk(SRC)

describe('boundary naming has one source', () => {
  it('reads the acronyms from the shipped data (not an empty sweep)', () => {
    expect(ACRONYMS.length).toBeGreaterThanOrEqual(16)
    expect(ACRONYMS).toContain('AP')
    expect(ACRONYMS).toContain('HTP-nc')
    expect(files.length).toBeGreaterThan(50)
  })

  it('no component hardcodes a category acronym', () => {
    const offenders: string[] = []
    for (const f of files) {
      const rel = relative(SRC, f)
      if (rel in ACRONYM_LITERAL_ALLOWED) continue
      const src = stripComments(readFileSync(f, 'utf-8'))
      for (const a of ACRONYMS) {
        // Only quoted string literals — a bare `AP` could be an identifier.
        if (new RegExp(`(['"\`])${a.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\1`).test(src)) {
          offenders.push(`${rel} contains "${a}"`)
        }
      }
    }
    expect(offenders, 'hardcode an impact-category acronym. Acronyms belong to '
      + 'the boundary record (conventional_acronym), reach the frontend via '
      + '/aesa/defaults, and are shown ONLY in the glossary as "commonly '
      + 'written" — never as a chart label.')
      .toEqual([])
  })

  it('no component hardcodes a category-name → short-form map', () => {
    // The `shortPbName` shape: a literal object keyed by category names. Match
    // any object literal that maps a known category name to a string.
    const names = ['Climate change', 'Acidification', 'Ozone depletion',
      'Particulate matter', 'Land use', 'Water use']
    const offenders: string[] = []
    for (const f of files) {
      const rel = relative(SRC, f)
      const src = stripComments(readFileSync(f, 'utf-8'))
      for (const n of names) {
        if (new RegExp(`(['"\`])${n}\\1\\s*:`).test(src)) offenders.push(`${rel} keys a map on "${n}"`)
      }
    }
    expect(offenders, 'build a lookup keyed on impact-category names. Read the '
      + 'name off the boundary record instead.').toEqual([])
  })

  it('shortPbName is gone and has not come back', () => {
    const offenders = files
      .filter((f) => /\bshortPbName\b/.test(stripComments(readFileSync(f, 'utf-8'))))
      .map((f) => relative(SRC, f))
    expect(offenders, 'still reference shortPbName. It truncated mid-word; use '
      + 'boundaryLabel from utils/aesaBoundaryLabels instead.').toEqual([])
  })

  it('every named exception still exists and still contains what it claims', () => {
    // A stale exception silently permits a file that has since changed shape.
    for (const [rel, reason] of Object.entries(ACRONYM_LITERAL_ALLOWED)) {
      let src: string
      try {
        src = readFileSync(join(SRC, rel), 'utf-8')
      } catch {
        throw new Error(`ACRONYM_LITERAL_ALLOWED lists ${rel}, which no longer exists — remove it`)
      }
      const stillMatches = ACRONYMS.some((a) =>
        new RegExp(`(['"\`])${a.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\1`).test(stripComments(src)))
      expect(stillMatches, `${rel} no longer contains any acronym literal — remove it from the list`)
        .toBe(true)
      expect(reason.length, `${rel} needs a real reason, not a placeholder`).toBeGreaterThan(40)
    }
  })
})

describe('the AESA label surfaces resolve through the shared helper', () => {
  // The three SPACE-CONSTRAINED surfaces that used shortPbName. Each must read
  // the boundary record via boundaryLabel / boundaryLabelText rather than
  // reshaping the name itself.
  //
  // IndicatorDisplayFilter is deliberately not here: it is a vertical
  // checklist with a full row of width, so it renders `pb_name` whole and has
  // nothing to wrap. It gets its own assertion below — that it stays that way.
  const SURFACES = [
    'components/aesa/RadarView.tsx',
    'components/aesa/TimelineView.tsx',
    'components/aesa/BoxPlotView.tsx',
  ]

  it.each(SURFACES)('%s imports the shared label helper', (rel) => {
    const src = readFileSync(join(SRC, rel), 'utf-8')
    expect(src).toMatch(/from '.*utils\/aesaBoundaryLabels'/)
    expect(src).toMatch(/boundaryLabel(Text)?\s*\(/)
  })

  it.each(SURFACES)('%s does not slice or truncate the name itself', (rel) => {
    const src = stripComments(readFileSync(join(SRC, rel), 'utf-8'))
    // `.slice(` / `.substring(` applied to a pb name is the truncation shape.
    expect(src, `${rel} appears to truncate a boundary name`)
      .not.toMatch(/pb_(short_)?name[^\n]*\.(slice|substring|substr)\(/)
  })

  it('the indicator filter shows the full name, unshortened', () => {
    const src = readFileSync(join(SRC, 'components/aesa/IndicatorDisplayFilter.tsx'), 'utf-8')
    expect(src, 'the filter must render the boundary name as given')
      .toMatch(/\{ind\.name\}/)
    expect(stripComments(src), 'the filter must not truncate — it has a full row of width')
      .not.toMatch(/\.(slice|substring|substr)\(/)
    expect(src, 'and must not add an ellipsis of its own')
      .not.toContain('…')
  })

  it('the glossary reads the boundary records rather than its own table', () => {
    const src = readFileSync(join(SRC, 'components/aesa/BoundaryGlossary.tsx'), 'utf-8')
    expect(src).toContain('conventional_acronym')
    expect(src).toContain('boundarySet')
    // No literal category names — every row comes from the data.
    expect(stripComments(src)).not.toMatch(/(['"`])Climate change\1/)
  })
})
