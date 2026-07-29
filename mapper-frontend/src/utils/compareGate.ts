/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * System-level Impact Assessment "Comparison" tab gate.
 *
 * Comparison needs BOTH a Static Background result and a Prospective Background
 * result. A multi-LCI-scenario Prospective run sets `projectedResult` (pinned
 * to scenarios[0]) AND `projectedMultiResult` — the Comparison tab now exposes
 * an in-tab scenario picker (diffing Static against ONE chosen LCI scenario via
 * `compareScenarioIndex`) and computes the delta client-side, so a multi run is
 * NO LONGER a blocking condition. The tab is enabled whenever Static AND a
 * Projected result (single or multi) both exist. The gate only names the
 * remaining gaps: missing Static / missing Prospective.
 *
 * Pure over the two store slots (nulls only) so it's testable without a DOM.
 */
export interface CompareGate {
  canCompare: boolean
  /** Compact tab caption. */
  subHint: string
  /** Fuller hover-tooltip explanation (empty when enabled). */
  titleHint: string
}

export function computeCompareGate(
  hasStatic: boolean,
  hasProjected: boolean,
): CompareGate {
  const canCompare = hasStatic && hasProjected
  if (canCompare) return { canCompare, subHint: 'Δ static vs projected', titleHint: '' }

  if (!hasStatic && !hasProjected) {
    return { canCompare, subHint: 'Run both first', titleHint: 'Run Static Background and Prospective Background first' }
  }
  if (!hasStatic) {
    return { canCompare, subHint: 'Run Static first', titleHint: 'Run Static Background first' }
  }
  return { canCompare, subHint: 'Run Prospective first', titleHint: 'Run Prospective Background first' }
}
