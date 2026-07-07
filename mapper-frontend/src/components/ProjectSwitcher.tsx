/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'

type Mode = 'idle' | 'new' | 'duplicate' | 'confirm-delete'

export function ProjectSwitcher() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('idle')
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'create' | 'duplicate' | 'delete' | 'export' | 'import'>(null)

  const ref = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inlineInputRef = useRef<HTMLInputElement>(null)

  const {
    currentProject,
    projects,
    switchProject,
    createProject,
    duplicateProject,
    deleteProject,
    exportProject,
    importProject,
    isLoading,
    fetchProjects,
  } = useProjectStore()

  // Always reflect the live backend: fetch fresh whenever the dropdown opens
  // (covers the case where the initial mount fetch raced an unready sidecar and
  // left the list empty). Closing never re-fetches.
  const toggleOpen = () => {
    setOpen((o) => {
      const next = !o
      if (next) void fetchProjects()
      return next
    })
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        resetMode()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (mode === 'new' || mode === 'duplicate') {
      inlineInputRef.current?.focus()
      inlineInputRef.current?.select()
    }
  }, [mode])

  function resetMode() {
    setMode('idle')
    setInputValue('')
    setError(null)
  }

  function openNew() {
    setMode('new')
    setInputValue('')
    setError(null)
  }

  function openDuplicate() {
    if (!currentProject) return
    setMode('duplicate')
    setInputValue(`${currentProject} (copy)`)
    setError(null)
  }

  function openConfirmDelete() {
    setMode('confirm-delete')
    setError(null)
  }

  async function handleCreate() {
    const name = inputValue.trim()
    if (!name) {
      setError('Name is required')
      return
    }
    setBusy('create')
    setError(null)
    try {
      await createProject(name)
      resetMode()
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleDuplicate() {
    const name = inputValue.trim()
    if (!name || !currentProject) {
      setError('Name is required')
      return
    }
    setBusy('duplicate')
    setError(null)
    try {
      await duplicateProject(currentProject, name)
      resetMode()
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete() {
    if (!currentProject) return
    setBusy('delete')
    setError(null)
    try {
      await deleteProject(currentProject)
      resetMode()
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleExport() {
    if (!currentProject) return
    setBusy('export')
    setError(null)
    try {
      await exportProject(currentProject)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) e.target.value = ''
    if (!file) return
    setBusy('import')
    setError(null)
    try {
      await importProject(file)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={toggleOpen}
        style={{
          height: 32,
          padding: '0 12px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: `border-color var(--duration-fast) var(--ease-out)`,
          minWidth: 180,
        }}
      >
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentProject ?? (isLoading ? 'Loading…' : 'Select project')}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          style={{
            color: 'var(--text-secondary)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform var(--duration-normal) var(--ease-out)`,
          }}
        />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".gz,.tar.gz,.tgz,application/gzip,application/x-gzip,application/x-tar"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 280,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 50,
            overflow: 'hidden',
            animation: `dropdownOpen var(--duration-normal) var(--ease-out)`,
          }}
        >
          <style>{`
            @keyframes dropdownOpen {
              from { opacity: 0; transform: translateX(-50%) scale(0.97); }
              to   { opacity: 1; transform: translateX(-50%) scale(1); }
            }
          `}</style>

          {/* Projects list */}
          <div style={{ padding: 'var(--space-1) 0', maxHeight: 240, overflowY: 'auto' }}>
            {projects.length === 0 ? (
              <div
                style={{
                  padding: '8px 12px',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-tertiary)',
                }}
              >
                No projects found
              </div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    switchProject(p.name)
                    setOpen(false)
                    resetMode()
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: p.is_current ? 'var(--bg-active)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 'var(--text-sm)',
                    color: p.is_current ? 'var(--accent)' : 'var(--text-primary)',
                    textAlign: 'left',
                    transition: `background var(--duration-fast) var(--ease-out)`,
                  }}
                  onMouseEnter={(e) => {
                    if (!p.is_current) e.currentTarget.style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={(e) => {
                    if (!p.is_current) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: p.is_current ? 'var(--accent)' : 'transparent',
                      border: p.is_current ? 'none' : '1px solid var(--border-default)',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

          {/* Inline forms / actions */}
          {mode === 'new' && (
            <InlineForm
              placeholder="New project name"
              value={inputValue}
              onChange={setInputValue}
              busy={busy === 'create'}
              onSubmit={handleCreate}
              onCancel={resetMode}
              inputRef={inlineInputRef}
            />
          )}

          {mode === 'duplicate' && (
            <InlineForm
              placeholder="Duplicate as…"
              value={inputValue}
              onChange={setInputValue}
              busy={busy === 'duplicate'}
              onSubmit={handleDuplicate}
              onCancel={resetMode}
              inputRef={inlineInputRef}
            />
          )}

          {mode === 'confirm-delete' && (
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                Delete <span style={{ fontWeight: 600 }}>{currentProject}</span>?
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                This permanently removes the project and its databases.
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button
                  onClick={resetMode}
                  style={ghostBtn}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={busy === 'delete'}
                  style={dangerBtn}
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}

          {mode === 'idle' && (
            <div style={{ padding: 'var(--space-1) 0' }}>
              <ActionButton icon={<Plus size={14} strokeWidth={1.5} />} label="New project" onClick={openNew} />
              <ActionButton
                icon={<Copy size={14} strokeWidth={1.5} />}
                label="Duplicate current"
                onClick={openDuplicate}
                disabled={!currentProject}
              />
              <ActionButton
                icon={<Download size={14} strokeWidth={1.5} />}
                label={busy === 'export' ? 'Exporting…' : 'Export project'}
                onClick={handleExport}
                disabled={!currentProject || busy === 'export'}
              />
              <ActionButton
                icon={<Upload size={14} strokeWidth={1.5} />}
                label={busy === 'import' ? 'Importing…' : 'Import project'}
                onClick={handleImportClick}
                disabled={busy === 'import'}
              />
              <ActionButton
                icon={<Trash2 size={14} strokeWidth={1.5} />}
                label="Delete current"
                onClick={openConfirmDelete}
                disabled={!currentProject || projects.length <= 1}
                danger
              />
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '8px 12px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: 'var(--text-xs)',
                color: 'var(--danger)',
                background: 'var(--bg-surface)',
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Subcomponents & styles ────────────────────────────────────────────────────

const ghostBtn: React.CSSProperties = {
  flex: 1,
  height: 28,
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  cursor: 'pointer',
  transition: `background var(--duration-fast) var(--ease-out)`,
}

const dangerBtn: React.CSSProperties = {
  flex: 1,
  height: 28,
  background: 'var(--danger)',
  border: '1px solid var(--danger)',
  borderRadius: 'var(--radius-sm)',
  color: 'white',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  cursor: 'pointer',
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 'var(--text-sm)',
        color: danger ? 'var(--danger)' : 'var(--text-primary)',
        textAlign: 'left',
        transition: `background var(--duration-fast) var(--ease-out)`,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={{ color: danger ? 'var(--danger)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
        {icon}
      </span>
      {label}
    </button>
  )
}

function InlineForm({
  placeholder,
  value,
  onChange,
  busy,
  onSubmit,
  onCancel,
  inputRef,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  busy: boolean
  onSubmit: () => void
  onCancel: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div style={{ padding: '10px 12px', display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        style={{
          flex: 1,
          height: 28,
          padding: '0 8px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
          outline: 'none',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = 'var(--border-focus)'
          e.target.style.boxShadow = '0 0 0 2px var(--accent-muted)'
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'var(--border-default)'
          e.target.style.boxShadow = 'none'
        }}
      />
      <button
        onClick={onSubmit}
        disabled={busy}
        aria-label="Confirm"
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          color: 'white',
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Check size={14} strokeWidth={2} />
      </button>
      <button
        onClick={onCancel}
        aria-label="Cancel"
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
        }}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}
