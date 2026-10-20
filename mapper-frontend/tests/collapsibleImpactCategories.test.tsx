/* SPDX-License-Identifier: MPL-2.0 */
/**
 * Every card or table that lists impact categories collapses with a chevron,
 * through ONE shared component (CollapsibleBlock), defaults to expanded,
 * remembers its state per page in localStorage when it can, and keeps a
 * one-line summary when collapsed.
 *
 * Plus the EF v3.1 acidification report: the category header appeared with no
 * row under it while "accumulated exceedance (AE)" was selected. The row was
 * there; it scrolled under its own sticky header. And the chip could not say
 * WHICH "accumulated exceedance (AE)" (acidification and terrestrial
 * eutrophication share the name).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { CollapsibleBlock } from '../src/components/ui/CollapsibleBlock'
import { MethodPicker } from '../src/components/MethodPicker'

const FAM = 'EF v3.1'
const ACID = [FAM, 'acidification', 'accumulated exceedance (AE)']
const TERR = [FAM, 'eutrophication: terrestrial', 'accumulated exceedance (AE)']
const GWP = [FAM, 'climate change', 'global warming potential (GWP100)']

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    getMethods: vi.fn(async () => [{ family: FAM, categories: [
      { category: 'acidification', indicators: [{ indicator: ACID[2], tuple: ACID }] },
      { category: 'climate change', indicators: [{ indicator: GWP[2], tuple: GWP }] },
      { category: 'eutrophication: terrestrial', indicators: [{ indicator: TERR[2], tuple: TERR }] },
    ] }]),
  }
})

beforeEach(() => { window.localStorage.clear() })

describe('CollapsibleBlock', () => {
  const block = (key = 'page.a') => render(
    <CollapsibleBlock storageKey={key} title="Impact categories" summary="25 of 25 selected">
      <div data-testid="inside">rows</div>
    </CollapsibleBlock>,
  )

  it('is expanded by default and keeps the summary when collapsed', () => {
    block()
    const body = screen.getByTestId('collapsible-page.a-body')
    expect(body.style.display).toBe('block')
    fireEvent.click(screen.getByTestId('collapsible-page.a-toggle'))
    expect(body.style.display).toBe('none')
    expect(screen.getByTestId('inside')).toBeTruthy()  // hidden, not unmounted
    expect(screen.getByTestId('collapsible-page.a-summary').textContent).toBe('25 of 25 selected')
  })

  it('remembers the state per page key, and only for that key', () => {
    const { unmount } = block('page.a')
    fireEvent.click(screen.getByTestId('collapsible-page.a-toggle'))
    unmount()
    block('page.a')
    expect(screen.getByTestId('collapsible-page.a-body').style.display).toBe('none')
    block('page.b')
    expect(screen.getByTestId('collapsible-page.b-body').style.display).toBe('block')
  })

  it('works with storage unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    block('page.c')
    const body = screen.getByTestId('collapsible-page.c-body')
    expect(body.style.display).toBe('block')
    fireEvent.click(screen.getByTestId('collapsible-page.c-toggle'))
    expect(body.style.display).toBe('none')
    get.mockRestore(); set.mockRestore()
  })
})

describe('the impact-category picker', () => {
  it('collapses with an "N of M selected" summary', async () => {
    render(<MethodPicker onChange={() => {}} initialSelected={[ACID]} collapseKey="t.methods" />)
    await waitFor(() => expect(screen.getByTestId('indicator-checklist-summary').textContent).toBe('1 of 3 selected'))
    fireEvent.click(screen.getByTestId('indicator-checklist-toggle'))
    expect(screen.getByTestId('indicator-checklist-body').style.display).toBe('none')
    expect(screen.getByTestId('indicator-checklist-summary').textContent).toBe('1 of 3 selected')
  })

  it('a one-row category keeps its row: headers are not sticky', async () => {
    render(<MethodPicker onChange={() => {}} initialSelected={[ACID]} collapseKey="t2.methods" />)
    const header = await screen.findByTestId('indicator-category-acidification')
    expect(header.style.position).not.toBe('sticky')
    const row = header.nextElementSibling as HTMLElement
    expect(row.textContent).toContain('accumulated exceedance (AE)')
    expect((row.querySelector('input') as HTMLInputElement).checked).toBe(true)
  })

  it('chips say which "accumulated exceedance (AE)" is selected', async () => {
    render(<MethodPicker onChange={() => {}} initialSelected={[ACID, TERR]} collapseKey="t3.methods" />)
    await waitFor(() => expect(screen.getAllByTestId('method-chip')).toHaveLength(2))
    const chips = screen.getAllByTestId('method-chip').map((c) => c.textContent)
    expect(chips).toEqual(expect.arrayContaining(['acidification', 'eutrophication: terrestrial']))
  })
})

describe('every impact-category surface uses the shared block', () => {
  // The list reported before the change. A surface added later that lists
  // categories should join it; a copy of the block instead of the shared one
  // is what this exists to prevent.
  const SURFACES: Array<[string, RegExp]> = [
    ['src/components/MethodPicker.tsx', /<CollapsibleBlock[\s\S]*storageKey=\{collapseKey\}/],
    ['src/components/impact/SingleProductStaticPanel.tsx', /storageKey="single-static\.results"/],
    ['src/components/impact/SingleProductProjectedPanel.tsx', /storageKey="single-projected\.results"/],
    ['src/components/impact/SingleProductComparisonPanel.tsx', /storageKey="single-compare\.results"/],
    ['src/components/impact/MultiProductLCA.tsx', /storageKey="multi-item\.results"/],
    ['src/pages/LCACalculator.tsx', /storageKey="lca-calculator\.archetype-results"/],
    ['src/pages/LCACalculator.tsx', /storageKey="lca-calculator\.activity-results"/],
    ['src/pages/LCACalculator.tsx', /storageKey="lca-calculator\.compare"/],
    ['src/pages/MonteCarlo.tsx', /storageKey="monte-carlo\.distributions"/],
    ['src/components/aesa/DetailTable.tsx', /storageKey="aesa\.detail"/],
  ]
  it.each(SURFACES)('%s', (file, pattern) => {
    const src = readFileSync(file, 'utf-8')
    expect(src).toMatch(pattern)
    expect(src).toMatch(/import \{ CollapsibleBlock \} from '[./]+(components\/)?ui\/CollapsibleBlock'/)
  })

  it('every picker page passes its own key', () => {
    const keys = [
      ['src/components/impact/SingleProductStaticPanel.tsx', 'single-static.methods'],
      ['src/components/impact/SingleProductProjectedPanel.tsx', 'single-projected.methods'],
      ['src/components/impact/MultiProductLCA.tsx', 'multi-item.methods'],
      ['src/pages/LCACalculator.tsx', 'lca-calculator.methods'],
      ['src/components/dsm/DSMImpactPanel.tsx', 'system-static.methods'],
      ['src/components/impact/ProjectedImpactPanel.tsx', 'system-prospective.methods'],
    ]
    for (const [file, key] of keys) expect(readFileSync(file, 'utf-8')).toContain(`collapseKey="${key}"`)
  })
})
