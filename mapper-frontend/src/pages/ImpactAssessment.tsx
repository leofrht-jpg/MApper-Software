/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useState } from 'react'
import { Library, GitBranch } from 'lucide-react'
import { DSMImpactPanel } from '../components/dsm/DSMImpactPanel'
import { ProjectedImpactPanel } from '../components/impact/ProjectedImpactPanel'
import { ComparisonPanel } from '../components/impact/ComparisonPanel'
import { MethodLibrary } from '../components/impact/MethodLibrary'
import { SingleProductImpact } from '../components/impact/SingleProductImpact'
import { Button } from '../components/ui/Button'
import { useImpactStore } from '../stores/impactStore'
import { useDSMStore } from '../stores/dsmStore'

type TabKey = 'static' | 'projected' | 'compare'
type ModeKey = 'system' | 'single_product'

interface ImpactAssessmentProps {
  onNavigate?: (id: string) => void
}

export function ImpactAssessment({ onNavigate }: ImpactAssessmentProps = {}) {
  const [mode, setMode] = useState<ModeKey>('single_product')
  const [activeTab, setActiveTab] = useState<TabKey>('static')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const { staticResult, projectedResult, projectedMultiResult } = useImpactStore()
  const isMultiProjected = !!projectedMultiResult && projectedMultiResult.scenarios.length > 1
  const canCompare = !!staticResult && !!projectedResult && !isMultiProjected
  // System-level assessment runs on the SELECTED DSM's fleet — so the gate is
  // an ACTIVE/selected DSM (Patch 5AC), NOT mere DSM existence: a DSM that
  // exists but isn't selected still has no fleet to assess. Show the helper when
  // no DSM is active; once one is selected the assessment panels render (they
  // own the run flow — `simulationResult` is their slot, so we don't gate on
  // it). `hasAnyDSM` only switches the copy ("select and run" vs "create and
  // run") — both CTAs go to the DSM tab.
  const hasActiveDSM = useDSMStore((s) => s.activeSystem != null)
  const hasAnyDSM = useDSMStore((s) => s.systems.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexShrink: 0 }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>
          Impact Assessment
        </h1>
        {/* Secondary/outline variant: evidently clickable but visually
            subordinate to the filled "Calculate" CTA — two filled buttons
            would compete. The primitive's `gap` handles icon+label spacing. */}
        <Button type="button" variant="secondary" data-testid="method-library-button" onClick={() => setLibraryOpen(true)}>
          <Library size={14} />
          Method Library
        </Button>
      </div>
      {libraryOpen && <MethodLibrary onClose={() => setLibraryOpen(false)} />}

      <ModeToggle mode={mode} onChange={setMode} />

      {/*
        Mode-level visibility-toggle: BOTH the system-mode subtree and the
        single-product subtree stay mounted across mode switches so each side
        keeps its own selection state (active tab, scope, methods, year range,
        DSM scenario picks, archetype id, detail year, etc.). Switching
        modes via conditional mount would silently kill those selections —
        same rationale as the per-tab visibility-toggle below. See CLAUDE.md
        → UI conventions → "Tab-based panels in Impact Assessment".
      */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          data-testid="impact-mode-pane-system"
          style={{
            display: mode === 'system' ? 'flex' : 'none',
            flexDirection: 'column', flex: 1, minHeight: 0, gap: 'var(--space-4)',
          }}
        >
          {!hasActiveDSM ? (
            <DSMRequiredHelper hasAnyDSM={hasAnyDSM} onNavigate={onNavigate} />
          ) : (
            <>
          <TabBar active={activeTab} onChange={setActiveTab} canCompare={canCompare} />
          {/*
            Visibility-toggle, NOT conditional mount. All three panels stay mounted
            across tab switches so each panel's `useState` (scope, methods, years,
            DSM-scenario picks, detailYear, expanded flags, etc.) survives without
            needing every selection lifted into a global store. Switching to
            conditional `{activeTab === 'X' && <Panel />}` would silently kill
            every local selection.
          */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <div
              data-testid="impact-tab-pane-static"
              style={{ display: activeTab === 'static' ? 'block' : 'none', height: '100%' }}
            >
              <DSMImpactPanel onNavigate={onNavigate} />
            </div>
            <div
              data-testid="impact-tab-pane-projected"
              style={{ display: activeTab === 'projected' ? 'block' : 'none', height: '100%' }}
            >
              <ProjectedImpactPanel />
            </div>
            <div
              data-testid="impact-tab-pane-compare"
              style={{ display: activeTab === 'compare' ? 'block' : 'none', height: '100%' }}
            >
              {canCompare && <ComparisonPanel />}
            </div>
          </div>
            </>
          )}
        </div>

        <div
          data-testid="impact-mode-pane-single-product"
          style={{
            display: mode === 'single_product' ? 'flex' : 'none',
            flexDirection: 'column', flex: 1, minHeight: 0,
          }}
        >
          <SingleProductImpact />
        </div>
      </div>
    </div>
  )
}

// System-level assessment requires a DSM result (the fleet to assess). When the
// project has no DSM, this guidance empty-state replaces the sub-tab content and
// points the user at the Dynamic Stock Modeller. Yields to the assessment
// panels once a DSM exists (gated on dsmStore.systems in the parent).
function DSMRequiredHelper({ hasAnyDSM, onNavigate }: { hasAnyDSM: boolean; onNavigate?: (id: string) => void }) {
  // Gated on no ACTIVE DSM. When DSMs exist (just none selected) the user only
  // needs to "select and run"; with none at all they need to "create and run".
  const verb = hasAnyDSM ? 'Select' : 'Create'
  return (
    <div
      data-testid="system-assessment-dsm-required"
      style={{
        flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', gap: 'var(--space-3)', padding: 'var(--space-6)',
        color: 'var(--text-secondary)',
      }}
    >
      <div style={{ color: 'var(--mod-dsm)', display: 'flex' }}>
        <GitBranch size={32} strokeWidth={1.5} />
      </div>
      <div data-testid="system-assessment-dsm-required-heading" style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
        {verb} and run a Dynamic Stock Model
      </div>
      <div style={{ fontSize: 'var(--text-sm)', maxWidth: 460, lineHeight: 1.5 }}>
        System-level assessment runs on a Dynamic Stock Model.<br />
        {verb} a DSM and run it, then come back here to assess it.
      </div>
      <Button
        type="button"
        variant="primary"
        data-testid="system-assessment-goto-dsm"
        onClick={() => onNavigate?.('dsm')}
      >
        <GitBranch size={14} />
        Go to Dynamic Stock Modeller
      </Button>
    </div>
  )
}

function ModeToggle({ mode, onChange }: { mode: ModeKey; onChange: (m: ModeKey) => void }) {
  const opts: { key: ModeKey; label: string }[] = [
    { key: 'single_product', label: 'Single-product assessment' },
    { key: 'system', label: 'System-level assessment' },
  ]
  return (
    <div
      data-testid="impact-mode-toggle"
      role="radiogroup"
      aria-label="Impact assessment mode"
      style={{
        display: 'inline-flex', gap: 4, padding: 4, alignSelf: 'flex-start',
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        flexShrink: 0,
      }}
    >
      {opts.map((o) => {
        const isActive = mode === o.key
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            data-testid={`impact-mode-${o.key}`}
            onClick={() => onChange(o.key)}
            style={{
              border: 'none',
              background: isActive ? 'var(--bg-surface)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              boxShadow: isActive ? 'var(--shadow-xs)' : 'none',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              fontWeight: isActive ? 600 : 500,
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function TabBar({
  active, onChange, canCompare,
}: { active: TabKey; onChange: (t: TabKey) => void; canCompare: boolean }) {
  const tabs: { key: TabKey; label: string; sub?: string; accent: string }[] = [
    { key: 'static', label: 'Static Background', sub: 'One base ecoinvent', accent: 'var(--mod-lca)' },
    { key: 'projected', label: 'Prospective Background', sub: 'Year-matched prospective DBs', accent: 'var(--mod-plca)' },
    { key: 'compare', label: 'Comparison', sub: canCompare ? 'Δ static vs projected' : 'Run both first', accent: 'var(--mod-dsm)' },
  ]
  return (
    <div style={{ display: 'flex', gap: 'var(--space-1)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
      {tabs.map((t) => {
        const isActive = active === t.key
        const disabled = t.key === 'compare' && !canCompare
        return (
          <button
            key={t.key}
            onClick={() => !disabled && onChange(t.key)}
            disabled={disabled}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? `2px solid ${t.accent}` : '2px solid transparent',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-sm)',
              fontWeight: isActive ? 600 : 500,
              color: disabled ? 'var(--text-tertiary)' : isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              marginBottom: -1,
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            }}
          >
            <span>{t.label}</span>
            {t.sub && (
              <span style={{ fontSize: 10, color: isActive ? t.accent : 'var(--text-tertiary)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                {t.sub}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
