/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Method → planetary-boundary coverage, in the two units that matter.
 *
 * The old counter read "15 methods mapped · 10 unmapped", which reads as ten
 * errors. It is not: with EF v3.1 installed, 25 methods map onto 16 Sala
 * boundaries, and most of the unmapped ones SHOULD be unmapped. EF publishes
 * aggregates alongside their decompositions — `climate change` next to
 * `climate change: fossil` / `: biogenic` / `: land use and land use change`,
 * `human toxicity: carcinogenic` next to its `, organics` / `, inorganics`
 * halves. Characterising a boundary against one slice of its own aggregate is
 * methodologically wrong, and mapping several rows to one boundary makes them
 * collide on (year, pb_id). `suggest_method_mapping` matches exactly, on
 * purpose, and leaves the sub-components alone.
 *
 * So a method having no boundary is usually correct. What is NOT visible in
 * method terms is the thing that actually matters: whether every BOUNDARY has
 * a method. A boundary with none is silently absent from every SR, radar and
 * timeline — no warning, just one fewer row.
 *
 * This computes both, and splits the unmapped methods into "expected" and
 * "unrecognised" so the number that needs attention is the small one.
 *
 * It classifies; it never invents a mapping. A sub-component is identified
 * structurally — a MAPPED indicator is a prefix of it, on EF's own `: ` or
 * `, ` separator — not from a hand-written list that would rot as EF changes.
 */

export interface MethodTupleLike {
  method: readonly string[]
}

export interface MappingLike {
  method_tuple: readonly string[]
  pb_id: string
  /** Optional on the wire; the backend defaults it to 1.0 and always writes
   *  it to the workbook, so an absent value means 1. */
  conversion_factor?: number
}

export interface UnmappedMethod {
  /** The full method tuple, as installed. */
  tuple: readonly string[]
  /** The indicator segment — `method[1]`, what the mapping matches on. */
  indicator: string
  /**
   * The mapped indicator this one decomposes, when it is a sub-component.
   * `null` means nothing recognised it: either the boundary set's
   * `ef_indicator` does not match the installed method's name, or the method
   * genuinely lies outside the boundary set.
   */
  parent: string | null
}

export interface MethodCoverage {
  /** Boundaries in the active set that have at least one method mapped. */
  boundariesCovered: number
  boundariesTotal: number
  /** Boundary ids with no method — the gap that changes results. */
  uncoveredBoundaryIds: string[]
  methodsMapped: number
  methodsTotal: number
  /** Unmapped methods that decompose a mapped aggregate — expected. */
  expectedUnmapped: UnmappedMethod[]
  /** Unmapped methods nothing recognised — the actionable ones. */
  unrecognised: UnmappedMethod[]
}

const key = (t: readonly string[]) => t.join(' | ')

/**
 * True when `indicator` is a decomposition of `parent` under EF's naming.
 *
 * EF separates a sub-component from its aggregate with `: ` (climate change:
 * fossil) or `, ` (human toxicity: carcinogenic, organics). Requiring the
 * separator matters: without it `land use` would swallow any indicator merely
 * starting with those letters.
 */
export function isSubComponentOf(indicator: string, parent: string): boolean {
  if (indicator === parent) return false
  return indicator.startsWith(`${parent}: `) || indicator.startsWith(`${parent}, `)
}

export function computeMethodCoverage(
  methods: readonly MethodTupleLike[],
  mappings: readonly MappingLike[],
  boundaryIds: readonly string[],
): MethodCoverage {
  const mappedTuples = new Set(mappings.map((m) => key(m.method_tuple)))
  const mappedIndicators = mappings
    .map((m) => m.method_tuple[1])
    .filter((s): s is string => !!s)
  const coveredPbs = new Set(mappings.map((m) => m.pb_id))

  const expectedUnmapped: UnmappedMethod[] = []
  const unrecognised: UnmappedMethod[] = []

  for (const m of methods) {
    if (mappedTuples.has(key(m.method))) continue
    const indicator = m.method[1] ?? ''
    const parent = mappedIndicators.find((p) => isSubComponentOf(indicator, p)) ?? null
    const entry: UnmappedMethod = { tuple: m.method, indicator, parent }
    ;(parent ? expectedUnmapped : unrecognised).push(entry)
  }

  return {
    boundariesCovered: boundaryIds.filter((id) => coveredPbs.has(id)).length,
    boundariesTotal: boundaryIds.length,
    uncoveredBoundaryIds: boundaryIds.filter((id) => !coveredPbs.has(id)),
    methodsMapped: mappings.length,
    methodsTotal: methods.length,
    expectedUnmapped,
    unrecognised,
  }
}

// ── Expanded view ───────────────────────────────────────────────────────────
//
// The counter says how many; this says WHICH. A user cannot check a mapping
// they cannot see, and neither can a reviewer.

/** A boundary as the mapping table needs it — structural, so this module stays
 *  free of API types and testable with plain objects. */
export interface BoundaryLike {
  name: string
  short_name?: string | null
  boundary_type?: string | null
}

export interface MappedMethodRow {
  pb_id: string
  /** The boundary this mapping targets, or `null` when the active set defines
   *  no such id — an ORPHAN. Surfaced, never dropped: it is in the config and
   *  in the workbook, so hiding it here would make the two disagree. */
  boundary: BoundaryLike | null
  tuple: readonly string[]
  conversion_factor: number
  /** Another mapping targets the same boundary. Both are written to the
   *  workbook and both reach compute, where they collide on (year, pb_id) —
   *  one silently wins. Worth flagging where it can be seen. */
  duplicate: boolean
}

/** Sub-components of one mapped aggregate, kept under it. */
export interface ExpectedUnmappedGroup {
  /** The mapped aggregate indicator they decompose, e.g. "climate change". */
  parent: string
  members: UnmappedMethod[]
}

export interface MappingTable {
  mapped: MappedMethodRow[]
  expectedGroups: ExpectedUnmappedGroup[]
  unrecognised: UnmappedMethod[]
  /** Boundaries with no mapping — absent from every SR, radar and timeline. */
  uncovered: Array<{ pb_id: string; boundary: BoundaryLike }>
}

/**
 * The rows the expanded Method → PB section renders.
 *
 * Driven by the MAPPINGS, not by the boundary set. That ordering of concerns
 * is the point: iterating boundaries would silently drop a mapping whose
 * `pb_id` the active set does not define, and would show only one of two
 * mappings competing for the same boundary — while the AESACFG workbook writes
 * every row of `method_mapping`. The UI and the workbook must show the same
 * facts, or editing the workbook and looking at the UI teaches the user
 * something false.
 *
 * Presentation order follows the boundary set, so the table scans like the
 * category-assignments table beneath it; orphans come last. Order is the only
 * difference from the workbook, which preserves mapping order for round-trip
 * stability.
 */
export function buildMappingTable(
  mappings: readonly MappingLike[],
  boundaries: Readonly<Record<string, BoundaryLike>> | null | undefined,
  coverage: MethodCoverage | null,
): MappingTable {
  // A boundary set can arrive without its boundaries — a summary record from a
  // partial payload, or a set still loading. Every mapping is then an orphan
  // relative to it, which is the honest reading; crashing the sidebar is not.
  const bset: Readonly<Record<string, BoundaryLike>> = boundaries ?? {}
  const order = Object.keys(bset)
  const perPb = new Map<string, number>()
  for (const m of mappings) perPb.set(m.pb_id, (perPb.get(m.pb_id) ?? 0) + 1)

  const rows: MappedMethodRow[] = mappings.map((m) => ({
    pb_id: m.pb_id,
    boundary: bset[m.pb_id] ?? null,
    tuple: m.method_tuple,
    conversion_factor: m.conversion_factor ?? 1,
    duplicate: (perPb.get(m.pb_id) ?? 0) > 1,
  }))

  const rank = (r: MappedMethodRow) => {
    const i = order.indexOf(r.pb_id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i     // orphans last
  }
  rows.sort((a, b) => rank(a) - rank(b))

  // Group the expected-unmapped by the aggregate they decompose. `parent` is
  // non-null for every member of `expectedUnmapped` by construction.
  const groups = new Map<string, UnmappedMethod[]>()
  for (const u of coverage?.expectedUnmapped ?? []) {
    const p = u.parent ?? ''
    if (!groups.has(p)) groups.set(p, [])
    groups.get(p)!.push(u)
  }

  const mappedPbs = new Set(mappings.map((m) => m.pb_id))

  return {
    mapped: rows,
    expectedGroups: [...groups.entries()]
      .map(([parent, members]) => ({ parent, members }))
      .sort((a, b) => a.parent.localeCompare(b.parent)),
    unrecognised: coverage?.unrecognised ?? [],
    uncovered: order
      .filter((id) => !mappedPbs.has(id))
      .map((id) => ({ pb_id: id, boundary: bset[id] })),
  }
}

/**
 * Collapsed-header summary. Leads with boundary coverage, because that is the
 * number whose shortfall changes what AESA computes.
 */
export function coverageSummary(c: MethodCoverage): string {
  if (c.methodsTotal === 0) return `${c.methodsMapped} mapped`
  const boundaries = `${c.boundariesCovered}/${c.boundariesTotal} boundaries`
  const methods = `${c.methodsMapped}/${c.methodsTotal} methods`
  return c.unrecognised.length > 0
    ? `${boundaries} · ${methods} · ${c.unrecognised.length} unrecognised`
    : `${boundaries} · ${methods}`
}
