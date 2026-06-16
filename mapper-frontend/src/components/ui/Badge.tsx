import React from 'react'

// 'mfa' is a semantic alias for the Material Flows feature, which lives under
// the DSM module — it shares the DSM accent (no dedicated --mod-mfa token).
type BadgeVariant = 'lca' | 'dsm' | 'plca' | 'aesa' | 'mfa' | 'default'

interface BadgeProps {
  label: string
  variant?: BadgeVariant
  // Override the variant's color — used for fuel-type / cohort badges that
  // should share the chart palette.
  customColor?: string
}

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  lca:     { color: 'var(--mod-lca)',  backgroundColor: 'color-mix(in srgb, var(--mod-lca) 10%, transparent)' },
  dsm:     { color: 'var(--mod-dsm)',  backgroundColor: 'color-mix(in srgb, var(--mod-dsm) 10%, transparent)' },
  plca:    { color: 'var(--mod-plca)', backgroundColor: 'color-mix(in srgb, var(--mod-plca) 10%, transparent)' },
  aesa:    { color: 'var(--mod-aesa)', backgroundColor: 'color-mix(in srgb, var(--mod-aesa) 10%, transparent)' },
  mfa:     { color: 'var(--mod-dsm)',  backgroundColor: 'color-mix(in srgb, var(--mod-dsm) 10%, transparent)' },
  default: { color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)' },
}

export function Badge({ label, variant = 'default', customColor }: BadgeProps) {
  const colorStyle: React.CSSProperties = customColor
    ? { color: customColor, backgroundColor: `color-mix(in srgb, ${customColor} 14%, transparent)` }
    : variantStyles[variant]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 8px',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        ...colorStyle,
      }}
    >
      {label}
    </span>
  )
}
