import React from 'react'
import { Settings } from 'lucide-react'
import { ProjectSwitcher } from '../ProjectSwitcher'

interface TopbarProps {
  actions?: React.ReactNode
}

export function Topbar({ actions }: TopbarProps) {
  return (
    <header
      style={{
        gridArea: 'topbar',
        height: 48,
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        gap: 'var(--space-4)',
      }}
    >
      {/* Logo */}
      <div
        style={{
          fontWeight: 700,
          fontSize: 'var(--text-xl)',
          color: 'var(--text-primary)',
          letterSpacing: 'var(--tracking-tight)',
          flexShrink: 0,
        }}
      >
        MA<span style={{ color: 'var(--accent)' }}>pper</span>
      </div>

      {/* Center — Project Switcher */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            letterSpacing: 'var(--tracking-wide)',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          Project:
        </span>
        <ProjectSwitcher />
      </div>

      {/* Right slot — custom actions + settings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        {actions}
        <button
          aria-label="Settings"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            padding: 'var(--space-1)',
            borderRadius: 'var(--radius-sm)',
            transition: `color var(--duration-fast) var(--ease-out)`,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          <Settings size={18} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  )
}
