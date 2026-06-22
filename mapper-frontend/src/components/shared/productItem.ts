/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Patch 4AG.2 — shared ProductItem types mirroring the backend
// discriminated union from Patch 4AG.1. Each item carries enough
// metadata to render as a chip + recompute on its own; the
// `archetype_id` / `database`+`code` fields are the dispatch keys
// the backend `/lca/calculate-multi-product` endpoint reads.
//
// These types live in `components/shared/` rather than `api/client.ts`
// because they're consumed by UI surfaces (chip rendering, selector
// state) more often than by raw network calls. The wire shape is
// authoritative on the backend (`mapper-backend/mapper/models/schemas.py`
// ProductItem + variants); this file is the frontend's mirror.

export interface ArchetypeProductItem {
  type: 'archetype'
  archetype_id: string
  // Optional per-item overrides (forwarded to ArchetypeLCACalculateRequest
  // on the backend). Selector UI doesn't expose these in v1; future
  // patches may add per-item parameter scenario / stage amounts pickers.
  stage_amounts?: Record<string, number> | null
  parameter_scenario?: string | null
  // Display metadata — populated by the selector when emitting the
  // item, NOT round-tripped to the backend. The backend re-derives
  // names via _get_archetype.
  display_name: string
  folder?: string | null
}

export interface ActivityProductItem {
  type: 'activity'
  database: string
  code: string
  amount: number  // defaults to 1.0 at construction time
  // Display metadata — same caveat as archetype.
  display_name: string
  location?: string
  unit?: string
  // Patch 5M — discriminating fields so look-alike ecoinvent activities
  // (same reference product + location + unit) are tellable apart in the
  // selected/searched lists. `name` is the full activity name (distinct
  // production routes); `product` is the reference product (shown when it
  // differs from name). Display-only metadata, not round-tripped to the
  // backend (which re-derives from database+code).
  name?: string
  product?: string
  // Per-item-vintage model (multi-item comparison, activity mode): an activity
  // can appear at several vintages — base ecoinvent (static) and/or premise
  // SSP×year DBs. The vintage's DB IS `database` (so `productItemKey` is unique
  // per vintage); these fields carry the human-readable vintage + provenance
  // for labels, the wire `vintage_label`, and export. `vintage_label` is
  // 'ecoinvent' for static or e.g. 'SSP1 2040' for a premise vintage.
  vintage_label?: string
  base_database?: string   // the base ecoinvent the vintage derives from
  iam?: string | null      // premise vintages only
  ssp?: string | null      // premise vintages only
  year?: number | null     // premise vintages only
}

export type ProductItem = ArchetypeProductItem | ActivityProductItem

/** Stable id for keyed React rendering + parent-side dedup checks.
 *  Archetype: `arc:{archetype_id}`. Activity: `act:{database}|{code}`.
 *  The two namespaces never collide across the discriminated union. */
export function productItemKey(item: ProductItem): string {
  if (item.type === 'archetype') return `arc:${item.archetype_id}`
  return `act:${item.database}|${item.code}`
}
