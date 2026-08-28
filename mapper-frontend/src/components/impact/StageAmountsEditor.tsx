/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useCallback } from 'react'
import { NumberInput } from '../ui/NumberInput'
import type { ArchetypeSummary } from '../../api/client'
import type {
  AmountPreset,
  ArchetypeStageAmounts,
} from '../../stores/singleProductImpactStore'

interface Props {
  archetype: ArchetypeSummary
  value: ArchetypeStageAmounts
  onChange: (next: ArchetypeStageAmounts) => void
  accent?: string
  /** Declare a stage's basis in-app (no re-import). Omit to render read-only. */
  onDeclareBasis?: (stage: string, basis: 'per_unit' | 'per_year' | 'unset') => void | Promise<void>
  /** Parameter names + values, so the lifetime can reference one (e.g.
   *  Battery Circularity's `bess_lifetime_years`) instead of being retyped. */
  parameters?: Array<{ name: string; value: number }>
  /** Project convention supplying the default basis for Use Phase /
   *  Maintenance. A per-stage declaration still overrides it. */
  projectBasis?: UsePhaseBasis
}

// Shared Stage Amounts editor — extracted from LCA Architect's inline block
// so Impact Assessment Single product mode can reuse the same UI. The
// component is dumb: parent owns the state (so it can be persisted in a
// store keyed off archetype id), child renders preset toggle + lifetime
// input + per-stage rows.
export function StageAmountsEditor({
  archetype, value, onChange, accent = 'var(--accent)', onDeclareBasis, parameters,
  projectBasis,
}: Props) {
  const stages = archetype.stages ?? []
  const blocked = lifetimeBlockedReason(archetype, projectBasis)
  const lifetimeAvailable = canApplyLifetime(archetype, projectBasis)
  // A referenced parameter drives the lifetime; the typed box is the fallback.
  const paramLifetime = value.lifetimeParam
    ? parameters?.find((p) => p.name === value.lifetimeParam)?.value
    : undefined
  const effectiveLifetime = paramLifetime ?? value.lifetime

  const applyPreset = useCallback(
    (preset: AmountPreset, lifetime: number) => {
      onChange({ preset, lifetime, amounts: stageAmountsForPreset(archetype, preset, lifetime, value.amounts, projectBasis) })
    },
    [archetype, value.amounts, onChange, projectBasis],
  )

  if (stages.length === 0) return null

  return (
    <div data-testid="stage-amounts-editor" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {([
          { key: '1year' as AmountPreset, label: '1 year' },
          { key: 'lifetime' as AmountPreset, label: `Lifetime (${effectiveLifetime}yr)` },
          { key: 'custom' as AmountPreset, label: 'Custom' },
        ]).map((p) => (
          <button
            key={p.key}
            type="button"
            data-testid={`stage-amounts-preset-${p.key}`}
            disabled={p.key === 'lifetime' && !lifetimeAvailable}
            title={p.key === 'lifetime' ? (blocked ?? undefined) : undefined}
            onClick={() => applyPreset(p.key, effectiveLifetime)}
            style={{
              opacity: p.key === 'lifetime' && !lifetimeAvailable ? 0.45 : 1,
              padding: '3px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              border: '1px solid ' + (value.preset === p.key ? accent : 'var(--border-default)'),
              backgroundColor: value.preset === p.key ? `color-mix(in srgb, ${accent} 12%, transparent)` : 'var(--bg-elevated)',
              color: value.preset === p.key ? accent : 'var(--text-tertiary)',
              fontSize: 10, fontWeight: value.preset === p.key ? 600 : 500,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      {blocked && (
        <div
          data-testid="stage-amounts-lifetime-blocked"
          style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6 }}
        >
          {blocked}
        </div>
      )}
      {value.preset === 'lifetime' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Lifetime:</span>
          <NumberInput
            value={effectiveLifetime}
            onChange={(lt) => applyPreset('lifetime', lt)}
            integerOnly
            min={1}
            emptyValue={1}
            disabled={!!value.lifetimeParam}
            data-testid="stage-amounts-lifetime"
            style={{ width: 50, height: 22, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', outline: 'none', textAlign: 'right' }}
          />
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>years</span>
          {parameters && parameters.length > 0 && (
            <select
              data-testid="stage-amounts-lifetime-param"
              value={value.lifetimeParam ?? ''}
              onChange={(e) => {
                const name = e.target.value || null
                const lt = name
                  ? (parameters.find((q) => q.name === name)?.value ?? value.lifetime)
                  : value.lifetime
                onChange({
                  ...value, preset: 'lifetime', lifetimeParam: name,
                  lifetime: Math.max(1, Math.round(lt)),
                  amounts: stageAmountsForPreset(archetype, 'lifetime', Math.max(1, Math.round(lt)), value.amounts, projectBasis),
                })
              }}
              style={{
                height: 22, padding: '0 4px', backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)', fontSize: 10, outline: 'none', maxWidth: 170,
              }}
            >
              <option value="">typed value</option>
              {parameters.map((q) => (
                <option key={q.name} value={q.name}>{q.name} = {q.value}</option>
              ))}
            </select>
          )}
        </div>
      )}
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {stages.map((stage) => {
          const basis = stageBasis(archetype, stage, projectBasis)
          const suggestion = archetype.stage_annual?.[stage] ? 'per_year' : 'per_unit'
          const stageId = archetype.stage_ids?.[stage]
          return (
            <div
              key={stage}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-elevated)',
              }}
            >
              <span style={{ flex: 1, fontSize: 'var(--text-xs)', color: 'var(--text-primary)', fontWeight: 500 }}>
                {stage}
              </span>
              {onDeclareBasis && stageId ? (
                <select
                  data-testid={`stage-basis-select-${stage}`}
                  value={basis ?? ''}
                  onChange={(e) => {
                    void onDeclareBasis(stage, (e.target.value || 'unset') as 'per_unit' | 'per_year' | 'unset')
                  }}
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
              ) : (
                <span
                  data-testid={`stage-basis-label-${stage}`}
                  style={{
                    fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: basis === null ? 'var(--warning)' : accent,
                  }}
                >
                  {basis === null ? 'not declared' : basis.replace('_', ' ')}
                </span>
              )}
              <NumberInput
                value={value.amounts[stage] ?? 1}
                onChange={(v) => {
                  onChange({
                    ...value,
                    preset: 'custom',
                    amounts: { ...value.amounts, [stage]: v },
                  })
                }}
                min={0}
                emptyValue={0}
                data-testid={`stage-amounts-input-${stage}`}
                style={{
                  width: 60, height: 22, padding: '0 6px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                  outline: 'none', textAlign: 'right',
                }}
              />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', minWidth: 12 }}>×</span>
            </div>
          )
        })}
      </div>
      {value.preset === 'lifetime' && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'right' }}>
          = 1 unit over {value.lifetime} year{value.lifetime !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

// Preset → per-stage amounts. ANNUAL stages scale by `lifetime` under the
// "lifetime" preset; one-time stages stay at 1. "custom" preserves prior
// values (defaulting to 1). Shared by the editor's preset toggle AND by
// multi-item seeding / apply-to-all so the preset math has one definition.
/** The DECLARED basis of a stage, or null when undeclared.
 *
 * Never falls back to `stage_annual`. That field is scope-derived, so using it
 * here is what multiplied a per-kWh Battery Circularity use phase by 15 while
 * leaving its manufacturing at 1 -- an incoherent functional unit, not a
 * rescale. Undeclared means undeclared: multiplier 1, and say so.
 */
/** Stages the PROJECT setting can supply a default for.
 *
 * Use Phase and Maintenance only. Manufacturing and End of Life are per-unit in
 * every project examined, so the setting says nothing about them and an
 * undeclared one stays undeclared. */
const PROJECT_DEFAULTED = new Set(['Use Phase', 'Maintenance'])

export type UsePhaseBasis = 'life_cycle' | 'one_year'

export function stageBasis(
  arc: ArchetypeSummary,
  stage: string,
  projectBasis?: UsePhaseBasis,
): 'per_unit' | 'per_year' | null {
  // A per-stage declaration (PR #41) always wins -- it is the override for an
  // archetype that mixes bases against its project's convention.
  const declared = arc.stage_basis?.[stage] ?? null
  if (declared) return declared
  // Otherwise inherit the project setting, for Use Phase / Maintenance only.
  if (projectBasis && PROJECT_DEFAULTED.has(stage)) {
    return projectBasis === 'one_year' ? 'per_year' : 'per_unit'
  }
  return null
}

/** Stages whose basis has never been declared. */
export function undeclaredStages(
  arc: ArchetypeSummary, projectBasis?: UsePhaseBasis,
): string[] {
  return (arc.stages ?? []).filter((s) => stageBasis(arc, s, projectBasis) === null)
}

/** Lifetime is meaningless until every stage says what its quantity means. */
export function canApplyLifetime(
  arc: ArchetypeSummary, projectBasis?: UsePhaseBasis,
): boolean {
  return undeclaredStages(arc, projectBasis).length === 0
}

/** Why the Lifetime preset is unavailable, or null when it is available. */
export function lifetimeBlockedReason(
  arc: ArchetypeSummary, projectBasis?: UsePhaseBasis,
): string | null {
  const undeclared = undeclaredStages(arc, projectBasis)
  if (undeclared.length > 0) {
    return `Declare a basis for ${undeclared.join(', ')} to use Lifetime.`
  }
  if (!(arc.stages ?? []).some((s) => stageBasis(arc, s, projectBasis) === 'per_year')) {
    return 'No per-year stages — lifetime has no effect.'
  }
  return null
}

export function stageAmountsForPreset(
  arc: ArchetypeSummary,
  preset: AmountPreset,
  lifetime: number,
  prev?: Record<string, number> | null,
  projectBasis?: UsePhaseBasis,
): Record<string, number> {
  const amounts: Record<string, number> = {}
  for (const s of arc.stages ?? []) {
    if (preset === '1year') amounts[s] = 1
    // Only a stage DECLARED per_year scales with the lifetime. per_unit and
    // undeclared both stay at 1 -- the identity multiplier is the one value
    // both conventions agree on, which is what makes it safe as a default.
    else if (preset === 'lifetime') amounts[s] = stageBasis(arc, s, projectBasis) === 'per_year' ? lifetime : 1
    else amounts[s] = prev?.[s] ?? 1
  }
  return amounts
}

// Helper for parents to build a default ArchetypeStageAmounts entry for a
// given archetype. Mirrors LCA Architect's `initArcAmounts`.
export function defaultStageAmounts(arc: ArchetypeSummary): ArchetypeStageAmounts {
  const amounts: Record<string, number> = {}
  for (const s of arc.stages ?? []) amounts[s] = 1
  return { preset: '1year', lifetime: 15, amounts }
}

// Compact summary for a collapsed Stage Amounts card — preset name + the
// per-stage values in insertion order, abbreviated. Truncated to the first
// six stages so the line stays readable on narrow viewports. Shared by
// Single-item (wrapper-level card) and Multi-item (per-item cards).
export function stageAmountsSummary(entry: { preset: string; lifetime: number; lifetimeParam?: string | null; amounts: Record<string, number> }): string {
  const presetLabel =
    entry.preset === '1year' ? '1 year' :
    entry.preset === 'lifetime'
      ? `Lifetime · ${entry.lifetime} yr${entry.lifetimeParam ? ` (${entry.lifetimeParam})` : ''}` :
    'Custom'
  const stages = Object.keys(entry.amounts)
  const head = stages.slice(0, 6).map((s) => `${abbreviateStage(s)} ${formatStageAmount(entry.amounts[s])}`)
  const more = stages.length > 6 ? ` · +${stages.length - 6} more` : ''
  return head.length === 0 ? presetLabel : `${presetLabel} · ${head.join(' · ')}${more}`
}

// Lightweight abbreviation for stage labels in the summary row. Common BOM
// stage names get a recognisable short form; otherwise we keep the original.
export function abbreviateStage(s: string): string {
  const n = s.toLowerCase()
  if (n.startsWith('manufactur')) return 'Mfg'
  if (n.includes('use')) return 'Use'
  if (n.includes('maint')) return 'Maint'
  if (n.includes('end of life') || n.includes('end-of-life') || n === 'eol') return 'EoL'
  return s
}

export function formatStageAmount(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.?0+$/, '')
}

// Compare two stage_amount maps for staleness. Used by panels to flag
// "result was computed with different stage amounts than current edits".
export function stageAmountsEqual(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined,
): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (a[k] !== b[k]) return false
  }
  return true
}
