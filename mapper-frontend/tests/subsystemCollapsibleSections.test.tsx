/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, act, within } from '@testing-library/react'
import { DependentSubsystemView } from '../src/components/subsystems/DependentSubsystemView'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useDSMStore } from '../src/stores/dsmStore'
import { useParameterStore } from '../src/stores/parameterStore'
import type { Subsystem } from '../src/api/client'

// Collapsible subsystem-panel sections: each section body stays MOUNTED when
// collapsed (visibility-toggle, display:none), headers toggle on click, and
// collapse state resets to defaults when switching subsystems.

const updateSubsystem = vi.fn()
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, updateSubsystem: (...a: unknown[]) => updateSubsystem(...a) }
})

const DIMS = [{ name: 'charger', display_name: 'Charger', labels: ['home', 'public'] }]

function makeSub(over: Partial<Subsystem> = {}): Subsystem {
  return {
    id: 'sub1', name: 'Chargers', type: 'dependent', depends_on: 'sys1',
    dimensions: DIMS, dependency_rules: [], mode: 'rules',
    manual_inflows: {}, manual_outflows: {}, cohort_mappings: {}, initial_stock: {},
    ...over,
  }
}

function seed(subs: Subsystem[]) {
  useSubsystemStore.setState({
    currentSystemId: 'sys1', subsystems: subs as never, subsystemResults: {},
    loadResult: (async () => undefined) as never, isComputing: false, error: '',
  })
  useDSMStore.setState({ activeSystem: { id: 'sys1', name: 'F', dimensions: DIMS, time_horizon: { start_year: 2025, end_year: 2030 } } as never })
  useParameterStore.setState({ activeSet: { id: 'Base', name: 'Base', parameters: [] } as never, activeSetId: 'Base' })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateSubsystem.mockImplementation(async (_s: string, _i: string, body: Subsystem) => body)
})

function renderView(subs: Subsystem[], subsystemId = 'sub1') {
  seed(subs)
  const r = render(<DependentSubsystemView subsystemId={subsystemId} activeTab="dynamics" onTabChange={() => {}} />)
  // The mount effect (fetchForSystem) can clear the seeded subsystems; re-apply
  // them after mount so the component resolves the subsystem (mirrors the
  // subsystemModeToggle harness).
  act(() => { useSubsystemStore.setState({ subsystems: subs as never }) })
  return r
}

describe('subsystem panel collapsible sections', () => {
  it('Initial stock + Dependency rules bodies are mounted and expanded by default', async () => {
    const { findByTestId, getByTestId } = renderView([makeSub()])
    const initial = await findByTestId('initial-stock-body')
    const rules = getByTestId('dep-rules-body')
    expect(initial).toBeTruthy()
    expect(rules).toBeTruthy()
    expect(initial.style.display).not.toBe('none')  // expanded
    expect(rules.style.display).not.toBe('none')
  })

  it('clicking a section header collapses it (body stays MOUNTED, display:none) and re-expands', () => {
    const { getByTestId, getByText } = renderView([makeSub()])
    const body = getByTestId('initial-stock-body')
    expect(body.style.display).not.toBe('none')

    // Click the "Initial stock" header title (click bubbles to the header row).
    fireEvent.click(getByText('Initial stock'))
    expect(getByTestId('initial-stock-body')).toBeTruthy()  // still in the DOM
    expect(getByTestId('initial-stock-body').style.display).toBe('none')  // hidden, not unmounted

    fireEvent.click(getByText('Initial stock'))
    expect(getByTestId('initial-stock-body').style.display).not.toBe('none')  // re-expanded
  })

  it('sections collapse independently', () => {
    const { getByTestId, getByText } = renderView([makeSub()])
    fireEvent.click(getByText('Initial stock'))
    expect(getByTestId('initial-stock-body').style.display).toBe('none')
    expect(getByTestId('dep-rules-body').style.display).not.toBe('none')  // unaffected
  })

  it('switching to a different subsystem resets collapse state to defaults', () => {
    const { getByTestId, getByText, rerender } = renderView(
      [makeSub({ id: 'sub1', name: 'Chargers' }), makeSub({ id: 'sub2', name: 'Pipes' })], 'sub1',
    )
    fireEvent.click(getByText('Initial stock'))
    expect(getByTestId('initial-stock-body').style.display).toBe('none')

    act(() => {
      rerender(<DependentSubsystemView subsystemId="sub2" activeTab="dynamics" onTabChange={() => {}} />)
    })
    // Reset to default (expanded) for the newly-selected subsystem.
    expect(getByTestId('initial-stock-body').style.display).not.toBe('none')
  })

  it('mode selector + Cohort mapping + Compute stay visible regardless of collapse', () => {
    const { getByTestId, getByText } = renderView([makeSub()])
    fireEvent.click(getByText('Initial stock'))  // collapse a section
    expect(getByTestId('initial-stock-body').style.display).toBe('none')
    // Permanently-visible controls remain.
    expect(getByTestId('subsystem-mode-toggle')).toBeTruthy()
    expect(getByTestId('subsystem-mode-rules')).toBeTruthy()
    expect(getByText('Cohort mapping')).toBeTruthy()
    expect(getByText('Compute')).toBeTruthy()
  })

  it('clicking a Template button in a collapsed-section header does not toggle the section', () => {
    const { getByTestId, getByText } = renderView([makeSub()])
    const initialBody = getByTestId('initial-stock-body')
    expect(initialBody.style.display).not.toBe('none')
    // The Template button lives in the header actions (stop-propagation).
    const header = getByText('Initial stock').closest('[data-collapsed]') as HTMLElement
    fireEvent.click(within(header).getByText('Template'))
    // Section did NOT collapse (action clicks are isolated from the toggle).
    expect(getByTestId('initial-stock-body').style.display).not.toBe('none')
  })
})
