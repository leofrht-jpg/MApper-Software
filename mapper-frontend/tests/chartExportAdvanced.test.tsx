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
import { useRef } from 'react'
import { ChartExportButton } from '../src/components/charts/ChartExportButton'
import * as chartExport from '../src/components/charts/chartExport'

// Patch 4L — Resolution + Background sections collapsed under a
// single "Advanced" toggle. Default collapsed; resets to collapsed on
// every menu open (per-action behavior, no session persistence).
//
// The visual goal is to keep primary affordances (Mode picker when a
// legend is wired, Format pickers always) visible at a glance and
// hide secondary refinements (resolution multiplier, background mode)
// behind one click. Defaults are reasonable in most cases — users
// rarely change them. The compact summary (`2× · Light`) on the
// collapsed toggle lets users confirm the active settings without
// expanding.

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(chartExport, 'exportChart').mockResolvedValue(undefined)
})

function Harness() {
  const chartRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={chartRef} />
      <ChartExportButton chartRef={chartRef} filename="x" />
    </>
  )
}

describe('ChartExportButton — Advanced collapse (Patch 4L)', () => {
  it('keeps Mode and Format pickers visible regardless of collapse state', () => {
    const { getByRole, getByText } = render(<Harness />)
    fireEvent.click(getByRole('button'))  // open menu
    // Format items always visible (primary affordance).
    expect(getByText('SVG (vector)')).toBeInTheDocument()
    expect(getByText('PDF (vector)')).toBeInTheDocument()
    expect(getByText('PNG (2×)')).toBeInTheDocument()
    expect(getByText('JPEG (2×)')).toBeInTheDocument()
  })

  it('hides Resolution and Background when collapsed (default state)', () => {
    const { getByRole, queryByTestId, queryByText } = render(<Harness />)
    fireEvent.click(getByRole('button'))
    // Advanced is collapsed by default → Resolution/Background body
    // is not in the DOM.
    expect(queryByTestId('chart-export-advanced-body')).toBeNull()
    expect(queryByText('Resolution (PNG / JPEG)')).toBeNull()
    expect(queryByText('Background')).toBeNull()
  })

  it('shows the compact "2× · Light" summary on the collapsed toggle', () => {
    const { getByRole, getByTestId } = render(<Harness />)
    fireEvent.click(getByRole('button'))
    // Default scale=2, bg=light. Confirm the user can see the active
    // settings without expanding.
    const summary = getByTestId('chart-export-advanced-summary')
    expect(summary).toHaveTextContent('2× · Light')
  })

  it('reveals Resolution and Background when Advanced is clicked', () => {
    const { getByRole, getByTestId, getByText } = render(<Harness />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByTestId('chart-export-advanced-toggle'))
    expect(getByTestId('chart-export-advanced-body')).toBeInTheDocument()
    expect(getByText('Resolution (PNG / JPEG)')).toBeInTheDocument()
    expect(getByText('Background')).toBeInTheDocument()
  })

  it('toggles back to collapsed when Advanced is clicked again', () => {
    const { getByRole, getByTestId, queryByTestId } = render(<Harness />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByTestId('chart-export-advanced-toggle'))
    expect(getByTestId('chart-export-advanced-body')).toBeInTheDocument()
    fireEvent.click(getByTestId('chart-export-advanced-toggle'))
    expect(queryByTestId('chart-export-advanced-body')).toBeNull()
  })

  it('hides the inline summary when Advanced is expanded', () => {
    // Once expanded, the body shows the active radio for resolution
    // and background — the compact summary on the toggle is redundant
    // and would visually compete with the chevron.
    const { getByRole, getByTestId, queryByTestId } = render(<Harness />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByTestId('chart-export-advanced-toggle'))
    expect(queryByTestId('chart-export-advanced-summary')).toBeNull()
  })

  it('resets Advanced to collapsed on every menu reopen', () => {
    // The load-bearing behavior: per-action, not session-persisted.
    // A user who opened Advanced once shouldn't see a sprawling form
    // on the next quick export.
    const { getByRole, getByTestId, queryByTestId } = render(<Harness />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByTestId('chart-export-advanced-toggle'))
    expect(getByTestId('chart-export-advanced-body')).toBeInTheDocument()
    // Close menu (click outside; emulated by clicking the open trigger
    // again to toggle).
    fireEvent.click(getByRole('button'))
    // Reopen — Advanced should be collapsed even though it was
    // expanded last time.
    fireEvent.click(getByRole('button'))
    expect(queryByTestId('chart-export-advanced-body')).toBeNull()
  })

  it('summary reflects the current scale + bg even when defaults change', () => {
    // The summary is derived from the live `scale`/`bg` state, so
    // changes made in a previous menu-open session persist (via
    // module-level `sessionScale` and `localStorage` for bg) and the
    // collapsed summary always shows the active values.
    const { getByRole, getByTestId, getByText } = render(<Harness />)
    fireEvent.click(getByRole('button'))
    // Expand, switch scale to 3×. ScaleItem renders as
    // role="menuitemradio" with the label `3× — ~288 DPI` rendered as
    // body text — query by text on that label, not by button role.
    fireEvent.click(getByTestId('chart-export-advanced-toggle'))
    fireEvent.click(getByText('3× — ~288 DPI'))
    // Close and reopen.
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByRole('button'))
    // Summary should reflect 3×, still default Light bg.
    expect(getByTestId('chart-export-advanced-summary')).toHaveTextContent('3× · Light')
  })
})
