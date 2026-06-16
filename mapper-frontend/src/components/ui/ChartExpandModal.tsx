import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// Patch 4AL — reusable single-chart expand modal.
//
// Grid-of-charts views (Impact Assessment by-cohort, future AESA
// Radar / Material Flows adopters) render small chart facets at
// overview size. Click an expand icon on any facet to open this
// modal with the chart at full size for detailed inspection.
//
// Discipline (per Patch 4X stacking-context rule): portals to
// `document.body`. Renders above any position:sticky / transform
// parents that would otherwise trap z-index. Backdrop click + Esc +
// close-X all dismiss. Pure composition — children render whatever
// chart shape the parent passes in; the modal owns only the chrome
// (backdrop, header, close action).

export interface ChartExpandModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  /** Optional action slot in the header (right of title, left of close).
   *  Use for export buttons, auto-fit toggle, format picker, etc. */
  actions?: React.ReactNode
  children: React.ReactNode
}

export function ChartExpandModal({
  isOpen, onClose, title, actions, children,
}: ChartExpandModalProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      data-testid="chart-expand-modal-backdrop"
      onClick={(e) => {
        // Click outside the modal body dismisses. Clicks inside the
        // body (chart hover, legend, export) bubble normally.
        if (!bodyRef.current) return
        if (!bodyRef.current.contains(e.target as Node)) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div
        ref={bodyRef}
        data-testid="chart-expand-modal"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          // Cap at 95% of viewport so large monitors don't sprawl.
          width: 'min(1200px, 95vw)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <h3
            data-testid="chart-expand-modal-title"
            style={{
              margin: 0,
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {actions}
            <button
              data-testid="chart-expand-modal-close"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28, height: 28,
                background: 'none',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
        {/* Body */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 'var(--space-4)',
        }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
