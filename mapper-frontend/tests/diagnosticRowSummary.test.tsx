/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Diagnostic } from '../src/components/ui/Diagnostic'
import { ValidationReportPanel } from '../src/components/bom/ValidationReportPanel'
import { formatRows, lookupDiagnostic } from '../src/utils/diagnostics'
import type { ValidationReport } from '../src/api/client'

/**
 * The sheet row is in the ONE visible summary line, so the user sees which line of the file to
 * fix without opening Details. Up to three rows are named, then "+N more". The original
 * message is untouched and stays the Details body. No row: the summary reads as before.
 *
 * jsdom cannot show that the longest summary still fits on one line (nowrap + ellipsis); it
 * proves the text and the structure.
 */
afterEach(() => cleanup())

const ORIGINAL = "Row 5 (B, Housing, Screw): code 'abc' has wrong length (expected 32 chars, got 3)."
const summary = () => screen.getByTestId('diagnostic-summary').textContent

describe('the row in the summary line', () => {
  it('a single row', () => {
    render(<Diagnostic code="code_truncated" severity="error" params={{ row: [5] }} message={ORIGINAL} />)
    expect(summary()).toBe('Activity code has the wrong length (row 5)')
  })

  it('a few rows (sorted, no duplicates)', () => {
    render(<Diagnostic code="code_truncated" severity="error" params={{ row: [12, 5, 9, 5] }} message={ORIGINAL} />)
    expect(summary()).toBe('Activity code has the wrong length (rows 5, 9, 12)')
  })

  it('more than three rows: the first three and "+N more"', () => {
    render(<Diagnostic code="code_truncated" severity="error" count={7} params={{ row: [2, 3, 4, 5, 6, 7, 8] }} message={ORIGINAL} />)
    expect(summary()).toBe('7× Activity code has the wrong length (rows 2, 3, 4 +4 more)')
  })

  it('no row: the summary is exactly what it was', () => {
    render(<Diagnostic code="code_truncated" severity="error" params={{}} message={ORIGINAL} />)
    expect(summary()).toBe('Activity code has the wrong length')
    cleanup()
    render(<Diagnostic code="code_truncated" severity="error" params={{ row: [] }} message={ORIGINAL} />)
    expect(summary()).toBe('Activity code has the wrong length')
  })

  it('a single number works too, and the import refusal names its rows', () => {
    render(<Diagnostic code="bom_biosphere_link" severity="error" params={{ count: 2, row: [4, 9] }} message="m" />)
    expect(summary()).toBe('Import refused: 2 row(s) link a biosphere flow (rows 4, 9)')
    expect(formatRows(7)).toBe('(row 7)')
    expect(formatRows(undefined)).toBeNull()
  })

  it('the original message stays the Details body, unchanged', () => {
    render(<Diagnostic code="code_truncated" severity="error" params={{ row: [5] }} message={ORIGINAL} />)
    fireEvent.click(screen.getByTestId('diagnostic-details-toggle'))
    expect(screen.getByTestId('diagnostic-message').textContent).toBe(ORIGINAL)
  })

  it('an authored Excel error already names its row through {where}', () => {
    render(<Diagnostic code="amount_required" severity="error" params={{ where: 'Exchanges, row 5, column Amount' }} message="m" />)
    expect(summary()).toBe('Exchanges, row 5, column Amount: no amount')
  })

  it('every BOM validator code that has a row in its report carries the placeholder', () => {
    for (const code of ['biosphere_link', 'code_truncated', 'code_not_found', 'database_missing', 'code_no_database',
      'database_no_code', 'name_mismatch', 'location_mismatch', 'unit_mismatch', 'stage_scope_defaulted', 'waste_sign', 'bom_biosphere_link']) {
      expect(lookupDiagnostic(code)?.summary, code).toMatch(/ \{row\}$/)
    }
  })
})

describe('the validation report panel passes the rows of each group', () => {
  const issue = (row_idx: number) => ({
    severity: 'error' as const, error_type: 'code_truncated' as const, archetype: 'B', stage: 'Housing',
    row_idx, name: 'Screw', bad_value: 'abc', message: `Row ${row_idx} (B, Housing, Screw): code 'abc' has wrong length`,
  })
  const report = (rows: number[]): ValidationReport => ({
    total_rows: 20, valid_rows: 20 - rows.length, error_rows: rows.length, warning_rows: 0,
    issues: rows.map(issue),
    groups: rows.length === 0 ? [] : [{
      severity: 'error', error_type: 'code_truncated', bad_value: 'abc', bom_name: '', count: rows.length,
      affected: rows.map((r) => ({ archetype: 'B', stage: 'Housing', row_idx: r, name: 'Screw' })),
    }],
  })

  it('names the rows in the line and keeps each original message in Details', () => {
    render(<ValidationReportPanel report={report([5, 9, 12, 20])} />)
    expect(screen.getByTestId('validation-group-summary').textContent).toBe('4× Activity code has the wrong length (rows 5, 9, 12 +1 more)')
    expect(screen.getByTestId('validation-group-message').textContent).toContain("Row 20 (B, Housing, Screw): code 'abc' has wrong length")
  })

  it('one row', () => {
    render(<ValidationReportPanel report={report([5])} />)
    expect(screen.getByTestId('validation-group-summary').textContent).toBe('1× Activity code has the wrong length (row 5)')
  })
})
