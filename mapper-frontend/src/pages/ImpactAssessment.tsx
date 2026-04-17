import { useState } from 'react'
import { ChevronDown, ChevronRight, Sliders } from 'lucide-react'
import { MFAImpactPanel } from '../components/mfa/MFAImpactPanel'
import { ProjectedImpactPanel } from '../components/impact/ProjectedImpactPanel'
import { ComparisonPanel } from '../components/impact/ComparisonPanel'
import { CohortMappingEditor } from '../components/impact/CohortMappingEditor'
import { useImpactStore } from '../stores/impactStore'
import { useMFAStore } from '../stores/mfaStore'

type TabKey = 'static' | 'projected' | 'compare'

export function ImpactAssessment() {
  const [activeTab, setActiveTab] = useState<TabKey>('static')
  const [mappingsOpen, setMappingsOpen] = useState(false)
  const { staticResult, projectedResult } = useImpactStore()
  const { activeSystem, cohortMappings } = useMFAStore()
  const canCompare = !!staticResult && !!projectedResult
  const mappingCount = Object.keys(cohortMappings).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexShrink: 0 }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>
          Impact Assessment
        </h1>
      </div>

      {activeSystem && (
        <div style={{ flexShrink: 0 }}>
          <button
            onClick={() => setMappingsOpen((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)', padding: '6px 10px',
              fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {mappingsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Sliders size={14} color="var(--mod-mfa)" />
            Cohort mappings ({mappingCount})
          </button>
          {mappingsOpen && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <CohortMappingEditor />
            </div>
          )}
        </div>
      )}

      <TabBar active={activeTab} onChange={setActiveTab} canCompare={canCompare} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {activeTab === 'static' && <MFAImpactPanel />}
        {activeTab === 'projected' && <ProjectedImpactPanel />}
        {activeTab === 'compare' && <ComparisonPanel />}
      </div>
    </div>
  )
}

function TabBar({
  active, onChange, canCompare,
}: { active: TabKey; onChange: (t: TabKey) => void; canCompare: boolean }) {
  const tabs: { key: TabKey; label: string; sub?: string; accent: string }[] = [
    { key: 'static', label: 'Static LCI', sub: 'One base ecoinvent', accent: 'var(--mod-lca)' },
    { key: 'projected', label: 'Projected LCI', sub: 'Year-matched prospective DBs', accent: 'var(--mod-plca)' },
    { key: 'compare', label: 'Comparison', sub: canCompare ? 'Δ static vs projected' : 'Run both first', accent: 'var(--mod-mfa)' },
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
