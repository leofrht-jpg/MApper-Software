/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor, act, fireEvent } from '@testing-library/react'
import { SingleProductProjectedPanel } from '../src/components/impact/SingleProductProjectedPanel'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import { usePLCAStore } from '../src/stores/plcaStore'

// Patch 5AY — single-item Prospective COLD LOAD (opened without visiting
// Static, so the 4F Static→Projected mirror has no source). Before: it landed
// 0/N (image 1). Now: a non-customizing cold-seed seeds all-N via the same
// single-echo + skip-ref path the mirror uses, so projectedCustomized stays
// false and the mirror still takes over if Static later publishes.

const FAM = 'EF v3.1 (E,T)'
const T = (c: string, i: string) => [FAM, c, i]
const MOCK = [{ family: FAM, categories: [
  { category: 'climate change', indicators: [{ indicator: 'GWP100', tuple: T('climate change', 'GWP100') }] },
  { category: 'acidification', indicators: [{ indicator: 'AE', tuple: T('acidification', 'AE') }] },
  { category: 'land use', indicators: [{ indicator: 'SQI', tuple: T('land use', 'SQI') }] },
  { category: 'water use', indicators: [{ indicator: 'UDP', tuple: T('water use', 'UDP') }] },
] }]
const N = 4

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, getMethods: vi.fn(() => Promise.resolve(MOCK)) }
})

beforeEach(() => {
  // @ts-expect-error minimal jsdom stub for recharts
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useSingleProductImpactStore.getState().reset()
  usePLCAStore.setState({
    databases: [{ name: 'ei-ssp2-2030', base_db: 'ecoinvent-3.10-cutoff', iam: 'remind', ssp: 'SSP2-PkBudg1150', year: 2030, years: [2030], mode: 'separate', created_at: 'x' }] as any,
  })
})

const countChecked = (root: HTMLElement) => root.querySelectorAll('input[type=checkbox]:checked').length

describe('Patch 5AY — single-item Prospective cold load', () => {
  it('cold load (no Static visit) lands all-N, projectedCustomized false', async () => {
    const { container } = render(<SingleProductProjectedPanel archetypeId="arc-1" />)
    // The cold-seed picks up the full set once getMethods resolves.
    await waitFor(() => expect(countChecked(container)).toBe(N))
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBeFalsy()
  })

  it('after the cold seed, a later Static change is still mirrored (inheritance intact)', async () => {
    const { container } = render(<SingleProductProjectedPanel archetypeId="arc-1" />)
    await waitFor(() => expect(countChecked(container)).toBe(N))
    // Static publishes a SUBSET (1 method) after the cold seed.
    await act(async () => {
      useSingleProductImpactStore.getState().setStaticConfigForArc('arc-1', {
        scope: 'all', selectedMethods: [T('climate change', 'GWP100')],
      })
      await new Promise((r) => setTimeout(r, 20))
    })
    // Mirror overrode the cold default with Static's selection — not frozen.
    await waitFor(() => expect(countChecked(container)).toBe(1))
    expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBeFalsy()
  })

  it('a real user change to Prospective methods sets projectedCustomized true (mirror freezes)', async () => {
    const { container } = render(<SingleProductProjectedPanel archetypeId="arc-1" />)
    await waitFor(() => expect(countChecked(container)).toBe(N))
    // User deselects one indicator (all-N → N-1) — a genuine edit.
    const boxes = container.querySelectorAll('input[type=checkbox]')
    await act(async () => { fireEvent.click(boxes[0]) })
    await waitFor(() => expect(useSingleProductImpactStore.getState().projectedCustomizedByArc['arc-1']).toBe(true))
    // A subsequent Static change must NOT override the user's customized selection.
    await act(async () => {
      useSingleProductImpactStore.getState().setStaticConfigForArc('arc-1', {
        scope: 'all', selectedMethods: [T('climate change', 'GWP100')],
      })
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(countChecked(container)).toBe(N - 1) // frozen at the user's edit, not mirrored to 1
  })
})
