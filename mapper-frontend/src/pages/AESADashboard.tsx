import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ChevronDown, Download, Save, Activity, BarChart3, List, Radar as RadarIcon } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ConfigSidebar } from '../components/aesa/ConfigSidebar'
import { ConfigurationsDropdown } from '../components/aesa/ConfigurationsDropdown'
import { RadarView } from '../components/aesa/RadarView'
import { TimelineView } from '../components/aesa/TimelineView'
import { DetailTable } from '../components/aesa/DetailTable'
import { BoxPlotView } from '../components/aesa/BoxPlotView'
import { IndicatorDisplayFilter } from '../components/aesa/IndicatorDisplayFilter'
import { YearSlider } from '../components/ui/YearSlider'
import { ZONE_COLOR, ZONE_LABEL } from '../components/aesa/zones'
import { useAESAStore } from '../stores/aesaStore'
import { useDSMStore } from '../stores/dsmStore'
import { useImpactStore } from '../stores/impactStore'
import { buildIndicatorColorMap } from '../utils/aesaIndicatorColors'
import {
  exportAESA,
  type AESAComputeResult,
  type AESAZone,
  type AESAConfiguration,
} from '../api/client'

type ViewId = 'radar' | 'timeline' | 'detail' | 'boxplot'

const VIEWS: { id: ViewId; label: string; icon: typeof RadarIcon }[] = [
  { id: 'radar',    label: 'Radar',    icon: RadarIcon },
  { id: 'timeline', label: 'Timeline', icon: Activity },
  { id: 'detail',   label: 'Detail',   icon: List },
  { id: 'boxplot',  label: 'Box Plot', icon: BarChart3 },
]

export function AESADashboard() {
  const {
    configurations, activeConfigId, draft, result, lastRunAt,
    setActiveConfig, deleteConfig, startNewConfig,
    activeSessionId, loadSessions, saveCurrentSession,
    clearActiveSession,
    displayedIndicators, toggleDisplayedIndicator,
    selectAllDisplayedIndicators, clearDisplayedIndicators,
  } = useAESAStore()
  const { activeSystem, systemState } = useDSMStore()
  const { staticResult, projectedResult } = useImpactStore()
  const activeImpact = draft?.impact_mode === 'projected' ? projectedResult : staticResult

  // Patch 4O — Compute Source summary line on the result header.
  // Names the cascade selections so users reading exported reports can
  // immediately see what was computed against. Resolution rules:
  //   - DSM model: activeSystem.name (current).
  //   - Scenario: draft.dsm_scenario_id resolved against systemState;
  //     falls back to "Active" when null (the cascade defers to
  //     whatever the system reports as active).
  //   - Background: draft.impact_mode → "Static Background" | "Prospective Background".
  //   - When `impact_mode === 'projected'` and the impact result
  //     carries an IAM / SSP scenario tag, append it (e.g.
  //     "REMIND/SSP2-PkBudg1150").
  const computeSourceSummary = useMemo(() => {
    if (!activeSystem || !draft) return null
    const sceneName = (() => {
      if (!systemState) return 'Active'
      const sid = draft.dsm_scenario_id ?? systemState.active_scenario_id
      if (!sid) return systemState.scenarios.find((s) => s.is_base)?.name ?? 'Base'
      return systemState.scenarios.find((s) => s.id === sid)?.name ?? 'Active'
    })()
    const bgLabel = draft.impact_mode === 'projected'
      ? 'Prospective Background'
      : 'Static Background'
    const projectedTag = (() => {
      if (draft.impact_mode !== 'projected' || !projectedResult) return ''
      const s = projectedResult.meta.scenario
      return s ? ` · ${s.iam.toUpperCase()}/${s.ssp}` : ''
    })()
    return `${activeSystem.name} · ${sceneName} · ${bgLabel}${projectedTag}`
  }, [activeSystem, systemState, draft, projectedResult])

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [view, setView] = useState<ViewId>('radar')
  const [year, setYear] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)

  const systemConfigs = useMemo(
    () => activeSystem ? configurations.filter((c) => c.mfa_system_id === activeSystem.id) : [],
    [configurations, activeSystem],
  )

  const years = useMemo(() => {
    if (!result) return []
    return result.summary_by_year.map((s) => s.year)
  }, [result])

  useEffect(() => {
    if (!years.length) { setYear(null); return }
    if (year === null || !years.includes(year)) setYear(years[years.length - 1])
  }, [years, year])

  const yearSummary = useMemo(() => {
    if (!result || year === null) return null
    return result.summary_by_year.find((s) => s.year === year) ?? null
  }, [result, year])

  // Patch 4T — display filter machinery. Operates on the indicator
  // dimension (`pb_id`); the filter is view-state only, never
  // re-fires compute. Three derived values:
  //   - `allIndicators`: the FULL ordered indicator list from the
  //     current result, deduplicated by pb_id. Used both as the
  //     filter UI's option list AND as the source of truth for the
  //     stable color map (so a 3-indicator subset shows the same
  //     hue for "climate change" as the full 16-indicator view).
  //   - `colorMap`: pb_id → hex, computed once from allIndicators
  //     and threaded into the filter component for swatch colors.
  //     Charts that consume per-indicator colors should also use
  //     this map (Patch 4T-friendly chart wiring is a follow-up;
  //     today only the filter UI consumes it).
  //   - `filteredResult`: shallow-cloned result with `results`,
  //     `summary_by_year`, and `sensitivity` subset to the
  //     displayed indicators. Empty filter (zero indicators) yields
  //     empty arrays; charts each emit their own empty state.
  const allIndicators = useMemo(() => {
    if (!result) return [] as Array<{ id: string; name: string }>
    const seen = new Set<string>()
    const out: Array<{ id: string; name: string }> = []
    for (const r of result.results) {
      if (seen.has(r.pb_id)) continue
      seen.add(r.pb_id)
      out.push({ id: r.pb_id, name: r.pb_name })
    }
    return out
  }, [result])

  const colorMap = useMemo(
    () => buildIndicatorColorMap(allIndicators.map((x) => x.id)),
    [allIndicators],
  )

  const effectiveDisplayed = useMemo<string[]>(
    () => displayedIndicators ?? allIndicators.map((x) => x.id),
    [displayedIndicators, allIndicators],
  )

  const filteredResult = useMemo<AESAComputeResult | null>(() => {
    if (!result) return null
    if (displayedIndicators === null) return result
    const allow = new Set(effectiveDisplayed)
    const filteredResults = result.results.filter((r) => allow.has(r.pb_id))
    let filteredSensitivity: AESAComputeResult['sensitivity'] = null
    if (result.sensitivity) {
      filteredSensitivity = {}
      for (const [k, arr] of Object.entries(result.sensitivity)) {
        filteredSensitivity[k as keyof typeof filteredSensitivity] = arr.filter((r) => allow.has(r.pb_id))
      }
    }
    type Summary = {
      year: number; safe: number; zone_of_uncertainty: number;
      high_risk: number; total_assessed: number;
    }
    const summaryMap = new Map<number, Summary>()
    for (const r of filteredResults) {
      const cur: Summary = summaryMap.get(r.year) ?? {
        year: r.year, safe: 0, zone_of_uncertainty: 0, high_risk: 0, total_assessed: 0,
      }
      cur.total_assessed += 1
      if (r.zone === 'safe') cur.safe += 1
      else if (r.zone === 'zone_of_uncertainty') cur.zone_of_uncertainty += 1
      else if (r.zone === 'high_risk') cur.high_risk += 1
      summaryMap.set(r.year, cur)
    }
    const filteredSummary = Array.from(summaryMap.values()).sort((a, b) => a.year - b.year)
    return {
      ...result,
      results: filteredResults,
      summary_by_year: filteredSummary,
      sensitivity: filteredSensitivity,
    }
  }, [result, displayedIndicators, effectiveDisplayed])

  const yearSummaryFiltered = useMemo(() => {
    if (!filteredResult || year === null) return null
    return filteredResult.summary_by_year.find((s) => s.year === year) ?? null
  }, [filteredResult, year])

  const exportAllIndicators = useRef(false)

  // Patch 4R — saved sessions. Modal state for save dialog;
  // sessions list loaded on mount (cheap — local file read,
  // no compute).
  useEffect(() => { void loadSessions() }, [loadSessions])
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveDefaultName, setSaveDefaultName] = useState('')

  // The active session id flips whenever the user loads a saved
  // session; clearing it returns the dashboard to live-cascade mode.
  // The result body, exports, and chart rendering all read from the
  // shared `result` slot — same components for live + saved data.
  const inSessionMode = activeSessionId !== null

  const buildDefaultSessionName = (): string => {
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const sys = activeSystem?.name ?? 'system'
    const sceneName = (() => {
      if (!systemState || !draft) return 'Active'
      const sid = draft.dsm_scenario_id ?? systemState.active_scenario_id
      if (!sid) return 'Base'
      return systemState.scenarios.find((s) => s.id === sid)?.name ?? 'Active'
    })()
    const bg = draft?.impact_mode === 'projected' ? 'Prospective' : 'Static'
    return `AESA · ${ts} · ${sys} · ${sceneName} · ${bg}`
  }

  const handleOpenSave = () => {
    setSaveDefaultName(buildDefaultSessionName())
    setSaveModalOpen(true)
  }

  const handleConfirmSave = async (name: string) => {
    const session = await saveCurrentSession(name)
    setSaveModalOpen(false)
    return session
  }

  const handleExport = async () => {
    if (!result) return
    setExporting(true)
    try {
      // Use active saved config if present, otherwise synthesize from draft
      const cfg: AESAConfiguration | null = configurations.find((c) => c.id === activeConfigId) ?? (
        draft && activeSystem?.id ? {
          id: 'draft',
          name: draft.name,
          mfa_system_id: activeSystem.id,
          impact_mode: draft.impact_mode,
          boundary_set_id: draft.boundary_set_id,
          sharing: draft.sharing,
          sharing_preset_id: draft.sharing_preset_id,
          carbon_budget: draft.carbon_budget,
          method_mapping: draft.method_mapping,
          created_at: new Date().toISOString(),
        } : null
      )
      if (!cfg) return
      const sysName = (activeSystem?.name ?? 'system').replace(/[^\w.-]+/g, '_')
      // Patch 4T — by default the export honours the active display
      // filter (mirrors what the user sees on screen). The "Export
      // all computed indicators" override sets `exportAllIndicators`
      // to true for one click, then resets — see the menu in the
      // header. Pass `null` to skip the subset path; an explicit
      // list narrows server-bound payload to the visible indicators.
      const filterIds = exportAllIndicators.current ? null : effectiveDisplayed
      exportAllIndicators.current = false
      await exportAESA(cfg, result, `${sysName}_aesa.xlsx`, filterIds)
    } catch (e) {
      console.error('AESA export failed', e)
    } finally {
      setExporting(false)
    }
  }

  // Patch 4V — page-level scroll. Don't constrain AESA's root to
  // `height: 100%` — chart content (especially Radar with N
  // indicators + axis labels) needs natural height. Shell's outer
  // `<main overflow: auto>` is the scroll container; let it handle
  // clipping. Mirrors the Single-product mode rule in CLAUDE.md.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Header toolbar */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 style={{
            fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)',
            letterSpacing: 'var(--tracking-tight)',
          }}>
            AESA
          </h1>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            Absolute Environmental Sustainability Assessment — Multi-D allocation on Sala 2020 EF-compatible Planetary Boundaries.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Patch 4R — saved-session affordances. Save appears whenever
              a result is on screen (live OR loaded) but the saved
              session captures whatever the result reflects today. In
              loaded-session mode the Compute button is replaced with a
              Return-to-live affordance; New configuration stays
              available so users can still start a new config from this
              view. */}
          {result && !inSessionMode && (
            // Patch 4Z — icon-only. Universally-recognizable floppy
            // icon + hover tooltip carries the affordance; the row
            // is less crowded. aria-label preserves accessibility
            // for screen readers. (Configurations dropdown stays
            // full-label because it surfaces state — the active
            // configuration name — that an icon can't convey.)
            <Button
              variant="secondary"
              onClick={handleOpenSave}
              data-testid="aesa-save-session"
              title="Save session"
              aria-label="Save session"
              style={{ padding: '0 10px' }}
            >
              <Save size={14} />
            </Button>
          )}
          {inSessionMode && (
            <Button
              variant="secondary"
              onClick={() => clearActiveSession()}
              data-testid="aesa-return-to-live"
              title="Discard the saved session view and return to the live cascade"
            >
              <ArrowLeft size={14} /> Return to live view
            </Button>
          )}
          {result && (
            <ExportSplit
              filtered={displayedIndicators !== null && effectiveDisplayed.length < allIndicators.length}
              visibleCount={effectiveDisplayed.length}
              totalCount={allIndicators.length}
              disabled={exporting}
              onExport={() => { void handleExport() }}
              onExportAll={() => {
                exportAllIndicators.current = true
                void handleExport()
              }}
            />
          )}
          {/* Saved configurations dropdown — Patch 4U scales to N
              configurations; Patch 4Y consolidated "+ New" into the
              menu itself (removed the separate page-header button) so
              all configuration management lives in one surface.
              First-config path remains the sidebar's Patch 4Q empty
              state (the dropdown is hidden when 0 configs exist). */}
          {activeSystem && systemConfigs.length > 0 && (
            <ConfigurationsDropdown
              configurations={systemConfigs}
              activeConfigId={activeConfigId}
              onSelect={(id) => setActiveConfig(id)}
              onDelete={(id) => void deleteConfig(id)}
              onNew={() => startNewConfig()}
              disabled={inSessionMode}
            />
          )}
        </div>
      </div>

      {/* Body: sidebar + main. `alignItems: flex-start` is what makes
          the sidebar's `position: sticky` actually stick — without it
          the flex container stretches the sidebar to content height
          (no room to scroll within). Inner `<main>` no longer needs
          `overflow: hidden`; chart-section content grows naturally
          and Shell's outer scroll container handles clipping. */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <ConfigSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!activeSystem && (
            <EmptyState
              title="Select an DSM system"
              body="AESA is computed against the results of a Material Flow Analysis. Pick an active system on the DSM page first."
            />
          )}

          {activeSystem && !activeImpact && (
            <EmptyState
              title={`Run the ${draft?.impact_mode === 'projected' ? 'Projected' : 'Static'} LCI first`}
              body="AESA needs LCIA results per EF v3.1 method. Go to Impact Assessment, run the selected LCI source, then return here. You can switch source in the sidebar."
            />
          )}

          {activeSystem && activeImpact && !result && (
            <EmptyState
              title="Configure and compute"
              body="Adjust the Multi-D allocation and carbon budget in the sidebar, then press Compute. Defaults work for a first run."
            />
          )}

          {result && filteredResult && yearSummary && (
            <>
              {/* Summary zone cards — driven by the FILTERED summary
                  so zone counts reflect what's actually on screen.
                  When the filter is empty (zero indicators), the
                  filtered yearSummary is null; we fall back to the
                  unfiltered counts to keep the cards stable, and
                  the chart pane below shows the empty state. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) auto', gap: 10, flexShrink: 0 }}>
                <ZoneCard zone="safe" count={(yearSummaryFiltered ?? yearSummary).safe} total={(yearSummaryFiltered ?? yearSummary).total_assessed} />
                <ZoneCard zone="zone_of_uncertainty" count={(yearSummaryFiltered ?? yearSummary).zone_of_uncertainty} total={(yearSummaryFiltered ?? yearSummary).total_assessed} />
                <ZoneCard zone="high_risk" count={(yearSummaryFiltered ?? yearSummary).high_risk} total={(yearSummaryFiltered ?? yearSummary).total_assessed} />
                <div style={{ minWidth: 280, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <YearSlider
                    years={years}
                    value={year!}
                    onChange={setYear}
                    accentColor="var(--mod-aesa)"
                    variant="card"
                    showDots={years.length <= 30}
                  />
                  {lastRunAt && (
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', paddingLeft: 'var(--space-5)' }}>
                      Last run: {new Date(lastRunAt).toLocaleTimeString()}
                    </span>
                  )}
                  {computeSourceSummary && (
                    <span
                      data-testid="aesa-compute-source-summary"
                      style={{
                        fontSize: 10, color: 'var(--text-tertiary)',
                        paddingLeft: 'var(--space-5)',
                        fontFamily: 'var(--font-mono)',
                      }}
                      title="Compute source: DSM model · scenario · background"
                    >
                      Source: {computeSourceSummary}
                    </span>
                  )}
                </div>
              </div>

              {result.missing_categories.length > 0 && (
                <div style={{
                  padding: '6px 10px', fontSize: 11,
                  color: 'var(--warning)',
                  backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  {result.missing_categories.length} method{result.missing_categories.length === 1 ? '' : 's'} unmapped: {result.missing_categories.slice(0, 3).join(', ')}{result.missing_categories.length > 3 ? '…' : ''}
                </div>
              )}

              {/* Patch 4T — display filter row. Sits above the view
                  selector so users see "what's currently displayed"
                  before picking how to view it. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                flexShrink: 0, flexWrap: 'wrap',
              }}>
                <IndicatorDisplayFilter
                  allIndicators={allIndicators}
                  displayed={displayedIndicators}
                  colorMap={colorMap}
                  onToggle={(id) => toggleDisplayedIndicator(id, allIndicators.map((x) => x.id))}
                  onSelectAll={() => selectAllDisplayedIndicators()}
                  onClearAll={() => clearDisplayedIndicators(allIndicators.map((x) => x.id))}
                />
                {displayedIndicators !== null && effectiveDisplayed.length < allIndicators.length && (
                  <span
                    data-testid="aesa-indicator-filter-status"
                    style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
                  >
                    Filtering — exports respect the filter unless you choose
                    &ldquo;Export all computed indicators&rdquo;.
                  </span>
                )}
              </div>

              {/* View selector */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {VIEWS.map((v) => {
                  const active = v.id === view
                  const Icon = v.icon
                  return (
                    <button
                      key={v.id}
                      onClick={() => setView(v.id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        background: active
                          ? 'color-mix(in srgb, var(--mod-aesa) 14%, transparent)'
                          : 'var(--bg-elevated)',
                        border: `1px solid ${active ? 'var(--mod-aesa)' : 'var(--border-subtle)'}`,
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon size={13} />
                      {v.label}
                    </button>
                  )
                })}
              </div>

              {/* Active view — natural height; page-level scroll
                  handles overflow. No `flex: 1, minHeight: 0,
                  overflow: auto` (those produced an internal scroll
                  container that clipped Radar labels at viewport
                  bottom — Patch 4V). */}
              <section style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4) var(--space-5)',
              }}>
                {filteredResult.results.length === 0 ? (
                  <EmptyFilterState
                    onSelectAll={() => selectAllDisplayedIndicators()}
                  />
                ) : (
                  <>
                    {view === 'radar'    && <RadarView results={filteredResult.results} />}
                    {view === 'timeline' && <TimelineView results={filteredResult.results} carbonBudget={draft?.carbon_budget ?? null} sharing={draft?.sharing ?? null} />}
                    {view === 'detail'   && <DetailTable results={filteredResult.results} />}
                    {view === 'boxplot'  && <BoxPlotView result={filteredResult} />}
                  </>
                )}
              </section>
            </>
          )}
        </main>
      </div>

      {/* Patch 4R — Save session modal. Mounted at page level so it
          overlays the entire AESA view when open. */}
      {saveModalOpen && (
        <SaveSessionModal
          defaultName={saveDefaultName}
          onCancel={() => setSaveModalOpen(false)}
          onConfirm={handleConfirmSave}
        />
      )}

      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Save session modal (Patch 4R) ──────────────────────────────────────────
function SaveSessionModal({
  defaultName, onCancel, onConfirm,
}: {
  defaultName: string
  onCancel: () => void
  onConfirm: (name: string) => Promise<unknown>
}) {
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)
  const trimmed = name.trim()
  const handleSave = async () => {
    if (!trimmed || saving) return
    setSaving(true)
    try { await onConfirm(trimmed) } finally { setSaving(false) }
  }
  // Patch 4X — portal to document.body for consistency with the
  // delete modal (which had to be portalled because its render parent
  // is a sticky-positioned sidebar with its own stacking context).
  // SaveSessionModal worked pre-Patch-4X by luck of placement at the
  // AESA page root; portalling makes the modal behaviour invariant
  // across future layout changes.
  return createPortal(
    <div
      data-testid="aesa-save-session-modal"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxWidth: 'calc(100% - 32px)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-5)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
          boxShadow: 'var(--shadow-lg, 0 12px 36px rgba(0,0,0,0.18))',
        }}
      >
        <div style={{
          fontSize: 'var(--text-base)', fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          Save AESA session
        </div>
        <div style={{
          fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}>
          Saves the current result + configuration snapshot. Reload it
          later from <strong>Saved sessions</strong> in the sidebar.
        </div>
        <input
          autoFocus
          data-testid="aesa-save-session-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSave()
            else if (e.key === 'Escape') onCancel()
          }}
          style={{
            width: '100%', padding: '8px 10px',
            background: 'var(--bg-base)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-sm)',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            data-testid="aesa-save-session-confirm"
            onClick={() => void handleSave()}
            disabled={!trimmed || saving}
          >
            <Save size={14} /> Save
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ZoneCard({ zone, count, total }: { zone: AESAZone; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  const color = ZONE_COLOR[zone]
  return (
    <div style={{
      padding: '10px 14px',
      backgroundColor: 'var(--bg-surface)',
      border: `1px solid ${color}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 'var(--radius-md)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 600, color,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
      }}>
        {ZONE_LABEL[zone]}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>
          {count}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          / {total} · {pct.toFixed(0)}%
        </span>
      </div>
      <div style={{
        position: 'relative',
        height: 4,
        background: 'var(--border-subtle)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 'var(--space-3)',
      border: '1px dashed var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-6)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: 460 }}>{body}</div>
    </div>
  )
}

// Patch 4T — split export button. Default click honours the active
// display filter; the caret menu offers "Export all computed
// indicators" as an explicit override (one-shot — resets after
// firing). When the filter is inactive (all indicators visible),
// both options produce the same file; the menu is still rendered
// so the affordance is discoverable and the menu copy reads as a
// no-op explainer.
function ExportSplit({
  filtered, visibleCount, totalCount, disabled, onExport, onExportAll,
}: {
  filtered: boolean
  visibleCount: number
  totalCount: number
  disabled: boolean
  onExport: () => void
  onExportAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <Button
        variant="secondary"
        onClick={() => { setOpen(false); onExport() }}
        disabled={disabled}
        data-testid="aesa-export-default"
        title={
          filtered
            ? `Export .xlsx — ${visibleCount} of ${totalCount} indicators (current filter)`
            : `Export .xlsx — all ${totalCount} indicators`
        }
        aria-label={
          filtered
            ? `Export filtered indicators as xlsx (${visibleCount} of ${totalCount})`
            : 'Export all indicators as xlsx'
        }
        style={{
          // Patch 4Z — icon-only with split-button geometry. The
          // caret sibling abuts the right edge, so this side only
          // rounds the LEFT corners; the caret rounds the right.
          padding: '0 10px',
          borderRadius: 'var(--radius-md) 0 0 var(--radius-md)',
        }}
      >
        <Download size={14} />
      </Button>
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        disabled={disabled}
        data-testid="aesa-export-menu-toggle"
        style={{
          marginLeft: -1,
          padding: '0 6px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: '0 var(--radius-md) var(--radius-md) 0',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
        }}
        title="Export options"
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          data-testid="aesa-export-menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20,
            minWidth: 240,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 4,
          }}
        >
          <button
            type="button"
            onClick={() => { setOpen(false); onExport() }}
            data-testid="aesa-export-filtered"
            style={menuItemStyle}
          >
            Export visible ({visibleCount}/{totalCount})
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onExportAll() }}
            data-testid="aesa-export-all"
            style={menuItemStyle}
          >
            Export all computed indicators ({totalCount})
          </button>
        </div>
      )}
    </div>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  color: 'var(--text-primary)',
  borderRadius: 'var(--radius-sm)',
}

// Patch 4T — empty-state when the user has cleared all indicators.
// Recoverable via Select all; the chart slot is otherwise blank to
// avoid rendering a misleading "no data" message that could be
// confused with a compute failure.
function EmptyFilterState({ onSelectAll }: { onSelectAll: () => void }) {
  return (
    <div
      data-testid="aesa-empty-filter-state"
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 'var(--space-3)',
        padding: 'var(--space-6)', textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
        No indicators displayed
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: 460 }}>
        Use the Indicators filter above to enable at least one indicator,
        or click below to show all computed indicators.
      </div>
      <Button variant="secondary" onClick={onSelectAll} data-testid="aesa-empty-filter-select-all">
        Select all indicators
      </Button>
    </div>
  )
}
