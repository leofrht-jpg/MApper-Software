/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

export type StageBasisChoice = 'per_unit' | 'per_year' | 'unset'

interface Props {
  /** The resolved basis of the stage: declared, or inherited from the project; null when undeclared. */
  basis: 'per_unit' | 'per_year' | null
  /** Scope-derived hint for the tooltip of an undeclared stage. Never applied. */
  suggestion: 'per_unit' | 'per_year'
  onChange: (basis: StageBasisChoice) => void
  'data-testid': string
}

/**
 * The per-stage basis dropdown ("not declared", "per unit", "per year"), shared by the Stage
 * amounts editor (Impact Assessment) and the LCA Architect calculator, so a stage's basis is
 * declared the same way, and stored the same way (the stage root's `basis`), on both screens.
 */
export function StageBasisSelect({ basis, suggestion, onChange, 'data-testid': testId }: Props) {
  return (
    <select
      data-testid={testId}
      value={basis ?? ''}
      onChange={(e) => onChange((e.target.value || 'unset') as StageBasisChoice)}
      title={
        basis === null
          ? `Not declared — computes at x1. Suggested from scope: ${suggestion.replace('_', ' ')}.`
          : undefined
      }
      style={{
        height: 20, padding: '0 4px',
        backgroundColor: basis === null ? 'var(--bg-surface)' : 'var(--bg-elevated)',
        border: `1px solid ${basis === null ? 'var(--warning)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-sm)',
        color: basis === null ? 'var(--warning)' : 'var(--text-secondary)',
        fontSize: 9, outline: 'none',
      }}
    >
      <option value="">not declared</option>
      <option value="per_unit">per unit</option>
      <option value="per_year">per year</option>
    </select>
  )
}
