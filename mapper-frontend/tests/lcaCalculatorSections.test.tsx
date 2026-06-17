/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, within } from '@testing-library/react'
import { LCACalculator } from '../src/pages/LCACalculator'
import { useBOMStore } from '../src/stores/bomStore'
import * as client from '../src/api/client'
import type { ActivityPage, ActivitySummary, DatabaseResponse, ActivityLCAResult } from '../src/api/client'

// Patch 5N — Configuration + Results collapsible (5H/5K pattern) in
// LCA Architect → Single-product LCA. Patch 5G — "New Calculation" reads as a
// secondary button. Lock the mechanisms.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const DBS: DatabaseResponse[] = [{ name: 'ei-3.10', size_mb: 100, activity_count: 20000 } as any]
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

const bodyWrapperOf = (node: HTMLElement) => node.parentElement as HTMLElement

async function renderCalc() {
  const utils = render(<LCACalculator />)
  await waitFor(() => expect(utils.container.querySelector('select')).not.toBeNull())
  return utils
}

// Find a CollapsibleCard <section> by its heading text.
function sectionByTitle(container: HTMLElement, title: string): HTMLElement | null {
  const headings = Array.from(container.querySelectorAll('h3'))
  const h = headings.find((el) => (el.textContent ?? '').trim() === title)
  return h ? (h.closest('section') as HTMLElement) : null
}

describe('LCA Calculator — Configuration collapsible (Patch 5N)', () => {
  it('Configuration renders inside the shared CollapsibleCard primitive', async () => {
    const { container } = await renderCalc()
    const body = container.querySelector('[data-testid="lca-config-body"]') as HTMLElement
    expect(body).not.toBeNull()
    const section = sectionByTitle(container, 'Configuration')
    expect(section).not.toBeNull()
    expect(section!.contains(body)).toBe(true)
  })

  it('toggling Configuration flips the body-wrapper display (node persists, not unmounted)', async () => {
    const { container } = await renderCalc()
    const body = container.querySelector('[data-testid="lca-config-body"]') as HTMLElement
    expect(bodyWrapperOf(body).style.display).toBe('block') // expanded by default

    const heading = within(sectionByTitle(container, 'Configuration')!).getByRole('heading', { name: 'Configuration' })
    fireEvent.click(heading)
    expect(bodyWrapperOf(body).style.display).toBe('none')
    // Same node persists (visibility-toggle, not conditional unmount).
    expect(container.querySelector('[data-testid="lca-config-body"]')).toBe(body)

    fireEvent.click(heading)
    expect(bodyWrapperOf(body).style.display).toBe('block')
  })

  it('collapsed Configuration summary reflects live state (database · method · N indicators)', async () => {
    const { container } = await renderCalc()
    const section = sectionByTitle(container, 'Configuration')!
    fireEvent.click(within(section).getByRole('heading', { name: 'Configuration' }))
    // Live-derived summary: the actually-selected database + the default-all
    // method/indicators (Stage A defaults the picker to all of the method's
    // categories — here the mock's single EF v3.1 / GWP100). Proves the summary
    // reads current state, not a value snapshotted at collapse time.
    expect(section.textContent).toContain('ei-3.10')
    expect(section.textContent).toContain('EF v3.1')
    expect(section.textContent).toContain('1 indicator')
  })
})

describe('LCA Calculator — Results collapsible + New Calculation button', () => {
  // Drives a real activity compute so the Results section + reset button exist.
  async function computeActivity(container: HTMLElement) {
    // Switch FU to activity.
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'activity')!)
    // Search → result → select.
    const search = container.querySelector('[data-testid="multi-item-selector-search"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'battery' } })
    await new Promise((r) => setTimeout(r, 500))
    await waitFor(() => expect(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-testid="multi-item-selector-result-act:ei-3.10|c1"]') as HTMLElement)
    // Method is already selected by default-all (Stage A) — no checkbox click
    // needed (clicking the pre-selected indicator would DESELECT it and disable
    // Calculate). Just wait for Calculate to enable.
    // Calculate.
    const calcBtn = Array.from(container.querySelectorAll('button')).find((b) => /Calculate/.test(b.textContent ?? ''))!
    await waitFor(() => expect((calcBtn as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(calcBtn)
    await waitFor(() => expect(client.calculateActivityLCA).toHaveBeenCalled())
  }

  it('Results renders post-compute inside a CollapsibleCard; New Calculation is a secondary button', async () => {
    const { container } = await renderCalc()
    // No Results section + no New Calculation button before compute.
    expect(sectionByTitle(container, 'Results')).toBeNull()
    expect(container.querySelector('[data-testid="lca-new-calculation"]')).toBeNull()

    await computeActivity(container)

    // Results section now rendered inside a CollapsibleCard.
    await waitFor(() => expect(sectionByTitle(container, 'Results')).not.toBeNull())

    // New Calculation: real <button>, secondary treatment (bordered + elevated,
    // NOT the filled --accent primary), keyboard-focusable, and still resets.
    const newCalc = container.querySelector('[data-testid="lca-new-calculation"]') as HTMLButtonElement
    expect(newCalc).not.toBeNull()
    expect(newCalc.tagName).toBe('BUTTON')
    expect(newCalc.style.border).toBe('1px solid var(--border-default)')
    expect(newCalc.style.backgroundColor).toBe('var(--bg-elevated)')
    expect(newCalc.style.backgroundColor).not.toBe('var(--accent)')
    newCalc.focus()
    expect(document.activeElement).toBe(newCalc)

    fireEvent.click(newCalc)
    // Reset clears results → Results section + button disappear.
    await waitFor(() => expect(sectionByTitle(container, 'Results')).toBeNull())
    expect(container.querySelector('[data-testid="lca-new-calculation"]')).toBeNull()
  })
})
