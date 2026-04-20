import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Eye, EyeOff, Loader2, Mail, Trash2, X } from 'lucide-react'
import { Button } from './ui/Button'
import {
  deletePremiseKey,
  getPremiseKeyStatus,
  savePremiseKey,
  type PremiseKeyStatus,
} from '../api/client'

const FERNET_KEY_PATTERN = /^[A-Za-z0-9_-]{43}=$/

function looksLikeFernetKey(s: string): boolean {
  return FERNET_KEY_PATTERN.test(s.trim())
}

interface Props {
  /** 'banner' = first-time setup inside PLCADeveloper; 'panel' = Settings page section. */
  variant: 'banner' | 'panel'
  /** Called after a successful save/delete so parents can refresh. */
  onStatusChange?: (configured: boolean) => void
}

export function PremiseKeyManager({ variant, onStatusChange }: Props) {
  const [status, setStatus] = useState<PremiseKeyStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const s = await getPremiseKeyStatus()
      setStatus(s)
      onStatusChange?.(s.configured)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => { void refresh() }, [])

  // For banner variant, input is always visible when key is missing
  const inputVisible = variant === 'banner' ? !status?.configured : editing

  const trimmed = keyInput.trim()
  const formatValid = trimmed.length === 0 ? null : looksLikeFernetKey(trimmed)

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      await savePremiseKey(trimmed)
      setKeyInput('')
      setEditing(false)
      setShowKey(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Remove the saved premise key? You will need to paste it again to generate prospective databases.')) return
    setError(null)
    setDeleting(true)
    try {
      await deletePremiseKey()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  // ── Banner variant: first-time setup inside pLCA Developer ─────────────────
  if (variant === 'banner') {
    if (status?.configured) {
      return (
        <div style={bannerStyle(true)}>
          <Check size={14} strokeWidth={2} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: 'var(--success)' }}>Premise key configured</div>
            <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
              Stored at <code style={monoStyle}>{status.path}</code>. Manage it from Settings.
            </div>
          </div>
        </div>
      )
    }
    return (
      <div style={bannerStyle(false)}>
        <AlertTriangle size={14} strokeWidth={2} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Premise key not configured</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              Paste your Fernet key below, or{' '}
              <a href="mailto:romain.sacchi@psi.ch" style={linkStyle}>
                request one from romain.sacchi@psi.ch
              </a>
              .
            </div>
          </div>
          <KeyInputRow
            value={keyInput}
            onChange={setKeyInput}
            show={showKey}
            onToggleShow={() => setShowKey((v) => !v)}
            disabled={saving}
            formatValid={formatValid}
            onSubmit={handleSave}
            saving={saving}
          />
          {error && <div style={errorStyle}>{error}</div>}
        </div>
      </div>
    )
  }

  // ── Panel variant: Settings page section ───────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {status?.configured ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
            <Check size={14} /> Key configured
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--warning)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
            <X size={14} /> Not configured
          </span>
        )}
        {status?.path && (
          <code style={{ ...monoStyle, color: 'var(--text-tertiary)' }}>{status.path}</code>
        )}
      </div>

      {!editing && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => { setEditing(true); setKeyInput('') }}>
            {status?.configured ? 'Update key' : 'Add key'}
          </Button>
          {status?.configured && (
            <Button variant="ghost" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
              Remove key
            </Button>
          )}
          <a href="mailto:romain.sacchi@psi.ch" style={{ ...linkButtonStyle }}>
            <Mail size={12} /> Request a key
          </a>
        </div>
      )}

      {inputVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <KeyInputRow
            value={keyInput}
            onChange={setKeyInput}
            show={showKey}
            onToggleShow={() => setShowKey((v) => !v)}
            disabled={saving}
            formatValid={formatValid}
            onSubmit={handleSave}
            saving={saving}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => { setEditing(false); setKeyInput(''); setError(null) }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <div style={errorStyle}>{error}</div>}

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        The premise Fernet key decrypts the scenario data packages distributed with premise. It is stored locally —
        never sent anywhere except your backend filesystem.
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } } .spin { animation: spin 1s linear infinite }`}</style>
    </div>
  )
}

// ── Shared input row ────────────────────────────────────────────────────────

function KeyInputRow({
  value, onChange, show, onToggleShow, disabled, formatValid, onSubmit, saving,
}: {
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggleShow: () => void
  disabled: boolean
  formatValid: boolean | null
  onSubmit: () => void
  saving: boolean
}) {
  const canSubmit = formatValid === true && !saving
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) onSubmit() }}
            placeholder="Paste your premise key"
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            style={{
              width: '100%', height: 32, padding: '0 36px 0 10px',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
              color: 'var(--text-primary)',
              backgroundColor: 'var(--bg-elevated)',
              border: `1px solid ${formatValid === false ? 'var(--danger)' : 'var(--border-default)'}`,
              borderRadius: 'var(--radius-sm)',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={onToggleShow}
            title={show ? 'Hide' : 'Show'}
            style={{
              position: 'absolute', right: 4, top: 4, width: 24, height: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0,
            }}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <Button onClick={onSubmit} disabled={!canSubmit}>
          {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
          Save key
        </Button>
      </div>
      {formatValid === true && (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Check size={12} /> Valid format
        </span>
      )}
      {formatValid === false && (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <X size={12} /> Invalid key format — expected 44 base64 characters
        </span>
      )}
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

function bannerStyle(ok: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: 'var(--space-3) var(--space-4)',
    backgroundColor: ok ? 'var(--success-muted, color-mix(in srgb, var(--success) 12%, transparent))' : 'var(--warning-muted)',
    border: `1px solid ${ok ? 'var(--success)' : 'var(--warning)'}`,
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-primary)',
    flexShrink: 0,
  }
}

const monoStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
}

const linkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'underline',
}

const linkButtonStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  cursor: 'pointer',
}

const errorStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 'var(--text-xs)',
  color: 'var(--danger)',
  backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
  border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
  borderRadius: 'var(--radius-sm)',
}
