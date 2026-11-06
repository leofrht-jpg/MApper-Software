/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { ReactNode } from 'react'
import type { ContributionAnalysisResult } from '../../api/client'
import { ContributionAnalysisPanel } from '../lca/ContributionAnalysisPanel'
import { SupplyChainTreeAction } from '../lca/SupplyChainTreeAction'
import { treeSelectStyle } from './treeSelectStyle'

export interface TreeChoice { key: string; label: string; title?: string }

interface Props {
  /** Test id prefix for this block; the controls inside carry `${idPrefix}-…`. */
  idPrefix: string
  /** A heading for the block (the item's name in Multi-item). */
  heading?: ReactNode
  /** Indicators of the shown result: a tree is for ONE of them. Omitted when the page picks
   *  the indicator for several blocks at once (Multi-item), so each block shows no selector. */
  indicators?: TreeChoice[]
  indicatorKey?: string
  onIndicatorChange?: (key: string) => void
  /** Any tree is being built on this page: every Build button is disabled. */
  anyRunning: boolean
  /** THIS block's tree is the one being built. */
  running: boolean
  error: string | null
  discarded: boolean
  result: ContributionAnalysisResult | null
  onBuild: () => void
  onDiscard: () => void
}


/**
 * One supply chain tree surface in Impact Assessment: pick the indicator (and the
 * sensitivity case when several ran), then build explicitly. Never automatic. The request
 * is built by the caller from the frozen result, not from anything live on this page.
 */
export function SupplyChainTreeBlock({
  idPrefix, heading, indicators, indicatorKey, onIndicatorChange,
  anyRunning, running, error, discarded, result, onBuild, onDiscard,
}: Props) {
  const stageRows = result?.target_type === 'archetype'
    ? (result.by_stage ?? []).map((s) => ({
        stage: s.stage, impact: s.score, percentage: s.percentage ?? 0,
      }))
    : undefined
  return (
    <div
      data-testid={`${idPrefix}-tree-block`}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        }}>
          Supply chain{heading ? <> · {heading}</> : null}
        </span>
        {indicators && onIndicatorChange && (
          <select
            data-testid={`${idPrefix}-tree-indicator`}
            aria-label="Indicator for the supply chain tree"
            value={indicatorKey}
            onChange={(e) => onIndicatorChange(e.target.value)}
            style={treeSelectStyle}
          >
            {indicators.map((c) => (
              <option key={c.key} value={c.key} title={c.title}>{c.label}</option>
            ))}
          </select>
        )}
      </div>

      {result ? (
        <ContributionAnalysisPanel result={result} stageBreakdown={stageRows} />
      ) : (
        <SupplyChainTreeAction
          testId={idPrefix}
          idPrefix={idPrefix}
          running={running}
          buildDisabled={anyRunning}
          error={error}
          discarded={discarded}
          databaseNote={null}
          onBuild={onBuild}
          onDiscard={onDiscard}
        />
      )}
    </div>
  )
}
