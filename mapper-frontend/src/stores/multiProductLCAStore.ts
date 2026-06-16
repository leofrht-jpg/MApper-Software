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
  compute: (params: {
    scope: 'inflows' | 'stock' | 'outflows' | 'all'
    methods: string[][]
    computeDatabase?: string | null
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
      parameter_scenario: arc.parameter_scenario ?? null,
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

  clearResults: () => set({ multiResult: null, multiVintageCoords: null, multiError: null }),

  compute: async ({ scope, methods, computeDatabase }) => {
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
    set({ multiLoading: true, multiError: null })
    try {
      const result = await calculateMultiProductLCA({
        items: selectedItems.map((it) => toWireItem(it, stageAmountsByItem)),
        methods,
        scope,
        compute_database: computeDatabase ?? null,
      })
      set({ multiResult: result, multiVintageCoords: vintageCoords, multiLoading: false })
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
    multiLoading: false,
    multiError: null,
  }),
}))
