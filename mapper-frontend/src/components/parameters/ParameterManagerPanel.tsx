/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, Plus, Trash2, Search,
  Download, Upload, FileDown, Save, AlertCircle, Sigma,
  X, MoreHorizontal,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { NumberInput } from '../ui/NumberInput'
import { useParameterStore } from '../../stores/parameterStore'
import { BASE_SCENARIO, resolveParameterValue, type Parameter } from '../../api/client'

const PARAM_NAME_RE = /^[a-z_][a-z0-9_]*$/
const RESERVED = new Set(['min', 'max', 'abs', 'round', 'sum'])
const SCENARIO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _\-]{0,39}$/

function validateName(name: string): string | null {
  if (!name) return 'Name is required'
  if (!PARAM_NAME_RE.test(name)) return 'Use snake_case: lowercase letters, digits, underscores'
  if (RESERVED.has(name)) return `"${name}" is a reserved function name`
  return null
}

function validateScenarioName(name: string, existing: string[]): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Case name is required'
  if (trimmed === BASE_SCENARIO) return `"${BASE_SCENARIO}" is reserved`
  if (!SCENARIO_NAME_RE.test(trimmed)) return 'Letters, digits, spaces, dash or underscore only'
  if (existing.includes(trimmed)) return `"${trimmed}" already exists`
  return null
}

const cellInputStyle: React.CSSProperties = {
  width: '100%',
  height: 26,
  padding: '0 6px',
  backgroundColor: 'transparent',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-xs)',
  outline: 'none',
}

export function ParameterManagerPanel() {
  const {
    table, isSaving, error,
    fetchTable, setParameters, upsertParameter, removeParameter, patchOverride,
    addScenario, removeScenario, renameScenario,
    addCategory, removeCategory, renameCategory,
    importFile, exportFile, downloadTemplate,
  } = useParameterStore()

  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('mapper.param-panel-open') !== '0' } catch { return true }
  })
  const [search, setSearch] = useState('')
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [scenarioMenuOpen, setScenarioMenuOpen] = useState<string | null>(null)
  const [hoveredScenario, setHoveredScenario] = useState<string | null>(null)
  const [addCaseHover, setAddCaseHover] = useState(false)
  const [renamingScenario, setRenamingScenario] = useState<string | null>(null)
  const [scenarioNameDraft, setScenarioNameDraft] = useState('')
  const [categoryMenuOpen, setCategoryMenuOpen] = useState<string | null>(null)
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null)
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null)
  const [categoryNameDraft, setCategoryNameDraft] = useState('')
  const [addParamOpen, setAddParamOpen] = useState(false)
  const [newCategoryOpen, setNewCategoryOpen] = useState(false)
  const [newCategoryDraft, setNewCategoryDraft] = useState('')
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { localStorage.setItem('mapper.param-panel-open', expanded ? '1' : '0') } catch { /* ignore */ }
  }, [expanded])

  useEffect(() => { fetchTable() }, [fetchTable])

  // Close scenario menu on outside click / escape
  useEffect(() => {
    if (!scenarioMenuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('[data-scenario-menu]')) setScenarioMenuOpen(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setScenarioMenuOpen(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [scenarioMenuOpen])

  // Close category menu on outside click / escape
  useEffect(() => {
    if (!categoryMenuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('[data-category-menu]')) setCategoryMenuOpen(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCategoryMenuOpen(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [categoryMenuOpen])

  const params = useMemo(
    () => (table ? Object.values(table.parameters) : []),
    [table],
  )
  const scenarioCols = table?.scenarios ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return params
    return params.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q),
    )
  }, [params, search])

  const declaredCategories = table?.categories ?? []

  const grouped = useMemo(() => {
    const map = new Map<string, Parameter[]>()
    // Seed with explicit (possibly empty) categories so they render even when
    // they contain no parameters yet.
    for (const c of declaredCategories) {
      const t = c.trim()
      if (t) map.set(t, [])
    }
    for (const p of filtered) {
      const cat = p.category?.trim() || '(no category)'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(p)
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === '(no category)') return 1
      if (b === '(no category)') return -1
      return a.localeCompare(b)
    })
  }, [filtered, declaredCategories])

  const existingCategories = useMemo(() => {
    const s = new Set<string>()
    for (const c of declaredCategories) {
      const t = c.trim()
      if (t) s.add(t)
    }
    for (const p of params) {
      const c = p.category?.trim()
      if (c) s.add(c)
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [params, declaredCategories])

  const handleAddParam = () => {
    if (!table) return
    setAddParamOpen(true)
  }

  const handleCreateParam = (data: {
    name: string
    unit: string | null
    base_value: number
    category: string | null
    description: string | null
  }) => {
    if (data.category && !declaredCategories.includes(data.category)) {
      addCategory(data.category)
    }
    upsertParameter({
      name: data.name,
      unit: data.unit,
      base_value: data.base_value,
      category: data.category,
      description: data.description,
      scenario_overrides: {},
    })
    setAddParamOpen(false)
  }

  const handleRenameCategory = (oldCat: string, newCat: string) => {
    if (!table) return
    const trimmed = newCat.trim()
    if (!trimmed || trimmed === oldCat) return
    const next: Record<string, Parameter> = {}
    for (const [k, p] of Object.entries(table.parameters)) {
      next[k] = p.category?.trim() === oldCat ? { ...p, category: trimmed } : p
    }
    setParameters(next)
    renameCategory(oldCat, trimmed)
  }

  const handleDeleteCategory = (cat: string) => {
    if (!table) return
    const affected = params.filter((p) => (p.category?.trim() || '') === cat)
    if (affected.length > 0) {
      if (!confirm(
        `Move ${affected.length} parameter${affected.length === 1 ? '' : 's'} to "(no category)" and delete the "${cat}" group?`,
      )) return
      const next: Record<string, Parameter> = {}
      for (const [k, p] of Object.entries(table.parameters)) {
        next[k] = p.category?.trim() === cat ? { ...p, category: null } : p
      }
      setParameters(next)
    }
    removeCategory(cat)
    setCategoryMenuOpen(null)
  }

  const beginRenameCategory = (cat: string) => {
    setCategoryMenuOpen(null)
    setRenamingCategory(cat)
    setCategoryNameDraft(cat)
  }

  const commitRenameCategory = () => {
    if (!renamingCategory) return
    const trimmed = categoryNameDraft.trim()
    const old = renamingCategory
    setRenamingCategory(null)
    if (!trimmed || trimmed === old) return
    handleRenameCategory(old, trimmed)
  }

  const handleRenameParam = (oldName: string, newName: string) => {
    if (!table) return
    if (oldName === newName) return
    const next: Record<string, Parameter> = {}
    for (const k of Object.keys(table.parameters)) {
      if (k === oldName) next[newName] = { ...table.parameters[k], name: newName }
      else next[k] = table.parameters[k]
    }
    setParameters(next)
  }

  const handleAddScenario = async () => {
    if (!table) return
    const name = prompt('New sensitivity case name (e.g. "Optimistic"):')
    if (!name?.trim()) return
    const err = validateScenarioName(name, scenarioCols)
    if (err) { alert(err); return }
    const copyFrom = scenarioCols.length > 0
      ? (prompt(
          `Copy overrides from existing case? Enter case name or leave blank for a fresh column.\n\nAvailable: ${scenarioCols.join(', ')}`,
        ) || '').trim() || null
      : null
    try {
      await addScenario(name.trim(), copyFrom || null)
    } catch (e) {
      alert(`Add case failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const beginRenameScenario = (s: string) => {
    setScenarioMenuOpen(null)
    setRenamingScenario(s)
    setScenarioNameDraft(s)
  }
  const commitRenameScenario = async () => {
    if (!renamingScenario) return
    const trimmed = scenarioNameDraft.trim()
    const old = renamingScenario
    setRenamingScenario(null)
    if (!trimmed || trimmed === old) return
    const err = validateScenarioName(trimmed, scenarioCols.filter((s) => s !== old))
    if (err) { alert(err); return }
    try {
      await renameScenario(old, trimmed)
    } catch (e) {
      alert(`Rename failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleDeleteScenario = async (s: string) => {
    setScenarioMenuOpen(null)
    if (!confirm(`Delete case column "${s}"? All overrides in this column will be lost.`)) return
    try {
      await removeScenario(s)
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleImport = async (file: File) => {
    setImporting(true)
    try {
      const mode: 'replace' | 'merge' = confirm(
        `Import mode: OK = Replace (overwrite parameters + cases)\nCancel = Merge (keep existing, add/update from file)`,
      ) ? 'replace' : 'merge'
      await importFile(file, mode)
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const toggleCat = (cat: string) => setCollapsedCats((prev) => {
    const next = new Set(prev)
    if (next.has(cat)) next.delete(cat); else next.add(cat)
    return next
  })

  const panelStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    marginBottom: 'var(--space-4)',
  }

  // Column layout: Name | Unit | Base | <scenarios...> | Category | ×
  const colTemplate = useMemo(() => {
    const scen = scenarioCols.map(() => '100px').join(' ')
    return `220px 70px 100px ${scen} 140px 28px`
  }, [scenarioCols])

  return (
    <div style={panelStyle}>
      {/* ── Header ──────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: expanded ? '1px solid var(--border-subtle)' : 'none',
      }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', padding: 2, display: 'inline-flex',
          }}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Sigma size={14} style={{ color: 'var(--mod-plca)' }} />
        <span style={{
          fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-primary)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Parameters & Sensitivity Cases
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {params.length} params · {scenarioCols.length + 1} case{scenarioCols.length === 0 ? '' : 's'}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {isSaving && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
            }}>
              <Save size={12} /> saving…
            </span>
          )}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────── */}
      {expanded && (
        <>
          {error && (
            <div style={{
              padding: '6px var(--space-4)',
              fontSize: 'var(--text-xs)',
              color: 'var(--danger)',
              backgroundColor: 'color-mix(in srgb, var(--danger) 8%, transparent)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <AlertCircle size={12} /> {error}
            </div>
          )}

          {!table ? (
            <div style={{
              padding: 'var(--space-5)', textAlign: 'center',
              color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
            }}>
              Loading parameters…
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
                  <Search size={12} style={{
                    position: 'absolute', left: 8, top: '50%',
                    transform: 'translateY(-50%)', color: 'var(--text-tertiary)',
                  }} />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search parameters…"
                    style={{
                      width: '100%', height: 28, padding: '0 8px 0 26px',
                      backgroundColor: 'var(--bg-elevated)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-primary)',
                      fontSize: 'var(--text-xs)', outline: 'none',
                    }}
                  />
                </div>
                <Button
                  variant="primary"
                  onClick={handleAddParam}
                  style={{
                    height: 28, fontSize: 'var(--text-xs)',
                    backgroundColor: 'var(--mod-plca)',
                  }}
                >
                  <Plus size={12} /> Add parameter
                </Button>
                {newCategoryOpen ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input
                      autoFocus
                      value={newCategoryDraft}
                      onChange={(e) => { setNewCategoryDraft(e.target.value); setNewCategoryError(null) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const trimmed = newCategoryDraft.trim()
                          if (!trimmed) { setNewCategoryError('Name is required'); return }
                          if (existingCategories.includes(trimmed)) { setNewCategoryError('Already exists'); return }
                          addCategory(trimmed)
                          setNewCategoryOpen(false)
                          setNewCategoryDraft('')
                          setNewCategoryError(null)
                        }
                        if (e.key === 'Escape') {
                          setNewCategoryOpen(false)
                          setNewCategoryDraft('')
                          setNewCategoryError(null)
                        }
                      }}
                      placeholder="New category name"
                      title={newCategoryError ?? undefined}
                      style={{
                        height: 28, padding: '0 8px',
                        backgroundColor: 'var(--bg-elevated)',
                        border: `1px solid ${newCategoryError ? 'var(--danger)' : 'var(--border-default)'}`,
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-primary)',
                        fontSize: 'var(--text-xs)', outline: 'none', minWidth: 180,
                      }}
                    />
                    <Button
                      variant="primary"
                      onClick={() => {
                        const trimmed = newCategoryDraft.trim()
                        if (!trimmed) { setNewCategoryError('Name is required'); return }
                        if (existingCategories.includes(trimmed)) { setNewCategoryError('Already exists'); return }
                        addCategory(trimmed)
                        setNewCategoryOpen(false)
                        setNewCategoryDraft('')
                        setNewCategoryError(null)
                      }}
                      style={{
                        height: 28, fontSize: 'var(--text-xs)',
                        backgroundColor: 'var(--mod-plca)',
                      }}
                    >
                      Create
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setNewCategoryOpen(false)
                        setNewCategoryDraft('')
                        setNewCategoryError(null)
                      }}
                      style={{ height: 28, fontSize: 'var(--text-xs)' }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => setNewCategoryOpen(true)}
                    title="Create an empty category"
                    style={{ height: 28, fontSize: 'var(--text-xs)' }}
                  >
                    <Plus size={12} /> New category
                  </Button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <Button
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                    title="Import from .xlsx"
                    style={{ height: 28, fontSize: 'var(--text-xs)' }}
                  >
                    <Upload size={12} /> Import
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => exportFile().catch((e) => alert(`Export failed: ${e instanceof Error ? e.message : e}`))}
                    title="Download table as .xlsx"
                    style={{ height: 28, fontSize: 'var(--text-xs)' }}
                  >
                    <Download size={12} /> Export
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => downloadTemplate().catch((e) => alert(e instanceof Error ? e.message : String(e)))}
                    title="Download blank template"
                    style={{ height: 28, fontSize: 'var(--text-xs)' }}
                  >
                    <FileDown size={12} /> Template
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleImport(f)
                  }}
                />
              </div>

              {/* Table */}
              <div style={{ maxHeight: 420, overflow: 'auto' }}>
                {params.length === 0 && (
                  <div style={{
                    padding: 'var(--space-5)', textAlign: 'center',
                    color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
                  }}>
                    No parameters yet. Add one above, or import from an .xlsx file.
                  </div>
                )}
                {params.length > 0 && filtered.length === 0 && (
                  <div style={{
                    padding: 'var(--space-4)', textAlign: 'center',
                    color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)',
                  }}>
                    No parameters match "{search}".
                  </div>
                )}

                {params.length > 0 && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: colTemplate,
                    columnGap: 8,
                    alignItems: 'center',
                    padding: '8px var(--space-4)',
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: '1px solid var(--border-subtle)',
                    position: 'sticky', top: 0,
                    backgroundColor: 'var(--bg-surface)',
                    zIndex: 2,
                  }}>
                    <span>Name</span>
                    <span>Unit</span>
                    <span style={{ textAlign: 'center' }}>Base</span>
                    {scenarioCols.map((s) => {
                      const isActive = hoveredScenario === s || scenarioMenuOpen === s
                      return (
                        <span
                          key={s}
                          data-scenario-menu
                          style={{
                            position: 'relative',
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--mod-plca)',
                            minWidth: 0,
                          }}
                        >
                          {renamingScenario === s ? (
                            <input
                              autoFocus
                              value={scenarioNameDraft}
                              onChange={(e) => setScenarioNameDraft(e.target.value)}
                              onBlur={commitRenameScenario}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commitRenameScenario() }
                                if (e.key === 'Escape') { setRenamingScenario(null) }
                              }}
                              style={{
                                ...cellInputStyle,
                                height: 20,
                                border: '1px solid var(--border-default)',
                                backgroundColor: 'var(--bg-elevated)',
                                color: 'var(--text-primary)',
                                textTransform: 'none',
                                fontWeight: 600,
                                textAlign: 'center',
                              }}
                            />
                          ) : (
                            <>
                              <button
                                onClick={() => setScenarioMenuOpen((cur) => cur === s ? null : s)}
                                onMouseEnter={() => setHoveredScenario(s)}
                                onMouseLeave={() => setHoveredScenario(null)}
                                title={`${s} — click for rename / delete`}
                                style={{
                                  background: 'none', border: 'none', padding: 0,
                                  cursor: 'pointer',
                                  color: 'var(--mod-plca)',
                                  fontFamily: 'inherit',
                                  fontSize: 10, fontWeight: 600,
                                  textTransform: 'none',
                                  letterSpacing: 0,
                                  textDecoration: isActive ? 'underline' : 'none',
                                  textUnderlineOffset: 2,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  maxWidth: '100%',
                                  textAlign: 'center',
                                }}
                              >
                                {s}
                              </button>
                              {scenarioMenuOpen === s && (
                                <div
                                  style={{
                                    position: 'absolute', top: '100%', right: 0, zIndex: 5,
                                    marginTop: 4,
                                    backgroundColor: 'var(--bg-elevated)',
                                    border: '1px solid var(--border-default)',
                                    borderRadius: 'var(--radius-md)',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                                    padding: 4, minWidth: 140,
                                    textTransform: 'none',
                                    fontWeight: 400,
                                    letterSpacing: 0,
                                  }}
                                >
                                  <MenuItem onClick={() => beginRenameScenario(s)}>Rename…</MenuItem>
                                  <MenuItem onClick={() => handleDeleteScenario(s)} danger>Delete column</MenuItem>
                                </div>
                              )}
                            </>
                          )}
                        </span>
                      )
                    })}
                    <span>Category</span>
                    <div style={{ justifySelf: 'end', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={handleAddScenario}
                        onMouseEnter={() => setAddCaseHover(true)}
                        onMouseLeave={() => setAddCaseHover(false)}
                        disabled={!table}
                        title="Add a sensitivity case column"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          padding: '2px 6px',
                          backgroundColor: addCaseHover ? 'var(--bg-hover)' : 'transparent',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          color: addCaseHover ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontFamily: 'inherit',
                          fontSize: 10, fontWeight: 600,
                          textTransform: 'none',
                          letterSpacing: 0,
                          cursor: table ? 'pointer' : 'not-allowed',
                          opacity: table ? 1 : 0.5,
                          transition: 'background-color 120ms ease, color 120ms ease',
                        }}
                      >
                        <Plus size={11} /> Add case
                      </button>
                    </div>
                  </div>
                )}

                {grouped.map(([cat, rows]) => {
                  const collapsed = collapsedCats.has(cat)
                  const isNoCat = cat === '(no category)'
                  const isRenaming = renamingCategory === cat
                  const menuOpen = categoryMenuOpen === cat
                  const showActions = !isNoCat && (hoveredCategory === cat || menuOpen)
                  return (
                    <div key={cat}>
                      <div
                        onMouseEnter={() => setHoveredCategory(cat)}
                        onMouseLeave={() => setHoveredCategory(null)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '4px var(--space-4)',
                          userSelect: 'none',
                          backgroundColor: 'color-mix(in srgb, var(--mod-plca) 6%, transparent)',
                          fontSize: 'var(--text-xs)', fontWeight: 600,
                          color: 'var(--text-secondary)',
                          position: 'relative',
                        }}
                      >
                        <button
                          onClick={() => toggleCat(cat)}
                          title={collapsed ? 'Expand group' : 'Collapse group'}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: 0, display: 'inline-flex', alignItems: 'center',
                            color: 'inherit',
                          }}
                        >
                          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                        </button>
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={categoryNameDraft}
                            onChange={(e) => setCategoryNameDraft(e.target.value)}
                            onBlur={commitRenameCategory}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitRenameCategory() }
                              if (e.key === 'Escape') { setRenamingCategory(null) }
                            }}
                            style={{
                              height: 20, padding: '0 6px',
                              border: '1px solid var(--border-default)',
                              backgroundColor: 'var(--bg-elevated)',
                              color: 'var(--text-primary)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: 'var(--text-xs)', fontWeight: 600,
                              outline: 'none', minWidth: 160,
                            }}
                          />
                        ) : (
                          <span
                            onClick={() => toggleCat(cat)}
                            style={{ cursor: 'pointer' }}
                          >
                            {cat}
                          </span>
                        )}
                        <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
                          · {rows.length}
                        </span>
                        {showActions && !isRenaming && (
                          <div
                            data-category-menu
                            style={{ marginLeft: 'auto', position: 'relative', display: 'inline-flex' }}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setCategoryMenuOpen((cur) => cur === cat ? null : cat)
                              }}
                              title="Category actions"
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--text-tertiary)', padding: 2, display: 'inline-flex',
                              }}
                            >
                              <MoreHorizontal size={12} />
                            </button>
                            {menuOpen && (
                              <div
                                style={{
                                  position: 'absolute', top: '100%', right: 0, zIndex: 5,
                                  marginTop: 4,
                                  backgroundColor: 'var(--bg-elevated)',
                                  border: '1px solid var(--border-default)',
                                  borderRadius: 'var(--radius-md)',
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                                  padding: 4, minWidth: 160,
                                  fontWeight: 400,
                                }}
                              >
                                <MenuItem onClick={() => beginRenameCategory(cat)}>Rename…</MenuItem>
                                <MenuItem onClick={() => handleDeleteCategory(cat)} danger>Delete category</MenuItem>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {!collapsed && rows.map((p) => (
                        <ParameterRow
                          key={p.name}
                          param={p}
                          scenarios={scenarioCols}
                          colTemplate={colTemplate}
                          existingNames={params.map((q) => q.name).filter((n) => n !== p.name)}
                          onRename={(newName) => handleRenameParam(p.name, newName)}
                          onPatchField={(patch) => upsertParameter({ ...p, ...patch })}
                          onPatchOverride={(scen, value) => patchOverride(p.name, scen, value)}
                          onDelete={() => removeParameter(p.name)}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {addParamOpen && (
        <AddParameterModal
          existingNames={new Set(params.map((p) => p.name))}
          existingCategories={existingCategories}
          onCancel={() => setAddParamOpen(false)}
          onSubmit={handleCreateParam}
        />
      )}
    </div>
  )
}

// ── Individual parameter row ──────────────────────────────────────────────────

function ParameterRow({
  param, scenarios, colTemplate, existingNames,
  onRename, onPatchField, onPatchOverride, onDelete,
}: {
  param: Parameter
  scenarios: string[]
  colTemplate: string
  existingNames: string[]
  onRename: (newName: string) => void
  onPatchField: (patch: Partial<Parameter>) => void
  onPatchOverride: (scenario: string, value: number | null) => void
  onDelete: () => void
}) {
  const [hover, setHover] = useState(false)
  const [nameDraft, setNameDraft] = useState(param.name)
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => { setNameDraft(param.name) }, [param.name])

  const commitName = () => {
    const trimmed = nameDraft.trim()
    const err = validateName(trimmed)
    if (err) { setNameError(err); setNameDraft(param.name); return }
    if (existingNames.includes(trimmed)) {
      setNameError(`Duplicate name "${trimmed}"`)
      setNameDraft(param.name)
      return
    }
    setNameError(null)
    if (trimmed !== param.name) onRename(trimmed)
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: colTemplate,
        columnGap: 8,
        alignItems: 'center',
        padding: '3px var(--space-4)',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: hover ? 'var(--bg-hover)' : 'transparent',
      }}
    >
      <div>
        <input
          value={nameDraft}
          onChange={(e) => { setNameDraft(e.target.value); setNameError(null) }}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
            if (e.key === 'Escape') { setNameDraft(param.name); setNameError(null); (e.target as HTMLInputElement).blur() }
          }}
          title={nameError ?? param.description ?? undefined}
          style={{
            ...cellInputStyle,
            fontFamily: 'var(--font-mono)',
            color: nameError ? 'var(--danger)' : 'var(--text-primary)',
            borderColor: nameError ? 'var(--danger)' : 'transparent',
          }}
        />
      </div>
      <input
        value={param.unit ?? ''}
        onChange={(e) => onPatchField({ unit: e.target.value || null })}
        placeholder="—"
        style={cellInputStyle}
      />
      <NumberInput
        value={Number.isFinite(param.base_value) ? param.base_value : 0}
        onChange={(v) => onPatchField({ base_value: v })}
        allowNegative
        style={{ ...cellInputStyle, fontFamily: 'var(--font-mono)', textAlign: 'center' }}
      />
      {scenarios.map((s) => (
        <ScenarioCell
          key={s}
          param={param}
          scenario={s}
          onPatchOverride={(v) => onPatchOverride(s, v)}
        />
      ))}
      <input
        value={param.category ?? ''}
        onChange={(e) => onPatchField({ category: e.target.value || null })}
        placeholder="—"
        style={{ ...cellInputStyle, color: 'var(--text-secondary)' }}
      />
      <button
        onClick={onDelete}
        title="Delete parameter"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--danger)', padding: 2,
          opacity: hover ? 1 : 0,
          transition: 'opacity 120ms ease',
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function ScenarioCell({
  param, scenario, onPatchOverride,
}: {
  param: Parameter
  scenario: string
  onPatchOverride: (value: number | null) => void
}) {
  const [cellHover, setCellHover] = useState(false)
  const override = param.scenario_overrides?.[scenario]
  const hasOverride = override !== undefined && override !== null
  const displayValue = hasOverride ? override : ''
  const inheritedValue = resolveParameterValue(param, scenario)

  return (
    <div
      onMouseEnter={() => setCellHover(true)}
      onMouseLeave={() => setCellHover(false)}
      onContextMenu={(e) => {
        if (!hasOverride) return
        e.preventDefault()
        onPatchOverride(null)
      }}
      style={{ position: 'relative' }}
    >
      <input
        type="number"
        step="any"
        value={displayValue}
        onChange={(e) => {
          const v = e.target.value
          if (v === '' || v === '-') { onPatchOverride(null); return }
          const n = Number(v)
          if (!Number.isNaN(n)) onPatchOverride(n)
        }}
        placeholder={hasOverride ? '' : `—  (${inheritedValue})`}
        title={
          hasOverride
            ? `Override in "${scenario}" · inherits ${inheritedValue} from Base`
            : `Inherits ${inheritedValue} from Base · right-click to clear`
        }
        style={{
          ...cellInputStyle,
          fontFamily: 'var(--font-mono)',
          textAlign: 'center',
          color: hasOverride ? 'var(--mod-plca)' : 'var(--text-tertiary)',
          fontWeight: hasOverride ? 600 : 400,
          paddingRight: hasOverride && cellHover ? 18 : 6,
          backgroundColor: hasOverride
            ? 'color-mix(in srgb, var(--mod-plca) 8%, transparent)'
            : 'transparent',
        }}
      />
      {hasOverride && cellHover && (
        <button
          onClick={() => onPatchOverride(null)}
          title="Clear override"
          style={{
            position: 'absolute', right: 2, top: '50%',
            transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', padding: 2, display: 'inline-flex',
          }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

function MenuItem({
  children, onClick, danger = false,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '6px 10px',
        background: hover ? 'var(--bg-hover)' : 'transparent',
        border: 'none', cursor: 'pointer',
        fontSize: 'var(--text-xs)',
        color: danger ? 'var(--danger)' : 'var(--text-primary)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {children}
    </button>
  )
}

// ── Add Parameter modal ──────────────────────────────────────────────────────

const CREATE_NEW = '__create_new__'

function AddParameterModal({
  existingNames, existingCategories, onCancel, onSubmit,
}: {
  existingNames: Set<string>
  existingCategories: string[]
  onCancel: () => void
  onSubmit: (data: {
    name: string
    unit: string | null
    base_value: number
    category: string | null
    description: string | null
  }) => void
}) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [baseValue, setBaseValue] = useState('0')
  const [description, setDescription] = useState('')
  const [categorySelect, setCategorySelect] = useState<string>('')
  const [newCategory, setNewCategory] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = () => {
    const trimmedName = name.trim()
    const nameErr = validateName(trimmedName)
    if (nameErr) { setError(nameErr); return }
    if (existingNames.has(trimmedName)) { setError(`Parameter "${trimmedName}" already exists`); return }
    const base = Number(baseValue)
    if (!Number.isFinite(base)) { setError('Base value must be a number'); return }
    let category: string | null = null
    if (categorySelect === CREATE_NEW) {
      const trimmedCat = newCategory.trim()
      if (!trimmedCat) { setError('Enter a new category name or pick an existing one'); return }
      category = trimmedCat
    } else if (categorySelect) {
      category = categorySelect
    }
    onSubmit({
      name: trimmedName,
      unit: unit.trim() || null,
      base_value: base,
      category,
      description: description.trim() || null,
    })
  }

  const fieldLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block',
  }
  const fieldInput: React.CSSProperties = {
    width: '100%', height: 32, padding: '0 10px',
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-sm)', outline: 'none',
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.45)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            Add parameter
          </div>
          <button
            onClick={onCancel}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', padding: 4, display: 'inline-flex',
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <label style={fieldLabel}>Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null) }}
              placeholder="e.g. battery_mass_lfp"
              style={{ ...fieldInput, fontFamily: 'var(--font-mono)' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={fieldLabel}>Unit</label>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="kg, km/yr, kWh…"
                style={fieldInput}
              />
            </div>
            <div>
              <label style={fieldLabel}>Base value</label>
              <input
                type="number"
                step="any"
                value={baseValue}
                onChange={(e) => setBaseValue(e.target.value)}
                style={{ ...fieldInput, fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>

          <div>
            <label style={fieldLabel}>Category</label>
            <select
              value={categorySelect}
              onChange={(e) => setCategorySelect(e.target.value)}
              style={{ ...fieldInput, appearance: 'auto' }}
            >
              <option value="">(no category)</option>
              {existingCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={CREATE_NEW}>Create new…</option>
            </select>
            {categorySelect === CREATE_NEW && (
              <input
                autoFocus
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="New category name"
                style={{ ...fieldInput, marginTop: 6 }}
              />
            )}
          </div>

          <div>
            <label style={fieldLabel}>Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note"
              style={fieldInput}
            />
          </div>

          {error && (
            <div style={{
              padding: '6px 10px',
              backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
              color: 'var(--danger)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <AlertCircle size={12} /> {error}
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <Button variant="ghost" onClick={onCancel} style={{ height: 32, fontSize: 'var(--text-xs)' }}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            style={{ height: 32, fontSize: 'var(--text-xs)', backgroundColor: 'var(--mod-plca)' }}
          >
            <Plus size={12} /> Add parameter
          </Button>
        </div>
      </div>
    </div>
  )
}
