import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ExternalLink, Code2, Mail } from 'lucide-react'
import { useThemeStore } from '../stores/themeStore'
import { THEME_ORDER, THEMES, type ThemeId } from '../styles/themes'
import { getHealth, type HealthResponse } from '../api/client'
import { PremiseKeyManager } from '../components/PremiseKeyManager'

const APP_VERSION = '0.1.0-beta'

export function SettingsPage() {
  const { themeId, setTheme } = useThemeStore()

  const [sysOpen, setSysOpen] = useState(false)
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <header>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Settings
        </h1>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: 4 }}>
          Personalize appearance and review app information.
        </div>
      </header>

      {/* Appearance */}
      <Section title="Appearance">
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 14 }}>
          Accent color · only the accent changes, backgrounds stay dark
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16, maxWidth: 400 }}>
          {THEME_ORDER.map((id) => (
            <Swatch key={id} id={id} active={themeId === id} onPick={() => setTheme(id)} />
          ))}
        </div>
        <div style={{ marginTop: 14, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          AESA zone colors (Safe · Uncertainty · High Risk) are semantic and never change.
        </div>
      </Section>

      {/* Premise */}
      <Section title="Premise">
        <Card>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 14 }}>
            Prospective LCA databases are generated with{' '}
            <a href="https://github.com/polca/premise" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>premise</a>, which requires a Fernet decryption key.
          </div>
          <PremiseKeyManager variant="panel" />
        </Card>
      </Section>

      {/* About */}
      <Section title="About">
        <Card>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)' }}>MApper</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              v{APP_VERSION}
            </div>
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
            Unified LCA · MFA · Prospective LCA · AESA
          </div>

          <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', lineHeight: 1.6 }}>
            Developed by <b>Leonardo Ferhati</b>
            <br />
            <span style={{ color: 'var(--text-secondary)' }}>DTU Wind and Energy Systems</span>
            <br />
            <span style={{ color: 'var(--text-secondary)' }}>DTU Centre for Absolute Sustainability</span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            <LinkButton href="https://mapper.leonardoferhati.com" icon={<ExternalLink size={12} />}>
              Website
            </LinkButton>
            <LinkButton href="mailto:leo_frht@icloud.com" icon={<Mail size={12} />}>
              leo_frht@icloud.com
            </LinkButton>
            <LinkButton icon={<Code2 size={12} />} disabled>
              GitHub · coming soon
            </LinkButton>
          </div>

          <div style={{ marginTop: 16, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Built with React · FastAPI · Brightway2 · Tauri
          </div>
        </Card>
      </Section>

      {/* System Info */}
      <Section title="System Information" collapsed={!sysOpen} onToggle={() => setSysOpen((v) => !v)}>
        {sysOpen && (
          <Card>
            <Row k="Version" v={APP_VERSION} />
            <Row k="Frontend" v="React 19 · Vite · TypeScript · Zustand · Recharts" />
            <Row k="Backend" v={`FastAPI · Brightway2${health ? ` ${health.brightway2_version}` : ''}`} />
            <Row k="Desktop shell" v="Tauri v2" />
            <Row k="Platform" v={navigator.platform || '—'} />
          </Card>
        )}
      </Section>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
  collapsed,
  onToggle,
}: {
  title: string
  children: React.ReactNode
  collapsed?: boolean
  onToggle?: () => void
}) {
  const collapsible = typeof collapsed === 'boolean'
  return (
    <section>
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
          marginBottom: 14,
        }}
      >
        {collapsible && (
          <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
        <h2
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            color: 'var(--text-tertiary)',
            margin: 0,
          }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

function Swatch({ id, active, onPick }: { id: ThemeId; active: boolean; onPick: () => void }) {
  const t = THEMES[id]
  return (
    <button
      onClick={onPick}
      aria-label={t.label}
      title={t.label}
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: t.accent,
        border: active ? `2px solid var(--text-primary)` : '2px solid transparent',
        outline: active ? `2px solid ${t.accent}` : 'none',
        outlineOffset: 2,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        transition: 'transform var(--duration-fast) var(--ease-out)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {active && <Check size={18} strokeWidth={3} color="#fff" />}
    </button>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
      }}
    >
      {children}
    </div>
  )
}

function LinkButton({
  href,
  icon,
  children,
  disabled,
}: {
  href?: string
  icon: React.ReactNode
  children: React.ReactNode
  disabled?: boolean
}) {
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)',
    fontSize: 'var(--text-xs)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
    textDecoration: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }
  if (disabled || !href) {
    return <span style={style}>{icon}{children}</span>
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" style={style}>
      {icon}
      {children}
    </a>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 12,
        padding: '6px 0',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <div style={{ color: 'var(--text-tertiary)' }}>{k}</div>
      <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
        {v}
      </div>
    </div>
  )
}
