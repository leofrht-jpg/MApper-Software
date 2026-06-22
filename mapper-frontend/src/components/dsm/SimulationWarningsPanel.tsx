/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface SimulationWarningsPanelProps {
  warnings: string[]
}

/**
 * The high-volume, repetitive per-cohort retirement-allocation warnings all
 * lead with `Year <4-digit>: ` followed by one of two regular bodies emitted
 * by `dsm_engine.py`:
 *   - "Year {y}: manual outflow of … for cohort '…' exceeds available stock …"
 *   - "Year {y}: requested … outflows at age … for cohort '…' but only …"
 * Anything that does NOT match this pattern (today only the aggregate
 * "Total fleet stock drifted … baseline … Verify …" advisory) is treated as
 * advisory and styled to stand out from the per-cohort noise.
 *
 * Matching the regular high-volume prefix (and styling the remainder as
 * advisory) is the most durable heuristic available while the backend ships a
 * flat `string[]` with no severity field — it survives advisory rephrasing and
 * warning reordering. The durable fix is a structured `{severity, message}`
 * shape, at which point this should read the field instead of pattern-matching.
 */
export function isPerCohortWarning(msg: string): boolean {
  return /^Year \d{4}: (manual outflow|requested )/.test(msg)
}

/**
 * Warning-styled panel for DSM simulation warnings. The per-cohort-per-year
 * "manual outflow exceeds available stock" lines are repetitive and can run
 * long, pushing the results/charts far down the page. The header carries a
 * collapse toggle and the persistent count so the body can be tucked away
 * without losing the signal that warnings exist.
 *
 * Default state is collapsed — the long repetitive per-cohort lines otherwise
 * push the results/charts far down the page; the persistent count in the
 * header keeps the signal that warnings exist, and one click reveals them.
 * Collapse uses the visibility-toggle convention (display:none, not unmount)
 * so expanding is instant and scroll position is preserved.
 */
export function SimulationWarningsPanel({ warnings }: SimulationWarningsPanelProps) {
  const [collapsed, setCollapsed] = useState(true)

  if (warnings.length === 0) return null

  const toggle = () => setCollapsed((v) => !v)

  return (
    <div
      data-testid="simulation-warnings"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        backgroundColor: 'color-mix(in srgb, var(--warning, #c08a2c) 12%, transparent)',
        border: '1px solid var(--warning, #c08a2c)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        data-testid="simulation-warnings-toggle"
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ display: 'flex', color: 'var(--text-tertiary)' }}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <strong style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
          Simulation warnings ({warnings.length})
        </strong>
      </div>
      <div
        data-testid="simulation-warnings-body"
        style={{ display: collapsed ? 'none' : 'flex', flexDirection: 'column', gap: 4 }}
      >
        {warnings.map((w, i) => {
          const perCohort = isPerCohortWarning(w)
          return (
            <div
              key={i}
              data-warning-kind={perCohort ? 'per-cohort' : 'advisory'}
              style={{
                fontSize: 'var(--text-xs)',
                // Advisory/summary lines pop in the warning accent; the
                // repetitive per-cohort lines recede to a muted body color.
                color: perCohort ? 'var(--text-secondary)' : 'var(--warning, #FBBF24)',
              }}
            >
              {w}
            </div>
          )
        })}
      </div>
    </div>
  )
}
