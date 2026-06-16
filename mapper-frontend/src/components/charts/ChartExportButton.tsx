import { useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronRight, Download, FileImage, FileText, Loader2 } from 'lucide-react'
import {
  exportChart,
  exportChartWithLegend,
  exportLegend,
  type BgOption,
  type ExportFormat,
  type ExportMode,
  type RasterScale,
} from './chartExport'

let sessionScale: RasterScale = 2

const SCALE_HINTS: Record<RasterScale, string> = {
  1: '~96 DPI',
  2: '~192 DPI',
  3: '~288 DPI',
  4: '~384 DPI',
}

interface Props {
  chartRef: RefObject<HTMLElement | null>
  filename: string
  title?: string
  /**
   * Patch 4I — optional sibling element for the chart legend. When
   * provided, the export menu shows a Mode picker (Chart only / Legend
   * only / Chart + Legend), with filename discriminator suffixes per
   * mode. Charts without a legend should omit this prop — the menu
   * then renders in its original chart-only shape, behavior unchanged.
   */
  legendRef?: RefObject<HTMLElement | null>
  /**
   * Patch 4I — alternative to ``legendRef`` for charts whose legend is
   * Recharts-internal (rendered as a sibling `<ul>` inside the chart's
   * own container, not a separately-ref-able sibling node). At export
   * time the button queries `chartRef.current.querySelector(legendSelector)`.
   * The standard selector for Recharts' default legend is
   * ``.recharts-legend-wrapper``. Mutually exclusive with `legendRef` —
   * if both are provided, `legendRef` takes precedence.
   */
  legendSelector?: string
}

// Patch 5AJ — key bumped to `.v2` so any stale persisted `dark` from before the
// print-palette default resets once to `light` (print). Users who want dark can
// re-pick it; the export ink/bg is the only thing this preference controls.
const BG_STORAGE_KEY = 'mapper.chartExport.bg.v2'

function getInitialBg(): BgOption {
  if (typeof window === 'undefined') return 'light'
  const v = window.localStorage.getItem(BG_STORAGE_KEY)
  return v === 'dark' || v === 'light' || v === 'transparent' ? v : 'light'
}

export function ChartExportButton({ chartRef, filename, title = 'Export chart', legendRef, legendSelector }: Props) {
  const hasLegendAffordance = !!(legendRef || legendSelector)
  const [open, setOpen] = useState(false)
  const [bg, setBg] = useState<BgOption>(getInitialBg)
  const [scale, setScale] = useState<RasterScale>(() => sessionScale)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Default mode for charts with a legend is 'combined' (chart + legend
  // stacked) — that's the most common ask in academic figures and what
  // users expect when they click an "export" affordance on a chart that
  // visually includes a legend. Users can switch to 'chart' (chart-only)
  // or 'legend' (legend-only) from the picker. When no legendRef is
  // provided the picker doesn't render and routing falls through to the
  // existing single-mode call (no filename suffix, full backward
  // compat).
  const [mode, setMode] = useState<ExportMode>('combined')
  // Patch 4L — Resolution + Background collapsed under a single
  // "Advanced" toggle. Defaults to collapsed; resets to collapsed each
  // time the menu opens (don't persist across opens — predictable
  // per-action behavior; users opening the menu for a quick export
  // shouldn't see a sprawling form because they expanded Advanced
  // once previously).
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    // Patch 4L — reset Advanced to collapsed each time the menu opens.
    // Per-action behavior, not session-persisted: see comment on
    // `advancedOpen` declaration.
    setAdvancedOpen(false)
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if (btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleBg = (next: BgOption) => {
    setBg(next)
    try { window.localStorage.setItem(BG_STORAGE_KEY, next) } catch { /* ignore */ }
  }

  const handleScale = (next: RasterScale) => {
    setScale(next)
    sessionScale = next
  }

  const handleExport = async (format: ExportFormat) => {
    setError(null)
    const container = chartRef.current
    if (!container) { setError('Chart not ready'); return }
    setBusy(format)
    try {
      // No legend affordance configured: existing single-mode call, no
      // filename suffix (full backward compat with charts that have
      // always been chart-only). The state's `mode` field is ignored
      // on this path.
      if (!hasLegendAffordance) {
        await exportChart(container, filename, format, bg, scale)
        setOpen(false)
        return
      }
      // Resolve the legend element. Direct ref wins; otherwise query
      // inside the chart container via the supplied selector (covers
      // Recharts-internal legends like AESA TimelineView's).
      const legend = legendRef?.current
        ?? (legendSelector ? container.querySelector<HTMLElement>(legendSelector) : null)
      if (!legend && mode !== 'chart') {
        setError('Legend not ready')
        return
      }
      if (mode === 'legend' && legend) {
        await exportLegend(legend, filename, format, bg, scale)
      } else if (mode === 'combined' && legend) {
        await exportChartWithLegend(container, legend, filename, format, bg, scale)
      } else {
        // mode === 'chart' explicitly — add '_chart' suffix to
        // disambiguate from the unsuffixed 'combined' default and the
        // '_legend' suffix.
        await exportChart(container, filename, format, bg, scale, 'chart')
      }
      setOpen(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed'
      setError(msg)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28,
          padding: 0,
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.borderColor = 'var(--border-default)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)'
          e.currentTarget.style.borderColor = 'var(--border-subtle)'
        }}
      >
        <Download size={14} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            minWidth: 200,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            padding: '6px 0',
            fontSize: 12,
            color: 'var(--text-primary)',
          }}
        >
          {hasLegendAffordance && (
            <>
              <div style={{ padding: '4px 12px 4px', fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                Mode
              </div>
              <ModeItem
                value="combined"
                label="Chart + Legend"
                hint="default · stacked"
                current={mode}
                onSelect={setMode}
              />
              <ModeItem
                value="chart"
                label="Chart only"
                hint="suffix _chart"
                current={mode}
                onSelect={setMode}
              />
              <ModeItem
                value="legend"
                label="Legend only"
                hint="suffix _legend"
                current={mode}
                onSelect={setMode}
              />
              <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '6px 0' }} />
            </>
          )}

          <div style={{ padding: '4px 12px 6px', fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
            Export as
          </div>
          <FormatItem icon={<FileText size={14} />} label="SVG (vector)" onClick={() => handleExport('svg')} busy={busy === 'svg'} />
          <FormatItem icon={<FileText size={14} />} label="PDF (vector)" onClick={() => handleExport('pdf')} busy={busy === 'pdf'} />
          <FormatItem icon={<FileImage size={14} />} label={`PNG (${scale}×)`} onClick={() => handleExport('png')} busy={busy === 'png'} />
          <FormatItem icon={<FileImage size={14} />} label={`JPEG (${scale}×)`} onClick={() => handleExport('jpeg')} busy={busy === 'jpeg'} />

          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '6px 0' }} />
          {/*
            Patch 4L — Advanced section (Resolution + Background).
            Lighter visual weight than <CollapsibleCard>: small chevron
            + label + compact summary, no border/shadow/h3. Summary
            shows current values (`2× · Light`) so users can confirm
            defaults without expanding.
          */}
          <button
            type="button"
            role="menuitem"
            aria-expanded={advancedOpen}
            data-testid="chart-export-advanced-toggle"
            onClick={() => setAdvancedOpen((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', padding: '5px 12px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 10,
              textAlign: 'left',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-wide)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            {advancedOpen
              ? <ChevronDown size={11} />
              : <ChevronRight size={11} />}
            <span style={{ flex: 1 }}>Advanced</span>
            {!advancedOpen && (
              <span
                data-testid="chart-export-advanced-summary"
                style={{
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  textTransform: 'none',
                  letterSpacing: 0,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {scale}× · {bg === 'light' ? 'Light' : bg === 'dark' ? 'Dark' : 'Transparent'}
              </span>
            )}
          </button>

          {advancedOpen && (
            <div data-testid="chart-export-advanced-body">
              <div style={{ padding: '4px 12px 4px', fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                Resolution (PNG / JPEG)
              </div>
              <ScaleItem scale={1} hint="screen / web" current={scale} onSelect={handleScale} />
              <ScaleItem scale={2} hint="retina (default)" current={scale} onSelect={handleScale} />
              <ScaleItem scale={3} hint="academic print" current={scale} onSelect={handleScale} />
              <ScaleItem scale={4} hint="large-format" current={scale} onSelect={handleScale} />

              <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '6px 0' }} />
              <div style={{ padding: '4px 12px 4px', fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
                Background
              </div>
              <BgItem label="Light (recommended)" value="light" current={bg} onSelect={handleBg} />
              <BgItem label="Dark (current theme)" value="dark" current={bg} onSelect={handleBg} />
              <BgItem label="Transparent" value="transparent" current={bg} onSelect={handleBg} />
            </div>
          )}

          {error && (
            <div style={{
              padding: '6px 12px',
              fontSize: 11,
              color: 'var(--danger)',
              borderTop: '1px solid var(--border-subtle)',
              marginTop: 4,
            }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FormatItem({ icon, label, onClick, busy }: { icon: React.ReactNode; label: string; onClick: () => void; busy: boolean }) {
  return (
    <button
      role="menuitem"
      type="button"
      disabled={busy}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '6px 12px',
        background: 'transparent',
        color: 'var(--text-primary)',
        border: 'none',
        cursor: busy ? 'wait' : 'pointer',
        fontSize: 12,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      <span>{label}</span>
    </button>
  )
}

function ScaleItem({ scale, hint, current, onSelect }: { scale: RasterScale; hint: string; current: RasterScale; onSelect: (v: RasterScale) => void }) {
  const active = current === scale
  const label = `${scale}× — ${SCALE_HINTS[scale]}`
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      type="button"
      title={`${scale}× pixel multiplier (${SCALE_HINTS[scale]} — approximate, depends on display) · ${hint}`}
      onClick={() => onSelect(scale)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '5px 12px',
        background: 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        border: 'none',
        cursor: 'pointer',
        fontSize: 12,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        display: 'inline-block',
        width: 10, height: 10, borderRadius: '50%',
        border: '1px solid var(--border-default)',
        background: active ? 'var(--accent)' : 'transparent',
      }} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{hint}</span>
    </button>
  )
}

function ModeItem({ value, label, hint, current, onSelect }: {
  value: ExportMode
  label: string
  hint: string
  current: ExportMode
  onSelect: (v: ExportMode) => void
}) {
  const active = current === value
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      type="button"
      data-testid={`chart-export-mode-${value}`}
      onClick={() => onSelect(value)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '5px 12px',
        background: 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        border: 'none',
        cursor: 'pointer',
        fontSize: 12,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        display: 'inline-block',
        width: 10, height: 10, borderRadius: '50%',
        border: '1px solid var(--border-default)',
        background: active ? 'var(--accent)' : 'transparent',
      }} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{hint}</span>
    </button>
  )
}

function BgItem({ label, value, current, onSelect }: { label: string; value: BgOption; current: BgOption; onSelect: (v: BgOption) => void }) {
  const active = current === value
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      type="button"
      onClick={() => onSelect(value)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '5px 12px',
        background: 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        border: 'none',
        cursor: 'pointer',
        fontSize: 12,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        display: 'inline-block',
        width: 10, height: 10, borderRadius: '50%',
        border: '1px solid var(--border-default)',
        background: active ? 'var(--accent)' : 'transparent',
      }} />
      <span>{label}</span>
    </button>
  )
}
