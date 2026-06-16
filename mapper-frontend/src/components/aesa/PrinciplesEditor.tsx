import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAESAStore } from '../../stores/aesaStore'
import type { PrincipleDefinition } from '../../api/client'

/** Custom-principle manager. Lists all principles defined on the active preset
 *  with add / edit / delete. Prevents deletion of principles referenced by any
 *  layer data or category assignment. */
export function PrinciplesEditor() {
  const { draft, updatePrinciples } = useAESAStore()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState<PrincipleDefinition | null>(null)
  const [isNew, setIsNew] = useState(false)

  const readOnly = !!draft?.sharing.built_in

  /** principle_id → usage description (first found), used to block deletion. */
  const inUse = useMemo(() => {
    const usage: Record<string, string> = {}
    if (!draft) return usage
    for (const a of draft.sharing.category_assignments) {
      if (!usage[a.principle_id]) usage[a.principle_id] = `assigned to ${a.pb_id}`
    }
    for (const ly of draft.sharing.chain.layers) {
      if (ly.principle_mode === 'fixed' && ly.fixed_principle) {
        if (!usage[ly.fixed_principle]) {
          usage[ly.fixed_principle] = `fixed in layer ${ly.layer_number}`
        }
      }
      for (const pid of Object.keys(ly.data ?? {})) {
        if (!usage[pid]) usage[pid] = `has data in layer ${ly.layer_number}`
      }
    }
    return usage
  }, [draft])

  if (!draft) return null

  const principles = draft.sharing.principles

  const openNew = () => { setIsNew(true); setEditing({ id: '', name: '', description: '' }) }
  const openEdit = (p: PrincipleDefinition) => { setIsNew(false); setEditing({ ...p }) }

  const save = (p: PrincipleDefinition) => {
    const trimmed: PrincipleDefinition = {
      id: p.id.trim(), name: p.name.trim() || p.id.trim(), description: p.description ?? '',
    }
    if (!trimmed.id) { alert('Principle id is required.'); return }
    if (isNew && principles.some((x) => x.id === trimmed.id)) {
      alert(`A principle with id "${trimmed.id}" already exists.`)
      return
    }
    const next = isNew
      ? [...principles, trimmed]
      : principles.map((x) => x.id === editing?.id ? trimmed : x)
    updatePrinciples(next)
    setEditing(null); setIsNew(false)
  }

  const remove = (id: string) => {
    if (inUse[id]) {
      alert(`Cannot delete "${id}" — ${inUse[id]}. Remove the reference first.`)
      return
    }
    if (!confirm(`Delete principle "${id}"?`)) return
    updatePrinciples(principles.filter((x) => x.id !== id))
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: 11, fontWeight: 500,
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{principles.length} principle{principles.length === 1 ? '' : 's'}</span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
          {principles.map((p) => p.id).join(', ') || '—'}
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {principles.map((p) => (
            <div key={p.id} style={row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {p.name} <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>({p.id})</span>
                </div>
                {p.description && (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                    {p.description}
                  </div>
                )}
                {inUse[p.id] && (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1, fontStyle: 'italic' }}>
                    in use — {inUse[p.id]}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => openEdit(p)} style={iconBtn} title="Edit" disabled={readOnly}>
                  <Pencil size={11} />
                </button>
                <button
                  onClick={() => remove(p.id)}
                  style={{ ...iconBtn, color: inUse[p.id] || readOnly ? 'var(--text-tertiary)' : 'var(--danger)' }}
                  title={readOnly ? 'Read-only preset' : inUse[p.id] ? `In use — ${inUse[p.id]}` : 'Delete'}
                  disabled={readOnly || !!inUse[p.id]}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={openNew}
            disabled={readOnly}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
              background: 'transparent',
              border: '1px dashed var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              padding: '3px 8px', fontSize: 10,
              cursor: readOnly ? 'not-allowed' : 'pointer',
              opacity: readOnly ? 0.5 : 1,
            }}
          >
            <Plus size={10} /> Add principle
          </button>
        </div>
      )}

      {editing && (
        <PrincipleEditModal
          value={editing}
          isNew={isNew}
          onClose={() => { setEditing(null); setIsNew(false) }}
          onSave={save}
        />
      )}
    </div>
  )
}

function PrincipleEditModal({
  value, isNew, onClose, onSave,
}: {
  value: PrincipleDefinition
  isNew: boolean
  onClose: () => void
  onSave: (p: PrincipleDefinition) => void
}) {
  const [draft, setDraft] = useState(value)

  return (
    <div
      style={backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={modal}>
        <header style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {isNew ? 'Add principle' : `Edit "${value.id}"`}
          </div>
        </header>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="ID" hint="Short code (e.g. GDP, HDI). Cannot change after creation.">
            <input
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              disabled={!isNew}
              style={input}
            />
          </Field>
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={input}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              style={{ ...input, height: 'auto', padding: '6px 8px', resize: 'vertical' }}
            />
          </Field>
        </div>
        <footer style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '10px 14px', borderTop: '1px solid var(--border-subtle)',
        }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button
            onClick={() => onSave(draft)}
            style={{
              ...ghostBtn,
              background: 'var(--mod-aesa)',
              color: 'var(--bg-app)',
              borderColor: 'var(--mod-aesa)',
            }}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
      }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{hint}</span>}
    </label>
  )
}

// Stub — unused here, but keeps the Lock icon import resolved for consumers.
void Lock

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 6,
  padding: 6,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22,
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  cursor: 'pointer', padding: 0,
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1001,
}

const modal: React.CSSProperties = {
  width: 'min(420px, 92vw)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
}

const input: React.CSSProperties = {
  width: '100%', height: 28,
  padding: '4px 8px', fontSize: 11,
  color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none', fontFamily: 'inherit',
}

const ghostBtn: React.CSSProperties = {
  padding: '5px 10px', fontSize: 11, fontWeight: 500,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
}
