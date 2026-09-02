/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Patch 4AG.3 — store for the multi-product LCA comparison feature.
//
// Standalone (NOT extending useSingleProductImpactStore) — different
// concerns: single-product carries archetype-scoped per-arc state
// (stage amounts, results-by-arc, Static/Projected inheritance);
// multi-product carries a flat selection list + a single result
// envelope. Mixing them would tangle the discriminator-union
// backend pattern (Patch 4AG.1) with single-axis frontend
// assumptions.
//
// State is in-memory only; saved-sessions / template-save for
// multi-item comparisons is deferred per the Patch 4AG out-of-scope
// list.

import { create } from 'zustand'
import {
  type MultiProductLCAResult,
  type MultiProductRequestItem,
  calculateMultiProductLCA,
} from '../api/client'
import {
  type ActivityProductItem,
  type ArchetypeProductItem,
  type ProductItem,
  productItemKey,
} from '../components/shared/productItem'
import type { ArchetypeStageAmounts } from './singleProductImpactStore'

interface MultiProductLCAState {
  // Selection — order preserved (chart rendering relies on it).
  selectedItems: ProductItem[]
  // Per-item stage amounts, keyed by productItemKey (archetype items only).
  // Reuses the Single-item ArchetypeStageAmounts type per entry. Reconciled
  // against the live selection (seed on add, prune on remove) by the panel —
  // NOT a parallel copy of selectedItems. At compute, each entry's `amounts`
  // is injected into the wire item's stage_amounts (same field the
  // single-product path uses).
  stageAmountsByItem: Record<string, ArchetypeStageAmounts>
  // Last-compute envelope; null before first compute / after reset.
  multiResult: MultiProductLCAResult | null
  // Vintage coords (iam/ssp/year/…) SNAPSHOTTED at compute time from the
  // activity items that were run, keyed by item_id ("{database}|{code}"). This
  // is the results-aligned source for the Line chart + Line-availability gate +
  // export — NOT the live `selectedItems` (which can change/clear after a run,
  // e.g. on a mode switch, and would wrongly disable Line on line-able results).
  multiVintageCoords: VintageCoordMap | null
  multiLoading: boolean
  // Top-level error (the whole POST failed). DISTINCT from per-item
  // errors, which live inside multiResult.items[].error_message.
  // Partial-success runs (some items succeed, some fail) populate
  // multiResult AND leave multiError null.
  multiError: string | null

  addItem: (item: ProductItem) => void
  // Set one item's stage amounts (per-item override from its editor).
  setItemStageAmounts: (key: string, value: ArchetypeStageAmounts) => void
  // Replace the whole map (reconcile seed/prune + global apply-to-all).
  setStageAmountsMap: (map: Record<string, ArchetypeStageAmounts>) => void
  removeItem: (item: ProductItem) => void
  clearItems: () => void
  // Clear the last-compute results (envelope + coords snapshot + top-level
  // error). Used on a within-type mode switch so a stale cross-mode chart
  // can't linger after the selection clears.
  clearResults: () => void
  /** case name -> the full envelope for that case. Always contains 'Base'. */
  multiByCase: Record<string, MultiProductLCAResult> | null
  /** Cases actually run, in selection order, Base first. */
  multiCaseOrder: string[]
  compute: (params: {
    scope: 'inflows' | 'stock' | 'outflows' | 'all'
    methods: string[][]
    /**
     * DEAD — declared, threaded to `compute_database`, never passed by any
     * caller. `handleCompute` sends only `{scope, methods, cases}`.
     *
     * KEPT DELIBERATELY. It is the only trace in the code that this path was
     * expected to carry a background, and that expectation is load-bearing:
     * a background selector here would make prospective Monte Carlo reachable
     * from the UI, and premise databases carry NO exchange uncertainty
     * (0% usable `scale`, 78% NaN) — so a prospective MC would report a
     * near-zero spread that reads as confidence rather than missing data.
     * See CLAUDE.md, "Prospective Monte Carlo is UNREACHABLE". Settle that
     * before wiring this.
     */
    computeDatabase?: string | null
    /** Sensitivity cases to run. Absent/empty = Base only. */
    cases?: string[]
  }) => Promise<void>
  reset: () => void
}

// Results-aligned vintage coords (mirrors the activity item's structured
// fields). Keyed by item_id ("{database}|{code}"). Structurally compatible with
// MultiProductLineChart's VintageCoord and the export's activity_vintage_meta.
export type VintageCoordMap = Record<string, {
  label: string
  database: string
  base_database?: string | null
  iam?: string | null
  ssp?: string | null
  year?: number | null
}>

// Convert the UI-side ProductItem (which carries display metadata
// the chips need) to the wire-shape MultiProductRequestItem (which
// the backend re-derives names from). Display metadata stays in
// `selectedItems` for chip rendering; wire payload is the minimum
// the backend needs for dispatch.
function toWireItem(
  item: ProductItem,
  stageAmountsByItem: Record<string, ArchetypeStageAmounts>,
  /** Sensitivity case for this run. 'Base' resolves the table's base values. */
  parameterScenario: string = 'Base',
): MultiProductRequestItem {
  if (item.type === 'archetype') {
    const arc = item as ArchetypeProductItem
    // Per-item stage amounts come from the reconciled map (the editor's
    // source of truth); fall back to any amounts pinned on the item itself.
    const amounts = stageAmountsByItem[productItemKey(item)]?.amounts ?? arc.stage_amounts ?? null
    return {
      type: 'archetype',
      archetype_id: arc.archetype_id,
      stage_amounts: amounts,
      parameter_scenario: parameterScenario,
    }
  }
  const act = item as ActivityProductItem
  return {
    type: 'activity',
    database: act.database,
    code: act.code,
    amount: act.amount,
    // Per-item-vintage: the DB IS the vintage (act.database); the label is
    // composed into the result label by the backend so vintages don't collide.
    vintage_label: act.vintage_label ?? null,
  }
}

export const useMultiProductLCAStore = create<MultiProductLCAState>((set, get) => ({
  selectedItems: [],
  stageAmountsByItem: {},
  multiResult: null,
  multiVintageCoords: null,
  multiByCase: null,
  multiCaseOrder: [],
  multiLoading: false,
  multiError: null,

  setItemStageAmounts: (key, value) => set((s) => ({
    stageAmountsByItem: { ...s.stageAmountsByItem, [key]: value },
  })),

  setStageAmountsMap: (map) => set({ stageAmountsByItem: map }),

  addItem: (item) => set((s) => {
    // Idempotent — adding an already-selected item is a no-op
    // rather than a duplicate. The selector enforces this via
    // its selected-state check, but the store guards too.
    const key = productItemKey(item)
    if (s.selectedItems.some((x) => productItemKey(x) === key)) return s
    return { selectedItems: [...s.selectedItems, item] }
  }),

  removeItem: (item) => set((s) => {
    const key = productItemKey(item)
    return {
      selectedItems: s.selectedItems.filter((x) => productItemKey(x) !== key),
    }
  }),

  clearItems: () => set({ selectedItems: [] }),

  clearResults: () => set({
    multiResult: null, multiVintageCoords: null, multiError: null,
    multiByCase: null, multiCaseOrder: [],
  }),

  compute: async (params) => {
    const { scope, methods, computeDatabase } = params
    const { selectedItems } = get()
    if (selectedItems.length === 0) {
      set({ multiError: 'Select at least one item' })
      return
    }
    if (methods.length === 0) {
      set({ multiError: 'Select at least one impact method' })
      return
    }
    const { stageAmountsByItem } = get()
    // Snapshot the activity vintage coords for the items being run, keyed by
    // item_id — results-aligned, so the Line gate/chart/export don't depend on
    // the live selection after the run.
    const vintageCoords: VintageCoordMap = {}
    for (const it of selectedItems) {
      if (it.type !== 'activity') continue
      const a = it as ActivityProductItem
      vintageCoords[`${a.database}|${a.code}`] = {
        label: a.vintage_label ?? '',
        database: a.database,
        base_database: a.base_database ?? null,
        iam: a.iam ?? null,
        ssp: a.ssp ?? null,
        year: a.year ?? null,
      }
    }
    // One call per sensitivity case. The endpoint takes a single
    // `parameter_scenario` per item, so N cases are N sequential calls -- the
    // same shape the system-level orchestrator uses (it spawns one task per
    // case), and cheap here because the endpoint is synchronous and N is small.
    // Base is always first and always present: every other case is read
    // against it.
    const cases = ['Base', ...(params.cases ?? []).filter((c) => c !== 'Base')]
    set({ multiLoading: true, multiError: null })
    try {
      const byCase: Record<string, MultiProductLCAResult> = {}
      for (const c of cases) {
        byCase[c] = await calculateMultiProductLCA({
          items: selectedItems.map((it) => toWireItem(it, stageAmountsByItem, c)),
          methods,
          scope,
          compute_database: computeDatabase ?? null,
        })
      }
      const result = byCase['Base']
      set({
        multiResult: result, multiVintageCoords: vintageCoords,
        multiByCase: byCase, multiCaseOrder: cases, multiLoading: false,
      })
    } catch (e) {
      set({
        multiLoading: false,
        multiError: e instanceof Error ? e.message : String(e),
        multiResult: null,
        multiVintageCoords: null,
      })
    }
  },

  reset: () => set({
    selectedItems: [],
    stageAmountsByItem: {},
    multiResult: null,
    multiVintageCoords: null,
    multiByCase: null,
    multiCaseOrder: [],
    multiLoading: false,
    multiError: null,
  }),
}))
