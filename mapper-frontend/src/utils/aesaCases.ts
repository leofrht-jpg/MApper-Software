/* SPDX-License-Identifier: MPL-2.0 */
/**
 * AESA sensitivity cases: which exist, what each changes, and the selection.
 *
 * Two kinds, both offered in the case window before Compute:
 *  - sharing: one variant per sharing principle the configuration can test.
 *    The rule mirrors `AESAEngine.compute_with_sensitivity`: a principle is
 *    testable only if every category-specific layer carries data for it.
 *  - parameter: the project's parameter sensitivity cases. AESA recomputes the
 *    single-product LCA under each, so they need a single-product source.
 */
import type { AESAAxisEntry, AESAComputeResult, ParameterTable, SharingPreset, SustainabilityRatioResult } from '../api/client'

export interface CaseOption {
  id: string              // "sharing:EpC" | "parameter:v1g" -- the backend's AESACase.id
  kind: 'sharing' | 'parameter'
  key: string             // principle id or case name, as sent to the backend
  label: string
  /** What differs from the base, one line per difference. */
  definition: string[]
}

export interface CaseSelection { sharing: string[]; parameter: string[] }

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)))
}

export function sharingCaseOptions(sharing: SharingPreset | null | undefined): CaseOption[] {
  if (!sharing) return []
  const catLayers = sharing.chain.layers.filter((ly) => ly.principle_mode === 'category_specific')
  return sharing.principles
    .filter((p) => catLayers.length === 0 || catLayers.every((ly) => p.id in (ly.data ?? {})))
    .map((p) => ({
      id: `sharing:${p.id}`, kind: 'sharing', key: p.id, label: `Sharing: ${p.name}`,
      definition: [`Every category-specific layer uses ${p.id} (${p.name})`],
    }))
}

export function parameterCaseOptions(table: ParameterTable | null | undefined): CaseOption[] {
  if (!table) return []
  const params = Object.values(table.parameters ?? {})
  return (table.scenarios ?? []).map((sc) => {
    const definition = params
      .filter((p) => p.scenario_overrides && sc in p.scenario_overrides && p.scenario_overrides[sc] !== p.base_value)
      .map((p) => `${p.name} = ${fmt(p.scenario_overrides![sc])} (base ${fmt(p.base_value)})`)
    return {
      id: `parameter:${sc}`, kind: 'parameter' as const, key: sc, label: `Case: ${sc}`,
      definition: definition.length ? definition : ['no parameter differs from the base'],
    }
  })
}

/** The cases the window offers. Parameter cases only for a single-product
 *  source (a fleet case would need a full DSM x LCA run per case). */
export function availableCases(args: {
  runSensitivity: boolean
  sharing: SharingPreset | null | undefined
  paramTable: ParameterTable | null | undefined
  singleProduct: boolean
}): CaseOption[] {
  return [
    ...(args.runSensitivity ? sharingCaseOptions(args.sharing) : []),
    ...(args.singleProduct ? parameterCaseOptions(args.paramTable) : []),
  ]
}

/** The selection as the backend wants it. Keys not offered are dropped. */
export function selectionPayload(options: CaseOption[], picked: Set<string>): CaseSelection {
  return {
    sharing: options.filter((o) => o.kind === 'sharing' && picked.has(o.id)).map((o) => o.key),
    parameter: options.filter((o) => o.kind === 'parameter' && picked.has(o.id)).map((o) => o.key),
  }
}


// ── The case x sharing matrix, as computed ──────────────────────────────────
//
// Two independent axes: Case (Base + parameter cases) and Sharing (the base
// chain + each chosen principle). Any case can be read under any sharing. The
// backend returns them as ``case_axis`` / ``sharing_axis`` / ``matrix``; a
// result made before that (only ``cases``) is read as Base x sharing cases plus
// parameter cases x base chain, so old sessions still switch.

export interface ResultAxes { cases: AESAAxisEntry[]; sharings: AESAAxisEntry[] }

export function resultAxes(result: AESAComputeResult | null | undefined): ResultAxes {
  if (!result) return { cases: [], sharings: [] }
  if (result.matrix && result.matrix.length > 0 && result.case_axis && result.sharing_axis) {
    return { cases: result.case_axis, sharings: result.sharing_axis }
  }
  const cases: AESAAxisEntry[] = [{ id: 'base', label: 'Base', definition: [] }]
  const sharings: AESAAxisEntry[] = [{ id: 'base', label: 'Base chain', definition: [] }]
  for (const c of result.cases ?? []) {
    const key = c.id.includes(':') ? c.id.slice(c.id.indexOf(':') + 1) : c.id
    if (c.kind === 'sharing') sharings.push({ id: key, label: c.label.replace(/^Sharing: /, ''), definition: c.definition })
    else cases.push({ id: key, label: c.label.replace(/^Case: /, ''), definition: c.definition })
  }
  return { cases, sharings }
}

/** The SRs of one (case, sharing) cell, or null when that pair was not computed. */
export function cellResults(
  result: AESAComputeResult | null | undefined, caseId: string, sharingId: string,
): SustainabilityRatioResult[] | null {
  if (!result) return null
  if (caseId === 'base' && sharingId === 'base') return result.results
  if (result.matrix && result.matrix.length > 0) {
    return result.matrix.find((m) => m.case === caseId && m.sharing === sharingId)?.results ?? null
  }
  // Pre-matrix: only Base x sharing and case x base chain exist.
  if (caseId === 'base') return result.cases?.find((c) => c.id === `sharing:${sharingId}`)?.results ?? null
  if (sharingId === 'base') return result.cases?.find((c) => c.id === `parameter:${caseId}`)?.results ?? null
  return null
}

/** What a running AESA compute is doing, for its progress card. With cases it
 *  names the matrix and the LCA reruns -- the part that takes the time (about
 *  a minute for EVS40's four cases x all sharing, measured on a sidecar). */
/** What an AESA compute is doing, for the full-screen card's second line:
 *  "5 cases × 6 sharing · 4 LCA reruns". Same counts as computeLabel. */
export function computeDetail(args: { runSensitivity?: boolean; cases?: CaseSelection | null } | null | undefined): string {
  const cases = args?.cases
  if (cases && (cases.parameter.length > 0 || cases.sharing.length > 0)) {
    const nc = 1 + cases.parameter.length, ns = 1 + cases.sharing.length
    const lca = cases.parameter.length > 0
      ? ` · ${cases.parameter.length} LCA rerun${cases.parameter.length === 1 ? '' : 's'}`
      : ''
    return `${nc} case${nc === 1 ? '' : 's'} × ${ns} sharing${lca}`
  }
  return args?.runSensitivity ? 'Base configuration and every sharing principle' : 'Base configuration'
}

export function computeLabel(args: { runSensitivity?: boolean; cases?: CaseSelection | null } | null | undefined): string {
  const cases = args?.cases
  if (cases && (cases.parameter.length > 0 || cases.sharing.length > 0)) {
    const nc = 1 + cases.parameter.length, ns = 1 + cases.sharing.length
    const lca = cases.parameter.length > 0
      ? ` · ${cases.parameter.length} LCA rerun${cases.parameter.length === 1 ? '' : 's'}`
      : ''
    return `Computing AESA: ${nc} case${nc === 1 ? '' : 's'} × ${ns} sharing${lca}`
  }
  return args?.runSensitivity ? 'Computing AESA with sharing sensitivity…' : 'Computing AESA…'
}
