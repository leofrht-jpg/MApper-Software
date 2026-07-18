/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { DependencyRulesEditor } from '../src/components/subsystems/DependencyRulesEditor'
import { useDSMStore } from '../src/stores/dsmStore'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useParameterStore } from '../src/stores/parameterStore'
import type { Subsystem } from '../src/api/client'

// Dependency rules: Excel Template export + bulk import (validate → confirm →
// replace → auto-save). Mirrors the Initial stock Template/Upload convention.

const downloadDependencyRulesTemplate = vi.fn()
const importDependencyRules = vi.fn()
const updateSubsystem = vi.fn()

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    downloadDependencyRulesTemplate: (...a: unknown[]) => downloadDependencyRulesTemplate(...a),
    importDependencyRules: (...a: unknown[]) => importDependencyRules(...a),
    updateSubsystem: (...a: unknown[]) => updateSubsystem(...a),
    validateDependencyRule: vi.fn(async () => ({ ok: true, errors: [] })),
  }
})

const SUB: Subsystem = {
  id: 'sub1',
  name: 'Chargers',
  type: 'dependent',
  dimensions: [{ name: 'charger', display_name: 'Charger', labels: ['home', 'public'] }],
  depends_on: 'sys1',
  dependency_rules: [],
}

const IMPORTED = [
  { id: '', dependent_archetype_id: 'home', driver_filter: {}, expression: 'filtered_stock', description: null },
  { id: '', dependent_archetype_id: 'public', driver_filter: {}, expression: 'filtered_stock * 0.1', description: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  useDSMStore.setState({
    activeSystem: {
      id: 'sys1', name: 'Fleet',
      time_horizon: { start_year: 2025, end_year: 2030 },
      dimensions: [{ name: 'f', display_name: 'Fuel', labels: ['BEV-LFP'] }],
    } as never,
  })
  useSubsystemStore.setState({
    currentSystemId: 'sys1', subsystems: [SUB] as never, subsystemResults: {}, activeSubsystemId: 'sub1',
  })
  // Stable parameters array so the `?? []` selector doesn't loop-render.
  useParameterStore.setState({ activeSet: { id: 'Base', name: 'Base', parameters: [] } as never })
  updateSubsystem.mockImplementation(async (_sys: string, _id: string, body: Subsystem) => body)
})

function selectFile(container: HTMLElement) {
  const input = container.querySelector('[data-testid="dep-rules-file-input"]') as HTMLInputElement
  const file = new File(['xlsx'], 'rules.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  return act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
}

describe('dependency rules template + import', () => {
  it('Template button calls the template download with (systemId, subsystemId)', async () => {
    downloadDependencyRulesTemplate.mockResolvedValue(undefined)
    const { getByText } = render(<DependencyRulesEditor subsystem={SUB} />)
    await act(async () => { fireEvent.click(getByText('Template')) })
    expect(downloadDependencyRulesTemplate).toHaveBeenCalledWith('sys1', 'sub1')
  })

  it('valid import → confirm dialog → Replace → saves imported rules', async () => {
    importDependencyRules.mockResolvedValue({ ok: true, rules: IMPORTED })
    const { container, getByTestId, queryByTestId } = render(<DependencyRulesEditor subsystem={SUB} />)

    await selectFile(container)
    // Import validated → confirm dialog appears (nothing saved yet).
    await waitFor(() => expect(getByTestId('dep-rules-import-confirm')).toBeTruthy())
    expect(updateSubsystem).not.toHaveBeenCalled()

    // Confirm the destructive replace.
    await act(async () => { fireEvent.click(getByTestId('dep-rules-import-replace')) })

    await waitFor(() => expect(updateSubsystem).toHaveBeenCalledTimes(1))
    const body = updateSubsystem.mock.calls[0][2] as Subsystem
    expect(body.dependency_rules).toHaveLength(2)
    expect(body.dependency_rules[0].dependent_archetype_id).toBe('home')
    // Dialog gone; save feedback shown.
    await waitFor(() => expect(queryByTestId('dep-rules-import-confirm')).toBeNull())
    expect(container.textContent).toContain('Saved')
  })

  it('invalid import → row/field errors shown, NO dialog, nothing saved', async () => {
    importDependencyRules.mockResolvedValue({
      ok: false,
      errors: [{ row: 3, field: 'dependent_archetype', message: "'x' is not a valid archetype in this subsystem" }],
    })
    const { container, queryByTestId } = render(<DependencyRulesEditor subsystem={SUB} />)

    await selectFile(container)
    await waitFor(() => expect(container.textContent).toContain('Row 3'))
    expect(container.textContent).toContain('dependent_archetype')
    expect(queryByTestId('dep-rules-import-confirm')).toBeNull()
    expect(updateSubsystem).not.toHaveBeenCalled()
  })

  it('Cancel on the confirm dialog changes nothing (no save)', async () => {
    importDependencyRules.mockResolvedValue({ ok: true, rules: IMPORTED })
    const { container, getByText, getByTestId, queryByTestId } = render(<DependencyRulesEditor subsystem={SUB} />)

    await selectFile(container)
    await waitFor(() => expect(getByTestId('dep-rules-import-confirm')).toBeTruthy())
    await act(async () => { fireEvent.click(getByText('Cancel')) })

    expect(queryByTestId('dep-rules-import-confirm')).toBeNull()
    expect(updateSubsystem).not.toHaveBeenCalled()
  })
})
