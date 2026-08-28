/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import {
  stageAmountsForPreset,
  stageBasis,
  canApplyLifetime,
  lifetimeBlockedReason,
} from '../src/components/impact/StageAmountsEditor'
import type { ArchetypeSummary } from '../src/api/client'

function arc(stages: string[], basis: Record<string, 'per_unit' | 'per_year' | null> = {}) {
  return {
    id: 'a', name: 'A', description: null, category: null, folder: null,
    material_count: 0, unlinked_count: 0, stages,
    stage_basis: basis, stage_ids: {}, stage_annual: {},
    created_at: '', updated_at: '',
  } as ArchetypeSummary
}

// MAp-test's shape: four stages, none declared (everything migrated to
// undeclared by PR #41).
const WP5 = arc(['Manufacturing', 'Use Phase', 'Maintenance', 'End of Life'])
// Battery Circularity's shape: three stages, none declared.
const BESS = arc(['Manufacturing', 'Use Phase', 'End of Life'])

describe('the project setting supplies the default for Use Phase and Maintenance only', () => {
  it('one_year makes an undeclared Use Phase and Maintenance per-year', () => {
    expect(stageBasis(WP5, 'Use Phase', 'one_year')).toBe('per_year')
    expect(stageBasis(WP5, 'Maintenance', 'one_year')).toBe('per_year')
  })

  it('never touches Manufacturing or End of Life', () => {
    for (const basis of ['one_year', 'life_cycle'] as const) {
      expect(stageBasis(WP5, 'Manufacturing', basis)).toBeNull()
      expect(stageBasis(WP5, 'End of Life', basis)).toBeNull()
    }
  })

  it('life_cycle makes an undeclared Use Phase per-unit', () => {
    expect(stageBasis(BESS, 'Use Phase', 'life_cycle')).toBe('per_unit')
    expect(stageAmountsForPreset(BESS, 'lifetime', 15, null, 'life_cycle')['Use Phase']).toBe(1)
  })

  it('a per-stage declaration still overrides the project setting', () => {
    // PR #41's override, retained for an archetype that mixes bases against
    // its project's convention (WP5's station archetypes).
    const mixed = arc(['Use Phase'], { 'Use Phase': 'per_unit' })
    expect(stageBasis(mixed, 'Use Phase', 'one_year')).toBe('per_unit')
    expect(stageAmountsForPreset(mixed, 'lifetime', 15, null, 'one_year')['Use Phase']).toBe(1)
  })
})

describe('the basis = None revision must move no number', () => {
  it('MAp-test at the DEFAULT preset is byte-identical before and after', () => {
    // The gate. PR #41 shipped "undeclared -> forced x1"; this revises it to
    // "undeclared -> inherit the project setting". Existing projects resolve to
    // one_year, and the default preset is 1 year, so every multiplier must
    // still be exactly 1 -- the same values PR #41 produced.
    const before = stageAmountsForPreset(WP5, '1year', 15)             // no setting
    const after = stageAmountsForPreset(WP5, '1year', 15, null, 'one_year')
    expect(after).toEqual(before)
    expect(Object.values(after)).toEqual([1, 1, 1, 1])
  })

  it('and Battery Circularity at the default preset is likewise unmoved', () => {
    expect(stageAmountsForPreset(BESS, '1year', 15, null, 'life_cycle'))
      .toEqual(stageAmountsForPreset(BESS, '1year', 15))
  })

  it('with no project setting at all, behaviour is exactly PR #41', () => {
    // Absent projectBasis, undeclared still forces 1 even on Lifetime.
    expect(stageAmountsForPreset(WP5, 'lifetime', 15)['Use Phase']).toBe(1)
    expect(canApplyLifetime(WP5)).toBe(false)
  })
})

describe('lifetime availability follows the resolved basis', () => {
  it('one_year unblocks Lifetime for a WP5-shaped archetype', () => {
    // Manufacturing / End of Life are not project-defaulted, so they stay
    // undeclared and Lifetime remains blocked until they are declared.
    expect(canApplyLifetime(WP5, 'one_year')).toBe(false)
    expect(lifetimeBlockedReason(WP5, 'one_year')).toContain('Manufacturing')

    const declared = arc(['Manufacturing', 'Use Phase'],
      { Manufacturing: 'per_unit', 'Use Phase': null })
    expect(canApplyLifetime(declared, 'one_year')).toBe(true)
    expect(stageAmountsForPreset(declared, 'lifetime', 15, null, 'one_year'))
      .toEqual({ Manufacturing: 1, 'Use Phase': 15 })
  })

  it('life_cycle leaves Lifetime inert and says why', () => {
    const declared = arc(['Manufacturing', 'Use Phase'],
      { Manufacturing: 'per_unit', 'Use Phase': null })
    expect(canApplyLifetime(declared, 'life_cycle')).toBe(true)
    expect(lifetimeBlockedReason(declared, 'life_cycle')).toMatch(/no per-year stages/i)
  })
})

// ── The hidden control must explain itself ON the page it is missing from ──

import { render, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { useBOMStore } from '../src/stores/bomStore'
import { useProjectSettingsStore } from '../src/stores/projectSettingsStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, getProjectSettings: vi.fn().mockResolvedValue({ use_phase_basis: 'life_cycle' }) }
})

const ARC = {
  id: 'arc-1', name: 'BESS', description: null, category: null, folder: null,
  material_count: 1, unlinked_count: 0,
  stages: ['Manufacturing', 'Use Phase', 'End of Life'],
  stage_basis: {}, stage_ids: {}, stage_annual: {}, created_at: '', updated_at: '',
} as ArchetypeSummary

function seed(basis: 'life_cycle' | 'one_year') {
  useBOMStore.setState({ archetypes: [ARC], fetchArchetypes: vi.fn() } as never)
  useProjectSettingsStore.setState({
    settings: { use_phase_basis: basis }, isLoading: false, error: null,
  } as never)
  useSingleProductImpactStore.getState().reset()
  useSingleProductImpactStore.getState().setArchetypeId('arc-1')
}

describe('Life cycle hides Stage amounts, and says so where it is missing', () => {
  it('hides the control and explains it on the Single-product page', () => {
    seed('life_cycle')
    const { queryByTestId, getByTestId } = render(<SingleProductImpact />)
    expect(queryByTestId('single-product-stage-amounts')).toBeNull()
    const note = getByTestId('single-product-stage-amounts-hidden-note')
    expect(note.textContent).toMatch(/life cycle/i)
    expect(note.textContent).toMatch(/hidden/i)
  })

  it('links to the setting rather than leaving the user to find it', () => {
    seed('life_cycle')
    const onNavigate = vi.fn()
    const { getByTestId } = render(<SingleProductImpact onNavigate={onNavigate} />)
    fireEvent.click(getByTestId('single-product-stage-amounts-hidden-link'))
    expect(onNavigate).toHaveBeenCalledWith('archetypes')
  })

  it('One year shows the control and no note', () => {
    seed('one_year')
    const { queryByTestId } = render(<SingleProductImpact />)
    expect(queryByTestId('single-product-stage-amounts')).not.toBeNull()
    expect(queryByTestId('single-product-stage-amounts-hidden-note')).toBeNull()
  })
})
