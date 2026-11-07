/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { DetailsToggle } from './DetailsToggle'
import { fillSummary, lookupDiagnostic, type DiagnosticSeverity } from '../../utils/diagnostics'
import { useDiagnosticHelpStore } from '../../stores/diagnosticHelpStore'

interface Props {
  /** The machine-readable code. The registry is keyed on it, never on the message. */
  code?: string | null
  /** Overrides the registry's severity (a code can be an error in one place and a warning in another). */
  severity?: DiagnosticSeverity
  /** The original text from the backend (or the screen). Always kept: it is the Details body. */
  message: string
  /** Values for the `{placeholders}` of the registry summary. */
  params?: Record<string, string | number | undefined>
  /** How many occurrences this line stands for; shown as "3×" and never hidden. */
  count?: number
  /** Extra material for the Details body, after the message (for example the list of rows). */
  children?: ReactNode
  'data-testid'?: string
}

/**
 * A warning or an error as ONE VISIBLE LINE: a severity marker, the count, the summary, and a
 * Help link to its entry in Settings. The full original message sits behind a Details toggle,
 * collapsed by default, and stays mounted.
 *
 * A code that is not in the registry (or no code at all) is shown with its message EXPANDED, in
 * full: a warning type nobody has written help for yet must never be silently hidden.
 *
 * Errors are announced (`role="alert"`) with just the one line; warnings use `role="status"`.
 */
export function Diagnostic({ code, severity, message, params, count, children, 'data-testid': testId = 'diagnostic' }: Props) {
  const entry = lookupDiagnostic(code)
  const sev: DiagnosticSeverity = severity ?? entry?.severity ?? 'warning'
  const color = sev === 'error' ? 'var(--danger)' : 'var(--warning)'
  const Icon = sev === 'error' ? AlertCircle : AlertTriangle
  const requestHelp = useDiagnosticHelpStore((s) => s.requestHelp)
  const marker = (
    <span role="img" aria-label={sev === 'error' ? 'Error' : 'Warning'} style={{ display: 'inline-flex', color, flexShrink: 0 }}>
      <Icon size={13} />
    </span>
  )
  const prefix = count != null ? `${count}× ` : ''
  const box = {
    border: '1px solid var(--border-subtle)',
    borderLeft: `3px solid ${color}`,
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-surface)',
    padding: '6px 10px',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-secondary)',
  } as const

  if (!entry) {
    return (
      <div data-testid={testId} data-registered="false" data-severity={sev} style={box}>
        <div
          role={sev === 'error' ? 'alert' : 'status'}
          style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}
        >
          {marker}
          <span data-testid={`${testId}-message`} style={{ color: 'var(--text-primary)' }}>{prefix}{message}</span>
        </div>
        {children}
      </div>
    )
  }

  const summary = fillSummary(entry, params)
  return (
    <div data-testid={testId} data-registered="true" data-code={code ?? undefined} data-severity={sev} style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          role={sev === 'error' ? 'alert' : 'status'}
          data-testid={`${testId}-summary`}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
            color: 'var(--text-primary)', fontWeight: 600,
          }}
        >
          {marker}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prefix}{summary}</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`${testId}-help`}
          aria-label={`Help: ${entry.title}`}
          onClick={() => requestHelp(code as string)}
        >
          Help
        </Button>
      </div>
      <DetailsToggle data-testid={`${testId}-details`}>
        <div data-testid={`${testId}-message`} style={{ overflowWrap: 'anywhere' }}>
          {/* one element per line, so each original message line stays a unit of its own */}
          {(message || `${entry.cause} ${entry.fix}`).split('\n').map((line, i) => <div key={i}>{line}</div>)}
        </div>
        {children}
      </DetailsToggle>
    </div>
  )
}
