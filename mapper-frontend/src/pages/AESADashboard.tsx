import { useEffect, useMemo, useState } from 'react'
import { Download, Pencil, Plus, Trash2, Activity, BarChart3, List, Radar as RadarIcon } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ConfigSidebar } from '../components/aesa/ConfigSidebar'
import { RadarView } from '../components/aesa/RadarView'
import { TimelineView } from '../components/aesa/TimelineView'
import { DetailTable } from '../components/aesa/DetailTable'
import { BoxPlotView } from '../components/aesa/BoxPlotView'
import { ZONE_COLOR, ZONE_LABEL } from '../components/aesa/zones'
import { useAESAStore } from '../stores/aesaStore'
import { useMFAStore } from '../stores/mfaStore'
import { useImpactStore } from '../stores/impactStore'
import { exportAESA, type AESAZone, type AESAConfiguration } from '../api/client'

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
    setActiveConfig, deleteConfig, resetDraftToDefaults,
  } = useAESAStore()
  const { activeSystem } = useMFAStore()
  const { staticResult, projectedResult } = useImpactStore()
  const activeImpact = draft?.impact_mode === 'projected' ? projectedResult : staticResult

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

  const handleExport = async () => {
    if (!result) return
    setExporting(true)
    try {
      // Use active saved config if present, otherwise synthesize from draft
      const cfg: AESAConfiguration | null = configurations.find((c) => c.id === activeConfigId) ?? (
        draft && activeSystem ? {
          id: 'draft',
          name: draft.name,
          mfa_system_id: activeSystem.id,
          impact_mode: draft.impact_mode,
          boundary_set_id: draft.boundary_set_id,
          multi_d: draft.multi_d,
          carbon_budget: draft.carbon_budget,
          method_mapping: draft.method_mapping,
          created_at: new Date().toISOString(),
        } : null
      )
      if (!cfg) return
      const sysName = (activeSystem?.name ?? 'system').replace(/[^\w.-]+/g, '_')
      await exportAESA(cfg, result, `${sysName}_aesa.xlsx`)
    } catch (e) {
      console.error('AESA export failed', e)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-4)' }}>
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
          {result && (
            <Button variant="secondary" onClick={handleExport} disabled={exporting}>
              <Download size={14} /> Export .xlsx
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => { setActiveConfig(null); resetDraftToDefaults() }}
            disabled={!activeSystem}
          >
            <Plus size={14} /> New configuration
          </Button>
        </div>
      </div>

      {/* Saved configurations chips */}
      {activeSystem && systemConfigs.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
          {systemConfigs.map((c) => {
            const active = c.id === activeConfigId
            return (
              <div
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 8px',
                  backgroundColor: active
                    ? 'color-mix(in srgb, var(--mod-aesa) 14%, transparent)'
                    : 'var(--bg-elevated)',
                  border: `1px solid ${active ? 'var(--mod-aesa)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-md)',
                  fontSize: 11,
                }}
              >
                <button
                  onClick={() => setActiveConfig(c.id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: active ? 600 : 500, fontSize: 11, padding: 0,
                  }}
                >
                  {c.name}
                </button>
                <button
                  onClick={() => setActiveConfig(c.id)}
                  style={iconBtn}
                  title="Edit in sidebar"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={() => { if (confirm(`Delete "${c.name}"?`)) void deleteConfig(c.id) }}
                  style={iconBtn}
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Body: sidebar + main */}
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        <ConfigSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
          {!activeSystem && (
            <EmptyState
              title="Select an MFA system"
              body="AESA is computed against the results of a Material Flow Analysis. Pick an active system on the MFA page first."
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

          {result && yearSummary && (
            <>
              {/* Summary zone cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) auto', gap: 10, flexShrink: 0 }}>
                <ZoneCard zone="safe" count={yearSummary.safe} total={yearSummary.total_assessed} />
                <ZoneCard zone="zone_of_uncertainty" count={yearSummary.zone_of_uncertainty} total={yearSummary.total_assessed} />
                <ZoneCard zone="high_risk" count={yearSummary.high_risk} total={yearSummary.total_assessed} />
                <YearSelector years={years} year={year!} onChange={setYear} lastRunAt={lastRunAt} />
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

              {/* Active view */}
              <section style={{
                flex: 1, minHeight: 0, overflow: 'auto',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4) var(--space-5)',
              }}>
                {view === 'radar'    && <RadarView results={result.results} />}
                {view === 'timeline' && <TimelineView results={result.results} carbonBudget={draft?.carbon_budget ?? null} />}
                {view === 'detail'   && <DetailTable results={result.results} />}
                {view === 'boxplot'  && <BoxPlotView result={result} />}
              </section>
            </>
          )}
        </main>
      </div>

      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
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

function YearSelector({ years, year, onChange, lastRunAt }: {
  years: number[]
  year: number
  onChange: (y: number) => void
  lastRunAt: string | null
}) {
  return (
    <div style={{
      padding: '10px 14px',
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      display: 'flex', flexDirection: 'column', gap: 4,
      minWidth: 160,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
      }}>
        Year
      </span>
      <select
        value={year}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          padding: '3px 6px', fontSize: 13, fontWeight: 600,
          color: 'var(--text-primary)',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      {lastRunAt && (
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          Last run: {new Date(lastRunAt).toLocaleTimeString()}
        </span>
      )}
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

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-tertiary)', display: 'flex', padding: 2,
}
