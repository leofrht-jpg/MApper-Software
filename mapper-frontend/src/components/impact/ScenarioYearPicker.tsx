// Patch 5Z — shared, selection-AGNOSTIC grouped scenario-year picker.
//
// Extracted from the single-item Prospective Background "LCI scenarios" picker
// (SingleProductProjectedPanel) so the multi-item ActivityVintagePicker can
// mirror the same grouped template (group by model · ssp-budget; per-group
// ALL YEARS / CLEAR; year checkboxes). Purely presentational — it owns NO
// selection state. Each parent passes its own `selected` set + toggle handlers,
// so the two stay decoupled (single-item → prospective DBs; multi-item →
// comparison items). The grouping/controls are DISPLAY-ONLY: they never alter
// what a checked year maps to in the parent.

export interface ScenarioYearItem {
  /** Stable id for this year-entry (single-item: db.name; multi-item: db.name). */
  id: string
  year: number | null
  disabled?: boolean
  title?: string
}

export interface ScenarioGroup {
  /** Group key, unique across groups (e.g. `${base_db}|${iam}|${ssp}`). */
  key: string
  /** Header label — the FULL scenario, "model · ssp-budget" (e.g.
   *  "REMIND · SSP1-PkBudg1150"). Never SSP alone. */
  label: string
  years: ScenarioYearItem[]
}

interface Props {
  groups: ScenarioGroup[]
  /** Set of selected year ids (parent-owned). */
  selected: Set<string>
  /** Toggle one year. */
  onToggleYear: (id: string, on: boolean) => void
  /** Batch-toggle a group's selectable (non-disabled) years — ALL YEARS / CLEAR. */
  onSetGroup: (ids: string[], on: boolean) => void
  disabled?: boolean
  /** Per-consumer testid scheme (preserves single-item's existing ids). */
  testIds?: {
    container?: string
    allYears?: (key: string) => string
    clear?: (key: string) => string
    yearItem?: (id: string) => string
    groupHeader?: (key: string) => string
  }
  /** Render a year's label (default: the year, or "—"). */
  yearLabel?: (year: number | null) => string
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-default)',
    background: 'var(--bg-base)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

export function ScenarioYearPicker({
  groups, selected, onToggleYear, onSetGroup, disabled = false, testIds, yearLabel,
}: Props) {
  const fmtYear = yearLabel ?? ((y: number | null) => (y ?? '—').toString())
  return (
    <div data-testid={testIds?.container} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {groups.map((g) => {
        const selectableIds = g.years.filter((y) => !y.disabled).map((y) => y.id)
        const selectedCount = selectableIds.filter((id) => selected.has(id)).length
        const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length
        const noneSelected = selectedCount === 0
        return (
          <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 }}>
              <span
                data-testid={testIds?.groupHeader?.(g.key)}
                style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}
              >
                {g.label}
              </span>
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <button
                  type="button"
                  data-testid={testIds?.allYears?.(g.key)}
                  disabled={disabled || allSelected || selectableIds.length === 0}
                  onClick={() => onSetGroup(selectableIds, true)}
                  style={btnStyle(disabled || allSelected || selectableIds.length === 0)}
                  title="Select every year for this scenario"
                >
                  All years
                </button>
                <button
                  type="button"
                  data-testid={testIds?.clear?.(g.key)}
                  disabled={disabled || noneSelected}
                  onClick={() => onSetGroup(selectableIds, false)}
                  style={btnStyle(disabled || noneSelected)}
                  title="Clear every year for this scenario"
                >
                  Clear
                </button>
              </span>
            </div>
            {g.years.map((y) => {
              const checked = selected.has(y.id)
              const yDisabled = disabled || !!y.disabled
              return (
                <label
                  key={y.id}
                  title={y.title ?? y.id}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 'var(--text-xs)', color: 'var(--text-primary)',
                    cursor: yDisabled ? 'not-allowed' : 'pointer', paddingLeft: 8,
                    opacity: y.disabled ? 0.5 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid={testIds?.yearItem?.(y.id)}
                    checked={checked}
                    disabled={yDisabled}
                    onChange={(e) => !yDisabled && onToggleYear(y.id, e.target.checked)}
                  />
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtYear(y.year)}</span>
                </label>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
