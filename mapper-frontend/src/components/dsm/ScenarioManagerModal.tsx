import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Edit2, Eye, Plus, Star, Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { useDSMStore } from '../../stores/dsmStore'
import type { DSMScenario } from '../../api/client'
import { SlotDataViewer, type SlotKey } from './SlotDataViewer'

interface ScenarioManagerModalProps {
  onClose: () => void
}

const SLOT_DEFS: ReadonlyArray<{ key: keyof DSMScenario; label: string; short: string }> = [
  { key: 'initial_stock', label: 'Initial stock', short: 'Stock' },
  { key: 'inflows', label: 'Inflows', short: 'Inflows' },
  { key: 'outflows', label: 'Outflows', short: 'Outflows' },
  { key: 'stock_targets', label: 'Stock targets', short: 'Targets' },
  { key: 'mode_configs', label: 'Mode configs', short: 'Modes' },
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  padding: '0 10px',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
}

/** True when the slot is explicitly set on this scenario (not inheriting). */
function slotOwned(scenario: DSMScenario, slot: keyof DSMScenario): boolean {
  const v = scenario[slot]
  return v !== null && v !== undefined
}

export function ScenarioManagerModal({ onClose }: ScenarioManagerModalProps) {
  const systemState = useDSMStore((s) => s.systemState)
  const createScenario = useDSMStore((s) => s.createScenario)
  const renameScenario = useDSMStore((s) => s.renameScenario)
  const duplicateScenario = useDSMStore((s) => s.duplicateScenario)
  const deleteScenario = useDSMStore((s) => s.deleteScenario)
  const activateScenario = useDSMStore((s) => s.activateScenario)
  const promoteScenarioToBase = useDSMStore((s) => s.promoteScenarioToBase)

  const scenarios = systemState?.scenarios ?? []
  const activeId = systemState?.active_scenario_id ?? null

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [promoteTarget, setPromoteTarget] = useState<DSMScenario | null>(null)
  const [viewSlot, setViewSlot] = useState<{ scenarioId: string; slotKey: SlotKey } | null>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleCreate = async () => {
    const name = window.prompt('New scenario name:')
    if (!name?.trim()) return
    setBusy(true); setError(null)
    try {
      const copyPrompt = window.confirm(
        'Copy data from the Base scenario? OK = fork Base (all current data becomes editable), Cancel = start empty (inherits from Base).',
      )
      await createScenario({
        name: name.trim(),
        copyFrom: copyPrompt ? 'base' : undefined,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDuplicate = async (scen: DSMScenario) => {
    const name = window.prompt(`Duplicate "${scen.name}" as:`, `${scen.name} copy`)
    if (!name?.trim()) return
    setBusy(true); setError(null)
    try {
      await duplicateScenario(scen.id, name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (scen: DSMScenario) => {
    if (scen.is_base) return
    if (!window.confirm(`Delete scenario "${scen.name}"? This cannot be undone.`)) return
    setBusy(true); setError(null)
    try {
      await deleteScenario(scen.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const confirmPromote = async () => {
    if (!promoteTarget) return
    const id = promoteTarget.id
    setBusy(true); setError(null)
    try {
      await promoteScenarioToBase(id)
      setPromoteTarget(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleActivate = async (scen: DSMScenario) => {
    if (scen.id === activeId) return
    setBusy(true); setError(null)
    try {
      await activateScenario(scen.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (scen: DSMScenario) => {
    setEditingId(scen.id)
    setEditName(scen.name)
    setEditDesc(scen.description ?? '')
  }

  const commitEdit = async () => {
    if (!editingId) return
    const trimmed = editName.trim()
    if (!trimmed) { setEditingId(null); return }
    setBusy(true); setError(null)
    try {
      await renameScenario(editingId, trimmed, editDesc || null)
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const baseScen = useMemo(
    () => scenarios.find((s) => s.is_base) ?? scenarios[0],
    [scenarios],
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-5)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(900px, 100%)', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
              Scenarios
            </h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
              Named data slots for this system. Non-base scenarios inherit from Base for slots they don't override.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            aria-label="Close"
          ><X size={18} /></button>
        </div>

        {error && (
          <div style={{
            margin: 'var(--space-3) var(--space-5)', padding: 'var(--space-2) var(--space-3)',
            backgroundColor: 'color-mix(in srgb, var(--danger, #c0392b) 12%, transparent)',
            border: '1px solid var(--danger, #c0392b)',
            borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)',
          }}>{error}</div>
        )}

        {/* Scenario table */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 var(--space-5)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', zIndex: 1 }}>
                <th style={thStyle}>Scenario</th>
                {SLOT_DEFS.map((s) => (
                  <th key={s.key as string} style={thSlotStyle} title={s.label}>
                    {s.short}
                  </th>
                ))}
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scen) => {
                const isActive = scen.id === activeId
                const isEditing = scen.id === editingId
                return (
                  <tr key={scen.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <input
                            autoFocus
                            style={inputStyle}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                          />
                          <input
                            placeholder="Description (optional)"
                            style={{ ...inputStyle, height: 28, fontSize: 'var(--text-xs)' }}
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                          />
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                              onClick={() => handleActivate(scen)}
                              disabled={busy || isActive}
                              title={isActive ? 'Active scenario' : 'Set as active'}
                              style={{
                                background: 'transparent', border: 'none', cursor: isActive ? 'default' : 'pointer',
                                color: isActive ? 'var(--mod-dsm)' : 'var(--text-tertiary)',
                                padding: 0, display: 'flex', alignItems: 'center',
                              }}
                            >
                              <Check size={14} strokeWidth={isActive ? 2.2 : 1.4} />
                            </button>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                              {scen.name}
                            </span>
                            {scen.is_base && (
                              <span style={{ ...pillStyle('var(--mod-dsm)'), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Star size={10} strokeWidth={2} fill="currentColor" />
                                Current Base
                              </span>
                            )}
                            {isActive && !scen.is_base && (
                              <span style={pillStyle('var(--mod-dsm)')}>Active</span>
                            )}
                          </div>
                          {scen.description && (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                              {scen.description}
                            </div>
                          )}
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                            {scen.is_base
                              ? 'Root scenario — every slot is authoritative.'
                              : `Inherits from ${baseScen?.name ?? 'Base'} for unset slots.`}
                          </div>
                        </div>
                      )}
                    </td>
                    {SLOT_DEFS.map((s) => {
                      const owned = slotOwned(scen, s.key)
                      const baseHas = baseScen ? slotOwned(baseScen, s.key) : false
                      const viewable = owned || (!scen.is_base && baseHas)
                      return (
                        <td key={s.key as string} style={tdSlotStyle}>
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}>
                            {scen.is_base ? (
                              <span style={pillStyle(owned ? 'var(--mod-dsm)' : 'var(--text-tertiary)')}>
                                {owned ? 'set' : 'empty'}
                              </span>
                            ) : (
                              <span style={pillStyle(owned ? 'var(--mod-dsm)' : 'var(--text-tertiary)')}>
                                {owned ? 'own' : 'inherits'}
                              </span>
                            )}
                            {viewable && (
                              <button
                                type="button"
                                onClick={() => setViewSlot({ scenarioId: scen.id, slotKey: s.key as SlotKey })}
                                title={`View ${s.label.toLowerCase()} data`}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text-tertiary)',
                                  cursor: 'pointer',
                                  padding: 2,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                }}
                              >
                                <Eye size={12} strokeWidth={1.6} />
                              </button>
                            )}
                          </div>
                        </td>
                      )
                    })}
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        {isEditing ? (
                          <>
                            <Button variant="ghost" onClick={commitEdit} disabled={busy}>
                              <Check size={13} strokeWidth={1.5} /> Save
                            </Button>
                            <Button variant="ghost" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" onClick={() => startEdit(scen)} disabled={busy}
                              title="Rename / edit description">
                              <Edit2 size={13} strokeWidth={1.5} />
                            </Button>
                            <Button variant="ghost" onClick={() => handleDuplicate(scen)} disabled={busy}
                              title="Duplicate — copies every slot into a new scenario">
                              <Copy size={13} strokeWidth={1.5} />
                            </Button>
                            {!scen.is_base && (
                              <Button
                                variant="ghost"
                                onClick={() => setPromoteTarget(scen)}
                                disabled={busy}
                                title="Promote to Base — makes this the new inheritance fallback"
                              >
                                <Star size={13} strokeWidth={1.5} /> Set as Base
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              onClick={() => handleDelete(scen)}
                              disabled={busy || scen.is_base}
                              title={scen.is_base ? 'Base scenario cannot be deleted' : 'Delete'}
                            >
                              <Trash2 size={13} strokeWidth={1.5} />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: 'var(--space-4) var(--space-5)',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={busy}
            style={{
              backgroundColor: 'var(--mod-dsm)',
              color: 'var(--text-inverse, #fff)',
              border: '1px solid var(--mod-dsm)',
            }}
          >
            <Plus size={14} strokeWidth={2} /> New scenario
          </Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>

        {promoteTarget && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed', inset: 0, zIndex: 1100,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 'var(--space-5)',
            }}
            onClick={() => !busy && setPromoteTarget(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 'min(520px, 100%)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-xl)',
                padding: 'var(--space-5)',
                display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Star size={18} strokeWidth={2} color="var(--mod-dsm)" fill="var(--mod-dsm)" />
                <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Change Base scenario?
                </h3>
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <p style={{ marginBottom: 'var(--space-3)' }}>
                  Promoting <strong style={{ color: 'var(--text-primary)' }}>"{promoteTarget.name}"</strong> to Base will:
                </p>
                <ul style={{ paddingLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <li>Make it the new fallback for inheritance</li>
                  <li>Copy currently-inherited data into all other scenarios as explicit overrides, so no scenario loses its current data</li>
                  <li>Flatten the inheritance tree — after this change, scenarios won't automatically update if you modify the new Base's data</li>
                </ul>
                <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  This operation is reversible by promoting another scenario back.
                </p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                <Button variant="ghost" onClick={() => setPromoteTarget(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={confirmPromote} disabled={busy}>
                  {busy ? 'Changing…' : 'Change Base'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {viewSlot && (() => {
          const scen = scenarios.find((s) => s.id === viewSlot.scenarioId)
          if (!scen) return null
          return (
            <SlotDataViewer
              scenario={scen}
              baseScenario={baseScen ?? null}
              slotKey={viewSlot.slotKey}
              onClose={() => setViewSlot(null)}
            />
          )
        })()}
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: 'var(--space-3) var(--space-2)',
  fontSize: 'var(--text-xs)', fontWeight: 600,
  color: 'var(--text-tertiary)', textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  borderBottom: '1px solid var(--border-subtle)',
}

const thSlotStyle: React.CSSProperties = {
  ...thStyle, textAlign: 'center', padding: 'var(--space-3) 6px',
  fontSize: 10, width: 64,
}

const tdStyle: React.CSSProperties = {
  padding: 'var(--space-3) var(--space-2)',
  verticalAlign: 'top',
}

const tdSlotStyle: React.CSSProperties = {
  padding: 'var(--space-3) 6px', textAlign: 'center', verticalAlign: 'middle',
}

function pillStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-wide)',
    color,
    border: `1px solid ${color}`,
    backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
  }
}
