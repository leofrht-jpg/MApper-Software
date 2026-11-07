/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import registry from '../data/diagnostics.json'

export type DiagnosticSeverity = 'error' | 'warning'

export interface DiagnosticEntry {
  title: string
  /** One line. `{placeholders}` are filled from the params of the occurrence. */
  summary: string
  cause: string
  fix: string
  severity: DiagnosticSeverity
  /** Element id of this entry on the Settings page. */
  anchor: string
  /** Who assigns the code: the backend (it emits it) or the screen that knows the cause. */
  origin: 'backend' | 'frontend'
  /**
   * Where the app shows this code today. `help-only` means it has a Settings entry but no
   * screen renders it through <Diagnostic> yet (the follow-up queue); the coverage test
   * checks every other value against the file that owns it.
   */
  surface: DiagnosticSurface
}

export type DiagnosticSurface =
  | 'bom-validation-report'
  | 'bom-import-refusal'
  | 'authored-excel'
  | 'method-library'
  | 'import-wizard'
  | 'help-only'

export const DIAGNOSTICS = registry as Record<string, DiagnosticEntry>

/** The entry for a code, or null when the code is unknown or absent. Never looks at message text. */
export function lookupDiagnostic(code: string | null | undefined): DiagnosticEntry | null {
  if (!code) return null
  return Object.prototype.hasOwnProperty.call(DIAGNOSTICS, code) ? DIAGNOSTICS[code] : null
}

const PLACEHOLDER = /\{([a-z_]+)\}/g

export type DiagnosticParams = Record<string, string | number | number[] | undefined>

/** How many sheet rows the summary names before it says "+N more". */
export const ROWS_SHOWN = 3

/**
 * The sheet rows of an occurrence for the summary line: "(row 5)", "(rows 5, 9, 12)", and
 * "(rows 5, 9, 12 +4 more)" past three. Sorted and de-duplicated; null when there is no row.
 */
export function formatRows(rows: number | number[] | undefined): string | null {
  const list = [...new Set((Array.isArray(rows) ? rows : rows == null ? [] : [rows]).filter((r) => Number.isFinite(r)))]
    .sort((a, b) => a - b)
  if (list.length === 0) return null
  if (list.length === 1) return `(row ${list[0]})`
  const more = list.length > ROWS_SHOWN ? ` +${list.length - ROWS_SHOWN} more` : ''
  return `(rows ${list.slice(0, ROWS_SHOWN).join(', ')}${more})`
}

/**
 * The one-line summary of an occurrence. A placeholder with no value in `params` makes the
 * whole summary fall back to the entry's title, so a missing value never prints "{count}".
 * `{row}` is the one optional placeholder: with no row it is dropped (and the space before
 * it), so the summary reads exactly as it did before rows were shown.
 */
export function fillSummary(entry: DiagnosticEntry, params?: DiagnosticParams): string {
  let missing = false
  const text = entry.summary.replace(/ ?\{row\}/g, () => {
    const row = params?.row
    const r = formatRows(typeof row === 'string' ? Number(row) : row)
    return r ? ` ${r}` : ''
  }).replace(PLACEHOLDER, (_m, key: string) => {
    const v = params?.[key]
    if (Array.isArray(v)) { missing = true; return '' }
    if (v === undefined || v === null || v === '') { missing = true; return '' }
    return String(v)
  })
  return missing ? entry.title : text
}

/** Where a spreadsheet problem is: "Exchanges, row 5, column Amount". */
export function whereLabel(e: { sheet?: string | null; row?: number | null; column?: string | null }): string {
  return [e.sheet, e.row != null ? `row ${e.row}` : null, e.column ? `column ${e.column}` : null]
    .filter(Boolean)
    .join(', ')
}

/** Every registry entry, errors first, then by title: the order the Settings list shows. */
export const DIAGNOSTIC_LIST: Array<[string, DiagnosticEntry]> = Object.entries(DIAGNOSTICS).sort(
  ([, a], [, b]) => (a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === 'error' ? -1 : 1),
)
