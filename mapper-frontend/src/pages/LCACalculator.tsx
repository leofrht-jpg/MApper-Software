import { useCallback, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useLCAStore } from '../stores/lcaStore'
import { useProjectStore } from '../stores/projectStore'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ContributionBars } from '../components/charts/ContributionBars'
import { ContributionTreemap } from '../components/charts/ContributionTreemap'
import { SankeyChart } from '../components/charts/SankeyChart'
import { getActivities, getMethods, type ActivitySummary, type MethodFamily } from '../api/client'
import { useActivityStore } from '../stores/activityStore'

const CALC_STEPS = [
  { key: 'building_matrix', label: 'Building technosphere matrix…' },
  { key: 'solving', label: 'Solving linear system…' },
  { key: 'characterizing', label: 'Characterizing impacts…' },
  { key: 'analyzing', label: 'Analyzing contributions…' },
  { key: 'done', label: 'Complete' },
]

// ── Activity autocomplete ──────────────────────────────────────────────────────

function ActivitySearch({ onSelect }: { onSelect: (act: ActivitySummary) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ActivitySummary[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { databases } = useProjectStore()

  const doSearch = useCallback(async (q: string) => {
    if (!q || databases.length === 0) { setResults([]); return }
    setSearching(true)
    try {
      const page = await getActivities(databases[0].name, 0, 10, q)
      setResults(page.items)
      setOpen(true)
    } finally {
      setSearching(false)
    }
  }, [databases])

  const handleChange = (v: string) => {
    setQuery(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(v), 300)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={16} strokeWidth={1.5} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
        <input
          type="text"
          placeholder="Search for an activity…"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          style={{ width: '100%', height: 36, paddingLeft: 34, paddingRight: 12, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none' }}
          onFocusCapture={(e) => { e.target.style.borderColor = 'var(--border-focus)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-muted)' }}
          onBlurCapture={(e) => { e.target.style.borderColor = 'var(--border-default)'; e.target.style.boxShadow = 'none' }}
        />
        {searching && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>…</span>}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', zIndex: 50, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
          {results.map((act) => (
            <button
              key={act.key}
              onMouseDown={() => { onSelect(act); setQuery(act.product || act.name); setOpen(false) }}
              style={{ width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>{act.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{act.product}</div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {act.location && <Badge label={act.location} variant="default" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Method selector ───────────────────────────────────────────────────────────

function MethodSelector({ onSelect }: { onSelect: (method: string[]) => void }) {
  const [methods, setMethods] = useState<MethodFamily[]>([])
  const [family, setFamily] = useState('')
  const [category, setCategory] = useState('')
  const [indicator, setIndicator] = useState('')

  useEffect(() => {
    getMethods().then((m) => {
      setMethods(m)
      if (m.length > 0) setFamily(m[0].family)
    })
  }, [])

  const families = methods.map((m) => m.family)
  const categories = methods.find((m) => m.family === family)?.categories ?? []
  const indicators = categories.find((c) => c.category === category)?.indicators ?? []

  useEffect(() => {
    if (categories.length > 0 && !category) setCategory(categories[0].category)
  }, [categories, category])

  useEffect(() => {
    if (indicators.length > 0 && !indicator) setIndicator(indicators[0].indicator)
  }, [indicators, indicator])

  useEffect(() => {
    if (family && category && indicator) {
      const ind = indicators.find((i) => i.indicator === indicator)
      if (ind) onSelect(ind.tuple)
    }
  }, [family, category, indicator, indicators, onSelect])

  const selectStyle: React.CSSProperties = {
    height: 36, padding: '0 10px', backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none', cursor: 'pointer', width: '100%',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select value={family} onChange={(e) => { setFamily(e.target.value); setCategory(''); setIndicator('') }} style={selectStyle}>
        {families.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <select value={category} onChange={(e) => { setCategory(e.target.value); setIndicator('') }} style={selectStyle} disabled={!family}>
        {categories.map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
      </select>
      <select value={indicator} onChange={(e) => setIndicator(e.target.value)} style={selectStyle} disabled={!category}>
        {indicators.map((i) => <option key={i.indicator} value={i.indicator}>{i.indicator}</option>)}
      </select>
      {family && category && indicator && (
        <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', paddingTop: 2 }}>
          ({family}, {category}, {indicator})
        </div>
      )}
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function CalculationProgress({ step, progress }: { step: string; progress: number }) {
  const label = CALC_STEPS.find((s) => s.key === step)?.label ?? step
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{Math.round(progress * 100)}%</span>
      </div>
      <div style={{ height: 6, backgroundColor: 'var(--bg-hover)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
        <div style={{ height: '100%', backgroundColor: 'var(--accent)', borderRadius: 'var(--radius-full)', width: `${progress * 100}%`, transition: 'width var(--duration-normal) var(--ease-out)' }} />
      </div>
    </div>
  )
}

// ── Main LCACalculator ─────────────────────────────────────────────────────────

interface LCACalculatorProps {
  onNavigateToExplorer?: (activityKey: string) => void
}

export function LCACalculator({ onNavigateToExplorer }: LCACalculatorProps) {
  const {
    selectedActivity, amount, selectedMethod,
    status, progress, result, contributions, supplyChain, error,
    setFunctionalUnit, setMethod, calculate, reset,
  } = useLCAStore()

  const { setDatabase, selectActivity } = useActivityStore()
  const { databases } = useProjectStore()

  const [vizTab, setVizTab] = useState<'contributions' | 'treemap' | 'sankey'>('contributions')
  const [localAmount, setLocalAmount] = useState(String(amount))

  useEffect(() => { setLocalAmount(String(amount)) }, [amount])

  const handleAmountChange = (v: string) => {
    setLocalAmount(v)
    const n = parseFloat(v)
    if (!isNaN(n) && selectedActivity) setFunctionalUnit(selectedActivity, n)
  }

  const handleActivitySelect = (act: ActivitySummary) => {
    setFunctionalUnit(act, parseFloat(localAmount) || 1)
  }

  const handleBarClick = (key: string) => {
    if (!onNavigateToExplorer) return
    // key format: "('db', 'code')"
    try {
      const parsed = JSON.parse(key.replace(/'/g, '"').replace(/\(/g, '[').replace(/\)/g, ']')) as [string, string]
      const [db, code] = parsed
      if (databases.find((d) => d.name === db)) {
        setDatabase(db)
        selectActivity(db, code)
        onNavigateToExplorer(key)
      }
    } catch { /* ignore */ }
  }

  const canCalculate = selectedActivity !== null && selectedMethod !== null && status !== 'calculating'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>LCA Calculator</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>Calculate life cycle assessment impacts</p>
        </div>
        {result && <Button variant="ghost" onClick={reset}>New Calculation</Button>}
      </div>

      {/* Setup form */}
      <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
          {/* Functional unit */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 8 }}>
              Functional Unit
            </label>
            <ActivitySearch onSelect={handleActivitySelect} />
            {selectedActivity && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--bg-active)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '4px 10px' }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)' }}>{selectedActivity.product || selectedActivity.name}</span>
                </div>
                <input
                  type="number"
                  value={localAmount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  style={{ width: 70, height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none' }}
                  min="0"
                  step="any"
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{selectedActivity.unit}</span>
              </div>
            )}
          </div>

          {/* Method */}
          <div>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 8 }}>
              LCIA Method
            </label>
            <MethodSelector onSelect={setMethod} />
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-5)', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            onClick={calculate}
            disabled={!canCalculate}
            style={{ height: 44, fontSize: 'var(--text-base)', paddingLeft: 28, paddingRight: 28 }}
          >
            {status === 'calculating' ? 'Calculating…' : 'Calculate'}
          </Button>
        </div>
      </div>

      {/* Progress */}
      {status === 'calculating' && progress && (
        <CalculationProgress step={progress.step} progress={progress.progress} />
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div style={{ backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
          Calculation failed: {error}
        </div>
      )}

      {/* Results */}
      {status === 'done' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Score card */}
          <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)' }}>
            <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
              {result.method.join(' › ')}
            </p>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>
                {result.score.toExponential(4)}
              </span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{result.unit}</span>
            </div>
            <p style={{ marginTop: 6, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {result.functional_unit_amount} {selectedActivity?.unit ?? ''} of {result.functional_unit_name}
            </p>
          </div>

          {/* Visualization tabs */}
          <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
              {(['contributions', 'treemap', 'sankey'] as const).map((t) => (
                <button key={t} onClick={() => setVizTab(t)} style={{ padding: '0 var(--space-5)', height: 42, background: 'none', border: 'none', borderBottom: vizTab === t ? '2px solid var(--accent)' : '2px solid transparent', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 500, color: vizTab === t ? 'var(--text-primary)' : 'var(--text-secondary)', textTransform: 'capitalize', transition: 'color var(--duration-fast) var(--ease-out)' }}>
                  {t}
                </button>
              ))}
            </div>
            <div style={{ padding: 'var(--space-5)' }}>
              {vizTab === 'contributions' && contributions && (
                <ContributionBars
                  items={contributions.items}
                  restAmount={contributions.rest_amount}
                  restPercentage={contributions.rest_percentage}
                  unit={result.unit}
                  onActivityClick={handleBarClick}
                />
              )}
              {vizTab === 'treemap' && contributions && (
                <ContributionTreemap
                  items={contributions.items}
                  restAmount={contributions.rest_amount}
                  restPercentage={contributions.rest_percentage}
                  unit={result.unit}
                />
              )}
              {vizTab === 'sankey' && supplyChain && (
                <SankeyChart data={supplyChain} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
