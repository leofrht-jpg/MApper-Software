import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Play, Save, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { useAESAStore } from '../../stores/aesaStore'
import { useMFAStore } from '../../stores/mfaStore'
import { useImpactStore } from '../../stores/impactStore'
import type {
  CarbonBudgetOption,
  PlanetaryBoundary,
  SharingPrincipleId,
  SSPTrajectory,
} from '../../api/client'

const PRINCIPLE_COLORS: Record<SharingPrincipleId, string> = {
  EpC: '#60A5FA',
  IN:  '#F59E0B',
  AGR: '#34D399',
  LA:  '#A78BFA',
  AR:  '#F87171',
}

const PRINCIPLE_LABEL: Record<SharingPrincipleId, string> = {
  EpC: 'Equality per Capita',
  IN:  'Industrial output',
  AGR: 'Agricultural output',
  LA:  'Land Area',
  AR:  'Acquired Rights',
}

const PRINCIPLES: SharingPrincipleId[] = ['EpC', 'IN', 'AGR', 'LA', 'AR']

interface Props {
  collapsed: boolean
  onToggle: () => void
}

export function ConfigSidebar({ collapsed, onToggle }: Props) {
  const {
    defaults, defaultsLoading, draft, running, error,
    loadDefaults, loadConfigurations, updateDraft, updateMultiD, updateLayer1,
    updateCarbonBudget, resetDraftToDefaults, suggestMapping, saveConfig, compute,
  } = useAESAStore()

  const { activeSystem } = useMFAStore()
  const { staticResult, projectedResult } = useImpactStore()

  const [runSensitivity, setRunSensitivity] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void loadDefaults()
    void loadConfigurations()
  }, [loadDefaults, loadConfigurations])

  const boundarySet = useMemo(
    () => defaults?.boundary_sets.find((b) => b.id === draft?.boundary_set_id) ?? defaults?.boundary_sets[0] ?? null,
    [defaults, draft?.boundary_set_id],
  )

  const activeImpact = draft?.impact_mode === 'projected' ? projectedResult : staticResult
  const hasImpact = !!activeImpact
  const canCompute = !!draft && !!activeSystem && hasImpact && !running

  // Auto-prefer Projected LCI on first load if it's available and the draft is still untouched
  useEffect(() => {
    if (!draft) return
    if (projectedResult && draft.impact_mode === 'static' && draft.method_mapping.length === 0) {
      updateDraft({ impact_mode: 'projected' })
    }
  }, [projectedResult, draft, updateDraft])

  // Auto-suggest mapping when impact result lands and mapping is empty
  useEffect(() => {
    if (!draft || !activeImpact) return
    if (draft.method_mapping.length > 0) return
    const methods = activeImpact.results.map((r) => [...r.method])
    if (methods.length) void suggestMapping(methods)
  }, [draft, activeImpact, suggestMapping])

  const handleCompute = async () => {
    if (!activeSystem || !draft || !activeImpact) return
    const taskId = activeImpact.task_id
    const isMirror = taskId.startsWith('mfa-mirror-')
    await compute({
      mfaSystemId: activeSystem.id,
      impactTaskId: isMirror ? null : taskId,
      impactInline: isMirror ? activeImpact : null,
      runSensitivity,
    })
  }

  const staticSubtitle = staticResult ? describeStatic(staticResult) : '(not yet computed)'
  const projectedSubtitle = projectedResult ? describeProjected(projectedResult) : '(not yet computed)'

  const handleSave = async () => {
    if (!activeSystem) return
    setSaving(true)
    try { await saveConfig(activeSystem.id) } finally { setSaving(false) }
  }

  if (collapsed) {
    return (
      <aside style={collapsedStyle}>
        <button onClick={onToggle} style={toggleButton} title="Expand configuration">
          <ChevronRight size={16} />
        </button>
        <span style={{
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
          letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase',
        }}>
          AESA configuration
        </span>
      </aside>
    )
  }

  return (
    <aside style={sidebarStyle}>
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
          }}>
            Configuration
          </span>
        </div>
        <button onClick={onToggle} style={toggleButton} title="Collapse">
          <ChevronLeft size={16} />
        </button>
      </header>

      <div style={bodyStyle}>
        {defaultsLoading && !defaults && (
          <div style={{ padding: 'var(--space-3)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
            Loading defaults…
          </div>
        )}

        {draft && defaults && boundarySet && (
          <>
            {/* LCI source */}
            <Section title="LCI Source">
              <LciSourceRadio
                value={draft.impact_mode}
                onChange={(m) => updateDraft({ impact_mode: m })}
                staticAvailable={!!staticResult}
                projectedAvailable={!!projectedResult}
                staticSubtitle={staticSubtitle}
                projectedSubtitle={projectedSubtitle}
              />
            </Section>

            {/* Name */}
            <Section title="Name">
              <input
                value={draft.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                style={inputStyle}
              />
            </Section>

            {/* Boundary set */}
            <Section title="Planetary Boundary set">
              <select
                value={draft.boundary_set_id}
                onChange={(e) => updateDraft({ boundary_set_id: e.target.value })}
                style={inputStyle}
              >
                {defaults.boundary_sets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <div style={hintText}>{boundarySet.source}</div>
            </Section>

            {/* Multi-D table */}
            <Section
              title="Multi-D allocation (Layer 1)"
              right={
                <button onClick={resetDraftToDefaults} style={ghostBtnStyle} title="Reset to defaults">
                  <RotateCcw size={11} /> Reset
                </button>
              }
            >
              <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
                      <th style={thStyle}>Boundary</th>
                      <th style={{ ...thStyle, width: 70 }}>SP-I</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(boundarySet.boundaries).map(([pbId, pb]) => {
                      const cfg = draft.multi_d.layer1[pbId]
                      const principle = cfg?.principle ?? 'EpC'
                      const color = PRINCIPLE_COLORS[principle]
                      return (
                        <tr key={pbId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style={{ ...tdStyle, borderLeft: `3px solid ${color}` }}>
                            <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                              {formatPbName(pb)}
                            </div>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: 10, marginTop: 1 }}>
                              {pb.boundary_type}
                            </div>
                          </td>
                          <td style={tdStyle}>
                            <select
                              value={principle}
                              onChange={(e) => {
                                const newP = e.target.value as SharingPrincipleId
                                const sd = defaults.sharing_data.layer1_defaults[newP]
                                updateLayer1(pbId, {
                                  principle: newP,
                                  system_value: sd.system_value,
                                  global_value: sd.global_value,
                                  justification: sd.description,
                                })
                              }}
                              style={{ ...inputStyle, height: 26, padding: '2px 4px', fontSize: 11 }}
                              title={PRINCIPLE_LABEL[principle]}
                            >
                              {PRINCIPLES.map((p) => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Legend />
            </Section>

            {/* Downscaling data */}
            <Section title="Downscaling — Layer 1 data">
              {PRINCIPLES.map((p) => {
                const usedByAny = Object.values(draft.multi_d.layer1).some((c) => c.principle === p)
                if (!usedByAny) return null
                const sd = defaults.sharing_data.layer1_defaults[p]
                // Read current layer1 values from first PB that uses this principle
                const firstPb = Object.entries(draft.multi_d.layer1).find(([, c]) => c.principle === p)
                const sys = firstPb?.[1].system_value ?? sd.system_value
                const glob = firstPb?.[1].global_value ?? sd.global_value
                const share = glob > 0 ? sys / glob : 0
                return (
                  <div key={p} style={{
                    padding: 'var(--space-2)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 'var(--space-2)',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, fontWeight: 600, color: PRINCIPLE_COLORS[p], marginBottom: 4,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRINCIPLE_COLORS[p] }} />
                      {p} — {PRINCIPLE_LABEL[p]}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      <NumberField
                        label="System"
                        value={sys}
                        onChange={(v) => updateAllWithPrinciple(p, { system_value: v })}
                      />
                      <NumberField
                        label="Global"
                        value={glob}
                        onChange={(v) => updateAllWithPrinciple(p, { global_value: v })}
                      />
                    </div>
                    <div style={{ marginTop: 3, fontSize: 10, color: 'var(--text-tertiary)' }}>
                      Share: {(share * 100).toPrecision(4)}% · {sd.unit ?? ''}
                    </div>
                  </div>
                )
              })}
            </Section>

            {/* Layer 2 sector share */}
            <Section title="Layer 2 — Sector share (grandfathering)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number" step="0.01" min={0} max={1}
                  value={draft.multi_d.layer2_sector_share}
                  onChange={(e) => updateMultiD({ layer2_sector_share: Number(e.target.value) })}
                  style={{ ...inputStyle, width: 90 }}
                />
                <span style={hintText}>{defaults.sharing_data.layer2.source}</span>
              </div>
            </Section>

            {/* Carbon budget */}
            <Section
              title="Carbon budget (cumulative climate)"
              right={
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={!!draft.carbon_budget}
                    onChange={(e) => {
                      if (e.target.checked) {
                        updateCarbonBudget(defaults.default_carbon_budget)
                      } else {
                        updateCarbonBudget(null)
                      }
                    }}
                  />
                  enabled
                </label>
              }
            >
              {draft.carbon_budget ? (
                <CarbonBudgetEditor
                  budget={draft.carbon_budget}
                  options={defaults.carbon_budget_options}
                  ssps={defaults.ssp_trajectories}
                  onPatch={(p) => updateCarbonBudget(p)}
                />
              ) : (
                <div style={hintText}>
                  Climate change will use the standard PB × Multi-D path instead.
                </div>
              )}
            </Section>

            {/* Mapping status */}
            <Section title="Method → PB mapping">
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {draft.method_mapping.length} method{draft.method_mapping.length === 1 ? '' : 's'} mapped
                {activeImpact && draft.method_mapping.length < activeImpact.results.length && (
                  <span style={{ color: 'var(--warning)' }}>
                    {' '}· {activeImpact.results.length - draft.method_mapping.length} unmapped
                  </span>
                )}
              </div>
              {activeImpact && (
                <button
                  onClick={() => {
                    const methods = activeImpact.results.map((r) => [...r.method])
                    void suggestMapping(methods)
                  }}
                  style={ghostBtnStyle}
                >
                  Re-suggest from impact methods
                </button>
              )}
            </Section>
          </>
        )}
      </div>

      <footer style={footerStyle}>
        {error && (
          <div style={{
            padding: '6px 8px',
            marginBottom: 6,
            fontSize: 11,
            color: 'var(--danger)',
            backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
            borderRadius: 'var(--radius-sm)',
          }}>
            {error}
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
          <input type="checkbox" checked={runSensitivity} onChange={(e) => setRunSensitivity(e.target.checked)} />
          Run sensitivity (5 uniform principles)
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={handleCompute} disabled={!canCompute} style={{ flex: 1 }}>
            {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
            Compute
          </Button>
          <Button variant="secondary" onClick={handleSave} disabled={!draft || !activeSystem || saving}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          </Button>
        </div>
        {!activeSystem && <div style={footerHint}>Select an MFA system.</div>}
        {activeSystem && !hasImpact && (
          <div style={footerHint}>
            Run the {draft?.impact_mode === 'projected' ? 'Projected' : 'Static'} LCI first.
          </div>
        )}
      </footer>
    </aside>
  )

  function updateAllWithPrinciple(p: SharingPrincipleId, patch: { system_value?: number; global_value?: number }) {
    if (!draft) return
    for (const [pbId, cfg] of Object.entries(draft.multi_d.layer1)) {
      if (cfg.principle === p) updateLayer1(pbId, patch)
    }
  }
}

// ── LCI source selector ────────────────────────────────────────────────────

function LciSourceRadio({
  value, onChange,
  staticAvailable, projectedAvailable,
  staticSubtitle, projectedSubtitle,
}: {
  value: 'static' | 'projected'
  onChange: (v: 'static' | 'projected') => void
  staticAvailable: boolean
  projectedAvailable: boolean
  staticSubtitle: string
  projectedSubtitle: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <LciOption
        label="Static LCI"
        subtitle={staticSubtitle}
        checked={value === 'static'}
        disabled={!staticAvailable}
        onSelect={() => onChange('static')}
      />
      <LciOption
        label="Projected LCI"
        subtitle={projectedSubtitle}
        checked={value === 'projected'}
        disabled={!projectedAvailable}
        onSelect={() => onChange('projected')}
      />
    </div>
  )
}

function LciOption({
  label, subtitle, checked, disabled, onSelect,
}: {
  label: string
  subtitle: string
  checked: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <label
      onClick={() => { if (!disabled) onSelect() }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '6px 8px',
        border: `1px solid ${checked && !disabled ? 'var(--mod-aesa)' : 'var(--border-subtle)'}`,
        background: checked && !disabled
          ? 'color-mix(in srgb, var(--mod-aesa) 10%, transparent)'
          : 'var(--bg-elevated)',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="radio"
        checked={checked && !disabled}
        disabled={disabled}
        readOnly
        style={{ marginTop: 2, accentColor: 'var(--mod-aesa)' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{
          fontSize: 10, color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={subtitle}>
          {subtitle}
        </span>
      </div>
    </label>
  )
}

function describeStatic(r: import('../../api/client').ImpactAssessmentResult): string {
  return r.meta.base_db ?? 'static LCI'
}

function describeProjected(r: import('../../api/client').ImpactAssessmentResult): string {
  const s = r.meta.scenario
  if (!s) return 'projected LCI'
  return `${s.iam.toUpperCase()} / ${s.ssp}`
}

// ── CarbonBudgetEditor ──────────────────────────────────────────────────────

function CarbonBudgetEditor({
  budget, options, ssps, onPatch,
}: {
  budget: import('../../api/client').CarbonBudgetConfig
  options: CarbonBudgetOption[]
  ssps: SSPTrajectory[]
  onPatch: (p: Partial<import('../../api/client').CarbonBudgetConfig>) => void
}) {
  const selectedOption = options.find(
    (o) => Math.abs(o.remaining_gt_from_2025 - budget.initial_budget_gt) < 0.5,
  )?.id ?? 'custom'

  const selectedSsp = ssps.find((s) => s.id === budget.ssp_scenario) ?? ssps[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={labelStyle}>IPCC AR6 budget</label>
      <select
        value={selectedOption}
        onChange={(e) => {
          const opt = options.find((o) => o.id === e.target.value)
          if (!opt) return
          onPatch({ initial_budget_gt: opt.remaining_gt_from_2025, budget_source: opt.source })
        }}
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name} — {o.remaining_gt_from_2025} Gt</option>
        ))}
        {selectedOption === 'custom' && <option value="custom">Custom ({budget.initial_budget_gt} Gt)</option>}
      </select>

      <label style={labelStyle}>SSP trajectory</label>
      <select
        value={budget.ssp_scenario}
        onChange={(e) => {
          const ssp = ssps.find((s) => s.id === e.target.value)
          if (!ssp) return
          onPatch({ ssp_scenario: ssp.id, projected_emissions: ssp.projected_emissions })
        }}
        style={inputStyle}
      >
        {ssps.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumberField label="Start" value={budget.start_year} onChange={(v) => onPatch({ start_year: v })} int />
        <NumberField label="End" value={budget.end_year} onChange={(v) => onPatch({ end_year: v })} int />
      </div>

      <BudgetSparkline budget={budget} />
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
        {selectedSsp?.source}
      </div>
    </div>
  )
}

function BudgetSparkline({ budget }: { budget: import('../../api/client').CarbonBudgetConfig }) {
  const W = 240, H = 48, PAD = 2
  const years = Object.keys(budget.projected_emissions).map(Number).filter((y) => y >= budget.start_year && y <= budget.end_year).sort((a, b) => a - b)
  if (years.length < 2) return null
  // Cumulative usage as fraction of initial budget
  let cum = 0
  const points = years.map((y) => {
    cum += budget.projected_emissions[y] ?? 0
    return { year: y, used: cum }
  })
  const maxUsed = Math.max(budget.initial_budget_gt, points[points.length - 1].used)
  const xFor = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD)
  const yFor = (used: number) => H - PAD - (used / maxUsed) * (H - 2 * PAD)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)} ${yFor(p.used).toFixed(1)}`).join(' ')
  const budgetY = yFor(budget.initial_budget_gt)
  const depleted = points.find((p) => p.used >= budget.initial_budget_gt)

  return (
    <div style={{ marginTop: 4 }}>
      <svg width={W} height={H} style={{ display: 'block', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)' }}>
        <line x1={0} x2={W} y1={budgetY} y2={budgetY} stroke="var(--danger)" strokeDasharray="3 2" strokeWidth={1} />
        <path d={path} fill="none" stroke="var(--mod-aesa)" strokeWidth={1.5} />
      </svg>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
        Cumulative emissions vs {budget.initial_budget_gt} Gt budget
        {depleted && <span style={{ color: 'var(--danger)' }}> · depleted ~{depleted.year}</span>}
      </div>
    </div>
  )
}

// ── Small primitives ────────────────────────────────────────────────────────

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
          {title}
        </span>
        {right}
      </div>
      {children}
    </section>
  )
}

function NumberField({ label, value, onChange, int }: { label: string; value: number; onChange: (v: number) => void; int?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</span>
      <input
        type="number"
        step={int ? 1 : 'any'}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...inputStyle, padding: '3px 6px', height: 24, fontSize: 11 }}
      />
    </label>
  )
}

function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {PRINCIPLES.map((p) => (
        <span key={p} style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          fontSize: 10, color: 'var(--text-tertiary)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRINCIPLE_COLORS[p] }} />
          {p}
        </span>
      ))}
    </div>
  )
}

function formatPbName(pb: PlanetaryBoundary): string {
  return pb.name.replace(/_/g, ' ')
}

// ── Styles ──────────────────────────────────────────────────────────────────

const sidebarStyle: React.CSSProperties = {
  width: 300,
  flexShrink: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
}

const collapsedStyle: React.CSSProperties = {
  width: 32,
  flexShrink: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  paddingTop: 8,
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-subtle)',
}

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
}

const footerStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderTop: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-surface)',
}

const toggleButton: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24,
  background: 'transparent', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
  cursor: 'pointer', padding: 0,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 28,
  padding: '4px 8px',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--text-tertiary)',
}

const thStyle: React.CSSProperties = {
  padding: '5px 8px', fontWeight: 600, fontSize: 10,
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
}

const tdStyle: React.CSSProperties = {
  padding: '5px 8px', verticalAlign: 'middle',
}

const hintText: React.CSSProperties = {
  fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3,
}

const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  background: 'transparent', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
  padding: '3px 6px', fontSize: 10, cursor: 'pointer',
}

const footerHint: React.CSSProperties = {
  fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, textAlign: 'center',
}
