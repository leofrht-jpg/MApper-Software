/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { StageAmountsEditor, defaultStageAmounts, stageAmountsEqual } from '../src/components/impact/StageAmountsEditor'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import type { ArchetypeSummary } from '../src/api/client'

// UX-bundle Issue 2 — Stage Amounts editor for Impact Assessment Single
// product mode. Mirrors LCA Architect's per-archetype block, lives at the
// wrapper level in SingleProductImpact.tsx, persists per-archetype in
// useSingleProductImpactStore so tab/round-trip/archetype switches don't
// destroy edits.

const mkArc = (id: string, stages: string[], annual: Record<string, boolean> = {}): ArchetypeSummary => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id, name: id, folder: null, material_count: 0, unlinked_count: 0,
  stages, stage_annual: annual,
} as any)

beforeEach(() => {
  useSingleProductImpactStore.getState().reset()
})

describe('StageAmountsEditor', () => {
  it('renders preset toggle, lifetime input, and per-stage rows', () => {
    const arc = mkArc('a1', ['Manufacturing', 'Use Phase', 'End of Life'], { 'Use Phase': true })
    const value = defaultStageAmounts(arc)
    const { getByTestId, queryByTestId } = render(
      <StageAmountsEditor archetype={arc} value={value} onChange={() => {}} />,
    )
    expect(getByTestId('stage-amounts-editor')).toBeInTheDocument()
    expect(getByTestId('stage-amounts-preset-1year')).toBeInTheDocument()
    expect(getByTestId('stage-amounts-preset-lifetime')).toBeInTheDocument()
    expect(getByTestId('stage-amounts-preset-custom')).toBeInTheDocument()
    expect(getByTestId('stage-amounts-input-Manufacturing')).toBeInTheDocument()
    expect(getByTestId('stage-amounts-input-Use Phase')).toBeInTheDocument()
    // Lifetime input only shows when preset is 'lifetime'.
    expect(queryByTestId('stage-amounts-lifetime')).toBeNull()
  })

  it('switching to lifetime preset multiplies annual stages by lifetime years', () => {
    const arc = mkArc('a1', ['Manufacturing', 'Use Phase'], { 'Use Phase': true })
    const value = defaultStageAmounts(arc)
    let captured = value
    const { getByTestId } = render(
      <StageAmountsEditor archetype={arc} value={value} onChange={(v) => { captured = v }} />,
    )
    fireEvent.click(getByTestId('stage-amounts-preset-lifetime'))
    expect(captured.preset).toBe('lifetime')
    // Annual stage scales to lifetime; non-annual stays at 1.
    expect(captured.amounts['Use Phase']).toBe(15)
    expect(captured.amounts['Manufacturing']).toBe(1)
  })

  it('returns null UI when archetype has no stages', () => {
    const arc = mkArc('a1', [])
    const value = defaultStageAmounts(arc)
    const { queryByTestId } = render(
      <StageAmountsEditor archetype={arc} value={value} onChange={() => {}} />,
    )
    expect(queryByTestId('stage-amounts-editor')).toBeNull()
  })
})

describe('stageAmountsEqual', () => {
  it('treats null/null and undefined/undefined as equal', () => {
    expect(stageAmountsEqual(null, null)).toBe(true)
    expect(stageAmountsEqual(undefined, undefined)).toBe(true)
    expect(stageAmountsEqual(null, undefined)).toBe(true)
  })

  it('flags asymmetric null/value as unequal', () => {
    expect(stageAmountsEqual(null, { Manufacturing: 1 })).toBe(false)
    expect(stageAmountsEqual({ Manufacturing: 1 }, null)).toBe(false)
  })

  it('compares values key by key', () => {
    expect(stageAmountsEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    expect(stageAmountsEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false)
    expect(stageAmountsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe('useSingleProductImpactStore — stage amounts persistence', () => {
  it('persists per-archetype edits without clearing on archetype switch', () => {
    const store = useSingleProductImpactStore.getState()
    const arcA = mkArc('a1', ['Manufacturing'])
    const arcB = mkArc('a2', ['Manufacturing'])

    store.setStageAmountsForArc(arcA.id, { preset: 'custom', lifetime: 15, amounts: { Manufacturing: 7 } })
    store.setStageAmountsForArc(arcB.id, { preset: 'custom', lifetime: 15, amounts: { Manufacturing: 3 } })

    const after = useSingleProductImpactStore.getState()
    expect(after.stageAmountsByArc[arcA.id].amounts.Manufacturing).toBe(7)
    expect(after.stageAmountsByArc[arcB.id].amounts.Manufacturing).toBe(3)
  })

  it('does NOT clear results when stage amounts change (warn-when-stale pattern)', () => {
    const store = useSingleProductImpactStore.getState()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.setStaticResult({ archetype_id: 'a1', archetype_name: 'A', scope: 'all', amount: 1, stage_amounts: { Manufacturing: 1 }, stages_included: [], results: [], elapsed_seconds: 0.1 } as any)
    store.setStageAmountsForArc('a1', { preset: 'custom', lifetime: 15, amounts: { Manufacturing: 7 } })

    // Result is preserved — panels detect staleness via stageAmountsEqual.
    const after = useSingleProductImpactStore.getState()
    expect(after.staticResult).not.toBeNull()
    expect(after.stageAmountsByArc['a1'].amounts.Manufacturing).toBe(7)
  })
})
