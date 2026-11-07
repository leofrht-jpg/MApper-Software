/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/** What the Stage amounts panels say while no years are entered: the per-year stages count one year. */
export const ONE_YEAR_NOTE = 'Annual stages count 1 year'

/**
 * True when the run has per-year stages and every one of them is at x1 (no years entered, nothing
 * hand-edited), so the sentence above is exactly what the numbers do. `annualStages` is the list of
 * stages whose resolved basis is per year (the caller resolves it with `stageBasis`).
 */
export function annualStagesCountOneYear(
  annualStages: string[],
  entry: { lifetime: number | null; amounts: Record<string, number> },
): boolean {
  if (entry.lifetime != null) return false
  return annualStages.length > 0 && annualStages.every((s) => (entry.amounts[s] ?? 1) === 1)
}
