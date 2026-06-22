/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// N-way axis-conflict rule (Patch 2C → 2E.2 → 2F.2).
//
// Multi-scenario fan-out is allowed on at most ONE axis at a time. When
// two or more axes have N>1, calculation is blocked with a message naming
// only the conflicting axes.
//
// The rule is symmetric across all axes — keeping it as a count of axes >1
// means new axes (Paired DSM × LCI in 2F.2) plug in without rewriting it.
//
// ``Paired`` is a co-varying axis: one task per (DSM scenario, LCI scenario)
// pair. It is mutually exclusive with the independent axes — when paired
// fan-out is active, the LCI and DSM single-axis selections collapse to N=1
// for axisConflict purposes (callers should pass paired = pairs.length and
// lci = dsm = 1 when in paired mode).

export interface AxisCounts {
  lci: number
  dsm: number
  parameter: number
  /** Optional — count of paired (DSM × LCI) entries when running in paired
   *  mode. Defaults to 0 (not in paired mode). */
  paired?: number
}

export type AxisName = 'LCI' | 'DSM' | 'Parameter' | 'Paired'

export interface AxisConflict {
  conflict: boolean
  axes: AxisName[]
  message: string | null
}

export function evaluateAxisConflict(counts: AxisCounts): AxisConflict {
  const axes: AxisName[] = []
  if (counts.lci > 1) axes.push('LCI')
  if (counts.dsm > 1) axes.push('DSM')
  if (counts.parameter > 1) axes.push('Parameter')
  if ((counts.paired ?? 0) > 1) axes.push('Paired')
  const conflict = axes.length > 1
  const message = conflict
    ? `Cannot run multi-${axes.join('-scenario with multi-')}-scenario in the same calculation. Choose one axis.`
    : null
  return { conflict, axes, message }
}
