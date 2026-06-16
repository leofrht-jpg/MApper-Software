import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ExternalLink, Code2, Mail, PlayCircle } from 'lucide-react'
import { resetOnboarding } from '../components/OnboardingTour'
import { useThemeStore } from '../stores/themeStore'
import { THEME_ORDER, THEMES, type ThemeId } from '../styles/themes'
import {
  getHealth,
  getSystemLogs,
  downloadSystemLogs,
  getGridIntensities,
  type HealthResponse,
} from '../api/client'
import { PremiseKeyManager } from '../components/PremiseKeyManager'
import { useLogStore } from '../stores/logStore'
import { useProjectStore } from '../stores/projectStore'
import { useCarbonStore } from '../stores/carbonStore'

const APP_VERSION = '0.1.0-alpha'

type LogFilter = 'all' | 'errors' | 'warnings' | 'backend'

interface UnifiedEntry {
  key: string
  timestamp: string // ISO or parsed ISO from backend
  level: 'error' | 'warning' | 'info'
  source: 'frontend' | 'backend'
  module: string
  message: string
  stack?: string
}

export function SettingsPage() {
  const { themeId, setTheme } = useThemeStore()

  const [sysOpen, setSysOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
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

      {/* Location (for computation carbon estimate) */}
      <Section title="Location">
        <LocationPanel />
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
            Unified LCA · DSM/MFA · Prospective LCA · AESA
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
            <RestartTourButton />
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

      {/* Logs */}
      <Section title="Logs" collapsed={!logsOpen} onToggle={() => setLogsOpen((v) => !v)}>
        {logsOpen && <LogsPanel version={APP_VERSION} />}
      </Section>
    </div>
  )
}

// ── Logs panel ───────────────────────────────────────────────────────────────

export function LogsPanel({ version }: { version: string }) {
  const frontendEntries = useLogStore((s) => s.entries)
  const currentProject = useProjectStore((s) => s.currentProject)
  const [backendLines, setBackendLines] = useState<string[]>([])
  const [backendTotal, setBackendTotal] = useState(0)
  const [logPath, setLogPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<LogFilter>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Lazy fetch: only runs when the section mounts (i.e. user expanded it).
  useEffect(() => {
    let alive = true
    setLoading(true)
    getSystemLogs(500)
      .then((res) => {
        if (!alive) return
        setBackendLines(res.lines)
        setBackendTotal(res.total)
        setLogPath(res.log_path)
      })
      .catch((err) => {
        if (!alive) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [])

  const unified = useMemo(() => {
    const fromFrontend: UnifiedEntry[] = frontendEntries.map((e) => ({
      key: `f-${e.id}`,
      timestamp: e.timestamp,
      level: e.level,
      source: 'frontend',
      module: e.module,
      message: e.message,
      stack: e.stack,
    }))
    const fromBackend: UnifiedEntry[] = backendLines
      .map((ln, i) => parseBackendLine(ln, i))
      .filter((e): e is UnifiedEntry => e !== null)
    const combined = [...fromFrontend, ...fromBackend]
    // Newest first for the in-app viewer.
    combined.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    return combined
  }, [frontendEntries, backendLines])

  const filtered = useMemo(() => {
    switch (filter) {
      case 'errors': return unified.filter((e) => e.level === 'error')
      case 'warnings': return unified.filter((e) => e.level === 'warning')
      case 'backend': return unified.filter((e) => e.source === 'backend')
      default: return unified
    }
  }, [unified, filter])

  const totalAll = unified.length + Math.max(0, backendTotal - backendLines.length)

  const handleCopy = async () => {
    const text = formatExport({
      entries: unified,
      version,
      project: currentProject ?? '(none)',
    })
    await copyToClipboard(text)
  }

  // Single shared "just copied" key; resets after 1.5s. Parent owns it
  // so we don't fan out per-row state — only one entry can be the
  // "most recently copied" at a time, and the visual feedback is
  // ephemeral anyway.
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const handleCopyEntry = async (entry: UnifiedEntry) => {
    const ok = await copyToClipboard(formatEntry(entry))
    if (!ok) return
    setCopiedKey(entry.key)
    window.setTimeout(() => {
      setCopiedKey((curr) => (curr === entry.key ? null : curr))
    }, 1500)
  }

  const handleExport = async () => {
    try {
      await downloadSystemLogs()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleStack = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as LogFilter)}
          style={{
            height: 28,
            padding: '0 8px',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)',
          }}
        >
          <option value="all">All</option>
          <option value="errors">Errors only</option>
          <option value="warnings">Warnings</option>
          <option value="backend">Backend only</option>
        </select>
        <div style={{ display: 'flex', gap: 6 }}>
          <LogButton onClick={handleCopy}>Copy all</LogButton>
          <LogButton onClick={handleExport}>Export</LogButton>
        </div>
      </div>

      <Card>
        {loading && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Loading backend logs…</div>}
        {loadError && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
            Could not load backend logs: {loadError}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            No log entries yet.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {filtered.slice(0, 100).map((e) => (
            <LogRow
              key={e.key}
              entry={e}
              expanded={expanded.has(e.key)}
              onToggle={() => toggleStack(e.key)}
              justCopied={copiedKey === e.key}
              onCopy={() => handleCopyEntry(e)}
            />
          ))}
        </div>

        <div style={{ marginTop: 10, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Showing {Math.min(filtered.length, 100)} of {totalAll} entries
          {logPath && <> · <span style={{ fontFamily: 'var(--font-mono)' }}>{logPath}</span></>}
        </div>
      </Card>

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        If you encounter an issue, copy these logs and send to{' '}
        <a href="mailto:leo_frht@icloud.com" style={{ color: 'var(--accent)' }}>leo_frht@icloud.com</a>.
      </div>
    </div>
  )
}

function LogRow({ entry, expanded, onToggle, justCopied, onCopy }: {
  entry: UnifiedEntry
  expanded: boolean
  onToggle: () => void
  justCopied: boolean
  onCopy: () => void
}) {
  const levelColor = entry.level === 'error'
    ? 'var(--danger)'
    : entry.level === 'warning'
    ? 'var(--warning, #d97706)'
    : 'var(--text-secondary)'
  const levelTag = entry.level === 'error' ? 'ERROR' : entry.level === 'warning' ? 'WARN ' : 'INFO '
  const time = formatTime(entry.timestamp)
  return (
    <div
      style={{
        padding: '8px 0',
        borderBottom: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        lineHeight: 1.5,
      }}
    >
      <div style={{ color: levelColor }}>
        <span style={{ fontWeight: 700 }}>[{levelTag}]</span>{' '}
        <span style={{ color: 'var(--text-tertiary)' }}>{time} · {entry.source}/{entry.module}</span>
      </div>
      <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {entry.message}
      </div>
      {entry.stack && (
        <>
          <button
            onClick={onToggle}
            style={{
              marginTop: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
          {expanded && (
            <div style={{ position: 'relative', marginTop: 6 }}>
              <button
                type="button"
                data-testid={`log-entry-copy-${entry.key}`}
                onClick={onCopy}
                title="Copy this entry to clipboard"
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-surface, var(--bg-base))',
                  color: justCopied ? 'var(--success, #16a34a)' : 'var(--text-secondary)',
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  zIndex: 1,
                }}
              >
                {justCopied ? 'Copied ✓' : 'Copy'}
              </button>
              <pre
                style={{
                  margin: 0,
                  padding: '8px 64px 8px 8px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-xs)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 280,
                  overflow: 'auto',
                }}
              >
                {entry.stack}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function LogButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
        fontSize: 'var(--text-xs)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// ── parsing / formatting ─────────────────────────────────────────────────────

function parseBackendLine(line: string, idx: number): UnifiedEntry | null {
  // Expected format: [YYYY-MM-DD HH:MM:SS] [LEVEL] [module] message
  const m = line.match(/^\[([^\]]+)\] \[([^\]]+)\] \[([^\]]+)\] (.*)$/)
  if (!m) return null
  const [, ts, lvlRaw, module, message] = m
  const lvl = lvlRaw.trim().toUpperCase()
  const level: UnifiedEntry['level'] =
    lvl === 'ERROR' || lvl === 'CRITICAL' ? 'error' : lvl === 'WARNING' || lvl === 'WARN' ? 'warning' : 'info'
  // Convert "2026-04-22 14:32:01" → "2026-04-22T14:32:01" for consistent sort
  const iso = ts.replace(' ', 'T')
  return {
    key: `b-${idx}`,
    timestamp: iso,
    level,
    source: 'backend',
    module: module.trim(),
    message,
  }
}

function formatTime(ts: string): string {
  // Prefer HH:MM:SS for display
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toTimeString().slice(0, 8)
}

function formatEntry(e: UnifiedEntry): string {
  const tag = e.level === 'error' ? 'ERROR' : e.level === 'warning' ? 'WARN ' : 'INFO '
  const ts = e.timestamp.replace('T', ' ').slice(0, 19)
  const src = e.source === 'backend' ? e.module : `${e.source}/${e.module}`
  const main = `[${tag}] ${ts} [${src}] ${e.message}`
  return e.stack ? `${main}\n${e.stack}` : main
}

function formatExport({ entries, version, project }: { entries: UnifiedEntry[]; version: string; project: string }): string {
  const now = new Date()
  const header = [
    `MApper Logs — exported ${now.toISOString().slice(0, 19).replace('T', ' ')}`,
    `Version: ${version}`,
    `Platform: ${navigator.userAgent}`,
    `Project: ${project}`,
    '',
  ]
  return [...header, ...entries.map(formatEntry)].join('\n')
}

// Shared clipboard helper. Same fallback strategy as the top-level
// "Copy all" button — `navigator.clipboard` isn't available in
// non-secure contexts, so we route through a transient textarea +
// execCommand. Returns true on best-effort success so callers can
// flip a "Copied" indicator without distinguishing the two paths.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      document.body.removeChild(ta)
      return false
    }
  }
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

function RestartTourButton() {
  const handleClick = () => {
    resetOnboarding()
    window.__mapperStartTour?.()
  }
  return (
    <button
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
      }}
    >
      <PlayCircle size={12} />
      Restart tour
    </button>
  )
}

function LocationPanel() {
  const countries = useCarbonStore((s) => s.countries)
  const countryCode = useCarbonStore((s) => s.country_code)
  const intensity = useCarbonStore((s) => s.grid_intensity_g_per_kwh)
  const gridYear = useCarbonStore((s) => s.grid_year)
  const gridSource = useCarbonStore((s) => s.grid_source)
  const tdpOverride = useCarbonStore((s) => s.tdp_override)
  const setCountry = useCarbonStore((s) => s.setCountry)
  const setCountries = useCarbonStore((s) => s.setCountries)
  const setTdpOverride = useCarbonStore((s) => s.setTdpOverride)

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [tdpInput, setTdpInput] = useState<string>(tdpOverride != null ? String(tdpOverride) : '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (countries.length > 0) return
    getGridIntensities()
      .then((res) => setCountries(res.countries, res.eu_average, res.world_average))
      .catch((e) => setError(e?.message || 'Failed to load grid intensities'))
  }, [countries.length, setCountries])

  const options = useMemo(() => {
    return [...countries].sort((a, b) => a.name.localeCompare(b.name))
  }, [countries])

  return (
    <Card>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 14 }}>
        Your country determines the grid carbon intensity used to estimate CO<sub>2</sub> from the computation energy. Defaults to world average.
      </div>

      {error && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zone-high-risk, #ff6b6b)', marginBottom: 10 }}>
          {error}
        </div>
      )}

      <label
        style={{
          display: 'block',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-tertiary)',
          marginBottom: 6,
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
        }}
      >
        Country
      </label>
      <select
        value={countryCode}
        onChange={(e) => setCountry(e.target.value)}
        disabled={options.length === 0}
        style={{
          width: '100%',
          maxWidth: 360,
          padding: '8px 10px',
          background: 'var(--surface-1)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6,
          fontSize: 'var(--text-sm)',
        }}
      >
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} — {c.intensity} g CO₂/kWh
          </option>
        ))}
      </select>

      <div style={{ marginTop: 10, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        Grid intensity: <b style={{ color: 'var(--text-secondary)' }}>{intensity} g CO₂/kWh</b> · {gridSource} · {gridYear}
      </div>

      <div style={{ marginTop: 18 }}>
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--text-tertiary)',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced
        </button>
        {advancedOpen && (
          <div style={{ marginTop: 10, paddingLeft: 18 }}>
            <label
              style={{
                display: 'block',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-tertiary)',
                marginBottom: 6,
              }}
            >
              CPU TDP override (watts)
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="auto"
                value={tdpInput}
                onChange={(e) => setTdpInput(e.target.value)}
                onBlur={() => {
                  const trimmed = tdpInput.trim()
                  if (trimmed === '') {
                    setTdpOverride(null)
                  } else {
                    const n = Number(trimmed)
                    if (Number.isFinite(n) && n > 0) setTdpOverride(n)
                    else setTdpInput(tdpOverride != null ? String(tdpOverride) : '')
                  }
                }}
                style={{
                  width: 120,
                  padding: '6px 8px',
                  background: 'var(--surface-1)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  fontSize: 'var(--text-sm)',
                }}
              />
              <button
                onClick={() => {
                  setTdpOverride(null)
                  setTdpInput('')
                }}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-subtle)',
                  padding: '5px 10px',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-xs)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Reset
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Leave blank to auto-detect (Apple Silicon: 15 W · x86: 28 W). Only override if you know your CPU's typical active power.
            </div>
          </div>
        )}
      </div>
    </Card>
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
