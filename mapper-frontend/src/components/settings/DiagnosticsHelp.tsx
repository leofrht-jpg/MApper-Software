/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { SearchInput } from '../ui/SearchInput'
import { DetailsToggle } from '../ui/DetailsToggle'
import { DIAGNOSTIC_LIST, type DiagnosticEntry } from '../../utils/diagnostics'

function matches(code: string, e: DiagnosticEntry, q: string): boolean {
  if (!q) return true
  const hay = `${code} ${code.replace(/_/g, ' ')} ${e.title} ${e.summary} ${e.cause} ${e.fix}`.toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

/**
 * Settings > "Most frequent warnings/errors": a search box and one collapsed entry per code.
 * An entry opens to its cause and fix. `openCode` (from a Help link) opens that entry.
 * Entries the search does not match are hidden with `display: none`, not unmounted, so an
 * entry that is open stays open while the search changes.
 */
export function DiagnosticsHelp({ openCode }: { openCode?: string | null }) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => new Set(DIAGNOSTIC_LIST.filter(([c, e]) => matches(c, e, query)).map(([c]) => c)), [query])

  return (
    <div data-testid="diagnostics-help" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search by code, title or text"
        aria-label="Search warnings and errors"
        data-testid="diagnostics-search"
      />
      <div data-testid="diagnostics-count" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        {shown.size === DIAGNOSTIC_LIST.length ? `${DIAGNOSTIC_LIST.length} entries` : `${shown.size} of ${DIAGNOSTIC_LIST.length} entries`}
      </div>
      {shown.size === 0 && (
        <div data-testid="diagnostics-empty" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          No entry matches. The original message is always kept in the Details of the warning itself.
        </div>
      )}
      {DIAGNOSTIC_LIST.map(([code, e]) => {
        const Icon = e.severity === 'error' ? AlertCircle : AlertTriangle
        const color = e.severity === 'error' ? 'var(--danger)' : 'var(--warning)'
        return (
          <div
            key={`${code}-${openCode === code ? 'open' : 'closed'}`}
            id={e.anchor}
            data-testid={`diagnostic-entry-${code}`}
            style={{
              display: shown.has(code) ? 'block' : 'none',
              border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${color}`,
              borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface)', padding: '6px 10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span role="img" aria-label={e.severity === 'error' ? 'Error' : 'Warning'} style={{ display: 'inline-flex', color }}>
                <Icon size={13} />
              </span>
              <div style={{ flex: 1 }}>
                <DetailsToggle
                  label={e.title}
                  defaultOpen={openCode === code}
                  data-testid={`diagnostic-entry-${code}-details`}
                >
                  <dl style={{ margin: 0, display: 'grid', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    <div><dt style={{ display: 'inline', fontWeight: 600 }}>Cause: </dt><dd style={{ display: 'inline', margin: 0 }}>{e.cause}</dd></div>
                    <div><dt style={{ display: 'inline', fontWeight: 600 }}>Fix: </dt><dd style={{ display: 'inline', margin: 0 }}>{e.fix}</dd></div>
                    <div style={{ color: 'var(--text-tertiary)' }}>Code: <code>{code}</code></div>
                  </dl>
                </DetailsToggle>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
