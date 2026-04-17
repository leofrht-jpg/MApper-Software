import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  type AESAConfiguration,
  type AESAConfigurationCreate,
  type AESAMethodSuggestion,
  type BoundaryAllocation,
  type MethodBoundaryMapping,
  type MFALCAResult,
  type PlanetaryBoundary,
  type SharingPrinciple,
  getBoundaries,
  getMethodSuggestions,
  getSharingPrinciples,
} from '../../api/client'
import { useAESAStore } from '../../stores/aesaStore'
import { useMFAStore } from '../../stores/mfaStore'

interface ConfigWizardProps {
  existing?: AESAConfiguration | null
  onClose: () => void
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 12px',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
}

type StepKey = 'basics' | 'sharing' | 'mapping' | 'thresholds'
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'basics', label: 'Basics' },
  { key: 'sharing', label: 'Sharing Principle' },
  { key: 'mapping', label: 'Method → Boundary' },
  { key: 'thresholds', label: 'Thresholds' },
]

export function ConfigWizard({ existing, onClose }: ConfigWizardProps) {
  const { activeSystem, mfaLCAResults } = useMFAStore()
  const { createConfig, updateConfig } = useAESAStore()

  const [step, setStep] = useState<StepKey>('basics')
  const [boundaries, setBoundaries] = useState<PlanetaryBoundary[]>([])
  const [principles, setPrinciples] = useState<SharingPrinciple[]>([])
  const [suggestions, setSuggestions] = useState<AESAMethodSuggestion[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState(existing?.name ?? '')
  const [impactMode, setImpactMode] = useState<string>(existing?.impact_mode ?? 'static')
  const [sharingPrincipleId, setSharingPrincipleId] = useState<string>(existing?.sharing_principle_id ?? 'per_capita')
  const [sharingParams, setSharingParams] = useState<Record<string, unknown>>(existing?.sharing_params ?? { system_population: 5_900_000, world_population: 8_000_000_000 })
  const [mapping, setMapping] = useState<MethodBoundaryMapping[]>(existing?.method_mapping ?? [])
  const [thresholds, setThresholds] = useState<BoundaryAllocation[]>(existing?.custom_thresholds ?? [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    void (async () => {
      try {
        const [b, p] = await Promise.all([getBoundaries(), getSharingPrinciples()])
        setBoundaries(b)
        setPrinciples(p)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load reference data')
      }
    })()
  }, [])

  // When entering the mapping step, fetch suggestions for all methods from the
  // current MFA×LCA results (if any).
  useEffect(() => {
    if (step !== 'mapping' || !mfaLCAResults.length || suggestions.length) return
    void (async () => {
      try {
        const sugg = await getMethodSuggestions(mfaLCAResults.map((r) => r.method))
        setSuggestions(sugg)
        // Seed mapping with high-score suggestions if user hasn't picked yet.
        if (!existing && !mapping.length) {
          const seeded: MethodBoundaryMapping[] = sugg
            .filter((s) => s.boundary_id && s.match_score > 0)
            .map((s) => ({ method_tuple: s.method_tuple, boundary_id: s.boundary_id as string, conversion_factor: 1.0 }))
          if (seeded.length) setMapping(seeded)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load suggestions')
      }
    })()
  }, [step, mfaLCAResults, existing, mapping.length, suggestions.length])

  // Seed thresholds list from mapped boundaries (one entry per unique boundary).
  useEffect(() => {
    if (step !== 'thresholds') return
    const mappedIds = Array.from(new Set(mapping.map((m) => m.boundary_id)))
    setThresholds((prev) => {
      const byId = new Map(prev.map((t) => [t.boundary_id, t]))
      const unitByBoundary = firstUnitByBoundary(mfaLCAResults, mapping)
      return mappedIds.map((bid) => {
        const existing = byId.get(bid)
        if (existing) return existing
        return {
          boundary_id: bid,
          sharing_principle_id: sharingPrincipleId,
          allocated_threshold: 0,
          allocated_unit: unitByBoundary[bid] ?? '',
          year: null,
          notes: null,
        }
      })
    })
  }, [step, mapping, mfaLCAResults, sharingPrincipleId])

  const canSave = useMemo(() => {
    if (!name.trim() || !activeSystem) return false
    if (!mapping.length) return false
    if (thresholds.some((t) => !t.allocated_threshold || t.allocated_threshold <= 0)) return false
    return true
  }, [name, activeSystem, mapping, thresholds])

  const goNext = () => {
    const idx = STEPS.findIndex((s) => s.key === step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key)
  }
  const goBack = () => {
    const idx = STEPS.findIndex((s) => s.key === step)
    if (idx > 0) setStep(STEPS[idx - 1].key)
  }

  const handleSave = async () => {
    if (!activeSystem) { setError('No active MFA system'); return }
    setError('')
    setSubmitting(true)
    try {
      const body: AESAConfigurationCreate = {
        name: name.trim(),
        mfa_system_id: activeSystem.id ?? '',
        impact_mode: impactMode,
        sharing_principle_id: sharingPrincipleId,
        sharing_params: sharingParams,
        method_mapping: mapping.map((m) => ({ ...m, conversion_factor: m.conversion_factor ?? 1.0 })),
        custom_thresholds: thresholds,
      }
      if (existing) {
        await updateConfig(existing.id, body)
      } else {
        await createConfig(body)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSubmitting(false)
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
        width: 760,
        maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
        animation: 'modalIn var(--duration-normal) var(--ease-out)',
      }}>
        <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}`}</style>

        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {existing ? 'Edit AESA configuration' : 'New AESA configuration'}
            </h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              {activeSystem ? `System: ${activeSystem.name}` : 'No active MFA system selected'}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 'var(--radius-sm)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        <Stepper step={step} />

        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-6)' }}>
          {step === 'basics' && (
            <BasicsStep name={name} setName={setName} impactMode={impactMode} setImpactMode={setImpactMode} />
          )}
          {step === 'sharing' && (
            <SharingStep
              principles={principles}
              sharingPrincipleId={sharingPrincipleId}
              setSharingPrincipleId={setSharingPrincipleId}
              sharingParams={sharingParams}
              setSharingParams={setSharingParams}
            />
          )}
          {step === 'mapping' && (
            <MappingStep
              mfaLCAResults={mfaLCAResults}
              boundaries={boundaries}
              suggestions={suggestions}
              mapping={mapping}
              setMapping={setMapping}
            />
          )}
          {step === 'thresholds' && (
            <ThresholdsStep
              boundaries={boundaries}
              sharingPrincipleId={sharingPrincipleId}
              thresholds={thresholds}
              setThresholds={setThresholds}
            />
          )}
        </div>

        {error && (
          <div style={{
            margin: '0 var(--space-6)',
            padding: 'var(--space-3)',
            backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            color: 'var(--danger)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <AlertCircle size={14} />{error}
          </div>
        )}

        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button variant="ghost" onClick={goBack} disabled={step === 'basics'}>
            <ArrowLeft size={14} /> Back
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {step !== 'thresholds' ? (
              <Button onClick={goNext}>
                Next <ArrowRight size={14} />
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={!canSave || submitting}>
                <Check size={14} /> {existing ? 'Save changes' : 'Create configuration'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: StepKey }) {
  const idx = STEPS.findIndex((s) => s.key === step)
  return (
    <div style={{ padding: 'var(--space-3) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 'var(--space-2)' }}>
      {STEPS.map((s, i) => {
        const active = i === idx
        const done = i < idx
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 999,
              backgroundColor: active ? 'var(--mod-aesa)' : done ? 'color-mix(in srgb, var(--mod-aesa) 30%, transparent)' : 'var(--bg-elevated)',
              color: active ? 'var(--text-inverse)' : done ? 'var(--mod-aesa)' : 'var(--text-tertiary)',
              fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: done ? '1px solid var(--mod-aesa)' : '1px solid var(--border-subtle)',
            }}>
              {done ? <Check size={12} /> : i + 1}
            </div>
            <span style={{
              fontSize: 'var(--text-xs)',
              fontWeight: active ? 600 : 500,
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}>{s.label}</span>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 1, backgroundColor: 'var(--border-subtle)', marginLeft: 4 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step: Basics ─────────────────────────────────────────────────────────────

function BasicsStep({
  name, setName, impactMode, setImpactMode,
}: { name: string; setName: (v: string) => void; impactMode: string; setImpactMode: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <label style={labelCol}>Configuration name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Danish Steel — per-capita share" />
      </div>
      <div>
        <label style={labelCol}>Impact mode</label>
        <select value={impactMode} onChange={(e) => setImpactMode(e.target.value)} style={inputStyle}>
          <option value="static">Static LCI (one base ecoinvent)</option>
          <option value="projected">Projected LCI (year-matched prospective DBs)</option>
        </select>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 6 }}>
          This just records intent — the assessment uses whichever Impact result you run against.
        </p>
      </div>
    </div>
  )
}

// ── Step: Sharing Principle ──────────────────────────────────────────────────

function SharingStep({
  principles, sharingPrincipleId, setSharingPrincipleId, sharingParams, setSharingParams,
}: {
  principles: SharingPrinciple[]
  sharingPrincipleId: string
  setSharingPrincipleId: (v: string) => void
  sharingParams: Record<string, unknown>
  setSharingParams: (v: Record<string, unknown>) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {principles.map((p) => {
          const active = p.id === sharingPrincipleId
          return (
            <button
              key={p.id}
              onClick={() => setSharingPrincipleId(p.id)}
              style={{
                textAlign: 'left',
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: active ? 'color-mix(in srgb, var(--mod-aesa) 10%, transparent)' : 'var(--bg-elevated)',
                border: `1px solid ${active ? 'var(--mod-aesa)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{p.name}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{p.description}</div>
            </button>
          )
        })}
      </div>

      {sharingPrincipleId === 'per_capita' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label style={labelCol}>System population</label>
            <input
              type="number"
              value={(sharingParams.system_population as number | undefined) ?? ''}
              onChange={(e) => setSharingParams({ ...sharingParams, system_population: Number(e.target.value) })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelCol}>World population</label>
            <input
              type="number"
              value={(sharingParams.world_population as number | undefined) ?? ''}
              onChange={(e) => setSharingParams({ ...sharingParams, world_population: Number(e.target.value) })}
              style={inputStyle}
            />
          </div>
          <p style={{ gridColumn: '1 / -1', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            These parameters are informational — they help you compute thresholds yourself in the next step.
          </p>
        </div>
      )}

      {sharingPrincipleId === 'per_gdp' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <label style={labelCol}>System GDP (USD)</label>
            <input
              type="number"
              value={(sharingParams.system_gdp as number | undefined) ?? ''}
              onChange={(e) => setSharingParams({ ...sharingParams, system_gdp: Number(e.target.value) })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelCol}>World GDP (USD)</label>
            <input
              type="number"
              value={(sharingParams.world_gdp as number | undefined) ?? ''}
              onChange={(e) => setSharingParams({ ...sharingParams, world_gdp: Number(e.target.value) })}
              style={inputStyle}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step: Mapping ────────────────────────────────────────────────────────────

function MappingStep({
  mfaLCAResults, boundaries, suggestions, mapping, setMapping,
}: {
  mfaLCAResults: MFALCAResult[]
  boundaries: PlanetaryBoundary[]
  suggestions: AESAMethodSuggestion[]
  mapping: MethodBoundaryMapping[]
  setMapping: (v: MethodBoundaryMapping[]) => void
}) {
  const keyOf = (t: string[]) => t.join('|')
  const suggestionByKey = useMemo(() => {
    const m = new Map<string, AESAMethodSuggestion>()
    for (const s of suggestions) m.set(keyOf(s.method_tuple), s)
    return m
  }, [suggestions])
  const mappingByKey = useMemo(() => {
    const m = new Map<string, MethodBoundaryMapping>()
    for (const x of mapping) m.set(keyOf(x.method_tuple), x)
    return m
  }, [mapping])

  const updateFor = (methodTuple: string[], patch: Partial<MethodBoundaryMapping>) => {
    const k = keyOf(methodTuple)
    const existing = mappingByKey.get(k)
    const next = [...mapping.filter((x) => keyOf(x.method_tuple) !== k)]
    if (patch.boundary_id === '' || patch.boundary_id === null) {
      setMapping(next)
      return
    }
    const merged: MethodBoundaryMapping = {
      method_tuple: methodTuple,
      boundary_id: patch.boundary_id ?? existing?.boundary_id ?? '',
      conversion_factor: patch.conversion_factor ?? existing?.conversion_factor ?? 1.0,
    }
    if (!merged.boundary_id) {
      setMapping(next)
      return
    }
    next.push(merged)
    setMapping(next)
  }

  if (!mfaLCAResults.length) {
    return (
      <div style={{
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: 'var(--text-sm)',
      }}>
        Run an MFA × LCA calculation first so we have methods to map.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
        Each LCIA method can be mapped to one planetary boundary. We pre-selected matches based on keywords
        (shown in the dropdown). Leave a row as “(skip)” to exclude it from the assessment.
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.7fr 1.3fr 90px',
        gap: 'var(--space-2)',
        alignItems: 'center',
      }}>
        <div style={{ ...labelCol, marginBottom: 0 }}>Method</div>
        <div style={{ ...labelCol, marginBottom: 0 }}>Boundary</div>
        <div style={{ ...labelCol, marginBottom: 0 }}>×factor</div>
        {mfaLCAResults.map((r) => {
          const k = keyOf(r.method)
          const sugg = suggestionByKey.get(k)
          const m = mappingByKey.get(k)
          const label = r.method_label || r.method.join(' › ')
          return (
            <div key={k} style={{ display: 'contents' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <div style={{ fontWeight: 500 }}>{label}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{r.unit}</div>
              </div>
              <select
                value={m?.boundary_id ?? ''}
                onChange={(e) => updateFor(r.method, { boundary_id: e.target.value })}
                style={{ ...inputStyle, height: 32, fontSize: 'var(--text-xs)' }}
              >
                <option value="">(skip)</option>
                {boundaries.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{sugg?.boundary_id === b.id && sugg.match_score > 0 ? ' ★' : ''}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="any"
                value={m?.conversion_factor ?? 1}
                onChange={(e) => updateFor(r.method, { conversion_factor: Number(e.target.value) })}
                disabled={!m}
                style={{ ...inputStyle, height: 32, fontSize: 'var(--text-xs)' }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Step: Thresholds ─────────────────────────────────────────────────────────

function ThresholdsStep({
  boundaries, sharingPrincipleId, thresholds, setThresholds,
}: {
  boundaries: PlanetaryBoundary[]
  sharingPrincipleId: string
  thresholds: BoundaryAllocation[]
  setThresholds: (v: BoundaryAllocation[]) => void
}) {
  const boundaryById = useMemo(() => {
    const m = new Map<string, PlanetaryBoundary>()
    for (const b of boundaries) m.set(b.id, b)
    return m
  }, [boundaries])

  const patch = (bid: string, next: Partial<BoundaryAllocation>) => {
    setThresholds(thresholds.map((t) => t.boundary_id === bid ? { ...t, ...next, sharing_principle_id: sharingPrincipleId } : t))
  }

  if (!thresholds.length) {
    return (
      <div style={{
        padding: 'var(--space-6)', textAlign: 'center',
        color: 'var(--text-secondary)', fontSize: 'var(--text-sm)',
      }}>
        Map at least one method to a boundary first.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
        Threshold units must match your LCA method output (e.g. kg CO2-eq/yr). The planetary-boundary
        global limits shown below are <strong>informational</strong> — they are in biophysical units
        (ppm CO2, Tg N/yr, …) and are not directly comparable.
      </p>
      {thresholds.map((t) => {
        const b = boundaryById.get(t.boundary_id)
        return (
          <div key={t.boundary_id} style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3) var(--space-4)',
            display: 'grid',
            gridTemplateColumns: '1.2fr 1fr 0.8fr',
            gap: 'var(--space-3)',
            alignItems: 'end',
          }}>
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                {b?.name ?? t.boundary_id}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                Global limit: {b?.global_limit ?? '—'} {b?.global_limit_unit ?? ''}
              </div>
            </div>
            <div>
              <label style={labelCol}>Allocated threshold</label>
              <input
                type="number"
                step="any"
                value={t.allocated_threshold || ''}
                onChange={(e) => patch(t.boundary_id, { allocated_threshold: Number(e.target.value) })}
                style={inputStyle}
                placeholder="e.g. 5.0e7"
              />
            </div>
            <div>
              <label style={labelCol}>Unit</label>
              <input
                value={t.allocated_unit}
                onChange={(e) => patch(t.boundary_id, { allocated_unit: e.target.value })}
                style={inputStyle}
                placeholder="kg CO2-eq/yr"
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function firstUnitByBoundary(
  results: MFALCAResult[],
  mapping: MethodBoundaryMapping[],
): Record<string, string> {
  const out: Record<string, string> = {}
  const resultsByKey = new Map<string, MFALCAResult>()
  for (const r of results) resultsByKey.set(r.method.join('|'), r)
  for (const m of mapping) {
    if (out[m.boundary_id]) continue
    const res = resultsByKey.get(m.method_tuple.join('|'))
    if (res?.unit) out[m.boundary_id] = res.unit
  }
  return out
}
