import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, Download, Loader2, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { DimensionColorPicker } from '../ui/DimensionColorPicker'
import { useDSMStore, type CohortMappingValue } from '../../stores/dsmStore'
import { useBOMStore } from '../../stores/bomStore'
import { useChartColors, colorFor, getOverriddenLabels, setLabelColor } from '../../utils/chartColors'
import { deriveDimColorsFromRowColors } from '../../utils/dsmCohortColors'
import { useProjectStore } from '../../stores/projectStore'
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
  const {
    activeSystem,
    cohortMappings,
    cohortRowColors,
    saveCohortMappings,
    fetchCohortMappings,
    setRowColor,
    clearRowColor,
  } = useDSMStore()
  const { archetypes, fetchArchetypes } = useBOMStore()
  const currentProject = useProjectStore((s) => s.currentProject)

  const [status, setStatus] = useState<{ kind: 'info' | 'success' | 'error'; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [tableExpanded, setTableExpanded] = useState(false)
  const autoSaveTimer = useRef<number | null>(null)
  const didAutoGen = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Patch 4AJ → 4AK — color picker state. Carries both dim + row
  // context so the picker's mode toggle has both layers' values.
  const [pickerOpen, setPickerOpen] = useState<{
    label: string
    cohortKey: string
    rect: DOMRect
    dimColor: string
    rowColor: string | null
    hasDimOverride: boolean
    hasRowOverride: boolean
  } | null>(null)

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

  // Patch 4AJ — every unique dim-value label across all non-age
  // dimensions. Feeding the full set into useChartColors means the
  // algorithm assigns each label deterministically once; user
  // overrides on individual labels persist within the same map.
  const allDimLabels = useMemo(() => {
    const out = new Set<string>()
    for (const d of nonAgeDims) for (const l of d.labels) out.add(l)
    return Array.from(out)
  }, [nonAgeDims])

  const colorMap = useChartColors(allDimLabels)

  // Patch 4AJ — Set of labels with explicit user overrides. Re-reads
  // on `colorMap` changes (which advance on every color event).
  const overrideSet = useMemo(
    () => getOverriddenLabels(currentProject),
    [currentProject, colorMap],
  )

  const archetypesWithIssues = useMemo(() => {
    const out = new Set<string>()
    for (const a of archetypes) if (a.unlinked_count > 0) out.add(a.id)
    return out
  }, [archetypes])

  // Auto-generate + persist defaults when the panel loads an DSM system that
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
    if (!activeSystem?.id) return
    setBusy(true)
    try {
      const res = await uploadCohortMappings(activeSystem.id, file)
      await fetchCohortMappings()
      // Patch 4AK² — derive per-dimension color overrides from the
      // freshly-uploaded row colors and write them to the per-dim
      // store (localStorage via setLabelColor). For each dim value
      // whose rows all share one color, set the dim override; rows
      // with mixed colors do NOT derive. One-way at upload only — the
      // in-app per-row picker continues to not auto-propagate.
      const fresh = useDSMStore.getState().cohortRowColors
      const derived = deriveDimColorsFromRowColors(
        fresh,
        activeSystem.dimensions,
      )
      let derivedCount = 0
      for (const [value, color] of Object.entries(derived)) {
        setLabelColor(value, color, currentProject)
        derivedCount++
      }
      const warnings: string[] = []
      if (res.invalid_archetypes.length > 0) warnings.push(`${res.invalid_archetypes.length} unknown archetype(s): ${res.invalid_archetypes.slice(0, 3).join(', ')}${res.invalid_archetypes.length > 3 ? '…' : ''}`)
      if (res.invalid_cohorts.length > 0) warnings.push(`${res.invalid_cohorts.length} invalid cohort(s)`)
      if (res.unmapped_cohorts.length > 0) warnings.push(`${res.unmapped_cohorts.length} cohort(s) still unmapped`)
      if (res.invalid_row_colors && res.invalid_row_colors.length > 0) warnings.push(`${res.invalid_row_colors.length} invalid color(s)`)
      const pieces = [`${res.mapped_cohorts} imported`]
      if (derivedCount > 0) pieces.push(`${derivedCount} dim color(s) derived`)
      if (warnings.length) pieces.push(...warnings)
      setStatus({ kind: warnings.length ? 'info' : 'success', msg: pieces.join(' · ') })
    } catch (e) {
      setStatus({ kind: 'error', msg: `Upload failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      window.setTimeout(() => setStatus(null), 4000)
    }
  }

  const handleDownloadTemplate = async () => {
    if (!activeSystem?.id) return
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
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexWrap: 'wrap',
          marginBottom: tableExpanded ? 'var(--space-3)' : 0,
        }}
      >
        <div
          onClick={() => setTableExpanded((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', flex: 1, minWidth: 0 }}
        >
          <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
            {tableExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Cohort mapping
          </h4>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            · {mappedCount} of {cohortKeys.length} mapped
          </span>
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
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleUploadClick() }} disabled={busy} title="Upload cohort mappings from xlsx or csv">
            {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
            Upload
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); void handleDownloadTemplate() }} title="Download a blank template with all cohort combinations">
            <Download size={14} /> Template
          </Button>
        </div>
      </div>

      {tableExpanded && (archetypes.length === 0 ? (
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
                    {nonAgeDims.map((d, i) => {
                      const dimLabel = parts[i] ?? ''
                      const dimColor = colorFor(colorMap, dimLabel, i)
                      const rowColor = cohortRowColors[ck] ?? null
                      // Patch 4AK — row color (when set) wins for the
                      // pill's visible color across all pills in the
                      // row. Falls back to per-dim Patch 4AJ color when
                      // no row override exists.
                      const pillColor = rowColor ?? dimColor
                      return (
                        <td key={d.name} style={{ padding: '6px 10px' }}>
                          <button
                            type="button"
                            data-testid={`cohort-mapping-pill-${dimLabel}`}
                            data-cohort-key={ck}
                            onClick={(e) => {
                              if (!dimLabel) return
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setPickerOpen({
                                label: dimLabel,
                                cohortKey: ck,
                                rect,
                                dimColor,
                                rowColor,
                                hasDimOverride: overrideSet.has(dimLabel),
                                hasRowOverride: rowColor != null,
                              })
                            }}
                            title={dimLabel ? `Click to change color for this row or for all ${dimLabel}` : undefined}
                            style={{
                              background: 'none', border: 'none', padding: 0,
                              cursor: dimLabel ? 'pointer' : 'default',
                            }}
                          >
                            <Badge label={dimLabel} customColor={dimLabel ? pillColor : undefined} />
                          </button>
                        </td>
                      )
                    })}
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
      ))}

      {pickerOpen && (
        <DimensionColorPicker
          label={pickerOpen.label}
          cohortKey={pickerOpen.cohortKey}
          currentDimColor={pickerOpen.dimColor}
          currentRowColor={pickerOpen.rowColor}
          anchorRect={pickerOpen.rect}
          hasDimOverride={pickerOpen.hasDimOverride}
          hasRowOverride={pickerOpen.hasRowOverride}
          scope={currentProject}
          onSetRowColor={(ck, c) => { void setRowColor(ck, c) }}
          onClearRowColor={(ck) => { void clearRowColor(ck) }}
          onClose={() => setPickerOpen(null)}
        />
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
