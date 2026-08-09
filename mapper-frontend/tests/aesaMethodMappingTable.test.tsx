/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MethodMappingTable } from '../src/components/aesa/MethodMappingTable'
import {
  buildMappingTable, computeMethodCoverage,
  type BoundaryLike, type MappingLike,
} from '../src/utils/aesaMethodCoverage'

// The section used to show only "16 boundaries · 15/25 methods · 0
// unrecognised". A count cannot be checked: it does not say WHICH method
// characterises which boundary, so neither a user nor a reviewer could tell a
// correct mapping from a wrong one.

const BOUNDARY_FILE = resolve(
  process.cwd(), '../mapper-backend/mapper/data/aesa/boundary_sets.json',
)

/** The shipped Sala boundaries, keyed by id — the same shape the API serves. */
const SALA: Record<string, BoundaryLike> = (() => {
  const json = JSON.parse(readFileSync(BOUNDARY_FILE, 'utf-8'))
  const set = json.sets.find((s: { id: string }) => s.id === 'Sala2020_EF')
  const bs = set.boundaries
  const list = (Array.isArray(bs) ? bs : Object.values(bs)) as Array<any>
  return Object.fromEntries(list.map((b) => [b.id, b]))
})()

const SALA_IDS = Object.keys(SALA)

/** EF v3.1's real shape: 16 aggregates plus the sub-components EF publishes
 *  alongside them. Enough to exercise the expected/unrecognised split. */
const EF_METHODS = [
  ...SALA_IDS.map((id) => ({ method: ['EF v3.1', SALA[id].name.toLowerCase(), 'x'] })),
  { method: ['EF v3.1', 'climate change: fossil', 'x'] },
  { method: ['EF v3.1', 'climate change: biogenic', 'x'] },
  { method: ['EF v3.1', 'climate change: land use and land use change', 'x'] },
]

const FULL_MAPPING: MappingLike[] = SALA_IDS.map((id) => ({
  method_tuple: ['EF v3.1', SALA[id].name.toLowerCase(), 'x'],
  pb_id: id,
  conversion_factor: 1,
}))

const coverageFor = (mappings: MappingLike[], methods = EF_METHODS) =>
  computeMethodCoverage(methods, mappings, SALA_IDS)

beforeEach(() => { cleanup() })

// ── the mapping is visible ──────────────────────────────────────────────────

describe('the expanded view lists every mapped boundary with its method', () => {
  it('renders one row per mapping', () => {
    render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    for (const id of SALA_IDS) {
      expect(screen.getByTestId(`aesa-mapping-row-${id}`), `${id} has no row`).toBeTruthy()
    }
  })

  it('shows the FULL method tuple, not just the indicator', () => {
    // Only the whole tuple identifies a method unambiguously — EF reuses
    // indicator names across versions and across method families.
    render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    const row = screen.getByTestId('aesa-mapping-row-acidification')
    for (const segment of ['EF v3.1', 'acidification', 'x']) {
      expect(row.textContent).toContain(segment)
    }
  })

  it('shows the boundary name and its flow/cumulative sub-label', () => {
    render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    const row = screen.getByTestId('aesa-mapping-row-climate_change')
    expect(row.textContent).toContain('Climate change')
    expect(row.textContent).toContain(String(SALA.climate_change.boundary_type))
  })

  it('shows a non-default conversion factor, and hides the default', () => {
    // A factor of 1 is "no conversion" — printing it on all 16 rows is noise
    // that hides the one row where it matters.
    const withFactor = FULL_MAPPING.map((m) =>
      m.pb_id === 'water_use' ? { ...m, conversion_factor: 2.5 } : m)
    render(<MethodMappingTable
      mappings={withFactor} boundaries={SALA} coverage={coverageFor(withFactor)} />)
    // Read the factor CELL, not the row: the row also contains "EF v3.1".
    const factorCell = (id: string) =>
      screen.getByTestId(`aesa-mapping-row-${id}`).querySelectorAll('td')[2]!.textContent
    expect(factorCell('water_use')).toContain('2.5')
    expect(factorCell('land_use')).toBe('—')
  })

  it('carries the full boundary name in a tooltip', () => {
    const { container } = render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    const row = container.querySelector('[data-testid="aesa-mapping-row-ecotoxicity_freshwater"]')!
    expect(row.querySelector('[title="Ecotoxicity, freshwater"]')).not.toBeNull()
  })

  it('never truncates a boundary name', () => {
    render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    for (const id of SALA_IDS) {
      expect(screen.getByTestId(`aesa-mapping-row-${id}`).textContent).not.toMatch(/…|\.\.\./)
    }
  })
})

// ── expected vs unrecognised ────────────────────────────────────────────────

describe('expected and unrecognised are distinct, structurally and visually', () => {
  it('separates them into different blocks', () => {
    const partial = FULL_MAPPING.filter((m) => m.pb_id !== 'water_use')
    const methods = [...EF_METHODS, { method: ['ReCiPe', 'something else', 'x'] }]
    render(<MethodMappingTable
      mappings={partial} boundaries={SALA} coverage={coverageFor(partial, methods)} />)

    const expected = screen.getByTestId('aesa-mapping-expected')
    const unrecognised = screen.getByTestId('aesa-mapping-unrecognised')
    expect(expected).not.toBe(unrecognised)
    // The three climate sub-components are expected; the ReCiPe method is not.
    expect(within(expected).getAllByTestId('aesa-mapping-expected-row')).toHaveLength(3)
    expect(within(unrecognised).getAllByTestId('aesa-mapping-unrecognised-row').length)
      .toBeGreaterThanOrEqual(1)
    expect(unrecognised.textContent).toContain('something else')
  })

  it('groups expected sub-components under the aggregate they decompose', () => {
    render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    const group = screen.getByTestId('aesa-mapping-expected-group-climate change')
    expect(within(group).getAllByTestId('aesa-mapping-expected-row')).toHaveLength(3)
    expect(group.textContent).toContain('climate change: fossil')
  })

  it('explains WHY the expected ones are unmapped', () => {
    // Without the reason, a muted list of three unmapped methods still reads
    // as three problems.
    render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    const text = screen.getByTestId('aesa-mapping-expected').textContent ?? ''
    expect(text).toMatch(/double-count/i)
    expect(text).toMatch(/\(year, pb_id\)/)
  })

  it('colours unrecognised as a warning and expected as muted', () => {
    const methods = [...EF_METHODS, { method: ['ReCiPe', 'something else', 'x'] }]
    render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING, methods)} />)
    expect(screen.getByTestId('aesa-mapping-unrecognised').getAttribute('style'))
      .toContain('--warning')
    expect(screen.getByTestId('aesa-mapping-expected').getAttribute('style'))
      .toContain('--text-tertiary')
  })

  it('with all 16 boundaries mapped, no unrecognised rows appear', () => {
    render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    expect(screen.queryByTestId('aesa-mapping-unrecognised')).toBeNull()
    expect(screen.queryByTestId('aesa-mapping-uncovered')).toBeNull()
    // The expected block still shows — those methods ARE unmapped, correctly.
    expect(screen.getByTestId('aesa-mapping-expected')).toBeTruthy()
  })

  it('names the boundaries that have no method at all', () => {
    const partial = FULL_MAPPING.filter((m) => m.pb_id !== 'water_use')
    render(<MethodMappingTable
      mappings={partial} boundaries={SALA} coverage={coverageFor(partial)} />)
    const note = screen.getByTestId('aesa-mapping-uncovered')
    expect(note.textContent).toContain('Water use')
    expect(note.textContent).toMatch(/absent from every SR/i)
  })
})

// ── read-only ───────────────────────────────────────────────────────────────

describe('the table is read-only, and says so', () => {
  it('renders no editing controls', () => {
    // A wrong pairing produces a wrong SR with no symptom — the number renders,
    // the zone colours, the export writes. The audited edit path is the
    // workbook.
    const { container } = render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    expect(container.querySelectorAll('select')).toHaveLength(0)
    expect(container.querySelectorAll('input')).toHaveLength(0)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('states where the mapping can be changed', () => {
    render(<MethodMappingTable
      mappings={FULL_MAPPING} boundaries={SALA} coverage={coverageFor(FULL_MAPPING)} />)
    const text = screen.getByTestId('aesa-mapping-table').textContent ?? ''
    expect(text).toMatch(/read-only/i)
    expect(text).toMatch(/Re-suggest/i)
    expect(text).toMatch(/workbook/i)
  })

  it('guides the user when nothing is mapped yet', () => {
    render(<MethodMappingTable mappings={[]} boundaries={SALA} coverage={null} />)
    expect(screen.getByTestId('aesa-mapping-table-empty').textContent)
      .toMatch(/Re-suggest/i)
  })
})

// ── agreement with the workbook ─────────────────────────────────────────────

describe('the table and the AESACFG workbook show the same mapping', () => {
  const fixture = JSON.parse(readFileSync(
    resolve(process.cwd(), 'tests/fixtures/aesaMethodMappingWorkbook.json'), 'utf-8',
  ))

  it('the fixture is the backend workbook writer, not a hand-typed copy', () => {
    expect(fixture._notice).toMatch(/Generated by mapper-backend/)
    expect(fixture.workbook_rows.length).toBe(fixture.mappings.length)
  })

  it('every workbook row appears in the table, and vice versa', () => {
    const table = buildMappingTable(fixture.mappings, SALA, null)
    const shape = (r: { pb_id: string; method_tuple?: string[]; tuple?: readonly string[]; conversion_factor: number }) =>
      `${r.pb_id}|${(r.method_tuple ?? r.tuple ?? []).join('|')}|${r.conversion_factor}`
    // Order deliberately differs — the table groups by boundary set order for
    // scanning; the workbook preserves mapping order for round-trip stability.
    expect(table.mapped.map(shape).sort()).toEqual(fixture.workbook_rows.map(shape).sort())
  })

  it('an ORPHAN mapping is shown, not silently dropped', () => {
    // Iterating boundaries instead of mappings would hide this row while the
    // workbook still writes it — the two views would then disagree about the
    // user's own configuration.
    render(<MethodMappingTable
      mappings={fixture.mappings} boundaries={SALA} coverage={null} />)
    expect(screen.getByTestId('aesa-mapping-orphan-not_a_boundary')).toBeTruthy()
    expect(screen.getByTestId('aesa-mapping-row-not_a_boundary').textContent)
      .toMatch(/not in this boundary set/i)
  })

  it('BOTH mappings competing for one boundary are shown, and flagged', () => {
    render(<MethodMappingTable
      mappings={fixture.mappings} boundaries={SALA} coverage={null} />)
    expect(screen.getAllByTestId('aesa-mapping-row-climate_change')).toHaveLength(2)
    expect(screen.getAllByTestId('aesa-mapping-duplicate-climate_change').length)
      .toBeGreaterThan(0)
  })

  it('the non-default conversion factor survives to the table', () => {
    render(<MethodMappingTable
      mappings={fixture.mappings} boundaries={SALA} coverage={null} />)
    expect(screen.getByTestId('aesa-mapping-row-acidification').textContent).toContain('1.5')
  })
})

// ── the model ───────────────────────────────────────────────────────────────

describe('buildMappingTable', () => {
  it('orders by boundary set, orphans last', () => {
    const table = buildMappingTable(
      [
        { method_tuple: ['a'], pb_id: 'zzz_orphan' },
        { method_tuple: ['b'], pb_id: SALA_IDS[2] },
        { method_tuple: ['c'], pb_id: SALA_IDS[0] },
      ],
      SALA, null,
    )
    expect(table.mapped.map((r) => r.pb_id))
      .toEqual([SALA_IDS[0], SALA_IDS[2], 'zzz_orphan'])
  })

  it('defaults a missing conversion factor to 1', () => {
    const table = buildMappingTable([{ method_tuple: ['a'], pb_id: SALA_IDS[0] }], SALA, null)
    expect(table.mapped[0].conversion_factor).toBe(1)
  })

  it('marks both sides of a duplicate, not just the second', () => {
    const table = buildMappingTable(
      [
        { method_tuple: ['a'], pb_id: SALA_IDS[0] },
        { method_tuple: ['b'], pb_id: SALA_IDS[0] },
      ],
      SALA, null,
    )
    expect(table.mapped.every((r) => r.duplicate)).toBe(true)
  })

  it('reports uncovered boundaries in boundary-set order', () => {
    const table = buildMappingTable([{ method_tuple: ['a'], pb_id: SALA_IDS[0] }], SALA, null)
    expect(table.uncovered.map((u) => u.pb_id)).toEqual(SALA_IDS.slice(1))
  })
})
