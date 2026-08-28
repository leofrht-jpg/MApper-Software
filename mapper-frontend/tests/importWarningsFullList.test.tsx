/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor, within } from '@testing-library/react'
import { LCAManager, isInformationalImportWarning } from '../src/pages/LCAManager'
import { useBOMStore } from '../src/stores/bomStore'

// The import panel listed `warnings.slice(0, 10)` and closed with a plain
// "…and 4 more" <li> that nothing could click, so the remaining warnings were
// unreachable — the count said 14 and the UI could only ever show 10.
//
// The truncation was frontend-only: the backend returns every warning (nothing
// in bom.py caps the list), so the displayed count was accurate and expanding
// the UI genuinely reaches more data rather than re-fetching.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, downloadBOMTemplate: vi.fn(), exportAllArchetypes: vi.fn() }
})

// 12 informational (one per parameterised Quantity cell) + 2 real problems = 14,
// the shape the user hit.
const INFO = Array.from({ length: 12 }, (_, i) =>
  `Row ${i + 2}: Quantity 'battery_mass_lfp' stored as expression; resolved at pipeline time.`)
const REAL = [
  "Row 40: parent 'Pack' not found in stage 'Manufacturing'; attached to stage root instead.",
  'Row 41: missing Stage or Name; skipped.',
]
const WARNINGS = [...INFO, ...REAL]

function importResult(warnings: string[], archetypeCount = 1) {
  return {
    format: 'multi' as const,
    mode: 'merge' as const,
    created: archetypeCount,
    folders_created: 0,
    archetypes: Array.from({ length: archetypeCount }, (_, i) => ({
      id: `arc-${i}`, name: `Arch ${i}`, folder: null, stages: 4,
      materials: 10, linked: 10, unlinked: 0, action: 'created' as const,
    })),
    warnings,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useBOMStore.setState({ archetypes: [], folders: [], isLoading: false } as never)
})

async function runImport(result: ReturnType<typeof importResult>) {
  useBOMStore.setState({
    importFromFile: vi.fn().mockResolvedValue(result),
    fetchArchetypes: vi.fn().mockResolvedValue(undefined),
  } as never)
  const utils = render(<LCAManager />)
  const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['x'], 'boms.xlsx')
  Object.defineProperty(input, 'files', { value: [file] })
  fireEvent.change(input)
  await waitFor(() => utils.getByTestId('import-warnings'))
  return utils
}

describe('import warnings are all reachable', () => {
  it('the count matches the number of warnings the backend returned', async () => {
    const { getByTestId } = await runImport(importResult(WARNINGS))
    expect(getByTestId('import-warnings-count').textContent).toContain('(14)')
  })

  it('every one of the 14 is reachable — none is stranded behind a dead caption', async () => {
    const { getByTestId, container } = await runImport(importResult(WARNINGS))

    // Real problems are never hidden: they are what a warning list is for.
    for (const w of REAL) expect(container.textContent).toContain(w)

    // The repetitive informational ones sit behind a count that expands.
    fireEvent.click(getByTestId('import-warnings-info-toggle'))
    const list = getByTestId('import-warnings-info-list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(12)
    for (const w of WARNINGS) expect(container.textContent).toContain(w)
  })

  it('the collapsed state still announces how many are hidden', async () => {
    const { getByTestId } = await runImport(importResult(WARNINGS))
    expect(getByTestId('import-warnings-info-toggle').textContent).toContain('12')
    // Collapsed by default: 12 identical "stored as expression" lines pushed
    // the archetype summary off screen.
    expect(() => getByTestId('import-warnings-info-list')).toThrow()
  })

  it('an all-informational import still reaches every warning', async () => {
    const { getByTestId, container } = await runImport(importResult(INFO))
    expect(getByTestId('import-warnings-count').textContent).toContain('(12)')
    fireEvent.click(getByTestId('import-warnings-info-toggle'))
    for (const w of INFO) expect(container.textContent).toContain(w)
  })

  it('more than 8 archetypes are reachable too', async () => {
    const { getByTestId, container } = await runImport(importResult(INFO, 11))
    expect(container.textContent).not.toContain('Arch 10')
    fireEvent.click(getByTestId('import-archetypes-toggle'))
    expect(container.textContent).toContain('Arch 10')
  })
})

describe('classifying an import warning', () => {
  it('treats an unrecognised warning as real, not informational', () => {
    // The safe direction for an unknown string: a warning type added later is
    // surfaced by default rather than silently collapsed out of sight.
    expect(isInformationalImportWarning('Row 9: something new went wrong.')).toBe(false)
    for (const w of REAL) expect(isInformationalImportWarning(w)).toBe(false)
  })

  it('matches the emitted suffix, not the row number or the expression', () => {
    expect(isInformationalImportWarning(
      "Row 2: Quantity 'w_bp * 2' stored as expression; resolved at pipeline time.")).toBe(true)
    expect(isInformationalImportWarning(
      "Row 999: Quantity 'anything at all' stored as expression; resolved at pipeline time.")).toBe(true)
  })
})
