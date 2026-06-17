import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, Square } from 'lucide-react'
import { getMethods, type MethodFamily } from '../api/client'

const indicatorKey = (t: string[]) => t.join('|')

const RECOMMENDED_KEYWORDS = [
  'climate change', 'acidification', 'eutrophication, freshwater',
  'ozone depletion', 'photochemical ozone formation',
  'particulate matter', 'resource use, minerals', 'resource use, fossils',
  'resource use, energy', 'water use',
]

export interface MethodSelection {
  methods: MethodFamily[]
  family: string
  setFamily: (f: string) => void
  selected: Record<string, string[]>
  toggle: (tuple: string[]) => void
  selectAll: () => void
  clearAll: () => void
  selectRecommended: () => void
  allCategories: MethodFamily['categories']
  totalIndicators: number
  count: number
}

export function useMethodSelection(
  onChange: (methods: string[][]) => void,
  initialSelected?: string[][],
  // When true, the selection defaults to ALL of the current method's categories
  // (and re-defaults to all when the method changes), instead of starting empty.
  // Opt-in for the system-level panels (Leo wants the full category set by
  // default for the AESA + standalone results); users can still deselect. Off
  // for callers that seed via `initialSelected` (single-product inheritance).
  defaultAllSelected = false,
): MethodSelection {
  const [methods, setMethods] = useState<MethodFamily[]>([])
  const [family, setFamilyState] = useState('')
  // The family we've already auto-defaulted-to-all for. Prevents re-selecting
  // after the user deliberately clears the selection (same family).
  const defaultedFamilyRef = useRef<string | null>(null)
  // Patch 4D — when a parent passes `initialSelected` (single-product
  // inheritance from Static → Projected), seed the selected map from it on
  // mount. Re-seed by remounting via a `key` prop on the parent — useState
  // initializer runs once per mount.
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    if (initialSelected && initialSelected.length > 0) {
      const seed: Record<string, string[]> = {}
      for (const t of initialSelected) seed[indicatorKey(t)] = t
      return seed
    }
    return {}
  })

  useEffect(() => {
    const load = () => {
      getMethods().then((m) => {
        setMethods(m)
        setFamilyState((prev) => {
          if (prev) return prev
          // If we were seeded with a selection, prefer the family that owns
          // those tuples (tuple[0] is the family name in the bw2 method
          // tuple convention) so the checkboxes light up correctly.
          if (initialSelected && initialSelected.length > 0) {
            const seedFam = initialSelected[0][0]
            if (m.find((f) => f.family === seedFam)) return seedFam
          }
          // Prefer EF v3.1 if installed; fall back to first available.
          const ef = m.find((f) => f.family.startsWith('EF v3.1'))?.family
          return ef ?? m[0]?.family ?? ''
        })
      })
    }
    load()
    // Re-fetch whenever the LCIA Method Library installs/uninstalls a method.
    const handler = () => load()
    window.addEventListener('lcia-library-changed', handler)
    return () => window.removeEventListener('lcia-library-changed', handler)
  }, [])

  const allCategories = useMemo(
    () => methods.find((m) => m.family === family)?.categories ?? [],
    [methods, family],
  )

  const totalIndicators = useMemo(
    () => allCategories.reduce((s, c) => s + c.indicators.length, 0),
    [allCategories],
  )

  // Default to ALL categories of the current method (opt-in). Re-defaults when
  // the method changes (allCategories changes → new family → ref mismatch).
  // Guarded by `defaultedFamilyRef` so a user who clears the selection for the
  // current family isn't force-reselected.
  useEffect(() => {
    if (!defaultAllSelected) return
    if (initialSelected && initialSelected.length > 0) return  // seeded path owns the selection
    if (!family || allCategories.length === 0) return
    if (defaultedFamilyRef.current === family) return
    const next: Record<string, string[]> = {}
    for (const cat of allCategories)
      for (const ind of cat.indicators) next[indicatorKey(ind.tuple)] = ind.tuple
    defaultedFamilyRef.current = family
    setSelected(next)
  }, [defaultAllSelected, initialSelected, family, allCategories])

  useEffect(() => {
    onChange(Object.values(selected))
  }, [selected, onChange])

  const setFamily = useCallback((newFamily: string) => {
    setFamilyState(newFamily)
    setSelected({})
  }, [])

  const toggle = useCallback((tuple: string[]) => {
    const k = indicatorKey(tuple)
    setSelected((prev) => {
      const next = { ...prev }
      if (next[k]) delete next[k]
      else next[k] = tuple
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    const next: Record<string, string[]> = {}
    for (const cat of allCategories)
      for (const ind of cat.indicators) next[indicatorKey(ind.tuple)] = ind.tuple
    setSelected(next)
  }, [allCategories])

  const clearAll = useCallback(() => setSelected({}), [])

  const selectRecommended = useCallback(() => {
    const next: Record<string, string[]> = {}
    const fam = methods.find((m) => m.family === family)
    if (fam) {
      for (const cat of fam.categories) {
        const cl = cat.category.toLowerCase()
        if (RECOMMENDED_KEYWORDS.some((k) => cl.includes(k) || k.includes(cl))) {
          for (const ind of cat.indicators) next[indicatorKey(ind.tuple)] = ind.tuple
        }
      }
    }
    if (Object.keys(next).length === 0 && fam) {
      for (const cat of fam.categories)
        for (const ind of cat.indicators) next[indicatorKey(ind.tuple)] = ind.tuple
    }
    setSelected(next)
  }, [methods, family])

  return {
    methods, family, setFamily, selected, toggle,
    selectAll, clearAll, selectRecommended,
    allCategories, totalIndicators, count: Object.keys(selected).length,
  }
}

export function MethodFamilySelect({ selection, style }: { selection: MethodSelection; style?: React.CSSProperties }) {
  return (
    <select
      value={selection.family}
      onChange={(e) => selection.setFamily(e.target.value)}
      style={{
        height: 36, padding: '0 10px', backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
        color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none',
        cursor: 'pointer', minWidth: 240, ...style,
      }}
    >
      {selection.methods.map((m) => <option key={m.family} value={m.family}>{m.family}</option>)}
    </select>
  )
}

export function IndicatorChecklist({
  selection, accent = 'var(--accent)', maxHeight = 260,
}: {
  selection: MethodSelection
  accent?: string
  maxHeight?: number | string
}) {
  const { selected, toggle, selectAll, clearAll, selectRecommended, allCategories, totalIndicators, count } = selection
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
      {/* Header actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={selectAll} style={actionBtn(accent)}>
          <CheckSquare size={12} /> Select all
        </button>
        <button type="button" onClick={clearAll} style={actionBtn('var(--text-secondary)')}>
          <Square size={12} /> Clear
        </button>
        <button type="button" onClick={selectRecommended} style={{ ...actionBtn(accent), fontWeight: 500 }}>
          Recommended set
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {count} of {totalIndicators} selected
        </span>
      </div>

      {/* Checklist */}
      <div style={{
        maxHeight, overflowY: 'auto',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
        backgroundColor: 'var(--bg-elevated)', flex: 1, minHeight: 0,
      }}>
        {allCategories.map((cat) => (
          <div key={cat.category}>
            <div style={{
              padding: '6px 10px', fontSize: 'var(--text-xs)', fontWeight: 600,
              color: 'var(--text-tertiary)', textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-wide)',
              backgroundColor: 'var(--bg-surface)',
              position: 'sticky', top: 0, zIndex: 1,
            }}>
              {cat.category}
            </div>
            {cat.indicators.map((ind) => {
              const k = indicatorKey(ind.tuple)
              const checked = !!selected[k]
              return (
                <label
                  key={k}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px 5px 16px',
                    fontSize: 'var(--text-xs)', color: 'var(--text-primary)', cursor: 'pointer',
                    backgroundColor: checked ? `color-mix(in srgb, ${accent} 10%, transparent)` : 'transparent',
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(ind.tuple)} style={{ accentColor: accent }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ind.indicator}>
                    {ind.indicator}
                  </span>
                </label>
              )
            })}
          </div>
        ))}
        {allCategories.length === 0 && (
          <div style={{ padding: 12, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            No indicators available.
          </div>
        )}
      </div>
    </div>
  )
}

const actionBtn = (color: string): React.CSSProperties => ({
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 'var(--text-xs)', color, fontWeight: 500, padding: 0,
  display: 'flex', alignItems: 'center', gap: 4,
})

// ── Legacy combined picker (kept for LCACalculator) ──────────────────────────

interface MethodPickerProps {
  onChange: (methods: string[][]) => void
  accent?: string
  // Patch 4D — used by single-product Projected panel to seed its picker on
  // first-visit inheritance from Static. To re-seed (e.g. archetype change),
  // bump a `key` prop on this component so React remounts it.
  initialSelected?: string[][]
  // Default the selection to ALL of the current method's categories (and
  // re-default on method change). The hook's seed-guard makes this fire only
  // when there's no `initialSelected` seed, deferring to the seed/inheritance
  // otherwise. Off by default.
  defaultAllSelected?: boolean
}

export function MethodPicker({ onChange, accent = 'var(--accent)', initialSelected, defaultAllSelected }: MethodPickerProps) {
  const selection = useMethodSelection(onChange, initialSelected, defaultAllSelected)
  const { selected, count } = selection
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <MethodFamilySelect selection={selection} style={{ width: '100%' }} />
      <IndicatorChecklist selection={selection} accent={accent} maxHeight={300} />
      {count > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.entries(selected).slice(0, 5).map(([k, tuple]) => (
            <span key={k} style={{
              padding: '2px 8px', fontSize: 'var(--text-xs)',
              backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
              color: accent, borderRadius: 'var(--radius-sm)',
              border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`,
              maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {tuple[tuple.length - 1]}
            </span>
          ))}
          {count > 5 && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', padding: '2px 4px' }}>+{count - 5} more</span>}
        </div>
      )}
    </div>
  )
}
