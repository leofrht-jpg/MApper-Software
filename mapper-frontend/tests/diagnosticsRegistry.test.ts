/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIAGNOSTICS, type DiagnosticSurface } from '../src/utils/diagnostics'

/**
 * The registry is the one source of truth for warning/error help (`src/data/diagnostics.json`).
 * The backend half (every code the backend emits has an entry, every backend entry is emitted)
 * is `mapper-backend/tests/test_diagnostics_registry.py`. This half: every entry is well
 * formed, and every entry is either wired to a screen that really uses it, or is declared
 * `help-only` (a Settings entry whose screens are the follow-up queue).
 */
const src = (p: string) => readFileSync(resolve(__dirname, '..', 'src', p), 'utf8')
const entries = Object.entries(DIAGNOSTICS)

describe('registry entries are well formed', () => {
  it('has the entries (a backend code count plus the frontend-origin ones)', () => {
    expect(entries.length).toBeGreaterThan(60)
    expect(entries.filter(([, e]) => e.origin === 'frontend').map(([c]) => c).sort()).toEqual([
      'import_cancelled', 'import_failed', 'import_task_lost', 'method_install_failed', 'method_install_warnings',
    ])
  })

  it.each(entries)('%s: every field present, one-line summary, short cause and fix', (code, e) => {
    expect(code).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/)
    for (const f of ['title', 'summary', 'cause', 'fix'] as const) expect(e[f].trim().length, f).toBeGreaterThan(3)
    expect(e.summary).not.toContain('\n')
    expect(e.summary.length).toBeLessThanOrEqual(80)
    expect([...e.summary.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).every((k) => ['count', 'value', 'name', 'where'].includes(k))).toBe(true)
    expect(e.cause.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3)
    expect(e.fix.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3)
    expect(['error', 'warning']).toContain(e.severity)
    expect(['backend', 'frontend']).toContain(e.origin)
  })

  it('anchors are unique and derived from the code', () => {
    const anchors = entries.map(([, e]) => e.anchor)
    expect(new Set(anchors).size).toBe(anchors.length)
    for (const [code, e] of entries) expect(e.anchor).toBe(`diag-${code.replace(/_/g, '-')}`)
  })
})

const OWNER: Record<Exclude<DiagnosticSurface, 'help-only' | 'authored-excel' | 'bom-validation-report'>, string> = {
  'bom-import-refusal': 'pages/LCAManager.tsx',
  'method-library': 'components/impact/MethodLibrary.tsx',
  'import-wizard': 'components/ImportWizard.tsx',
}

describe('every entry is used, or is help-only', () => {
  it('a surface with literal codes: the owning file names the code', () => {
    for (const [code, e] of entries) {
      if (e.surface in OWNER) {
        const file = OWNER[e.surface as keyof typeof OWNER]
        expect(src(file), `${code} is not named in ${file}`).toContain(code)
      }
    }
  })

  it('bom-validation-report: the codes are exactly the ValidationErrorType union the panel renders', () => {
    const block = src('api/client.ts').match(/export type ValidationErrorType =([\s\S]*?)\n\n/)![1]
    const union = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    const surface = entries.filter(([, e]) => e.surface === 'bom-validation-report').map(([c]) => c).sort()
    expect(surface).toEqual(union)
    expect(src('components/bom/ValidationReportPanel.tsx')).toContain('code={group.error_type}')
  })

  it('authored-excel: the list renders the code of every error it is given', () => {
    expect(src('components/authored/AuthoredExcel.tsx')).toContain('code={e.code}')
    expect(src('components/authored/AuthoredExcel.tsx')).toContain('code={phase.code}')
  })

  it('help-only entries are the declared follow-up queue, and nothing else', () => {
    expect(entries.filter(([, e]) => e.surface === 'help-only').map(([c]) => c).sort()).toEqual([
      'authored_activity_linked', 'authored_database_linked', 'authored_validation_failed',
      'import_rejected', 'project_state_mismatch', 'unlinked_materials', 'validation_failed',
    ])
  })

  it('a help-only code is not already rendered through <Diagnostic> anywhere (then it is not help-only)', () => {
    const files = ['pages/LCAManager.tsx', 'components/impact/MethodLibrary.tsx', 'components/ImportWizard.tsx',
      'components/authored/AuthoredExcel.tsx', 'components/bom/ValidationReportPanel.tsx']
    for (const [code, e] of entries) {
      if (e.surface !== 'help-only') continue
      for (const f of files) expect(src(f), `${code} is used in ${f}: change its surface`).not.toContain(`code="${code}"`)
    }
  })
})
