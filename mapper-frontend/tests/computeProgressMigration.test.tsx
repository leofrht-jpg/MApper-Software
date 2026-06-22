/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Patch 5AL — source-level regression guards for the compute-progress
// unification. The live elapsed counter is the shared <ComputeProgress>
// (fed by useElapsedSeconds, M:SS via formatElapsed) — never a bespoke
// setInterval timer, an in-button elapsed label, or the old teal "Computing… Ns"
// pill. These assert the migrated sites adopted the shared component and the
// retired bespoke timers / pill are gone.

const dir = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(resolve(dir, '..', p), 'utf8')

const MIGRATED = [
  'src/components/impact/MultiProductLCA.tsx',
  'src/components/impact/SingleProductStaticPanel.tsx',
  'src/components/impact/SingleProductProjectedPanel.tsx',
  'src/components/dsm/DSMImpactPanel.tsx',
  'src/components/impact/ProjectedImpactPanel.tsx',
  'src/components/lca/ContributionAnalysisPanel.tsx',
  'src/pages/PLCADeveloper.tsx',
  'src/components/aesa/ConfigSidebar.tsx',
]

describe('compute-progress migration (Patch 5AL)', () => {
  it('every migrated site imports + renders <ComputeProgress>', () => {
    for (const f of MIGRATED) {
      const src = read(f)
      expect(src, `${f} imports ComputeProgress`).toMatch(/import\s*\{\s*ComputeProgress\s*\}/)
      expect(src, `${f} renders <ComputeProgress`).toContain('<ComputeProgress')
    }
  })

  it('Multi-item no longer renders the teal "Computing… Ns" pill and shows no bar', () => {
    const src = read('src/components/impact/MultiProductLCA.tsx')
    // The old pill (in-button elapsed label + its testid) is gone.
    expect(src).not.toContain('multi-product-compute-elapsed')
    expect(src).not.toContain('computeElapsed')
    expect(src).not.toMatch(/import.*useElapsedSeconds/)
    // Its ComputeProgress uses bar='none' (synchronous fan-out, no real pct).
    expect(src).toContain('data-testid="multi-product-compute-progress"')
    expect(src).toContain('bar="none"')
  })

  it('retired panels no longer roll a bespoke setInterval elapsed timer', () => {
    // DSMImpactPanel + ProjectedImpactPanel previously kept their own
    // useState(elapsed)+setInterval. The live counter now comes from
    // <ComputeProgress> (useElapsedSeconds). No setInterval should remain in
    // these panels.
    for (const f of [
      'src/components/dsm/DSMImpactPanel.tsx',
      'src/components/impact/ProjectedImpactPanel.tsx',
    ]) {
      const src = read(f)
      expect(src, `${f} has no setInterval`).not.toMatch(/setInterval/)
    }
  })

  it('the single-product panels dropped their in-button elapsed label', () => {
    for (const f of [
      'src/components/impact/SingleProductStaticPanel.tsx',
      'src/components/impact/SingleProductProjectedPanel.tsx',
    ]) {
      const src = read(f)
      expect(src, `${f} no in-button elapsedSeconds`).not.toContain('elapsedSeconds')
    }
  })

  it('ComputeProgress is fed by useElapsedSeconds + formatElapsed (single source/format)', () => {
    const src = read('src/components/ui/ComputeProgress.tsx')
    expect(src).toContain("from '../../hooks/useElapsedSeconds'")
    expect(src).toContain('formatElapsed')
    expect(src).toContain('useElapsedSeconds(active)')
  })
})
