/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { create } from 'zustand'
import type { ArchetypeLCACalculateResult } from '../api/client'

// Cross-panel store for Impact Assessment → Single product mode (Patch 3, M6).
// The Static and Projected panels keep their own input state and per-call
// caches locally (selection, expanded flags, scenario tab idx), but write
// their *results* here so the Comparison panel can read both sides without
// either panel needing to know about the other. When the archetype id
// changes, both slots clear — comparing Static for archetype A against
// Projected for archetype B would silently produce a meaningless delta.
//
// The single Impact Assessment store (`useImpactStore`) is system-mode only
// and carries DSM/cohort-aware shapes that don't apply to single-product.
// Keeping these slots in a separate, narrower store avoids polluting it.

export interface ProjectedRun {
  dbName: string
  year: number | null
  iam: string
  ssp: string
  result: ArchetypeLCACalculateResult
}

// Patch 4C — view-mode persistence. Both panels remember the user's last
// chart/table choice across calculations and tab switches. Default to
// 'chart' for Projected (multi-DB results read more clearly as a curve)
// and 'chart' for Comparison (the reference-line + Δ chart is the headline
// visualization). View mode is panel-scoped so the user can keep Projected
// in chart view and Comparison in table view independently.
export type ViewMode = 'chart' | 'table'

// Stage amounts shape mirrors LCA Architect's PerArchetypeAmounts (one entry
// per archetype, since the user can switch archetype within the wrapper and
// expect their stage-amount edits to survive). The wrapper edits map[active]
// only — switching archetypes preserves both sides' edits.
export type AmountPreset = '1year' | 'lifetime' | 'custom'
export interface ArchetypeStageAmounts {
  preset: AmountPreset
  lifetime: number
  amounts: Record<string, number>
}

// Patch 4D — inherit-on-first-visit (Static → Projected). Both panels'
// configurations (scope, methods, plus Projected's selectedDbs) persist
// per-archetype so switching archetypes round-trips cleanly. Projected's
// first visit on an archetype that has a configured Static — and is not
// yet customized — copies scope + selectedMethods from Static (one-shot,
// no live mirroring). Subsequent edits to Projected's scope/methods set
// `projectedCustomizedByArc` so future visits never re-inherit, even if
// Static changes later.
export type SingleProductScope = 'inflows' | 'stock' | 'outflows' | 'all'
export interface StaticConfig {
  scope: SingleProductScope
  selectedMethods: string[][]
}
export interface ProjectedConfig {
  scope: SingleProductScope
  selectedMethods: string[][]
  selectedDbs: string[]
}

interface SingleProductImpactStore {
  archetypeId: string | null
  staticResult: ArchetypeLCACalculateResult | null
  projectedRuns: ProjectedRun[]
  projectedViewMode: ViewMode
  comparisonViewMode: ViewMode
  // Per-archetype stage amounts. Keyed by archetype id so switching
  // archetype within the wrapper preserves each archetype's edits.
  stageAmountsByArc: Record<string, ArchetypeStageAmounts>
  // Patch 4D — per-archetype configs.
  staticConfigByArc: Record<string, StaticConfig>
  projectedConfigByArc: Record<string, ProjectedConfig>
  projectedCustomizedByArc: Record<string, boolean>
  setArchetypeId: (id: string | null) => void
  setStaticResult: (result: ArchetypeLCACalculateResult | null) => void
  setProjectedRuns: (runs: ProjectedRun[]) => void
  setProjectedViewMode: (mode: ViewMode) => void
  setComparisonViewMode: (mode: ViewMode) => void
  setStageAmountsForArc: (arcId: string, value: ArchetypeStageAmounts) => void
  setStaticConfigForArc: (arcId: string, cfg: StaticConfig) => void
  setProjectedConfigForArc: (arcId: string, cfg: ProjectedConfig) => void
  setProjectedCustomized: (arcId: string, value: boolean) => void
  reset: () => void
}

export const useSingleProductImpactStore = create<SingleProductImpactStore>((set, get) => ({
  archetypeId: null,
  staticResult: null,
  projectedRuns: [],
  projectedViewMode: 'chart',
  comparisonViewMode: 'chart',
  stageAmountsByArc: {},
  staticConfigByArc: {},
  projectedConfigByArc: {},
  projectedCustomizedByArc: {},
  setArchetypeId: (id) => {
    if (get().archetypeId !== id) {
      set({ archetypeId: id, staticResult: null, projectedRuns: [] })
    }
  },
  setStaticResult: (result) => set({ staticResult: result }),
  setProjectedRuns: (runs) => set({ projectedRuns: runs }),
  setProjectedViewMode: (mode) => set({ projectedViewMode: mode }),
  setComparisonViewMode: (mode) => set({ comparisonViewMode: mode }),
  setStageAmountsForArc: (arcId, value) => set((state) => ({
    stageAmountsByArc: { ...state.stageAmountsByArc, [arcId]: value },
    // Don't clear results — instead, panels compare result.stage_amounts
    // (echoed by the backend) to the current store value and surface a
    // stale-result warning when they diverge. Less destructive than
    // clearing; user can still see what they last computed.
  })),
  setStaticConfigForArc: (arcId, cfg) => set((state) => ({
    staticConfigByArc: { ...state.staticConfigByArc, [arcId]: cfg },
  })),
  setProjectedConfigForArc: (arcId, cfg) => set((state) => ({
    projectedConfigByArc: { ...state.projectedConfigByArc, [arcId]: cfg },
  })),
  setProjectedCustomized: (arcId, value) => set((state) => ({
    projectedCustomizedByArc: { ...state.projectedCustomizedByArc, [arcId]: value },
  })),
  reset: () => set({
    archetypeId: null,
    staticResult: null,
    projectedRuns: [],
    stageAmountsByArc: {},
    staticConfigByArc: {},
    projectedConfigByArc: {},
    projectedCustomizedByArc: {},
  }),
}))
