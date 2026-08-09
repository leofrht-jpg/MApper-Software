/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ConfigSidebar } from '../src/components/aesa/ConfigSidebar'
import { useAESAStore } from '../src/stores/aesaStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useImpactStore } from '../src/stores/impactStore'
import * as client from '../src/api/client'

// Page-composition test: the mapping table must actually be reachable from the
// sidebar, and collapse the same way its siblings do. Component tests pass
// even when the parent never renders the component — that gap has bitten this
// codebase before (Patches 4R/4T), so the composition gets its own assertions.

const SALA_SET = (() => {
  const json = JSON.parse(readFileSync(
    resolve(process.cwd(), '../mapper-backend/mapper/data/aesa/boundary_sets.json'), 'utf-8',
  ))
  const set = json.sets.find((s: { id: string }) => s.id === 'Sala2020_EF')
  const bs = set.boundaries
  const list = (Array.isArray(bs) ? bs : Object.values(bs)) as Array<any>
  return { ...set, boundaries: Object.fromEntries(list.map((b) => [b.id, b])) }
})()

const PB_IDS = Object.keys(SALA_SET.boundaries)

const METHOD_MAPPING = PB_IDS.map((id) => ({
  method_tuple: ['EF v3.1', SALA_SET.boundaries[id].name.toLowerCase(), 'x'],
  pb_id: id,
  conversion_factor: 1,
}))

const SYSTEM: any = { id: 'sys-1', name: 'Fleet', dimensions: [], time_horizon: { start_year: 2020, end_year: 2050 } }
const SYSTEM_STATE: any = { scenarios: [{ id: 'base', name: 'Base', is_base: true }], active_scenario_id: 'base' }

/** An impact result carrying the EF methods, so coverage can be computed. */
const STATIC_RESULT: any = {
  task_id: 't',
  meta: { mode: 'static', mfa_system_id: 'sys-1', scope: 'stock' },
  results: [
    ...METHOD_MAPPING.map((m) => ({ method: m.method_tuple })),
    { method: ['EF v3.1', 'climate change: fossil', 'x'] },
  ],
}

const SHARING: any = {
  id: 'preset-1', name: 'Multi-D allocation (default)', built_in: true,
  principles: [], category_assignments: [], chain: { layers: [] },
}

const DEFAULTS: any = {
  boundary_sets: [SALA_SET],
  multi_d_defaults: [], sharing_data: {}, ssp_trajectories: [],
  carbon_budget_options: [],
  default_multi_d: { tiers: [] }, default_carbon_budget: null,
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.restoreAllMocks()
  vi.spyOn(client, 'getAESADefaults').mockResolvedValue(DEFAULTS)
  vi.spyOn(client, 'getSharingPresets').mockResolvedValue([SHARING])
  vi.spyOn(client, 'getAESAConfigurations').mockResolvedValue([])
  vi.spyOn(client, 'getAESASessions').mockResolvedValue([])
  useDSMStore.setState({ systems: [{ id: SYSTEM.id, name: SYSTEM.name } as never], activeSystem: SYSTEM, systemState: SYSTEM_STATE })
  useImpactStore.setState({ staticResult: STATIC_RESULT, projectedResult: null })
  useAESAStore.setState({
    defaults: DEFAULTS, defaultsLoading: false, presets: [SHARING],
    draft: {
      name: 'Cfg', mfa_system_id: 'sys-1', impact_mode: 'static',
      boundary_set_id: 'Sala2020_EF', sharing_preset_id: 'preset-1',
      sharing: SHARING, method_mapping: METHOD_MAPPING, carbon_budget: null,
    } as any,
    configurations: [], activeConfigId: null, creatingNewConfig: true,
    activeSessionId: null, configLoadError: null, error: null, result: null,
    lastComputeArgs: null,
  } as any)
})

afterEach(cleanup)

const SECTION = 'aesa-collapsible-method-pb-mapping'
const SIBLING = 'aesa-collapsible-category-assignments'

describe('the Method → PB section expands to the mapping itself', () => {
  it('renders the table inside the section', async () => {
    const { queryByTestId, getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId(SECTION)).not.toBeNull())
    const section = getByTestId(SECTION)
    expect(within(section).getByTestId('aesa-mapping-table')).toBeTruthy()
  })

  it('lists every mapped boundary with its method tuple', async () => {
    const { queryByTestId, getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId(SECTION)).not.toBeNull())
    const section = getByTestId(SECTION)
    for (const id of PB_IDS) {
      expect(within(section).getByTestId(`aesa-mapping-row-${id}`)).toBeTruthy()
    }
    expect(within(section).getByTestId('aesa-mapping-row-acidification').textContent)
      .toContain('EF v3.1')
  })

  it('keeps the headline counts above the detail', async () => {
    // The counter is still the fast read; the table is the check. Removing the
    // counter would make the collapsed summary the only place the numbers live.
    const { queryByTestId, getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId(SECTION)).not.toBeNull())
    const section = getByTestId(SECTION)
    const coverage = within(section).getByTestId('aesa-method-coverage')
    const table = within(section).getByTestId('aesa-mapping-table')
    expect(coverage.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    expect(coverage.textContent).toMatch(/16 of 16 planetary boundaries covered/)
  })

  it('keeps the Re-suggest action — the table is read-only, not inert', async () => {
    const { queryByTestId, getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId(SECTION)).not.toBeNull())
    const section = getByTestId(SECTION)
    expect(within(section).getByText(/Re-suggest from impact methods/i)).toBeTruthy()
    // ...and the table itself offers no editing control.
    expect(within(section).getByTestId('aesa-mapping-table').querySelectorAll('select'))
      .toHaveLength(0)
  })
})

describe('collapse follows the sibling sections', () => {
  it('starts collapsed, like Category assignments', async () => {
    const { queryByTestId, getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId(SECTION)).not.toBeNull())
    const toggle = (id: string) => within(getByTestId(id)).getByRole('button')
    expect(toggle(SECTION).getAttribute('aria-expanded'))
      .toBe(toggle(SIBLING).getAttribute('aria-expanded'))
    expect(toggle(SECTION).getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles open and shut', async () => {
    const { queryByTestId, getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId(SECTION)).not.toBeNull())
    const button = within(getByTestId(SECTION)).getByRole('button')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('hides the body by visibility, keeping the table mounted', async () => {
    // The codebase-wide rule: hide/reappear UI uses display:none, never a
    // conditional unmount, so nothing inside loses state on collapse.
    const { queryByTestId, getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId(SECTION)).not.toBeNull())
    const section = getByTestId(SECTION)
    // Collapsed by default — the table is still in the DOM.
    expect(within(section).getByTestId('aesa-mapping-table')).toBeTruthy()
    const body = within(section).getByTestId('aesa-mapping-table').closest('div[style*="display"]')
    expect(body?.getAttribute('style')).toContain('display: none')
  })

  it('shows the counts as the collapsed summary', async () => {
    const { queryByTestId, getByTestId } = render(<ConfigSidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(queryByTestId(SECTION)).not.toBeNull())
    expect(getByTestId(SECTION).textContent).toMatch(/16\/16 boundaries/)
  })
})
