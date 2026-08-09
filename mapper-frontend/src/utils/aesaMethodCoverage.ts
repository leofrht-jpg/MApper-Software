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
