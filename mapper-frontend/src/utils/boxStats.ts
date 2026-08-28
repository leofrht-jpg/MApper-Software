/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Five-number summary shared by AESA's sharing-sensitivity box plot and the
 * Monte Carlo uncertainty box plot.
 *
 * Extracted from `BoxPlotView` rather than reimplemented: two quantile
 * functions that disagree at the interpolation boundary would put the same
 * data in visibly different boxes on two tabs, and the disagreement would only
 * show on small samples. Linear interpolation between order statistics, which
 * is what the AESA view has always used.
 */
export interface BoxStats {
  min: number
  q1: number
  median: number
  q3: number
  max: number
  values: number[]
}

export function boxStats(values: number[]): BoxStats {
  if (!values.length) return { min: 0, q1: 0, median: 0, q3: 0, max: 0, values: [] }
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: q(0.5),
    q1: q(0.25),
    q3: q(0.75),
    values: sorted,
  }
}

/**
 * Bin a sample into a histogram. Freedman-Diaconis bin width, falling back to
 * Sturges when the IQR is zero (every draw identical, which happens when
 * nothing carries uncertainty).
 */
export function histogram(values: number[], maxBins = 40): { x0: number; x1: number; count: number }[] {
  if (values.length < 2) return []
  const s = [...values].sort((a, b) => a - b)
  const lo = s[0]
  const hi = s[s.length - 1]
  if (!(hi > lo)) return []
  const st = boxStats(s)
  const iqr = st.q3 - st.q1
  const fd = iqr > 0 ? (2 * iqr) / Math.cbrt(s.length) : 0
  const nBins = fd > 0
    ? Math.min(maxBins, Math.max(5, Math.ceil((hi - lo) / fd)))
    : Math.min(maxBins, Math.max(5, Math.ceil(Math.log2(s.length) + 1)))
  const w = (hi - lo) / nBins
  const bins = Array.from({ length: nBins }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }))
  for (const v of s) {
    let idx = Math.floor((v - lo) / w)
    if (idx >= nBins) idx = nBins - 1
    if (idx < 0) idx = 0
    bins[idx].count += 1
  }
  return bins
}
