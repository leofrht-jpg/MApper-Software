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

// Cohort/dim colors must resolve through ONE place: `useDSMSystemColors` in
// `utils/dsmCohortColors.ts`. Calling `useChartColors` directly bypasses the
// per-cohort assignment layer, which is how DSM Stock Composition came to paint
// the algorithmic palette over the user's assigned fuel families.
//
// What makes that bug worth a guard is not the bug — it is that the component
// was examined TWICE and excluded both times, and the exclusion was recorded as
// settled ("known correct"). A verdict of "this one is fine" is exactly what
// nobody re-checks. So exceptions are listed here BY NAME WITH A REASON: a
// future exclusion has to be written down and argued, not assumed, and the
// reason is reviewable at the moment it is claimed.
//
// Sibling of tests/carbonBudgetSingleImplementation.test.ts, which does the
// same for the carbon-budget depletion rule after that arithmetic reached a
// fourth copy.

const SRC = resolve(process.cwd(), 'src')

/**
 * Files permitted to call `useChartColors` directly.
 *
 * Adding an entry is a claim that the file colors something OTHER than DSM
 * cohorts or dimension values. State which label space it uses — that is the
 * check, and it is what the two wrong verdicts skipped.
 */
const ALLOWED: Record<string, string> = {
  'utils/chartColors.ts':
    'Defines useChartColors — it matches its own declaration, not a call. The '
    + 'palette primitive every other consumer is measured against.',

  'utils/dsmCohortColors.ts':
    'The resolver itself. Wraps useChartColors and folds in per-cohort '
    + 'assignments; everything else goes through it.',

  'components/impact/CohortMappingEditor.tsx':
    'The color EDITOR, not a chart. It must read the raw per-dim map to render '
    + 'swatches and to distinguish user-overridden labels from auto-assigned '
    + 'ones (getOverriddenLabels). Routing it through the resolver would hide '
    + 'the very distinction it exists to show.',

  'components/flows/MaterialFlowPanel.tsx':
    'Colors by MATERIAL NAME (steel, aluminium…), a different label space from '
    + 'cohorts and dimension values. No cohort mapping exists for materials, so '
    + 'no per-cohort assignment could apply. Genuinely out of scope — but see '
    + 'the scope note below: it shares the project-scoped color map, so a '
    + 'material named identically to a dim value would collide.',

  'components/impact/MultiProductComparisonChart.tsx':
    'Colors per comparison ITEM (archetypes / activity vintages) and passes an '
    + "explicit 'multi-product' scope, so it does not share the project map at "
    + 'all. Correctly isolated.',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** Strip comments so prose about the rule isn't read as a breach of it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('cohort and dim colors resolve in one place', () => {
  const files = walk(SRC)

  it('finds the source tree (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('nothing outside the named exceptions calls useChartColors directly', () => {
    const offenders = files.filter((f) => {
      const rel = relative(SRC, f)
      if (rel in ALLOWED) return false
      return /\buseChartColors\s*\(/.test(stripComments(readFileSync(f, 'utf-8')))
    }).map((f) => relative(SRC, f))

    expect(offenders, 'call useChartColors directly and are not in the ALLOWED '
      + 'list. Use useDSMSystemColors so per-cohort assignments apply — or add '
      + 'an entry to ALLOWED stating which label space this file colors and why '
      + 'cohort assignments cannot apply to it.')
      .toEqual([])
    void ALLOWED
  })

  it('every named exception still exists and still calls useChartColors', () => {
    // A stale exception is as bad as a missing one: it silently permits a file
    // that has since changed shape, or names a file that has moved.
    for (const [rel, reason] of Object.entries(ALLOWED)) {
      const full = join(SRC, rel)
      let src: string
      try {
        src = readFileSync(full, 'utf-8')
      } catch {
        throw new Error(`ALLOWED lists ${rel}, which no longer exists — remove it`)
      }
      expect(/\buseChartColors\s*\(/.test(stripComments(src)), `${rel} no longer calls `
        + 'useChartColors — remove it from ALLOWED').toBe(true)
      expect(reason.length, `${rel} needs a real reason, not a placeholder`)
        .toBeGreaterThan(40)
    }
  })

  it('the DSM dashboard resolves through the shared hook', () => {
    const dash = readFileSync(join(SRC, 'pages/DSMDashboard.tsx'), 'utf-8')
    expect(dash).toContain('useDSMSystemColors(')
    // And it must hand the per-cohort assignments in — without them the hook
    // has nothing to derive band colors from. This is the line whose ABSENCE
    // would reproduce the reported bug even with the resolver fixed.
    expect(stripComments(dash)).toContain('rowColorOverrides')
  })

  it('the impact panels resolve through the shared hook too', () => {
    for (const rel of [
      'components/dsm/DSMImpactPanel.tsx',
      'components/impact/ProjectedImpactPanel.tsx',
    ]) {
      const src = readFileSync(join(SRC, rel), 'utf-8')
      expect(src, `${rel} must use the shared resolver`).toContain('useDSMSystemColors(')
      expect(stripComments(src), `${rel} must pass per-cohort assignments`)
        .toContain('rowColorOverrides')
    }
  })
})

describe('the resolver applies per-cohort assignments to dim bands', () => {
  const src = readFileSync(join(SRC, 'utils/dsmCohortColors.ts'), 'utf-8')

  it('derives band colors from row assignments, not only at upload', () => {
    // The gap that produced the bug: the derivation existed but was wired ONLY
    // at the Excel upload boundary, so colors assigned in the app never reached
    // charts that read colorMap. The runtime derivation is the stricter
    // `deriveCompleteDimColors` — see its docstring for why the two rules
    // differ.
    expect(src).toContain('deriveCompleteDimColors(rowColorOverrides')
  })

  it('the runtime derivation requires a COMPLETE assignment for a band', () => {
    // A partially-colored family must not repaint the rows the user left
    // alone. The upload-boundary rule (blank = "no opinion") is deliberately
    // looser and stays as it was.
    expect(src).toContain('export function deriveCompleteDimColors')
    expect(src).toContain('counted[value] !== expected[value]')
  })

  it('lets an explicit per-dim color win over a derived one', () => {
    expect(src).toContain('getOverriddenLabels')
  })
})
