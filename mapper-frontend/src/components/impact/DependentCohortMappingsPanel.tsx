/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Download, Loader2, Upload } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useSubsystemStore } from '../../stores/subsystemStore'
import { useBOMStore } from '../../stores/bomStore'
import { useDSMStore } from '../../stores/dsmStore'
import {
  downloadSubsystemCohortMappingTemplate,
  importSubsystemCohortMapping,
  type DimensionDef,
  type Subsystem,
  type SubsystemCohortMapping,
} from '../../api/client'

type SaveStatus = { kind: 'info' | 'success' | 'error'; msg: string } | null

/** Cartesian product of non-age dimension labels, pipe-joined — the subsystem's
 *  full cohort-key space (matches the backend `all_cohort_keys`). */
function cohortKeysForDims(dims: DimensionDef[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  if (nads.length === 0) return []
  let acc: string[][] = [[]]
  for (const d of nads) {
    const next: string[][] = []
    for (const row of acc) for (const l of d.labels) next.push([...row, l])
    acc = next
  }
  return acc.map((parts) => parts.join('|'))
}

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
    // All dependent subsystems — rule-based OR manual (no rules). Manual
    // subsystems still need their cohorts mapped to BOM archetypes.
    () => subsystems.filter((s) => s.type === 'dependent'),
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
  const activeSystem = useDSMStore((s) => s.activeSystem)
  const autoSaveTimer = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<SaveStatus>(null)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  // Validated-but-not-yet-applied import → destructive-replace confirm dialog.
  const [pendingImport, setPendingImport] =
    useState<Record<string, SubsystemCohortMapping> | null>(null)
  const [local, setLocal] = useState<Record<string, SubsystemCohortMapping>>(
    subsystem.cohort_mappings ?? {},
  )

  // Parent system id — the endpoints are scoped to the primary system.
  const systemId = activeSystem?.id ?? subsystem.depends_on ?? ''

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
    // The subsystem's full cohort space, so cohorts are mappable regardless of
    // how stock is derived — from rules (rules mode) or from uploaded flows
    // (manual mode, where dependency_rules is empty). Union the declared
    // cartesian cohorts with any rule targets + already-saved mapping keys.
    const ids = new Set<string>(cohortKeysForDims(subsystem.dimensions))
    for (const r of subsystem.dependency_rules) {
      if (r.dependent_archetype_id) ids.add(r.dependent_archetype_id)
    }
    for (const k of Object.keys(subsystem.cohort_mappings ?? {})) ids.add(k)
    return [...ids].sort()
  }, [subsystem.dimensions, subsystem.dependency_rules, subsystem.cohort_mappings])

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

  const handleDownloadTemplate = async () => {
    if (!systemId) return
    setImportError('')
    try {
      await downloadSubsystemCohortMappingTemplate(systemId, subsystem.id, subsystem.name)
    } catch (e: unknown) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : 'Template download failed' })
    }
  }

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleFileSelected = async (file: File) => {
    if (!systemId) return
    setImportError('')
    setStatus(null)
    setImporting(true)
    try {
      const res = await importSubsystemCohortMapping(systemId, subsystem.id, file)
      if (res.ok) {
        // Valid → ask before the destructive replace.
        setPendingImport(res.mappings)
      } else {
        setImportError(
          'Import rejected — fix these rows and try again:\n' +
            res.errors.map((e) => `• Row ${e.row} (${e.field}): ${e.message}`).join('\n'),
        )
      }
    } catch (e: unknown) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : 'Import failed' })
    } finally {
      setImporting(false)
    }
  }

  const confirmImport = async () => {
    if (!pendingImport) return
    const imported = pendingImport
    setPendingImport(null)
    setLocal(imported)
    if (autoSaveTimer.current != null) window.clearTimeout(autoSaveTimer.current)
    try {
      await saveDependent({ ...subsystem, cohort_mappings: imported })
      setStatus({ kind: 'success', msg: `Imported ${Object.keys(imported).length} mappings ✓` })
      window.setTimeout(() => setStatus(null), 2000)
    } catch (e) {
      setStatus({ kind: 'error', msg: `Save failed: ${e instanceof Error ? e.message : String(e)}` })
    }
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {status && <span style={{ fontSize: 'var(--text-xs)', color: statusColor }}>{status.msg}</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            data-testid="subsystem-cohort-file-input"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFileSelected(f)
              e.target.value = '' // allow re-selecting the same file
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUploadClick}
            disabled={!systemId || importing}
            data-testid="subsystem-cohort-upload"
            title="Import cohort mappings from an xlsx file"
          >
            {importing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
            Upload
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownloadTemplate}
            disabled={!systemId}
            data-testid="subsystem-cohort-template"
            title="Download a template with this subsystem's cohort keys"
          >
            <Download size={14} /> Template
          </Button>
        </div>
      </div>

      {importError && (
        <div style={{
          padding: '8px 12px', marginBottom: 'var(--space-3)',
          backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)',
          borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)',
          color: 'var(--danger)', whiteSpace: 'pre-line',
        }}>
          {importError}
        </div>
      )}

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

      {pendingImport && (
        <div
          data-testid="subsystem-cohort-import-confirm"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            backgroundColor: 'color-mix(in srgb, black 55%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
          }}
          onClick={() => setPendingImport(null)}
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
              Import {Object.keys(pendingImport).length} mapping{Object.keys(pendingImport).length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              This will <strong>replace all current cohort mappings</strong> for{' '}
              <strong>{subsystem.name}</strong>. This action cannot be undone. Continue?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setPendingImport(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={confirmImport}
                data-testid="subsystem-cohort-import-replace"
                style={{ backgroundColor: 'var(--danger)' }}
              >
                Replace
              </Button>
            </div>
          </div>
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
