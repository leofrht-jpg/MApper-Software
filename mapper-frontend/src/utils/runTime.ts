/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * The computation time printed next to a result ("5.43s", "153.88s", "0.35s"). Two decimals; a time
 * below 0.01 s reads "<0.01s" rather than "0.00s", which says the work took no time. A result
 * served from the backend cache shows the time of the run that produced it, with " (cached)".
 * Returns null for a result with no time recorded (0 or missing): nothing is shown.
 */
export function formatRunTime(seconds: number | null | undefined, cached = false): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const text = seconds < 0.01 ? '<0.01s' : `${seconds.toFixed(2)}s`
  return cached ? `${text} (cached)` : text
}
