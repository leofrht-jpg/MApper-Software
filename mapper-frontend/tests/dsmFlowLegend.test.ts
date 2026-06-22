/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { buildFlowLegend, outflowSourceCount, FLOW_COLORS } from '../src/utils/dsmFlowLegend'

// Patch 5AD — the DSM "Inflows & Outflows" chart shows both flows from the
// existing DSM result (visualization, not compute). Lock the legend/series
// model: Inflows lead (green, matching the table), outflows are one "Outflows"
// entry or the natural/forced/uploaded split; colors are fixed per series.

const B = (over: Partial<Record<'hasInflow'|'hasNatural'|'hasForced'|'hasManual', boolean>> = {}) => ({
  hasInflow: false, hasNatural: false, hasForced: false, hasManual: false, ...over,
})

describe('buildFlowLegend (Patch 5AD)', () => {
  it('shows Inflows + a single "Outflows" entry when one outflow source applies', () => {
    const entries = buildFlowLegend(B({ hasInflow: true, hasNatural: true }))
    expect(entries.map((e) => e.label)).toEqual(['Inflows', 'Outflows'])
    expect(entries.map((e) => e.key)).toEqual(['inflow', 'outflow'])
    // Inflows green (table coding); single Outflows takes its source color.
    expect(entries[0].color).toBe(FLOW_COLORS.inflow)
    expect(entries[1].color).toBe(FLOW_COLORS.natural)
  })

  it('shows Inflows + the outflow split when multiple outflow sources apply', () => {
    const entries = buildFlowLegend(B({ hasInflow: true, hasNatural: true, hasForced: true, hasManual: true }))
    expect(entries.map((e) => e.label)).toEqual(['Inflows', 'Natural attrition', 'Forced', 'Uploaded'])
  })

  it('inflows always lead the legend', () => {
    const entries = buildFlowLegend(B({ hasInflow: true, hasForced: true, hasManual: true }))
    expect(entries[0].key).toBe('inflow')
  })

  it('colors are distinct across series and fixed per series (stable)', () => {
    const entries = buildFlowLegend(B({ hasInflow: true, hasNatural: true, hasForced: true, hasManual: true }))
    const colors = entries.map((e) => e.color)
    expect(new Set(colors).size).toBe(colors.length)  // all distinct
    // Removing one series doesn't change another's color (fixed-per-key).
    const fewer = buildFlowLegend(B({ hasInflow: true, hasForced: true }))
    expect(fewer.find((e) => e.key === 'inflow')!.color).toBe(FLOW_COLORS.inflow)
  })

  it('inflow-only (no outflow) shows just Inflows', () => {
    expect(buildFlowLegend(B({ hasInflow: true })).map((e) => e.label)).toEqual(['Inflows'])
  })

  it('outflow-only (no inflow) shows just the outflow side', () => {
    expect(buildFlowLegend(B({ hasNatural: true })).map((e) => e.label)).toEqual(['Outflows'])
  })

  it('outflowSourceCount counts non-zero outflow sources', () => {
    expect(outflowSourceCount(B({ hasNatural: true, hasForced: true }))).toBe(2)
    expect(outflowSourceCount(B({ hasInflow: true }))).toBe(0)
  })
})
