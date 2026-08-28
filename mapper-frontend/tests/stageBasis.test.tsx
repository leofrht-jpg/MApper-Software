/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import {
  StageAmountsEditor,
  stageAmountsForPreset,
  stageBasis,
  undeclaredStages,
  canApplyLifetime,
  lifetimeBlockedReason,
} from '../src/components/impact/StageAmountsEditor'
import type { ArchetypeSummary } from '../src/api/client'

// `basis` is WHAT ONE ROW'S QUANTITY MEANS; `scope` is WHEN THE FLEET COUNTS
// IT. Deriving one from the other is the defect these tests exist to stop: it
// multiplied a per-kWh Battery Circularity use phase by 15 while leaving its
// manufacturing at 1 -- an incoherent functional unit, not a rescale.

function arc(
  stages: string[],
  basis: Record<string, 'per_unit' | 'per_year' | null>,
  annual: Record<string, boolean> = {},
): ArchetypeSummary {
  return {
    id: 'a1', name: 'A', description: null, category: null, folder: null,
    material_count: 0, unlinked_count: 0, stages,
    stage_basis: basis,
    stage_ids: Object.fromEntries(stages.map((s) => [s, `node-${s}`])),
    stage_annual: annual,
    created_at: '', updated_at: '',
  } as ArchetypeSummary
}

// WP5 shape: mixed bases inside one archetype.
const WP5 = arc(
  ['Manufacturing', 'Use Phase', 'Maintenance', 'End of Life'],
  { Manufacturing: 'per_unit', 'Use Phase': 'per_year', Maintenance: 'per_year', 'End of Life': 'per_unit' },
  { Manufacturing: false, 'Use Phase': true, Maintenance: true, 'End of Life': false },
)
// Battery Circularity shape: every stage already per unit of service.
const BESS = arc(
  ['Manufacturing', 'Use Phase', 'End of Life'],
  { Manufacturing: 'per_unit', 'Use Phase': 'per_unit', 'End of Life': 'per_unit' },
  { Manufacturing: false, 'Use Phase': true, 'End of Life': false },   // scope says "annual"
)
// Everything migrates to this: undeclared.
const UNSET = arc(
  ['Manufacturing', 'Use Phase', 'End of Life'],
  { Manufacturing: null, 'Use Phase': null, 'End of Life': null },
  { Manufacturing: false, 'Use Phase': true, 'End of Life': false },
)

describe('the multiplier follows the declaration, never the scope', () => {
  it('scales only stages DECLARED per_year', () => {
    expect(stageAmountsForPreset(WP5, 'lifetime', 15)).toEqual({
      Manufacturing: 1, 'Use Phase': 15, Maintenance: 15, 'End of Life': 1,
    })
  })

  it('leaves a per_unit stage at 1 even when scope says annual', () => {
    // BESS "Use Phase" has scope=stock -> stage_annual true -> the old code
    // multiplied it by 15. Declared per_unit, it must stay at 1.
    expect(stageAmountsForPreset(BESS, 'lifetime', 15)).toEqual({
      Manufacturing: 1, 'Use Phase': 1, 'End of Life': 1,
    })
  })

  it('leaves an UNDECLARED stage at 1 — the migration default', () => {
    // x1 is the one multiplier both conventions agree on, which is what makes
    // it safe as a default for WP5 and Battery Circularity alike.
    expect(stageAmountsForPreset(UNSET, 'lifetime', 15)).toEqual({
      Manufacturing: 1, 'Use Phase': 1, 'End of Life': 1,
    })
    expect(stageAmountsForPreset(UNSET, '1year', 15)).toEqual({
      Manufacturing: 1, 'Use Phase': 1, 'End of Life': 1,
    })
  })

  it('never reads stage_annual as a fallback', () => {
    // Same archetype, basis stripped entirely: scope still says annual, and
    // the multiplier must still be 1.
    const noBasis = { ...WP5, stage_basis: undefined } as ArchetypeSummary
    expect(stageBasis(noBasis, 'Use Phase')).toBeNull()
    expect(stageAmountsForPreset(noBasis, 'lifetime', 15)['Use Phase']).toBe(1)
  })
})

describe('lifetime availability', () => {
  it('is blocked while any stage is undeclared, and names them', () => {
    expect(canApplyLifetime(UNSET)).toBe(false)
    expect(undeclaredStages(UNSET)).toEqual(['Manufacturing', 'Use Phase', 'End of Life'])
    expect(lifetimeBlockedReason(UNSET)).toContain('Use Phase')
  })

  it('is available for a fully declared archetype with a per_year stage', () => {
    expect(canApplyLifetime(WP5)).toBe(true)
    expect(lifetimeBlockedReason(WP5)).toBeNull()
  })

  it('is declared-but-inert when nothing is per_year, and says why', () => {
    expect(canApplyLifetime(BESS)).toBe(true)
    expect(lifetimeBlockedReason(BESS)).toMatch(/no per-year stages/i)
  })
})

describe('declaring a basis in-app', () => {
  const value = { preset: '1year' as const, lifetime: 15, amounts: {} }

  it('renders a per-stage control and reports the stage + choice', () => {
    const onDeclareBasis = vi.fn()
    const { getByTestId } = render(
      <StageAmountsEditor archetype={UNSET} value={value} onChange={() => {}}
                          onDeclareBasis={onDeclareBasis} />,
    )
    fireEvent.change(getByTestId('stage-basis-select-Use Phase'), { target: { value: 'per_year' } })
    expect(onDeclareBasis).toHaveBeenCalledWith('Use Phase', 'per_year')
  })

  it('clears back to undeclared', () => {
    const onDeclareBasis = vi.fn()
    const { getByTestId } = render(
      <StageAmountsEditor archetype={WP5} value={value} onChange={() => {}}
                          onDeclareBasis={onDeclareBasis} />,
    )
    fireEvent.change(getByTestId('stage-basis-select-Use Phase'), { target: { value: '' } })
    expect(onDeclareBasis).toHaveBeenCalledWith('Use Phase', 'unset')
  })

  it('states the reason in the panel, not only on hover', () => {
    const { getByTestId } = render(
      <StageAmountsEditor archetype={UNSET} value={value} onChange={() => {}} />,
    )
    expect(getByTestId('stage-amounts-lifetime-blocked').textContent).toMatch(/declare a basis/i)
    expect((getByTestId('stage-amounts-preset-lifetime') as HTMLButtonElement).disabled).toBe(true)
  })

  it('falls back to a read-only label when no declare handler is wired', () => {
    const { getByTestId, queryByTestId } = render(
      <StageAmountsEditor archetype={UNSET} value={value} onChange={() => {}} />,
    )
    expect(queryByTestId('stage-basis-select-Use Phase')).toBeNull()
    expect(getByTestId('stage-basis-label-Use Phase').textContent).toMatch(/not declared/i)
  })
})

describe('lifetime can reference a parameter', () => {
  it('drives the horizon from the project parameter instead of a typed duplicate', () => {
    const onChange = vi.fn()
    const { getByTestId } = render(
      <StageAmountsEditor
        archetype={WP5}
        value={{ preset: 'lifetime', lifetime: 15, amounts: {} }}
        onChange={onChange}
        parameters={[{ name: 'bess_lifetime_years', value: 15 }, { name: 'other', value: 8 }]}
      />,
    )
    fireEvent.change(getByTestId('stage-amounts-lifetime-param'), { target: { value: 'other' } })
    const next = onChange.mock.calls[0][0]
    expect(next.lifetimeParam).toBe('other')
    expect(next.lifetime).toBe(8)
    expect(next.amounts['Use Phase']).toBe(8)   // per_year scales
    expect(next.amounts.Manufacturing).toBe(1)  // per_unit does not
  })
})
