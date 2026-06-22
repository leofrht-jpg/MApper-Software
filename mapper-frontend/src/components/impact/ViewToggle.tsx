/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { ViewMode } from '../../stores/singleProductImpactStore'

interface Props {
  mode: ViewMode
  onChange: (m: ViewMode) => void
  accent?: string
  testIdPrefix?: string
}

// Patch 4C — chart/table view toggle for single-product Projected and
// Comparison panels. Persists across calculations via the store
// (`projectedViewMode`, `comparisonViewMode`).
export function ViewToggle({ mode, onChange, accent = 'var(--mod-plca)', testIdPrefix = 'view-toggle' }: Props) {
  const btn = (target: ViewMode): React.CSSProperties => ({
    padding: '4px 12px',
    fontSize: 'var(--text-xs)',
    fontWeight: mode === target ? 600 : 500,
    border: 'none',
    background: mode === target ? `color-mix(in srgb, ${accent} 15%, transparent)` : 'transparent',
    color: mode === target ? accent : 'var(--text-secondary)',
    cursor: 'pointer',
    height: 32,
  })
  return (
    <div
      role="tablist"
      data-testid={testIdPrefix}
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <button
        role="tab"
        type="button"
        aria-selected={mode === 'chart'}
        data-testid={`${testIdPrefix}-chart`}
        onClick={() => onChange('chart')}
        style={btn('chart')}
      >
        Chart
      </button>
      <button
        role="tab"
        type="button"
        aria-selected={mode === 'table'}
        data-testid={`${testIdPrefix}-table`}
        onClick={() => onChange('table')}
        style={btn('table')}
      >
        Table
      </button>
    </div>
  )
}
