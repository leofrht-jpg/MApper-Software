import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '../ui/Button'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { useDSMStore } from '../../stores/dsmStore'
import { previewSurvival, type SurvivalConfig, type SurvivalPreviewPoint } from '../../api/client'

const labelCol: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  display: 'block',
  marginBottom: 6,
}

interface SurvivalConfiguratorProps {
  onClose: () => void
}

export function SurvivalConfigurator({ onClose }: SurvivalConfiguratorProps) {
  const activeSystem = useDSMStore((s) => s.activeSystem)
  const systemState = useDSMStore((s) => s.systemState)
  const setSurvival = useDSMStore((s) => s.setSurvival)

  const existing = systemState?.survival_configs.find((c) => Object.keys(c.dimension_filters).length === 0)
  const [shape, setShape] = useState<number>(existing?.weibull_shape ?? 4)
  const [scale, setScale] = useState<number>(existing?.weibull_scale ?? 15)
  const [preview, setPreview] = useState<SurvivalPreviewPoint[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const survivalChartRef = useRef<HTMLDivElement>(null)

  const maxAge = useMemo(
    () => (activeSystem ? activeSystem.time_horizon.end_year - activeSystem.time_horizon.start_year + 1 : 30),
    [activeSystem],
  )

  useEffect(() => {
    if (!activeSystem?.id) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      previewSurvival(activeSystem.id!, shape, scale, maxAge)
        .then(setPreview)
        .catch(() => undefined)
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [activeSystem, shape, scale, maxAge])

  const handleSave = async () => {
    if (!activeSystem) return
    setSaving(true)
    setError('')
    try {
      const cfg: SurvivalConfig = {
        dimension_filters: {},
        method: 'weibull',
        weibull_shape: shape,
        weibull_scale: scale,
      }
      await setSurvival([cfg])
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        width: 720,
        maxHeight: '92vh',
        overflow: 'auto',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Survival function</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
              Default Weibull applied to all cohorts. Per-cohort overrides arrive in Phase 2B.
            </p>
          </div>
        </div>

        <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>
            <SliderField label="Shape (k)" value={shape} min={1} max={10} step={0.1} onChange={setShape} hint="Higher k → tighter failure age" />
            <SliderField label="Scale (λ)" value={scale} min={5} max={30} step={0.5} onChange={setScale} hint="Characteristic lifetime in years" />
          </div>

          <div style={{ padding: 'var(--space-4)', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <ChartExportButton chartRef={survivalChartRef} filename={`dsm_survival_default_k${shape}_lambda${scale}`} />
            </div>
            <ChartExportContainer ref={survivalChartRef} style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={preview} margin={{ top: 8, right: 30, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="age" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} label={{ value: 'Age (years)', position: 'insideBottom', offset: -2, fill: 'var(--text-secondary)', fontSize: 11 }} />
                  <YAxis yAxisId="left" stroke="var(--text-tertiary)" domain={[0, 1]} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--text-tertiary)" domain={[0, 1]} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                    formatter={(v) => (typeof v === 'number' ? v.toFixed(3) : String(v))}
                  />
                  <Line yAxisId="left" type="monotone" dataKey="survival_rate" name="S(a)" stroke="var(--mod-dsm)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="hazard_rate" name="hazard" stroke="var(--mod-plca)" strokeWidth={1.5} dot={false} strokeDasharray="4 4" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartExportContainer>
          </div>

          {error && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving} style={{ backgroundColor: 'var(--mod-dsm)' }}>
              {saving ? 'Saving…' : 'Save survival settings'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface SliderFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}

function SliderField({ label, value, min, max, step, onChange, hint }: SliderFieldProps) {
  return (
    <div>
      <label style={labelCol}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--mod-dsm)' }}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: 70, height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', outline: 'none' }}
        />
      </div>
      {hint && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>{hint}</p>}
    </div>
  )
}
