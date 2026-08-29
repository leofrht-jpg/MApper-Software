/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import {
  getMaterialPedigree,
  listProjectMaterials,
  saveMaterialPedigree,
  type MaterialPedigreeLibrary,
  type PedigreeCoverage,
  type RowUncertainty,
} from '../../api/client'
import { gsd2Of, scoreSummary, usePedigreeTable } from '../../utils/pedigree'
import { PedigreeEditor } from './PedigreeEditor'

/**
 * Score by MATERIAL NAME — the primary scoring surface.
 *
 * WP5 has 914 literal BOM rows but only 148 distinct names, so this table is
 * 148 rows and scoring "Steel frame" once covers the 21 rows that use it.
 *
 * AN AUTHORING CONVENIENCE, NOT A SAMPLING CHANGE. A row inheriting a score
 * from here is drawn exactly as if the same scores had been typed onto the row
 * itself: the engine keys each draw by node_id, never by name, so two rows
 * sharing a name get two independent draws. That is worth stating plainly,
 * because the expression-row rule makes the opposite assumption reasonable —
 * there a shared PARAMETER really does mean a shared draw. A shared name is
 * not a shared driver; it is two quantities that happen to be equally well
 * known.
 */
interface Props {
  /** Rendered above the table when a computation is on screen. */
  coverage?: PedigreeCoverage | null
  onLibraryChange?: () => void
}

export function MaterialPedigreeTable({ coverage, onLibraryChange }: Props) {
  const table = usePedigreeTable()
  const [materials, setMaterials] = useState<string[] | null>(null)
  const [library, setLibrary] = useState<MaterialPedigreeLibrary>({ entries: {} })
  const [filter, setFilter] = useState('')
  const [onlyUnscored, setOnlyUnscored] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([listProjectMaterials(), getMaterialPedigree()])
      .then(([names, lib]) => { setMaterials(names); setLibrary(lib) })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // Biggest unscored contributors first, so the ordering answers "where is the
  // next hour of scoring worth spending" rather than being alphabetical.
  const impactRank = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of coverage?.top_unscored ?? []) m.set(u.name, u.share)
    return m
  }, [coverage])

  const rows = useMemo(() => {
    const all = materials ?? []
    const q = filter.trim().toLowerCase()
    return all
      .filter((n) => (!q || n.toLowerCase().includes(q)))
      .filter((n) => (!onlyUnscored || !library.entries[n]))
      .sort((a, b) => {
        const ia = impactRank.get(a) ?? -1
        const ib = impactRank.get(b) ?? -1
        if (ia !== ib) return ib - ia
        return a.localeCompare(b)
      })
  }, [materials, filter, onlyUnscored, library, impactRank])

  const scoredCount = useMemo(
    () => (materials ?? []).filter((n) => library.entries[n]).length,
    [materials, library],
  )

  const persist = async (next: MaterialPedigreeLibrary) => {
    setLibrary(next)
    setSaving(true)
    try {
      await saveMaterialPedigree(next)
      onLibraryChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const setScore = (name: string, scores: Record<string, number> | null, basic: number | null) => {
    const entries = { ...library.entries }
    if (scores === null) delete entries[name]
    else entries[name] = { pedigree: scores, basic_variance: basic ?? undefined } as RowUncertainty
    void persist({ entries })
  }

  if (error) {
    return (
      <div data-testid="material-pedigree-error" style={{ padding: 'var(--space-3)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
        {error}
      </div>
    )
  }
  if (!materials || !table) {
    return <div style={{ padding: 'var(--space-3)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Loading materials…</div>
  }

  return (
    <div data-testid="material-pedigree-table" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {coverage && <CoverageBanner coverage={coverage} />}

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0 }}>
        Scoring a material here applies to every BOM row that uses it — {materials.length} names
        cover the project&apos;s literal rows. A row with its own score (set in the workbook or
        on the row) keeps it. <strong>Inheritance shares the score, not the draw:</strong> each
        row is still sampled independently, exactly as if the scores had been typed onto it.
      </p>

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 220px' }}>
          <Search size={13} strokeWidth={1.8} color="var(--text-tertiary)" />
          <input
            data-testid="material-pedigree-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter materials…"
            style={{
              flex: 1, height: 30, padding: '0 10px',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface)', color: 'var(--text-primary)',
              fontSize: 'var(--text-sm)',
            }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            data-testid="material-pedigree-only-unscored"
            checked={onlyUnscored}
            onChange={(e) => setOnlyUnscored(e.target.checked)}
          />
          Unscored only
        </label>
        <span data-testid="material-pedigree-count" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          {scoredCount} of {materials.length} scored{saving ? ' · saving…' : ''}
        </span>
      </div>

      <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {rows.length === 0 && (
          <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            No materials match.
          </div>
        )}
        {rows.map((name) => {
          const entry = library.entries[name]
          const isOpen = expanded === name
          const share = impactRank.get(name)
          const g = entry ? gsd2Of(table, entry.pedigree ?? null, entry.basic_variance ?? table.default_basic_variance) : null
          return (
            <div key={name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                data-testid={`material-row-${name}`}
                onClick={() => setExpanded(isOpen ? null : name)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px var(--space-3)', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span style={{ flex: 1 }}>{name}</span>
                {share !== undefined && share > 0 && (
                  <span
                    data-testid={`material-share-${name}`}
                    title="Share of the current archetype's impact — unscored"
                    style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {(share * 100).toFixed(1)}%
                  </span>
                )}
                {entry ? (
                  <span
                    data-testid={`material-scored-${name}`}
                    style={{ fontSize: 'var(--text-xs)', color: 'var(--mod-lca)', fontFamily: 'var(--font-mono)' }}
                  >
                    {scoreSummary(table, entry.pedigree ?? null)} · GSD² {g?.toFixed(3)}
                  </span>
                ) : (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>unscored</span>
                )}
              </button>
              {isOpen && (
                <div style={{ padding: '0 var(--space-3) var(--space-3) 28px' }}>
                  <PedigreeEditor
                    testIdPrefix={`material-pedigree-${name}`}
                    scores={entry?.pedigree ?? null}
                    basicVariance={entry?.basic_variance ?? null}
                    onChange={(scores, basic) => setScore(name, scores, basic)}
                    compact
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Coverage, stated in both figures, with the impact-weighted one as the
 * headline. The row count says how much clicking has been done; the weighted
 * share says how much of the ANSWER rests on assessed data — which is what
 * makes a reported GSD² legible rather than implied.
 */
export function CoverageBanner({ coverage }: { coverage: PedigreeCoverage }) {
  const pct = Math.round(coverage.impact_share * 100)
  const tone = pct >= 80 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)'
  return (
    <div
      data-testid="pedigree-coverage"
      style={{
        padding: 'var(--space-3)',
        border: `1px solid ${tone}`, borderRadius: 'var(--radius-md)',
        background: 'var(--bg-elevated)',
      }}
    >
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
        <strong data-testid="pedigree-coverage-headline">
          {coverage.materials_scored} of {coverage.materials_total} materials scored — covering{' '}
          <span style={{ color: tone }}>{pct}%</span> of this archetype&apos;s {coverage.method_label}
        </strong>
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
        Weighted by impact, not row count. Unscored materials contribute no foreground
        variance, so the remaining {100 - pct}% of this indicator rests on the background
        database alone.
      </div>
      {coverage.top_unscored.length > 0 && (
        <div data-testid="pedigree-coverage-next" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 6 }}>
          Biggest unscored:{' '}
          {coverage.top_unscored.slice(0, 4).map((u, i) => (
            <span key={u.name}>
              {i > 0 && ' · '}
              <span style={{ color: 'var(--text-primary)' }}>{u.name}</span> {(u.share * 100).toFixed(1)}%
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
