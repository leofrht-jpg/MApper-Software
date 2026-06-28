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

// Bug repro: uploading a NEW cohort-mapping file must replace the displayed
// table (archetype + scale), every time — including a second consecutive
// upload. This exercises the REAL fetchCohortMappings store action (not a
// mock), with getCohortMappings returning different data on successive calls.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    uploadCohortMappings: vi.fn(),
    downloadCohortMappingsTemplate: vi.fn(),
    getCohortMappings: vi.fn(),
    setCohortMappings: vi.fn(),
  }
})

const CK = ['BEV|Small', 'BEV|Large', 'ICE|Small', 'ICE|Large']

function mapping(archId: string, scale: number) {
  return {
    mfa_system_id: 'sys-1',
    mappings: CK.map((cohort_key) => ({ cohort_key, archetype_id: archId, scaling_factor: scale })),
    row_colors: {},
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useProjectStore.setState({ currentProject: 'test-project' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Cohort mapping — Upload refreshes the table', () => {
  it('a second upload with different data replaces the displayed archetype + scale', async () => {
    const client = await import('../src/api/client')

    // getCohortMappings: 1st call (mount) → Alpha/1.0, 2nd (after upload) →
    // Beta/2.0. mockResolvedValueOnce twice; later calls keep Beta.
    vi.mocked(client.getCohortMappings)
      .mockResolvedValueOnce(mapping('arcA', 1.0) as never)
      .mockResolvedValue(mapping('arcB', 2.0) as never)
    vi.mocked(client.uploadCohortMappings).mockResolvedValue({
      mapped_cohorts: 4, unmapped_cohorts: [], invalid_cohorts: [],
      invalid_archetypes: [], invalid_row_colors: [],
    } as never)

    // Real bug scenario: the system already has a mapping loaded (so the
    // auto-generate effect does NOT fire). Pre-populate cohortMappings with v1.
    const v1dict = Object.fromEntries(
      CK.map((ck) => [ck, { archetype_id: 'arcA', scaling_factor: 1.0 }]),
    )
    // Use the REAL store actions (do NOT override fetchCohortMappings).
    useDSMStore.setState({
      activeSystem: {
        id: 'sys-1', name: 'Fleet',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        time_horizon: { start_year: 2020, end_year: 2030 } as any,
        dimensions: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'fuel_type', display_name: 'Fuel', is_age: false, labels: ['BEV', 'ICE'] } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'size', display_name: 'Size', is_age: false, labels: ['Small', 'Large'] } as any,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      cohortMappings: v1dict, cohortRowColors: {},
    })
    useBOMStore.setState({
      archetypes: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'arcA', name: 'Alpha', unlinked_count: 0 } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'arcB', name: 'Beta', unlinked_count: 0 } as any,
      ],
      fetchArchetypes: vi.fn(),
    })

    const { CohortMappingEditor } = await import(
      '../src/components/impact/CohortMappingEditor'
    )
    const { container } = render(<CohortMappingEditor />)

    // Mount fetch resolves to Alpha/1.0.
    await waitFor(() => {
      expect(useDSMStore.getState().cohortMappings['BEV|Small']?.archetype_id).toBe('arcA')
    })

    // First upload (file 1) → still resolves to the SAME getCohortMappings #2 (Beta).
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const upload = (name: string) => {
      Object.defineProperty(input, 'files', {
        value: [new File(['stub'], name)], configurable: true,
      })
      fireEvent.change(input)
    }

    // Two CONSECUTIVE uploads of different files (also guards the input-reset bug
    // — handleFile clears fileInputRef.value in finally, so a second change fires).
    upload('first.xlsx')
    await waitFor(() => {
      expect(useDSMStore.getState().cohortMappings['BEV|Small']?.archetype_id).toBe('arcB')
    })
    upload('second.xlsx')

    // After the uploads the store MUST hold the latest fetched data, not the frozen first.
    await waitFor(() => {
      expect(vi.mocked(client.uploadCohortMappings)).toHaveBeenCalledTimes(2)
    })
    const m = useDSMStore.getState().cohortMappings['BEV|Small']
    expect(m?.archetype_id).toBe('arcB')
    expect(m?.scaling_factor).toBe(2.0)
  })

  it('request() sends cache: no-store so the webview cannot serve a stale GET', async () => {
    // The fix: every API request bypasses + never stores the HTTP cache. Spy on
    // global fetch and confirm a real client GET carries cache: 'no-store'.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    )
    const actual = await vi.importActual<typeof import('../src/api/client')>(
      '../src/api/client',
    )
    await actual.listDSMSystems()
    expect(fetchSpy).toHaveBeenCalled()
    const opts = fetchSpy.mock.calls[0][1] as RequestInit
    expect(opts.cache).toBe('no-store')
  })
})
