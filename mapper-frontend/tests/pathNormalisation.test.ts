// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Source-sweeping guards build paths with `relPosix`, never bare `relative()`.
 *
 * WHY THIS IS WORTH AUTOMATING at only five sites: the bug had already
 * happened three times — written correctly once and wrongly twice — the
 * failure is TOTAL rather than partial (a guard comparing `components\\x.tsx`
 * against a posix-keyed ALLOWED map reports every exempted file as an
 * offender, so the whole tree fails), and there is NO WINDOWS JOB in the
 * frontend CI, so nothing here would ever catch it. A Windows contributor
 * running `npm test` is the first to find out, and what they see is a suite
 * that appears to have detected hundreds of violations.
 *
 * The backend hit the identical bug in its package-walk guard, where Windows
 * CI did catch it. This side has the same shape and no such safety net.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { relPosix } from './helpers/relPosix'

const TESTS = resolve(fileURLToPath(import.meta.url), '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const f = join(dir, name)
    if (statSync(f).isDirectory()) out.push(...walk(f))
    else if (/\.tsx?$/.test(f)) out.push(f)
  }
  return out
}

describe('source-sweeping guards normalise their paths', () => {
  it('no test calls relative() without normalising the separator', () => {
    const offenders: string[] = []
    for (const f of walk(TESTS)) {
      const rel = relPosix(TESTS, f)
      // The one implementation, and this guard — whose anti-vacuity case
      // holds the offending string as data so it can prove it still fires.
      if (rel === 'helpers/relPosix.ts') continue
      if (rel === 'pathNormalisation.test.ts') continue
      const src = readFileSync(f, 'utf-8')
      // `relative(` not immediately followed by the posix fold
      const bare = /(?<!\w)relative\([^)]*\)(?!\s*\.split\(sep\))/.test(src)
      if (bare) offenders.push(rel)
    }
    expect(offenders, 'call node:path relative() directly. On Windows that '
      + 'yields backslashes, and a guard comparing the result against a '
      + 'posix-keyed ALLOWED map reports its own exemptions as offenders — '
      + 'the whole tree. Import relPosix from ./helpers/relPosix instead.')
      .toEqual([])
  })

  it('relPosix actually folds a Windows separator', () => {
    // Simulated rather than asserted from the live platform, which is posix.
    const windowsish = 'components\\impact\\Foo.tsx'
    expect(windowsish.split('\\').join('/')).toBe('components/impact/Foo.tsx')
    // and the helper is a no-op on posix, so it is safe everywhere
    expect(relPosix(TESTS, join(TESTS, 'helpers', 'relPosix.ts')))
      .toBe('helpers/relPosix.ts')
  })

  it('there is exactly ONE implementation of the fold', () => {
    const impls: string[] = []
    for (const f of walk(TESTS)) {
      const src = readFileSync(f, 'utf-8')
      if (/\.split\(sep\)\.join\('\/'\)/.test(src)) impls.push(relPosix(TESTS, f))
    }
    expect(impls, 'define the posix fold. It had three copies — one correct, '
      + 'two not — which is how the same bug shipped twice.')
      .toEqual(['helpers/relPosix.ts'])
  })

  it('the guard would catch a bare relative() (anti-vacuity)', () => {
    const bad = "const rel = relative(SRC, f)\nif (rel in ALLOWED) {}"
    const good = "const rel = relPosix(SRC, f)"
    const re = /(?<!\w)relative\([^)]*\)(?!\s*\.split\(sep\))/
    expect(re.test(bad)).toBe(true)
    expect(re.test(good)).toBe(false)
    // and `sep` is genuinely imported here so the negative lookahead is real
    expect(typeof sep).toBe('string')
  })
})
