/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Reading a sharing principle's sparse year series, client-side.
 *
 * This mirrors `_resolve_year` in `mapper/models/aesa_schemas.py`. It exists
 * because the chain editor shows a live "Total factor" preview: if the two
 * resolutions disagree, the preview quietly lies about what Compute will do.
 * Keep the two in step — the rules are stated in both places on purpose.
 */
import type { LayerData, ResolutionMode } from '../api/client'

type YearData = Record<number, [number, number]>

/** Linear between anchors, clamped at both ends — no extrapolation.
 *  Same rule as the backend's `interpolate_anchors`. */
function interpolate(anchors: Array<[number, number]>, year: number): number {
  const pts = [...anchors].sort((a, b) => a[0] - b[0])
  if (year <= pts[0][0]) return pts[0][1]
  if (year >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]
  for (let i = 0; i < pts.length - 1; i++) {
    const [y0, v0] = pts[i]
    const [y1, v1] = pts[i + 1]
    if (y0 <= year && year <= y1) {
      const span = y1 - y0
      if (span === 0) return v0
      return v0 + ((year - y0) / span) * (v1 - v0)
    }
  }
  return pts[pts.length - 1][1]
}

/**
 * `(system, global)` at `year`, or null when the principle has no data.
 *
 * `mode` defaults to `'step'` — nearest year, ties favour older — which is
 * what every configuration written before the mode existed does.
 *
 * Under `'interpolate'` the system and global series are interpolated
 * SEPARATELY and then divided by the caller, not the other way round: the
 * stored values are quantities (population, GDP, area), so an interpolated
 * year must give the factor the user would have got by supplying that year's
 * two quantities. The ratio of two linear series is not itself linear.
 */
export function resolveYearPair(
  yearData: YearData | undefined | null,
  year: number,
  mode: ResolutionMode = 'step',
): [number, number] | null {
  if (!yearData) return null
  const keys = Object.keys(yearData).map(Number).filter((n) => Number.isFinite(n))
  if (keys.length === 0) return null
  if (yearData[year]) return yearData[year]
  if (keys.length === 1) return yearData[keys[0]]

  if (mode === 'interpolate') {
    return [
      interpolate(keys.map((y) => [y, yearData[y][0]] as [number, number]), year),
      interpolate(keys.map((y) => [y, yearData[y][1]] as [number, number]), year),
    ]
  }

  const nearest = keys.reduce((best, y) => {
    const d = Math.abs(y - year)
    const bd = Math.abs(best - year)
    if (d < bd) return y
    if (d === bd && y < best) return y
    return best
  }, keys[0])
  return yearData[nearest]
}

/** What one principle's data on one layer actually is — a constant or a
 *  series, over what span, read which way. Drives the chain-editor badges. */
export interface SeriesShape {
  principleId: string
  /** Number of years supplied. 1 means constant. */
  points: number
  firstYear: number
  lastYear: number
  /** False when a single year is supplied: the value is then a constant and
   *  the resolution mode cannot change any result. */
  isSeries: boolean
  mode: ResolutionMode
}

/**
 * Describe every principle carrying data on a layer, ordered by principle id
 * so the badges do not reshuffle between renders.
 *
 * A chain mixing a moving EpC with a frozen AR is a legitimate methodological
 * choice; it is only a mistake when it is accidental. Hence: surface it,
 * never warn on it.
 */
export function describeLayerSeries(
  data: LayerData | undefined | null,
  resolution?: Record<string, ResolutionMode> | null,
): SeriesShape[] {
  if (!data) return []
  const out: SeriesShape[] = []
  for (const principleId of Object.keys(data).sort()) {
    const years = Object.keys(data[principleId] ?? {})
      .map(Number).filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
    if (years.length === 0) continue
    out.push({
      principleId,
      points: years.length,
      firstYear: years[0],
      lastYear: years[years.length - 1],
      isSeries: years.length > 1,
      mode: resolution?.[principleId] ?? 'step',
    })
  }
  return out
}

/** Compact badge text, e.g. "2025–2050 · 6 pts · interpolate" or
 *  "2025 · single value". Kept out of the component so the wording is
 *  testable without rendering. */
export function seriesBadgeText(s: SeriesShape): string {
  if (!s.isSeries) return `${s.firstYear} · single value`
  return `${s.firstYear}–${s.lastYear} · ${s.points} pts · ${s.mode}`
}
