import { useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { CohortMappingEditor } from '../impact/CohortMappingEditor'
import {
  DependentCohortMappingsPanel,
  SubsystemMappingCard,
} from '../impact/DependentCohortMappingsPanel'
import { useSubsystemStore } from '../../stores/subsystemStore'
import { useBOMStore } from '../../stores/bomStore'
import { useDSMStore } from '../../stores/dsmStore'

interface CohortMappingDialogProps {
  onClose: () => void
  // When set, the dialog scopes to a single dependent subsystem's archetype
  // mappings. Otherwise it shows the primary cohort map plus every dependent.
  subsystemId?: string
}

export function CohortMappingDialog({ onClose, subsystemId }: CohortMappingDialogProps) {
  const activeSystem = useDSMStore((s) => s.activeSystem)
  const subsystems = useSubsystemStore((s) => s.subsystems)
  const fetchForSystem = useSubsystemStore((s) => s.fetchForSystem)
  const { archetypes, fetchArchetypes } = useBOMStore()

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])
  useEffect(() => {
    if (activeSystem?.id && subsystemId) fetchForSystem(activeSystem.id)
  }, [activeSystem?.id, subsystemId, fetchForSystem])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const scopedSubsystem = useMemo(
    () => (subsystemId ? subsystems.find((s) => s.id === subsystemId) ?? null : null),
    [subsystems, subsystemId],
  )

  const archetypesWithIssues = useMemo(
    () => new Set(archetypes.filter((a) => a.unlinked_count > 0).map((a) => a.id)),
    [archetypes],
  )

  const title = scopedSubsystem
    ? `Cohort mapping · ${scopedSubsystem.name}`
    : 'Cohort mapping'
  const subtitle = scopedSubsystem
    ? 'Map each dependent archetype to a BOM archetype. Used by Material Flows counter and Impact Assessment downstream.'
    : 'Map each DSM cohort (and dependent archetype, if any) to a BOM archetype. Used by Material Flows counter and Impact Assessment downstream.'

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        width: 880,
        maxWidth: '94vw',
        maxHeight: '92vh',
        overflow: 'auto',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{
          padding: 'var(--space-5) var(--space-6)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {title}
            </h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
              {subtitle}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', padding: 4, display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{
          padding: 'var(--space-6)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
        }}>
          {scopedSubsystem ? (
            <SubsystemMappingCard
              subsystem={scopedSubsystem}
              archetypesWithIssues={archetypesWithIssues}
            />
          ) : (
            <>
              <CohortMappingEditor />
              <DependentCohortMappingsPanel />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
