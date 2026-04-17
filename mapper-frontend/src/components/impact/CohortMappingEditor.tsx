import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Download, Loader2, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { useMFAStore, type CohortMappingValue } from '../../stores/mfaStore'
import { useBOMStore } from '../../stores/bomStore'
import {
  downloadCohortMappingsTemplate,
  uploadCohortMappings,
  type DimensionDef,
} from '../../api/client'

const COHORT_SEP = '|'

// Size-based scale defaults. Values approximate kerb-weight ratios vs a
// ~1,200 kg compact reference (ICCT/IEA).
const SIZE_SCALES: Array<[string, number]> = [
  ['small', 1.00],
  ['sedan', 1.30],
  ['medium', 1.30],
  ['suv', 1.55],
  ['large', 1.55],
  ['truck', 1.8],
]

function scaleFromCohortKey(ck: string): number {
  const lower = ck.toLowerCase()
  for (const [token, scale] of SIZE_SCALES) {
    if (lower.includes(token)) return scale
  }
  return 1.0
}

function fuzzyScore(cohortKey: string, archetypeName: string): number {
  const an = archetypeName.toLowerCase()
  const tokens = cohortKey.toLowerCase().split(/[|\s_\-/]+/).filter((t) => t.length >= 2)
  if (tokens.length === 0) return 0
  let hits = 0
  for (const t of tokens) if (an.includes(t)) hits++
  return hits / tokens.length
}

function parseCohortKey(key: string, dims: DimensionDef[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  const parts = key.split(COHORT_SEP)
  return nads.map((_, i) => parts[i] ?? '')
}

function enumerateCohortKeys(dims: DimensionDef[]): string[] {
  const nads = dims.filter((d) => !d.is_age)
  if (nads.length === 0) return []
  const labelLists = nads.map((d) => d.labels)
  let out: string[][] = [[]]
  for (const labels of labelLists) {
    const next: string[][] = []
    for (const acc of out) for (const l of labels) next.push([...acc, l])
    out = next
  }
  return out.map((parts) => parts.join(COHORT_SEP))
}

export function CohortMappingEditor() {
  const { activeSystem, cohortMappings, saveCohortMappings, fetchCohortMappings } = useMFAStore()
  const { archetypes, fetchArchetypes } = useBOMStore()

  const [status, setStatus] = useState<{ kind: 'info' | 'success' | 'error'; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const autoSaveTimer = useRef<number | null>(null)
  const didAutoGen = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])
  useEffect(() => { if (activeSystem) fetchCohortMappings() }, [activeSystem?.id, fetchCohortMappings])

  const cohortKeys = useMemo(
    () => activeSystem ? enumerateCohortKeys(activeSystem.dimensions) : [],
    [activeSystem],
  )
  const nonAgeDims = useMemo(
    () => activeSystem?.dimensions.filter((d) => !d.is_age) ?? [],
    [activeSystem],
  )

  const archetypesWithIssues = useMemo(() => {
    const out = new Set<string>()
    for (const a of archetypes) if (a.unlinked_count > 0) out.add(a.id)
    return out
  }, [archetypes])

  // Auto-generate + persist defaults when the panel loads an MFA system that
  // has archetypes available but no mappings stored yet. Runs once per system.
  useEffect(() => {
    didAutoGen.current = false
  }, [activeSystem?.id])

  useEffect(() => {
    if (!activeSystem || didAutoGen.current) return
    if (archetypes.length === 0 || cohortKeys.length === 0) return
    if (Object.keys(cohortMappings).length > 0) { didAutoGen.current = true; return }
    didAutoGen.current = true
    const next: Record<string, CohortMappingValue> = {}
    for (const ck of cohortKeys) {
      let best: { id: string; score: number } | null = null
      for (const a of archetypes) {
        const score = fuzzyScore(ck, a.name)
        if (best === null || score > best.score) best = { id: a.id, score }
      }
      const arcId = best && best.score > 0 ? best.id : archetypes[0].id
      next[ck] = { archetype_id: arcId, scaling_factor: scaleFromCohortKey(ck) }
    }
    void (async () => {
      try {
        await saveCohortMappings(next)
        setStatus({ kind: 'info', msg: `Auto-generated ${Object.keys(next).length} mappings` })
        window.setTimeout(() => setStatus(null), 2500)
      } catch (e) {
        setStatus({ kind: 'error', msg: `Auto-save failed: ${e instanceof Error ? e.message : String(e)}` })
      }
    })()
  }, [activeSystem?.id, archetypes, cohortKeys, cohortMappings, saveCohortMappings])

  const mappedCount = Object.values(cohortMappings).filter((v) => v?.archetype_id).length

  // Debounced auto-save on any edit — replaces the explicit Save button.
  const scheduleSave = (next: Record<string, CohortMappingValue>) => {
    if (autoSaveTimer.current != null) window.clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = window.setTimeout(async () => {
      try {
        await saveCohortMappings(next)
        setStatus({ kind: 'success', msg: 'Saved ✓' })
        window.setTimeout(() => setStatus(null), 1200)
      } catch (e) {
        setStatus({ kind: 'error', msg: `Save failed: ${e instanceof Error ? e.message : String(e)}` })
      }
    }, 400)
  }

  const updateMapping = (ck: string, patch: Partial<CohortMappingValue> | null) => {
    const next = { ...cohortMappings }
    if (patch === null) delete next[ck]
    else next[ck] = { archetype_id: patch.archetype_id ?? next[ck]?.archetype_id ?? '', scaling_factor: patch.scaling_factor ?? next[ck]?.scaling_factor ?? 1.0 }
    scheduleSave(next)
  }

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleFile = async (file: File) => {
    if (!activeSystem) return
    setBusy(true)
    try {
      const res = await uploadCohortMappings(activeSystem.id, file)
      await fetchCohortMappings()
      const warnings: string[] = []
      if (res.invalid_archetypes.length > 0) warnings.push(`${res.invalid_archetypes.length} unknown archetype(s): ${res.invalid_archetypes.slice(0, 3).join(', ')}${res.invalid_archetypes.length > 3 ? '…' : ''}`)
      if (res.invalid_cohorts.length > 0) warnings.push(`${res.invalid_cohorts.length} invalid cohort(s)`)
      if (res.unmapped_cohorts.length > 0) warnings.push(`${res.unmapped_cohorts.length} cohort(s) still unmapped`)
      const msg = warnings.length ? `${res.mapped_cohorts} imported · ${warnings.join(' · ')}` : `${res.mapped_cohorts} cohort mappings imported`
      setStatus({ kind: warnings.length ? 'info' : 'success', msg })
    } catch (e) {
      setStatus({ kind: 'error', msg: `Upload failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      window.setTimeout(() => setStatus(null), 4000)
    }
  }

  const handleDownloadTemplate = async () => {
    if (!activeSystem) return
    const safe = activeSystem.name.replace(/\s+/g, '_')
    try {
      await downloadCohortMappingsTemplate(activeSystem.id, `${safe}_cohort_mappings_template.xlsx`)
    } catch (e) {
      setStatus({ kind: 'error', msg: `Template download failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  if (!activeSystem) return null

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
            Cohort mappings ({mappedCount})
          </h4>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {mappedCount} of {cohortKeys.length} cohorts mapped. Edits auto-save.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {status && <span style={{ fontSize: 'var(--text-xs)', color: statusColor }}>{status.msg}</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xlsm,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <Button variant="ghost" size="sm" onClick={handleUploadClick} disabled={busy} title="Upload cohort mappings from xlsx or csv">
            {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
            Upload
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownloadTemplate} title="Download a blank template with all cohort combinations">
            <Download size={14} /> Template
          </Button>
        </div>
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
                {nonAgeDims.map((d) => (
                  <th key={d.name} style={th}>{d.display_name || d.name}</th>
                ))}
                <th style={th}>Archetype</th>
                <th style={{ ...th, textAlign: 'right' }}>Scale</th>
              </tr>
            </thead>
            <tbody>
              {cohortKeys.map((ck) => {
                const parts = parseCohortKey(ck, activeSystem.dimensions)
                const current = cohortMappings[ck]
                const archetypeId = current?.archetype_id ?? ''
                const scalingFactor = current?.scaling_factor ?? 1.0
                const issue = archetypeId && archetypesWithIssues.has(archetypeId)
                return (
                  <tr key={ck} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {nonAgeDims.map((d, i) => (
                      <td key={d.name} style={{ padding: '6px 10px' }}>
                        <Badge label={parts[i] ?? ''} variant="mfa" />
                      </td>
                    ))}
                    <td style={{ padding: '6px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                          value={archetypeId}
                          onChange={(e) => {
                            const nextId = e.target.value
                            if (!nextId) updateMapping(ck, null)
                            else updateMapping(ck, { archetype_id: nextId, scaling_factor: scalingFactor || scaleFromCohortKey(ck) })
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
                          updateMapping(ck, { archetype_id: archetypeId, scaling_factor: safe })
                        }}
                        title="Multiplier applied to every material quantity for this cohort. Defaults: Small ≈ 1.00 (~1,200 kg compact), Sedan ≈ 1.30 (~1,560 kg mid-size), SUV ≈ 1.55 (~1,860 kg crossover)."
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
