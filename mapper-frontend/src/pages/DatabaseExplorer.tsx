import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Upload, X, Check, ArrowLeft, Download, BarChart3, ChevronDown, Filter } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useProjectStore } from '../stores/projectStore'
import { useActivityStore } from '../stores/activityStore'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { ImportWizard } from '../components/ImportWizard'
import {
  type ActivityDetail,
  type ActivityExportDetail,
  type ActivitySortBy,
  type ActivitySummary,
  exportActivitySelection,
  getActivityExportDetails,
} from '../api/client'

// ── Activity Detail Panel ─────────────────────────────────────────────────────

const EXCHANGE_TYPES = ['production', 'technosphere', 'biosphere'] as const

function ActivityDetailPanel({
  detail,
  onBack,
}: {
  detail: ActivityDetail
  onBack: () => void
}) {
  const [tab, setTab] = useState<'exchanges' | 'metadata'>('exchanges')

  const byType = EXCHANGE_TYPES.reduce(
    (acc, t) => ({ ...acc, [t]: detail.exchanges.filter((e) => e.type === t) }),
    {} as Record<string, typeof detail.exchanges>,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Back breadcrumb */}
      <button
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px var(--space-5)',
          background: 'none', border: 'none',
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)', fontSize: 'var(--text-xs)',
          cursor: 'pointer', flexShrink: 0, textAlign: 'left',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
      >
        <ArrowLeft size={12} /> Back to selection
      </button>

      {/* Header */}
      <div style={{ padding: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 'var(--leading-tight)' }}>
          {detail.name}
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
          {detail.product !== detail.name ? detail.product : ''}
        </p>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {detail.location && <Badge label={detail.location} variant="default" />}
          {detail.unit && <Badge label={detail.unit} variant="default" />}
          <Badge label={detail.database} variant="lca" />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {(['exchanges', 'metadata'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '0 var(--space-4)',
              height: 40,
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              textTransform: 'capitalize',
              transition: 'color var(--duration-fast) var(--ease-out)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'exchanges' && (
          <div>
            {EXCHANGE_TYPES.map((type) => {
              const excs = byType[type] ?? []
              if (excs.length === 0) return null
              return (
                <div key={type}>
                  <div style={{
                    padding: '8px var(--space-4)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-wide)',
                    backgroundColor: 'var(--bg-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}>
                    {type}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      height: 18, padding: '0 6px', borderRadius: 'var(--radius-full)',
                      fontSize: 'var(--text-xs)', fontWeight: 600,
                      backgroundColor: 'var(--bg-active)', color: 'var(--text-secondary)',
                    }}>
                      {excs.length}
                    </span>
                  </div>
                  {excs.map((exc, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto auto',
                        padding: '8px var(--space-4)',
                        borderBottom: '1px solid var(--border-subtle)',
                        gap: 8,
                        fontSize: 'var(--text-sm)',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {exc.input_name}
                        {exc.input_location && (
                          <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>
                            {exc.input_location}
                          </span>
                        )}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', textAlign: 'right' }}>
                        {exc.amount.toPrecision(4)}
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>{exc.input_unit}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        {tab === 'metadata' && (
          <div style={{ padding: 'var(--space-4)' }}>
            {Object.entries(detail.metadata).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 'var(--space-4)', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontWeight: 500, minWidth: 120, flexShrink: 0 }}>{k}</span>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Multi-select dropdown ─────────────────────────────────────────────────────

function MultiSelectDropdown({
  label, options, selected, onChange, disabled,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(q.toLowerCase())),
    [options, q],
  )
  const summary =
    selected.length === 0 ? `All ${label.toLowerCase()}` :
    selected.length === 1 ? selected[0] :
    `${selected.length} ${label.toLowerCase()}`

  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt])
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 28, padding: '0 10px',
          background: selected.length ? 'var(--accent-muted)' : 'var(--bg-elevated)',
          border: `1px solid ${selected.length ? 'var(--accent)' : 'var(--border-default)'}`,
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)', fontSize: 'var(--text-xs)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
        <span>{summary}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 32, left: 0, zIndex: 20,
            minWidth: 220, maxHeight: 320, overflow: 'hidden',
            backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            style={{
              height: 30, padding: '0 10px', border: 'none',
              borderBottom: '1px solid var(--border-subtle)', outline: 'none',
              backgroundColor: 'transparent', color: 'var(--text-primary)',
              fontSize: 'var(--text-xs)',
            }}
          />
          <div style={{ overflow: 'auto', flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '8px 10px', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', fontStyle: 'italic' }}>
                No matches
              </div>
            )}
            {filtered.map((opt) => {
              const on = selected.includes(opt)
              return (
                <button
                  key={opt}
                  onClick={() => toggle(opt)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 10px', border: 'none',
                    background: on ? 'var(--accent-muted)' : 'transparent',
                    color: 'var(--text-primary)', fontSize: 'var(--text-xs)',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: 'var(--radius-xs)',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-default)'}`,
                    backgroundColor: on ? 'var(--accent)' : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {on && <Check size={10} color="#fff" />}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
                </button>
              )
            })}
          </div>
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              style={{
                height: 28, border: 'none', borderTop: '1px solid var(--border-subtle)',
                background: 'transparent', color: 'var(--text-secondary)',
                fontSize: 'var(--text-xs)', cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Compare modal ─────────────────────────────────────────────────────────────

function CompareModal({
  activities, onClose,
}: {
  activities: ActivitySummary[]
  onClose: () => void
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 220,
      }}
    >
      <div style={{
        width: 'min(1100px, 95vw)', maxHeight: '85vh',
        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
            Compare {activities.length} activities
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{
                textAlign: 'left', color: 'var(--text-tertiary)',
                backgroundColor: 'var(--bg-elevated)',
                position: 'sticky', top: 0,
              }}>
                {['Attribute', ...activities.map((_, i) => `#${i + 1}`)].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', fontWeight: 500, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ['Name', (a: ActivitySummary) => a.name],
                ['Reference product', (a: ActivitySummary) => a.product],
                ['Location', (a: ActivitySummary) => a.location || '—'],
                ['Unit', (a: ActivitySummary) => a.unit || '—'],
                ['Database', (a: ActivitySummary) => a.database],
                ['Code', (a: ActivitySummary) => a.code],
              ] as const).map(([label, get]) => (
                <tr key={label} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500, verticalAlign: 'top' }}>{label}</td>
                  {activities.map((a) => (
                    <td key={a.key} style={{ padding: '10px 12px', color: 'var(--text-primary)', verticalAlign: 'top', wordBreak: 'break-word' }}>
                      {get(a)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── CSV export helper ─────────────────────────────────────────────────────────

const EXPORT_HEADERS = [
  'database', 'code', 'name', 'reference_product', 'location', 'unit',
  'classifications', 'comment', 'production_amount',
  'technosphere_count', 'biosphere_count', 'activity_type',
] as const

function groupCodesByDb(activities: ActivitySummary[]): Record<string, string[]> {
  const by: Record<string, string[]> = {}
  for (const a of activities) (by[a.database] ||= []).push(a.code)
  return by
}

async function exportSelectionCsv(activities: ActivitySummary[]): Promise<void> {
  if (!activities.length) return
  const byDb = groupCodesByDb(activities)
  const details: ActivityExportDetail[] = []
  for (const [db, codes] of Object.entries(byDb)) {
    details.push(...(await getActivityExportDetails(db, codes)))
  }
  // Preserve original selection order.
  const byKey = new Map(details.map((d) => [`${d.database}|${d.code}`, d]))
  const ordered = activities
    .map((a) => byKey.get(`${a.database}|${a.code}`))
    .filter((d): d is ActivityExportDetail => Boolean(d))

  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const shrinkComment = (raw: string): string => {
    const collapsed = raw.replace(/\s+/g, ' ').trim()
    return collapsed.length > 500 ? collapsed.slice(0, 497) + '...' : collapsed
  }
  const rows = [
    EXPORT_HEADERS.join(','),
    ...ordered.map((d) =>
      [
        d.database, d.code, d.name, d.reference_product, d.location, d.unit,
        d.classifications, shrinkComment(d.comment), d.production_amount,
        d.technosphere_count, d.biosphere_count, d.activity_type,
      ].map(esc).join(','),
    ),
  ]
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `activities_selection_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function exportSelectionXlsx(activities: ActivitySummary[]): Promise<void> {
  if (!activities.length) return
  const byDb = groupCodesByDb(activities)
  // The backend endpoint is per-database; cross-db selections yield one file per database.
  for (const [db, codes] of Object.entries(byDb)) {
    await exportActivitySelection(db, codes, 'xlsx')
  }
}

// ── Selection panel (right side, list mode) ───────────────────────────────────

function SelectionPanel({
  selected, onOpen, onRemove, onClear, onCompare,
  onExportCsv, onExportXlsx, exporting,
}: {
  selected: ActivitySummary[]
  onOpen: (a: ActivitySummary) => void
  onRemove: (key: string) => void
  onClear: () => void
  onCompare: () => void
  onExportCsv: () => void
  onExportXlsx: () => void
  exporting: null | 'csv' | 'xlsx'
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
            Selected: {selected.length} {selected.length === 1 ? 'activity' : 'activities'}
          </h2>
          {selected.length > 0 && (
            <button
              onClick={onClear}
              style={{
                background: 'none', border: 'none',
                color: 'var(--text-secondary)', fontSize: 'var(--text-xs)',
                cursor: 'pointer', padding: 0,
              }}
            >
              Clear all
            </button>
          )}
        </div>
        {selected.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <Button
              variant="secondary"
              onClick={onCompare}
              disabled={selected.length < 2}
              title={selected.length < 2 ? 'Select at least 2 activities to compare' : 'Compare side-by-side'}
              style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)' }}
            >
              <BarChart3 size={12} /> Compare selected
            </Button>
            <Button
              variant="secondary"
              onClick={onExportCsv}
              disabled={exporting !== null}
              title="Export selected activities as CSV (comments truncated to 500 chars)"
              style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)' }}
            >
              <Download size={12} /> {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
            </Button>
            <Button
              variant="secondary"
              onClick={onExportXlsx}
              disabled={exporting !== null}
              title="Export selected activities as xlsx (full-length comments, formatted)"
              style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)' }}
            >
              <Download size={12} /> {exporting === 'xlsx' ? 'Exporting…' : 'Export xlsx'}
            </Button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {selected.length === 0 ? (
          <div style={{
            padding: 'var(--space-5)',
            color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
            textAlign: 'center', lineHeight: 1.6,
          }}>
            Click an activity on the left to add it to the selection.
            <br />
            <span style={{ fontSize: 'var(--text-xs)' }}>
              Click to toggle · Shift-click for range<br />
              Double-click a row to view its detail
            </span>
          </div>
        ) : (
          selected.map((a) => (
            <div
              key={a.key}
              onClick={() => onOpen(a)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                gap: 8, alignItems: 'center',
                padding: '10px var(--space-5)',
                borderBottom: '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              title="Click to view detail"
            >
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.name}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {a.database}
                </div>
              </div>
              {a.location ? <Badge label={a.location} variant="default" /> : <span />}
              {a.unit ? <Badge label={a.unit} variant="default" /> : <span />}
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(a.key) }}
                title="Remove from selection"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', padding: 4, display: 'inline-flex',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
              >
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Main DatabaseExplorer ─────────────────────────────────────────────────────

export function DatabaseExplorer() {
  const { databases } = useProjectStore()
  const {
    selectedDatabase, activities, totalActivities,
    selectedLocations, selectedUnits, sortBy, distinctValues, searchQuery,
    selectedKeys, selectedActivitiesByKey,
    selectedActivity, isLoading, isLoadingDetail,
    setDatabase, searchActivities, loadMore,
    setLocations, setUnits, setSortBy, clearFilters,
    toggleActivity, rangeSelect, removeFromSelection, clearSelection,
    openDetail, closeDetail,
  } = useActivityStore()

  const [searchInput, setSearchInput] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [exporting, setExporting] = useState<null | 'csv' | 'xlsx'>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  // Initialize first database. Guard against databases becoming empty.
  useEffect(() => {
    if (databases.length > 0 && !selectedDatabase) {
      setDatabase(databases[0].name)
    }
  }, [databases, selectedDatabase, setDatabase])

  // Reset search input when the active database changes.
  useEffect(() => { setSearchInput(searchQuery) }, [selectedDatabase]) // eslint-disable-line react-hooks/exhaustive-deps

  const rowVirtualizer = useVirtualizer({
    count: activities.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  })

  const handleSearch = useCallback((value: string) => {
    setSearchInput(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => searchActivities(value), 300)
  }, [searchActivities])

  const clearSearch = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    setSearchInput('')
    searchActivities('')
    searchInputRef.current?.focus()
  }, [searchActivities])

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    if (nearBottom && !isLoading) loadMore()
  }, [isLoading, loadMore])

  const handleRowClick = (act: ActivitySummary, index: number, e: React.MouseEvent) => {
    setFocusedIndex(index)
    if (e.shiftKey) {
      rangeSelect(act, index)
      return
    }
    // Plain click (including Cmd/Ctrl) always toggles selection.
    // Detail view opens on double-click (see handleRowDoubleClick).
    toggleActivity(act, index)
  }

  const handleRowDoubleClick = (act: ActivitySummary, index: number) => {
    setFocusedIndex(index)
    // Double-click always reveals detail. Ensure it's part of the selection too,
    // so the checkbox reflects state consistently.
    if (!selectedActivitiesByKey[act.key]) toggleActivity(act, index)
    openDetail(act.database, act.code)
  }

  // Keyboard nav: arrows to move focus, Enter toggles detail, Escape clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (activities.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((i) => Math.min(i + 1, activities.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const act = activities[focusedIndex]
        if (!act) return
        // Enter toggles selection (matches single-click). Detail opens via
        // double-click on a row, or by clicking a row in the right panel.
        toggleActivity(act, focusedIndex)
      } else if (e.key === 'Escape') {
        if (selectedActivity) {
          closeDetail()
        } else if (selectedKeys.length > 0) {
          clearSelection()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activities, focusedIndex, selectedActivity, selectedKeys.length, toggleActivity, closeDetail, clearSelection])

  // Keep the focused row visible when it changes via keyboard.
  useEffect(() => {
    if (activities.length === 0) return
    rowVirtualizer.scrollToIndex(focusedIndex, { align: 'auto' })
  }, [focusedIndex, activities.length, rowVirtualizer])

  const filterCount =
    (searchQuery ? 1 : 0) +
    (selectedLocations.length ? 1 : 0) +
    (selectedUnits.length ? 1 : 0) +
    (sortBy !== 'name_asc' ? 1 : 0)

  const selectedActivities = useMemo(
    () => selectedKeys.map((k) => selectedActivitiesByKey[k]).filter(Boolean),
    [selectedKeys, selectedActivitiesByKey],
  )

  const handleExportCsv = async () => {
    if (exporting !== null) return
    setExporting('csv')
    try { await exportSelectionCsv(selectedActivities) }
    catch (e) { console.error('CSV export failed', e) }
    finally { setExporting(null) }
  }

  const handleExportXlsx = async () => {
    if (exporting !== null) return
    setExporting('xlsx')
    try { await exportSelectionXlsx(selectedActivities) }
    catch (e) { console.error('xlsx export failed', e) }
    finally { setExporting(null) }
  }

  const showDetail = selectedActivity !== null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-5)' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>
            Database Explorer
          </h1>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowImport(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--mod-lca)', borderColor: 'var(--mod-lca)',
          }}
        >
          <Upload size={14} strokeWidth={1.5} />
          Import database
        </Button>
      </div>

      {/* Database tabs */}
      {databases.length > 0 && (
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          {databases.map((db) => (
            <button
              key={db.name}
              onClick={() => setDatabase(db.name)}
              style={{
                padding: '0 var(--space-4)',
                height: 36,
                background: 'none',
                border: 'none',
                borderBottom: selectedDatabase === db.name ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: selectedDatabase === db.name ? 'var(--text-primary)' : 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                transition: 'color var(--duration-fast) var(--ease-out)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {db.is_prospective && (
                  <span
                    title={`Prospective — ${db.prospective_meta?.iam?.toUpperCase() ?? ''} ${db.prospective_meta?.ssp ?? ''} ${db.prospective_meta?.year ?? ''}`.trim()}
                    style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--mod-plca)' }}
                  />
                )}
                {db.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Master-detail layout */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '60% 40%', gap: 0, overflow: 'hidden', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>

        {/* Left: Activity table + filters */}
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          {/* Search bar */}
          <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} strokeWidth={1.5} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search activities…"
                value={searchInput}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && searchInput) {
                    e.preventDefault()
                    e.stopPropagation()
                    clearSearch()
                  }
                }}
                style={{
                  width: '100%', height: 36, paddingLeft: 34, paddingRight: searchInput ? 36 : 12,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)', outline: 'none',
                  transition: 'border-color var(--duration-fast) var(--ease-out)',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--border-focus)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-muted)' }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--border-default)'; e.target.style.boxShadow = 'none' }}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  title="Clear search (Esc)"
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    width: 24, height: 24, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: 'none',
                    borderRadius: 'var(--radius-full)',
                    color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0,
                    transition: 'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)' }}
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Filter row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                <Filter size={12} /> Filters{filterCount > 0 ? ` (${filterCount})` : ''}
              </span>
              <MultiSelectDropdown
                label="Location"
                options={distinctValues.locations}
                selected={selectedLocations}
                onChange={setLocations}
                disabled={distinctValues.locations.length === 0}
              />
              <MultiSelectDropdown
                label="Unit"
                options={distinctValues.units}
                selected={selectedUnits}
                onChange={setUnits}
                disabled={distinctValues.units.length === 0}
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                Sort
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as ActivitySortBy)}
                  style={{
                    height: 28, padding: '0 6px',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                    fontSize: 'var(--text-xs)', outline: 'none',
                  }}
                >
                  <option value="name_asc">Name (A→Z)</option>
                  <option value="name_desc">Name (Z→A)</option>
                  <option value="location_asc">Location (A→Z)</option>
                  <option value="unit_asc">Unit (A→Z)</option>
                  {searchInput && <option value="relevance">Relevance</option>}
                </select>
              </label>
              {filterCount > 0 && (
                <button
                  onClick={() => { setSearchInput(''); clearFilters() }}
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--accent)', fontSize: 'var(--text-xs)',
                    cursor: 'pointer', padding: 0,
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* Count indicator */}
            <div style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              {filterCount > 0
                ? `${totalActivities.toLocaleString()} matching filters`
                : `${totalActivities.toLocaleString()} activities`}
            </div>
          </div>

          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '24px 2fr 1fr 1fr', padding: '0 var(--space-4)', height: 36, alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, backgroundColor: 'var(--bg-surface)', gap: 8 }}>
            <span />
            {['Name', 'Location', 'Unit'].map((col) => (
              <span key={col} style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>{col}</span>
            ))}
          </div>

          {/* Virtualized rows */}
          <div ref={parentRef} onScroll={handleScroll} style={{ flex: 1, overflow: 'auto' }}>
            {isLoading && activities.length === 0 ? (
              <div>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', padding: '0 var(--space-4)', height: 40, alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
                    {[80, 50, 40].map((w, j) => (
                      <div key={j} style={{ height: 12, borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-hover)', animation: 'skeleton-pulse 1.5s ease-in-out infinite', width: `${w}%` }} />
                    ))}
                  </div>
                ))}
              </div>
            ) : activities.length === 0 ? (
              <EmptyState
                hasDatabases={databases.length > 0}
                hasFilters={filterCount > 0}
                onClearFilters={() => { setSearchInput(''); clearFilters() }}
                onImport={() => setShowImport(true)}
              />
            ) : (
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const act = activities[virtualRow.index]
                  if (!act) return null
                  const isSelected = !!selectedActivitiesByKey[act.key]
                  const isFocused = virtualRow.index === focusedIndex
                  const isDetailed = selectedActivity?.code === act.code && selectedActivity?.database === act.database
                  return (
                    <div
                      key={act.key}
                      onClick={(e) => handleRowClick(act, virtualRow.index, e)}
                      onDoubleClick={() => handleRowDoubleClick(act, virtualRow.index)}
                      style={{
                        position: 'absolute', top: virtualRow.start, left: 0, right: 0,
                        height: 40,
                        display: 'grid',
                        gridTemplateColumns: '24px 2fr 1fr 1fr',
                        padding: '0 var(--space-4)', alignItems: 'center', gap: 8,
                        borderBottom: '1px solid var(--border-subtle)',
                        backgroundColor: isDetailed
                          ? 'var(--bg-active)'
                          : isSelected
                            ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                            : isFocused ? 'var(--bg-hover)' : 'transparent',
                        borderLeft: isDetailed
                          ? '2px solid var(--accent)'
                          : isSelected ? '2px solid color-mix(in srgb, var(--accent) 60%, transparent)' : '2px solid transparent',
                        cursor: 'pointer',
                        userSelect: 'none',
                        transition: 'background var(--duration-fast) var(--ease-out)',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected && !isDetailed && !isFocused) e.currentTarget.style.background = 'var(--bg-hover)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected && !isDetailed && !isFocused) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span style={{
                        width: 16, height: 16, borderRadius: 'var(--radius-xs)',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-default)'}`,
                        backgroundColor: isSelected ? 'var(--accent)' : 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        {isSelected && <Check size={11} color="#fff" />}
                      </span>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{act.name}</span>
                      {act.location ? <Badge label={act.location} variant="default" /> : <span />}
                      {act.unit ? <Badge label={act.unit} variant="default" /> : <span />}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: detail view OR selection list */}
        <div style={{ overflow: 'hidden', backgroundColor: 'var(--bg-surface)' }}>
          {isLoadingDetail ? (
            <div style={{ padding: 'var(--space-5)' }}>
              {[100, 60, 80, 40].map((w, i) => (
                <div key={i} style={{ height: 14, borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-hover)', animation: 'skeleton-pulse 1.5s ease-in-out infinite', width: `${w}%`, marginBottom: 12 }} />
              ))}
            </div>
          ) : showDetail && selectedActivity ? (
            <ActivityDetailPanel
              detail={selectedActivity}
              onBack={closeDetail}
            />
          ) : (
            <SelectionPanel
              selected={selectedActivities}
              onOpen={(a) => openDetail(a.database, a.code)}
              onRemove={removeFromSelection}
              onClear={clearSelection}
              onCompare={() => setShowCompare(true)}
              onExportCsv={handleExportCsv}
              onExportXlsx={handleExportXlsx}
              exporting={exporting}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>

      {showImport && <ImportWizard onClose={() => setShowImport(false)} />}
      {showCompare && selectedActivities.length >= 2 && (
        <CompareModal activities={selectedActivities} onClose={() => setShowCompare(false)} />
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  hasDatabases, hasFilters, onClearFilters, onImport,
}: {
  hasDatabases: boolean
  hasFilters: boolean
  onClearFilters: () => void
  onImport: () => void
}) {
  if (!hasDatabases) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 12 }}>
          No databases in this project yet.
        </div>
        <Button variant="primary" onClick={onImport} style={{ background: 'var(--mod-lca)', borderColor: 'var(--mod-lca)' }}>
          <Upload size={14} /> Import a database
        </Button>
      </div>
    )
  }
  if (hasFilters) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 12 }}>
          No activities match the current filters. Try broadening your search.
        </div>
        <Button variant="secondary" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    )
  }
  return (
    <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
      This database is empty.
    </div>
  )
}
