import { useEffect, useMemo, useState } from 'react'
import { Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { PremiseKeyManager } from '../components/PremiseKeyManager'
import { usePLCAStore } from '../stores/plcaStore'
import { useProjectStore } from '../stores/projectStore'

export function PLCADeveloper() {
  const { databases: projectDbs } = useProjectStore()
  const {
    scenarios,
    databases,
    activeJob,
    isLoading,
    error,
    fetchScenarios,
    fetchDatabases,
    generate,
    deleteDatabase,
    clearJob,
  } = usePLCAStore()

  const [baseDb, setBaseDb] = useState<string>('')
  const [iam, setIam] = useState<string>('')
  const [ssp, setSsp] = useState<string>('')
  const [years, setYears] = useState<number[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Candidate base databases = non-prospective ecoinvent-like dbs.
  const baseDbCandidates = useMemo(
    () => projectDbs.filter((d) => !d.is_prospective).map((d) => d.name),
    [projectDbs],
  )

  useEffect(() => { fetchScenarios().catch(() => undefined) }, [fetchScenarios])
  useEffect(() => { fetchDatabases().catch(() => undefined) }, [fetchDatabases])

  // SSP narrative labels
  const SSP_LABELS: Record<string, string> = {
    'SSP1-Base': 'SSP1-Base (Sustainability)',
    'SSP2-Base': 'SSP2-Base (Middle of the Road)',
    'SSP3-Base': 'SSP3-Base (Regional Rivalry)',
    'SSP5-Base': 'SSP5-Base (Fossil-fueled Dev.)',
    'SSP1-NDC': 'SSP1-NDC (Nationally Determined)',
    'SSP1-NPi': 'SSP1-NPi (National Policies)',
    'SSP1-PkBudg500': 'SSP1-PkBudg500 (1.5°C budget)',
    'SSP1-PkBudg1150': 'SSP1-PkBudg1150 (2°C budget)',
    'SSP1-RCP19': 'SSP1-RCP19 (1.9 W/m²)',
    'SSP1-RCP26': 'SSP1-RCP26 (2.6 W/m²)',
    'SSP2-NDC': 'SSP2-NDC (Nationally Determined)',
    'SSP2-NPi': 'SSP2-NPi (National Policies)',
    'SSP2-PkBudg500': 'SSP2-PkBudg500 (1.5°C budget)',
    'SSP2-PkBudg900': 'SSP2-PkBudg900 (1.8°C budget)',
    'SSP2-PkBudg1150': 'SSP2-PkBudg1150 (2°C budget)',
    'SSP2-RCP19': 'SSP2-RCP19 (1.9 W/m²)',
    'SSP2-RCP26': 'SSP2-RCP26 (2.6 W/m²)',
    'SSP2-RCP45': 'SSP2-RCP45 (4.5 W/m²)',
    'SSP5-NDC': 'SSP5-NDC (Nationally Determined)',
    'SSP5-NPi': 'SSP5-NPi (National Policies)',
    'SSP5-PkBudg500': 'SSP5-PkBudg500 (1.5°C budget)',
    'SSP5-PkBudg1150': 'SSP5-PkBudg1150 (2°C budget)',
  }

  const IAM_LABELS: Record<string, string> = {
    'remind': 'REMIND',
    'remind-eu': 'REMIND-EU',
    'image': 'IMAGE',
    'message': 'MESSAGE',
    'gcam': 'GCAM',
    'tiam-ucl': 'TIAM-UCL',
  }

  // Available SSPs filtered by selected IAM
  const availableSsps = useMemo(() => {
    if (!scenarios) return []
    if (iam && scenarios.ssps_by_iam?.[iam]) return scenarios.ssps_by_iam[iam]
    return scenarios.ssps
  }, [scenarios, iam])

  // Sensible defaults once options arrive.
  useEffect(() => {
    if (!baseDb && baseDbCandidates.length > 0) setBaseDb(baseDbCandidates[0])
  }, [baseDb, baseDbCandidates])
  useEffect(() => {
    if (scenarios && !iam) setIam(scenarios.iams[0] ?? '')
  }, [scenarios, iam])
  // Reset SSP when IAM changes or when SSP list updates
  useEffect(() => {
    if (!ssp || !availableSsps.includes(ssp)) {
      setSsp(availableSsps[0] ?? '')
    }
  }, [availableSsps, ssp])

  const toggleYear = (y: number) => {
    setYears((prev) => (prev.includes(y) ? prev.filter((v) => v !== y) : [...prev, y].sort((a, b) => a - b)))
  }

  const isGenerating = !!activeJob && !activeJob.done
  const keyConfigured = scenarios?.key_configured !== false
  const canSubmit = !isGenerating && keyConfigured && !!baseDb && !!iam && !!ssp && years.length > 0

  const handleGenerate = async () => {
    setSubmitError(null)
    try {
      await generate({ baseDb, iam, ssp, years })
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete prospective database "${name}"?`)) return
    try {
      await deleteDatabase(name)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  // Group registry by scenario (base_db / iam / ssp).
  const grouped = useMemo(() => {
    const map = new Map<string, typeof databases>()
    for (const d of databases) {
      const k = `${d.base_db} · ${d.iam.toUpperCase()} · ${d.ssp}`
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(d)
    }
    for (const arr of map.values()) arr.sort((a, b) => a.year - b.year)
    return Array.from(map.entries())
  }, [databases])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-5)', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        <Sparkles size={18} strokeWidth={1.5} style={{ color: 'var(--mod-plca)' }} />
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>
          pLCA Developer
        </h1>
      </div>

      {scenarios && !scenarios.key_configured && (
        <PremiseKeyManager
          variant="banner"
          onStatusChange={(configured) => { if (configured) void fetchScenarios() }}
        />
      )}

      {/* Generator form */}
      <section
        style={{
          padding: 'var(--space-4)',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
          Generate prospective database
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 'var(--space-3)' }}>
          <LabeledField label="Base database">
            <select
              value={baseDb}
              onChange={(e) => setBaseDb(e.target.value)}
              disabled={isGenerating || baseDbCandidates.length === 0}
              style={selectStyle}
            >
              {baseDbCandidates.length === 0 && <option value="">(no databases)</option>}
              {baseDbCandidates.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="IAM">
            <select value={iam} onChange={(e) => setIam(e.target.value)} disabled={isGenerating} style={selectStyle}>
              {(scenarios?.iams ?? []).map((v) => (
                <option key={v} value={v}>{IAM_LABELS[v] ?? v.toUpperCase()}</option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="SSP / Pathway">
            <select value={ssp} onChange={(e) => setSsp(e.target.value)} disabled={isGenerating} style={selectStyle}>
              {availableSsps.map((v) => (
                <option key={v} value={v}>{SSP_LABELS[v] ?? v}</option>
              ))}
            </select>
          </LabeledField>
        </div>

        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 6 }}>
            Target years ({years.length} selected)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(scenarios?.years ?? []).map((y) => {
              const on = years.includes(y)
              return (
                <button
                  key={y}
                  onClick={() => toggleYear(y)}
                  disabled={isGenerating}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 500,
                    border: `1px solid ${on ? 'var(--mod-plca)' : 'var(--border-default)'}`,
                    backgroundColor: on ? 'var(--mod-plca)' : 'transparent',
                    color: on ? '#fff' : 'var(--text-primary)',
                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                    transition: 'all var(--duration-fast)',
                  }}
                >
                  {y}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Generated databases are written to the active bw2 project and share a single premise transformation pass.
          </div>
          <Button onClick={handleGenerate} disabled={!canSubmit} style={{ backgroundColor: 'var(--mod-plca)' }}>
            {isGenerating ? <Loader2 size={14} strokeWidth={1.5} className="plca-spin" /> : <Wand2 size={14} strokeWidth={1.5} />}
            {isGenerating ? 'Generating…' : `Generate (${years.length} year${years.length === 1 ? '' : 's'})`}
          </Button>
        </div>

        {activeJob && (
          <JobProgress job={activeJob} onDismiss={clearJob} />
        )}

        {(submitError || error) && (
          <div style={{ padding: 'var(--space-2) var(--space-3)', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
            {submitError || error}
          </div>
        )}
      </section>

      {/* Registry */}
      <section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            Prospective databases
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {databases.length} database{databases.length === 1 ? '' : 's'}
          </div>
        </div>

        {isLoading && databases.length === 0 ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            Loading…
          </div>
        ) : databases.length === 0 ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)' }}>
            No prospective databases yet. Pick a base database, scenario, and years above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {grouped.map(([groupKey, items]) => (
              <div key={groupKey} style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: 'var(--space-2) var(--space-3)', backgroundColor: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Badge style={{ backgroundColor: 'var(--mod-plca)', color: '#fff' }}>pLCA</Badge>
                  {groupKey}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={thStyle}>Year</th>
                      <th style={thStyle}>Database name</th>
                      <th style={thStyle}>Created</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d) => (
                      <tr key={d.name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={tdStyle}><strong>{d.year}</strong></td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary)' }}>{d.name}</td>
                        <td style={{ ...tdStyle, color: 'var(--text-tertiary)' }}>{formatDate(d.created_at)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <Button variant="ghost" onClick={() => handleDelete(d.name)} title="Delete">
                            <Trash2 size={14} strokeWidth={1.5} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <style>{`@keyframes plca-spin { to { transform: rotate(360deg) } } .plca-spin { animation: plca-spin 1s linear infinite }`}</style>
    </div>
  )
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  )
}

function JobProgress({ job, onDismiss }: { job: import('../stores/plcaStore').GenerationJob; onDismiss: () => void }) {
  const pct = Math.round(job.pct * 100)
  const elapsed = Math.floor((Date.now() - job.startedAt) / 1000)
  const statusColor = job.error ? 'var(--danger)' : job.done ? 'var(--success)' : 'var(--mod-plca)'
  return (
    <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          {job.error ? `Error: ${job.error}` : job.stage}
        </span>
        <span style={{ color: 'var(--text-tertiary)' }}>
          {job.done ? `completed in ${elapsed}s` : `${pct}% · ${elapsed}s elapsed`}
        </span>
      </div>
      <div style={{ height: 4, backgroundColor: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: statusColor, transition: 'width var(--duration-normal)' }} />
      </div>
      {job.done && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onDismiss}>Dismiss</Button>
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
}

const thStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
}
