/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { BoxPlotView } from '../src/components/aesa/BoxPlotView'
import type { AESAComputeResult } from '../src/api/client'

// Patch 4J — render tests for charts that newly gained the legend
// export affordance (BoxPlotView) and for the renamed/restructured
// Mode-picker check on charts that existed before. The other two
// charts touched by Patch 4J (MultiYearTrajectoryPanel, TimelinePreviewModal)
// only added a `legendSelector` prop on the existing button — that
// path is already covered by `chartExportLegend.test.tsx::resolves
// Recharts-internal legend via legendSelector`. No need to duplicate
// the Recharts simulation here.
//
// DSM Dashboard charts (Stock composition, Age distribution, Outflow
// split) are excluded from this file: rendering DSMDashboard.tsx
// requires mocking 5+ stores plus a simulationResult shape that's
// large enough to merit its own dedicated test surface. The new
// legend blocks are conditionally rendered on `stackKeys[0] !== 'all'`
// (categorical Stack-by) and `isSplit` (multi-source outflow) —
// straightforward presence checks with minimal logic to regress.
// Manual verification is acceptable for this slice; the load-bearing
// runtime guarantee (the Mode picker actually appears when legendRef
// is provided) is exercised by the wiring tests below + Patch 4I's
// existing button tests.

const SAMPLE_RESULT: AESAComputeResult = {
  results: [
    {
      year: 2030,
      pb_id: 'climate_change',
      pb_name: 'Climate change',
      sr: 1.5,
      sr_by_principle: { EpC: 1.4, IN: 1.6, AGR: 1.5, LA: 1.5, AR: 1.45 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    {
      year: 2030,
      pb_id: 'biosphere_integrity',
      pb_name: 'Biosphere integrity',
      sr: 0.8,
      sr_by_principle: { EpC: 0.75, IN: 0.9, AGR: 0.85, LA: 0.78, AR: 0.82 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

beforeEach(() => {
  // @ts-expect-error - jsdom stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
})

describe('Legend export wiring — BoxPlotView (Patch 4J)', () => {
  it('renders the legend block with a stable testid', () => {
    const { getByTestId } = render(<BoxPlotView result={SAMPLE_RESULT} />)
    const legend = getByTestId('aesa-boxplot-legend')
    expect(legend).toBeInTheDocument()
    // Multi-D baseline + 5 sharing principles → the legend has at
    // least 6 swatches. Don't lock the exact text; the labels are
    // domain-meaningful and checked elsewhere.
    expect(legend.children.length).toBeGreaterThanOrEqual(6)
  })

  it('shows the Mode picker in the export menu (Patch 4I infra triggers off legendRef)', () => {
    const { getByRole, getByTestId } = render(<BoxPlotView result={SAMPLE_RESULT} />)
    // The export button is the only <button role="button"> from
    // ChartExportButton; locate it generically and click to open.
    fireEvent.click(getByRole('button'))
    // Mode picker items are rendered with stable testids by
    // ChartExportButton's <ModeItem> component. Their presence is the
    // load-bearing assertion: it confirms the legendRef prop reached
    // the button (no Mode picker → button silently degraded to
    // chart-only, the exact pre-Patch-4J state on this chart).
    expect(getByTestId('chart-export-mode-combined')).toBeInTheDocument()
    expect(getByTestId('chart-export-mode-chart')).toBeInTheDocument()
    expect(getByTestId('chart-export-mode-legend')).toBeInTheDocument()
  })
})
