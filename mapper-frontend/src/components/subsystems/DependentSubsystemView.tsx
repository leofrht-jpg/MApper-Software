/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ChevronDown, Download, Link2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { useSubsystemStore } from '../../stores/subsystemStore'
import { useParameterStore } from '../../stores/parameterStore'
import { useDSMStore } from '../../stores/dsmStore'
import { exportSubsystemDSM } from '../../api/client'
import { buildExportFilename } from '../../utils/exportFilename'
import { DependencyRulesEditor } from './DependencyRulesEditor'
import { DependentStockCharts } from './DependentStockCharts'
import { InitialStockPanel } from './InitialStockPanel'
import { ManualFlowsPanel } from './ManualFlowsPanel'
import { MaterialFlowPanel } from '../flows/MaterialFlowPanel'
import { CohortMappingDialog } from '../dsm/CohortMappingDialog'

type SubMode = 'rules' | 'manual'

type DSMSubTab = 'dynamics' | 'materials'

type SectionKey =
  | 'initialStock' | 'dependencyRules' | 'manualInflows' | 'manualOutflows'
  | 'stockOverTime' | 'inflowsOutflows'

// All sections expanded by default. Chart sections only render once a compute
// result exists (so "collapsed if no compute" is satisfied by their absence),
// and appear expanded when they do.
const DEFAULT_COLLAPSED: Record<SectionKey, boolean> = {
  initialStock: false, dependencyRules: false, manualInflows: false,
  manualOutflows: false, stockOverTime: false, inflowsOutflows: false,
}

interface DependentSubsystemViewProps {
  subsystemId: string
  activeTab: DSMSubTab
  onTabChange: (tab: DSMSubTab) => void
}

export function DependentSubsystemView({ subsystemId, activeTab, onTabChange }: DependentSubsystemViewProps) {
  const subsystems = useSubsystemStore((s) => s.subsystems)
  const result = useSubsystemStore((s) => s.subsystemResults[subsystemId])
  const runCompute = useSubsystemStore((s) => s.runCompute)
  const loadResult = useSubsystemStore((s) => s.loadResult)
  const saveDependent = useSubsystemStore((s) => s.saveDependent)
  const isComputing = useSubsystemStore((s) => s.isComputing)
  const error = useSubsystemStore((s) => s.error)
  const activeParamSetId = useParameterStore((s) => s.activeSetId)
  const activeSystem = useDSMStore((s) => s.activeSystem)
  const [showCohortMapping, setShowCohortMapping] = useState(false)
  // Rules vs Manual mode. `pendingMode` drives the switch-warning dialog.
  const [pendingMode, setPendingMode] = useState<SubMode | null>(null)
  const [switching, setSwitching] = useState(false)
  // Export split-button (scope menu): Main system + subsystem / Subsystem only.
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const exportWrapRef = useRef<HTMLDivElement>(null)

  // Per-section collapse state (UI preference only, not persisted to backend).
  // Resets to defaults when switching to a different subsystem tab.
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(DEFAULT_COLLAPSED)
  useEffect(() => { setCollapsed(DEFAULT_COLLAPSED) }, [subsystemId])
  const toggleSection = (k: SectionKey) => setCollapsed((c) => ({ ...c, [k]: !c[k] }))

  // Close the export scope menu on outside click / Escape.
  useEffect(() => {
    if (!exportMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (exportWrapRef.current && !exportWrapRef.current.contains(e.target as Node)) setExportMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [exportMenuOpen])

  const sub = useMemo(() => subsystems.find((s) => s.id === subsystemId) ?? null, [subsystems, subsystemId])
  const mode: SubMode = sub?.mode ?? 'rules'

  // Per-cohort colour overrides for this subsystem's stock chart, keyed by the
  // BARE cohort key (matching the stock series keys). Read straight from the
  // reactive store `sub`, so a colour changed in the cohort-mapping modal
  // (saveDependent → store update) re-renders the chart with no manual refresh.
  const cohortColors = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [ck, m] of Object.entries(sub?.cohort_mappings ?? {})) {
      if (m?.color) out[ck] = m.color
    }
    return out
  }, [sub?.cohort_mappings])

  const hasDataInMode = (m: SubMode): boolean => {
    if (!sub) return false
    return m === 'rules'
      ? sub.dependency_rules.length > 0
      : Object.keys(sub.manual_inflows ?? {}).length > 0 ||
        Object.keys(sub.manual_outflows ?? {}).length > 0
  }

  const applyMode = async (m: SubMode) => {
    if (!sub) return
    setSwitching(true)
    try {
      await saveDependent({ ...sub, mode: m })
    } finally {
      setSwitching(false)
    }
  }

  const requestMode = (m: SubMode) => {
    if (!sub || m === mode) return
    // Warn only if the CURRENT mode has data that will be deactivated.
    if (hasDataInMode(mode)) setPendingMode(m)
    else applyMode(m)
  }

  useEffect(() => {
    if (!result) loadResult(subsystemId).catch(() => undefined)
  }, [subsystemId, result, loadResult])

  if (!sub) {
    return <div style={{ padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>Subsystem not found.</div>
  }

  const nonAgeDims = sub.dimensions.filter((d) => !d.is_age)

  // Primary system id/name for the export (subsystem depends_on == system_id).
  const primarySystemId = sub.depends_on ?? activeSystem?.id ?? ''
  const primaryName = activeSystem?.name ?? 'system'
  const handleExport = async (scope: 'combined' | 'subsystem') => {
    setExportMenuOpen(false)
    if (!result || !primarySystemId) return
    setIsExporting(true)
    try {
      // Fallback only — the server Content-Disposition (preferred) carries the
      // canonical scheme; scope (b) makes the subsystem the subject.
      const fallback = scope === 'combined'
        ? buildExportFilename(primaryName, [sub.name], 'DSM')
        : buildExportFilename(sub.name, [], 'DSM')
      await exportSubsystemDSM(primarySystemId, subsystemId, scope, fallback)
    } catch (e) {
      console.error('Subsystem export failed', e)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Sub-tab bar — mirrors the primary system's dynamics / materials tabs. */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {([
          { key: 'dynamics' as const, label: 'System dynamics' },
          { key: 'materials' as const, label: 'Material flows' },
        ]).map((tab) => {
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              style={{
                padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 500,
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderBottom: active ? '2px solid var(--mod-dsm)' : '2px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'materials' ? (
        <MaterialFlowPanel scopeSubsystemId={subsystemId} scopeSubsystemName={sub.name} />
      ) : (
        <>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 'var(--space-4)', backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
          }}>
            <div>
              <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                {sub.name}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                {nonAgeDims.length} dimension{nonAgeDims.length === 1 ? '' : 's'} ·{' '}
                {sub.dependency_rules.length} rule{sub.dependency_rules.length === 1 ? '' : 's'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="ghost" onClick={() => setShowCohortMapping(true)}>
                <Link2 size={14} strokeWidth={1.5} /> Cohort mapping
              </Button>
              <Button
                variant="primary"
                onClick={() => runCompute(subsystemId, activeParamSetId).catch(() => undefined)}
                disabled={isComputing || !hasDataInMode(mode)}
                style={{ backgroundColor: 'var(--mod-dsm)' }}
                title={
                  !hasDataInMode(mode)
                    ? mode === 'rules' ? 'Add a dependency rule first' : 'Upload manual inflows first'
                    : 'Compute dependent stock'
                }
              >
                <Activity size={14} strokeWidth={1.5} /> {isComputing ? 'Computing…' : 'Compute'}
              </Button>

              {/* Export (result export) — secondary, with a scope menu. Disabled
                  until a compute result exists. */}
              <div ref={exportWrapRef} style={{ position: 'relative' }}>
                <Button
                  variant="secondary"
                  data-testid="subsystem-export"
                  onClick={() => setExportMenuOpen((v) => !v)}
                  disabled={!result || isExporting}
                  title={!result ? 'Compute the subsystem first' : 'Export subsystem results to Excel'}
                >
                  <Download size={14} strokeWidth={1.5} />
                  {isExporting ? 'Exporting…' : 'Export'}
                  <ChevronDown size={13} strokeWidth={1.5} />
                </Button>
                {exportMenuOpen && result && (
                  <div
                    data-testid="subsystem-export-menu"
                    role="menu"
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20,
                      minWidth: 210, padding: 4,
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-md)',
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}
                  >
                    {([
                      { scope: 'combined' as const, label: 'Main system + subsystem' },
                      { scope: 'subsystem' as const, label: 'Subsystem only' },
                    ]).map((it) => (
                      <button
                        key={it.scope}
                        role="menuitem"
                        data-testid={`subsystem-export-${it.scope}`}
                        onClick={() => void handleExport(it.scope)}
                        style={{
                          textAlign: 'left', padding: '7px 10px', cursor: 'pointer',
                          background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-elevated)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                      >
                        {it.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', color: 'var(--danger)',
            }}>
              {error}
            </div>
          )}

          {/* Mode selector — Dependency rules vs Manual inflows/outflows. */}
          <div data-testid="subsystem-mode-toggle" style={{ display: 'inline-flex', gap: 2, padding: 3, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', alignSelf: 'flex-start' }}>
            {([
              { key: 'rules' as const, label: 'Dependency rules' },
              { key: 'manual' as const, label: 'Manual inflows/outflows' },
            ]).map((opt) => {
              const active = mode === opt.key
              return (
                <button
                  key={opt.key}
                  onClick={() => requestMode(opt.key)}
                  disabled={switching}
                  data-testid={`subsystem-mode-${opt.key}`}
                  style={{
                    padding: '6px 14px', border: 'none', cursor: switching ? 'default' : 'pointer',
                    borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 500,
                    backgroundColor: active ? 'var(--mod-dsm)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>

          {/* Visibility-toggle (bodies stay mounted) — not conditional unmount. */}
          <div data-testid="subsystem-rules-body" style={{ display: mode === 'rules' ? 'flex' : 'none', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <InitialStockPanel
              subsystem={sub}
              collapsed={collapsed.initialStock}
              onToggleCollapse={() => toggleSection('initialStock')}
            />
            <DependencyRulesEditor
              subsystem={sub}
              collapsed={collapsed.dependencyRules}
              onToggleCollapse={() => toggleSection('dependencyRules')}
            />
          </div>
          <div data-testid="subsystem-manual-body" style={{ display: mode === 'manual' ? 'block' : 'none' }}>
            <ManualFlowsPanel
              subsystem={sub}
              collapsedInflows={collapsed.manualInflows}
              collapsedOutflows={collapsed.manualOutflows}
              onToggleInflows={() => toggleSection('manualInflows')}
              onToggleOutflows={() => toggleSection('manualOutflows')}
            />
          </div>

          {result && (
            <DependentStockCharts
              result={result}
              unitName={sub.unit_name}
              cohortColors={cohortColors}
              collapsedStock={collapsed.stockOverTime}
              collapsedFlows={collapsed.inflowsOutflows}
              onToggleStock={() => toggleSection('stockOverTime')}
              onToggleFlows={() => toggleSection('inflowsOutflows')}
            />
          )}
        </>
      )}

      {showCohortMapping && (
        <CohortMappingDialog
          subsystemId={subsystemId}
          onClose={() => setShowCohortMapping(false)}
        />
      )}

      {pendingMode && (
        <div
          data-testid="subsystem-mode-switch-warning"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            backgroundColor: 'color-mix(in srgb, black 55%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
          }}
          onClick={() => setPendingMode(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', maxWidth: 460,
              display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
            }}
          >
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
              Switch to {pendingMode === 'manual' ? 'manual inflows/outflows' : 'dependency rules'}?
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Switching to {pendingMode === 'manual' ? 'manual mode' : 'dependency-rules mode'} will
              deactivate your {mode === 'rules' ? 'dependency rules' : 'manual flows'}. They will be
              <strong> preserved but not used</strong> in the simulation. Switch anyway?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setPendingMode(null)}>Cancel</Button>
              <Button
                variant="primary"
                data-testid="subsystem-mode-switch-confirm"
                onClick={() => { const m = pendingMode; setPendingMode(null); if (m) applyMode(m) }}
                style={{ backgroundColor: 'var(--mod-dsm)' }}
              >
                Switch
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
