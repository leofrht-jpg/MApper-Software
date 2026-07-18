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
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useBOMStore } from '../src/stores/bomStore'
import type { Subsystem } from '../src/api/client'

// CHANGE 2 — subsystem cohort mapping works independently of the primary and
// shows the subsystem's own cohorts even when it has NO dependency rules
// (manual mode), saving per-subsystem via saveDependent.

const updateSubsystem = vi.fn()

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, updateSubsystem: (...a: unknown[]) => updateSubsystem(...a) }
})

// A dependent subsystem with NO rules (manual mode) but real cohorts (dims).
const MANUAL_SUB: Subsystem = {
  id: 'sub1',
  name: 'Chargers',
  type: 'dependent',
  dimensions: [{ name: 'charger', display_name: 'Charger', labels: ['home', 'public'] }],
  depends_on: 'sys1',
  dependency_rules: [],
  cohort_mappings: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  updateSubsystem.mockImplementation(async (_s: string, _i: string, body: Subsystem) => body)
  useSubsystemStore.setState({ currentSystemId: 'sys1', subsystems: [MANUAL_SUB] as never, subsystemResults: {} })
  useBOMStore.setState({
    archetypes: [
      { id: 'arc_home', name: 'Home charger', unlinked_count: 0 },
      { id: 'arc_pub', name: 'Public charger', unlinked_count: 0 },
    ] as never,
  })
})

describe('subsystem cohort mapping (manual, no rules)', () => {
  it('shows the subsystem cohorts even with no dependency rules', () => {
    const { container } = render(
      <SubsystemMappingCard subsystem={MANUAL_SUB} archetypesWithIssues={new Set()} />,
    )
    // Cohort keys from dims (home, public) appear as mappable rows.
    expect(container.textContent).toContain('home')
    expect(container.textContent).toContain('public')
  })

  it('saving a mapping calls saveDependent for THIS subsystem with cohort_mappings', async () => {
    const { container } = render(
      <SubsystemMappingCard subsystem={MANUAL_SUB} archetypesWithIssues={new Set()} />,
    )
    const select = container.querySelector('select') as HTMLSelectElement
    await act(async () => { fireEvent.change(select, { target: { value: 'arc_home' } }) })
    // Auto-save is debounced (400ms) — wait for the real timer.
    await waitFor(() => expect(updateSubsystem).toHaveBeenCalledTimes(1), { timeout: 2000 })
    const [sysId, subId, body] = updateSubsystem.mock.calls[0] as [string, string, Subsystem]
    expect(sysId).toBe('sys1')
    expect(subId).toBe('sub1')
    // Saved on the subsystem's own cohort_mappings (per-subsystem, not primary).
    expect(Object.values(body.cohort_mappings ?? {})[0]?.archetype_id).toBe('arc_home')
  })
})
