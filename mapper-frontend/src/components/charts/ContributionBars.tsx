/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useState } from 'react'
import { type ContributionItem } from '../../api/client'

const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
]

interface ContributionBarsProps {
  items: ContributionItem[]
  restAmount: number
  restPercentage: number
  unit: string
  onActivityClick?: (key: string) => void
}

export function ContributionBars({ items, restAmount, restPercentage, unit, onActivityClick }: ContributionBarsProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const allItems = [
    ...items,
    ...(restPercentage > 0 ? [{ activity_name: 'Other', activity_key: '', location: '', amount: restAmount, unit, percentage: restPercentage, isRest: true }] : []),
  ]

  const maxPct = Math.max(...allItems.map((i) => Math.abs(i.percentage)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {allItems.map((item, idx) => {
        const isRest = 'isRest' in item
        const color = isRest ? 'var(--text-tertiary)' : CHART_COLORS[idx % CHART_COLORS.length]
        const pct = Math.abs(item.percentage)
        const barWidth = (pct / maxPct) * 100
        const isHovered = hoveredIdx === idx

        return (
          <div
            key={idx}
            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: !isRest && onActivityClick ? 'pointer' : 'default' }}
            onClick={() => { if (!isRest && onActivityClick) onActivityClick(item.activity_key) }}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            {/* Label */}
            <div style={{ width: 200, flexShrink: 0 }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                {item.activity_name}
              </div>
              {item.location && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{item.location}</div>
              )}
            </div>

            {/* Bar */}
            <div style={{ flex: 1, position: 'relative', height: 24, display: 'flex', alignItems: 'center' }}>
              <div style={{
                height: 20,
                width: `${barWidth}%`,
                backgroundColor: color,
                borderRadius: 'var(--radius-sm)',
                opacity: isHovered ? 1 : 0.85,
                transition: 'width var(--duration-slow) var(--ease-out), opacity var(--duration-fast) var(--ease-out)',
                animation: `barGrow var(--duration-slow) var(--ease-out) ${idx * 30}ms both`,
                minWidth: 4,
              }} />
              {/* Tooltip */}
              {isHovered && (
                <div style={{
                  position: 'absolute',
                  left: `${barWidth}%`,
                  top: -36,
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  zIndex: 10,
                  boxShadow: 'var(--shadow-md)',
                  pointerEvents: 'none',
                  transform: 'translateX(-50%)',
                }}>
                  {item.amount.toExponential(3)} {unit}
                </div>
              )}
            </div>

            {/* Percentage */}
            <div style={{ width: 52, textAlign: 'right', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {pct.toFixed(1)}%
            </div>
          </div>
        )
      })}
      <style>{`@keyframes barGrow{from{width:0}}`}</style>
    </div>
  )
}
