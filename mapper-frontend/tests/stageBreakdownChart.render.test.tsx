/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import { StageBreakdownChart } from '../src/components/charts/StageBreakdownChart'
import { useNumberFormatter } from '../src/components/charts/numberFormat'

// Patch 4B — StageBreakdownChart renders one row per method with stage
// segments. The component is gated on a non-empty stage_breakdown by the
// parent (SingleProductStaticPanel) — when scope ≠ "all" the backend returns
// null and the parent doesn't render the chart at all.

const STUB_BREAKDOWN: Record<string, Record<string, number>> = {
  'IPCC | GWP100a | kg CO2-eq': {
    Manufacturing: 4000,
    'Use Phase': 12000,
    'End of Life': -500,
  },
  'EF | ClimateChange | kg CO2-eq': {
    Manufacturing: 4100,
    'Use Phase': 12500,
    'End of Life': -600,
  },
}

const STUB_METHODS = [
  { method_label: 'IPCC | GWP100a | kg CO2-eq', score: 15500, unit: 'kg CO2-eq' },
  { method_label: 'EF | ClimateChange | kg CO2-eq', score: 16000, unit: 'kg CO2-eq' },
]

describe('StageBreakdownChart (Patch 4B)', () => {
  it('renders one row per method with stage segments and a legend', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { getByTestId, getAllByText } = render(
      <StageBreakdownChart
        stageBreakdown={STUB_BREAKDOWN}
        methods={STUB_METHODS}
        format={result.current}
        filenameBase="test_archetype"
      />,
    )

    expect(getByTestId('stage-breakdown-chart')).toBeInTheDocument()

    for (const m of STUB_METHODS) {
      expect(getByTestId(`stage-breakdown-row-${m.method_label}`)).toBeInTheDocument()
      for (const stage of ['Manufacturing', 'Use Phase', 'End of Life']) {
        expect(
          getByTestId(`stage-segment-${m.method_label}-${stage}`),
        ).toBeInTheDocument()
      }
    }

    // Legend lists each unique stage exactly once (the data table cells
    // don't render stage names, so getAllByText length === 1 per stage).
    expect(getAllByText('Manufacturing')).toHaveLength(1)
    expect(getAllByText('Use Phase')).toHaveLength(1)
    expect(getAllByText('End of Life')).toHaveLength(1)
  })

  it('returns null when stage breakdown has no stages', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { container } = render(
      <StageBreakdownChart
        stageBreakdown={{}}
        methods={STUB_METHODS}
        format={result.current}
        filenameBase="test_archetype"
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
