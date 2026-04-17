import React, { useState } from 'react'
import { BarChart3, Database, FlaskConical, GitBranch, Globe2, Sparkles } from 'lucide-react'

interface NavItem {
  id: string
  icon: React.ReactNode
  label: string
  color: string
}

const navItems: NavItem[] = [
  { id: 'databases', icon: <Database size={18} strokeWidth={1.5} />, label: 'Databases', color: 'var(--mod-lca)' },
  { id: 'lca',       icon: <FlaskConical size={18} strokeWidth={1.5} />, label: 'LCA Architect', color: 'var(--mod-lca)' },
  { id: 'plca',      icon: <Sparkles size={18} strokeWidth={1.5} />, label: 'pLCA Developer', color: 'var(--mod-plca)' },
  { id: 'mfa',       icon: <GitBranch size={18} strokeWidth={1.5} />, label: 'MFA Modeller', color: 'var(--mod-mfa)' },
  { id: 'impact',    icon: <BarChart3 size={18} strokeWidth={1.5} />, label: 'Impact Assessment', color: 'var(--mod-lca)' },
  { id: 'aesa',      icon: <Globe2 size={18} strokeWidth={1.5} />, label: 'AESA', color: 'var(--mod-aesa)' },
]

interface SidebarProps {
  activeItem: string
  onItemClick: (id: string) => void
}

export function Sidebar({ activeItem, onItemClick }: SidebarProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  return (
    <nav
      style={{
        gridArea: 'sidebar',
        width: 56,
        backgroundColor: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 'var(--space-3)',
        gap: 'var(--space-1)',
      }}
    >
      {navItems.map((item) => {
        const isActive = activeItem === item.id
        const isHovered = hoveredItem === item.id
        return (
          <div key={item.id} style={{ position: 'relative', width: '100%' }}>
            <button
              aria-label={item.label}
              onClick={() => onItemClick(item.id)}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              style={{
                width: '100%',
                height: 40,
                background: isActive || isHovered ? 'var(--bg-hover)' : 'transparent',
                border: 'none',
                borderLeft: isActive ? `3px solid ${item.color}` : '3px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isActive ? item.color : isHovered ? 'var(--text-primary)' : 'var(--text-secondary)',
                transition: `background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)`,
              }}
            >
              {item.icon}
            </button>
            {/* CSS tooltip */}
            {isHovered && (
              <div
                style={{
                  position: 'absolute',
                  left: 60,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 10px',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  zIndex: 100,
                  pointerEvents: 'none',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                {item.label}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
