import { useEffect, useRef, useState } from 'react'
import { CHART_PALETTE, setLabelColor, clearLabelColor } from '../../utils/chartColors'

// Patch 4AJ → 4AK — color picker popover.
//
// Two coexisting color layers (see CLAUDE.md "Patch 4AK — two-layer
// color overrides"):
//
//   - Per-dimension (Patch 4AJ): a single dim value (e.g. 'BEV-LFP')
//     gets a color applied to EVERY chart where the chart is stacked
//     by that single dimension. Persisted in localStorage via
//     ``setLabelColor`` / ``clearLabelColor``.
//
//   - Per-row (Patch 4AK): one (fuel, size) cohort row gets a color
//     applied to both pills in that row AND to the cohort-key stacked
//     chart slot. Persisted backend-side via ``setRowColor`` /
//     ``clearRowColor`` from ``dsmStore``.
//
// The picker shows BOTH affordances behind a tab toggle. Defaults to
// "This row" because it's the more specific (and per the user spec
// more commonly-used) workflow.

export type PickerMode = 'row' | 'dim'

interface Props {
  label: string                  // the dim value (e.g., 'BEV-LFP')
  cohortKey: string | null       // the row's cohort_key (e.g., 'BEV-LFP|Small'); null disables row mode
  currentDimColor: string        // resolved per-dim color
  currentRowColor: string | null // resolved per-row color (null = no override)
  anchorRect: DOMRect | null
  hasDimOverride: boolean
  hasRowOverride: boolean
  scope?: string | null          // per-dim storage scope (active project)
  onSetRowColor?: (cohortKey: string, color: string) => void | Promise<void>
  onClearRowColor?: (cohortKey: string) => void | Promise<void>
  initialMode?: PickerMode
  onClose: () => void
}

function isValidHex(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s)
}

export function DimensionColorPicker({
  label,
  cohortKey,
  currentDimColor,
  currentRowColor,
  anchorRect,
  hasDimOverride,
  hasRowOverride,
  scope,
  onSetRowColor,
  onClearRowColor,
  initialMode = 'row',
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const canPickRow = cohortKey != null && onSetRowColor != null
  // If row mode is unavailable, fall back to dim.
  const [mode, setMode] = useState<PickerMode>(canPickRow ? initialMode : 'dim')

  const activeCurrent = mode === 'row' ? (currentRowColor ?? currentDimColor) : currentDimColor
  const activeHasOverride = mode === 'row' ? hasRowOverride : hasDimOverride

  const [hex, setHex] = useState(activeCurrent)
  const [hexError, setHexError] = useState(false)

  // Resync hex preview when mode changes (the "current color" differs
  // between layers).
  useEffect(() => {
    setHex(activeCurrent)
    setHexError(false)
  }, [activeCurrent])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocClick)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const applyColor = (color: string) => {
    if (mode === 'row') {
      if (cohortKey && onSetRowColor) void onSetRowColor(cohortKey, color)
    } else {
      setLabelColor(label, color, scope)
    }
    onClose()
  }

  const handleHexSubmit = () => {
    const trimmed = hex.trim()
    if (!isValidHex(trimmed)) {
      setHexError(true)
      return
    }
    applyColor(trimmed.toLowerCase())
  }

  const handleReset = () => {
    if (mode === 'row') {
      if (cohortKey && onClearRowColor) void onClearRowColor(cohortKey)
    } else {
      clearLabelColor(label, scope)
    }
    onClose()
  }

  const style: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: Math.min(anchorRect.bottom + 6, window.innerHeight - 260),
        left: Math.min(anchorRect.left, window.innerWidth - 280),
        zIndex: 9999,
      }
    : { position: 'fixed', top: 80, left: 80, zIndex: 9999 }

  return (
    <div
      ref={ref}
      data-testid="dimension-color-picker"
      style={{
        ...style,
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        padding: 'var(--space-3)',
        width: 268,
      }}
    >
      {/* Mode tabs */}
      {canPickRow && (
        <div
          data-testid="dimension-color-picker-mode-tabs"
          style={{
            display: 'flex', gap: 0, marginBottom: 8,
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', overflow: 'hidden',
          }}
        >
          <button
            data-testid="dimension-color-picker-mode-row"
            onClick={() => setMode('row')}
            style={{
              flex: 1, height: 26, padding: '0 8px',
              backgroundColor: mode === 'row' ? 'var(--accent-default)' : 'var(--bg-surface)',
              color: mode === 'row' ? 'white' : 'var(--text-primary)',
              border: 'none', fontSize: 'var(--text-xs)', fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            This row
          </button>
          <button
            data-testid="dimension-color-picker-mode-dim"
            onClick={() => setMode('dim')}
            style={{
              flex: 1, height: 26, padding: '0 8px',
              backgroundColor: mode === 'dim' ? 'var(--accent-default)' : 'var(--bg-surface)',
              color: mode === 'dim' ? 'white' : 'var(--text-primary)',
              border: 'none', fontSize: 'var(--text-xs)', fontWeight: 500,
              cursor: 'pointer',
              borderLeft: '1px solid var(--border-default)',
            }}
          >
            All {label}
          </button>
        </div>
      )}

      <div style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)',
        marginBottom: 8,
      }}>
        {mode === 'row'
          ? <>Color for row <span style={{ color: 'var(--text-primary)' }}>{cohortKey?.replace(/\|/g, ' × ')}</span></>
          : <>Color for all <span style={{ color: 'var(--text-primary)' }}>{label}</span></>
        }
      </div>

      <div
        data-testid="dimension-color-picker-presets"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3, marginBottom: 10 }}
      >
        {CHART_PALETTE.map((c) => (
          <button
            key={c}
            data-testid={`dimension-color-picker-preset-${c}`}
            onClick={() => applyColor(c)}
            title={c}
            style={{
              width: 18, height: 18, borderRadius: 'var(--radius-sm)',
              backgroundColor: c,
              border: c.toLowerCase() === activeCurrent.toLowerCase()
                ? '2px solid var(--text-primary)'
                : '1px solid var(--border-subtle)',
              cursor: 'pointer', padding: 0,
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <input
          data-testid="dimension-color-picker-hex"
          type="text"
          value={hex}
          onChange={(e) => { setHex(e.target.value); setHexError(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleHexSubmit() }}
          placeholder="#1a2b3c"
          style={{
            flex: 1, height: 26, padding: '0 8px',
            backgroundColor: 'var(--bg-elevated)',
            border: `1px solid ${hexError ? 'var(--danger)' : 'var(--border-default)'}`,
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            outline: 'none',
          }}
        />
        <button
          data-testid="dimension-color-picker-hex-apply"
          onClick={handleHexSubmit}
          style={{
            height: 26, padding: '0 10px',
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
      </div>

      <button
        data-testid="dimension-color-picker-reset"
        onClick={handleReset}
        disabled={!activeHasOverride}
        style={{
          width: '100%', height: 26,
          backgroundColor: 'transparent',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          color: activeHasOverride ? 'var(--text-primary)' : 'var(--text-tertiary)',
          fontSize: 'var(--text-xs)',
          cursor: activeHasOverride ? 'pointer' : 'not-allowed',
          opacity: activeHasOverride ? 1 : 0.6,
        }}
        title={activeHasOverride
          ? `Restore the auto-assigned color for ${mode === 'row' ? 'this row' : 'all ' + label}`
          : 'No override to reset'}
      >
        Reset to auto
      </button>
    </div>
  )
}
