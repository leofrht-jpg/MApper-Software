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
import { StageBreakdownChart } from '../src/components/charts/StageBreakdownChart'

// The bar is a proportional div stack, not Recharts, so a negative stage does
// NOT render below an axis — it renders at |v| and, untreated, is
// indistinguishable from a burden of the same size. WP5's Fuel Station has an
// End of Life recycling credit of -92.78, so this is live data, not a
// hypothetical.

const fmt = {
  settings: { notation: 'fixed' as const, sigFigs: 3, decimals: 2 },
  setSettings: () => {},
  format: (v: number) => String(v),
}
const METHOD = [{ method_label: 'GWP100', score: 6798.46, unit: 'kg CO2-Eq' }]
// Fuel Station, real values.
const WITH_CREDIT = {
  GWP100: {
    Manufacturing: 5990.960856,
    'Use Phase': 862.435686,
    Maintenance: 37.839925,
    'End of Life': -92.777048,
  },
}
const ALL_POSITIVE = {
  GWP100: { Manufacturing: 9405.33, 'Use Phase': 794.44, 'End of Life': 0.0096 },
}

function widths(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[data-testid^="stage-segment-"]'))
    .map((el) => parseFloat((el as HTMLElement).style.width))
}

describe('a negative stage is a credit, and must read as one', () => {
  it('marks the credit segment distinctly', () => {
    const { getByTestId } = render(
      <StageBreakdownChart stageBreakdown={WITH_CREDIT} methods={METHOD}
                           format={fmt} filenameBase="x" />)
    const credit = getByTestId('stage-segment-GWP100-End of Life')
    expect(credit.getAttribute('data-credit')).toBe('true')
    // Hatched rather than merely recoloured, so it survives the print/greyscale
    // export re-theme.
    expect((credit as HTMLElement).style.backgroundImage).toContain('repeating-linear-gradient')
  })

  it('says so in the tooltip', () => {
    const { getByTestId } = render(
      <StageBreakdownChart stageBreakdown={WITH_CREDIT} methods={METHOD}
                           format={fmt} filenameBase="x" />)
    expect(getByTestId('stage-segment-GWP100-End of Life').getAttribute('title'))
      .toMatch(/credit/i)
  })

  it('explains the hatching once, below the bar', () => {
    const { getByTestId } = render(
      <StageBreakdownChart stageBreakdown={WITH_CREDIT} methods={METHOD}
                           format={fmt} filenameBase="x" />)
    expect(getByTestId('stage-breakdown-credit-note').textContent).toMatch(/credit/i)
  })

  it('keeps the segments inside the bar — widths sum to 100%', () => {
    // With |net| as the denominator a mixed-sign bar overflows and the excess
    // is clipped by `overflow: hidden`, silently losing segments off the end.
    const { container } = render(
      <StageBreakdownChart stageBreakdown={WITH_CREDIT} methods={METHOD}
                           format={fmt} filenameBase="x" />)
    const sum = widths(container).reduce((a, b) => a + b, 0)
    expect(sum).toBeGreaterThan(99.9)
    expect(sum).toBeLessThan(100.1)
  })
})

describe('a positive-only breakdown is untouched', () => {
  it('marks nothing as a credit and shows no note', () => {
    const { container, queryByTestId } = render(
      <StageBreakdownChart stageBreakdown={ALL_POSITIVE} methods={METHOD}
                           format={fmt} filenameBase="x" />)
    expect(container.querySelectorAll('[data-credit="true"]')).toHaveLength(0)
    expect(queryByTestId('stage-breakdown-credit-note')).toBeNull()
    const sum = widths(container).reduce((a, b) => a + b, 0)
    expect(sum).toBeGreaterThan(99.9)
  })
})
