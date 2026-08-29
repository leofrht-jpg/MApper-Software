/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useState } from 'react'
import { useBOMStore } from '../../stores/bomStore'
import { useParameterStore } from '../../stores/parameterStore'
import { useProjectSettingsStore } from '../../stores/projectSettingsStore'
import { useSingleProductImpactStore } from '../../stores/singleProductImpactStore'
import { ArchetypeSelect } from '../archetypes/ArchetypeSelect'
import { SingleProductStaticPanel } from './SingleProductStaticPanel'
import { SingleProductProjectedPanel } from './SingleProductProjectedPanel'
import { SingleProductComparisonPanel } from './SingleProductComparisonPanel'
import { StageAmountsEditor, defaultStageAmounts, stageAmountsSummary } from './StageAmountsEditor'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { MultiProductLCA } from './MultiProductLCA'

type TabKey = 'static' | 'projected' | 'compare'
type ViewMode = 'single' | 'multi'

// Single-product mode subtree for Impact Assessment (Patch 3). Mirrors the
// system-mode 3-tab layout (Static / Projected / Comparison) but operates on
// a single archetype picked at the top of this subtree, computing through
// the extended /lca/calculate-archetype endpoint.
//
// The mode-level visibility-toggle pattern lives in ImpactAssessment.tsx;
// this component owns its own per-tab visibility-toggle so each
// SingleProduct{Static,Projected,Comparison}Panel keeps its local state when
// the user moves between tabs within single-product mode.
interface SingleProductImpactProps {
  /** Navigate to another top-level tab, for the "change it in Manager" link. */
  onNavigate?: (tab: string) => void
}

export function SingleProductImpact({ onNavigate }: SingleProductImpactProps = {}) {
  const archetypes = useBOMStore((s) => s.archetypes)
  const fetchArchetypes = useBOMStore((s) => s.fetchArchetypes)
  const setStageBasis = useBOMStore((s) => s.setStageBasis)
  // Project convention: Life cycle means the BOM already holds whole-life
  // quantities, so Stage amounts has nothing to multiply and is hidden.
  const projectSettings = useProjectSettingsStore((st) => st.settings)
  const fetchProjectSettings = useProjectSettingsStore((st) => st.fetchSettings)
  useEffect(() => { if (!projectSettings) void fetchProjectSettings() }, [projectSettings, fetchProjectSettings])
  const projectBasis = projectSettings?.use_phase_basis ?? 'one_year'
  const lifeCycleBasis = projectBasis === 'life_cycle'
  // Integer-valued parameters are the plausible lifetime references (e.g.
  // Battery Circularity's `bess_lifetime_years = 15`), so the horizon can be
  // driven by the project's own parameter instead of a retyped duplicate.
  const paramTable = useParameterStore((s) => s.table)
  const lifetimeParams = useMemo(
    () => Object.values(paramTable?.parameters ?? {})
      .filter((q) => Number.isFinite(q.base_value) && q.base_value >= 1)
      .map((q) => ({ name: q.name, value: q.base_value })),
    [paramTable],
  )
  const setStoreArchetypeId = useSingleProductImpactStore((s) => s.setArchetypeId)
  const stageAmountsByArc = useSingleProductImpactStore((s) => s.stageAmountsByArc)
  const setStageAmountsForArc = useSingleProductImpactStore((s) => s.setStageAmountsForArc)
  const [archetypeId, setArchetypeId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('static')
  // Patch 4AG.3 — Single item vs Multi-item comparison sub-mode.
  // Default 'single' preserves existing UX. Switching to 'multi'
  // hides the single-item sub-tabs (Static/Projected/Compare) and
  // renders `<MultiProductLCA>` instead. State preserved across
  // switches via the visibility-toggle pattern (display: none on
  // the inactive subtree) so the user's selections / results
  // don't reset when toggling back and forth.
  const [viewMode, setViewMode] = useState<ViewMode>('single')
  // Stage amounts is an advanced tweak — most users keep Lifetime defaults.
  // Default collapsed; user can expand to edit per-stage amounts.
  const [stageAmountsExpanded, setStageAmountsExpanded] = useState(false)

  const activeArchetype = useMemo(
    () => archetypes.find((a) => a.id === archetypeId) ?? null,
    [archetypes, archetypeId],
  )
  const stageAmountsEntry = activeArchetype ? stageAmountsByArc[activeArchetype.id] : null

  // Seed a default stage-amounts entry the first time an archetype with
  // stages is picked. Mirrors LCA Architect's per-archetype default
  // (preset='1year', lifetime=15, all stages = 1).
  useEffect(() => {
    if (!activeArchetype) return
    if ((activeArchetype.stages?.length ?? 0) === 0) return
    if (stageAmountsByArc[activeArchetype.id]) return
    setStageAmountsForArc(activeArchetype.id, defaultStageAmounts(activeArchetype))
  }, [activeArchetype, stageAmountsByArc, setStageAmountsForArc])

  useEffect(() => {
    if (archetypes.length === 0) fetchArchetypes()
  }, [archetypes.length, fetchArchetypes])

  // Mirror archetype selection into the cross-panel store. The store's
  // setter clears both static and projected results when the id changes,
  // which prevents the Comparison panel from reading mismatched slots.
  useEffect(() => {
    setStoreArchetypeId(archetypeId)
  }, [archetypeId, setStoreArchetypeId])

  // Auto-pick the first archetype with no validation errors when none is
  // selected and the list lands. Avoids an empty-state flash on first paint.
  useEffect(() => {
    if (archetypeId == null && archetypes.length > 0) {
      const firstClean = archetypes.find((a) => (a.validation_error_rows ?? 0) === 0)
      if (firstClean) setArchetypeId(firstClean.id)
    }
  }, [archetypeId, archetypes])

  // Natural-flow layout — sections stack vertically and the page itself
  // scrolls. The bounded-height-with-internal-scrolling pattern was tried
  // and reverted because section-level scrolling fragments LCA result
  // review (long-form sequential reading, not dashboard at-a-glance).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Patch 4AG.3 — Single item / Multi-item comparison sub-toggle.
          Top-of-page sub-mode within the Single-product subtree. The
          page-level Single-product vs System toggle lives in
          `ImpactAssessment.tsx`; this sub-toggle further partitions
          the Single-product space into one-archetype (existing
          three-tab UX) vs N-item comparison. State is preserved
          across switches via visibility-toggle (display: none) so
          the user's selections / results don't reset. */}
      <div
        data-testid="single-product-mode-toggle"
        style={{
          display: 'inline-flex', alignSelf: 'flex-start',
          padding: 2,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          gap: 2,
        }}
      >
        {([
          { value: 'single', label: 'Single item' },
          { value: 'multi', label: 'Multi-item comparison' },
        ] as const).map((m) => (
          <button
            key={m.value}
            data-testid={`single-product-mode-${m.value}`}
            onClick={() => setViewMode(m.value)}
            style={{
              padding: '4px 12px', height: 26,
              background: viewMode === m.value
                ? 'var(--bg-surface)'
                : 'transparent',
              border: '1px solid ' + (viewMode === m.value ? 'var(--mod-lca)' : 'transparent'),
              borderRadius: 'var(--radius-sm)',
              color: viewMode === m.value ? 'var(--mod-lca)' : 'var(--text-secondary)',
              fontWeight: viewMode === m.value ? 600 : 500,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Multi-item subtree — mounted always; visibility toggled by
          viewMode. Patch 4AG.3 — preserving state across switches
          means the user can flip back and forth without losing
          their selections / results. */}
      <div
        data-testid="single-product-multi-pane"
        style={{ display: viewMode === 'multi' ? 'block' : 'none' }}
      >
        <MultiProductLCA onNavigate={onNavigate} />
      </div>

      {/* Single-item subtree — the existing UX, also mounted always
          via visibility-toggle. */}
      <div
        data-testid="single-product-single-pane"
        style={{ display: viewMode === 'single' ? 'block' : 'none' }}
      >
      <div
        data-testid="single-product-archetype-row"
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
          Archetype
        </span>
        <ArchetypeSelect
          archetypes={archetypes}
          selectedId={archetypeId}
          onChange={setArchetypeId}
          accentColor="var(--mod-lca)"
        />
        {archetypeId == null && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Pick a product to compute its impact.
          </span>
        )}
      </div>

      {/*
        Stage Amounts is wrapper-level so it's shared across all three tabs
        (Static / Projected / Comparison). Default collapsed — most users
        keep Lifetime defaults; the editor is an advanced tweak. Stays
        mounted regardless of active tab; panels read the current store
        value at Calculate time and surface a stale-result warning when the
        result's echoed `stage_amounts` diverges from the current value.
      */}
      {/* Life cycle → the BOM already carries whole-life quantities, so there is
          no multiplier to apply and the control is hidden entirely. The note
          below is NOT optional: a user with an annual BOM notices the missing
          control HERE, not in Manager, and a hidden affordance with no
          explanation on the page where it is missing is the worst of both. */}
      {activeArchetype && lifeCycleBasis && (activeArchetype.stages?.length ?? 0) > 0 && (
        <div
          data-testid="single-product-stage-amounts-hidden-note"
          style={{
            marginTop: 'var(--space-4)', padding: '10px 12px',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-surface)',
            fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
          }}
        >
          <strong style={{ color: 'var(--text-primary)' }}>Stage amounts is hidden.</strong>{' '}
          This project&rsquo;s use phase basis is <strong>Life cycle</strong>, so the BOM
          already contains whole-life quantities and no multiplier applies.{' '}
          <button
            type="button"
            data-testid="single-product-stage-amounts-hidden-link"
            onClick={() => onNavigate?.('archetypes')}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: 'var(--mod-lca)', fontSize: 'inherit', textDecoration: 'underline',
            }}
          >
            Change it in LCA Architect → Manager
          </button>
          {' '}if your BOM holds annual quantities instead.
        </div>
      )}

      {activeArchetype && !lifeCycleBasis && stageAmountsEntry && (activeArchetype.stages?.length ?? 0) > 0 && (
        // Vertical gap from the Archetype card above (Patch 5U). The single-pane
        // is a plain block container (no flex gap), so spacing is a scale-token
        // marginTop on the lower element — same token + mechanism as the
        // tab-nav → content gap below (var(--space-4), Patch 5K rhythm).
        <div data-testid="single-product-stage-amounts" style={{ marginTop: 'var(--space-4)' }}>
          <CollapsibleCard
            title="Stage amounts"
            expanded={stageAmountsExpanded}
            onToggle={() => setStageAmountsExpanded((v) => !v)}
            summary={
              <span data-testid="single-product-stage-amounts-summary">
                {stageAmountsSummary(stageAmountsEntry)}
              </span>
            }
          >
            <StageAmountsEditor
              archetype={activeArchetype}
              value={stageAmountsEntry}
              onChange={(next) => setStageAmountsForArc(activeArchetype.id, next)}
              accent="var(--mod-lca)"
              onDeclareBasis={(stage, basis) => {
                const nodeId = activeArchetype.stage_ids?.[stage]
                if (nodeId) void setStageBasis(activeArchetype.id, nodeId, basis)
              }}
              parameters={lifetimeParams}
              projectBasis={projectBasis}
            />
          </CollapsibleCard>
        </div>
      )}

      <SingleProductTabBar active={activeTab} onChange={setActiveTab} />

      {/* Breathing room between the sub-tab nav row and the content cards so
          the navigation reads as distinct from the content below. Matches the
          System-level layout's tab→content gap (var(--space-4)). */}
      <div data-testid="single-product-tab-content" style={{ marginTop: 'var(--space-4)' }}>
        <div
          data-testid="single-product-tab-pane-static"
          style={{ display: activeTab === 'static' ? 'block' : 'none' }}
        >
          <SingleProductStaticPanel archetypeId={archetypeId} onNavigate={onNavigate} />
        </div>
        <div
          data-testid="single-product-tab-pane-projected"
          style={{ display: activeTab === 'projected' ? 'block' : 'none' }}
        >
          <SingleProductProjectedPanel archetypeId={archetypeId} />
        </div>
        <div
          data-testid="single-product-tab-pane-compare"
          style={{ display: activeTab === 'compare' ? 'block' : 'none' }}
        >
          <SingleProductComparisonPanel archetypeId={archetypeId} />
        </div>
      </div>
      </div>{/* /single-product-single-pane */}
    </div>
  )
}

function SingleProductTabBar({
  active, onChange,
}: { active: TabKey; onChange: (t: TabKey) => void }) {
  const tabs: { key: TabKey; label: string; sub: string; accent: string }[] = [
    { key: 'static', label: 'Static Background', sub: 'Base ecoinvent', accent: 'var(--mod-lca)' },
    { key: 'projected', label: 'Prospective Background', sub: 'Prospective DBs', accent: 'var(--mod-plca)' },
    { key: 'compare', label: 'Comparison', sub: 'Δ projected vs static', accent: 'var(--mod-dsm)' },
  ]
  return (
    <div style={{ display: 'flex', gap: 'var(--space-1)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
      {tabs.map((t) => {
        const isActive = active === t.key
        return (
          <button
            key={t.key}
            data-testid={`single-product-tab-${t.key}`}
            onClick={() => onChange(t.key)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? `2px solid ${t.accent}` : '2px solid transparent',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-sm)',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              marginBottom: -1,
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            }}
          >
            <span>{t.label}</span>
            <span style={{
              fontSize: 10, color: isActive ? t.accent : 'var(--text-tertiary)',
              fontWeight: 400, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
            }}>
              {t.sub}
            </span>
          </button>
        )
      })}
    </div>
  )
}
