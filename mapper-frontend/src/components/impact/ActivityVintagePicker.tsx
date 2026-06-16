// Per-item-vintage activity picker (multi-item comparison, activity mode).
//
// After the user picks ONE base activity in the MultiItemSelector, this panel
// lets them choose one or more VINTAGES of it — base ecoinvent (static) and/or
// premise SSP×year databases. Each checked vintage becomes a distinct
// comparison item (its own database + stable color), labeled
// `<reference product> [<vintage>]` (e.g. "electricity, low voltage [SSP1 2040]").
//
// Vintage resolution is Design A: the concrete premise DB name comes straight
// from the pLCA registry (`usePLCAStore.databases` — the same registry
// `_resolve_prospective_dbs` reads). We never reimplement prospective
// resolution; naming the premise DB on the item is the existing per-item-DB
// compute contract.
//
// Superstructure premise DBs are listed DISABLED (with a tooltip): the compute
// engine only resolves separate per-year DBs today — year-slice activation for
// superstructure is a deferred, separate engine. Offering them would silently
// compute one ambiguous scenario.

import { useMemo, useState } from 'react'
import { Layers, X } from 'lucide-react'
import type { ProspectiveDB } from '../../api/client'
import type { ActivityProductItem } from '../shared/productItem'
import { Button } from '../ui/Button'
import { ScenarioYearPicker, type ScenarioGroup } from './ScenarioYearPicker'

interface ActivityVintagePickerProps {
  /** The base activity the user picked (carries database/code + 5M fields). */
  activity: ActivityProductItem
  /** Full pLCA registry — filtered here to this activity's base_db. */
  databases: ProspectiveDB[]
  /** Keys (productItemKey) already in the comparison, to pre-check + disable. */
  existingKeys: Set<string>
  onAdd: (items: ActivityProductItem[]) => void
  onCancel: () => void
}

/** Stable, human-readable vintage tag for a premise DB. */
function vintageLabelFor(db: ProspectiveDB): string {
  return `${(db.ssp || '').toUpperCase()} ${db.year ?? ''}`.trim()
}

export function ActivityVintagePicker({
  activity, databases, existingKeys, onAdd, onCancel,
}: ActivityVintagePickerProps) {
  const baseDb = activity.database
  const refProduct = activity.product || activity.name || activity.display_name

  // Separate-mode premise DBs for THIS base ecoinvent — the only vintages the
  // compute engine can target per-year (concrete `year`, own `name`).
  const { separate, superstructure } = useMemo(() => {
    const sep: ProspectiveDB[] = []
    const sup: ProspectiveDB[] = []
    for (const db of databases) {
      if (db.base_db !== baseDb) continue
      if (db.mode === 'separate' && typeof db.year === 'number') sep.push(db)
      else sup.push(db)  // superstructure (or any non-per-year entry)
    }
    sep.sort((a, b) => (a.ssp || '').localeCompare(b.ssp || '') || (a.year ?? 0) - (b.year ?? 0))
    return { separate: sep, superstructure: sup }
  }, [databases, baseDb])

  // Selection: a set of "vintage keys". Static uses the base DB name; premise
  // vintages use their DB name. Pre-check any already in the comparison.
  const staticKey = `act:${baseDb}|${activity.code}`
  const keyForDb = (dbName: string) => `act:${dbName}|${activity.code}`
  const [checked, setChecked] = useState<Set<string>>(() => {
    const init = new Set<string>()
    if (existingKeys.has(staticKey)) init.add(baseDb)
    for (const db of separate) if (existingKeys.has(keyForDb(db.name))) init.add(db.name)
    return init
  })

  const toggle = (dbName: string) => setChecked((prev) => {
    const next = new Set(prev)
    if (next.has(dbName)) next.delete(dbName); else next.add(dbName)
    return next
  })
  // Explicit-on toggle + group batch toggle for the shared ScenarioYearPicker
  // (ALL YEARS / CLEAR). Display-only over `checked` — never changes buildItems.
  const toggleYear = (dbName: string, on: boolean) => setChecked((prev) => {
    const next = new Set(prev)
    if (on) next.add(dbName); else next.delete(dbName)
    return next
  })
  const setGroup = (dbNames: string[], on: boolean) => setChecked((prev) => {
    const next = new Set(prev)
    if (on) for (const n of dbNames) next.add(n)
    else for (const n of dbNames) next.delete(n)
    return next
  })

  // Group premise vintages by the FULL scenario (base · iam · ssp) — ssp carries
  // the budget (e.g. SSP1-PkBudg1150), so this is "model · ssp-budget", matching
  // the single-item LCI scenarios picker. Never group by SSP alone. Superstructure
  // DBs join their scenario group as DISABLED entries (per-year compute
  // unavailable). Grouping is display-only; `buildItems` still iterates `separate`.
  const SUPER_TITLE = 'Superstructure databases are not year-resolvable for compute yet — generate separate-mode for per-year comparison.'
  const groups: ScenarioGroup[] = useMemo(() => {
    const map = new Map<string, { iam: string; ssp: string; years: ScenarioGroup['years'] }>()
    const add = (db: ProspectiveDB, disabled: boolean) => {
      const k = `${db.base_db}|${db.iam}|${db.ssp}`
      if (!map.has(k)) map.set(k, { iam: db.iam, ssp: db.ssp, years: [] })
      map.get(k)!.years.push({ id: db.name, year: db.year, disabled, title: disabled ? SUPER_TITLE : db.name })
    }
    for (const db of separate) add(db, false)
    for (const db of superstructure) add(db, true)
    for (const g of map.values()) g.years.sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, g]) => ({ key, label: `${g.iam} · ${g.ssp}`, years: g.years }))
  }, [separate, superstructure])

  const buildItems = (): ActivityProductItem[] => {
    const out: ActivityProductItem[] = []
    if (checked.has(baseDb)) {
      out.push({
        type: 'activity', database: baseDb, code: activity.code, amount: 1.0,
        display_name: `${refProduct} [ecoinvent]`,
        name: activity.name, product: activity.product,
        location: activity.location, unit: activity.unit,
        vintage_label: 'ecoinvent', base_database: baseDb,
        iam: null, ssp: null, year: null,
      })
    }
    for (const db of separate) {
      if (!checked.has(db.name)) continue
      const vl = vintageLabelFor(db)
      out.push({
        type: 'activity', database: db.name, code: activity.code, amount: 1.0,
        display_name: `${refProduct} [${vl}]`,
        name: activity.name, product: activity.product,
        location: activity.location, unit: activity.unit,
        vintage_label: vl, base_database: db.base_db,
        iam: db.iam, ssp: db.ssp, year: db.year,
      })
    }
    return out
  }

  const addCount = checked.size

  const row = (key: string, label: string, sub: string, disabled = false, title?: string) => {
    const isChecked = checked.has(key)
    return (
      <label
        key={key}
        data-testid={`vintage-option-${key}`}
        title={title}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
          borderRadius: 'var(--radius-sm)', cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          background: isChecked ? 'var(--bg-elevated)' : 'transparent',
        }}
      >
        <input
          type="checkbox"
          checked={isChecked}
          disabled={disabled}
          onChange={() => !disabled && toggle(key)}
        />
        <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{sub}</span>
      </label>
    )
  }

  return (
    <div
      data-testid="activity-vintage-picker"
      style={{
        marginTop: 'var(--space-3)', padding: 'var(--space-3)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
        background: 'var(--bg-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
          <Layers size={13} /> Choose vintages
        </span>
        <button
          type="button"
          data-testid="vintage-picker-cancel"
          onClick={onCancel}
          aria-label="Cancel vintage selection"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Activity identity — 5M discriminating fields so look-alikes are tellable apart. */}
      <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{activity.name || refProduct}</div>
        {activity.product && activity.product !== activity.name && <div>{activity.product}</div>}
        <div>{[activity.location, activity.unit].filter(Boolean).join(' · ')}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{activity.code}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Static (ecoinvent) — ungrouped, above the scenario groups; toggles
            independently of the groups. */}
        {row(baseDb, 'ecoinvent (static)', baseDb)}

        {/* Premise vintages grouped by scenario (model · ssp-budget), each with
            per-group ALL YEARS / CLEAR — mirrors the single-item LCI picker. */}
        {groups.length > 0 && (
          <div
            data-testid="vintage-picker-groups"
            style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              maxHeight: 240, overflowY: 'auto',
              borderTop: '1px solid var(--border-subtle)', paddingTop: 6,
            }}
          >
            <ScenarioYearPicker
              groups={groups}
              selected={checked}
              onToggleYear={toggleYear}
              onSetGroup={setGroup}
              testIds={{
                allYears: (k) => `vintage-group-all-${k}`,
                clear: (k) => `vintage-group-clear-${k}`,
                yearItem: (id) => `vintage-option-${id}`,
                groupHeader: (k) => `vintage-group-header-${k}`,
              }}
            />
          </div>
        )}

        {separate.length === 0 && superstructure.length === 0 && (
          <div data-testid="vintage-picker-no-premise" style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '4px 8px' }}>
            No premise databases for this base database. Generate prospective databases in the pLCA tab to compare across SSP×year vintages.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          data-testid="vintage-picker-add"
          disabled={addCount === 0}
          onClick={() => onAdd(buildItems())}
        >
          Add {addCount > 0 ? addCount : ''} to comparison
        </Button>
      </div>
    </div>
  )
}
