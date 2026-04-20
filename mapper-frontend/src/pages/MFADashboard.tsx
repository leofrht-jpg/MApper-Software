import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Download,
  Edit2,
  GitBranch,
  Plus,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { CSVUploader } from '../components/mfa/CSVUploader'
import { MaterialFlowPanel } from '../components/mfa/MaterialFlowPanel'
import { SurvivalConfigurator } from '../components/mfa/SurvivalConfigurator'
import { SystemCreator } from '../components/mfa/SystemCreator'
import { EditSystemModal } from '../components/mfa/EditSystemModal'
import { useMFAStore } from '../stores/mfaStore'
import type { DimensionDef, YearResult } from '../api/client'

const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
]

const COHORT_SEP = '|'

function parseCohortKey(key: string, dims: DimensionDef[]): Record<string, string> {
  const nads = dims.filter((d) => !d.is_age)
  const parts = key.split(COHORT_SEP)
  return Object.fromEntries(nads.map((d, i) => [d.name, parts[i] ?? '']))
}

function groupKeyForDim(cohortKey: string, dims: DimensionDef[], dimName: string | null): string {
  if (!dimName) return cohortKey || 'all'
  const parsed = parseCohortKey(cohortKey, dims)
  return parsed[dimName] ?? 'all'
}

function formatNumber(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (Math.abs(v) >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return v.toFixed(3)
}

export function MFADashboard() {
  const {
    systems,
    activeSystem,
    systemState,
    simulationResult,
    selectedYear,
    stackByDimension,
    isSimulating,
    error,
    fetchSystems,
    selectSystem,
    removeSystem,
    uploadStock,
    uploadInflows,
    simulate,
    exportResults,
    importSimulation,
    importSystem,
    setSelectedYear,
    setStackByDimension,
    downloadTemplate,
  } = useMFAStore()

  const [activeTab, setActiveTab] = useState<'dynamics' | 'materials'>('dynamics')
  const [showCreator, setShowCreator] = useState(false)
  const [showSurvival, setShowSurvival] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [systemListOpen, setSystemListOpen] = useState(false)
  const [expandStock, setExpandStock] = useState(false)
  const [expandInflows, setExpandInflows] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const importSimInputRef = useRef<HTMLInputElement>(null)
  const importSysInputRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportResults()
    } catch (e) {
      console.error(e)
    } finally {
      setExporting(false)
    }
  }

  const handleImportSimulation = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const res = await importSimulation(file)
      const msg = `Imported ${res.years_imported} years, ${res.cohorts_found} cohorts.`
      alert(res.warnings.length ? `${msg}\n\nWarnings:\n${res.warnings.join('\n')}` : msg)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleImportSystem = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      await importSystem(file)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    fetchSystems()
  }, [fetchSystems])

  const nonAgeDims = useMemo(
    () => activeSystem?.dimensions.filter((d) => !d.is_age) ?? [],
    [activeSystem],
  )

  const selectedYearResult: YearResult | null = useMemo(() => {
    if (!simulationResult || selectedYear == null) return null
    return simulationResult.years.find((y) => y.year === selectedYear) ?? simulationResult.years[0]
  }, [simulationResult, selectedYear])

  const areaData = useMemo(() => {
    if (!simulationResult || !activeSystem) return []
    return simulationResult.years.map((yr) => {
      const row: Record<string, number | string> = { year: yr.year }
      for (const [ck, count] of Object.entries(yr.stock)) {
        const group = groupKeyForDim(ck, activeSystem.dimensions, stackByDimension)
        row[group] = (Number(row[group] ?? 0)) + count
      }
      return row
    })
  }, [simulationResult, activeSystem, stackByDimension])

  const stackKeys = useMemo(() => {
    if (!activeSystem) return []
    if (!stackByDimension) return ['all']
    const dim = activeSystem.dimensions.find((d) => d.name === stackByDimension)
    return dim?.labels ?? ['all']
  }, [activeSystem, stackByDimension])

  const ageData = useMemo(() => {
    if (!selectedYearResult || !activeSystem) return []
    const buckets: Record<number, Record<string, number>> = {}
    for (const [ck, byAge] of Object.entries(selectedYearResult.stock_by_age)) {
      const group = groupKeyForDim(ck, activeSystem.dimensions, stackByDimension)
      for (const [ageStr, count] of Object.entries(byAge)) {
        const age = Number(ageStr)
        buckets[age] ??= {}
        buckets[age][group] = (buckets[age][group] ?? 0) + count
      }
    }
    return Object.entries(buckets)
      .map(([age, vals]) => ({ age: Number(age), ...vals }))
      .sort((a, b) => a.age - b.age)
  }, [selectedYearResult, activeSystem, stackByDimension])

  const cohortRows = useMemo(() => {
    if (!selectedYearResult || !activeSystem) return []
    const cks = new Set([
      ...Object.keys(selectedYearResult.stock),
      ...Object.keys(selectedYearResult.inflow),
      ...Object.keys(selectedYearResult.outflow),
    ])
    return Array.from(cks).map((ck) => {
      const stock = selectedYearResult.stock[ck] ?? 0
      const inflow = selectedYearResult.inflow[ck] ?? 0
      const outflow = selectedYearResult.outflow[ck] ?? 0
      return {
        cohort_key: ck,
        dims: parseCohortKey(ck, activeSystem.dimensions),
        stock,
        inflow,
        outflow,
        net: inflow - outflow,
      }
    }).sort((a, b) => b.stock - a.stock)
  }, [selectedYearResult, activeSystem])

  const summary = useMemo(() => {
    if (!selectedYearResult) return null
    const totalStock = Object.values(selectedYearResult.stock).reduce((a, b) => a + b, 0)
    const totalInflow = Object.values(selectedYearResult.inflow).reduce((a, b) => a + b, 0)
    const totalOutflow = Object.values(selectedYearResult.outflow).reduce((a, b) => a + b, 0)
    return { totalStock, totalInflow, totalOutflow, net: totalInflow - totalOutflow }
  }, [selectedYearResult])

  // ── Empty state ──
  if (!activeSystem) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)', flexShrink: 0 }}>
          MFA Modeller
        </h1>
        <div style={{ flex: 1, minHeight: 0 }}>
          <EmptyState
            systemsExist={systems.length > 0}
            systems={systems}
            onCreate={() => setShowCreator(true)}
            onSelect={selectSystem}
            onRestoreClick={() => importSysInputRef.current?.click()}
            importing={importing}
          />
        </div>
        <input
          ref={importSysInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleImportSystem}
          style={{ display: 'none' }}
        />
        {showCreator && <SystemCreator onClose={() => setShowCreator(false)} />}
      </div>
    )
  }

  const horizonYears = activeSystem.time_horizon
  const yearList = Array.from(
    { length: horizonYears.end_year - horizonYears.start_year + 1 },
    (_, i) => horizonYears.start_year + i,
  )

  const stockRowCount = Object.keys(systemState?.initial_stock ?? {}).length
  const inflowYearCount = systemState?.inflows.length ?? 0
  const stockLoaded = stockRowCount > 0
  const inflowsLoaded = inflowYearCount > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>
            MFA Modeller
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-secondary)' }}>
              {activeSystem.name}
            </span>
            <Badge label="MFA" variant="mfa" />
            <SystemSwitcher
              open={systemListOpen}
              onToggle={() => setSystemListOpen((v) => !v)}
              systems={systems}
              activeId={activeSystem.id ?? ''}
              onSelect={async (id) => { setSystemListOpen(false); await selectSystem(id) }}
              onDelete={async (id) => { if (confirm('Delete this system?')) await removeSystem(id) }}
              onCreateNew={() => setShowCreator(true)}
            />
          </div>
          {activeSystem.description && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>{activeSystem.description}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => setShowEdit(true)}>
            <Edit2 size={14} strokeWidth={1.5} /> Edit
          </Button>
          <Button variant="ghost" onClick={() => setShowSurvival(true)}>
            <Settings2 size={14} strokeWidth={1.5} /> Survival
          </Button>
          <Button
            variant="ghost"
            onClick={() => importSimInputRef.current?.click()}
            disabled={importing}
            title="Restore a simulation from a previously exported Excel"
          >
            <Upload size={14} strokeWidth={1.5} /> {importing ? 'Importing…' : 'Import MFA'}
          </Button>
          <input
            ref={importSimInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImportSimulation}
            style={{ display: 'none' }}
          />
          <Button
            variant="secondary"
            onClick={handleExport}
            disabled={!simulationResult || exporting}
            title={simulationResult ? 'Export all results to Excel' : 'Run simulation first'}
          >
            <Download size={14} strokeWidth={1.5} /> {exporting ? 'Exporting…' : 'Export'}
          </Button>
          <Button
            variant="primary"
            onClick={simulate}
            disabled={isSimulating}
            style={{ backgroundColor: 'var(--mod-mfa)' }}
          >
            <Activity size={14} strokeWidth={1.5} /> {isSimulating ? 'Simulating…' : 'Run simulation'}
          </Button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {([
          { key: 'dynamics' as const, label: 'Fleet dynamics' },
          { key: 'materials' as const, label: 'Material flows' },
        ]).map((tab) => {
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 500,
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderBottom: active ? '2px solid var(--mod-mfa)' : '2px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'materials' && <MaterialFlowPanel />}

      {activeTab === 'dynamics' && <>
          {/* Data setup: compact bar if loaded, full uploader otherwise */}
          {stockLoaded && inflowsLoaded && !expandStock && !expandInflows ? (
            <CompactDataBar
              stockRows={stockRowCount}
              inflowYears={inflowYearCount}
              onReuploadStock={() => setExpandStock(true)}
              onReuploadInflows={() => setExpandInflows(true)}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', flexShrink: 0 }}>
              {stockLoaded && !expandStock ? (
                <CompactCard
                  label={`Stock: ${stockRowCount} cohort-age rows loaded`}
                  onReupload={() => setExpandStock(true)}
                />
              ) : (
                <SetupCard title="Initial stock" description={stockLoaded ? `${stockRowCount} cohort-age rows loaded` : 'Not yet uploaded'}>
                  <CSVUploader
                    label="Upload initial stock CSV"
                    onUpload={async (f) => {
                      await uploadStock(f)
                      setExpandStock(false)
                      return { summary: 'Stock uploaded.' }
                    }}
                    onDownloadTemplate={() => downloadTemplate('stock')}
                  />
                </SetupCard>
              )}
              {inflowsLoaded && !expandInflows ? (
                <CompactCard
                  label={`Inflows: ${inflowYearCount} years loaded`}
                  onReupload={() => setExpandInflows(true)}
                />
              ) : (
                <SetupCard title="Annual inflows" description={inflowsLoaded ? `${inflowYearCount} years of sales data loaded` : 'Not yet uploaded'}>
                  <CSVUploader
                    label="Upload inflow CSV"
                    onUpload={async (f) => {
                      await uploadInflows(f)
                      setExpandInflows(false)
                      return { summary: 'Inflows uploaded.' }
                    }}
                    onDownloadTemplate={() => downloadTemplate('inflows')}
                  />
                </SetupCard>
              )}
            </div>
          )}

          {/* Year timeline */}
          {simulationResult && (
            <YearTimeline
              years={yearList}
              selectedYear={selectedYear ?? horizonYears.start_year}
              onSelect={setSelectedYear}
            />
          )}

          {/* Row 1 — Stacked area chart (full width) */}
          {simulationResult && selectedYearResult && (
            <Card>
              <CardHeader
                title="Stock composition"
                right={
                  <StackByDropdown
                    dims={nonAgeDims}
                    value={stackByDimension}
                    onChange={setStackByDimension}
                  />
                }
              />
              <div style={{ minHeight: 350, height: 350 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={areaData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="year" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                    <YAxis stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                      formatter={(v) => (typeof v === 'number' ? formatNumber(v) : String(v))}
                    />
                    {stackKeys.map((k, i) => (
                      <Area
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stackId="1"
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                        fillOpacity={0.7}
                        isAnimationActive={false}
                      />
                    ))}
                    <ReferenceLine x={selectedYear ?? undefined} stroke="var(--mod-mfa)" strokeDasharray="3 3" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Row 2 — Summary cards (2×2) | Age distribution */}
          {simulationResult && selectedYearResult && summary && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 'var(--space-3)' }}>
                <SummaryCard label={`Total stock ${selectedYear}`} value={formatNumber(summary.totalStock)} />
                <SummaryCard label="Inflows" value={formatNumber(summary.totalInflow)} icon={<ArrowUp size={14} color="var(--success)" />} accent="var(--success)" />
                <SummaryCard label="Outflows" value={formatNumber(summary.totalOutflow)} icon={<ArrowDown size={14} color="var(--danger)" />} accent="var(--danger)" />
                <SummaryCard label="Net change" value={(summary.net >= 0 ? '+' : '') + formatNumber(summary.net)} accent={summary.net >= 0 ? 'var(--success)' : 'var(--danger)'} />
              </div>

              <Card>
                <CardHeader title={`Age distribution · ${selectedYear}`} />
                <div style={{ minHeight: 250, height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ageData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                      <XAxis dataKey="age" stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} label={{ value: 'Age', position: 'insideBottom', offset: -2, fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <YAxis stroke="var(--text-tertiary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 12 }}
                        formatter={(v) => (typeof v === 'number' ? formatNumber(v) : String(v))}
                      />
                      {stackKeys.map((k, i) => (
                        <Bar key={k} dataKey={k} stackId="age" fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.85} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          )}

          {/* Row 3 — Cohort breakdown (full width) */}
          {simulationResult && selectedYearResult && (
            <Card>
              <CardHeader title={`Cohorts in ${selectedYear}`} />
              <div style={{ overflow: 'auto', maxHeight: 400 }}>
                <CohortTable rows={cohortRows} dims={nonAgeDims} />
              </div>
            </Card>
          )}

          {!simulationResult && (
            <div style={{ padding: 'var(--space-6)', backgroundColor: 'var(--bg-surface)', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
              Upload stock + inflows, configure survival, then click <strong>Run simulation</strong>.
            </div>
          )}
      </>}

      {showCreator && <SystemCreator onClose={() => setShowCreator(false)} />}
      {showSurvival && <SurvivalConfigurator onClose={() => setShowSurvival(false)} />}
      {showEdit && activeSystem && (
        <EditSystemModal system={activeSystem} onClose={() => setShowEdit(false)} />
      )}
    </div>
  )
}

// ── sub-components ─────────────────────────────────────────────────────────────

function CompactDataBar({
  stockRows,
  inflowYears,
  onReuploadStock,
  onReuploadInflows,
}: {
  stockRows: number
  inflowYears: number
  onReuploadStock: () => void
  onReuploadInflows: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
      padding: '10px 14px',
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      flexShrink: 0,
    }}>
      <CompactItem
        label={`Stock: ${stockRows} cohort-age rows loaded`}
        onReupload={onReuploadStock}
      />
      <div style={{ width: 1, height: 20, backgroundColor: 'var(--border-subtle)' }} />
      <CompactItem
        label={`Inflows: ${inflowYears} years loaded`}
        onReupload={onReuploadInflows}
      />
    </div>
  )
}

function CompactItem({ label, onReupload }: { label: string; onReupload: () => void }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
      <CheckCircle2 size={14} color="var(--success)" />
      <span>{label}</span>
      <button
        onClick={onReupload}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--mod-mfa)', fontSize: 'var(--text-xs)', fontWeight: 500, padding: 0,
        }}
      >
        Re-upload
      </button>
    </div>
  )
}

function CompactCard({ label, onReupload }: { label: string; onReupload: () => void }) {
  return (
    <div style={{
      padding: '12px 16px',
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
        <CheckCircle2 size={14} color="var(--success)" />
        <span>{label}</span>
      </div>
      <button
        onClick={onReupload}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--mod-mfa)', fontSize: 'var(--text-xs)', fontWeight: 500, padding: 0,
        }}
      >
        Re-upload
      </button>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-5)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      {children}
    </div>
  )
}

function CardHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h3>
      {right}
    </div>
  )
}

function SetupCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        {description && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{description}</div>}
      </div>
      {children}
    </div>
  )
}

function SummaryCard({ label, value, icon, accent }: { label: string; value: string; icon?: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minHeight: 110,
    }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {icon}
        <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 600, color: accent ?? 'var(--text-primary)' }}>
          {value}
        </span>
      </div>
    </div>
  )
}

function StackByDropdown({ dims, value, onChange }: { dims: DimensionDef[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
      Stack by
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', outline: 'none', cursor: 'pointer' }}
      >
        {dims.map((d) => (
          <option key={d.name} value={d.name}>{d.display_name || d.name}</option>
        ))}
      </select>
    </label>
  )
}

function YearTimeline({ years, selectedYear, onSelect }: { years: number[]; selectedYear: number; onSelect: (y: number) => void }) {
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4) var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', fontWeight: 600 }}>Selected year</div>
          <div style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--mod-mfa)', lineHeight: 1.1 }}>{selectedYear}</div>
        </div>
        <input
          type="range"
          min={years[0]}
          max={years[years.length - 1]}
          value={selectedYear}
          onChange={(e) => onSelect(Number(e.target.value))}
          style={{ flex: 1, marginLeft: 24, accentColor: 'var(--mod-mfa)' }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
        {years.map((y) => {
          const active = y === selectedYear
          return (
            <button
              key={y}
              onClick={() => onSelect(y)}
              title={String(y)}
              style={{
                flexShrink: 0,
                width: active ? 12 : 8,
                height: active ? 12 : 8,
                borderRadius: '50%',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: active ? 'var(--mod-mfa)' : 'var(--bg-active)',
                transition: 'all var(--duration-fast) var(--ease-out)',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function CohortTable({ rows, dims }: { rows: ReturnType<typeof useCohortRowsType>; dims: DimensionDef[] }) {
  const [sortBy, setSortBy] = useState<'stock' | 'inflow' | 'outflow' | 'net'>('stock')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortBy]
    const bv = b[sortBy]
    return dir === 'asc' ? av - bv : bv - av
  })

  const headers: { key: 'stock' | 'inflow' | 'outflow' | 'net'; label: string }[] = [
    { key: 'stock', label: 'Stock' },
    { key: 'inflow', label: 'Inflow' },
    { key: 'outflow', label: 'Outflow' },
    { key: 'net', label: 'Net' },
  ]

  const handleSort = (k: typeof sortBy) => {
    if (sortBy === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(k); setDir('desc') }
  }

  const numCell: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }
  const headCell: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', cursor: 'pointer', backgroundColor: 'var(--bg-surface)', position: 'sticky', top: 0 }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {dims.map((d) => <th key={d.name} style={headCell}>{d.display_name || d.name}</th>)}
          {headers.map((h) => (
            <th key={h.key} style={{ ...headCell, textAlign: 'right' }} onClick={() => handleSort(h.key)}>
              {h.label} {sortBy === h.key && (dir === 'asc' ? '↑' : '↓')}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.cohort_key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {dims.map((d) => (
              <td key={d.name} style={{ padding: '6px 10px' }}>
                <Badge label={row.dims[d.name] ?? ''} variant="mfa" />
              </td>
            ))}
            <td style={numCell}>{formatNumber(row.stock)}</td>
            <td style={{ ...numCell, color: row.inflow > 0 ? 'var(--success)' : 'var(--text-tertiary)' }}>{formatNumber(row.inflow)}</td>
            <td style={{ ...numCell, color: row.outflow > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>{formatNumber(row.outflow)}</td>
            <td style={{ ...numCell, color: row.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {(row.net >= 0 ? '+' : '') + formatNumber(row.net)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// helper-only type alias for CohortTable rows
function useCohortRowsType(): { cohort_key: string; dims: Record<string, string>; stock: number; inflow: number; outflow: number; net: number }[] {
  return []
}

interface SystemSwitcherProps {
  open: boolean
  onToggle: () => void
  systems: { id: string; name: string }[]
  activeId: string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onCreateNew: () => void
}

function SystemSwitcher({ open, onToggle, systems, activeId, onSelect, onDelete, onCreateNew }: SystemSwitcherProps) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onToggle}
        style={{ height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}
      >
        Switch <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 32, left: 0, minWidth: 240, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', zIndex: 30, overflow: 'hidden' }}>
          {systems.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', backgroundColor: s.id === activeId ? 'var(--bg-active)' : 'transparent' }}>
              <button onClick={() => onSelect(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', textAlign: 'left', flex: 1 }}>
                {s.name}
              </button>
              <button onClick={() => onDelete(s.id)} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {systems.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-subtle)' }} />
          )}
          <button
            onClick={() => { onCreateNew(); onToggle() }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mod-mfa)', fontSize: 'var(--text-sm)', fontWeight: 500, textAlign: 'left' }}
          >
            <Plus size={14} strokeWidth={1.5} /> New system
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyState({ systemsExist, systems, onCreate, onSelect, onRestoreClick, importing }: {
  systemsExist: boolean
  systems: { id: string; name: string; cohort_count: number; time_horizon: { start_year: number; end_year: number } }[]
  onCreate: () => void
  onSelect: (id: string) => void
  onRestoreClick: () => void
  importing: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', gap: 'var(--space-5)' }}>
      <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-full)', backgroundColor: 'color-mix(in srgb, var(--mod-mfa) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <GitBranch size={28} color="var(--mod-mfa)" />
      </div>
      <div>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {systemsExist ? 'Pick a system to open' : 'Create your first system'}
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 6, maxWidth: 420 }}>
          MApper's MFA is a dynamic stock-flow model with cohort tracking. Define dimensions
          (e.g. fuel type, size), upload an initial stock and annual sales, and watch the system age year by year.
        </p>
      </div>
      <Button variant="primary" onClick={onCreate} style={{ backgroundColor: 'var(--mod-mfa)', height: 40, padding: '0 18px' }}>
        <Plus size={14} strokeWidth={1.5} /> New system
      </Button>
      <button
        onClick={onRestoreClick}
        disabled={importing}
        style={{ background: 'none', border: 'none', cursor: importing ? 'not-allowed' : 'pointer', color: 'var(--mod-mfa)', fontSize: 'var(--text-sm)', fontWeight: 500, padding: 0 }}
      >
        {importing ? 'Importing…' : 'Or restore from a previous export'}
      </button>
      {systemsExist && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 360 }}>
          {systems.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left' }}
            >
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{s.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                  {s.time_horizon.start_year}–{s.time_horizon.end_year} · {s.cohort_count} cohorts
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
