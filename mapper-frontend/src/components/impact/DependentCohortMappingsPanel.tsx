/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { useSubsystemStore } from '../../stores/subsystemStore'
import { useBOMStore } from '../../stores/bomStore'
import { useDSMStore } from '../../stores/dsmStore'
import type { Subsystem, SubsystemCohortMapping } from '../../api/client'

type SaveStatus = { kind: 'info' | 'success' | 'error'; msg: string } | null

export function DependentCohortMappingsPanel() {
  const activeSystem = useDSMStore((s) => s.activeSystem)
  const subsystems = useSubsystemStore((s) => s.subsystems)
  const fetchForSystem = useSubsystemStore((s) => s.fetchForSystem)
  const { archetypes, fetchArchetypes } = useBOMStore()

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])
  useEffect(() => {
    if (activeSystem?.id) fetchForSystem(activeSystem.id)
  }, [activeSystem?.id, fetchForSystem])

  const dependents = useMemo(
    () => subsystems.filter((s) => s.type === 'dependent' && s.dependency_rules.length > 0),
    [subsystems],
  )

  if (!activeSystem || dependents.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {dependents.map((sub) => (
        <SubsystemMappingCard key={sub.id} subsystem={sub} archetypesWithIssues={new Set(archetypes.filter((a) => a.unlinked_count > 0).map((a) => a.id))} />
      ))}
    </div>
  )
}

export function SubsystemMappingCard({
  subsystem, archetypesWithIssues,
}: { subsystem: Subsystem; archetypesWithIssues: Set<string> }) {
  const saveDependent = useSubsystemStore((s) => s.saveDependent)
  const { archetypes } = useBOMStore()
  const autoSaveTimer = useRef<number | null>(null)
  const [status, setStatus] = useState<SaveStatus>(null)
  const [local, setLocal] = useState<Record<string, SubsystemCohortMapping>>(
    subsystem.cohort_mappings ?? {},
  )

  // Re-sync local state when the subsystem identity or its stored mappings change.
  const lastKey = useRef<string>('')
  useEffect(() => {
    const key = JSON.stringify([subsystem.id, subsystem.cohort_mappings ?? {}])
    if (lastKey.current !== key) {
      setLocal(subsystem.cohort_mappings ?? {})
      lastKey.current = key
    }
  }, [subsystem.id, subsystem.cohort_mappings])

  const dependentArchetypes = useMemo(() => {
    const ids = new Set<string>()
    for (const r of subsystem.dependency_rules) {
      if (r.dependent_archetype_id) ids.add(r.dependent_archetype_id)
    }
    return [...ids].sort()
  }, [subsystem.dependency_rules])

  const mappedCount = dependentArchetypes.filter((a) => !!local[a]?.archetype_id).length

  const scheduleSave = (next: Record<string, SubsystemCohortMapping>) => {
    setLocal(next)
    if (autoSaveTimer.current != null) window.clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = window.setTimeout(async () => {
      try {
        await saveDependent({ ...subsystem, cohort_mappings: next })
        setStatus({ kind: 'success', msg: 'Saved ✓' })
        window.setTimeout(() => setStatus(null), 1200)
      } catch (e) {
        setStatus({ kind: 'error', msg: `Save failed: ${e instanceof Error ? e.message : String(e)}` })
      }
    }, 400)
  }

  const updateMapping = (archetypeKey: string, patch: Partial<SubsystemCohortMapping> | null) => {
    const next = { ...local }
    if (patch === null) delete next[archetypeKey]
    else next[archetypeKey] = {
      archetype_id: patch.archetype_id ?? next[archetypeKey]?.archetype_id ?? '',
      scaling_factor: patch.scaling_factor ?? next[archetypeKey]?.scaling_factor ?? 1.0,
    }
    scheduleSave(next)
  }

  const statusColor = status?.kind === 'error' ? 'var(--danger)' : status?.kind === 'success' ? 'var(--success)' : 'var(--text-secondary)'

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            {subsystem.name} mappings ({mappedCount})
          </h4>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {mappedCount} of {dependentArchetypes.length} archetypes mapped. Edits auto-save. Unmapped archetypes are excluded from Impact Assessment.
          </div>
        </div>
        {status && <span style={{ fontSize: 'var(--text-xs)', color: statusColor }}>{status.msg}</span>}
      </div>

      {archetypes.length === 0 ? (
        <div style={{
          padding: 12, fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)',
          textAlign: 'center', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
        }}>
          No archetypes defined. Create one in the LCA → Archetypes tab first.
        </div>
      ) : (
        <div style={{ overflow: 'auto', maxHeight: 320 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Dependent archetype</th>
                <th style={th}>BOM archetype</th>
                <th style={{ ...th, textAlign: 'right' }}>Scale</th>
              </tr>
            </thead>
            <tbody>
              {dependentArchetypes.map((key) => {
                const current = local[key]
                const archetypeId = current?.archetype_id ?? ''
                const scalingFactor = current?.scaling_factor ?? 1.0
                const issue = archetypeId && archetypesWithIssues.has(archetypeId)
                return (
                  <tr key={key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 10px' }}>
                      <Badge label={key} variant="dsm" />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                          value={archetypeId}
                          onChange={(e) => {
                            const nextId = e.target.value
                            if (!nextId) updateMapping(key, null)
                            else updateMapping(key, { archetype_id: nextId, scaling_factor: scalingFactor || 1.0 })
                          }}
                          style={selectSty}
                        >
                          <option value="">— unmapped —</option>
                          {archetypes.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}{a.unlinked_count > 0 ? ` (${a.unlinked_count} unlinked)` : ''}
                            </option>
                          ))}
                        </select>
                        {issue && (
                          <span title="This archetype has unlinked materials" style={{ color: 'var(--warning)', display: 'flex' }}>
                            <AlertCircle size={14} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                      <input
                        type="number" step={0.05} min={0.01}
                        value={archetypeId ? scalingFactor : ''}
                        disabled={!archetypeId}
                        placeholder="1.00"
                        onChange={(e) => {
                          const raw = e.target.value
                          const parsed = raw === '' ? 1.0 : Number(raw)
                          const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0
                          updateMapping(key, { archetype_id: archetypeId, scaling_factor: safe })
                        }}
                        title="Multiplier applied to every material quantity for this dependent archetype."
                        style={{
                          width: 72, height: 28, padding: '0 6px',
                          backgroundColor: archetypeId ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                          border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                          color: 'var(--text-primary)', fontSize: 'var(--text-sm)',
                          fontFamily: 'var(--font-mono)', textAlign: 'right', outline: 'none',
                          opacity: archetypeId ? 1 : 0.4,
                        }}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left',
  fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
  fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
  backgroundColor: 'var(--bg-elevated)', position: 'sticky', top: 0,
}

const selectSty: React.CSSProperties = {
  height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none', minWidth: 220,
}
