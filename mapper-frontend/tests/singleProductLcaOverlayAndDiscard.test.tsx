/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, act, cleanup, screen } from '@testing-library/react'
import { LCACalculator } from '../src/pages/LCACalculator'
import { SupplyChainTreeAction } from '../src/components/lca/SupplyChainTreeAction'
import { OVERLAY_REVEAL_MS } from '../src/components/ui/ComputeOverlay'
import { useBOMStore } from '../src/stores/bomStore'
import { useSessionStateStore } from '../src/stores/sessionStateStore'
import * as client from '../src/api/client'
import type { ActivityPage, ActivitySummary, DatabaseResponse, ActivityLCAResult } from '../src/api/client'

/**
 * LCA Architect > Single-product LCA: Calculate shows the SAME full-screen overlay as Impact
 * Assessment (<ComputeOverlay>, a real elapsed counter, no invented percentage), and removes
 * it when the run ends. The supply chain tree keeps its inline card, whose Discard button is
 * the danger <Button> with its note behind an (i).
 *
 * jsdom cannot show how the overlay looks, whether it covers the page, or that Discard is
 * actually red on screen: it can only prove which component renders and which style the
 * button is given.
 */

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})
vi.mock('../src/components/lca/ContributionAnalysisPanel', () => ({
  ContributionAnalysisPanel: () => <div data-testid="tree-panel" />,
}))

const DBS: DatabaseResponse[] = [{ name: 'ei-3.10', size_mb: 100, activity_count: 20000 } as any]
const ACT: ActivitySummary = {
  key: 'ei-3.10|c1', code: 'c1', name: 'market for battery', product: 'battery', location: 'GLO', unit: 'kg', database: 'ei-3.10',
}
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

let resolveCalc: (r: ActivityLCAResult) => void

beforeEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  useSessionStateStore.getState().reset()
  vi.spyOn(client, 'getDatabases').mockResolvedValue(DBS)
  vi.spyOn(client, 'getActivities').mockResolvedValue({ items: [ACT], total: 1 } as ActivityPage)
  vi.spyOn(client, 'searchAllActivities').mockResolvedValue([ACT])
  vi.spyOn(client, 'getMethods').mockResolvedValue(METHODS as any)
  vi.spyOn(client, 'calculateActivityLCA').mockImplementation(
    () => new Promise<ActivityLCAResult>((resolve) => { resolveCalc = resolve }),
  )
  useBOMStore.setState({ archetypes: [], folders: [], fetchArchetypes: vi.fn() } as any)
  const set = useSessionStateStore.getState().setValue
  set('lcaCalculator.fuMode', 'activity')
  set('lcaCalculator.actDemand', [{ act: ACT, amount: 1 }])
})
afterEach(() => { cleanup() })

describe('Single-product LCA: Calculate shows the shared full-screen overlay', () => {
  it('overlay with a real elapsed counter while it runs, and gone afterwards', async () => {
    const { container } = render(<LCACalculator />)
    await waitFor(() => expect(container.querySelector('select')).not.toBeNull())
    expect(screen.queryByTestId('activity-lca-progress')).toBeNull()

    const btn = Array.from(container.querySelectorAll('button')).find((b) => /^\s*Calculate/.test(b.textContent ?? '')) as HTMLButtonElement
    await waitFor(() => expect(btn.disabled).toBe(false))
    await act(async () => { fireEvent.click(btn) })

    // The same component Impact Assessment uses: a modal dialog portalled to the body.
    const overlay = await screen.findByTestId('activity-lca-progress')
    expect(overlay.getAttribute('role')).toBe('dialog')
    expect(overlay.getAttribute('aria-modal')).toBe('true')
    expect(document.body.contains(overlay) && !container.contains(overlay)).toBe(true)

    // The card appears after the reveal delay, with the title and the real counter.
    const card = await screen.findByTestId('activity-lca-progress-card', {}, { timeout: OVERLAY_REVEAL_MS + 1500 })
    expect(card).toBeInTheDocument()
    expect(screen.getByTestId('activity-lca-progress-title').textContent).toBe('Calculating LCA')
    expect(screen.getByTestId('activity-lca-progress-detail').textContent).toContain('1 activity')
    expect(screen.getByTestId('activity-lca-progress-detail').textContent).toContain('1 indicator')
    expect(screen.getByTestId('activity-lca-progress-elapsed').textContent).toMatch(/^\d+:\d{2} elapsed$/)
    // no fabricated progress: no percentage in the counter, no bar
    expect(screen.getByTestId('activity-lca-progress-elapsed').textContent).not.toContain('%')
    expect(card.querySelector('[style*="width:"][style*="%"]')).toBeNull()

    await act(async () => { resolveCalc(ACT_RESULT) })
    await waitFor(() => expect(screen.queryByTestId('activity-lca-progress')).toBeNull())
    expect(document.getElementById('root')?.hasAttribute('inert') ?? false).toBe(false)
  })

  it('the overlay is removed when the calculation fails too', async () => {
    vi.mocked(client.calculateActivityLCA).mockRejectedValueOnce(new Error('boom'))
    const { container } = render(<LCACalculator />)
    await waitFor(() => expect(container.querySelector('select')).not.toBeNull())
    const btn = Array.from(container.querySelectorAll('button')).find((b) => /^\s*Calculate/.test(b.textContent ?? '')) as HTMLButtonElement
    await waitFor(() => expect(btn.disabled).toBe(false))
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => expect(screen.queryByTestId('activity-lca-progress')).toBeNull())
  })
})

describe('supply chain tree card: Discard is the danger button, its note is behind an (i)', () => {
  const props = { testId: 'lca-activity', error: null, discarded: false, databaseNote: null, onBuild: () => {}, onDiscard: () => {} }

  it('Discard uses the danger variant of components/ui/Button (not the raw outline link)', () => {
    render(<SupplyChainTreeAction {...props} running />)
    const discard = screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement
    expect(discard.style.backgroundColor).toBe('var(--danger)')
    expect(discard.style.color).toBe('var(--text-inverse)')
    expect(discard.style.cursor).toBe('pointer')   // the Button primitive, not a bare <button>
  })

  it('Discard still calls onDiscard', () => {
    const onDiscard = vi.fn()
    render(<SupplyChainTreeAction {...props} running onDiscard={onDiscard} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('the Discard note is not on screen until the (i) is opened, then it is, and Escape closes it', () => {
    render(<SupplyChainTreeAction {...props} running />)
    expect(screen.queryByText(/stops waiting for the result/)).toBeNull()
    const info = screen.getByRole('button', { name: 'About discarding' })
    fireEvent.click(info)
    expect(screen.getByRole('note').textContent).toBe(
      'Discard stops waiting for the result. The server may keep computing until it finishes.')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('the build hint is short (under 8 words) and stays visible; nothing else is permanently printed', () => {
    render(<SupplyChainTreeAction {...props} running={false} />)
    const hint = screen.getByTestId('lca-tree-hint').textContent ?? ''
    expect(hint).toBe('Up to a minute on large databases.')
    expect(hint.split(/\s+/).length).toBeLessThan(8)
    expect(screen.queryByText(/stops waiting/)).toBeNull()
  })
})
