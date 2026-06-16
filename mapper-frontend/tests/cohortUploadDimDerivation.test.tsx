import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { useBOMStore } from '../src/stores/bomStore'
import { useProjectStore } from '../src/stores/projectStore'
import { getOverriddenLabels } from '../src/utils/chartColors'

// Patch 4AK² — integration test for the bug-fix flow:
//
// User uploads an Excel cohort-mapping file with a Color column where
// all rows of a Fuel share one color (the WP5 scenario). After upload:
//
//   1. Per-row overrides populated (Patch 4AK contract preserved)
//   2. Per-dim overrides DERIVED from the row colors (Patch 4AK²)
//   3. Both layers reflect the user's intent so DSM Stock Composition
//      (Fuel-stacked) and cohort-key stacked charts both use the
//      uploaded palette.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    uploadCohortMappings: vi.fn(),
    downloadCohortMappingsTemplate: vi.fn(),
  }
})

beforeEach(() => {
  localStorage.clear()
  useProjectStore.setState({ currentProject: 'test-project' })
})

describe('Patch 4AK² — Excel upload derives per-dim overrides', () => {
  it('writes per-dim overrides for Fuel values whose rows all share one color', async () => {
    // Stub the upload API: returns success; the editor will then call
    // fetchCohortMappings to refresh state. Stub that too so the
    // cohortRowColors get populated with the WP5 palette.
    const { uploadCohortMappings } = await import('../src/api/client')
    vi.mocked(uploadCohortMappings).mockResolvedValue({
      mapped_cohorts: 9,
      unmapped_cohorts: [],
      invalid_cohorts: [],
      invalid_archetypes: [],
      invalid_row_colors: [],
    })
    const fetchCohortMappingsMock = vi.fn().mockImplementation(async () => {
      // Mimic the server-returned row_colors map (the Excel was just
      // parsed and persisted server-side).
      useDSMStore.setState({
        cohortRowColors: {
          'BEV-LFP|Small': '#60a5fa',
          'BEV-LFP|Sedan': '#60a5fa',
          'BEV-LFP|SUV':   '#60a5fa',
          'HEV-LFP|Small': '#22c55e',
          'HEV-LFP|Sedan': '#22c55e',
          'HEV-LFP|SUV':   '#22c55e',
          'ICEV-Petrol|Small': '#ef4444',
          'ICEV-Petrol|Sedan': '#ef4444',
          'ICEV-Petrol|SUV':   '#ef4444',
        },
      })
    })

    useDSMStore.setState({
      activeSystem: {
        id: 'sys-1', name: 'Fleet',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        time_horizon: { start_year: 2020, end_year: 2030 } as any,
        dimensions: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'fuel_type', is_age: false, labels: ['BEV-LFP', 'HEV-LFP', 'ICEV-Petrol'] } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'size', is_age: false, labels: ['Small', 'Sedan', 'SUV'] } as any,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      cohortMappings: {},
      cohortRowColors: {},
      fetchCohortMappings: fetchCohortMappingsMock,
      saveCohortMappings: vi.fn(),
      setRowColor: vi.fn(),
      clearRowColor: vi.fn(),
    })
    useBOMStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archetypes: [] as any,
      fetchArchetypes: vi.fn(),
    })

    const { CohortMappingEditor } = await import(
      '../src/components/impact/CohortMappingEditor'
    )
    const { container } = render(<CohortMappingEditor />)
    // Trigger the hidden file input via the editor's file-change handler.
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['stub'], 'wp5.xlsx')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    // Wait for the async handleFile to settle.
    await waitFor(() => {
      const overrides = getOverriddenLabels('test-project')
      expect(overrides.has('BEV-LFP')).toBe(true)
    })

    const overrides = getOverriddenLabels('test-project')
    // Patch 4AK²: per-dim overrides derived for each Fuel family.
    expect(overrides.has('BEV-LFP')).toBe(true)
    expect(overrides.has('HEV-LFP')).toBe(true)
    expect(overrides.has('ICEV-Petrol')).toBe(true)
    // Size values are ambiguous across the matrix (Small appears with
    // 3 different colors) → NOT derived.
    expect(overrides.has('Small')).toBe(false)
    expect(overrides.has('Sedan')).toBe(false)
    expect(overrides.has('SUV')).toBe(false)

    // The actual colors in localStorage match the WP5 palette.
    const raw = localStorage.getItem('mapper-color-assignments-test-project')
    const parsed = JSON.parse(raw || '{}')
    expect(parsed['BEV-LFP']).toBe('#60a5fa')
    expect(parsed['HEV-LFP']).toBe('#22c55e')
    expect(parsed['ICEV-Petrol']).toBe('#ef4444')
  })

  it('does NOT derive per-dim overrides when rows of a Fuel carry mixed colors', async () => {
    const { uploadCohortMappings } = await import('../src/api/client')
    vi.mocked(uploadCohortMappings).mockResolvedValue({
      mapped_cohorts: 3,
      unmapped_cohorts: [],
      invalid_cohorts: [],
      invalid_archetypes: [],
      invalid_row_colors: [],
    })
    const fetchCohortMappingsMock = vi.fn().mockImplementation(async () => {
      // Per-row override is intentional variation across sizes within
      // the SAME fuel — the user did NOT mean "BEV-LFP is one color".
      useDSMStore.setState({
        cohortRowColors: {
          'BEV-LFP|Small': '#aaaaaa',
          'BEV-LFP|Sedan': '#bbbbbb',
          'BEV-LFP|SUV':   '#cccccc',
        },
      })
    })

    useDSMStore.setState({
      activeSystem: {
        id: 'sys-1', name: 'Fleet',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        time_horizon: { start_year: 2020, end_year: 2030 } as any,
        dimensions: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'fuel_type', is_age: false, labels: ['BEV-LFP'] } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'size', is_age: false, labels: ['Small', 'Sedan', 'SUV'] } as any,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      cohortMappings: {},
      cohortRowColors: {},
      fetchCohortMappings: fetchCohortMappingsMock,
      saveCohortMappings: vi.fn(),
      setRowColor: vi.fn(),
      clearRowColor: vi.fn(),
    })
    useBOMStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archetypes: [] as any,
      fetchArchetypes: vi.fn(),
    })

    const { CohortMappingEditor } = await import(
      '../src/components/impact/CohortMappingEditor'
    )
    const { container } = render(<CohortMappingEditor />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [new File(['stub'], 'mixed.xlsx')],
      configurable: true,
    })
    fireEvent.change(input)

    await waitFor(() => {
      // Wait for the async handler to finish — fetchCohortMappings
      // must have been called.
      expect(fetchCohortMappingsMock).toHaveBeenCalled()
    })

    const overrides = getOverriddenLabels('test-project')
    // BEV-LFP rows carry 3 different colors → ambiguous → no derive.
    expect(overrides.has('BEV-LFP')).toBe(false)
  })
})
