/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useDSMStore } from '../src/stores/dsmStore'
import { useBOMStore } from '../src/stores/bomStore'
import { useSubsystemStore } from '../src/stores/subsystemStore'
import { useProjectStore } from '../src/stores/projectStore'

// The cohort-mapping modal stacks the primary system's section and one section
// per dependent subsystem. Both used different naming conventions and only the
// primary collapsed, so a system with several subsystems became an
// unmanageable scroll. These lock in: consistent naming, independent
// collapsing, and — because edits auto-save — that a collapsed body stays
// MOUNTED rather than being unmounted.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return {
    ...actual,
    downloadCohortMappingsTemplate: vi.fn(async () => {}),
    uploadCohortMappings: vi.fn(async () => ({})),
    downloadSubsystemCohortMappingTemplate: vi.fn(async () => {}),
  }
})

const SUBSYSTEM = {
  id: 'sub-1',
  name: 'Fueling Infrastructure',
  type: 'dependent',
  dimensions: [],
  dependency_rules: [{ dependent_archetype_id: 'arc-2' }],
  cohort_mappings: { 'arc-2': { archetype_id: 'arc-2', scaling_factor: 1 } },
} as never

beforeEach(() => {
  localStorage.clear()
  useProjectStore.setState({ currentProject: 'test-project' })
  useDSMStore.setState({
    activeSystem: {
      id: 'sys-1',
      name: 'Car Fleet',
      time_horizon: { start_year: 2020, end_year: 2030 },
      dimensions: [{ name: 'fuel', is_age: false, labels: ['BEV', 'ICEV'] }],
    } as never,
    cohortMappings: { BEV: { archetype_id: 'arc-1', scaling_factor: 1 } },
    fetchCohortMappings: vi.fn(),
    saveCohortMappings: vi.fn(),
  })
  useBOMStore.setState({
    archetypes: [
      { id: 'arc-1', name: 'BEV', unlinked_count: 0 },
      { id: 'arc-2', name: 'Charger', unlinked_count: 0 },
    ] as never,
    fetchArchetypes: vi.fn(),
  })
  useSubsystemStore.setState({
    subsystems: [SUBSYSTEM],
    fetchForSystem: vi.fn(),
    saveDependent: vi.fn(async () => {}),
  } as never)
})

async function renderPrimary() {
  const { CohortMappingEditor } = await import('../src/components/impact/CohortMappingEditor')
  return render(<CohortMappingEditor />)
}

async function renderSubsystem(overrides: Record<string, unknown> = {}, index = 0) {
  const { SubsystemMappingCard } = await import(
    '../src/components/impact/DependentCohortMappingsPanel'
  )
  return render(
    <SubsystemMappingCard
      subsystem={{ ...(SUBSYSTEM as object), ...overrides } as never}
      archetypesWithIssues={new Set()}
      index={index}
    />,
  )
}

// ── Headings ────────────────────────────────────────────────────────────────

describe('section headings', () => {
  it('primary section is named after the system', async () => {
    const { container } = await renderPrimary()
    expect(
      container.querySelector('[data-testid="primary-mapping-heading"]')?.textContent,
    ).toBe('Car Fleet')
  })

  it('primary section falls back to "Main system" when unnamed', async () => {
    // Same fallback the primary DSM tab uses (SubsystemTabs).
    useDSMStore.setState({
      activeSystem: {
        id: 'sys-1',
        name: '   ',
        time_horizon: { start_year: 2020, end_year: 2030 },
        dimensions: [{ name: 'fuel', is_age: false, labels: ['BEV'] }],
      } as never,
    })
    const { container } = await renderPrimary()
    expect(
      container.querySelector('[data-testid="primary-mapping-heading"]')?.textContent,
    ).toBe('Main system')
  })

  it('subsystem section is named after the subsystem', async () => {
    const { container } = await renderSubsystem()
    const h = container.querySelector('[data-testid="subsystem-mapping-heading"]')
    expect(h?.textContent).toContain('Fueling Infrastructure')
    // Ordinals are a fallback only — a named subsystem must not be numbered.
    expect(h?.textContent).not.toContain('Subsystem 1')
  })

  it('subsystem section falls back to an ordinal only when unnamed', async () => {
    const { container } = await renderSubsystem({ name: '' }, 2)
    expect(
      container.querySelector('[data-testid="subsystem-mapping-heading"]')?.textContent,
    ).toContain('Subsystem 3')
  })

  it('both sections use the same "N of M mapped" count convention', async () => {
    const primary = await renderPrimary()
    expect(
      primary.container.querySelector('[data-testid="primary-mapping-heading"]')
        ?.parentElement?.textContent,
    ).toMatch(/·\s*\d+ of \d+ mapped/)

    const sub = await renderSubsystem()
    expect(
      sub.container.querySelector('[data-testid="subsystem-mapping-heading"]')?.textContent,
    ).toMatch(/·\s*\d+ of \d+ mapped/)
    // The old "(21)" heading suffix and its duplicated subtitle count are gone.
    expect(
      sub.container.querySelector('[data-testid="subsystem-mapping-heading"]')?.textContent,
    ).not.toMatch(/\(\d+\)/)
  })
})

// ── Collapsing ──────────────────────────────────────────────────────────────

describe('collapsing', () => {
  it('both sections render a collapse control', async () => {
    const primary = await renderPrimary()
    expect(primary.container.querySelector('[data-collapsed]')).not.toBeNull()

    const sub = await renderSubsystem()
    expect(sub.container.querySelector('[data-collapsed]')).not.toBeNull()
  })

  it('both sections start expanded', async () => {
    const primary = await renderPrimary()
    expect(
      primary.container.querySelector('[data-testid="primary-mapping-body"]'),
    ).toHaveStyle({ display: 'block' })

    const sub = await renderSubsystem()
    expect(
      sub.container.querySelector('[data-testid="subsystem-mapping-body"]'),
    ).toHaveStyle({ display: 'block' })
  })

  it('collapsing the primary hides its body but keeps it mounted', async () => {
    // Unmounting would drop a pending auto-save and lose scroll/edit state.
    const { container } = await renderPrimary()
    fireEvent.click(container.querySelector('[data-collapsed]')!)
    const body = container.querySelector('[data-testid="primary-mapping-body"]')
    expect(body).not.toBeNull()
    expect(body).toHaveStyle({ display: 'none' })
  })

  it('collapsing a subsystem hides its body but keeps it mounted', async () => {
    const { container } = await renderSubsystem()
    fireEvent.click(container.querySelector('[data-collapsed]')!)
    const body = container.querySelector('[data-testid="subsystem-mapping-body"]')
    expect(body).not.toBeNull()
    expect(body).toHaveStyle({ display: 'none' })
  })

  it('sections collapse independently', async () => {
    const { DependentCohortMappingsPanel } = await import(
      '../src/components/impact/DependentCohortMappingsPanel'
    )
    useSubsystemStore.setState({
      subsystems: [
        SUBSYSTEM,
        { ...(SUBSYSTEM as object), id: 'sub-2', name: 'Grid Upgrades' } as never,
      ],
    } as never)
    const { container } = render(<DependentCohortMappingsPanel />)
    const headers = container.querySelectorAll('[data-collapsed]')
    expect(headers.length).toBe(2)

    fireEvent.click(headers[0])
    const bodies = container.querySelectorAll('[data-testid="subsystem-mapping-body"]')
    expect(bodies[0]).toHaveStyle({ display: 'none' })
    expect(bodies[1]).toHaveStyle({ display: 'block' })
  })
})

// ── Header actions must not toggle ──────────────────────────────────────────

describe('header actions', () => {
  it('clicking Template in the primary header does not collapse it', async () => {
    const { container } = await renderPrimary()
    const body = () => container.querySelector('[data-testid="primary-mapping-body"]')
    expect(body()).toHaveStyle({ display: 'block' })

    const template = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Template'),
    )!
    fireEvent.click(template)
    expect(body()).toHaveStyle({ display: 'block' })
  })

  it('clicking Upload/Template in a subsystem header does not collapse it', async () => {
    const { container } = await renderSubsystem()
    const body = () => container.querySelector('[data-testid="subsystem-mapping-body"]')

    fireEvent.click(container.querySelector('[data-testid="subsystem-cohort-template"]')!)
    expect(body()).toHaveStyle({ display: 'block' })

    fireEvent.click(container.querySelector('[data-testid="subsystem-cohort-upload"]')!)
    expect(body()).toHaveStyle({ display: 'block' })
  })
})
