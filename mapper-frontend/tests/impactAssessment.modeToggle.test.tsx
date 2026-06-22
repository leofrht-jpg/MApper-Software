/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import { ImpactAssessment } from '../src/pages/ImpactAssessment'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useImpactStore } from '../src/stores/impactStore'
import { useBOMStore } from '../src/stores/bomStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import type { ArchetypeSummary } from '../src/api/client'

// Patch 3 (M3 + M7 + M8) — the Single product / System mode toggle:
//
// 1. Both subtrees stay mounted across mode switches (visibility toggle, not
//    conditional mount). System-mode tab selection survives a round-trip into
//    single-product mode and back, because the `useState` in `ImpactAssessment`
//    that tracks `activeTab` lives above the toggle and the system pane is
//    never unmounted.
// 2. Single-product mode does NOT expose the multi-DSM scenario chip or the
//    paired DSM × LCI editor. Those affordances are system-mode only — DSM
//    has no per-product meaning. M7 enforces the absence by scoping the
//    affordances to the system-mode panels (DSMImpactPanel,
//    ProjectedImpactPanel) and not surfacing them from SingleProductImpact.

const mkArchetype = (id: string, name: string, errors = 0): ArchetypeSummary => ({
  id, name, folder: null,
  material_count: 10, unlinked_count: 0,
  stages: ['Manufacturing'],
  validation_error_rows: errors,
})

beforeEach(() => {
  // @ts-expect-error — recharts ResizeObserver stub
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  useImpactStore.setState({
    staticResult: null,
    projectedResult: null,
    projectedMultiResult: null,
    compareResult: null,
    staticJob: null,
    projectedJob: null,
    error: null,
  })
  useDSMStore.setState({
    activeSystem: {
      id: 'sys-test',
      name: 'Test System',
      time_horizon: { start_year: 2020, end_year: 2030 },
      dimensions: [],
    },
    systemState: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scenarios: [{ id: 'base-1', name: 'Base', is_base: true } as any],
      active_scenario_id: 'base-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  })
  usePLCAStore.setState({ databases: [] })
  useBOMStore.setState({
    archetypes: [
      mkArchetype('arc-1', 'Test Archetype A'),
      mkArchetype('arc-2', 'Test Archetype B'),
    ],
    // fetchArchetypes is read but not invoked when the list is non-empty.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  useSingleProductImpactStore.getState().reset()
})

describe('ImpactAssessment — mode toggle (Patch 3)', () => {
  it('renders both mode panes simultaneously and flips visibility on click', () => {
    const { getByTestId } = render(<ImpactAssessment />)

    const sysPane = getByTestId('impact-mode-pane-system')
    const spPane = getByTestId('impact-mode-pane-single-product')
    expect(sysPane).toBeInTheDocument()
    expect(spPane).toBeInTheDocument()
    // Default mode is single_product (UX bundle: single-product first).
    expect(sysPane).toHaveStyle({ display: 'none' })
    expect(spPane).toHaveStyle({ display: 'flex' })

    fireEvent.click(getByTestId('impact-mode-system'))
    expect(getByTestId('impact-mode-pane-system')).toBe(sysPane)
    expect(getByTestId('impact-mode-pane-single-product')).toBe(spPane)
    expect(getByTestId('impact-mode-pane-system')).toHaveStyle({ display: 'flex' })
    expect(getByTestId('impact-mode-pane-single-product')).toHaveStyle({ display: 'none' })
  })

  it('default mode is single-product on first render', () => {
    const { getByTestId } = render(<ImpactAssessment />)
    expect(getByTestId('impact-mode-pane-single-product')).toHaveStyle({ display: 'flex' })
    expect(getByTestId('impact-mode-pane-system')).toHaveStyle({ display: 'none' })
    // Mode toggle button labels reflect the renamed surface.
    expect(getByTestId('impact-mode-single_product')).toHaveTextContent('Single-product assessment')
    expect(getByTestId('impact-mode-system')).toHaveTextContent('System-level assessment')
  })

  it('preserves system-mode tab selection across a mode round-trip', () => {
    const { getByTestId } = render(<ImpactAssessment />)
    // Open system mode first, then exercise its tab.
    fireEvent.click(getByTestId('impact-mode-system'))
    const sysPane = getByTestId('impact-mode-pane-system')
    const sysQ = within(sysPane)

    fireEvent.click(sysQ.getByText('Prospective Background'))
    expect(getByTestId('impact-tab-pane-projected')).toHaveStyle({ display: 'block' })
    expect(getByTestId('impact-tab-pane-static')).toHaveStyle({ display: 'none' })

    fireEvent.click(getByTestId('impact-mode-single_product'))
    fireEvent.click(getByTestId('impact-mode-system'))
    expect(getByTestId('impact-tab-pane-projected')).toHaveStyle({ display: 'block' })
    expect(getByTestId('impact-tab-pane-static')).toHaveStyle({ display: 'none' })
  })

  it('single-product subtree mounts archetype picker + 3 tabs', () => {
    const { getByTestId, queryByTestId } = render(<ImpactAssessment />)
    // Single-product mode is the default — no need to click first.
    expect(getByTestId('single-product-archetype-row')).toBeInTheDocument()
    expect(getByTestId('archetype-select-button')).toBeInTheDocument()
    expect(getByTestId('single-product-tab-static')).toBeInTheDocument()
    expect(getByTestId('single-product-tab-projected')).toBeInTheDocument()
    expect(getByTestId('single-product-tab-compare')).toBeInTheDocument()
    expect(getByTestId('single-product-tab-pane-static')).toBeInTheDocument()
    expect(getByTestId('single-product-tab-pane-projected')).toBeInTheDocument()
    expect(getByTestId('single-product-tab-pane-compare')).toBeInTheDocument()

    // M7: multi-DSM scenarios chip and paired DSM × LCI editor must NOT be
    // present in the single-product subtree. Those affordances live in
    // DSMImpactPanel / ProjectedImpactPanel and are scoped to system mode.
    const spPane = getByTestId('impact-mode-pane-single-product')
    expect(within(spPane).queryByTestId('dsm-scenarios-chip')).toBeNull()
    expect(within(spPane).queryByTestId('paired-list-editor')).toBeNull()
    // The store-level archetype mirror does not paint a UI element for any
    // DSM scenario tab bar inside the single-product subtree either.
    expect(queryByTestId('comparison-dsm-tab-bar')).toBeNull()
  })

  it('auto-picks first non-errored archetype on landing in single-product mode', () => {
    const { getByTestId } = render(<ImpactAssessment />)
    // ArchetypeSelect button reflects the auto-pick (first clean archetype).
    expect(getByTestId('archetype-select-button')).toHaveTextContent('Test Archetype A')
  })
})
