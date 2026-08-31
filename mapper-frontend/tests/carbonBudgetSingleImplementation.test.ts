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
import { join, resolve } from 'node:path'

import { relPosix } from './helpers/relPosix'

// There have been FOUR copies of the carbon-budget depletion arithmetic: the
// engine, the timeline inset, the sidebar sparkline, and the shared helper that
// replaced two of them. Each frontend copy accumulated INCLUSIVELY where the
// engine sums exclusively, so each annotated depletion a year early — and they
// were found one at a time, months apart, by someone noticing two panels
// disagreeing.
//
// Finding them by symptom ("remaining") missed the sparkline. Finding them by
// OPERATION — anything summing `projected_emissions` — finds all of them. This
// test greps for the operation and fails on a fifth copy.
//
// Post-compute surfaces must read `remaining_budget_gt` off the SR rows
// (`budgetSeriesFromResults`); pre-compute previews call
// `utils/carbonBudget.ts`. Neither needs to accumulate inline.
//
// WHAT THIS GUARD COVERS
// ----------------------
// Every .ts/.tsx under src/ AND under tests/, comments stripped:
//
//  * src/ — element-wise access to `projected_emissions`: indexing, a method
//    chain (`.reduce`/`.map`/…), `Object.entries|keys|values`, `for…of`, and
//    destructuring the field out. Forbidding ACCESS rather than enumerating
//    accumulation idioms is the point — you cannot sum what you cannot reach,
//    whichever loop you reach for. Two files may reference the field as a
//    WHOLE VALUE (`api/client.ts` declares its type, ConfigSidebar passes the
//    SSP's record to `onPatch`); both are still run through every rule, so
//    allowlisting a file cannot smuggle an accumulation in beside the
//    pass-through.
//  * tests/ — the narrower ACCUMULATION rules (`+=` on an element, `.reduce`
//    over the field) instead, because a test may legitimately marshal a
//    fixture's string-keyed record or assert one year's value. Summing across
//    years is never legitimate there. This scope is not theoretical: it found
//    `carbonBudgetPanelAgreement` re-deriving the sum inline and asserting the
//    ENGINE against it — "the engine agrees with a copy in this file".
//  * both — comparing a running total to `initial_budget_gt` in either
//    direction on any operator (`>`, `>=`, `<`, `<=`, `===`, `!==`, `==`,
//    `!=`). The original rule matched only `>` and `>=`.
//
// Every rule is asserted against a synthetic corpus by "the rules actually
// match the constructs they name", so the sweep cannot pass vacuously if a
// regex stops matching real code.
//
// WHAT IT CANNOT COVER
// --------------------
// It is text matching, not analysis. It will NOT catch:
//
//  * an INDIRECTION — a helper taking `Record<number, number>` and summing it
//    never names `projected_emissions`, so nothing fires. Same for a copy
//    operating on a local alias bound in a whole-value pass-through.
//  * MISUSE of a correct call — `remainingBudgetAt(budget, year + 1)` is the
//    original bug's shape and passes every rule; the caller did use the helper.
//    Only the engine-generated fixtures (`carbonBudgetSparkline.json`,
//    `carbonBudgetEngineSeries.json`) catch that class.
//  * anything outside src/ and tests/ — scripts, config, the Tauri shell.
//  * a NEW field. These rules are written for `projected_emissions` and
//    `initial_budget_gt`; a second pathway field would need adding by hand.

const SRC = resolve(process.cwd(), 'src')
const TESTS = resolve(process.cwd(), 'tests')

/** The one module allowed to implement the rule. */
const CARBON_BUDGET_UTIL = 'utils/carbonBudget.ts'

/**
 * Files that may reference `projected_emissions` as a WHOLE VALUE.
 *
 * Referencing the field is not the offence — indexing it, iterating it or
 * summing it is. These two do neither: `client.ts` declares its type, and
 * ConfigSidebar hands the SSP's whole record to `onPatch`. The rules below
 * distinguish the two cases structurally, so this list stays short and a new
 * entry has to be argued for.
 */
const WHOLE_VALUE_OK = new Set([
  'api/client.ts',
  'components/aesa/ConfigSidebar.tsx',
])


function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** Strip comments so prose ABOUT the bug doesn't count as an instance of it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Every way we know of to walk `projected_emissions` element by element.
 *
 * The 2026-08 review's point: matching `+=` alone would miss `reduce`, a
 * `for…of` accumulator and destructuring, and the codebase had ALREADY grown
 * five copies of this arithmetic — four in src, one in tests. So the rule is
 * inverted: instead of enumerating accumulation idioms, forbid ELEMENT ACCESS.
 * You cannot sum what you cannot reach, whatever loop you reach for.
 */
const ELEMENT_ACCESS: Array<[string, RegExp]> = [
  // b.projected_emissions[y] — indexing
  ['index', /\.projected_emissions\s*\[/],
  // b.projected_emissions.reduce/map/forEach/filter/… — method chain
  ['method chain', /\.projected_emissions\s*\??\.\s*[A-Za-z_$]/],
  // Object.entries/keys/values(b.projected_emissions) — the destructuring route
  ['Object.entries/keys/values', /Object\s*\.\s*(entries|keys|values)\s*\([^)]*projected_emissions/],
  // for (const … of … projected_emissions …) — the for…of accumulator
  ['for…of', /\bfor\s*\([^)]*\bof\b[^)]*projected_emissions/],
  // const { projected_emissions } = budget — destructuring the field out
  ['destructuring', /\{[^{}]*\bprojected_emissions\b[^{}]*\}\s*=[^=]/],
]

/**
 * ACCUMULATION — the narrower rule, used where element access is legitimate.
 *
 * In `tests/` the strict rule above is the wrong tool: a test may marshal a
 * fixture's string-keyed record into a number-keyed one, or assert that
 * `withBasisApplied` scaled year 2050. Neither is a copy of the rule. What IS a
 * copy is SUMMING ACROSS YEARS, so that is what these match. Applied to
 * whitespace-flattened source, because the copy that existed spanned four lines
 * as an `Object.entries(...).filter(...).reduce(...)` chain.
 */
const ACCUMULATION: Array<[string, RegExp]> = [
  // cum += b.projected_emissions[y]
  ['+= accumulator', /\+=\s*[\w$.[\]'"]*projected_emissions\s*[[.]/],
  // …projected_emissions… .reduce( — including via Object.entries/filter
  ['reduce over the field', /projected_emissions[^;]{0,200}?\.reduce\s*\(/],
]

/**
 * Comparing a running total against the cap — the other half of the bug.
 * Widened from `>|>=` to EVERY comparison operator: `<=` inverted is the same
 * mistake, and `===` on a float cap is a bug of its own.
 */
const CAP_COMPARE =
  /(>=|<=|>|<|===|!==|==|!=)\s*[A-Za-z_$][\w$]*\.initial_budget_gt|[A-Za-z_$][\w$]*\.initial_budget_gt\s*(>=|<=|>|<|===|!==|==|!=)/

function offenders(files: string[], root: string, allow: (rel: string) => boolean,
                   rules: Array<[string, RegExp]>): string[] {
  const out: string[] = []
  for (const f of files) {
    const r = relPosix(root, f)
    if (allow(r)) continue
    const src = stripComments(readFileSync(f, 'utf-8'))
    for (const [label, re] of rules) {
      if (re.test(src)) out.push(`${r} (${label})`)
    }
  }
  return out
}

describe('the carbon-budget rule has exactly one frontend implementation', () => {
  const srcFiles = walk(SRC)
  const testFiles = walk(TESTS)

  it('finds both trees (guards against a silently empty sweep)', () => {
    expect(srcFiles.length).toBeGreaterThan(50)
    expect(testFiles.length).toBeGreaterThan(20)
    const found = new Set(srcFiles.map((f) => relPosix(SRC, f)))
    expect(found.has(CARBON_BUDGET_UTIL)).toBe(true)
    // Every allowlist entry must RESOLVE, or the allowlist is a silent no-op —
    // the failure mode a path-separator mismatch produces.
    for (const entry of WHOLE_VALUE_OK) {
      expect(found.has(entry), `allowlist entry ${entry} matches no swept file`).toBe(true)
    }
    // And no swept path carries a backslash, on any platform.
    expect([...found].some((r) => r.includes('\\'))).toBe(false)
  })

  it('the rules actually match the constructs they name', () => {
    // A guard whose regexes silently stop matching is worse than no guard, and
    // this one is pure text matching over a moving codebase. Assert against a
    // synthetic corpus of every shape, so the sweep can never pass vacuously.
    const corpus: Record<string, string> = {
      'index': 'cum += b.projected_emissions[y] ?? 0',
      'method chain': 'const t = b.projected_emissions.reduce((s, v) => s + v, 0)',
      'Object.entries/keys/values': 'for (const [y, v] of Object.entries(b.projected_emissions)) t += v',
      'for…of': 'for (const y of Object.keys(b.projected_emissions)) t += y',
      'destructuring': 'const { projected_emissions } = budget',
    }
    for (const [label, re] of ELEMENT_ACCESS) {
      expect(re.test(corpus[label]), `${label} rule no longer matches its own example`).toBe(true)
    }
    // The legitimate whole-value pass-through must NOT match any of them.
    const passthrough = 'onPatch({ ssp_scenario: s.id, projected_emissions: s.projected_emissions })'
    for (const [label, re] of ELEMENT_ACCESS) {
      expect(re.test(passthrough), `${label} rule flags a whole-value pass-through`).toBe(false)
    }
    const accCorpus: Record<string, string> = {
      '+= accumulator': 'cum += b.projected_emissions[y] ?? 0',
      // The exact shape that lived in carbonBudgetPanelAgreement, flattened.
      'reduce over the field':
        'budget.initial_budget_gt - Object.entries(budget.projected_emissions)'
        + '.filter(([y]) => Number(y) < point.year).reduce((s, [, v]) => s + v, 0)',
    }
    for (const [label, re] of ACCUMULATION) {
      expect(re.test(accCorpus[label]), `${label} rule no longer matches its own example`).toBe(true)
    }
    // Fixture marshalling and per-year assertions are NOT accumulation.
    for (const [label, re] of ACCUMULATION) {
      expect(re.test('for (const [y, v] of Object.entries(fx.projected_emissions)) out[Number(y)] = v'),
        `${label} rule flags fixture marshalling`).toBe(false)
      expect(re.test('expect(applied.projected_emissions[2050]).toBeCloseTo(40 * F, 9)'),
        `${label} rule flags a per-year assertion`).toBe(false)
    }
    for (const op of ['>=', '<=', '>', '<', '===', '!==']) {
      expect(CAP_COMPARE.test(`if (used ${op} budget.initial_budget_gt) return y`)).toBe(true)
      expect(CAP_COMPARE.test(`if (budget.initial_budget_gt ${op} used) return y`)).toBe(true)
    }
  })

  it('no source file walks projected_emissions element by element', () => {
    const bad = offenders(
      srcFiles, SRC,
      (rel) => rel === CARBON_BUDGET_UTIL || WHOLE_VALUE_OK.has(rel),
      ELEMENT_ACCESS,
    )
    expect(bad, `walk projected_emissions outside ${CARBON_BUDGET_UTIL}; call `
      + 'remainingBudgetAt/remainingBudgetSeries/budgetDepletionYear instead, or '
      + 'read remaining_budget_gt off the SR rows if a compute has already run')
      .toEqual([])
  })

  it('the whole-value allowlist really only passes the whole value', () => {
    // Allowlisting a FILE would let a future accumulation slip in beside the
    // pass-through, so each allowlisted file is still checked by the rules —
    // this asserts the allowlist is about the construct, not the filename.
    for (const rel of WHOLE_VALUE_OK) {
      const src = stripComments(readFileSync(join(SRC, rel), 'utf-8'))
      for (const [label, re] of ELEMENT_ACCESS) {
        expect(re.test(src), `${rel} now does more than pass the value through (${label})`)
          .toBe(false)
      }
    }
  })

  it('no source file derives a depletion year by comparing a total to the cap', () => {
    const bad = offenders(srcFiles, SRC, (rel) => rel === CARBON_BUDGET_UTIL,
                          [['cap compare', CAP_COMPARE]])
    expect(bad, 'compare a cumulative total against initial_budget_gt; '
      + 'use budgetDepletionYear() so the exclusive-sum rule is applied')
      .toEqual([])
  })

  it('no TEST file re-implements the rule either', () => {
    // A copy in tests is not harmless: `carbonBudgetPanelAgreement` used to
    // re-derive the sum inline with Object.entries + reduce and assert the
    // ENGINE against it — so it verified "the engine agrees with a copy in this
    // file", and would have kept passing against a drifted helper.
    //
    // The ACCUMULATION rules, not the strict element-access ones: tests
    // legitimately marshal fixtures and assert individual years. Fixtures are
    // data, and this guard file quotes the constructs by name, so both are out.
    const flat = (src: string) => src.replace(/\s+/g, ' ')
    const bad: string[] = []
    for (const f of testFiles) {
      const r = relPosix(TESTS, f)
      if (r.startsWith('fixtures/') || r === 'carbonBudgetSingleImplementation.test.ts') continue
      const src = flat(stripComments(readFileSync(f, 'utf-8')))
      for (const [label, re] of [...ACCUMULATION, ['cap compare', CAP_COMPARE] as [string, RegExp]]) {
        if (re.test(src)) bad.push(`${r} (${label})`)
      }
    }
    expect(bad, 'a test re-implements the carbon-budget arithmetic; import the '
      + 'helper from src/utils/carbonBudget so the test asserts what ships')
      .toEqual([])
  })

  it('the sparkline calls the shared helpers', () => {
    const sidebar = readFileSync(join(SRC, 'components/aesa/ConfigSidebar.tsx'), 'utf-8')
    expect(sidebar).toContain('budgetDepletionYear(budget)')
    expect(sidebar).toContain('remainingBudgetSeries(budget)')
  })

  it('the post-compute inset still reads the engine rather than the helper', () => {
    // TimelineView must NOT be migrated onto the depletion helpers — once a
    // compute exists, the engine's own numbers are available and authoritative.
    // It MAY use the basis helpers (`withBasisApplied` is a unit conversion,
    // not a re-derivation of the series).
    const timeline = readFileSync(join(SRC, 'components/aesa/TimelineView.tsx'), 'utf-8')
    expect(timeline).toContain('remaining_budget_gt')
    const stripped = stripComments(timeline)
    expect(stripped).not.toContain('budgetDepletionYear')
    expect(stripped).not.toContain('remainingBudgetSeries')
  })
})
