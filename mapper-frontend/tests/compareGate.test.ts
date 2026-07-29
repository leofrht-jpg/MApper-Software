/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { computeCompareGate } from '../src/utils/compareGate'

/**
 * The System-level "Comparison" tab gate. A multi-LCI-scenario Prospective run
 * used to BLOCK the tab ("Pick one LCI scenario") because there was no UI to
 * choose which scenario to diff against Static. The Comparison tab now exposes
 * an in-tab scenario picker (compareScenarioIndex) and computes the delta
 * client-side, so multi-scenario is NO LONGER a blocker — the gate only checks
 * that Static AND a Projected result both exist.
 */
describe('computeCompareGate', () => {
  it('both results present → ENABLED', () => {
    const g = computeCompareGate(true, true)
    expect(g.canCompare).toBe(true)
    expect(g.subHint).toBe('Δ static vs projected')
  })

  it('multi-LCI-scenario Prospective + Static both present → ENABLED (no longer blocks)', () => {
    // The projected run computed 3 LCI scenarios; projectedResult is pinned to
    // scenarios[0] so hasProjected is true. The tab is enabled and the picker
    // (inside ComparisonPanel) chooses which scenario to diff against.
    const g = computeCompareGate(true, true)
    expect(g.canCompare).toBe(true)
    expect(g.subHint).toBe('Δ static vs projected')
    // Must NOT show the old blocking hint.
    expect(g.subHint).not.toContain('Pick one LCI scenario')
  })

  it('Static only → disabled, hint names PROSPECTIVE as the gap', () => {
    const g = computeCompareGate(true, false)
    expect(g.canCompare).toBe(false)
    expect(g.subHint).toBe('Run Prospective first')
    expect(g.titleHint).toBe('Run Prospective Background first')
  })

  it('Prospective only → disabled, hint names STATIC as the gap', () => {
    const g = computeCompareGate(false, true)
    expect(g.canCompare).toBe(false)
    expect(g.subHint).toBe('Run Static first')
    expect(g.titleHint).toBe('Run Static Background first')
  })

  it('neither → disabled, hint names BOTH', () => {
    const g = computeCompareGate(false, false)
    expect(g.canCompare).toBe(false)
    expect(g.subHint).toBe('Run both first')
    expect(g.titleHint).toContain('Static Background and Prospective Background')
  })

  it('cancelled Prospective leaves projectedResult null (hasProjected=false) → names Prospective, not a false-present', () => {
    // A stopped run clears the slot at start and never re-sets it → hasProjected
    // is false, so the gate correctly asks to run Prospective (no stale value).
    const g = computeCompareGate(true, false)
    expect(g.canCompare).toBe(false)
    expect(g.subHint).toBe('Run Prospective first')
  })
})
