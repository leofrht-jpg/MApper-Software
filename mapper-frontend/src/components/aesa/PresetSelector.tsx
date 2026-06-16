import { useEffect, useRef, useState } from 'react'
import { Copy, Download, FileSpreadsheet, Lock, Plus, Save, Trash2, Upload } from 'lucide-react'
import { useAESAStore } from '../../stores/aesaStore'

const BUILTIN_PRESET_ID = 'ferhati_2026_multi_d'

/** Dropdown + actions for managing global SharingPresets. Shown at the top of
 *  the Downscaling / Sharing section in the AESA ConfigSidebar. */
export function PresetSelector() {
  const {
    draft, presets, presetsLoading,
    loadPresets, selectPreset, duplicatePreset, deletePreset,
    savePreset, savePresetAs, importPresetFile, exportPresetFile,
    downloadSharingTemplate,
  } = useAESAStore()

  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { void loadPresets() }, [loadPresets])

  if (!draft) return null

  const sharingId = draft.sharing.id
  const currentIsBuiltIn = draft.sharing.built_in || sharingId === BUILTIN_PRESET_ID
  const knownPresetIds = new Set(presets.map((p) => p.id))
  const draftExistsGlobally = knownPresetIds.has(sharingId)

  const handleSelect = async (id: string) => {
    setBusy('select')
    try { await selectPreset(id) } finally { setBusy(null) }
  }

  const handleNew = async () => {
    const name = window.prompt('Name for the new preset:', 'New sharing preset')
    if (!name) return
    setBusy('new')
    try { await savePresetAs(name) } finally { setBusy(null) }
  }

  const handleDuplicate = async () => {
    if (!draftExistsGlobally) {
      // Can only duplicate a stored preset; if the draft is unsaved, save-as instead.
      return handleNew()
    }
    const name = window.prompt('Name for the duplicate:', `${draft.sharing.name} (copy)`)
    if (!name) return
    setBusy('dup')
    try { await duplicatePreset(sharingId, name) } finally { setBusy(null) }
  }

  const handleDelete = async () => {
    if (currentIsBuiltIn) return
    if (!confirm(`Delete preset "${draft.sharing.name}"? This cannot be undone.`)) return
    setBusy('del')
    try {
      await deletePreset(sharingId)
      // Fall back to the built-in preset if present.
      const fallback = presets.find((p) => p.id === BUILTIN_PRESET_ID)
        ?? presets.find((p) => p.id !== sharingId)
      if (fallback) await selectPreset(fallback.id)
    } finally { setBusy(null) }
  }

  const handleSave = async () => {
    setBusy('save')
    try { await savePreset() } finally { setBusy(null) }
  }

  const handleImport = async (file: File) => {
    setBusy('import')
    try { await importPresetFile(file) } finally { setBusy(null) }
  }

  const handleExport = async () => {
    if (!draftExistsGlobally) {
      alert('Save the preset before exporting.')
      return
    }
    const safe = draft.sharing.name.replace(/[^\w.-]+/g, '_') || 'preset'
    setBusy('export')
    try { await exportPresetFile(sharingId, `${safe}.xlsx`) } finally { setBusy(null) }
  }

  const handleTemplate = async () => {
    setBusy('template')
    try { await downloadSharingTemplate('sharing_template.xlsx') } finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Dropdown row */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <select
          value={draftExistsGlobally ? sharingId : ''}
          onChange={(e) => { if (e.target.value) void handleSelect(e.target.value) }}
          disabled={presetsLoading || busy !== null}
          style={selectStyle}
        >
          {!draftExistsGlobally && (
            <option value="">
              {draft.sharing.name} — unsaved
            </option>
          )}
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.built_in ? '🔒 ' : ''}{p.name}
            </option>
          ))}
        </select>
        {currentIsBuiltIn && (
          <span title="Built-in · read-only — duplicate to customize" style={{ color: 'var(--text-tertiary)' }}>
            <Lock size={12} />
          </span>
        )}
      </div>

      {/* Description */}
      {draft.sharing.description && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
          {draft.sharing.description}
        </div>
      )}

      {/* Action buttons — first row (create/duplicate/save/delete) */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <ActionBtn onClick={handleNew} disabled={busy !== null} title="Create a new preset from the current draft">
          <Plus size={11} /> New
        </ActionBtn>
        <ActionBtn onClick={handleDuplicate} disabled={busy !== null} title="Duplicate the current preset">
          <Copy size={11} /> Duplicate
        </ActionBtn>
        <ActionBtn
          onClick={handleSave}
          disabled={busy !== null || currentIsBuiltIn}
          title={currentIsBuiltIn ? 'Built-in preset — duplicate to customize' : 'Save changes to the current preset'}
        >
          <Save size={11} /> Save
        </ActionBtn>
        <ActionBtn
          onClick={handleDelete}
          disabled={busy !== null || currentIsBuiltIn || !draftExistsGlobally}
          danger
          title={currentIsBuiltIn ? 'Built-in presets cannot be deleted' : 'Delete this preset'}
        >
          <Trash2 size={11} /> Delete
        </ActionBtn>
      </div>

      {/* Action buttons — second row (xlsx) */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <ActionBtn onClick={() => fileRef.current?.click()} disabled={busy !== null} title="Import sharing preset from .xlsx">
          <Upload size={11} /> Import
        </ActionBtn>
        <ActionBtn onClick={handleExport} disabled={busy !== null || !draftExistsGlobally} title="Export the current preset as .xlsx">
          <Download size={11} /> Export
        </ActionBtn>
        <ActionBtn onClick={handleTemplate} disabled={busy !== null} title="Download a pre-filled xlsx template">
          <FileSpreadsheet size={11} /> Template
        </ActionBtn>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleImport(f)
            if (fileRef.current) fileRef.current.value = ''
          }}
        />
      </div>
    </div>
  )
}

function ActionBtn({
  children, onClick, disabled, title, danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        background: 'transparent',
        border: `1px solid ${danger ? 'color-mix(in srgb, var(--danger) 40%, transparent)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-sm)',
        color: danger ? 'var(--danger)' : 'var(--text-secondary)',
        padding: '3px 6px', fontSize: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

const selectStyle: React.CSSProperties = {
  flex: 1,
  height: 26,
  padding: '3px 6px',
  fontSize: 11,
  color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  fontFamily: 'inherit',
}
