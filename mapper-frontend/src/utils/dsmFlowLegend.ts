/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Patch 5AD — legend/series model for the DSM "Inflows & Outflows" chart.
//
// Pure derivation of the chart's legend entries (and thereby which series
// render) from the per-year flow breakdown. Inflows always lead; the outflow
// side is a single "Outflows" entry when one source applies, or the
// natural/forced/uploaded split when several do. Colors are FIXED per series
// (not index-based), so toggling/removing one never recolors another and the
// inflow green matches the table/summary coding. This is a VISUALIZATION model
// over the existing DSM result — not a compute change.

export interface FlowBreakdownFlags {
  hasInflow: boolean
  hasNatural: boolean
  hasForced: boolean
  hasManual: boolean
}

export interface FlowLegendEntry {
  /** dataKey-aligned id: 'inflow' | 'outflow' | 'natural' | 'forced' | 'manual'. */
  key: string
  color: string
  label: string
}

// Fixed per-series colors. Inflow = table/summary green; outflow sources keep
// their established DSM colors.
export const FLOW_COLORS = {
  inflow: 'var(--success)',
  natural: 'var(--chart-3)',
  forced: 'var(--danger)',
  manual: 'var(--mod-dsm)',
} as const

export function outflowSourceCount(b: FlowBreakdownFlags): number {
  return (b.hasNatural ? 1 : 0) + (b.hasForced ? 1 : 0) + (b.hasManual ? 1 : 0)
}

export function buildFlowLegend(b: FlowBreakdownFlags): FlowLegendEntry[] {
  const entries: FlowLegendEntry[] = []
  if (b.hasInflow) entries.push({ key: 'inflow', color: FLOW_COLORS.inflow, label: 'Inflows' })

  const outCount = outflowSourceCount(b)
  if (outCount >= 2) {
    if (b.hasNatural) entries.push({ key: 'natural', color: FLOW_COLORS.natural, label: 'Natural attrition' })
    if (b.hasForced) entries.push({ key: 'forced', color: FLOW_COLORS.forced, label: 'Forced' })
    if (b.hasManual) entries.push({ key: 'manual', color: FLOW_COLORS.manual, label: 'Uploaded' })
  } else if (outCount === 1) {
    // Single outflow source → one "Outflows" entry, colored to match its bar.
    const color = b.hasNatural ? FLOW_COLORS.natural : b.hasForced ? FLOW_COLORS.forced : FLOW_COLORS.manual
    entries.push({ key: 'outflow', color, label: 'Outflows' })
  }
  return entries
}
