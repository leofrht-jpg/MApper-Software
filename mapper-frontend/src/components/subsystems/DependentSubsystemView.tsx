/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useState } from 'react'
import { Activity, Link2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { useSubsystemStore } from '../../stores/subsystemStore'
import { useParameterStore } from '../../stores/parameterStore'
import { DependencyRulesEditor } from './DependencyRulesEditor'
import { DependentStockCharts } from './DependentStockCharts'
import { InitialStockPanel } from './InitialStockPanel'
import { ManualFlowsPanel } from './ManualFlowsPanel'
import { MaterialFlowPanel } from '../flows/MaterialFlowPanel'
import { CohortMappingDialog } from '../dsm/CohortMappingDialog'

type SubMode = 'rules' | 'manual'

type DSMSubTab = 'dynamics' | 'materials'

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
  const [showCohortMapping, setShowCohortMapping] = useState(false)
  // Rules vs Manual mode. `pendingMode` drives the switch-warning dialog.
  const [pendingMode, setPendingMode] = useState<SubMode | null>(null)
  const [switching, setSwitching] = useState(false)

  const sub = useMemo(() => subsystems.find((s) => s.id === subsystemId) ?? null, [subsystems, subsystemId])
  const mode: SubMode = sub?.mode ?? 'rules'

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
            <InitialStockPanel subsystem={sub} />
            <DependencyRulesEditor subsystem={sub} />
          </div>
          <div data-testid="subsystem-manual-body" style={{ display: mode === 'manual' ? 'block' : 'none' }}>
            <ManualFlowsPanel subsystem={sub} />
          </div>

          {result && <DependentStockCharts result={result} unitName={sub.unit_name} />}
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
