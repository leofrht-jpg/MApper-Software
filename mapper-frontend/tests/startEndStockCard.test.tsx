/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  StartEndStockCard,
  yearStockStartEnd,
  type YearStockRecord,
} from '../src/components/dsm/StartEndStockCard'

// Mirrors the page's `formatNumber` thousands-separator convention.
const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })

// Three-year horizon. stock = post-flows END-of-year snapshot (engine convention).
// Year 2025: initial 2,864,904 + net 49,128 → end 2,914,032
// Year 2026: start = end(2025) = 2,914,032; +net 85,968 → end 3,000,000
// Year 2050 (final): start = end(2049)=3,050,000; net −100,000 → end 2,950,000
const YEARS: YearStockRecord[] = [
  { year: 2025, stock: { 'BEV|Small': 1_800_000, 'ICEV|Sedan': 1_114_032 } }, // Σ 2,914,032
  { year: 2026, stock: { 'BEV|Small': 2_000_000, 'ICEV|Sedan': 1_000_000 } }, // Σ 3,000,000
  { year: 2049, stock: { 'BEV|Small': 3_050_000 } }, // Σ 3,050,000
  { year: 2050, stock: { 'BEV|Small': 2_950_000 } }, // Σ 2,950,000
]
const INITIAL_STOCK_TOTAL = 2_864_904 // uploaded initial stock (before any flows)
// Net change cards (for reconciliation reference): 2025 inflows−outflows = +49,128.

describe('yearStockStartEnd — corrected semantics', () => {
  it('end(Y) = Σ YearResult[Y].stock (the post-flows snapshot)', () => {
    expect(yearStockStartEnd(YEARS, 2025, INITIAL_STOCK_TOTAL).end).toBe(2_914_032)
    expect(yearStockStartEnd(YEARS, 2050, INITIAL_STOCK_TOTAL).end).toBe(2_950_000)
  })

  it('start of the FIRST year = uploaded initial-stock total (NOT Σ stock / summary.totalStock)', () => {
    const { start, end } = yearStockStartEnd(YEARS, 2025, INITIAL_STOCK_TOTAL)
    expect(start).toBe(2_864_904)
    // It is NOT the end-of-year Σ stock (the Patch 5C/5D bug).
    expect(start).not.toBe(end)
    // Reconciles: start + net(2025) == end.  2,864,904 + 49,128 = 2,914,032.
    expect(start! + 49_128).toBe(end)
  })

  it('start of a LATER year Y = end of (Y−1) = Σ YearResult[Y−1].stock', () => {
    // 2026's start is 2025's end-of-year snapshot.
    expect(yearStockStartEnd(YEARS, 2026, INITIAL_STOCK_TOTAL).start).toBe(2_914_032)
    // 2050's start is 2049's end-of-year snapshot.
    expect(yearStockStartEnd(YEARS, 2050, INITIAL_STOCK_TOTAL).start).toBe(3_050_000)
  })

  it('final horizon year computes without needing a "next year" record', () => {
    const { start, end } = yearStockStartEnd(YEARS, 2050, INITIAL_STOCK_TOTAL)
    expect(start).toBe(3_050_000)
    expect(end).toBe(2_950_000)
  })

  it('first-year start is null when the initial stock is unavailable', () => {
    expect(yearStockStartEnd(YEARS, 2025, null).start).toBeNull()
    // Later years are unaffected — they read the prior YearResult.
    expect(yearStockStartEnd(YEARS, 2026, null).start).toBe(2_914_032)
  })
})

describe('StartEndStockCard', () => {
  function renderFor(selectedYear: number, initial: number | null) {
    const { start, end } = yearStockStartEnd(YEARS, selectedYear, initial)
    return render(<StartEndStockCard year={selectedYear} start={start} end={end} format={fmt} />)
  }

  it('first year: Start = uploaded initial stock, End = post-flows snapshot', () => {
    const { getByTestId } = renderFor(2025, INITIAL_STOCK_TOTAL)
    const card = getByTestId('total-stock-card')
    expect(card.textContent).toContain('Start of 2025')
    expect(card.textContent).toContain('End of 2025')
    expect(getByTestId('total-stock-start').textContent).toBe('2,864,904')
    expect(getByTestId('total-stock-end').textContent).toBe('2,914,032')
  })

  it('later year: Start = prior year end, End = this year snapshot', () => {
    const { getByTestId } = renderFor(2026, INITIAL_STOCK_TOTAL)
    expect(getByTestId('total-stock-start').textContent).toBe('2,914,032')
    expect(getByTestId('total-stock-end').textContent).toBe('3,000,000')
  })

  it('updates both labels and values when the selected year changes', () => {
    const first = yearStockStartEnd(YEARS, 2025, INITIAL_STOCK_TOTAL)
    const { getByTestId, rerender } = render(
      <StartEndStockCard year={2025} start={first.start} end={first.end} format={fmt} />,
    )
    expect(getByTestId('total-stock-start').textContent).toBe('2,864,904')

    const later = yearStockStartEnd(YEARS, 2050, INITIAL_STOCK_TOTAL)
    rerender(<StartEndStockCard year={2050} start={later.start} end={later.end} format={fmt} />)
    const card = getByTestId('total-stock-card')
    expect(card.textContent).toContain('Start of 2050')
    expect(card.textContent).toContain('End of 2050')
    expect(getByTestId('total-stock-start').textContent).toBe('3,050,000')
    expect(getByTestId('total-stock-end').textContent).toBe('2,950,000')
  })

  it('renders an em-dash (no crash) when the first-year start is unavailable', () => {
    const { getByTestId } = renderFor(2025, null)
    expect(getByTestId('total-stock-start').textContent).toBe('—')
    // End still renders normally.
    expect(getByTestId('total-stock-end').textContent).toBe('2,914,032')
  })

  it('both figures render at identical size/style (equal visual weight)', () => {
    const { getByTestId } = renderFor(2025, INITIAL_STOCK_TOTAL)
    const startEl = getByTestId('total-stock-start')
    const endEl = getByTestId('total-stock-end')
    for (const prop of ['fontSize', 'fontFamily', 'fontWeight', 'color'] as const) {
      expect(startEl.style[prop]).toBe(endEl.style[prop])
      expect(startEl.style[prop]).toBeTruthy()
    }
  })
})
