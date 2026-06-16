import { useMemo } from 'react'

import type { DatabaseResponse } from '../../api/client'

/** A "pattern" identifies a unique IAM × pathway combination — i.e. a
 *  prospective DB family without the trailing year suffix. For static
 *  databases the pattern equals the full DB name. */
export interface DatabasePattern {
  /** Pattern key — equal to the DB name for static, equal to the name
   *  with the trailing ``_<year>`` stripped for prospective. */
  pattern: string
  /** Friendly label shown in the dropdown. */
  label: string
  /** True when this pattern represents a premise-generated DB family. */
  isProspective: boolean
  /** Years for which a prospective DB exists in the project. Empty for
   *  static (Year picker is unconstrained in that case). */
  availableYears: number[]
  /** IAM identifier (REMIND, IMAGE, …) when prospective. */
  iam?: string
  /** SSP/pathway identifier when prospective. */
  ssp?: string
}

/** Friendly label for a prospective IAM. */
function iamLabel(iam: string | undefined): string {
  if (!iam) return 'Prospective'
  return iam.toUpperCase()
}

/** Strip a trailing ``_<4-digit-year>`` from a DB name. Returns the input
 *  unchanged if no year suffix is present. */
function stripYearSuffix(name: string): string {
  return name.replace(/_(\d{4})$/, '')
}

function extractYearSuffix(name: string): number | null {
  const m = name.match(/_(\d{4})$/)
  return m ? parseInt(m[1], 10) : null
}

/** Parse premise-generated DB names like
 *  ``ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030`` and
 *  group them into one entry per IAM × pathway with the available years
 *  collected. Returns the full set of selectable patterns plus the
 *  static ones. */
export function buildDatabasePatterns(
  databases: DatabaseResponse[],
): DatabasePattern[] {
  const patterns = new Map<string, DatabasePattern>()

  for (const d of databases) {
    if (d.name.toLowerCase().includes('biosphere')) continue
    if (d.is_prospective) {
      const meta = d.prospective_meta ?? {}
      const pattern = stripYearSuffix(d.name)
      const year = meta.year ?? extractYearSuffix(d.name)
      const iam = (meta.iam ?? '').toUpperCase() || undefined
      const ssp = meta.ssp ?? undefined
      const labelBits = [iamLabel(iam)]
      if (ssp) labelBits.push(ssp.toUpperCase())
      const existing = patterns.get(pattern)
      if (existing) {
        if (year != null && !existing.availableYears.includes(year)) {
          existing.availableYears.push(year)
          existing.availableYears.sort((a, b) => a - b)
        }
      } else {
        patterns.set(pattern, {
          pattern,
          label: labelBits.join(' '),
          isProspective: true,
          availableYears: year != null ? [year] : [],
          iam,
          ssp,
        })
      }
    } else {
      // Static technosphere DB.
      patterns.set(d.name, {
        pattern: d.name,
        label: d.name,
        isProspective: false,
        availableYears: [],
      })
    }
  }

  return Array.from(patterns.values()).sort((a, b) => {
    // Static first, then prospective grouped by IAM.
    if (a.isProspective !== b.isProspective) return a.isProspective ? 1 : -1
    if (a.isProspective && b.isProspective) {
      const ia = (a.iam ?? '').localeCompare(b.iam ?? '')
      if (ia !== 0) return ia
    }
    return a.label.localeCompare(b.label)
  })
}

interface Props {
  databases: DatabaseResponse[]
  /** Currently selected pattern (DB name for static, year-stripped for prospective). */
  value: string | null
  onChange: (pattern: string) => void
  disabled?: boolean
  style?: React.CSSProperties
}

/** Dropdown that groups available LCI databases as Static / Prospective
 *  by IAM. Emits the selected *pattern* — for prospective DBs, the year
 *  is selected separately and concatenated to form the fully-qualified
 *  ``compute_database`` name. */
export function DatabaseSelector({ databases, value, onChange, disabled, style }: Props) {
  const patterns = useMemo(() => buildDatabasePatterns(databases), [databases])
  const staticPatterns = patterns.filter((p) => !p.isProspective)
  const prospectiveByIam = useMemo(() => {
    const map = new Map<string, DatabasePattern[]>()
    for (const p of patterns) {
      if (!p.isProspective) continue
      const key = p.iam ?? 'Prospective'
      const arr = map.get(key) ?? []
      arr.push(p)
      map.set(key, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [patterns])

  const selected = patterns.find((p) => p.pattern === value) ?? null
  const fullName =
    selected && selected.isProspective && selected.availableYears.length > 0
      ? `${selected.pattern}_<year>` // tooltip hint — actual DB resolved when year picked
      : selected?.pattern ?? ''

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || patterns.length === 0}
      title={fullName}
      style={{
        width: '100%',
        height: 32,
        padding: '0 8px',
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--text-primary)',
        fontSize: 'var(--text-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {patterns.length === 0 && <option value="">No databases available</option>}
      {staticPatterns.length > 0 && (
        <optgroup label="Static">
          {staticPatterns.map((p) => (
            <option key={p.pattern} value={p.pattern} title={p.pattern}>
              {p.label}
            </option>
          ))}
        </optgroup>
      )}
      {prospectiveByIam.map(([iam, items]) => (
        <optgroup key={iam} label={`Prospective — ${iam}`}>
          {items.map((p) => (
            <option key={p.pattern} value={p.pattern} title={p.pattern}>
              {p.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
