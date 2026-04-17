import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ConfigWizard } from '../components/aesa/ConfigWizard'
import { IndicatorCard } from '../components/aesa/IndicatorCard'
import { RadarChart } from '../components/aesa/RadarChart'
import { RatioTimeline } from '../components/aesa/RatioTimeline'
import { useAESAStore } from '../stores/aesaStore'
import { useMFAStore } from '../stores/mfaStore'
import { useImpactStore } from '../stores/impactStore'
import {
  type AESAConfiguration,
  exportAESA,
} from '../api/client'

const fmt = (n: number) => {
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1000 || a < 0.01) return n.toExponential(3)
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

export function AESADashboard() {
  const {
    configurations, activeConfigId, result, loading, assessing, error,
    loadConfigurations, setActiveConfig, deleteConfig, assess,
  } = useAESAStore()
  const { activeSystem } = useMFAStore()
  const { staticResult } = useImpactStore()

  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<AESAConfiguration | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { void loadConfigurations() }, [loadConfigurations])

  const activeConfig = useMemo(
    () => configurations.find((c) => c.id === activeConfigId) ?? null,
    [configurations, activeConfigId],
  )

  const systemConfigs = useMemo(
    () => activeSystem ? configurations.filter((c) => c.mfa_system_id === activeSystem.id) : [],
    [configurations, activeSystem],
  )

  const lastYear = result?.years[result.years.length - 1]

  const handleRun = async () => {
    if (!activeConfig) return
    const taskId = staticResult?.task_id
    const isMfaMirror = taskId?.startsWith('mfa-mirror-')
    await assess({
      configId: activeConfig.id,
      taskId: isMfaMirror ? null : taskId ?? null,
      inline: isMfaMirror ? staticResult : null,
    })
  }

  const handleExport = async () => {
    if (!activeConfig || !result) return
    setExporting(true)
    try {
      const sysName = (activeSystem?.name ?? 'system').replace(/[^\w.-]+/g, '_')
      await exportAESA(activeConfig.id, result, `${sysName}_aesa.xlsx`)
    } catch (e) {
      console.error('Export failed', e)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>
            AESA
          </h1>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            Absolute Environmental Sustainability — compare impacts to allocated planetary-boundary thresholds.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setWizardOpen(true) }} disabled={!activeSystem}>
          <Plus size={14} /> New configuration
        </Button>
      </div>

      {!activeSystem && (
        <EmptyState
          title="Select an MFA system"
          body="AESA configurations are per-system. Pick an active system on the MFA page first."
        />
      )}

      {activeSystem && !systemConfigs.length && !loading && (
        <EmptyState
          title="No AESA configurations yet"
          body="A configuration pins a sharing principle, method→boundary mapping, and allocated thresholds."
          action={<Button onClick={() => { setEditing(null); setWizardOpen(true) }}><Plus size={14} /> Create configuration</Button>}
        />
      )}

      {activeSystem && systemConfigs.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', flexShrink: 0 }}>
          {systemConfigs.map((c) => {
            const active = c.id === activeConfigId
            return (
              <div
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px',
                  backgroundColor: active ? 'color-mix(in srgb, var(--mod-aesa) 12%, transparent)' : 'var(--bg-elevated)',
                  border: `1px solid ${active ? 'var(--mod-aesa)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-xs)',
                }}
              >
                <button
                  onClick={() => setActiveConfig(c.id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: active ? 600 : 500, fontSize: 'var(--text-xs)',
                  }}
                >
                  {c.name}
                </button>
                <button
                  onClick={() => { setEditing(c); setWizardOpen(true) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 2 }}
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => { if (confirm(`Delete "${c.name}"?`)) void deleteConfig(c.id) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 2 }}
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {activeConfig && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
          <Button onClick={handleRun} disabled={assessing || !staticResult}>
            {assessing ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Run assessment
          </Button>
          {result && (
            <Button variant="secondary" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Export .xlsx
            </Button>
          )}
          {!staticResult && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Run an Impact Assessment (Static or Projected) first.
            </span>
          )}
        </div>
      )}

      {error && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--danger)', fontSize: 'var(--text-xs)',
        }}>
          {error}
        </div>
      )}

      {result && lastYear && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <SummaryHeader result={result} />

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(420px, 1fr) 1.2fr',
            gap: 'var(--space-5)',
            alignItems: 'start',
          }}>
            <Panel title={`Radar — ${lastYear.year}`}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <RadarChart indicators={lastYear.indicators} />
              </div>
            </Panel>

            <Panel title="Ratios over time">
              <RatioTimeline years={result.years} />
            </Panel>
          </div>

          <Panel title={`Indicators — ${lastYear.year}`}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 'var(--space-3)',
            }}>
              {lastYear.indicators.map((ind) => (
                <IndicatorCard key={ind.boundary_id} indicator={ind} trend={result.summary.trend} />
              ))}
            </div>
          </Panel>

          <Panel title="Detail (all years)">
            <DetailTable result={result} />
          </Panel>
        </div>
      )}

      {wizardOpen && (
        <ConfigWizard existing={editing} onClose={() => { setWizardOpen(false); setEditing(null) }} />
      )}

      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Layout helpers ───────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <h3 style={{
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-wide)',
        marginBottom: 'var(--space-3)',
      }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

function SummaryHeader({ result }: { result: import('../api/client').AESAResult }) {
  const s = result.summary
  const trendColor = s.trend === 'worsening' ? 'var(--danger)' : s.trend === 'improving' ? 'var(--success)' : 'var(--text-tertiary)'
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr) 1.4fr',
      gap: 'var(--space-3)',
    }}>
      <Stat label="Assessed" value={String(s.boundaries_assessed)} />
      <Stat label="Safe" value={String(s.boundaries_safe)} color="var(--success)" />
      <Stat label="Caution" value={String(s.boundaries_caution)} color="var(--warning)" />
      <Stat label="Exceeded" value={String(s.boundaries_exceeded)} color="var(--danger)" />
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3) var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          <span>Worst: <span style={{ color: 'var(--danger)' }}>{s.worst_indicator || '—'}</span></span>
          <span>Best: <span style={{ color: 'var(--success)' }}>{s.best_indicator || '—'}</span></span>
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Trend across all indicators: <span style={{ color: trendColor, fontWeight: 600 }}>{s.trend}</span>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>{label}</span>
      <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: color ?? 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>{value}</span>
    </div>
  )
}

function DetailTable({ result }: { result: import('../api/client').AESAResult }) {
  const rows = useMemo(() => {
    const out: Array<{
      year: number; boundary: string; method: string; impact: number;
      threshold: number; ratio: number; status: string; unit: string;
    }> = []
    for (const y of result.years) {
      for (const i of y.indicators) {
        out.push({
          year: y.year, boundary: i.boundary_name, method: i.method_label,
          impact: i.impact_value, threshold: i.threshold_value,
          ratio: i.ratio, status: i.status, unit: i.unit,
        })
      }
    }
    return out
  }, [result])

  const statusColor = (s: string) =>
    s === 'exceeded' ? 'var(--danger)' :
    s === 'caution' ? 'var(--warning)' : 'var(--success)'

  return (
    <div style={{ overflow: 'auto', maxHeight: 320 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
            {['Year', 'Boundary', 'Method', 'Impact', 'Threshold', 'Ratio', 'Status', 'Unit'].map((h) => (
              <th key={h} style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ color: 'var(--text-primary)' }}>
              <td style={td}>{r.year}</td>
              <td style={td}>{r.boundary}</td>
              <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.method}</td>
              <td style={{ ...td, textAlign: 'right' }}>{fmt(r.impact)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{fmt(r.threshold)}</td>
              <td style={{ ...td, textAlign: 'right', color: statusColor(r.status), fontWeight: 600 }}>{r.ratio.toFixed(3)}</td>
              <td style={{ ...td, color: statusColor(r.status), textTransform: 'uppercase', fontSize: 10 }}>{r.status}</td>
              <td style={{ ...td, color: 'var(--text-tertiary)' }}>{r.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)' }

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
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
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: 420 }}>{body}</div>
      {action}
    </div>
  )
}
