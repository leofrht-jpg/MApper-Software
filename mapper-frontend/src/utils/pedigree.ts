/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useState } from 'react'
import { getPedigreeTable, type PedigreeTable } from '../api/client'

/**
 * Pedigree maths for the scoring UI's live preview.
 *
 * The FACTORS are never hard-coded here — they arrive from `GET /lca/pedigree`,
 * which serves `mapper.core.pedigree`. One table, so a foreground score and a
 * background exchange can never end up on two different matrices. A second copy
 * would drift silently: both would keep producing plausible GSD² values.
 *
 * The composition rule is duplicated, and deliberately: it is three lines, it
 * is pinned on both sides, and a round-trip to the backend on every keystroke
 * to preview a number is not worth it. `pedigreeMathMatchesBackend` in the
 * tests checks the two agree against the served table.
 */

export type PedigreeScores = Record<string, number>

/** σᵢ² = [ln(fᵢ)/2]² — the factor is a 95% RANGE, hence the /2. Dropping it
 *  inflates every factor by ~30% and the result stays plausible. */
export function varianceContribution(table: PedigreeTable, indicator: string, score: number): number {
  const factors = table.factors[indicator]
  if (!factors || score < 1 || score > 5) return 0
  const f = factors[score - 1]
  return Math.pow(Math.log(f) / 2, 2)
}

/** σ_total² = σ_basic² + Σᵢ σᵢ² — ecoinvent's own composition rule. */
export function totalSigma(
  table: PedigreeTable,
  scores: PedigreeScores | null | undefined,
  basicVariance: number,
): number {
  let v = Math.max(basicVariance, 0)
  for (const [ind, sc] of Object.entries(scores ?? {})) {
    v += varianceContribution(table, ind, sc)
  }
  return Math.sqrt(v)
}

/** GSD² = exp(2σ) — the 95% range multiplier a practitioner reads directly. */
export function gsd2FromSigma(sigma: number): number {
  return Math.exp(2 * sigma)
}

export function gsd2Of(
  table: PedigreeTable,
  scores: PedigreeScores | null | undefined,
  basicVariance: number,
): number {
  return gsd2FromSigma(totalSigma(table, scores, basicVariance))
}

/** Short label for a score set, e.g. "3,2,4,3,1". Empty when unscored. */
export function scoreSummary(table: PedigreeTable, scores: PedigreeScores | null | undefined): string {
  if (!scores || Object.keys(scores).length === 0) return ''
  return table.indicators.map((i) => scores[i] ?? 1).join(',')
}

let cached: PedigreeTable | null = null

/** Fetch-once hook. The table is a build-time constant on the backend, so
 *  there is nothing to invalidate. */
export function usePedigreeTable(): PedigreeTable | null {
  const [table, setTable] = useState<PedigreeTable | null>(cached)
  useEffect(() => {
    if (cached) return
    let alive = true
    void getPedigreeTable()
      .then((t) => {
        cached = t
        if (alive) setTable(t)
      })
      .catch(() => { /* the editor degrades to no live preview */ })
    return () => { alive = false }
  }, [])
  return table
}

/** Test seam — the module-level cache would otherwise leak between tests. */
export function __resetPedigreeCache() {
  cached = null
}
