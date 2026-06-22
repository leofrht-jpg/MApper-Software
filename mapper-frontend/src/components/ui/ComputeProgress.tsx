/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { ReactNode, CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'
import { useElapsedSeconds } from '../../hooks/useElapsedSeconds'
import { formatElapsed } from './ElapsedCounter'

// Patch 5AL — the single live compute-progress card (pLCA-Developer treatment),
// app-wide. Fed by `useElapsedSeconds` (the one elapsed source) and rendered as
// M:SS via `formatElapsed`. Never a bespoke setInterval, an in-button elapsed
// label, or a fabricated progress bar: the bar is determinate ONLY from a real
// `pct`, else 'none' (spinner + elapsed). 'indeterminate' is reserved for a
// genuinely long-running job that exposes no obtainable pct.
export type ComputeProgressBar = 'determinate' | 'indeterminate' | 'none'

interface Props {
  /** Header label (stage / description), left side. */
  label: ReactNode
  /** Drives the live elapsed counter; the card renders only while true. */
  active: boolean
  /** Bar mode. 'determinate' needs a real `pct` — never fabricate one. */
  bar?: ComputeProgressBar
  /** Progress fraction 0..1 for the determinate bar + the `{pct}%` readout. */
  pct?: number
  /** Bar / accent colour. Defaults to --accent. */
  statusColor?: string
  /** Optional cancel callback — rendered as a small ghost button. */
  onCancel?: () => void
  cancelLabel?: string
  /** Arbitrary cancel control (e.g. an existing <StopButton>); wins over onCancel. */
  cancelSlot?: ReactNode
  style?: CSSProperties
  'data-testid'?: string
}

export function ComputeProgress({
  label,
  active,
  bar = 'none',
  pct,
  statusColor = 'var(--accent)',
  onCancel,
  cancelLabel = 'Cancel',
  cancelSlot,
  style,
  'data-testid': testId,
}: Props) {
  // Hook called unconditionally (Rules of Hooks) before the early return.
  const seconds = useElapsedSeconds(active)
  if (!active) return null

  const determinate = bar === 'determinate' && typeof pct === 'number'
  const pctInt = determinate ? Math.round((pct as number) * 100) : null
  const cancel = cancelSlot
    ?? (onCancel
      ? (
        <button
          onClick={onCancel}
          style={{
            background: 'none', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
            fontSize: 'var(--text-xs)', padding: '2px 8px', cursor: 'pointer',
          }}
        >
          {cancelLabel}
        </button>
      )
      : null)

  return (
    <div
      data-testid={testId}
      style={{
        padding: 'var(--space-3)',
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 'var(--text-xs)' }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Loader2 size={12} className="cp-spin" style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span
            data-testid={testId ? `${testId}-elapsed` : undefined}
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
          >
            {pctInt != null ? `${pctInt}% · ` : ''}{formatElapsed(seconds * 1000)} elapsed
          </span>
          {cancel}
        </span>
      </div>
      {bar !== 'none' && (
        <div style={{ height: 4, backgroundColor: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
          {determinate ? (
            <div
              data-testid={testId ? `${testId}-bar-determinate` : undefined}
              style={{ height: '100%', width: `${Math.round((pct as number) * 100)}%`, backgroundColor: statusColor, transition: 'width var(--duration-normal)' }}
            />
          ) : (
            <div
              data-testid={testId ? `${testId}-bar-indeterminate` : undefined}
              style={{ position: 'absolute', top: 0, bottom: 0, width: '33%', backgroundColor: statusColor, animation: 'cp-indeterminate 1.6s ease-in-out infinite' }}
            />
          )}
        </div>
      )}
      <style>
        {`@keyframes cp-spin { to { transform: rotate(360deg); } }
          .cp-spin { animation: cp-spin 1s linear infinite; }
          @keyframes cp-indeterminate { 0% { left: -33%; } 100% { left: 100%; } }`}
      </style>
    </div>
  )
}
