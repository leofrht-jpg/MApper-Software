/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// The full-screen card shown while a long calculation runs.
//
// Every calculation that can take more than ~10 s (AESA compute, Impact
// Assessment Calculate in all its forms, Monte Carlo, DSM compute, project
// export) shows this instead of a small inline status line that is easy to
// miss and leaves the rest of the page clickable mid-run.
//
// The look is the desktop app's startup screen ("Starting MApper…", the
// LOADING_DATA_URL page in mapper-tauri/src/main.rs): a dark centred card, a
// 34 px teal ring spinner, a 17 px title and a 13 px grey line under it. Here
// the line says what is running and the card adds the elapsed time.
//
// Clicks are blocked by the backdrop; keyboard focus by `inert` on the app
// root, so Tab cannot reach a Calculate button behind the card. A run that can
// be stopped passes `onCancel` -- the Stop control behind the card is
// unreachable, so the card carries its own.
//
// Rendered through a portal into document.body (Patch 4X): the panels that
// own these runs sit inside sticky / transformed ancestors whose stacking
// contexts would trap a fixed-position element.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useElapsedSeconds } from '../../hooks/useElapsedSeconds'
import { formatElapsed } from './ElapsedCounter'

/** Card appears after this delay; clicks are blocked from the first frame.
 *  Sub-second runs (a DSM simulation) then never flash a card. */
export const OVERLAY_REVEAL_MS = 250

interface Props {
  active: boolean
  /** What is running, e.g. "Computing AESA". */
  title: ReactNode
  /** What it is doing, e.g. "5 cases × 6 sharing · 4 LCA reruns". */
  detail?: ReactNode
  /** 0..1 when a REAL fraction exists; never fabricated. */
  pct?: number | null
  onCancel?: () => void
  cancelLabel?: string
  'data-testid'?: string
}

export function ComputeOverlay({
  active, title, detail, pct, onCancel, cancelLabel = 'Stop', 'data-testid': testId = 'compute-overlay',
}: Props) {
  const seconds = useElapsedSeconds(active)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!active) { setRevealed(false); return }
    const t = window.setTimeout(() => setRevealed(true), OVERLAY_REVEAL_MS)
    return () => window.clearTimeout(t)
  }, [active])

  // Keyboard: make the app behind the card unreachable while it runs.
  useEffect(() => {
    if (!active) return
    const root = document.getElementById('root')
    if (!root) return
    root.setAttribute('inert', '')
    return () => { root.removeAttribute('inert') }
  }, [active])

  if (!active) return null
  const hasPct = typeof pct === 'number' && Number.isFinite(pct)
  const pctInt = hasPct ? Math.max(0, Math.min(100, Math.round((pct as number) * 100))) : null

  return createPortal(
    <div
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-label={typeof title === 'string' ? title : 'Calculation running'}
      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        background: revealed ? 'rgba(5, 8, 12, 0.62)' : 'transparent',
        transition: 'background 150ms ease',
        cursor: 'progress',
      }}
    >
      {revealed && (
        <div
          data-testid={`${testId}-card`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            minWidth: 320, maxWidth: 440, padding: '28px 32px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            background: '#0b0f14', color: '#e6edf3',
            border: '1px solid #1f2937', borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            cursor: 'default', textAlign: 'center',
          }}
        >
          <div className="co-spinner" aria-hidden="true" />
          <div data-testid={`${testId}-title`} style={{ fontSize: 17, fontWeight: 600, letterSpacing: '.02em' }}>
            {title}
          </div>
          {detail && (
            <div data-testid={`${testId}-detail`} style={{ fontSize: 13, color: '#8b97a5', lineHeight: 1.5 }}>
              {detail}
            </div>
          )}
          {hasPct && (
            <div style={{ width: '100%', height: 4, background: '#1f2937', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${pctInt}%`, height: '100%', background: '#14b8a6', transition: 'width 200ms ease' }} />
            </div>
          )}
          <div data-testid={`${testId}-elapsed`} style={{ fontSize: 13, color: '#8b97a5', fontFamily: 'var(--font-mono, monospace)' }}>
            {pctInt != null ? `${pctInt}% · ` : ''}{formatElapsed(seconds * 1000)} elapsed
          </div>
          {onCancel && (
            <button
              type="button"
              data-testid={`${testId}-cancel`}
              onClick={onCancel}
              style={{
                marginTop: 2, padding: '5px 14px', fontSize: 12, cursor: 'pointer',
                background: 'transparent', color: '#e6edf3',
                border: '1px solid #374151', borderRadius: 6,
              }}
            >
              {cancelLabel}
            </button>
          )}
          <style>{`
            .co-spinner { width: 34px; height: 34px; border: 3px solid #1f2937; border-top-color: #14b8a6;
              border-radius: 50%; animation: co-spin .9s linear infinite; }
            @keyframes co-spin { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      )}
    </div>,
    document.body,
  )
}
