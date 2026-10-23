// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * LCA Calculator database switches through the in-app dialogs.
 *
 * Both switches asked window.confirm, which answers false in the packaged
 * WKWebView: once an activity was picked (or a result was on screen) the
 * database could never be changed. The selects are controlled, so they must
 * stay on the old value while the dialog is open and after Cancel.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { LCACalculator } from '../src/pages/LCACalculator'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useBOMStore } from '../src/stores/bomStore'
import * as client from '../src/api/client'
import type { ActivityLCAResult, ActivityPage, ActivitySummary, DatabaseResponse } from '../src/api/client'

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const DBS: DatabaseResponse[] = [
  { name: 'ei-3.10', size_mb: 100, activity_count: 20000 } as any,
  { name: 'ei-other', size_mb: 100, activity_count: 20000 } as any,
]
const ACTIVITIES: ActivitySummary[] = [
  { key: 'ei-3.10|c1', code: 'c1', name: 'market for battery, lithium-ion', product: 'battery, lithium-ion', location: 'GLO', unit: 'kg', database: 'ei-3.10' },
]
const PAGE: ActivityPage = { items: ACTIVITIES, total: 1 } as any
const METHODS = [{
  family: 'EF v3.1', categories: [{
    category: 'climate change',
    indicators: [{ indicator: 'GWP100', tuple: ['EF v3.1', 'climate change', 'GWP100'] }],
  }],
}]
const ACT_RESULT: ActivityLCAResult = {
  results: [{ method: ['EF v3.1', 'climate change', 'GWP100'], method_label: 'EF v3.1 › climate change › GWP100', score: 12.3, unit: 'kg CO2 eq', contributions: [] }],
  elapsed_seconds: 0.4,
} as any

beforeEach(() => {
  __resetDialogsForTests()
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.spyOn(client, 'getDatabases').mockResolvedValue(DBS)
  vi.spyOn(client, 'getActivities').mockResolvedValue(PAGE)
  vi.spyOn(client, 'searchAllActivities').mockResolvedValue(ACTIVITIES)
  vi.spyOn(client, 'getMethods').mockResolvedValue(METHODS as any)
  vi.spyOn(client, 'calculateActivityLCA').mockResolvedValue(ACT_RESULT)
  useBOMStore.setState({ archetypes: [], folders: [], fetchArchetypes: vi.fn() } as any)
})
afterEach(() => { cleanup(); __resetDialogsForTests() })

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }

async function setup() {
  const utils = render(<><LCACalculator /><DialogHost /></>)
  const { container } = utils
  await waitFor(() => expect(container.querySelector('select')).not.toBeNull())
  fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'activity')!)
  const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
  fireEvent.change(search, { target: { value: 'battery' } })
  await new Promise((r) => setTimeout(r, 500))
  const resultSel = '[data-testid="multi-item-selector-result-act:ei-3.10|c1"]'
  await waitFor(() => expect(container.querySelector(resultSel)).not.toBeNull())
  fireEvent.click(container.querySelector(resultSel) as HTMLElement)
  return utils
}

/** The activity-mode select sits directly after its "Database" label. */
function activityDbSelect(container: HTMLElement): HTMLSelectElement {
  const label = Array.from(container.querySelectorAll('label'))
    .find((l) => (l.textContent ?? '').trim() === 'Database' && l.nextElementSibling?.tagName === 'SELECT')!
  return label.nextElementSibling as HTMLSelectElement
}
/** The compute-database select is the other one listing both databases. */
function computeDbSelect(container: HTMLElement): HTMLSelectElement {
  const act = activityDbSelect(container)
  return Array.from(container.querySelectorAll('select'))
    .find((s) => s !== act && Array.from(s.options).some((o) => o.value === 'ei-other')) as HTMLSelectElement
}
const chipPresent = (container: HTMLElement) =>
  container.querySelector('[data-testid="multi-item-selector-chips"]')?.textContent?.includes('battery') ?? false

describe('activity database switch', () => {
  it('Cancel keeps the old database and the selected activity', async () => {
    const { container } = await setup()
    const sel = activityDbSelect(container)
    expect(sel.value).toBe('ei-3.10')
    expect(chipPresent(container)).toBe(true)
    await act(async () => { fireEvent.change(sel, { target: { value: 'ei-other' } }) })
    expect(screen.getByTestId('dialog')).toHaveAccessibleName('Switch to "ei-other"?')
    // Still the old value while the dialog is open.
    expect(activityDbSelect(container).value).toBe('ei-3.10')
    await click(screen.getByTestId('dialog-cancel'))
    expect(activityDbSelect(container).value).toBe('ei-3.10')
    expect(chipPresent(container)).toBe(true)
  })

  it('Switch changes the database and clears the selection', async () => {
    const { container } = await setup()
    await act(async () => { fireEvent.change(activityDbSelect(container), { target: { value: 'ei-other' } }) })
    await click(screen.getByTestId('dialog-confirm'))
    expect(activityDbSelect(container).value).toBe('ei-other')
    expect(chipPresent(container)).toBe(false)
  })
})

describe('compute database switch with a result on screen', () => {
  async function withResult() {
    const utils = await setup()
    const calc = Array.from(utils.container.querySelectorAll('button')).find((b) => /Calculate/.test(b.textContent ?? ''))!
    await waitFor(() => expect((calc as HTMLButtonElement).disabled).toBe(false))
    await click(calc)
    await waitFor(() => expect(client.calculateActivityLCA).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('lca-new-calculation')).toBeInTheDocument())
    return utils
  }

  it('Cancel keeps the old compute database', async () => {
    const { container } = await withResult()
    const before = computeDbSelect(container).value
    await act(async () => { fireEvent.change(computeDbSelect(container), { target: { value: 'ei-other' } }) })
    expect(screen.getByTestId('dialog')).toHaveAccessibleName('Switch the compute database?')
    expect(computeDbSelect(container).value).toBe(before)
    await click(screen.getByTestId('dialog-cancel'))
    expect(computeDbSelect(container).value).toBe(before)
    expect(before).not.toBe('ei-other')
  })

  it('Switch changes it', async () => {
    const { container } = await withResult()
    await act(async () => { fireEvent.change(computeDbSelect(container), { target: { value: 'ei-other' } }) })
    await click(screen.getByTestId('dialog-confirm'))
    expect(computeDbSelect(container).value).toBe('ei-other')
  })
})
