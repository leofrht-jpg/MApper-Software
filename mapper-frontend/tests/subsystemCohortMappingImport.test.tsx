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
import { SubsystemMappingCard } from '../src/components/impact/DependentCohortMappingsPanel'
import { useDSMStore } from '../src/stores/dsmStore'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useBOMStore } from '../src/stores/bomStore'
import type { Subsystem } from '../src/api/client'

// Subsystem cohort-mapping Template/Upload — mirrors the primary system's
// cohort-mapping and the dependency-rules import (validate → confirm → replace
// → auto-save). Reject-the-whole-file-on-any-error; inline WKWebView-safe dialog.

const downloadSubsystemCohortMappingTemplate = vi.fn()
const importSubsystemCohortMapping = vi.fn()
const updateSubsystem = vi.fn()

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    downloadSubsystemCohortMappingTemplate: (...a: unknown[]) => downloadSubsystemCohortMappingTemplate(...a),
    importSubsystemCohortMapping: (...a: unknown[]) => importSubsystemCohortMapping(...a),
    updateSubsystem: (...a: unknown[]) => updateSubsystem(...a),
  }
})

const SUB: Subsystem = {
  id: 'sub1',
  name: 'Fuel Infrastructure',
  type: 'dependent',
  dimensions: [{ name: 'station', display_name: 'Station', labels: ['Default', 'Large'] }],
  depends_on: 'sys1',
  dependency_rules: [],
  cohort_mappings: {},
}

const IMPORTED = {
  Default: { archetype_id: 'arc1', scaling_factor: 1.5 },
  Large: { archetype_id: 'arc1', scaling_factor: 1.0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  useDSMStore.setState({
    activeSystem: {
      id: 'sys1', name: 'Fleet',
      time_horizon: { start_year: 2025, end_year: 2030 },
      dimensions: [{ name: 'f', display_name: 'Fuel', labels: ['CNG'] }],
    } as never,
  })
  useSubsystemStore.setState({
    currentSystemId: 'sys1', subsystems: [SUB] as never, subsystemResults: {}, activeSubsystemId: 'sub1',
  })
  useBOMStore.setState({
    archetypes: [{ id: 'arc1', name: 'Charging Station BOM', unlinked_count: 0 }] as never,
  })
  updateSubsystem.mockImplementation(async (_sys: string, _id: string, body: Subsystem) => body)
})

function selectFile(container: HTMLElement) {
  const input = container.querySelector('[data-testid="subsystem-cohort-file-input"]') as HTMLInputElement
  const file = new File(['xlsx'], 'cohort_mapping.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  return act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
}

function renderCard() {
  return render(<SubsystemMappingCard subsystem={SUB} archetypesWithIssues={new Set()} />)
}

describe('subsystem cohort mapping template + import', () => {
  it('Template button downloads with (systemId, subsystemId, name)', async () => {
    downloadSubsystemCohortMappingTemplate.mockResolvedValue(undefined)
    const { getByTestId } = renderCard()
    await act(async () => { fireEvent.click(getByTestId('subsystem-cohort-template')) })
    expect(downloadSubsystemCohortMappingTemplate).toHaveBeenCalledWith('sys1', 'sub1', 'Fuel Infrastructure')
  })

  it('valid import → confirm dialog → Replace → saves the mappings', async () => {
    importSubsystemCohortMapping.mockResolvedValue({ ok: true, mappings: IMPORTED })
    const { container, getByTestId, queryByTestId } = renderCard()

    await selectFile(container)
    // Validated → confirm dialog appears; nothing saved yet.
    await waitFor(() => expect(getByTestId('subsystem-cohort-import-confirm')).toBeTruthy())
    expect(updateSubsystem).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(getByTestId('subsystem-cohort-import-replace')) })

    await waitFor(() => expect(updateSubsystem).toHaveBeenCalledTimes(1))
    const body = updateSubsystem.mock.calls[0][2] as Subsystem
    expect(body.cohort_mappings).toEqual(IMPORTED)
    await waitFor(() => expect(queryByTestId('subsystem-cohort-import-confirm')).toBeNull())
    expect(container.textContent).toContain('Imported 2 mappings')
  })

  it('invalid import → row/field errors shown, NO dialog, nothing saved', async () => {
    importSubsystemCohortMapping.mockResolvedValue({
      ok: false,
      errors: [{ row: 3, field: 'dependent_archetype', message: "'x' is not a valid cohort key for this subsystem" }],
    })
    const { container, queryByTestId } = renderCard()

    await selectFile(container)
    await waitFor(() => expect(container.textContent).toContain('Row 3'))
    expect(container.textContent).toContain('dependent_archetype')
    expect(queryByTestId('subsystem-cohort-import-confirm')).toBeNull()
    expect(updateSubsystem).not.toHaveBeenCalled()
  })

  it('Cancel on the confirm dialog changes nothing (no save)', async () => {
    importSubsystemCohortMapping.mockResolvedValue({ ok: true, mappings: IMPORTED })
    const { container, getByText, getByTestId, queryByTestId } = renderCard()

    await selectFile(container)
    await waitFor(() => expect(getByTestId('subsystem-cohort-import-confirm')).toBeTruthy())
    await act(async () => { fireEvent.click(getByText('Cancel')) })

    expect(queryByTestId('subsystem-cohort-import-confirm')).toBeNull()
    expect(updateSubsystem).not.toHaveBeenCalled()
  })
})
