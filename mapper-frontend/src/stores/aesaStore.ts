/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { create } from 'zustand'
import {
  type AESAComputeResult,
  type AESAConfiguration,
  type AESAConfigurationCreate,
  type AESADefaultsBundle,
  type AESASession,
  type ArchetypeLCACalculateResult,
  type CarbonBudgetConfig,
  type DownscalingLayer,
  type ImpactAssessmentResult,
  type MethodPBMapping,
  type MultiDConfig,
  type PrincipleDefinition,
  type ProspectiveSingleProductPoint,
  type SharingPreset,
  type SharingPresetCreate,
  computeAESA,
  createAESAConfiguration,
  createAESASession,
  deleteAESASession,
  getAESASessions,
  renameAESASession,
  createSharingPreset,
  deleteAESAConfiguration,
  deleteSharingPreset,
  downloadSharingTemplate as apiDownloadSharingTemplate,
  duplicateSharingPreset,
  exportSharingPreset as apiExportSharingPreset,
  getAESAConfigurations,
  getAESADefaults,
  getSharingPresets,
  withTransientRetry,
  importSharingPreset as apiImportSharingPreset,
  suggestAESAMethodMapping,
  updateAESAConfiguration,
  updateSharingPreset,
} from '../api/client'
import { useProjectStore } from './projectStore'

// ── Preset helpers ──────────────────────────────────────────────────────────

const BUILTIN_PRESET_ID = 'ferhati_2026_multi_d'

/** Build a 2-layer SharingPreset from a legacy MultiDConfig (mirror of
 *  ``migrate_multi_d_to_preset`` on the backend). Used for migration only. */
function migrateMultiDToPreset(mD: MultiDConfig): SharingPreset {
  const usedPrinciples = new Set<string>()
  const layer1Data: DownscalingLayer['data'] = {}
  const assignments = Object.entries(mD.layer1).map(([pbId, cfg]) => {
    usedPrinciples.add(cfg.principle)
    if (!layer1Data[cfg.principle]) layer1Data[cfg.principle] = {}
    // Single-entry series (year 0 = constant) matches backend _resolve_year semantics.
    layer1Data[cfg.principle][0] = [cfg.system_value, cfg.global_value]
    return { pb_id: pbId, principle_id: cfg.principle, justification: cfg.justification }
  })
  const principles: PrincipleDefinition[] = Array.from(usedPrinciples).map((id) => ({
    id, name: id, description: '',
  }))
  return {
    id: 'migrated',
    name: 'Migrated Multi-D',
    description: 'Auto-migrated from a legacy 2-layer Multi-D config.',
    built_in: false,
    principles,
    category_assignments: assignments,
    chain: {
      layers: [
        {
          layer_number: 1,
          name: 'Layer 1 — category-specific',
          principle_mode: 'category_specific',
          description: 'Migrated SP-I layer.',
          data: layer1Data,
        },
        {
          layer_number: 2,
          name: 'Layer 2 — sector share',
          principle_mode: 'fixed',
          fixed_principle: 'AR',
          description: mD.layer2_source || 'Migrated sector share.',
          data: { AR: { 0: [mD.layer2_sector_share, 1] } },
        },
      ],
    },
  }
}

/** Resolve (system, global) for a given year from sparse year_data (mirror of
 *  ``_resolve_year`` on the backend). */
function resolveYearData(
  yearData: Record<number, [number, number]> | undefined,
  year: number,
): [number, number] | null {
  if (!yearData) return null
  const keys = Object.keys(yearData).map(Number)
  if (keys.length === 0) return null
  if (yearData[year]) return yearData[year]
  if (keys.length === 1) return yearData[keys[0]]
  const nearest = keys.reduce((best, y) => {
    const d = Math.abs(y - year)
    const bd = Math.abs(best - year)
    if (d < bd) return y
    if (d === bd && y < best) return y
    return best
  }, keys[0])
  return yearData[nearest]
}

function layerFactor(
  layer: DownscalingLayer,
  pbId: string,
  year: number,
  assignments: Record<string, string>,
): number {
  const principle = layer.principle_mode === 'fixed'
    ? layer.fixed_principle
    : assignments[pbId]
  if (!principle) return 0
  const pair = resolveYearData(layer.data?.[principle], year)
  if (!pair) return 0
  const [sys, glob] = pair
  if (glob <= 0) return 0
  return sys / glob
}

/** Product of all layer factors for (pb_id, year). */
export function computeChainFactor(
  preset: SharingPreset | null | undefined,
  pbId: string,
  year: number,
): number {
  if (!preset) return 0
  const assignments: Record<string, string> = {}
  for (const a of preset.category_assignments) assignments[a.pb_id] = a.principle_id
  let factor = 1
  for (const ly of preset.chain.layers) factor *= layerFactor(ly, pbId, year, assignments)
  return factor
}

// ── Draft ───────────────────────────────────────────────────────────────────

/** Draft shape used by the config sidebar — not yet persisted. */
export interface AESAConfigDraft {
  name: string
  boundary_set_id: string
  /** Inline snapshot — the editable preset for this configuration. */
  sharing: SharingPreset
  /** Optional bookmark to the global preset this draft was cloned from. */
  sharing_preset_id: string | null
  carbon_budget: CarbonBudgetConfig | null
  method_mapping: MethodPBMapping[]
  impact_mode: 'static' | 'projected'
  // Patch 4O — explicit DSM scenario id from the cascade picker.
  // ``null`` = "use whatever's active when this draft is loaded"
  // (default for pre-Patch-4O saved configs and freshly-defaulted
  // drafts; `ConfigSidebar` resolves it to the system's active
  // scenario id at render time).
  dsm_scenario_id: string | null
}

// Patch 5AM — which mount-time config load failed (drives the retry banner's
// human label + the targeted re-fetch).
export type AESAConfigLoadKind = 'defaults' | 'presets' | 'configurations' | 'sessions'

interface AESAStore {
  // Defaults hydrated from /aesa/defaults
  defaults: AESADefaultsBundle | null
  defaultsLoading: boolean

  // Global presets (loaded from /aesa/sharing-presets)
  presets: SharingPreset[]
  presetsLoading: boolean

  // Persisted configurations for the current project
  configurations: AESAConfiguration[]
  activeConfigId: string | null

  // Working draft (shown in sidebar), kept in sync with active config when loaded
  draft: AESAConfigDraft | null

  // Patch 4Q — empty-state coordination. True after the user has
  // expressed explicit intent to create a new AESA configuration
  // (clicked "+ New configuration" in the page header OR the
  // "Create your first configuration" button in the sidebar's
  // empty state). Hides the empty-state guidance from the sidebar
  // even when no config has been saved yet, so users can see the
  // cascade + sections they're editing toward saving. Resets on
  // successful save (real activeConfigId set), on selecting an
  // existing config, and on project reset.
  creatingNewConfig: boolean

  // Patch 4R — saved sessions. Sessions are immutable historical
  // records of one compute event (configuration snapshot + result).
  // Distinct from `configurations` (reusable input templates).
  sessions: AESASession[]
  sessionsLoading: boolean
  // When non-null, the AESA dashboard is in "loaded session" mode:
  // the cascade is read-only, Compute is replaced with "Return to
  // live view", and `result` reflects the saved data. Setting back
  // to null returns to the live cascade view.
  activeSessionId: string | null

  // Part C1 — AESA compute source. 'fleet' = DSM × archetypes × pLCA pipeline
  // (the existing path, default). 'single_product' = one static single-product
  // LCA result (useSingleProductImpactStore.staticResult) adapted to a
  // single-reference-year impact. `referenceYear` is the climate
  // annual-allowance year for the single-product path (default 2025).
  source: 'fleet' | 'single_product'
  referenceYear: number
  // Single-product basis (only meaningful when source === 'single_product').
  // 'static' (default) reads the static single-product result + referenceYear;
  // 'prospective' reads the year-resolved trajectory (no referenceYear).
  singleProductBasis: 'static' | 'prospective'

  // Compute state
  result: AESAComputeResult | null
  lastRunAt: string | null
  running: boolean
  error: string | null
  // Last compute() inputs, remembered so the budget-basis toggle can re-run
  // the same compute against the new basis (the basis lives on the draft's
  // carbon_budget, which compute() reads fresh). Null until the first compute.
  lastComputeArgs: {
    mfaSystemId: string
    impactTaskId?: string | null
    impactInline?: ImpactAssessmentResult | null
    runSensitivity?: boolean
    singleProductResult?: ArchetypeLCACalculateResult | null
    referenceYear?: number
    prospectiveSingleProduct?: ProspectiveSingleProductPoint[] | null
  } | null

  // Patch 5AM — mount-time config-panel load failures live in their OWN slot
  // (separate from the general `error`, which carries compute/save errors) so
  // the dedicated retry banner can name the failed load and re-run just it.
  configLoadError: { kind: AESAConfigLoadKind; message: string } | null
  dismissConfigLoadError: () => void

  // Patch 4T — display filter for the result body. ``null`` means
  // "show all indicators in the current result"; an explicit list
  // narrows the radar / timeline / box-plot / detail-table to the
  // listed pb_ids. Compute is unaffected — AESA always evaluates
  // every indicator in the boundary set; the filter is view-state
  // only. Reset to ``null`` whenever a fresh result lands; persisted
  // alongside saved sessions and restored on load.
  displayedIndicators: string[] | null

  // Actions — defaults / configurations
  loadDefaults: () => Promise<void>
  loadConfigurations: () => Promise<void>
  setActiveConfig: (id: string | null) => void
  setDraft: (d: AESAConfigDraft | null) => void
  /** Patch 4Q — explicit "user wants to create a new config" action.
   * Replaces the previous `setActiveConfig(null) + resetDraftToDefaults()`
   * idiom in the page-header button so the sidebar's empty state
   * knows to step aside. */
  startNewConfig: () => void
  updateDraft: (patch: Partial<AESAConfigDraft>) => void
  updateCarbonBudget: (patch: Partial<CarbonBudgetConfig> | null) => void
  resetDraftToDefaults: () => void
  suggestMapping: (methods: string[][]) => Promise<void>
  saveConfig: (mfaSystemId: string) => Promise<AESAConfiguration | null>

  // Patch 4R — session lifecycle.
  loadSessions: () => Promise<void>
  saveCurrentSession: (name: string) => Promise<AESASession | null>
  loadSession: (id: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  /** Returns to the live cascade view: clears `activeSessionId` +
   * `result`, restores the user's last-loaded configuration draft. */
  clearActiveSession: () => void
  deleteConfig: (id: string) => Promise<void>
  setSource: (source: 'fleet' | 'single_product') => void
  setReferenceYear: (year: number) => void
  setSingleProductBasis: (basis: 'static' | 'prospective') => void
  compute: (args: {
    mfaSystemId: string
    impactTaskId?: string | null
    impactInline?: ImpactAssessmentResult | null
    runSensitivity?: boolean
    singleProductResult?: ArchetypeLCACalculateResult | null
    referenceYear?: number
    prospectiveSingleProduct?: ProspectiveSingleProductPoint[] | null
  }) => Promise<void>
  clearResult: () => void
  // Set the carbon-budget basis ("CO2" budget vs "CO2e_GHG" budget) on the
  // draft and, if a result is already on screen, re-run the last compute so the
  // climate SR reflects the new basis. Only the climate-change SR responds; the
  // numerator (EF v3.1 GWP100) is always all-GHG.
  setBudgetBasis: (basis: 'CO2' | 'CO2e_GHG') => void
  reset: () => void

  // Patch 4T — display filter actions. ``set`` replaces the slot
  // wholesale (used by the "Select all" / "Clear all" buttons and on
  // session load). ``toggle`` flips one indicator's membership
  // against the current effective list (treating ``null`` as
  // "all selected" before the first toggle). ``clear`` empties the
  // selection (zero indicators visible — recoverable empty state).
  // ``selectAll`` resets to ``null`` so future fresh results show
  // everything.
  setDisplayedIndicators: (ids: string[] | null) => void
  toggleDisplayedIndicator: (id: string, fullList: readonly string[]) => void
  clearDisplayedIndicators: (fullList: readonly string[]) => void
  selectAllDisplayedIndicators: () => void

  // Actions — sharing preset + chain editing
  loadPresets: () => Promise<void>
  selectPreset: (presetId: string) => Promise<void>
  updateSharing: (patch: Partial<SharingPreset>) => void
  updateLayer: (index: number, patch: Partial<DownscalingLayer>) => void
  addLayer: (layer?: Partial<DownscalingLayer>) => void
  removeLayer: (index: number) => void
  moveLayer: (from: number, to: number) => void
  updatePrinciples: (principles: PrincipleDefinition[]) => void
  updateAssignment: (pbId: string, principleId: string, justification?: string) => void
  savePreset: () => Promise<SharingPreset | null>
  savePresetAs: (name: string) => Promise<SharingPreset | null>
  deletePreset: (presetId: string) => Promise<void>
  duplicatePreset: (presetId: string, newName?: string) => Promise<SharingPreset | null>
  importPresetFile: (file: File) => Promise<SharingPreset | null>
  exportPresetFile: (presetId: string, filename: string) => Promise<void>
  downloadSharingTemplate: (filename?: string) => Promise<void>
}

function draftFromConfig(c: AESAConfiguration, fallback: SharingPreset): AESAConfigDraft {
  const sharing = c.sharing
    ?? (c.multi_d ? migrateMultiDToPreset(c.multi_d) : fallback)
  return {
    name: c.name,
    boundary_set_id: c.boundary_set_id,
    sharing,
    sharing_preset_id: c.sharing_preset_id ?? null,
    carbon_budget: c.carbon_budget,
    method_mapping: c.method_mapping,
    impact_mode: c.impact_mode,
    dsm_scenario_id: c.dsm_scenario_id ?? null,
  }
}

function draftFromDefaults(
  defaults: AESADefaultsBundle,
  presets: SharingPreset[],
): AESAConfigDraft {
  const builtIn = presets.find((p) => p.id === BUILTIN_PRESET_ID) ?? presets[0]
  const fallback = builtIn ?? migrateMultiDToPreset(defaults.default_multi_d)
  return {
    name: 'New AESA configuration',
    boundary_set_id: defaults.boundary_sets[0]?.id ?? 'Sala2020_EF',
    sharing: fallback,
    sharing_preset_id: builtIn?.id ?? null,
    // Phase 3 — fresh configs default to the CO₂-eq budget basis (the backend
    // default budget carries the per-budget co2e_conversion factor; we flip the
    // basis so the climate SR is measured against the all-GHG budget by default,
    // matching the always-all-GHG GWP100 numerator). Loaded/saved configs keep
    // their stored basis (draftFromConfig), preserving back-compat.
    carbon_budget: defaults.default_carbon_budget
      ? { ...defaults.default_carbon_budget, budget_basis: 'CO2e_GHG' }
      : defaults.default_carbon_budget,
    method_mapping: [],
    impact_mode: 'static',
    dsm_scenario_id: null,
  }
}

function presetCreateBody(sharing: SharingPreset): SharingPresetCreate {
  return {
    name: sharing.name,
    description: sharing.description,
    principles: sharing.principles,
    category_assignments: sharing.category_assignments,
    chain: sharing.chain,
  }
}

export const useAESAStore = create<AESAStore>((set, get) => ({
  defaults: null,
  defaultsLoading: false,
  presets: [],
  presetsLoading: false,
  configurations: [],
  activeConfigId: null,
  draft: null,
  creatingNewConfig: false,
  sessions: [],
  sessionsLoading: false,
  activeSessionId: null,
  source: 'fleet',
  referenceYear: 2025,
  singleProductBasis: 'static',
  result: null,
  lastRunAt: null,
  running: false,
  error: null,
  lastComputeArgs: null,
  configLoadError: null,
  displayedIndicators: null,

  dismissConfigLoadError: () => set({ configLoadError: null }),

  loadDefaults: async () => {
    // Patch 5AP — defaults are project-independent reference data; once cached
    // we don't re-fetch. BUT reset() (project change) nulls the draft while
    // keeping defaults, so if a draft is missing here, rebuild it from the
    // cached defaults instead of early-returning draft-less — otherwise the
    // config-form body (gated on `draft && defaults`) stays hidden, leaving
    // only the header.
    if (get().defaults) {
      if (!get().draft) {
        set((s) => ({ draft: s.defaults ? draftFromDefaults(s.defaults, s.presets) : null }))
      }
      return
    }
    if (get().defaultsLoading) return
    set({ defaultsLoading: true })
    try {
      const defaults = await withTransientRetry(() => getAESADefaults())
      // Ensure presets are loaded before building the first draft.
      if (!get().presets.length && !get().presetsLoading) {
        await get().loadPresets()
      }
      set((s) => ({
        defaults,
        defaultsLoading: false,
        draft: s.draft ?? draftFromDefaults(defaults, s.presets),
        configLoadError: s.configLoadError?.kind === 'defaults' ? null : s.configLoadError,
      }))
    } catch (e) {
      set({ defaultsLoading: false, configLoadError: { kind: 'defaults', message: e instanceof Error ? e.message : String(e) } })
    }
  },

  loadPresets: async () => {
    if (get().presetsLoading) return
    set({ presetsLoading: true })
    try {
      const presets = await withTransientRetry(() => getSharingPresets())
      set((s) => ({ presets, presetsLoading: false, configLoadError: s.configLoadError?.kind === 'presets' ? null : s.configLoadError }))
    } catch (e) {
      set({ presetsLoading: false, configLoadError: { kind: 'presets', message: e instanceof Error ? e.message : String(e) } })
    }
  },

  loadConfigurations: async () => {
    try {
      const configs = await withTransientRetry(() => getAESAConfigurations())
      set((s) => ({ configurations: configs, configLoadError: s.configLoadError?.kind === 'configurations' ? null : s.configLoadError }))
    } catch (e) {
      set({ configLoadError: { kind: 'configurations', message: e instanceof Error ? e.message : String(e) } })
    }
  },

  setActiveConfig: (id) => {
    const { configurations, defaults, presets } = get()
    const cfg = configurations.find((c) => c.id === id) ?? null
    const builtIn = presets.find((p) => p.id === BUILTIN_PRESET_ID) ?? presets[0]
    const fallback = builtIn ?? (defaults ? migrateMultiDToPreset(defaults.default_multi_d) : null)
    set({
      activeConfigId: id,
      draft: cfg && fallback
        ? draftFromConfig(cfg, fallback)
        : defaults
          ? draftFromDefaults(defaults, presets)
          : null,
      result: null,
      // Patch 4Q — selecting an existing config closes the
      // "creating new" state. The sidebar's empty state hides
      // either way (configurations[].length > 0 typically), but
      // this keeps the flag's semantic clean.
      creatingNewConfig: id !== null ? false : get().creatingNewConfig,
    })
  },

  // Patch 4Q — explicit creation-intent action. Mirrors what the
  // page-header "+ New configuration" button used to do inline,
  // plus sets the flag the sidebar reads to step its empty state
  // aside.
  startNewConfig: () => {
    const { defaults, presets } = get()
    set({
      activeConfigId: null,
      draft: defaults ? draftFromDefaults(defaults, presets) : null,
      result: null,
      creatingNewConfig: true,
    })
  },

  setDraft: (d) => set({ draft: d }),
  updateDraft: (patch) => set((s) => ({ draft: s.draft ? { ...s.draft, ...patch } : s.draft })),

  updateCarbonBudget: (patch) => set((s) => {
    if (!s.draft) return {}
    if (patch === null) return { draft: { ...s.draft, carbon_budget: null } }
    const base = s.draft.carbon_budget ?? s.defaults?.default_carbon_budget
    if (!base) return {}
    return { draft: { ...s.draft, carbon_budget: { ...base, ...patch } } }
  }),

  resetDraftToDefaults: () => set((s) => ({
    draft: s.defaults ? draftFromDefaults(s.defaults, s.presets) : null,
  })),

  suggestMapping: async (methods) => {
    const { draft } = get()
    if (!draft) return
    try {
      const mapping = await suggestAESAMethodMapping(methods, draft.boundary_set_id)
      set({ draft: { ...draft, method_mapping: mapping } })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  saveConfig: async (mfaSystemId) => {
    const { draft, activeConfigId } = get()
    if (!draft) return null
    const body: AESAConfigurationCreate = {
      name: draft.name,
      mfa_system_id: mfaSystemId,
      dsm_scenario_id: draft.dsm_scenario_id,
      impact_mode: draft.impact_mode,
      boundary_set_id: draft.boundary_set_id,
      sharing: draft.sharing,
      sharing_preset_id: draft.sharing_preset_id,
      carbon_budget: draft.carbon_budget,
      method_mapping: draft.method_mapping,
    }
    try {
      const saved = activeConfigId
        ? await updateAESAConfiguration(activeConfigId, body)
        : await createAESAConfiguration(body)
      set((s) => {
        const others = s.configurations.filter((c) => c.id !== saved.id)
        return {
          configurations: [saved, ...others],
          activeConfigId: saved.id,
          // Patch 4Q — successful save closes the creation flow;
          // future visits to the sidebar render against a real
          // saved config, no need for the empty-state guidance.
          creatingNewConfig: false,
        }
      })
      return saved
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  deleteConfig: async (id) => {
    try {
      await deleteAESAConfiguration(id)
      set((s) => ({
        configurations: s.configurations.filter((c) => c.id !== id),
        activeConfigId: s.activeConfigId === id ? null : s.activeConfigId,
        result: s.activeConfigId === id ? null : s.result,
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  setSource: (source) => set({ source }),
  setReferenceYear: (referenceYear) => set({ referenceYear }),
  setSingleProductBasis: (singleProductBasis) => set({ singleProductBasis }),

  compute: async ({ mfaSystemId, impactTaskId, impactInline, runSensitivity, singleProductResult, referenceYear, prospectiveSingleProduct }) => {
    const { draft } = get()
    if (!draft) {
      set({ error: 'No configuration loaded' })
      return
    }
    set({ running: true, error: null, lastComputeArgs: { mfaSystemId, impactTaskId, impactInline, runSensitivity, singleProductResult, referenceYear, prospectiveSingleProduct } })
    try {
      const inlineConfig: AESAConfiguration = {
        id: get().activeConfigId ?? 'draft',
        name: draft.name,
        mfa_system_id: mfaSystemId,
        dsm_scenario_id: draft.dsm_scenario_id,
        impact_mode: draft.impact_mode,
        boundary_set_id: draft.boundary_set_id,
        sharing: draft.sharing,
        sharing_preset_id: draft.sharing_preset_id,
        carbon_budget: draft.carbon_budget,
        method_mapping: draft.method_mapping,
        created_at: new Date().toISOString(),
      }
      // Part C1/C2 — single-LCA sources take precedence over the fleet path
      // (the backend adapts them and skips the DSM system-match check).
      //   prospective → year-resolved series, used directly (no referenceYear).
      //   static      → scalar result flat-adapted at referenceYear.
      // Otherwise the fleet path (task id / inline result).
      const isProspectiveSP = !!prospectiveSingleProduct && prospectiveSingleProduct.length > 0
      const isSingleProduct = isProspectiveSP || !!singleProductResult
      const result = await computeAESA({
        config: inlineConfig,
        impact_task_id: isSingleProduct ? null : (impactTaskId ?? null),
        impact_result: isSingleProduct ? null : (impactInline ?? null),
        single_product_basis: isProspectiveSP ? 'prospective' : 'static',
        single_product_result: isProspectiveSP ? null : (singleProductResult ?? null),
        reference_year: referenceYear,
        prospective_single_product: isProspectiveSP ? prospectiveSingleProduct : null,
        run_sensitivity: !!runSensitivity,
      })
      // Patch 4T — fresh result clears the display filter. Carrying a
      // stale filter forward would silently hide newly-computed
      // indicators that the user had no chance to opt in to.
      set({
        result,
        running: false,
        lastRunAt: new Date().toISOString(),
        displayedIndicators: null,
      })
    } catch (e) {
      set({ running: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  clearResult: () => set({ result: null, lastRunAt: null, displayedIndicators: null }),

  setBudgetBasis: (basis) => {
    const { draft } = get()
    if (!draft?.carbon_budget || draft.carbon_budget.budget_basis === basis) return
    set({
      draft: {
        ...draft,
        carbon_budget: { ...draft.carbon_budget, budget_basis: basis },
      },
    })
    // If a result is on screen, re-run the same compute so the climate SR is
    // re-derived against the new basis (the basis is read off the draft).
    const { result, lastComputeArgs, running } = get()
    if (result && lastComputeArgs && !running) void get().compute(lastComputeArgs)
  },

  // ── Display filter (Patch 4T) ─────────────────────────────────────────────

  setDisplayedIndicators: (ids) => set({ displayedIndicators: ids }),

  toggleDisplayedIndicator: (id, fullList) => set((s) => {
    // ``null`` = "all selected" → start the filter from the full set,
    // then drop the toggled id. Otherwise flip membership against the
    // current explicit list.
    const base = s.displayedIndicators ?? Array.from(fullList)
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
    // Collapse "all explicitly selected" back to ``null`` so the
    // saved-session shape stays clean (null = "show everything",
    // future results don't get accidentally pinned to the current id
    // list).
    const allSelected =
      fullList.length > 0
      && next.length === fullList.length
      && fullList.every((x) => next.includes(x))
    return { displayedIndicators: allSelected ? null : next }
  }),

  clearDisplayedIndicators: (_fullList) => set({ displayedIndicators: [] }),

  selectAllDisplayedIndicators: () => set({ displayedIndicators: null }),

  // ── Sessions (Patch 4R) ────────────────────────────────────────────────────

  loadSessions: async () => {
    set({ sessionsLoading: true })
    try {
      const sessions = await withTransientRetry(() => getAESASessions())
      set((s) => ({ sessions, sessionsLoading: false, configLoadError: s.configLoadError?.kind === 'sessions' ? null : s.configLoadError }))
    } catch (e) {
      set({ sessionsLoading: false, configLoadError: { kind: 'sessions', message: e instanceof Error ? e.message : String(e) } })
    }
  },

  saveCurrentSession: async (name) => {
    const { draft, result, activeConfigId } = get()
    if (!draft || !result) {
      set({ error: 'No result to save. Compute AESA first.' })
      return null
    }
    // Snapshot the current draft as a self-contained AESAConfiguration.
    // Mirrors the inline shape used by `compute()` so the saved
    // session is reproducible without depending on the live store.
    const snapshot: AESAConfiguration = {
      id: activeConfigId ?? 'snapshot',
      name: draft.name,
      mfa_system_id: result.config_id ?? '',
      dsm_scenario_id: draft.dsm_scenario_id,
      impact_mode: draft.impact_mode,
      boundary_set_id: draft.boundary_set_id,
      sharing: draft.sharing,
      sharing_preset_id: draft.sharing_preset_id,
      carbon_budget: draft.carbon_budget,
      method_mapping: draft.method_mapping,
      created_at: new Date().toISOString(),
    }
    try {
      const session = await createAESASession({
        name,
        configuration_snapshot: snapshot,
        result,
        upstream_ia_task_id: null,
        // Patch 4T — persist the current display filter so reload
        // restores the same view. ``null`` = "show all".
        displayed_indicators: get().displayedIndicators,
      })
      set((s) => ({
        sessions: [session, ...s.sessions.filter((x) => x.id !== session.id)],
      }))
      return session
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  loadSession: async (id) => {
    const { sessions } = get()
    const cached = sessions.find((s) => s.id === id)
    // Use cached entry when available; fall back to a fresh GET so
    // direct deep-links (or stale lists) still work.
    let session: AESASession | null = cached ?? null
    if (!session) {
      try {
        const fetched = await getAESASessions()
        session = fetched.find((s) => s.id === id) ?? null
        set({ sessions: fetched })
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
        return
      }
    }
    if (!session) {
      set({ error: 'Session not found' })
      return
    }
    // Loading puts the dashboard into "frozen" mode: the result and
    // the cascade both reflect the saved snapshot. Edits to the
    // cascade are visually disabled (see ConfigSidebar gating on
    // `activeSessionId`); Compute is replaced with "Return to live
    // view".
    const cfg = session.configuration_snapshot
    set({
      activeSessionId: session.id,
      result: session.result,
      // Mirror the snapshot into the draft so the cascade displays
      // the saved values (read-only). The `creatingNewConfig` flag
      // is irrelevant in session-loaded mode — the empty state
      // never renders.
      draft: {
        name: cfg.name,
        boundary_set_id: cfg.boundary_set_id,
        sharing: cfg.sharing ?? get().draft?.sharing ?? null as never,
        sharing_preset_id: cfg.sharing_preset_id ?? null,
        carbon_budget: cfg.carbon_budget,
        method_mapping: cfg.method_mapping,
        impact_mode: cfg.impact_mode,
        dsm_scenario_id: cfg.dsm_scenario_id ?? null,
      },
      lastRunAt: session.created_at,
      // Patch 4T — restore the saved display filter. Pre-Patch-4T
      // sessions don't carry the field; ``displayed_indicators ??
      // null`` keeps them on "show all".
      displayedIndicators: session.displayed_indicators ?? null,
    })
  },

  renameSession: async (id, name) => {
    try {
      const updated = await renameAESASession(id, name)
      set((s) => ({
        sessions: s.sessions.map((x) => (x.id === id ? updated : x)),
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  deleteSession: async (id) => {
    try {
      await deleteAESASession(id)
      set((s) => ({
        sessions: s.sessions.filter((x) => x.id !== id),
        // If the deleted session was active, return to live view.
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
        result: s.activeSessionId === id ? null : s.result,
        lastRunAt: s.activeSessionId === id ? null : s.lastRunAt,
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  clearActiveSession: () => set({
    activeSessionId: null,
    result: null,
    lastRunAt: null,
    displayedIndicators: null,
  }),

  reset: () => set((s) => ({
    configurations: [],
    activeConfigId: null,
    // Patch 5AP — rebuild the fresh draft from cached defaults rather than
    // leaving it null. A null draft with defaults still set gates the
    // config-form body off (header-only). When defaults aren't loaded yet,
    // null is fine — loadDefaults builds the draft on first fetch.
    draft: s.defaults ? draftFromDefaults(s.defaults, s.presets) : null,
    creatingNewConfig: false,
    sessions: [],
    sessionsLoading: false,
    activeSessionId: null,
    source: 'fleet',
    referenceYear: 2025,
    singleProductBasis: 'static',
    result: null,
    lastRunAt: null,
    running: false,
    error: null,
    displayedIndicators: null,
  })),

  // ── Preset / chain editing ────────────────────────────────────────────────

  selectPreset: async (presetId) => {
    let preset = get().presets.find((p) => p.id === presetId) ?? null
    if (!preset) {
      await get().loadPresets()
      preset = get().presets.find((p) => p.id === presetId) ?? null
    }
    if (!preset) return
    set((s) => ({
      draft: s.draft
        ? { ...s.draft, sharing: preset!, sharing_preset_id: preset!.id }
        : s.draft,
    }))
  },

  updateSharing: (patch) => set((s) => {
    if (!s.draft) return {}
    return { draft: { ...s.draft, sharing: { ...s.draft.sharing, ...patch } } }
  }),

  updateLayer: (index, patch) => set((s) => {
    if (!s.draft) return {}
    const layers = s.draft.sharing.chain.layers.map((ly, i) =>
      i === index ? { ...ly, ...patch } : ly)
    return {
      draft: {
        ...s.draft,
        sharing: { ...s.draft.sharing, chain: { layers } },
      },
    }
  }),

  addLayer: (layer) => set((s) => {
    if (!s.draft) return {}
    const existing = s.draft.sharing.chain.layers
    const nextNum = (existing.length ? Math.max(...existing.map((l) => l.layer_number)) : 0) + 1
    const newLayer: DownscalingLayer = {
      layer_number: nextNum,
      name: layer?.name ?? `Layer ${nextNum}`,
      principle_mode: layer?.principle_mode ?? 'fixed',
      fixed_principle: layer?.fixed_principle ?? (layer?.principle_mode === 'category_specific' ? null : 'AR'),
      description: layer?.description ?? '',
      data: layer?.data ?? {},
    }
    const layers = [...existing, newLayer]
    return { draft: { ...s.draft, sharing: { ...s.draft.sharing, chain: { layers } } } }
  }),

  removeLayer: (index) => set((s) => {
    if (!s.draft) return {}
    const existing = s.draft.sharing.chain.layers
    if (existing.length <= 1) return {} // Min 1 layer
    const layers = existing.filter((_, i) => i !== index)
      .map((ly, i) => ({ ...ly, layer_number: i + 1 }))
    return { draft: { ...s.draft, sharing: { ...s.draft.sharing, chain: { layers } } } }
  }),

  moveLayer: (from, to) => set((s) => {
    if (!s.draft) return {}
    const layers = [...s.draft.sharing.chain.layers]
    if (from < 0 || from >= layers.length || to < 0 || to >= layers.length) return {}
    const [moved] = layers.splice(from, 1)
    layers.splice(to, 0, moved)
    const renumbered = layers.map((ly, i) => ({ ...ly, layer_number: i + 1 }))
    return { draft: { ...s.draft, sharing: { ...s.draft.sharing, chain: { layers: renumbered } } } }
  }),

  updatePrinciples: (principles) => set((s) => {
    if (!s.draft) return {}
    return {
      draft: {
        ...s.draft,
        sharing: { ...s.draft.sharing, principles },
      },
    }
  }),

  updateAssignment: (pbId, principleId, justification) => set((s) => {
    if (!s.draft) return {}
    const existing = s.draft.sharing.category_assignments
    const others = existing.filter((a) => a.pb_id !== pbId)
    const current = existing.find((a) => a.pb_id === pbId)
    const assignments = [
      ...others,
      { pb_id: pbId, principle_id: principleId, justification: justification ?? current?.justification ?? '' },
    ]
    return {
      draft: {
        ...s.draft,
        sharing: { ...s.draft.sharing, category_assignments: assignments },
      },
    }
  }),

  savePreset: async () => {
    const { draft } = get()
    if (!draft) return null
    const preset = draft.sharing
    try {
      const saved = preset.built_in || !preset.id || preset.id === 'migrated' || preset.id === 'draft'
        ? await createSharingPreset(presetCreateBody({ ...preset, built_in: false }))
        : await updateSharingPreset(preset.id, presetCreateBody(preset))
      set((s) => {
        const others = s.presets.filter((p) => p.id !== saved.id)
        const built = s.presets.find((p) => p.built_in)
        const presets = [...(built ? [built] : []), saved, ...others.filter((p) => !p.built_in)]
        return {
          presets,
          draft: s.draft ? { ...s.draft, sharing: saved, sharing_preset_id: saved.id } : s.draft,
        }
      })
      return saved
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  savePresetAs: async (name) => {
    const { draft } = get()
    if (!draft) return null
    try {
      const saved = await createSharingPreset(presetCreateBody({
        ...draft.sharing, name, built_in: false,
      }))
      set((s) => ({
        presets: [...s.presets.filter((p) => p.id !== saved.id), saved],
        draft: s.draft ? { ...s.draft, sharing: saved, sharing_preset_id: saved.id } : s.draft,
      }))
      return saved
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  deletePreset: async (presetId) => {
    try {
      await deleteSharingPreset(presetId)
      set((s) => ({ presets: s.presets.filter((p) => p.id !== presetId) }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  duplicatePreset: async (presetId, newName) => {
    try {
      const dup = await duplicateSharingPreset(presetId, newName)
      set((s) => ({
        presets: [...s.presets, dup],
        draft: s.draft ? { ...s.draft, sharing: dup, sharing_preset_id: dup.id } : s.draft,
      }))
      return dup
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  importPresetFile: async (file) => {
    try {
      const preset = await apiImportSharingPreset(file)
      set((s) => ({
        presets: [...s.presets, preset],
        draft: s.draft ? { ...s.draft, sharing: preset, sharing_preset_id: preset.id } : s.draft,
      }))
      return preset
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  exportPresetFile: async (presetId, filename) => {
    try {
      await apiExportSharingPreset(presetId, filename)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  downloadSharingTemplate: async (filename) => {
    try {
      await apiDownloadSharingTemplate(filename)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },
}))

let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useAESAStore.getState().reset()
})
