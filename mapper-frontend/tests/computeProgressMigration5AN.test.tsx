/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

// Patch 5AN — the 6 remaining single-compute inline <ElapsedCounter> timers
// (LCACalculator ×5 + DSMDashboard sim) are migrated to <ComputeProgress>.
// After this, <ComputeProgress> covers all single-compute progress and the
// <ElapsedCounter> COMPONENT is used ONLY by MethodLibrary (the per-row
// install-list exception). Source-level guards (full-page renders are heavy
// and fragile; the bar-mode rendering itself is locked by the 5AL component
// test computeProgress.test.tsx).

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

// Pull each <ComputeProgress .../> block and key it by data-testid.
function progressBlocks(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const blocks = src.match(/<ComputeProgress\b[\s\S]*?\/>/g) ?? []
  for (const b of blocks) {
    const id = b.match(/data-testid="([^"]+)"/)?.[1]
    if (id) out[id] = b
  }
  return out
}

describe('LCACalculator timers migrated to <ComputeProgress>', () => {
  const src = read('src/pages/LCACalculator.tsx')
  const blocks = progressBlocks(src)

  it('imports ComputeProgress and no longer imports ElapsedCounter', () => {
    expect(src).toMatch(/import\s*\{\s*ComputeProgress\s*\}/)
    expect(src).not.toMatch(/import\s*\{\s*ElapsedCounter\s*\}/)
  })

  it('multi-year is determinate (real backend pct) and keeps its StopButton', () => {
    const b = blocks['multi-year-progress']
    expect(b).toBeTruthy()
    expect(b).toContain('bar="determinate"')
    expect(b).toMatch(/pct=\{.*myProgress.*\}/)
    // The cancel control is NOT folded into the card — StopButton stays inline.
    expect(src).toContain('<StopButton taskId={myCancel.taskId}')
  })

  it('activity / archetype / contribution loaders have no fabricated bar (none)', () => {
    for (const id of [
      'activity-lca-progress',
      'archetype-lca-progress',
      'lca-activity-contribution-progress',
      'lca-archetype-contribution-progress',
    ]) {
      expect(blocks[id], `${id} present`).toBeTruthy()
      expect(blocks[id], `${id} bar=none`).toContain('bar="none"')
    }
  })

  it('drops the dead per-timer startedAt state (caStartedAt is the only one kept)', () => {
    expect(src).not.toContain('actStartedAt')
    expect(src).not.toContain('arcStartedAt')
    expect(src).not.toContain('myStartedAt')
    // caStartedAt stays — still passed to ContributionAnalysisPanel.loadingStartedAt.
    expect(src).toContain('caStartedAt')
  })
})

describe('DSMDashboard simulation timer migrated', () => {
  const src = read('src/pages/DSMDashboard.tsx')
  const blocks = progressBlocks(src)

  it('imports ComputeProgress, not ElapsedCounter', () => {
    expect(src).toMatch(/import\s*\{\s*ComputeProgress\s*\}/)
    expect(src).not.toMatch(/import\s*\{\s*ElapsedCounter\s*\}/)
  })

  it('sim progress is bar=none (single in-process op, no pct) and simStartedAt is gone', () => {
    expect(blocks['dsm-sim-progress']).toBeTruthy()
    expect(blocks['dsm-sim-progress']).toContain('bar="none"')
    expect(src).not.toContain('simStartedAt')
  })
})

describe('invariant — <ElapsedCounter> is now used ONLY by MethodLibrary', () => {
  it('the ElapsedCounter component has exactly one importer: MethodLibrary', () => {
    const srcDir = resolve(root, 'src')
    const importers: string[] = []
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name)
        if (entry.isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        const s = readFileSync(p, 'utf8')
        // import of the COMPONENT (not the `formatElapsed` helper).
        if (/import\s*\{\s*ElapsedCounter\b[^}]*\}\s*from\s*['"][^'"]*ElapsedCounter['"]/.test(s)) {
          importers.push(p.replace(srcDir + '/', ''))
        }
      }
    }
    walk(srcDir)
    expect(importers).toEqual(['components/impact/MethodLibrary.tsx'])
  })
})
