/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '../stores/projectStore'

// Categorical palette for LCI scenarios in multi-scenario charts (Patch 2B).
// Okabe-Ito colorblind-safe set, deliberately distinct from CHART_PALETTE so a
// user mentally mapping colors across views (cohorts → scenarios) doesn't get
// false correspondences. Black and yellow dropped — black collides with text,
// yellow has poor contrast on light backgrounds. 6 colors covers the
// faceted-view cap (≤6 scenarios); the 7th wraps via modulo for the Total view
// which has no hard cap.
export const SCENARIO_PALETTE: readonly string[] = [
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#009E73', // bluish green
  '#CC79A7', // reddish purple
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#7F7F7F', // grey (overflow, neutral)
]

// Case-study-agnostic palette. 40 visually distinct hues — works whether the
// series are fuel types, material names, building typologies, or anything else.
// Patch 4AK: expanded from 20 → 40 to support light/dark curation. Layout
// is 20 base hues × 2 shades (light + dark) interleaved so adjacent slots in
// the picker grid form a base/dark pair on every other row.
export const CHART_PALETTE: readonly string[] = [
  // Row 1 — base hues
  '#8b5cf6', // purple
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#ef4444', // red
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f97316', // orange
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  // Row 2 — darker shades of row 1
  '#6d28d9', // dark purple
  '#0f766e', // dark teal
  '#b45309', // dark amber
  '#991b1b', // dark red
  '#1d4ed8', // dark blue
  '#047857', // dark emerald
  '#c2410c', // dark orange
  '#be185d', // dark pink
  '#0e7490', // dark cyan
  '#4d7c0f', // dark lime
  // Row 3 — secondary base hues
  '#f43f5e', // rose
  '#a78bfa', // light purple
  '#2dd4bf', // light teal
  '#fbbf24', // yellow
  '#dc2626', // dark red 2
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#d946ef', // fuchsia
  '#22d3ee', // light cyan
  '#fb923c', // light orange
  // Row 4 — darker shades of row 3
  '#9f1239', // dark rose
  '#7c3aed', // deep purple
  '#0d9488', // deep teal
  '#d97706', // deep yellow
  '#7f1d1d', // maroon
  '#4338ca', // deep indigo
  '#0369a1', // deep sky
  '#a21caf', // deep fuchsia
  '#0891b2', // deep cyan 2
  '#ea580c', // deep orange
]

type ColorMap = Record<string, string>

const STORAGE_PREFIX = 'mapper-color-assignments'
const DEFAULT_SCOPE = '_global'

function storageKey(scope: string | null | undefined): string {
  return `${STORAGE_PREFIX}-${scope || DEFAULT_SCOPE}`
}

function readStored(scope: string | null | undefined): ColorMap {
  try {
    const raw = localStorage.getItem(storageKey(scope))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as ColorMap) : {}
  } catch {
    return {}
  }
}

function writeStored(scope: string | null | undefined, map: ColorMap): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(map))
  } catch {
    // localStorage may be unavailable (private browsing, quota) — non-fatal.
  }
}

// Patch 4AJ — user-set color overrides on the per-project color map.
//
// The original Patch 4N flow was "labels in → algorithm-derived colors
// out, persisted alphabetically." Patch 4AJ adds the ability to
// override individual entries (e.g. user sets BEV-LFP to a specific
// teal); the override lives in the SAME localStorage map (no new
// persistence layer). Algorithm fallback continues to handle labels
// without explicit overrides.
//
// React reactivity: localStorage writes don't trigger React re-renders
// by default. The setters dispatch a custom DOM event that
// `useChartColors` listens for; consumers re-read the map and re-paint.

// Patch 4AK³ — canonical hex normalisation. All write boundaries
// (`setLabelColor`, `setRowColor`, ...) MUST run color values through
// this before persisting so equality checks across sources never
// collapse on case mismatch (Excel uploads uppercase, picker emits
// lowercase, hex input may be either). Lowercase is the canonical form.
//
// Non-hex values (named colors, CSS vars, sentinels like 'auto') pass
// through unchanged — the function is only a no-op safe guard for
// callers; rejection of invalid hex happens upstream in
// _normalize_color (backend) or in DimensionColorPicker (frontend).
export function normalizeHex(color: string): string {
  if (typeof color !== 'string') return color
  const m = /^#[0-9a-fA-F]{6}$/.exec(color.trim())
  return m ? color.trim().toLowerCase() : color
}

const COLOR_CHANGE_EVENT = 'mapper-color-changed'

// Parallel-key marker storage: tracks which labels in the color map
// were set explicitly by the user (vs. assigned by the algorithm).
// Lets the picker's "Reset to auto" button distinguish "no override"
// from "override exists." Stored as a JSON array of label strings under
// `mapper-color-overrides-<scope>`.
const OVERRIDES_PREFIX = 'mapper-color-overrides'

function overridesKey(scope: string | null | undefined): string {
  return `${OVERRIDES_PREFIX}-${scope || DEFAULT_SCOPE}`
}

function readOverrides(scope: string | null | undefined): Set<string> {
  try {
    const raw = localStorage.getItem(overridesKey(scope))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function writeOverrides(scope: string | null | undefined, set: Set<string>): void {
  try {
    localStorage.setItem(overridesKey(scope), JSON.stringify(Array.from(set)))
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Returns the set of label strings that have explicit user-set color
 * overrides in the given scope (default: active project). Used by UI
 * affordances that need to distinguish overridden from auto-assigned.
 *
 * Patch 4AJ.
 */
export function getOverriddenLabels(scope?: string | null): Set<string> {
  return readOverrides(scope)
}

/**
 * Read the currently-stored color for a single label (or undefined if the
 * label has no entry). Used by upload-derivation reconciliation to tell whether
 * a previously-derived color is still in place (vs. manually re-picked since).
 */
export function getStoredLabelColor(label: string, scope?: string | null): string | undefined {
  return readStored(scope)[label]
}

interface ColorChangeDetail {
  scope: string | null | undefined
}

function emitColorChange(scope: string | null | undefined): void {
  try {
    window.dispatchEvent(new CustomEvent<ColorChangeDetail>(
      COLOR_CHANGE_EVENT, { detail: { scope } },
    ))
  } catch {
    // jsdom older versions don't support CustomEvent constructor; ignore.
  }
}

/**
 * Set or update a single label's color override.
 *
 * Writes through to the same per-project (or scope-overridden)
 * localStorage map that `useChartColors` reads. Triggers a re-render
 * for every active `useChartColors` consumer in the matching scope.
 *
 * Patch 4AJ.
 */
export function setLabelColor(
  label: string,
  color: string,
  scope?: string | null,
): void {
  // Patch 4AK³ — canonicalise on write so localStorage never carries
  // mixed-case duplicates (#FFFFFF and #ffffff would otherwise read as
  // different by `cur[label] === color`).
  const normalized = normalizeHex(color)
  const cur = readStored(scope)
  const overrides = readOverrides(scope)
  // Mark as user-set regardless of whether the color is changing — the
  // pure-write case (same color as algorithm assigned) still flips
  // "this is now an override."
  const overridesChanged = !overrides.has(label)
  overrides.add(label)
  if (overridesChanged) writeOverrides(scope, overrides)
  if (cur[label] === normalized) {
    if (overridesChanged) emitColorChange(scope)
    return
  }
  const next: ColorMap = { ...cur, [label]: normalized }
  writeStored(scope, next)
  emitColorChange(scope)
}

/**
 * Remove a label's color override, restoring the algorithm's
 * deterministic assignment on the next `useChartColors` read.
 *
 * Patch 4AJ.
 */
export function clearLabelColor(label: string, scope?: string | null): void {
  const cur = readStored(scope)
  const overrides = readOverrides(scope)
  const hadOverride = overrides.delete(label)
  if (hadOverride) writeOverrides(scope, overrides)
  if (!(label in cur)) {
    if (hadOverride) emitColorChange(scope)
    return
  }
  const next: ColorMap = { ...cur }
  delete next[label]
  writeStored(scope, next)
  emitColorChange(scope)
}

// Deterministic color assignment for a set of labels.
//
// Rules:
//  - Labels already assigned in the persistent map keep their color.
//  - New labels are assigned alphabetically — the first unseen label takes
//    the next unused palette slot, and so on. This means reloading with the
//    same label set produces the same colors, and adding one new label only
//    colors that new label (it doesn't reshuffle the rest).
//  - The palette wraps once every slot is occupied; that's fine for large
//    series counts since wrap-around is still deterministic.
export function assignColors(
  labels: Iterable<string>,
  previous: ColorMap = {},
): ColorMap {
  const unique = Array.from(new Set(labels))
  const next: ColorMap = { ...previous }
  const used = new Set(Object.values(next))

  const fresh = unique
    .filter((l) => !(l in next))
    .sort((a, b) => a.localeCompare(b))

  let cursor = 0
  for (const label of fresh) {
    // Find the next palette color not already used; if we've exhausted the
    // palette, fall back to plain modulo indexing.
    let color: string | null = null
    for (let step = 0; step < CHART_PALETTE.length; step++) {
      const candidate = CHART_PALETTE[(cursor + step) % CHART_PALETTE.length]
      if (!used.has(candidate)) {
        color = candidate
        cursor = (cursor + step + 1) % CHART_PALETTE.length
        break
      }
    }
    if (!color) color = CHART_PALETTE[Object.keys(next).length % CHART_PALETTE.length]
    next[label] = color
    used.add(color)
  }

  return next
}

// React hook: returns a stable color map for the given labels, persisted per
// active project. Pass the full set of labels each render — new ones slot in,
// existing ones keep their color.
export function useChartColors(labels: Iterable<string>, scopeOverride?: string): ColorMap {
  const currentProject = useProjectStore((s) => s.currentProject)
  const scope = scopeOverride ?? currentProject

  // Patch 4AJ — tick advances on every color-change event for this
  // scope; included in the memo deps so consumers re-read the
  // localStorage map when a user override is set / cleared via
  // `setLabelColor` / `clearLabelColor`. Without this, localStorage
  // writes wouldn't trigger React re-renders.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ColorChangeDetail>).detail
      const eventScope = detail?.scope ?? null
      const consumerScope = scope ?? null
      if (eventScope === consumerScope) setTick((t) => t + 1)
    }
    window.addEventListener(COLOR_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(COLOR_CHANGE_EVENT, onChange)
  }, [scope])

  // Recompute whenever the label set changes. Stored map is the source of
  // truth for previously-seen labels.
  const labelKey = useMemo(() => {
    const unique = Array.from(new Set(labels))
    unique.sort()
    return unique.join('\u0001')
  }, [labels])

  return useMemo(() => {
    const stored = readStored(scope)
    const next = assignColors(labelKey ? labelKey.split('\u0001') : [], stored)
    // Only write back if we added new labels.
    if (Object.keys(next).length !== Object.keys(stored).length) {
      writeStored(scope, next)
    }
    return next
    // `tick` is intentionally a dep — it forces re-read on
    // color-change events even when labelKey + scope are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelKey, scope, tick])
}

// Convenience: look up a color for a single label, falling back to a
// palette-indexed color if the label isn't in the map yet.
export function colorFor(map: ColorMap, label: string, fallbackIndex = 0): string {
  return map[label] ?? CHART_PALETTE[fallbackIndex % CHART_PALETTE.length]
}
