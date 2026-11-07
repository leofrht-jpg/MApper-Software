/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Years box and its basis rule, made visible. No rule and no number changed: Years is still
 * available only when every stage resolves to a basis, and a stage without one still counts once.
 * What changed is what the user can SEE and DO:
 *   - LCA Architect > Single-product LCA gets the per-stage basis dropdown (it had a hint that
 *     pointed at a control that was not on that screen);
 *   - Multi-item says which items did not take the typed years, and disables the box when none can;
 *   - "Annual stages count 1 year" says what happens while Years is empty.
 *
 * jsdom cannot show how the dropdown, the notes or the disabled box look, or that the hint reads
 * as one line; it proves which control exists, what it enables, and what text each state carries.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LCACalculator } from '../src/pages/LCACalculator'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { stageAmountsForPreset, canApplyLifetime, lifetimeBlockedReason } from '../src/components/impact/StageAmountsEditor'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import { useSessionStateStore } from '../src/stores/sessionStateStore'
import * as client from '../src/api/client'
import type { ArchetypeSummary } from '../src/api/client'

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const STAGES = ['Manufacturing', 'Use Phase', 'End of Life']
const IDS = { Manufacturing: 'n-mfg', 'Use Phase': 'n-use', 'End of Life': 'n-eol' }

/** A BEV-shaped archetype: Use Phase is annual (project default), Manufacturing and End of Life undeclared. */
const arcOf = (id: string, name: string, basis: Record<string, 'per_unit' | 'per_year' | null> = {}): ArchetypeSummary => ({
  id, name, folder: null, category: '', description: '', stages: STAGES, stage_ids: IDS,
  stage_basis: { Manufacturing: null, 'Use Phase': null, 'End of Life': null, ...basis },
  stage_annual: { Manufacturing: false, 'Use Phase': true, 'End of Life': false },
  material_count: 3, unlinked_count: 0, validation_error_rows: 0,
} as unknown as ArchetypeSummary)

// ── regression: the amounts are what they were ──────────────────────────────

describe('no number changed: stageAmountsForPreset and the Years gate are exactly as before', () => {
  const undeclared = arcOf('a', 'A')
  const declared = arcOf('b', 'B', { Manufacturing: 'per_unit', 'End of Life': 'per_unit' })

  it('years are never applied while a stage has no basis; every stage stays at 1', () => {
    expect(canApplyLifetime(undeclared, 'one_year')).toBe(false)
    expect(stageAmountsForPreset(undeclared, 'custom', 15, null, 'one_year')).toEqual({ Manufacturing: 1, 'Use Phase': 15, 'End of Life': 1 })
    // (the amounts helper itself scales a per-year stage; the gate in the callers is what keeps years out)
    expect(stageAmountsForPreset(undeclared, 'custom', null, null, 'one_year')).toEqual({ Manufacturing: 1, 'Use Phase': 1, 'End of Life': 1 })
  })

  it('with every stage declared, years scale ONLY the per-year stage', () => {
    expect(canApplyLifetime(declared, 'one_year')).toBe(true)
    expect(stageAmountsForPreset(declared, 'custom', 15, null, 'one_year')).toEqual({ Manufacturing: 1, 'Use Phase': 15, 'End of Life': 1 })
    expect(stageAmountsForPreset(declared, '1year', null)).toEqual({ Manufacturing: 1, 'Use Phase': 1, 'End of Life': 1 })
  })

  it('the 1-year preset and an undeclared stage are x1 in every combination', () => {
    for (const years of [null, 1, 15, 40]) {
      const a = stageAmountsForPreset(undeclared, '1year', years)
      expect(Object.values(a).every((v) => v === 1)).toBe(true)
    }
  })

  it('only the words of the hint changed', () => {
    expect(lifetimeBlockedReason(undeclared, 'one_year'))
      .toBe('Years need a basis on every stage. For Manufacturing and End of Life choose per unit (counted once).')
    expect(lifetimeBlockedReason(declared, 'one_year')).toBeNull()
  })
})

// ── Multi-item ──────────────────────────────────────────────────────────────

function seedMulti(archetypes: ArchetypeSummary[]) {
  act(() => {
    useBOMStore.setState({ archetypes, fetchArchetypes: vi.fn(() => Promise.resolve()), setStageBasis: vi.fn() } as any)
    useMultiProductLCAStore.setState({
      selectedItems: archetypes.map((a) => ({ type: 'archetype', archetype_id: a.id, display_name: a.name })),
    } as any)
  })
}

describe('Multi-item: which items took the years', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error stub
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    try { localStorage.clear() } catch { /* jsdom */ }
    vi.spyOn(client, 'getMethods').mockResolvedValue([])
    useActivityStore.setState({ activities: [], selectedDatabase: 'ei', searchActivities: vi.fn(), setDatabase: vi.fn(), setLocations: vi.fn(), setUnits: vi.fn(), distinctValues: {} } as any)
    useProjectStore.setState({ databases: [{ name: 'ei' }] as any, currentProject: 'p' } as any)
    usePLCAStore.setState({ databases: [], fetchDatabases: vi.fn() } as any)
    useMultiProductLCAStore.getState().reset()
  })
  afterEach(() => cleanup())

  const openCustom = () => fireEvent.click(screen.getByTestId('multi-product-global-preset-custom'))
  const years = () => screen.getByTestId('multi-product-global-lifetime') as HTMLInputElement

  it('names exactly the skipped items after years are typed, and not the one that took them', () => {
    seedMulti([
      arcOf('a1', 'Sedan'),                                                                   // Mfg, EoL undeclared
      arcOf('a2', 'Wagon', { Manufacturing: 'per_unit', 'End of Life': 'per_unit' }),         // can take years
      arcOf('a3', 'Van'),                                                                     // undeclared
    ])
    render(<MultiProductLCA />)
    openCustom()
    expect(years().disabled).toBe(false)                                    // one item can take them
    fireEvent.change(years(), { target: { value: '15' } })
    const note = screen.getByTestId('multi-product-years-skipped')
    expect(note.textContent).toBe('Years not applied to: Sedan, Van (declare a basis for Manufacturing and End of Life)')
    expect(note.textContent).not.toContain('Wagon')
    // and the eligible item really took them
    expect(screen.getByTestId('multi-product-stage-summary-arc:a2').textContent).toContain('15 yr')
    expect(screen.getByTestId('multi-product-stage-summary-arc:a1').textContent).not.toContain('15 yr')
  })

  it('no skipped item: no note, the old explanation stays', () => {
    seedMulti([arcOf('a2', 'Wagon', { Manufacturing: 'per_unit', 'End of Life': 'per_unit' })])
    render(<MultiProductLCA />)
    openCustom()
    fireEvent.change(years(), { target: { value: '15' } })
    expect(screen.queryByTestId('multi-product-years-skipped')).toBeNull()
    expect(screen.getByText(/applies to every item whose stages declare a basis/)).toBeInTheDocument()
  })

  it('the global box is disabled when no selected item can take years, and says so', () => {
    seedMulti([arcOf('a1', 'Sedan'), arcOf('a3', 'Van')])
    render(<MultiProductLCA />)
    openCustom()
    expect(years().disabled).toBe(true)
    expect(screen.getByTestId('multi-product-years-none').textContent).toBe('No selected item can take years yet')
    expect(screen.queryByTestId('multi-product-years-skipped')).toBeNull()
  })

  it('the longer explanation is behind the (i), not on screen', () => {
    seedMulti([arcOf('a1', 'Sedan')])
    render(<MultiProductLCA />)
    openCustom()
    expect(screen.queryByText(/Open an item below and pick the basis/)).toBeNull()
    fireEvent.click(screen.getByTestId('multi-product-years-info'))
    expect(screen.getByRole('note').textContent).toContain('Years need a basis on every stage. For Manufacturing and End of Life choose per unit (counted once).')
  })

  it('the per-item editor says "Annual stages count 1 year" while no years are entered', () => {
    seedMulti([arcOf('a1', 'Sedan')])
    render(<MultiProductLCA />)
    fireEvent.click(screen.getByTestId('multi-product-stage-summary-arc:a1'))     // open the item card
    expect(screen.getByTestId('stage-amounts-one-year-note').textContent).toBe('Annual stages count 1 year')
  })
})

// ── LCA Architect > Single-product LCA ──────────────────────────────────────

describe('LCA Architect: the basis dropdown that the Years hint points at', () => {
  let setStageBasis: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error stub
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    useSessionStateStore.getState().reset()
    vi.spyOn(client, 'getDatabases').mockResolvedValue([{ name: 'ei-3.10', size_mb: 1, activity_count: 1 } as any])
    vi.spyOn(client, 'getActivities').mockResolvedValue({ items: [], total: 0 } as any)
    vi.spyOn(client, 'searchAllActivities').mockResolvedValue([])
    vi.spyOn(client, 'getMethods').mockResolvedValue([])
    const base = arcOf('a1', 'Sedan')
    // The store action the page calls: declares the basis and "re-reads" the summary, as the real one does.
    setStageBasis = vi.fn(async (arcId: string, nodeId: string, basis: 'per_unit' | 'per_year' | 'unset') => {
      const stage = Object.entries(IDS).find(([, id]) => id === nodeId)![0]
      const cur = useBOMStore.getState().archetypes.find((a) => a.id === arcId)!
      const next = { ...cur, stage_basis: { ...cur.stage_basis, [stage]: basis === 'unset' ? null : basis } }
      useBOMStore.setState({ archetypes: useBOMStore.getState().archetypes.map((a) => (a.id === arcId ? next : a)) } as any)
    })
    useBOMStore.setState({ archetypes: [base], folders: [], fetchArchetypes: vi.fn(), setStageBasis } as any)
    const set = useSessionStateStore.getState().setValue
    set('lcaCalculator.fuMode', 'archetype')
    set('lcaCalculator.selectedArchetypes', [base])
  })
  afterEach(() => cleanup())

  const years = () => screen.getByTestId('lca-years-a1') as HTMLInputElement
  /** The multiplier box on a stage's row (the row that also holds that stage's basis dropdown). */
  const amountOf = (stage: string) =>
    (screen.getByTestId(`lca-basis-select-a1-${stage}`).parentElement!.querySelector('input') as HTMLInputElement).value
  const pick = async (stage: string, basis: string) => {
    await act(async () => { fireEvent.change(screen.getByTestId(`lca-basis-select-a1-${stage}`), { target: { value: basis } }) })
  }

  it('every stage row has the dropdown, Years is locked with the new hint, and the 1-year line shows', async () => {
    render(<LCACalculator />)
    await waitFor(() => screen.getByText('Stage amounts'))
    for (const s of STAGES) expect(screen.getByTestId(`lca-basis-select-a1-${s}`)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Custom'))
    expect(years().disabled).toBe(true)
    expect(screen.getByText('Years need a basis on every stage. For Manufacturing and End of Life choose per unit (counted once).')).toBeInTheDocument()
    expect(screen.getByTestId('lca-one-year-note-a1').textContent).toBe('Annual stages count 1 year')
  })

  it('declaring Manufacturing and End of Life enables Years; the typed years scale only the annual stage', async () => {
    render(<LCACalculator />)
    await waitFor(() => screen.getByText('Stage amounts'))
    fireEvent.click(screen.getByText('Custom'))
    await pick('Manufacturing', 'per_unit')
    expect(years().disabled).toBe(true)                                     // End of Life still undeclared
    await pick('End of Life', 'per_unit')
    expect(setStageBasis).toHaveBeenCalledWith('a1', 'n-mfg', 'per_unit')   // the same store action as Impact Assessment
    expect(setStageBasis).toHaveBeenCalledWith('a1', 'n-eol', 'per_unit')
    await waitFor(() => expect(years().disabled).toBe(false))
    fireEvent.change(years(), { target: { value: '15' } })
    const amounts = STAGES.map((s) => amountOf(s))
    expect(amounts).toEqual(['1', '15', '1'])                               // Manufacturing 1, Use Phase 15, End of Life 1
    expect(screen.queryByTestId('lca-one-year-note-a1')).toBeNull()         // years entered: the 1-year line is gone
  })

  it('un-declaring a stage locks Years again and returns the amounts to 1', async () => {
    render(<LCACalculator />)
    await waitFor(() => screen.getByText('Stage amounts'))
    fireEvent.click(screen.getByText('Custom'))
    await pick('Manufacturing', 'per_unit'); await pick('End of Life', 'per_unit')
    await waitFor(() => expect(years().disabled).toBe(false))
    fireEvent.change(years(), { target: { value: '15' } })
    await pick('End of Life', '')                                           // back to "not declared"
    await waitFor(() => expect(years().disabled).toBe(true))
    expect(amountOf('Use Phase')).toBe('1')
  })
})
