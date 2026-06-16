import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, act, renderHook } from '@testing-library/react'
import { CHART_PALETTE } from '../src/utils/chartColors'
import { useDSMSystemColors } from '../src/utils/dsmCohortColors'
import { useDSMStore } from '../src/stores/dsmStore'
import { useBOMStore } from '../src/stores/bomStore'
import { useProjectStore } from '../src/stores/projectStore'

// Patch 4AK — two-layer color overrides (per-dim + per-row).
//
// Test scope:
//
//   1. CHART_PALETTE expanded to 40 colors (all valid hex)
//   2. useDSMSystemColors resolution:
//      - single-dim stacking → per-dim color (row override IGNORED)
//      - cohort-key stacking → row override wins
//   3. Picker mode toggle (row / dim tabs)
//   4. Per-row color set updates both pills in the row
//   5. Coexistence: per-row + per-dim overrides resolve independently

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    downloadCohortMappingsTemplate: vi.fn(),
    uploadCohortMappings: vi.fn(),
    setCohortMappings: vi.fn().mockResolvedValue({
      mapped_cohorts: 0, unmapped_cohorts: [], invalid_cohorts: [],
      invalid_archetypes: [], invalid_row_colors: [],
    }),
    getCohortMappings: vi.fn().mockResolvedValue({
      mfa_system_id: 'sys-test', mappings: [], row_colors: {},
    }),
  }
})

// Capture the original action references before any test stubs them.
// Tests that stub setRowColor / clearRowColor for observation purposes
// later restore via these refs.
const ORIGINAL_SET_ROW_COLOR = useDSMStore.getState().setRowColor
const ORIGINAL_CLEAR_ROW_COLOR = useDSMStore.getState().clearRowColor

beforeEach(() => {
  localStorage.clear()
  useProjectStore.setState({ currentProject: 'test-project' })
  // Patch 4AK — guarantee the row-color actions are the originals at
  // the start of every test. Previous tests' stubs would otherwise
  // bleed across describe blocks.
  useDSMStore.setState({
    setRowColor: ORIGINAL_SET_ROW_COLOR,
    clearRowColor: ORIGINAL_CLEAR_ROW_COLOR,
  })
})

describe('Patch 4AK — CHART_PALETTE expanded to 40', () => {
  it('has 40 colors', () => {
    expect(CHART_PALETTE.length).toBe(40)
  })

  it('all entries are valid #RRGGBB hex', () => {
    for (const c of CHART_PALETTE) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('all 40 colors are unique', () => {
    expect(new Set(CHART_PALETTE).size).toBe(40)
  })
})

describe('Patch 4AK — useDSMSystemColors row override resolution', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const system: any = {
    id: 'sys-1', name: 'Fleet', unit_name: 'vehicles',
    dimensions: [
      { name: 'fuel_type', is_age: false, labels: ['BEV-LFP', 'ICEV-Petrol'] },
      { name: 'size', is_age: false, labels: ['Small', 'Large'] },
    ],
  }

  it('cohort-key stacking branch — row override wins', () => {
    const { result } = renderHook(() => useDSMSystemColors(system, null, {
      rowColorOverrides: { 'BEV-LFP|Small': '#ff0000' },
    }))
    expect(result.current.colorForCohort('BEV-LFP|Small')).toBe('#ff0000')
    // No override on BEV-LFP|Large — algorithm modulo fallback.
    const other = result.current.colorForCohort('BEV-LFP|Large', 1)
    expect(other).toBe(CHART_PALETTE[1])
  })

  it('single-dim stacking branch — row overrides DO NOT apply', () => {
    const { result } = renderHook(() => useDSMSystemColors(system, 'fuel_type', {
      rowColorOverrides: { 'BEV-LFP|Small': '#ff0000' },
    }))
    // BEV-LFP|Small should resolve to the per-dim color for 'BEV-LFP',
    // NOT the row override (#ff0000). Row colors are deliberately
    // ignored in single-dim mode.
    const c = result.current.colorForCohort('BEV-LFP|Small')
    expect(c).not.toBe('#ff0000')
  })

  it('no row override on cohort-key branch — algorithm fallback (modulo)', () => {
    const { result } = renderHook(() => useDSMSystemColors(system, null, {
      rowColorOverrides: {},
    }))
    const c0 = result.current.colorForCohort('BEV-LFP|Small', 0)
    const c1 = result.current.colorForCohort('BEV-LFP|Large', 1)
    expect(c0).toBe(CHART_PALETTE[0])
    expect(c1).toBe(CHART_PALETTE[1])
  })

  it('defaults rowColorOverrides to {} when omitted', () => {
    const { result } = renderHook(() => useDSMSystemColors(system, null))
    // No throw; behaves as before Patch 4AK in the empty case.
    expect(result.current.colorForCohort('BEV-LFP|Small', 0)).toBe(CHART_PALETTE[0])
  })
})

describe('Patch 4AK — DimensionColorPicker mode toggle', () => {
  function seedStores() {
    useDSMStore.setState({
      activeSystem: {
        id: 'sys-test', name: 'Test System',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        time_horizon: { start_year: 2020, end_year: 2030 } as any,
        dimensions: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'fuel_type', is_age: false, labels: ['BEV-LFP', 'ICEV-Petrol'] } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'size', is_age: false, labels: ['Small', 'Large'] } as any,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      cohortMappings: {
        'BEV-LFP|Small': { archetype_id: 'arc-1', scaling_factor: 1.0 },
      },
      cohortRowColors: {},
      fetchCohortMappings: vi.fn(),
      saveCohortMappings: vi.fn(),
      setRowColor: vi.fn(),
      clearRowColor: vi.fn(),
    })
    useBOMStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archetypes: [{ id: 'arc-1', name: 'BEV', unlinked_count: 0 } as any] as any,
      fetchArchetypes: vi.fn(),
    })
  }

  it('picker renders mode tabs with "This row" and "All {label}"', async () => {
    seedStores()
    const { CohortMappingEditor } = await import(
      '../src/components/impact/CohortMappingEditor'
    )
    const { container } = render(<CohortMappingEditor />)
    fireEvent.click(container.querySelector('h4')!.parentElement!)
    fireEvent.click(container.querySelector(
      '[data-testid="cohort-mapping-pill-BEV-LFP"]',
    ) as HTMLButtonElement)
    expect(container.querySelector('[data-testid="dimension-color-picker-mode-tabs"]'))
      .not.toBeNull()
    const rowBtn = container.querySelector('[data-testid="dimension-color-picker-mode-row"]')
    const dimBtn = container.querySelector('[data-testid="dimension-color-picker-mode-dim"]')
    expect(rowBtn?.textContent).toContain('This row')
    expect(dimBtn?.textContent).toContain('BEV-LFP')
  })

  it('defaults to row mode (per spec)', async () => {
    seedStores()
    const { CohortMappingEditor } = await import(
      '../src/components/impact/CohortMappingEditor'
    )
    const setRowColorMock = vi.fn()
    useDSMStore.setState({ setRowColor: setRowColorMock })
    // Clear any prior algorithmic localStorage writes from sibling tests.
    localStorage.removeItem('mapper-color-overrides-test-project')
    const { container } = render(<CohortMappingEditor />)
    fireEvent.click(container.querySelector('h4')!.parentElement!)
    fireEvent.click(container.querySelector(
      '[data-testid="cohort-mapping-pill-BEV-LFP"]',
    ) as HTMLButtonElement)
    // Picker open in row mode by default. Click a preset color.
    await act(async () => {
      fireEvent.click(container.querySelector(
        '[data-testid="dimension-color-picker-preset-#8b5cf6"]',
      ) as HTMLButtonElement)
    })
    // setRowColor called, not setLabelColor (per-dim).
    expect(setRowColorMock).toHaveBeenCalledWith('BEV-LFP|Small', '#8b5cf6')
    // Per-dim overrides set is empty (no user-set per-dim override) —
    // the assignments map carries algorithm fills which is normal.
    const overridesRaw = localStorage.getItem('mapper-color-overrides-test-project')
    const overrides = overridesRaw ? JSON.parse(overridesRaw) : []
    expect(overrides).not.toContain('BEV-LFP')
  })
})

describe('Patch 4AK — row color applies to both pills in the row', () => {
  it('both Fuel and Size pills render in the row color', async () => {
    useDSMStore.setState({
      activeSystem: {
        id: 'sys-test', name: 'Test',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        time_horizon: { start_year: 2020, end_year: 2030 } as any,
        dimensions: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'fuel_type', is_age: false, labels: ['BEV-LFP'] } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'size', is_age: false, labels: ['Small'] } as any,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      cohortMappings: {
        'BEV-LFP|Small': { archetype_id: 'arc-1', scaling_factor: 1.0 },
      },
      cohortRowColors: { 'BEV-LFP|Small': '#abcdef' },
      fetchCohortMappings: vi.fn(),
      saveCohortMappings: vi.fn(),
      setRowColor: vi.fn(),
      clearRowColor: vi.fn(),
    })
    useBOMStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archetypes: [{ id: 'arc-1', name: 'BEV', unlinked_count: 0 } as any] as any,
      fetchArchetypes: vi.fn(),
    })
    const { CohortMappingEditor } = await import(
      '../src/components/impact/CohortMappingEditor'
    )
    const { container } = render(<CohortMappingEditor />)
    fireEvent.click(container.querySelector('h4')!.parentElement!)
    const fuelPill = container.querySelector(
      '[data-testid="cohort-mapping-pill-BEV-LFP"]',
    ) as HTMLElement
    const sizePill = container.querySelector(
      '[data-testid="cohort-mapping-pill-Small"]',
    ) as HTMLElement
    // The pill's Badge child carries the customColor via inline style.
    // We use textContent to confirm both pills rendered.
    expect(fuelPill).not.toBeNull()
    expect(sizePill).not.toBeNull()
    // Both pills' Badge spans should carry the same row color.
    const fuelBadge = fuelPill.querySelector('span')
    const sizeBadge = sizePill.querySelector('span')
    expect(fuelBadge?.style.color).toBe('rgb(171, 205, 239)')
    expect(sizeBadge?.style.color).toBe('rgb(171, 205, 239)')
  })
})

describe('Patch 4AK — coexistence with Patch 4AJ per-dim overrides', () => {
  it('cohort-key stacking uses row override; single-dim stacking uses per-dim', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const system: any = {
      id: 'sys-1', name: 'Fleet', unit_name: 'vehicles',
      dimensions: [
        { name: 'fuel_type', is_age: false, labels: ['BEV-LFP'] },
        { name: 'size', is_age: false, labels: ['Small'] },
      ],
    }
    // Set both: per-dim BEV-LFP → #111111, per-row BEV-LFP|Small → #222222.
    // Seed localStorage with a per-dim override for BEV-LFP.
    localStorage.setItem(
      'mapper-color-assignments-test-project',
      JSON.stringify({ 'BEV-LFP': '#111111' }),
    )

    // Cohort-key stacking → row wins.
    const { result: rA } = renderHook(() => useDSMSystemColors(system, null, {
      rowColorOverrides: { 'BEV-LFP|Small': '#222222' },
    }))
    expect(rA.current.colorForCohort('BEV-LFP|Small')).toBe('#222222')

    // Single-dim stacking → per-dim wins (and row ignored).
    const { result: rB } = renderHook(() => useDSMSystemColors(system, 'fuel_type', {
      rowColorOverrides: { 'BEV-LFP|Small': '#222222' },
    }))
    expect(rB.current.colorForCohort('BEV-LFP|Small')).toBe('#111111')
  })
})

describe('Patch 4AK — dsmStore row color actions', () => {
  // The picker-section tests above may stub setRowColor / clearRowColor;
  // the top-level beforeEach restores the originals so these tests
  // exercise real action behaviour.

  it('setRowColor calls saveCohortMappings with the merged rowColors', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined)
    useDSMStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeSystem: { id: 'sys-1' } as any,
      cohortMappings: {
        'BEV-LFP|Small': { archetype_id: 'arc-1', scaling_factor: 1.0 },
      },
      cohortRowColors: {},
      saveCohortMappings: saveMock,
    })
    await useDSMStore.getState().setRowColor('BEV-LFP|Small', '#abcdef')
    expect(saveMock).toHaveBeenCalledWith(
      { 'BEV-LFP|Small': { archetype_id: 'arc-1', scaling_factor: 1.0 } },
      { 'BEV-LFP|Small': '#abcdef' },
    )
  })

  it('clearRowColor calls saveCohortMappings with the entry removed', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined)
    useDSMStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeSystem: { id: 'sys-1' } as any,
      cohortMappings: {},
      cohortRowColors: { 'BEV-LFP|Small': '#abcdef', 'ICEV|Large': '#123456' },
      saveCohortMappings: saveMock,
    })
    await useDSMStore.getState().clearRowColor('BEV-LFP|Small')
    expect(saveMock).toHaveBeenCalledWith(
      {},
      { 'ICEV|Large': '#123456' },
    )
  })

  it('clearRowColor is a no-op when the cohortKey has no override', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined)
    useDSMStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeSystem: { id: 'sys-1' } as any,
      cohortMappings: {},
      cohortRowColors: {},
      saveCohortMappings: saveMock,
    })
    await useDSMStore.getState().clearRowColor('No-Such|Cohort')
    expect(saveMock).not.toHaveBeenCalled()
  })
})
