/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderHook } from '@testing-library/react'
import { useDSMSystemColors } from '../src/utils/dsmCohortColors'
import { useProjectStore } from '../src/stores/projectStore'

// The System-level "Impact over time, by cohort" chart appears on BOTH the
// Static Background (DSMImpactPanel) and Prospective Background
// (ProjectedImpactPanel) tabs. They must resolve cohort colors through the SAME
// source — dsmCohortColors.ts (`useDSMSystemColors.colorForCohort`) — so the
// same cohort/fuel shows the same color when switching tabs. Previously Static
// used an independent `useChartColors(cohortStackKeys)` path (algorithmic
// per-cohort), which diverged from Prospective's fuel colors.

const FUEL = { name: 'fuel_type', is_age: false, labels: ['BEV-LFP', 'PHEV', 'ICEV-Petrol'] }
const SIZE = { name: 'size', is_age: false, labels: ['Small', 'Large'] }
const SYSTEM: any = { id: 'sys', name: 'Fleet', dimensions: [FUEL, SIZE], time_horizon: { start_year: 2025, end_year: 2050 } }
const COHORTS = ['BEV-LFP|Small', 'BEV-LFP|Large', 'PHEV|Small']

// Exactly how BOTH panels build their cohortColorMap.
const buildMap = (colorForCohort: (ck: string, i?: number) => string, keys: string[]) => {
  const m: Record<string, string> = {}
  keys.forEach((ck, i) => { m[ck] = colorForCohort(ck, i) })
  return m
}

// Vitest runs from the mapper-frontend dir.
const readSrc = (rel: string) =>
  readFileSync(join(process.cwd(), 'src', rel), 'utf8')

// Extract the named imports from the `utils/chartColors` import (or '' if none).
const chartColorsImports = (src: string): string =>
  src.match(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*chartColors['"]/)?.[1] ?? ''

beforeEach(() => {
  try { localStorage.clear() } catch { /* jsdom */ }
  useProjectStore.setState({ currentProject: 'test-proj' } as any)
})

describe('by-cohort impact colors — Static & Prospective share one source', () => {
  it('both panels build cohortColorMap via the shared resolver; Static no longer uses the independent useChartColors path', () => {
    const staticSrc = readSrc('components/dsm/DSMImpactPanel.tsx')
    const projSrc = readSrc('components/impact/ProjectedImpactPanel.tsx')

    // Both go through dsmCohortColors' resolver.
    for (const src of [staticSrc, projSrc]) {
      expect(src).toContain('useDSMSystemColors')
      expect(src).toContain('dsmColors.colorForCohort')
    }
    // Static must NOT reintroduce the independent per-cohort color path: it may
    // still import `colorFor` from chartColors, but never `useChartColors`
    // (checked on the import statement, not comments).
    expect(chartColorsImports(staticSrc)).not.toContain('useChartColors')
    // And no actual call to it anywhere in the Static panel source.
    expect(staticSrc).not.toMatch(/[^.\w]useChartColors\s*\(/)
  })

  it('the shared resolver gives fuel-consistent colors (stack-by fuel): same-fuel cohorts share one color', () => {
    const { result } = renderHook(() => useDSMSystemColors(SYSTEM, 'fuel_type'))
    const map = buildMap(result.current.colorForCohort, COHORTS)
    expect(map['BEV-LFP|Small']).toBe(map['BEV-LFP|Large'])
    expect(map['BEV-LFP|Small']).not.toBe(map['PHEV|Small'])
  })

  it('parity: the map built the Static way equals the map built the Prospective way for identical inputs', () => {
    // Both panels: useDSMSystemColors(activeSystem, stackByDimension, {rowColorOverrides}) → colorForCohort.
    const rowColorOverrides = { 'BEV-LFP|Small': '#123456' }
    const staticHook = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel_type', { rowColorOverrides }),
    )
    const projHook = renderHook(() =>
      useDSMSystemColors(SYSTEM, 'fuel_type', { rowColorOverrides }),
    )
    const staticMap = buildMap(staticHook.result.current.colorForCohort, COHORTS)
    const projMap = buildMap(projHook.result.current.colorForCohort, COHORTS)
    expect(staticMap).toEqual(projMap)
    for (const ck of COHORTS) expect(staticMap[ck]).toBe(projMap[ck])
  })
})
