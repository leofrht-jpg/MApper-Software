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

/**
 * The one-line summary of an occurrence. A placeholder with no value in `params` makes the
 * whole summary fall back to the entry's title, so a missing value never prints "{count}".
 */
export function fillSummary(
  entry: DiagnosticEntry,
  params?: Record<string, string | number | undefined>,
): string {
  let missing = false
  const text = entry.summary.replace(PLACEHOLDER, (_m, key: string) => {
    const v = params?.[key]
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
