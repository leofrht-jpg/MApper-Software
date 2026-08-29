/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo } from 'react'
import { NumberInput } from '../ui/NumberInput'
import {
  gsd2Of,
  usePedigreeTable,
  type PedigreeScores,
} from '../../utils/pedigree'

/** What a score MEANS, per indicator. Without this the picker is five
 *  unlabelled 1-5 dials and nobody can score honestly. Condensed from the
 *  pedigree matrix's own definitions. */
const SCORE_HELP: Record<string, string[]> = {
  'reliability': [
    'Verified data based on measurements',
    'Verified data partly based on assumptions, or non-verified data based on measurements',
    'Non-verified data partly based on qualified estimates',
    'Qualified estimate',
    'Non-qualified estimate',
  ],
  'completeness': [
    'Representative data from all sites, over an adequate period',
    'Representative data from >50% of sites, over an adequate period',
    'Representative data from <50% of sites, or from >50% but a shorter period',
    'Representative data from only one site, or some sites but a shorter period',
    'Representativeness unknown, or data from a small number of sites and shorter periods',
  ],
  'temporal correlation': [
    'Less than 3 years difference to the study period',
    'Less than 6 years difference',
    'Less than 10 years difference',
    'Less than 15 years difference',
    'Age unknown, or more than 15 years difference',
  ],
  'geographical correlation': [
    'Data from the area under study',
    'Average data from a larger area including the area under study',
    'Data from an area with similar production conditions',
    'Data from an area with slightly similar production conditions',
    'Data from an unknown area, or an area with very different conditions',
  ],
  'further technological correlation': [
    'Data from enterprises, processes and materials under study',
    'Data from processes and materials under study but a different enterprise',
    'Data from processes and materials under study but a different technology',
    'Data on related processes or materials',
    'Data on a related process at laboratory scale, or from a different technology',
  ],
}

const SHORT: Record<string, string> = {
  'reliability': 'Reliability',
  'completeness': 'Completeness',
  'temporal correlation': 'Temporal',
  'geographical correlation': 'Geographical',
  'further technological correlation': 'Technological',
}

interface Props {
  scores: PedigreeScores | null
  basicVariance: number | null
  onChange: (scores: PedigreeScores | null, basicVariance: number | null) => void
  /** Rendered instead of the editor when the target cannot carry uncertainty.
   *  Used for expression rows, whose uncertainty comes from their parameters. */
  disabledReason?: string
  testIdPrefix: string
  compact?: boolean
}

export function PedigreeEditor({
  scores, basicVariance, onChange, disabledReason, testIdPrefix, compact,
}: Props) {
  const table = usePedigreeTable()

  const effectiveBasic = basicVariance ?? table?.default_basic_variance ?? 0.0006
  const gsd2 = useMemo(
    () => (table ? gsd2Of(table, scores, effectiveBasic) : null),
    [table, scores, effectiveBasic],
  )
  const scored = scores !== null && Object.keys(scores).length > 0

  if (disabledReason) {
    return (
      <div
        data-testid={`${testIdPrefix}-disabled`}
        style={{
          padding: 'var(--space-3)', fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)', background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
        }}
      >
        {disabledReason}
      </div>
    )
  }

  if (!table) {
    return (
      <div data-testid={`${testIdPrefix}-loading`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', padding: 'var(--space-2)' }}>
        Loading pedigree table…
      </div>
    )
  }

  const setScore = (indicator: string, value: number) => {
    const next: PedigreeScores = { ...(scores ?? {}) }
    if (value <= 1) delete next[indicator]
    else next[indicator] = value
    onChange(Object.keys(next).length ? next : null, basicVariance)
  }

  return (
    <div data-testid={`${testIdPrefix}-editor`} style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ display: 'grid', gap: 6 }}>
        {table.indicators.map((ind) => {
          const value = scores?.[ind] ?? 1
          return (
            <div key={ind} style={{ display: 'grid', gridTemplateColumns: compact ? '110px 1fr' : '130px 1fr', gap: 10, alignItems: 'center' }}>
              <label
                htmlFor={`${testIdPrefix}-${ind}`}
                style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}
                title={SCORE_HELP[ind]?.join('\n')}
              >
                {SHORT[ind] ?? ind}
              </label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    id={s === 1 ? `${testIdPrefix}-${ind}` : undefined}
                    data-testid={`${testIdPrefix}-${ind}-${s}`}
                    onClick={() => setScore(ind, s)}
                    title={SCORE_HELP[ind]?.[s - 1] ?? `Score ${s}`}
                    aria-pressed={value === s}
                    style={{
                      width: 26, height: 24,
                      border: `1px solid ${value === s ? 'var(--mod-lca)' : 'var(--border-default)'}`,
                      borderRadius: 'var(--radius-sm)',
                      background: value === s ? 'var(--mod-lca)' : 'var(--bg-surface)',
                      color: value === s ? '#fff' : 'var(--text-secondary)',
                      fontSize: 'var(--text-xs)', cursor: 'pointer',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {s}
                  </button>
                ))}
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 6 }}>
                  {value === 1 ? 'no added uncertainty' : (SCORE_HELP[ind]?.[value - 1]?.slice(0, 52) ?? '')}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Basic variance
          <NumberInput
            data-testid={`${testIdPrefix}-basic`}
            value={effectiveBasic}
            onChange={(v) => onChange(scores, v)}
            style={{ width: 90, height: 24, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
          />
        </label>
        <span
          data-testid={`${testIdPrefix}-gsd2`}
          style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
        >
          GSD² <strong>{gsd2 ? gsd2.toFixed(3) : '—'}</strong>
          <span style={{ color: 'var(--text-secondary)' }}> (95% range ≈ ÷/× {gsd2 ? gsd2.toFixed(2) : '—'})</span>
        </span>
        {scored && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-clear`}
            onClick={() => onChange(null, null)}
            style={{
              background: 'none', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)', padding: '2px 8px',
              fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {!scored && (
        <p data-testid={`${testIdPrefix}-unscored`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
          Unscored — contributes no foreground variance. Leave it this way unless you can
          score it honestly.
        </p>
      )}
    </div>
  )
}
