/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { Layers } from 'lucide-react'
import { BASE_SCENARIO, type ParameterTable } from '../../api/client'

/** Does any parameter actually differ between cases?
 *
 * Keys on `scenario_overrides`, NOT on how many cases are named. MAp-test is
 * the proof that those differ: it defines Base / Optimistic / Pessimistic and
 * not one parameter carries an override, so all three compute to the same
 * number (ICEV-Petrol returns 10 257 under each). A count-based guard would
 * happily offer three checkboxes that cannot change anything.
 */
export function hasVaryingParameters(table: ParameterTable | null): boolean {
  if (!table) return false
  return Object.values(table.parameters ?? {}).some(
    (p) => Object.keys(p.scenario_overrides ?? {}).length > 0,
  )
}

/** Cases that at least one parameter actually varies over. */
export function varyingCases(table: ParameterTable | null): string[] {
  if (!table) return []
  const seen = new Set<string>()
  for (const p of Object.values(table.parameters ?? {})) {
    for (const c of Object.keys(p.scenario_overrides ?? {})) seen.add(c)
  }
  return (table.scenarios ?? []).filter((s) => seen.has(s))
}

interface Props {
  table: ParameterTable | null
  selected: string[]
  onToggle: (name: string, on: boolean) => void
  disabled?: boolean
  accent?: string
  testId?: string
}

/** The SENSITIVITY CASES checklist, matching the system-level control.
 *
 * Same store slice, same label, same chip — see the three-distinct-axis-labels
 * rule: "Sensitivity cases" (parameter values) is not "LCI scenarios"
 * (IAM/SSP background) and not "Sharing sensitivity" (AESA principles).
 */
export function SensitivityCases({
  table, selected, onToggle, disabled, accent = 'var(--mod-lca)',
  testId = 'sensitivity-cases',
}: Props) {
  const available = [BASE_SCENARIO, ...(table?.scenarios ?? [])]
  const varying = varyingCases(table)
  const effective = selected.filter((s) => available.includes(s))

  // Nothing to vary: say which of the two situations it is, rather than
  // rendering a checkbox that cannot change a number.
  if (!hasVaryingParameters(table)) {
    const named = (table?.scenarios ?? []).length
    return (
      <div data-testid={`${testId}-none`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>
          <Layers size={11} /> Sensitivity cases
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '52ch' }}>
          {named > 0
            ? `${named} case${named === 1 ? '' : 's'} defined, but no parameter varies between them — every case would compute the same result.`
            : 'No sensitivity cases defined for this project.'}
        </span>
      </div>
    )
  }

  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={labelStyle}>
        <Layers size={11} /> Sensitivity cases
        <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 2 }}>
          · {effective.length}/{available.length}
        </span>
      </span>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px',
        maxHeight: 140, overflowY: 'auto', backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
      }}>
        {available.map((s) => {
          const isBase = s === BASE_SCENARIO
          // A named case no parameter varies over would silently duplicate Base.
          const inert = !isBase && !varying.includes(s)
          return (
            <label
              key={s}
              data-testid={`${testId}-option-${s}`}
              title={inert ? 'No parameter varies in this case — it would duplicate Base.' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 'var(--text-xs)',
                color: inert ? 'var(--text-tertiary)' : 'var(--text-primary)',
                cursor: isBase || disabled ? 'default' : 'pointer',
                fontFamily: isBase ? 'inherit' : 'var(--font-mono)',
              }}
            >
              <input
                type="checkbox"
                checked={isBase || effective.includes(s)}
                // Base is always in: it is the reference every other case is
                // read against, so unchecking it has no meaning.
                disabled={isBase || disabled}
                onChange={(e) => onToggle(s, e.target.checked)}
                style={{ accentColor: accent }}
              />
              {s}
              {inert && <span style={{ fontSize: 9 }}>· inert</span>}
            </label>
          )
        })}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
  display: 'inline-flex', alignItems: 'center', gap: 4,
}
