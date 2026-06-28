/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { useBOMStore } from '../src/stores/bomStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useDSMSystemColors } from '../src/utils/dsmCohortColors'

// Bug repro: after uploading a NEW cohort-mapping file, the Cohort mapping table
// (per-row colors) and a chart consuming useDSMSystemColors (per-dim colors,
// stacked by fuel_type) must show the SAME, NEW colors. Two consecutive uploads
// with different color columns; assert the chart reflects the SECOND upload.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return { ...actual, uploadCohortMappings: vi.fn(), downloadCohortMappingsTemplate: vi.fn() }
})

const DIMS = [
  { name: 'fuel_type', display_name: 'Fuel', is_age: false, labels: ['BEV-LFP', 'HEV-LFP'] },
  { name: 'size', display_name: 'Size', is_age: false, labels: ['Small', 'Large'] },
]

function rowColorsFor(bev: string, hev: string): Record<string, string> {
  return {
    'BEV-LFP|Small': bev, 'BEV-LFP|Large': bev,
    'HEV-LFP|Small': hev, 'HEV-LFP|Large': hev,
  }
}

// A chart-side probe: colors a BEV-LFP cohort the way the DSM stock chart does
// (stacked by fuel_type → per-dim color), exactly like DSMDashboard.
function ChartProbe() {
  const activeSystem = useDSMStore((s) => s.activeSystem)
  const cohortRowColors = useDSMStore((s) => s.cohortRowColors)
  const { colorMap, colorForCohort } = useDSMSystemColors(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (activeSystem ?? null) as any, 'fuel_type', { rowColorOverrides: cohortRowColors },
  )
  return (
    <div>
      <span data-testid="chart-bev-dim">{colorMap['BEV-LFP'] ?? 'none'}</span>
      <span data-testid="chart-bev-cohort">{colorForCohort('BEV-LFP|Small', 0)}</span>
    </div>
  )
}

let nextRowColors: Record<string, string> = {}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useProjectStore.setState({ currentProject: 'test-project' })
})
afterEach(() => { vi.restoreAllMocks() })

describe('Cohort upload — chart colors stay in sync with the table', () => {
  it('a second upload with different colors updates the per-dim chart color', async () => {
    const client = await import('../src/api/client')
    vi.mocked(client.uploadCohortMappings).mockResolvedValue({
      mapped_cohorts: 4, unmapped_cohorts: [], invalid_cohorts: [],
      invalid_archetypes: [], invalid_row_colors: [],
    } as never)

    // The cache-fixed fetch now returns fresh row_colors; mimic that by writing
    // the current upload's row colors into the store when fetchCohortMappings runs.
    useDSMStore.setState({
      activeSystem: {
        id: 'sys-1', name: 'Fleet',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        time_horizon: { start_year: 2020, end_year: 2030 } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dimensions: DIMS as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      cohortMappings: { 'BEV-LFP|Small': { archetype_id: 'a', scaling_factor: 1 } },
      cohortRowColors: {},
      fetchCohortMappings: vi.fn().mockImplementation(async () => {
        useDSMStore.setState({ cohortRowColors: { ...nextRowColors } })
      }),
      saveCohortMappings: vi.fn(), setRowColor: vi.fn(), clearRowColor: vi.fn(),
    })
    useBOMStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archetypes: [{ id: 'a', name: 'A', unlinked_count: 0 }] as any,
      fetchArchetypes: vi.fn(),
    })

    const { CohortMappingEditor } = await import('../src/components/impact/CohortMappingEditor')
    const { getByTestId, container, getByTitle } = render(
      <><CohortMappingEditor /><ChartProbe /></>,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const upload = (name: string) => {
      Object.defineProperty(input, 'files', { value: [new File(['x'], name)], configurable: true })
      fireEvent.change(input)
    }

    // Upload 1: BEV-LFP → #1111aa.
    nextRowColors = rowColorsFor('#1111aa', '#11aa11')
    upload('one.xlsx')
    await waitFor(() => {
      expect(useDSMStore.getState().cohortRowColors['BEV-LFP|Small']).toBe('#1111aa')
    })
    await waitFor(() => {
      // chart (per-dim) reflects upload 1
      expect(getByTestId('chart-bev-dim').textContent).toBe('#1111aa')
    })

    // Upload 2: BEV-LFP → #cc2222 (DIFFERENT).
    nextRowColors = rowColorsFor('#cc2222', '#22cc22')
    upload('two.xlsx')
    await waitFor(() => {
      // table side (per-row store) reflects upload 2
      expect(useDSMStore.getState().cohortRowColors['BEV-LFP|Small']).toBe('#cc2222')
    })
    // THE BUG: chart (per-dim) must also reflect upload 2, not stay on #1111aa.
    await waitFor(() => {
      expect(getByTestId('chart-bev-dim').textContent).toBe('#cc2222')
    })
    void getByTitle
  })

  it('a second upload that makes a fuel ambiguous must NOT leave the stale per-dim color', async () => {
    const client = await import('../src/api/client')
    vi.mocked(client.uploadCohortMappings).mockResolvedValue({
      mapped_cohorts: 4, unmapped_cohorts: [], invalid_cohorts: [],
      invalid_archetypes: [], invalid_row_colors: [],
    } as never)

    useDSMStore.setState({
      activeSystem: {
        id: 'sys-1', name: 'Fleet',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        time_horizon: { start_year: 2020, end_year: 2030 } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dimensions: DIMS as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      cohortMappings: { 'BEV-LFP|Small': { archetype_id: 'a', scaling_factor: 1 } },
      cohortRowColors: {},
      fetchCohortMappings: vi.fn().mockImplementation(async () => {
        useDSMStore.setState({ cohortRowColors: { ...nextRowColors } })
      }),
      saveCohortMappings: vi.fn(), setRowColor: vi.fn(), clearRowColor: vi.fn(),
    })
    useBOMStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archetypes: [{ id: 'a', name: 'A', unlinked_count: 0 }] as any,
      fetchArchetypes: vi.fn(),
    })

    const { CohortMappingEditor } = await import('../src/components/impact/CohortMappingEditor')
    const { getByTestId, container } = render(<><CohortMappingEditor /><ChartProbe /></>)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const upload = (name: string) => {
      Object.defineProperty(input, 'files', { value: [new File(['x'], name)], configurable: true })
      fireEvent.change(input)
    }

    // Upload 1: BEV-LFP consistent → #aa1111. Derives a per-dim color.
    nextRowColors = rowColorsFor('#aa1111', '#11aa11')
    upload('one.xlsx')
    await waitFor(() => expect(getByTestId('chart-bev-dim').textContent).toBe('#aa1111'))

    // Upload 2: BEV-LFP now MIXED across sizes (Small ≠ Large) → ambiguous, no
    // clean per-dim derivation. The table shows the new per-row colors; the
    // per-dim chart must NOT keep the stale #aa1111.
    nextRowColors = {
      'BEV-LFP|Small': '#1111bb', 'BEV-LFP|Large': '#11bb11',
      'HEV-LFP|Small': '#cccc11', 'HEV-LFP|Large': '#cccc11',
    }
    upload('two.xlsx')
    await waitFor(() => {
      expect(useDSMStore.getState().cohortRowColors['BEV-LFP|Small']).toBe('#1111bb')
    })
    await waitFor(() => {
      expect(getByTestId('chart-bev-dim').textContent).not.toBe('#aa1111')
    })
  })
})
