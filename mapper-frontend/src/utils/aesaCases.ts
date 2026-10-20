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
import type { ParameterTable, SharingPreset } from '../api/client'

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
