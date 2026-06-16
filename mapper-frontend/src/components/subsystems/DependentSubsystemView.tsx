import { useEffect, useMemo, useState } from 'react'
import { Activity, Link2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { useSubsystemStore } from '../../stores/subsystemStore'
import { useParameterStore } from '../../stores/parameterStore'
import { DependencyRulesEditor } from './DependencyRulesEditor'
import { DependentStockCharts } from './DependentStockCharts'
import { InitialStockPanel } from './InitialStockPanel'
import { MaterialFlowPanel } from '../flows/MaterialFlowPanel'
import { CohortMappingDialog } from '../dsm/CohortMappingDialog'

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
  const isComputing = useSubsystemStore((s) => s.isComputing)
  const error = useSubsystemStore((s) => s.error)
  const activeParamSetId = useParameterStore((s) => s.activeSetId)
  const [showCohortMapping, setShowCohortMapping] = useState(false)

  const sub = useMemo(() => subsystems.find((s) => s.id === subsystemId) ?? null, [subsystems, subsystemId])

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
                disabled={isComputing || sub.dependency_rules.length === 0}
                style={{ backgroundColor: 'var(--mod-dsm)' }}
                title={sub.dependency_rules.length === 0 ? 'Add a dependency rule first' : 'Compute dependent stock'}
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

          <InitialStockPanel subsystem={sub} />

          <DependencyRulesEditor subsystem={sub} />

          {result && <DependentStockCharts result={result} unitName={sub.unit_name} />}
        </>
      )}

      {showCohortMapping && (
        <CohortMappingDialog
          subsystemId={subsystemId}
          onClose={() => setShowCohortMapping(false)}
        />
      )}
    </div>
  )
}
