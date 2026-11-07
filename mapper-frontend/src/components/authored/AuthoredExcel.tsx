/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Authored databases through Excel: "Import from Excel" and "Download template" beside
 * "New authored database", and "Export to Excel" on an authored database.
 *
 * The import is a two-step dialog and nothing is written until the second step:
 *  1. choosing a file validates it (a dry run: every error with sheet, row and column, or a
 *     preview of what would be created);
 *  2. "Confirm import" asks the server to import. The server validates again and refuses on any
 *     error, so the preview is never what authorises the write.
 * Nothing is requested when the page opens, and the busy states are plain: no invented progress.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Diagnostic } from '../ui/Diagnostic'
import { whereLabel } from '../../utils/diagnostics'
import { notify } from '../ui/dialogs'
import { IDENTIFIER_INPUT_PROPS } from '../ui/identifierInput'
import {
  type AuthoredExcelError,
  type AuthoredExcelValidation,
  downloadAuthoredTemplate,
  exportAuthoredDatabase,
  importAuthoredExcel,
  structuredErrorDetail,
  validateAuthoredExcel,
} from '../../api/client'

type Phase =
  | { kind: 'validating' }
  | { kind: 'result'; v: AuthoredExcelValidation }
  | { kind: 'importing'; v: AuthoredExcelValidation }
  | { kind: 'failed'; message: string; code?: string; errors: AuthoredExcelError[] }

/** What a failed request tells the user: the server's own list when it sent one. */
function excelFailure(e: unknown): { message: string; code?: string; errors: AuthoredExcelError[] } {
  const d = structuredErrorDetail(e)
  if (d) {
    return {
      message: typeof d.message === 'string' ? d.message : 'The workbook could not be used.',
      code: typeof d.error === 'string' ? d.error : undefined,
      errors: Array.isArray(d.errors) ? (d.errors as AuthoredExcelError[]) : [],
    }
  }
  return { message: e instanceof Error ? e.message : String(e), errors: [] }
}

function describeError(e: AuthoredExcelError): string {
  return `${whereLabel(e)}: ${e.message}`
}

/** One line per error (marker, summary, Help); the sheet, row, column and the original message behind Details. */
function ExcelErrorList({ errors, testId }: { errors: AuthoredExcelError[]; testId: string }) {
  return (
    <ul
      data-testid={testId}
      style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 4 }}
    >
      {errors.map((e, i) => (
        <li key={i}>
          <Diagnostic
            code={e.code}
            severity="error"
            params={{ where: whereLabel(e) }}
            message={describeError(e)}
            data-testid={`${testId}-item`}
          />
        </li>
      ))}
    </ul>
  )
}

function ImportDialog({ file, onClose, onImported }: {
  file: File
  onClose: () => void
  onImported: (name: string) => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'validating' })
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const run = useRef(0)

  // Applies a validation answer, unless a newer request has started since.
  const settle = useCallback((id: number, answer: Promise<AuthoredExcelValidation>, override?: string) => {
    answer.then((v) => {
      if (id !== run.current) return
      // The accepted name, or the one the file asked for when it was refused (so the box is never empty).
      const known = v.preview.database ?? v.preview.requested_name
      if (!override && known) setName(known)
      setPhase({ kind: 'result', v })
    }).catch((e) => {
      if (id !== run.current) return
      setPhase({ kind: 'failed', ...excelFailure(e) })
    })
  }, [])

  // The first validation starts when the dialog opens. The phase is already 'validating', so
  // nothing is set synchronously here.
  useEffect(() => {
    settle(++run.current, validateAuthoredExcel(file))
  }, [file, settle])

  const validateAgain = (override?: string) => {
    setPhase({ kind: 'validating' })
    settle(++run.current, validateAuthoredExcel(file, override), override)
  }

  const confirmImport = async () => {
    if (phase.kind !== 'result' || !phase.v.ok) return
    const v = phase.v
    setPhase({ kind: 'importing', v })
    try {
      const res = await importAuthoredExcel(file, nameEdited ? name.trim() : undefined)
      onImported(res.database.name)
    } catch (e) {
      setPhase({ kind: 'failed', ...excelFailure(e) })
    }
  }

  const busy = phase.kind === 'validating' || phase.kind === 'importing'
  const v = phase.kind === 'result' || phase.kind === 'importing' ? phase.v : null
  const input = { width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        data-testid="authored-xl-dialog"
        role="dialog"
        aria-label="Import authored database from Excel"
        style={{ width: 560, maxHeight: '85vh', overflowY: 'auto', display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-5)', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)' }}
      >
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Import from Excel</h2>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          {file.name} · checking only: nothing is imported until you confirm.
        </div>

        {phase.kind === 'validating' && (
          <div data-testid="authored-xl-validating" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            <Loader2 size={14} className="lca-spin" /> Validating the workbook…
          </div>
        )}
        {phase.kind === 'importing' && (
          <div data-testid="authored-xl-importing" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            <Loader2 size={14} className="lca-spin" /> Importing…
          </div>
        )}

        {phase.kind === 'failed' && (
          <div data-testid="authored-xl-failed" style={{ display: 'grid', gap: 6 }}>
            <Diagnostic code={phase.code} severity="error" message={phase.message} data-testid="authored-xl-failed-diagnostic" />
            {phase.errors.length > 0 && <ExcelErrorList errors={phase.errors} testId="authored-xl-errors" />}
          </div>
        )}

        {v && !v.ok && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div role="alert" data-testid="authored-xl-error-count" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              {v.errors.length} error{v.errors.length === 1 ? '' : 's'}: nothing can be imported until they are fixed.
            </div>
            <ExcelErrorList errors={v.errors} testId="authored-xl-errors" />
          </div>
        )}

        {v && v.ok && (
          <div data-testid="authored-xl-preview" style={{ display: 'grid', gap: 6, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Ready to import</div>
            <div data-testid="authored-xl-counts">
              {v.preview.activities} {v.preview.activities === 1 ? 'activity' : 'activities'} · {v.preview.exchanges} exchange{v.preview.exchanges === 1 ? '' : 's'}
              {' · '}{v.preview.partial} partial · {v.preview.flows_resolved_by_name} flow{v.preview.flows_resolved_by_name === 1 ? '' : 's'} found by name
            </div>
            {v.preview.resolved_by_name.length > 0 && (
              <ul data-testid="authored-xl-by-name" style={{ margin: 0, padding: '0 0 0 16px', maxHeight: 120, overflowY: 'auto', fontSize: 'var(--text-xs)' }}>
                {v.preview.resolved_by_name.map((r) => (
                  <li key={r.row}>row {r.row}: {r.name}{r.compartment ? ` [${r.compartment}]` : ''} → {r.code}</li>
                ))}
              </ul>
            )}
            <ul style={{ margin: 0, padding: '0 0 0 16px', maxHeight: 120, overflowY: 'auto', fontSize: 'var(--text-xs)' }}>
              {v.preview.activity_list.map((a) => (
                <li key={a.key}>{a.name} · {a.scope} · {a.exchanges} exchange{a.exchanges === 1 ? '' : 's'}</li>
              ))}
            </ul>
          </div>
        )}

        {v && v.warnings.length > 0 && (
          <ul data-testid="authored-xl-warnings" style={{ margin: 0, padding: '0 0 0 16px', fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
            {v.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        {v && (
          <label style={{ display: 'grid', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            Database name (a new name; an existing database is never overwritten)
            <input
              {...IDENTIFIER_INPUT_PROPS}
              data-testid="authored-xl-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameEdited(true) }}
              style={input}
              disabled={busy}
            />
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="ghost" data-testid="authored-xl-cancel" onClick={onClose} disabled={phase.kind === 'importing'}>
            {phase.kind === 'failed' || (v && !v.ok) ? 'Close' : 'Cancel'}
          </Button>
          {v && (
            <Button
              variant="secondary"
              data-testid="authored-xl-validate-again"
              onClick={() => validateAgain(nameEdited ? name.trim() : undefined)}
              disabled={busy}
            >
              Validate again
            </Button>
          )}
          <Button
            variant="primary"
            data-testid="authored-xl-confirm"
            onClick={() => void confirmImport()}
            disabled={busy || phase.kind !== 'result' || !phase.v.ok || !name.trim()}
          >
            Confirm import
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** "Import from Excel" and "Download template", for the Database Explorer header. */
export function AuthoredExcelButtons({ onImported }: { onImported: (name: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [downloading, setDownloading] = useState(false)

  const template = async () => {
    setDownloading(true)
    try { await downloadAuthoredTemplate() }
    catch (e) { notify(`Download failed: ${e instanceof Error ? e.message : e}`, { tone: 'error' }) }
    finally { setDownloading(false) }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        data-testid="authored-xl-file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) setFile(f)
        }}
      />
      {/* The picker opens straight from the click: WebKit only allows it during a user activation. */}
      <Button variant="secondary" data-testid="authored-xl-import-open" onClick={() => fileRef.current?.click()}>
        <FileSpreadsheet size={14} strokeWidth={1.5} />
        Import from Excel
      </Button>
      <Button variant="secondary" data-testid="authored-xl-template" onClick={() => void template()} disabled={downloading}>
        {downloading ? <Loader2 size={14} className="lca-spin" /> : <Download size={14} strokeWidth={1.5} />}
        Download template
      </Button>
      {file && (
        <ImportDialog
          file={file}
          onClose={() => setFile(null)}
          onImported={(name) => { setFile(null); onImported(name) }}
        />
      )}
    </>
  )
}

/** "Export to Excel" for an authored database. */
export function ExportToExcelButton({ name, disabled }: { name: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { await exportAuthoredDatabase(name) }
    catch (e) { notify(`Export failed: ${e instanceof Error ? e.message : e}`, { tone: 'error' }) }
    finally { setBusy(false) }
  }
  return (
    <Button variant="secondary" data-testid="authored-xl-export" onClick={() => void go()} disabled={disabled || busy}>
      {busy ? <Loader2 size={14} className="lca-spin" /> : <Download size={14} />} Export to Excel
    </Button>
  )
}
