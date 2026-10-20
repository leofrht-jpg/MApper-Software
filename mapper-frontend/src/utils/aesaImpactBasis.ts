/* SPDX-License-Identifier: MPL-2.0 */
/**
 * What one AESA impact value is per, stated beside every number that shows it.
 *
 * The Sustainability Ratio divides an impact by a PER-YEAR allocated SOS. An
 * EVS40 run compared a whole-life pLCA total with that per-year SOS and nothing
 * on screen said the two were per different things. Every surface that shows
 * an impact (Detail table, Radar tooltip, the strip under the zone cards, the
 * Excel export) now names its basis, and the SOS's.
 *
 * The long label is word-for-word the backend's `impact_basis_label`, so the
 * screen and the exported workbook never describe the same number two ways.
 */
import type { AESAComputeResult } from '../api/client'

type Basis = Pick<AESAComputeResult, 'impact_basis' | 'lifetime_years'> | null | undefined

export function impactBasisLabel(r: Basis): string {
  if (r?.impact_basis === 'per_year' && r.lifetime_years) {
    return `per year: whole-life impact / ${r.lifetime_years} yr`
  }
  return 'per functional unit, as computed (not annualised)'
}

/** Short form for a column header or a tooltip line. */
export function impactBasisShort(r: Basis): string {
  return r?.impact_basis === 'per_year' && r.lifetime_years ? 'per yr' : 'per FU'
}

export const SOS_BASIS_SHORT = 'per yr'

/** The boundary's unit without its "per year" suffix ("kg CO2 eq/yr" -> "kg CO2 eq").
 *  SR rows carry the BOUNDARY's unit, which is per year; an impact shown with
 *  it would claim to be per year whatever its basis. Pair this with
 *  `impactBasisShort` for an impact, and keep the full unit for the SOS. */
export function quantityUnit(unit: string | null | undefined): string {
  return (unit ?? '').replace(/\s*\/\s*(yr|year|a)\s*$/i, '').trim()
}
