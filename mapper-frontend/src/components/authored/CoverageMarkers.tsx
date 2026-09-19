/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * "Not specified" markers. A result that used a PARTIAL authored activity
 * cannot speak for the indicators none of that activity's flows is
 * characterised by: the contribution is unknown, not zero. The backend
 * computes the gaps (`coverage_gaps` on the result); these components only
 * show them -- keyed by the FULL method tuple, never the display label.
 */

import type { CoverageGap } from '../../api/client'

export const methodKey = (m: readonly string[]) => m.join('|')

/** Gaps for one indicator. */
export function gapsFor<G extends CoverageGap>(gaps: G[] | undefined | null, method: readonly string[]): G[] {
  if (!gaps?.length) return []
  const k = methodKey(method)
  return gaps.filter((g) => methodKey(g.method) === k)
}

export const WHY: Record<'not_reached' | 'not_declared', string> = {
  not_reached: 'no listed flow is characterised by this indicator',
  not_declared: 'its flows contribute, but its author has not declared the partial inventory complete for this indicator',
}

function describe(gaps: CoverageGap[]): string {
  const acts = [...new Map(gaps.map((g) => [`${g.database}|${g.code}`, g])).values()]
  return acts
    .map((g) => `${g.activity_name} (${g.database}): ${WHY[g.kind ?? 'not_reached']}.` +
      `${g.scope_note ? ` Declared scope: ${g.scope_note}` : ''}`)
    .join('\n')
}

export const NOT_SPECIFIED_TITLE =
  'Not specified: a partial authored activity in this result is not declared complete for this indicator, so its contribution is unknown — not zero.'

/** Inline marker beside one indicator. Renders nothing when there is no gap. */
export function NotSpecifiedMarker({ gaps, testId = 'not-specified-marker' }: { gaps: CoverageGap[]; testId?: string }) {
  if (!gaps.length) return null
  return (
    <span
      data-testid={testId}
      title={`${NOT_SPECIFIED_TITLE}\n\n${describe(gaps)}`}
      style={{
        display: 'inline-block', marginLeft: 6, padding: '0 6px', borderRadius: 'var(--radius-sm)',
        border: '1px dashed var(--warning)', color: 'var(--warning)', fontSize: 'var(--text-xs)',
        fontWeight: 500, whiteSpace: 'nowrap', verticalAlign: 'middle',
      }}
    >
      not specified
    </span>
  )
}

/** One line per result: which indicators are marked, and why. */
export function CoverageGapNote({ gaps, labelFor, testId = 'coverage-gap-note' }: {
  gaps: CoverageGap[] | undefined | null
  /** Display label for a method; defaults to its last element. */
  labelFor?: (method: string[]) => string
  testId?: string
}) {
  if (!gaps?.length) return null
  const label = labelFor ?? ((m: string[]) => m[m.length - 1] ?? '')
  const indicators = [...new Set(gaps.map((g) => label(g.method)))]
  const acts = [...new Map(gaps.map((g) => [`${g.database}|${g.code}`, g])).values()]
  return (
    <div data-testid={testId} role="note" style={{
      fontSize: 'var(--text-xs)', color: 'var(--warning)', border: '1px dashed var(--warning)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)',
    }}>
      <strong>Not specified for {indicators.length} indicator{indicators.length === 1 ? '' : 's'}:</strong>{' '}
      {indicators.join(', ')}. {acts.length === 1 ? 'The activity' : 'These activities'} declared a partial inventory
      ({acts.map((g) => g.activity_name).join(', ')}) that is not declared complete for{' '}
      {indicators.length === 1 ? 'that indicator' : 'those indicators'}. Those values are missing a
      contribution of unknown size, not a zero one.
      {acts.some((g) => g.scope_note) && (
        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
          {acts.filter((g) => g.scope_note).map((g) => (
            <li key={`${g.database}|${g.code}`}>{g.activity_name}: {g.scope_note}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** AESA: gaps per planetary-boundary axis. */
export function gapsForPb<G extends CoverageGap & { pb_id: string }>(gaps: G[] | undefined | null, pbId: string): G[] {
  return (gaps ?? []).filter((g) => g.pb_id === pbId)
}

/** Hatch colour for "not specified" in SVG charts. Grey, deliberately NOT a
 *  zone colour: unknown must not read as "in the uncertainty zone". A literal,
 *  so it survives chart export. */
export const NOT_SPECIFIED_HATCH = '#8B949E'

export function notSpecifiedTitle(gaps: CoverageGap[]): string {
  return `${NOT_SPECIFIED_TITLE}\n\n${describe(gaps)}`
}
