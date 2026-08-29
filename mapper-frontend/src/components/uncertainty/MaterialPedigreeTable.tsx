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
  type MaterialScoringScope,
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
  /** Where the parameter editor lives, for the pointer in the scope note. */
  onNavigate?: (id: string) => void
}

export function MaterialPedigreeTable({ coverage, onLibraryChange, onNavigate }: Props) {
  const table = usePedigreeTable()
  const [scope, setScope] = useState<MaterialScoringScope | null>(null)
  const [library, setLibrary] = useState<MaterialPedigreeLibrary>({ entries: {} })
  const [filter, setFilter] = useState('')
  const [onlyUnscored, setOnlyUnscored] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([listProjectMaterials(), getMaterialPedigree()])
      .then(([sc, lib]) => { setScope(sc); setLibrary(lib) })
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
    const all = scope?.materials ?? []
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
  }, [scope, filter, onlyUnscored, library, impactRank])

  const scoredCount = useMemo(
    () => (scope?.materials ?? []).filter((n) => library.entries[n]).length,
    [scope, library],
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
  if (!scope || !table) {
    return <div style={{ padding: 'var(--space-3)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Loading materials…</div>
  }

  return (
    <div data-testid="material-pedigree-table" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {coverage && <CoverageBanner coverage={coverage} />}

      <ScopeNote scope={scope} onNavigate={onNavigate} />

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0 }}>
        Scoring a material here applies to every BOM row that uses it. A row with its own score
        (set in the workbook or on the row) keeps it. <strong>Inheritance shares the score, not
        the draw:</strong> each row is still sampled independently, exactly as if the scores had
        been typed onto it.
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
          {scoredCount} of {scope.materials.length} scored{saving ? ' · saving…' : ''}
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
 * What this table can and cannot reach, in this project's actual numbers.
 *
 * An expression row inherits its uncertainty from the parameters in its
 * expression and can never carry its own score, so it is not listed here. On a
 * heavily parameterised project that leaves the table nearly empty while the
 * model's uncertainty lives entirely in the parameter editor -- Battery
 * Circularity shows 2 names against 140 expression rows. A generic sentence
 * would not tell the user which situation they are in; the counts do.
 */
function ScopeNote({
  scope, onNavigate,
}: { scope: MaterialScoringScope; onNavigate?: (id: string) => void }) {
  const n = scope.materials.length
  const expr = scope.expression_rows
  if (expr === 0) return null

  // Where the uncertainty actually lives, for this project.
  const parameterDominant = expr > scope.literal_rows
  return (
    <div
      data-testid="material-scope-note"
      style={{
        padding: 'var(--space-3)',
        border: `1px solid ${parameterDominant ? 'var(--warning)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-elevated)',
        fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
      }}
    >
      <strong style={{ color: 'var(--text-primary)' }}>
        {n} scoreable material{n === 1 ? '' : 's'}
      </strong>
      {'; '}
      {expr} row{expr === 1 ? '' : 's'} use parameter expressions and inherit uncertainty from
      their parameters
      {parameterDominant
        ? '. Most of this project is parameterised, so this table is not where its uncertainty lives.'
        : '.'}
      {onNavigate && (
        <>
          {' '}
          <button
            type="button"
            data-testid="material-scope-goto-parameters"
            onClick={() => onNavigate('lca')}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--mod-lca)', cursor: 'pointer',
              fontSize: 'var(--text-xs)', textDecoration: 'underline',
            }}
          >
            Score them in the parameter editor
          </button>
          {' (LCA Architect → Parameters).'}
        </>
      )}
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
  // null is not 0%. 0% says there is something here you could score and have
  // not; null says there is nothing to score, because every row of this
  // archetype is a parameter expression.
  if (coverage.impact_share === null) {
    return (
      <div
        data-testid="pedigree-coverage-none-scoreable"
        style={{
          padding: 'var(--space-3)',
          border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
          background: 'var(--bg-elevated)',
        }}
      >
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
          <strong>Nothing scoreable in this archetype.</strong>
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
          Every row here takes its quantity from a parameter expression, so none can carry a
          material score. Its foreground uncertainty comes from the parameters instead. This is
          not 0% coverage: there is nothing on this table to fix.
        </div>
      </div>
    )
  }
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
