import { useState } from 'react'
import { Calculator, FlaskConical, Database } from 'lucide-react'
import { LCACalculator } from './LCACalculator'
import { Archetypes } from './Archetypes'
import { LCAManager } from './LCAManager'
import { useBOMStore } from '../stores/bomStore'

type LCATab = 'manager' | 'archetypes' | 'calculator'

interface LCAPageProps {
  onNavigateToExplorer?: (activityKey: string) => void
}

export function LCAPage({ onNavigateToExplorer }: LCAPageProps) {
  const [tab, setTab] = useState<LCATab>('manager')
  const selectArchetype = useBOMStore((s) => s.selectArchetype)

  const handleOpenArchetype = (id: string) => {
    void selectArchetype(id)
    setTab('archetypes')
  }

  const tabBtn = (key: LCATab, label: string, icon: React.ReactNode) => {
    const active = tab === key
    return (
      <button
        key={key}
        onClick={() => setTab(key)}
        style={{
          padding: '0 var(--space-4)',
          height: 38,
          background: 'none',
          border: 'none',
          borderBottom: active ? '2px solid var(--mod-lca)' : '2px solid transparent',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
          fontWeight: active ? 600 : 500,
          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {icon}
        {label}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)', marginBottom: 'var(--space-4)', flexShrink: 0 }}>
        LCA Architect
      </h1>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', marginBottom: 'var(--space-4)', flexShrink: 0 }}>
        {tabBtn('manager', 'Manager', <Database size={14} />)}
        {tabBtn('archetypes', 'Archetypes', <FlaskConical size={14} />)}
        {tabBtn('calculator', 'Single-product LCA', <Calculator size={14} />)}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'manager' && <LCAManager onOpenArchetype={handleOpenArchetype} />}
        {tab === 'archetypes' && <Archetypes />}
        {tab === 'calculator' && <LCACalculator onNavigateToExplorer={onNavigateToExplorer} />}
      </div>
    </div>
  )
}
