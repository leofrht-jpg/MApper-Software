/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

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
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { resolveSlot, useDSMStore } from '../../stores/dsmStore'
import {
  previewSurvival,
  type DSMMode,
  type ModeConfig,
  type SurvivalConfig,
  type SurvivalPreviewPoint,
} from '../../api/client'

interface ModeConfiguratorProps {
  onClose: () => void
}

type GlobalKind = 'manual' | 'survival'
type SurvivalSub = 'survival_inflow' | 'survival_stock'
type OverrideChoice = 'inherit' | DSMMode

const SUB_LABELS: Record<SurvivalSub, string> = {
  survival_inflow: 'Inflow-driven',
  survival_stock: 'Stock-driven',
}

const SUB_HINTS: Record<SurvivalSub, string> = {
  survival_inflow: 'Stock grows freely from inflows; outflow is natural Weibull retirement.',
  survival_stock: 'Solver back-computes inflow + forced retirement to hit an annual stock target.',
}

const MODE_LABELS: Record<DSMMode, string> = {
  manual: 'Manual',
  survival_inflow: 'Inflow-driven',
  survival_stock: 'Stock-driven',
}

const labelCol: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  display: 'block',
  marginBottom: 6,
}

export function ModeConfigurator({ onClose }: ModeConfiguratorProps) {
  const activeSystem = useDSMStore((s) => s.activeSystem)
  const systemState = useDSMStore((s) => s.systemState)
  const setModes = useDSMStore((s) => s.setModes)
  const setSurvival = useDSMStore((s) => s.setSurvival)

  const effectiveModeConfigs = useMemo(
    () => (resolveSlot(systemState, 'mode_configs') as ModeConfig[] | null) ?? [],
    [systemState],
  )

  const nonAgeDims = useMemo(
    () => (activeSystem?.dimensions ?? []).filter((d) => !d.is_age),
    [activeSystem],
  )

  // ── Global mode hydration ──
  const existingGlobalMode = useMemo<DSMMode>(() => {
    const global = effectiveModeConfigs.find(
      (c) => Object.keys(c.dimension_filters).length === 0,
    )
    return global?.mode ?? 'survival_inflow'
  }, [effectiveModeConfigs])

  const [globalKind, setGlobalKind] = useState<GlobalKind>(
    existingGlobalMode === 'manual' ? 'manual' : 'survival',
  )
  const [subMode, setSubMode] = useState<SurvivalSub>(
    existingGlobalMode === 'survival_stock' ? 'survival_stock' : 'survival_inflow',
  )

  const globalMode: DSMMode = globalKind === 'manual' ? 'manual' : subMode

  // ── Per-cohort overrides: pick one split dim, one mode per label ──
  const initialSplit = useMemo(() => {
    for (const cfg of effectiveModeConfigs) {
      const key = Object.keys(cfg.dimension_filters)[0]
      if (key) return key
    }
    return ''
  }, [effectiveModeConfigs])

  const [splitDim, setSplitDim] = useState<string>(initialSplit)

  const initialOverrides = useMemo(() => {
    const byLabel: Record<string, OverrideChoice> = {}
    const dim = nonAgeDims.find((d) => d.name === splitDim)
    if (!dim) return byLabel
    for (const label of dim.labels) {
      const match = effectiveModeConfigs.find(
        (c) => c.dimension_filters[splitDim] === label,
      )
      byLabel[label] = (match?.mode ?? 'inherit') as OverrideChoice
    }
    return byLabel
  }, [effectiveModeConfigs, nonAgeDims, splitDim])

  const [overrides, setOverrides] = useState<Record<string, OverrideChoice>>(initialOverrides)

  // Reset overrides when split dim changes.
  useEffect(() => {
    setOverrides(initialOverrides)
  }, [initialOverrides])

  // ── Survival function (global Weibull) ──
  const existingSurvival = (systemState?.survival_configs ?? []).find(
    (c) => Object.keys(c.dimension_filters).length === 0,
  )
  const [shape, setShape] = useState<number>(existingSurvival?.weibull_shape ?? 4)
  const [scale, setScale] = useState<number>(existingSurvival?.weibull_scale ?? 15)
  const [preview, setPreview] = useState<SurvivalPreviewPoint[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const survivalChartRef = useRef<HTMLDivElement>(null)

  const needsSurvival =
    globalKind === 'survival' ||
    Object.values(overrides).some((m) => m === 'survival_inflow' || m === 'survival_stock')

  const [survivalOpen, setSurvivalOpen] = useState<boolean>(needsSurvival)

  const maxAge = useMemo(
    () => (activeSystem ? activeSystem.time_horizon.end_year - activeSystem.time_horizon.start_year + 1 : 30),
    [activeSystem],
  )

  useEffect(() => {
    if (!activeSystem?.id || !needsSurvival) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      previewSurvival(activeSystem.id!, shape, scale, maxAge)
        .then(setPreview)
        .catch(() => undefined)
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [activeSystem, shape, scale, maxAge, needsSurvival])

  // ── Save ──
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!activeSystem) return
    setSaving(true)
    setError('')
    try {
      const modeConfigs: ModeConfig[] = [{ dimension_filters: {}, mode: globalMode }]
      if (splitDim) {
        for (const [label, choice] of Object.entries(overrides)) {
          if (choice === 'inherit') continue
          modeConfigs.push({
            dimension_filters: { [splitDim]: label },
            mode: choice,
          })
        }
      }
      await setModes(modeConfigs)

      if (needsSurvival) {
        const survival: SurvivalConfig = {
          dimension_filters: {},
          method: 'weibull',
          weibull_shape: shape,
          weibull_scale: scale,
        }
        await setSurvival([survival])
      }
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const activeDim = nonAgeDims.find((d) => d.name === splitDim)

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
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Simulation mode</h3>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
            Choose how the stock is driven: upload outflows directly (Manual) or let a survival
            function decide (Survival-based). Per-cohort overrides mix both within one system.
          </p>
        </div>

        <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* ── Global mode ── */}
          <div>
            <label style={labelCol}>Primary mode</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <ModeChoice
                selected={globalKind === 'manual'}
                onClick={() => setGlobalKind('manual')}
                title="Manual"
                hint="Upload stock, inflows, and outflows. Pure accounting — no survival function."
              />
              <ModeChoice
                selected={globalKind === 'survival'}
                onClick={() => setGlobalKind('survival')}
                title="Survival-based"
                hint="Weibull survival drives natural retirement; choose inflow- or stock-driven."
              />
            </div>
          </div>

          {globalKind === 'survival' && (
            <div>
              <label style={labelCol}>Survival sub-mode</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                {(['survival_inflow', 'survival_stock'] as SurvivalSub[]).map((m) => (
                  <ModeChoice
                    key={m}
                    selected={subMode === m}
                    onClick={() => setSubMode(m)}
                    title={SUB_LABELS[m]}
                    hint={SUB_HINTS[m]}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Survival function (collapsible) ── */}
          {needsSurvival && (
            <div style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-elevated)',
            }}>
              <button
                onClick={() => setSurvivalOpen((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontWeight: 600, textAlign: 'left',
                }}
              >
                {survivalOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Survival function (Weibull)
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 500, marginLeft: 8 }}>
                  k = {shape}, λ = {scale} yr
                </span>
              </button>
              {survivalOpen && (
                <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>
                    <SliderField label="Shape (k)" value={shape} min={1} max={10} step={0.1} onChange={setShape} hint="Higher k → tighter failure age" />
                    <SliderField label="Scale (λ)" value={scale} min={5} max={30} step={0.5} onChange={setScale} hint="Characteristic lifetime in years" />
                  </div>
                  <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                      <ChartExportButton
                        chartRef={survivalChartRef}
                        filename={`dsm_survival_preview_k${shape}_lambda${scale}`}
                      />
                    </div>
                    <ChartExportContainer ref={survivalChartRef} style={{ height: 200 }}>
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
                </div>
              )}
            </div>
          )}

          {/* ── Per-cohort overrides ── */}
          {nonAgeDims.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <label style={labelCol}>Per-cohort overrides</label>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  Pick one dimension to split on; override the mode for specific labels.
                </span>
              </div>
              <select
                value={splitDim}
                onChange={(e) => setSplitDim(e.target.value)}
                style={{ width: '100%', height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', marginBottom: 8 }}
              >
                <option value="">No override — all cohorts use primary mode</option>
                {nonAgeDims.map((d) => (
                  <option key={d.name} value={d.name}>{d.display_name || d.name}</option>
                ))}
              </select>

              {activeDim && activeDim.labels.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {activeDim.labels.map((label) => (
                    <OverrideRow
                      key={label}
                      label={label}
                      value={overrides[label] ?? 'inherit'}
                      globalMode={globalMode}
                      onChange={(v) => setOverrides((prev) => ({ ...prev, [label]: v }))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving} style={{ backgroundColor: 'var(--mod-dsm)' }}>
              {saving ? 'Saving…' : 'Apply'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModeChoice({
  selected, onClick, title, hint,
}: { selected: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: 'var(--space-3) var(--space-4)',
        border: `1px solid ${selected ? 'var(--mod-dsm)' : 'var(--border-default)'}`,
        backgroundColor: selected ? 'color-mix(in srgb, var(--mod-dsm) 15%, transparent)' : 'var(--bg-elevated)',
        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: selected ? 600 : 500 }}>{title}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{hint}</span>
    </button>
  )
}

function OverrideRow({
  label, value, globalMode, onChange,
}: {
  label: string
  value: OverrideChoice
  globalMode: DSMMode
  onChange: (v: OverrideChoice) => void
}) {
  const choices: OverrideChoice[] = ['inherit', 'manual', 'survival_inflow', 'survival_stock']
  return (
    <div style={{
      padding: 'var(--space-2) var(--space-3)',
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      display: 'grid',
      gridTemplateColumns: '120px 1fr',
      gap: 'var(--space-3)',
      alignItems: 'center',
    }}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {choices.map((c) => {
          const active = value === c
          const display =
            c === 'inherit'
              ? `Inherit (${MODE_LABELS[globalMode]})`
              : MODE_LABELS[c]
          return (
            <button
              key={c}
              onClick={() => onChange(c)}
              style={{
                padding: '4px 10px',
                border: `1px solid ${active ? 'var(--mod-dsm)' : 'var(--border-default)'}`,
                backgroundColor: active ? 'color-mix(in srgb, var(--mod-dsm) 15%, transparent)' : 'var(--bg-surface)',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 'var(--text-xs)',
                fontWeight: active ? 600 : 500,
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              {display}
            </button>
          )
        })}
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
