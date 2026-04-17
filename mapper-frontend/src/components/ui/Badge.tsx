import React from 'react'

type BadgeVariant = 'lca' | 'mfa' | 'plca' | 'aesa' | 'default'

interface BadgeProps {
  label: string
  variant?: BadgeVariant
}

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  lca:     { color: 'var(--mod-lca)',  backgroundColor: 'color-mix(in srgb, var(--mod-lca) 10%, transparent)' },
  mfa:     { color: 'var(--mod-mfa)',  backgroundColor: 'color-mix(in srgb, var(--mod-mfa) 10%, transparent)' },
  plca:    { color: 'var(--mod-plca)', backgroundColor: 'color-mix(in srgb, var(--mod-plca) 10%, transparent)' },
  aesa:    { color: 'var(--mod-aesa)', backgroundColor: 'color-mix(in srgb, var(--mod-aesa) 10%, transparent)' },
  default: { color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)' },
}

export function Badge({ label, variant = 'default' }: BadgeProps) {
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
        ...variantStyles[variant],
      }}
    >
      {label}
    </span>
  )
}
