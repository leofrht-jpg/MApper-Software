/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Pure helpers for year-varying (keyframe) parameters — the frontend mirror of
// the backend resolve_parameter / _interpolate_keyframes (Phase 1). Used by the
// keyframe editor's live trajectory preview and the p_bp composed-rate preview.

import type { Archetype, Parameter, ParameterKeyframe } from '../api/client'
import { BASE_SCENARIO } from '../api/client'

// Simulation horizon for keyframe validation + preview (Phase 0 confirmed).
export const HORIZON_START = 2025
export const HORIZON_END = 2050

/** Linear interpolation between keyframe anchors, clamped outside the range
 *  (no extrapolation) — byte-for-byte the backend `_interpolate_keyframes`. */
export function interpolateKeyframes(keyframes: ParameterKeyframe[], year: number): number {
  const kf = [...keyframes].sort((a, b) => a.year - b.year)
  if (kf.length === 0) return 0
  if (year <= kf[0].year) return kf[0].value
  if (year >= kf[kf.length - 1].year) return kf[kf.length - 1].value
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i]
    const b = kf[i + 1]
    if (a.year <= year && year <= b.year) {
      const span = b.year - a.year
      if (span === 0) return a.value
      const t = (year - a.year) / span
      return a.value + t * (b.value - a.value)
    }
  }
  return kf[kf.length - 1].value
}

/** Frontend mirror of the backend `resolve_parameter`: a scalar
 *  scenario_override wins flat; otherwise the keyframe trajectory at `year`;
 *  otherwise base_value. */
export function resolveParameterAtYear(
  p: Parameter, scenario: string | null, year: number,
): number {
  if (scenario && scenario !== BASE_SCENARIO) {
    const ov = p.scenario_overrides?.[scenario]
    if (ov !== undefined && ov !== null) return ov
  }
  if (p.keyframes && p.keyframes.length > 0) return interpolateKeyframes(p.keyframes, year)
  return p.base_value
}

/** Per-year resolved values across the horizon — the trajectory preview series. */
export function trajectorySeries(
  keyframes: ParameterKeyframe[],
  start = HORIZON_START, end = HORIZON_END,
): Array<{ year: number; value: number }> {
  const out: Array<{ year: number; value: number }> = []
  for (let y = start; y <= end; y++) out.push({ year: y, value: interpolateKeyframes(keyframes, y) })
  return out
}

/** LR_factor(material, year) = (1 + learning_rate)^(year - base_year). */
export function lrFactor(learningRate: number, baseYear: number, year: number): number {
  return Math.pow(1 + learningRate, year - baseYear)
}

// ── Keyframe row validation (2025–2050, ≥2 rows, integer years, no dups) ─────

export interface KeyframeRow {
  year: string
  value: string
}

export interface KeyframeValidation {
  valid: boolean
  errors: string[]              // global errors (min-count, duplicates)
  rowErrors: Record<number, string>  // per-row-index errors
}

export function validateKeyframeRows(rows: KeyframeRow[]): KeyframeValidation {
  const errors: string[] = []
  const rowErrors: Record<number, string> = {}
  if (rows.length < 2) errors.push('At least 2 keyframes are required.')

  const seenYears = new Map<number, number>()  // year → first row index
  rows.forEach((r, i) => {
    const yStr = r.year.trim()
    const vStr = r.value.trim()
    if (yStr === '' || vStr === '') {
      rowErrors[i] = 'Year and value are required.'
      return
    }
    const y = Number(yStr)
    const v = Number(vStr)
    if (!Number.isInteger(y)) {
      rowErrors[i] = 'Year must be a whole number.'
      return
    }
    if (y < HORIZON_START || y > HORIZON_END) {
      rowErrors[i] = `Year must be within ${HORIZON_START}–${HORIZON_END}.`
      return
    }
    if (!Number.isFinite(v)) {
      rowErrors[i] = 'Value must be a number.'
      return
    }
    if (seenYears.has(y)) {
      rowErrors[i] = `Duplicate year ${y}.`
      const first = seenYears.get(y)!
      if (rowErrors[first] === undefined) rowErrors[first] = `Duplicate year ${y}.`
    } else {
      seenYears.set(y, i)
    }
  })

  const valid = errors.length === 0 && Object.keys(rowErrors).length === 0
  return { valid, errors, rowErrors }
}

/** Rows sorted by numeric year for display; blank/NaN years sink to the bottom
 *  (kept stable so an in-progress blank row doesn't jump around). */
export function sortRowsByYear<T extends KeyframeRow>(rows: T[]): T[] {
  const keyed = rows.map((r, i) => ({ r, i }))
  keyed.sort((a, b) => {
    const ya = Number(a.r.year.trim())
    const yb = Number(b.r.year.trim())
    const na = a.r.year.trim() === '' || !Number.isFinite(ya)
    const nb = b.r.year.trim() === '' || !Number.isFinite(yb)
    if (na && nb) return a.i - b.i
    if (na) return 1
    if (nb) return -1
    if (ya !== yb) return ya - yb
    return a.i - b.i
  })
  return keyed.map((k) => k.r)
}

// ── p_bp composed-rate reference materials ──────────────────────────────────

export interface LeverReferenceMaterial {
  archetypeName: string
  nodeName: string
  learningRate: number
  baseYear: number
}

/** Walk every archetype's BOM for nodes that opt into `leverName` AND carry a
 *  learning_rate evolution — the candidate reference materials for the p_bp
 *  composed-rate preview. */
export function findLeverReferenceMaterials(
  archetypes: Archetype[], leverName: string,
): LeverReferenceMaterial[] {
  const out: LeverReferenceMaterial[] = []
  const walk = (nodes: Archetype['bom'] | null | undefined, arcName: string) => {
    for (const n of nodes ?? []) {
      const ev = n.evolution
      if (
        n.global_levers?.includes(leverName) &&
        ev?.method === 'learning_rate' &&
        ev.learning_rate !== undefined && ev.learning_rate !== null
      ) {
        out.push({
          archetypeName: arcName, nodeName: n.name,
          learningRate: ev.learning_rate, baseYear: ev.base_year,
        })
      }
      if (n.children) walk(n.children, arcName)
    }
  }
  for (const a of archetypes) walk(a.bom, a.name)
  return out
}
