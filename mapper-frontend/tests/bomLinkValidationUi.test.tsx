/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { LCAManager } from '../src/pages/LCAManager'
import { BOMTree } from '../src/components/bom/BOMTree'
import { ValidationReportPanel } from '../src/components/bom/ValidationReportPanel'
import { DialogHost, __resetDialogsForTests } from '../src/components/ui/dialogs'
import { useBOMStore } from '../src/stores/bomStore'
import { useParameterStore } from '../src/stores/parameterStore'
import { HttpError, importArchetype, structuredErrorDetail } from '../src/api/client'
import type { BOMNode, ValidationReport } from '../src/api/client'

// Two BOM link problems used to surface late: a row linked to a biosphere FLOW (reported as a
// "truncated code", or a 500 at compute) and a positive quantity on a waste-treatment activity
// (a silent credit). The import now refuses the first with sheet/row/column; both show as
// validation findings in the import report and on the editor row. Synthetic data only.

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, downloadBOMTemplate: vi.fn(), exportAllArchetypes: vi.fn() }
})

const click = async (el: Element) => { await act(async () => { fireEvent.click(el) }) }

const REFUSAL = {
  detail: {
    error: 'bom_biosphere_link',
    message: '2 row(s) in the BOM sheet link a biosphere flow, so nothing was imported and your project is unchanged. A BOM row cannot link a biosphere flow: only an activity can be demanded.',
    rows: [
      { sheet: 'BOM', row: 4, columns: ['Ecoinvent Database', 'Ecoinvent Code'], archetype: 'Pack', stage: 'End of Life', name: 'CO2 to air' },
      { sheet: 'BOM', row: 9, columns: ['Ecoinvent Database', 'Ecoinvent Code'], archetype: 'Pack', stage: 'Manufacturing', name: 'NH3 to air' },
    ],
  },
}

const WARNING_REPORT: ValidationReport = {
  total_rows: 2, valid_rows: 1, error_rows: 0, warning_rows: 1, project_name: 'p', bw2_lookups: 0, cache_hits: 0,
  issues: [],
  groups: [{
    severity: 'warning', error_type: 'waste_sign', bad_value: '0.5', bom_name: '', count: 1,
    affected: [{ archetype: 'Pack', stage: 'End of Life', row_idx: 4, name: 'Scrap treatment' }],
  }],
} as ValidationReport

let importFromFile: ReturnType<typeof vi.fn>

beforeEach(() => {
  __resetDialogsForTests()
  vi.clearAllMocks()
  importFromFile = vi.fn()
  useParameterStore.setState({ activeSet: null } as never)
  useBOMStore.setState({
    archetypes: [], folders: [], isLoading: false, importFromFile,
    fetchArchetypes: vi.fn().mockResolvedValue(undefined),
  } as never)
})
afterEach(() => { cleanup(); __resetDialogsForTests(); vi.restoreAllMocks() })

function show() {
  const utils = render(<><LCAManager /><DialogHost /></>)
  const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement
  const choose = async () => {
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'boms.xlsx')], configurable: true })
    await act(async () => { fireEvent.change(input) })
  }
  return { ...utils, choose }
}

describe('a file with biosphere-flow rows is refused with sheet, row and column', () => {
  it('lists every row in place and says nothing was imported (no toast, no result card)', async () => {
    importFromFile.mockRejectedValue(new HttpError(422, JSON.stringify(REFUSAL)))
    const { choose } = show()
    await choose()
    const box = screen.getByTestId('bom-import-refusal')
    // one visible line with the count; the original message and the rows are behind Details
    expect(screen.getByTestId('bom-import-refusal-summary')).toHaveTextContent('Import refused: 2 row(s) link a biosphere flow (rows 4, 9)')
    expect(screen.getByTestId('bom-import-refusal-message')).toHaveTextContent('cannot link a biosphere flow')
    expect(screen.getByTestId('bom-import-refusal-message')).not.toBeVisible()
    await click(screen.getByTestId('bom-import-refusal-details-toggle'))
    expect(screen.getByTestId('bom-import-refusal-message')).toBeVisible()
    expect(box.getAttribute('data-code')).toBe('bom_biosphere_link')
    const items = within(screen.getByTestId('bom-import-refusal-rows')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('BOM sheet, row 4, column Ecoinvent Database / Ecoinvent Code: Pack › End of Life › CO2 to air')
    expect(items[1]).toHaveTextContent('row 9')
    expect(screen.queryByTestId('toast-error')).toBeNull()
  })

  it('the list scrolls instead of growing the page', async () => {
    const many = { detail: { ...REFUSAL.detail, rows: Array.from({ length: 60 }, (_, i) => ({ ...REFUSAL.detail.rows[0], row: i + 3 })) } }
    importFromFile.mockRejectedValue(new HttpError(422, JSON.stringify(many)))
    const { choose } = show()
    await choose()
    await click(screen.getByTestId('bom-import-refusal-details-toggle'))
    const list = screen.getByTestId('bom-import-refusal-rows') as HTMLElement
    expect(within(list).getAllByRole('listitem')).toHaveLength(60)
    expect(list.style.overflowY).toBe('auto')
    expect(list.style.maxHeight).toBe('180px')
  })

  it('a new import clears the refusal', async () => {
    importFromFile.mockRejectedValueOnce(new HttpError(422, JSON.stringify(REFUSAL)))
    const { choose } = show()
    await choose()
    expect(screen.getByTestId('bom-import-refusal')).toBeInTheDocument()
    importFromFile.mockResolvedValueOnce({ format: 'multi', mode: 'merge', created: 0, folders_created: 0, archetypes: [], warnings: [] })
    await choose()
    expect(screen.queryByTestId('bom-import-refusal')).toBeNull()
  })

  it('any other failure still shows the error toast', async () => {
    importFromFile.mockRejectedValue(new Error('bad workbook'))
    const { choose } = show()
    await choose()
    expect(screen.queryByTestId('bom-import-refusal')).toBeNull()
    expect(screen.getByTestId('toast-error')).toHaveTextContent('Import failed: bad workbook')
  })

  it('the real importArchetype throws an error the caller can read as structured', async () => {
    const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(REFUSAL), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    }))
    const err: unknown = await actual.importArchetype(new File(['x'], 'b.xlsx')).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('bom_biosphere_link')            // same message text as before
    expect(actual.structuredErrorDetail(err)?.error).toBe('bom_biosphere_link')
    expect(importArchetype).toBeDefined()
    expect(structuredErrorDetail).toBeDefined()
  })
})

describe('the waste-sign warning in the import result', () => {
  it('shows in the validation report with its label, the quantity, the row and the explanation', async () => {
    importFromFile.mockResolvedValue({
      format: 'multi', mode: 'merge', created: 1, folders_created: 0, warnings: [],
      archetypes: [{ id: 'a1', name: 'Pack', folder: null, stages: 1, materials: 2, linked: 2, unlinked: 0,
                     action: 'created', validation_error_rows: 0, validation_warning_rows: 1 }],
      validation_reports: { Pack: WARNING_REPORT },
    })
    const { choose } = show()
    await choose()
    const panel = screen.getByText(/Validation report/).parentElement!.parentElement as HTMLElement   // the panel root
    // ONE visible line: marker, count, summary. The explanation is a Help entry, not permanent text.
    const group = within(panel).getByTestId('validation-group')
    expect(within(group).getByTestId('validation-group-summary')).toHaveTextContent('1× Positive quantity on a waste treatment')
    expect(within(group).getByTestId('validation-group-message')).not.toBeVisible()
    await click(within(group).getByTestId('validation-group-details-toggle'))
    expect(panel).toHaveTextContent('Scrap treatment')       // the affected row, behind Details
    expect(panel).toHaveTextContent('row 4')
    expect(within(panel).getByTestId('validation-group-message')).toBeVisible()
    expect(screen.queryByTestId('bom-import-refusal')).toBeNull()
  })

  it('every group is one line with a Help link, whatever its type', () => {
    const report = { ...WARNING_REPORT, groups: [{ ...WARNING_REPORT.groups[0], error_type: 'unit_mismatch' as const }] }
    render(<ValidationReportPanel report={report} />)
    expect(screen.getByTestId('validation-group-summary')).toHaveTextContent('1× Unit differs from the activity unit')
    expect(screen.getByTestId('validation-group-help')).toBeInTheDocument()
  })

  it('a biosphere_link group (from a stored report) names the fix', () => {
    const report = { ...WARNING_REPORT, error_rows: 1, warning_rows: 0, groups: [{ ...WARNING_REPORT.groups[0], severity: 'error' as const, error_type: 'biosphere_link' as const }] }
    render(<ValidationReportPanel report={report} />)
    expect(screen.getByTestId('validation-group-summary')).toHaveTextContent('1× Row links a biosphere flow')
    expect(screen.getByTestId('validation-group').getAttribute('data-code')).toBe('biosphere_link')
  })
})

describe('the editor row', () => {
  const linked = (extra: Partial<BOMNode>): BOMNode => ({
    id: 'n1', name: 'Scrap treatment', node_type: 'material', quantity: 0.5, unit: 'kg', children: [],
    ecoinvent_activity: { database: 'ecoinvent-3.11-cutoff', code: '2'.repeat(32), name: 'treatment of scrap, incineration', location: 'GLO' },
    ...extra,
  } as BOMNode)
  const render1 = (n: BOMNode) =>
    render(<><BOMTree node={n} onPatch={vi.fn(async () => {})} onAddChild={vi.fn()} onDelete={vi.fn()} /><DialogHost /></>)

  it('marks a row whose stored status is a warning, with the message on hover', () => {
    const msg = 'Row 4: this activity is a waste treatment activity. ecoinvent enters waste inputs with a NEGATIVE quantity, so a positive quantity here gives a credit, not a burden.'
    render1(linked({ validation_status: 'warning', validation_message: msg }))
    const mark = screen.getByTestId('bom-row-validation')
    expect(mark).toHaveAttribute('data-status', 'warning')
    expect(mark).toHaveAttribute('title', msg)
    expect(mark.getAttribute('aria-label')).toContain('credit, not a burden')
  })

  it('marks an error row differently from a warning', () => {
    render1(linked({ validation_status: 'error', validation_message: 'A BOM row cannot link a biosphere flow.' }))
    expect(screen.getByTestId('bom-row-validation')).toHaveAttribute('data-status', 'error')
  })

  it('shows nothing for a clean row, an unchecked row, or a row with no message', () => {
    for (const extra of [
      { validation_status: 'ok' as const, validation_message: null },
      {},
      { validation_status: 'warning' as const, validation_message: null },
    ]) {
      const { unmount } = render1(linked(extra))
      expect(screen.queryByTestId('bom-row-validation')).toBeNull()
      unmount()
    }
  })

  it('an unlinked row shows no marker', () => {
    render1({ id: 'n2', name: 'Loose', node_type: 'material', quantity: 1, unit: 'kg', children: [], validation_status: 'warning', validation_message: 'x' } as BOMNode)
    expect(screen.queryByTestId('bom-row-validation')).toBeNull()
  })
})
