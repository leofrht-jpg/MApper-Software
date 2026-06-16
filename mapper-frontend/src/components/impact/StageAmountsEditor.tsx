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
}

// Shared Stage Amounts editor — extracted from LCA Architect's inline block
// so Impact Assessment Single product mode can reuse the same UI. The
// component is dumb: parent owns the state (so it can be persisted in a
// store keyed off archetype id), child renders preset toggle + lifetime
// input + per-stage rows.
export function StageAmountsEditor({ archetype, value, onChange, accent = 'var(--accent)' }: Props) {
  const stages = archetype.stages ?? []

  const applyPreset = useCallback(
    (preset: AmountPreset, lifetime: number) => {
      onChange({ preset, lifetime, amounts: stageAmountsForPreset(archetype, preset, lifetime, value.amounts) })
    },
    [archetype, value.amounts, onChange],
  )

  if (stages.length === 0) return null

  return (
    <div data-testid="stage-amounts-editor" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {([
          { key: '1year' as AmountPreset, label: '1 year' },
          { key: 'lifetime' as AmountPreset, label: `Lifetime (${value.lifetime}yr)` },
          { key: 'custom' as AmountPreset, label: 'Custom' },
        ]).map((p) => (
          <button
            key={p.key}
            type="button"
            data-testid={`stage-amounts-preset-${p.key}`}
            onClick={() => applyPreset(p.key, value.lifetime)}
            style={{
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
      {value.preset === 'lifetime' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Lifetime:</span>
          <NumberInput
            value={value.lifetime}
            onChange={(lt) => applyPreset('lifetime', lt)}
            integerOnly
            min={1}
            emptyValue={1}
            data-testid="stage-amounts-lifetime"
            style={{ width: 50, height: 22, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', outline: 'none', textAlign: 'right' }}
          />
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>years</span>
        </div>
      )}
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {stages.map((stage) => {
          const annual = archetype.stage_annual?.[stage] ?? false
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
              {annual && (
                <span style={{ fontSize: 9, color: accent, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  annual
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
export function stageAmountsForPreset(
  arc: ArchetypeSummary,
  preset: AmountPreset,
  lifetime: number,
  prev?: Record<string, number> | null,
): Record<string, number> {
  const amounts: Record<string, number> = {}
  for (const s of arc.stages ?? []) {
    const annual = arc.stage_annual?.[s] ?? false
    if (preset === '1year') amounts[s] = 1
    else if (preset === 'lifetime') amounts[s] = annual ? lifetime : 1
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
export function stageAmountsSummary(entry: { preset: string; lifetime: number; amounts: Record<string, number> }): string {
  const presetLabel =
    entry.preset === '1year' ? '1 year' :
    entry.preset === 'lifetime' ? `Lifetime · ${entry.lifetime} yr` :
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
