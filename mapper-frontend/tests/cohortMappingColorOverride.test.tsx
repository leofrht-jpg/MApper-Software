/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { useBOMStore } from '../src/stores/bomStore'
import { useProjectStore } from '../src/stores/projectStore'
import { getOverriddenLabels } from '../src/utils/chartColors'

// Patch 4AJ — Cohort mapping rename + per-dim-value color override.
//
// Render tests cover the UI surface:
//   - The section header reads "Cohort mapping" (renamed from
//     "Cohort → Archetype").
//   - Clicking a dim-value pill opens the DimensionColorPicker
//     anchored to the pill.
//   - Picking a preset color writes through to localStorage AND the
//     pill's customColor updates without remount.
//   - Reset-to-auto clears the override.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>(
    '../src/api/client',
  )
  return {
    ...actual,
    downloadCohortMappingsTemplate: vi.fn(),
    uploadCohortMappings: vi.fn(),
  }
})

beforeEach(() => {
  localStorage.clear()
  useProjectStore.setState({ currentProject: 'test-project' })
  useDSMStore.setState({
    activeSystem: {
      id: 'sys-test',
      name: 'Test System',
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
      'BEV-LFP|Large': { archetype_id: 'arc-1', scaling_factor: 1.55 },
      'ICEV-Petrol|Small': { archetype_id: 'arc-2', scaling_factor: 1.0 },
      'ICEV-Petrol|Large': { archetype_id: 'arc-2', scaling_factor: 1.55 },
    },
    fetchCohortMappings: vi.fn(),
    saveCohortMappings: vi.fn(),
  })
  useBOMStore.setState({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archetypes: [
      { id: 'arc-1', name: 'BEV', unlinked_count: 0 } as any,
      { id: 'arc-2', name: 'ICEV', unlinked_count: 0 } as any,
    ] as any,
    fetchArchetypes: vi.fn(),
  })
})

describe('CohortMappingEditor — header rename (Patch 4AJ)', () => {
  it('section header reads "Cohort mapping"', async () => {
    const { CohortMappingEditor } = await import(
      '../src/components/impact/CohortMappingEditor'
    )
    const { container } = render(<CohortMappingEditor />)
    expect(container.textContent).toContain('Cohort mapping')
    // The old label must NOT be present.
    expect(container.textContent).not.toContain('Cohort → Archetype')
  })
})

describe('CohortMappingEditor — color picker interaction (Patch 4AJ)', () => {
  async function renderExpanded() {
    const { CohortMappingEditor } = await import(
      '../src/components/impact/CohortMappingEditor'
    )
    const result = render(<CohortMappingEditor />)
    // Expand the table by clicking the header.
    const header = result.container.querySelector('h4')!
    fireEvent.click(header.parentElement!)
    return result
  }

  it('clicking a Fuel pill opens the DimensionColorPicker', async () => {
    const { container } = await renderExpanded()
    const pill = container.querySelector(
      '[data-testid="cohort-mapping-pill-BEV-LFP"]',
    ) as HTMLButtonElement
    expect(pill).not.toBeNull()
    expect(container.querySelector('[data-testid="dimension-color-picker"]'))
      .toBeNull()
    fireEvent.click(pill)
    expect(container.querySelector('[data-testid="dimension-color-picker"]'))
      .not.toBeNull()
  })

  it('picking a preset color in dim mode writes through to localStorage', async () => {
    const { container } = await renderExpanded()
    const pill = container.querySelector(
      '[data-testid="cohort-mapping-pill-BEV-LFP"]',
    ) as HTMLButtonElement
    fireEvent.click(pill)
    // Patch 4AK: picker now defaults to "This row" mode. Switch to
    // "All BEV-LFP" (dim) before picking to test per-dim path.
    fireEvent.click(container.querySelector(
      '[data-testid="dimension-color-picker-mode-dim"]',
    ) as HTMLButtonElement)
    // CHART_PALETTE[0] = '#8b5cf6'. Pick that as the new color.
    const presetBtn = container.querySelector(
      '[data-testid="dimension-color-picker-preset-#8b5cf6"]',
    ) as HTMLButtonElement
    expect(presetBtn).not.toBeNull()
    await act(async () => { fireEvent.click(presetBtn) })
    // localStorage updated with the new color.
    const raw = localStorage.getItem('mapper-color-assignments-test-project')
    const parsed = JSON.parse(raw || '{}')
    expect(parsed['BEV-LFP']).toBe('#8b5cf6')
    // Override is tracked.
    expect(getOverriddenLabels('test-project').has('BEV-LFP')).toBe(true)
    // Picker closed.
    expect(container.querySelector('[data-testid="dimension-color-picker"]'))
      .toBeNull()
  })

  it('Reset to auto in dim mode clears the per-dim override and closes the picker', async () => {
    const { CohortMappingEditor } = await import(
      '../src/components/impact/CohortMappingEditor'
    )
    const { container } = render(<CohortMappingEditor />)
    fireEvent.click(container.querySelector('h4')!.parentElement!)
    // Open picker for BEV-LFP, switch to dim mode, pick color.
    fireEvent.click(container.querySelector(
      '[data-testid="cohort-mapping-pill-BEV-LFP"]',
    ) as HTMLButtonElement)
    fireEvent.click(container.querySelector(
      '[data-testid="dimension-color-picker-mode-dim"]',
    ) as HTMLButtonElement)
    await act(async () => {
      fireEvent.click(container.querySelector(
        '[data-testid="dimension-color-picker-preset-#ef4444"]',
      ) as HTMLButtonElement)
    })
    expect(getOverriddenLabels('test-project').has('BEV-LFP')).toBe(true)

    // Reopen picker, switch to dim, reset.
    fireEvent.click(container.querySelector(
      '[data-testid="cohort-mapping-pill-BEV-LFP"]',
    ) as HTMLButtonElement)
    fireEvent.click(container.querySelector(
      '[data-testid="dimension-color-picker-mode-dim"]',
    ) as HTMLButtonElement)
    const resetBtn = container.querySelector(
      '[data-testid="dimension-color-picker-reset"]',
    ) as HTMLButtonElement
    expect(resetBtn).not.toBeNull()
    expect(resetBtn.hasAttribute('disabled')).toBe(false)
    await act(async () => { fireEvent.click(resetBtn) })

    expect(getOverriddenLabels('test-project').has('BEV-LFP')).toBe(false)
    expect(container.querySelector('[data-testid="dimension-color-picker"]'))
      .toBeNull()
  })

  it('hex input in dim mode accepts a 6-digit color and applies it', async () => {
    const { container } = await renderExpanded()
    fireEvent.click(container.querySelector(
      '[data-testid="cohort-mapping-pill-BEV-LFP"]',
    ) as HTMLButtonElement)
    fireEvent.click(container.querySelector(
      '[data-testid="dimension-color-picker-mode-dim"]',
    ) as HTMLButtonElement)
    const hexInput = container.querySelector(
      '[data-testid="dimension-color-picker-hex"]',
    ) as HTMLInputElement
    fireEvent.change(hexInput, { target: { value: '#abcdef' } })
    await act(async () => {
      fireEvent.click(container.querySelector(
        '[data-testid="dimension-color-picker-hex-apply"]',
      ) as HTMLButtonElement)
    })
    const parsed = JSON.parse(localStorage.getItem('mapper-color-assignments-test-project')!)
    expect(parsed['BEV-LFP']).toBe('#abcdef')
  })

  it('hex input rejects invalid hex and stays open', async () => {
    const { container } = await renderExpanded()
    fireEvent.click(container.querySelector(
      '[data-testid="cohort-mapping-pill-BEV-LFP"]',
    ) as HTMLButtonElement)
    const hexInput = container.querySelector(
      '[data-testid="dimension-color-picker-hex"]',
    ) as HTMLInputElement
    fireEvent.change(hexInput, { target: { value: 'not-a-color' } })
    await act(async () => {
      fireEvent.click(container.querySelector(
        '[data-testid="dimension-color-picker-hex-apply"]',
      ) as HTMLButtonElement)
    })
    // Picker still open (invalid hex didn't apply).
    expect(container.querySelector('[data-testid="dimension-color-picker"]'))
      .not.toBeNull()
    // No write.
    expect(getOverriddenLabels('test-project').has('BEV-LFP')).toBe(false)
  })
})
