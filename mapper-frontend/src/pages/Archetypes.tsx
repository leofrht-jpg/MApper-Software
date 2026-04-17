import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Trash2, Layers, AlertCircle, Pencil,
  Download, Package, Wrench, Recycle, Battery,
  TrendingDown, TrendingUp, CalendarRange,
  ChevronRight, ChevronDown, Folder, FolderOpen, FolderPlus,
  Search, MoreHorizontal, FolderInput, FilePlus2,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { BOMTree } from '../components/bom/BOMTree'
import { FlattenedBOM } from '../components/bom/FlattenedBOM'
import { BulkLearningRateModal } from '../components/bom/BulkLearningRateModal'
import { BulkReboundModal } from '../components/bom/BulkReboundModal'
import { TimelinePreviewModal } from '../components/bom/TimelinePreviewModal'
import { useBOMStore } from '../stores/bomStore'
import type { ArchetypeSummary } from '../api/client'

function stageIcon(name: string) {
  const n = name.toLowerCase()
  if (n.includes('batter')) return Battery
  if (n.includes('end') || n.includes('eol') || n.includes('recycl') || n.includes('disposal')) return Recycle
  if (n.includes('maint') || n.includes('service') || n.includes('repair')) return Wrench
  return Package
}

// ── Folder tree construction ─────────────────────────────────────────────────

type TreeNode =
  | { kind: 'folder'; path: string; name: string; children: TreeNode[] }
  | { kind: 'arc'; arc: ArchetypeSummary }

const FOLDER_SEGMENT_RE = /^[A-Za-z0-9 _-]+$/
const MAX_FOLDER_DEPTH = 5
const EXPANSION_KEY = 'mapper.archetype-folder-expansion'

function validateFolderPath(path: string): string | null {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return 'Path cannot be empty'
  const parts = trimmed.split('/')
  if (parts.length > MAX_FOLDER_DEPTH) return `Maximum folder depth is ${MAX_FOLDER_DEPTH}`
  for (const seg of parts) {
    if (!seg) return 'Empty segment in path'
    if (!FOLDER_SEGMENT_RE.test(seg)) {
      return `Invalid segment "${seg}" — use letters, digits, spaces, "_" or "-"`
    }
  }
  return null
}

function buildTree(
  archetypes: ArchetypeSummary[],
  folders: string[],
  search: string,
): TreeNode[] {
  // Collect every folder path referenced anywhere, plus ancestors.
  const folderSet = new Set<string>(folders.filter(Boolean))
  for (const a of archetypes) {
    if (!a.folder) continue
    folderSet.add(a.folder)
    const parts = a.folder.split('/')
    for (let i = 1; i < parts.length; i++) folderSet.add(parts.slice(0, i).join('/'))
  }
  const allFolders = [...folderSet]
  const needle = search.trim().toLowerCase()
  const arcMatches = (a: ArchetypeSummary) =>
    !needle || a.name.toLowerCase().includes(needle) ||
    (a.description ?? '').toLowerCase().includes(needle)

  function childrenOf(parent: string | null): TreeNode[] {
    const subs = allFolders.filter((f) => {
      if (parent === null) return !f.includes('/')
      if (!f.startsWith(parent + '/')) return false
      return !f.slice(parent.length + 1).includes('/')
    })
    const arcs = archetypes
      .filter((a) => (a.folder ?? null) === parent)
      .filter(arcMatches)

    const folderNodes: TreeNode[] = subs
      .sort((a, b) => {
        const an = a.split('/').pop() || a
        const bn = b.split('/').pop() || b
        return an.localeCompare(bn)
      })
      .map((f) => ({
        kind: 'folder' as const,
        path: f,
        name: f.split('/').pop() || f,
        children: childrenOf(f),
      }))
    // When searching, hide empty folders (no matching descendants).
    const filteredFolders = needle
      ? folderNodes.filter((n) => n.kind === 'folder' && subtreeHasArc(n))
      : folderNodes

    const arcNodes: TreeNode[] = arcs
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ kind: 'arc' as const, arc: a }))

    return [...filteredFolders, ...arcNodes]
  }
  return childrenOf(null)
}

function subtreeHasArc(node: TreeNode): boolean {
  if (node.kind === 'arc') return true
  return node.children.some(subtreeHasArc)
}

function collectFolderPaths(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'folder') {
      out.push(n.path)
      collectFolderPaths(n.children, out)
    }
  }
  return out
}

// ── Page component ───────────────────────────────────────────────────────────

export function Archetypes() {
  const {
    archetypes, folders, active, flattened, flattenYear, isLoading, error,
    fetchArchetypes, selectArchetype, createNew, saveActive, removeArchetype,
    addNode, addRootStage, patchNode, removeNode, flatten, setFlattenYear,
    exportActive,
    fetchTimeline, applyLearningRateToAll, applyReboundEffectToAll,
    createFolder, renameFolder, deleteFolder, moveArchetype,
  } = useBOMStore()

  const [showFlattened, setShowFlattened] = useState(false)
  const [showBulkLR, setShowBulkLR] = useState(false)
  const [showBulkRebound, setShowBulkRebound] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [hoverName, setHoverName] = useState(false)
  const [search, setSearch] = useState('')
  const [movePickerFor, setMovePickerFor] = useState<ArchetypeSummary | null>(null)
  const [menu, setMenu] = useState<
    | null
    | { x: number; y: number; kind: 'folder'; path: string }
    | { x: number; y: number; kind: 'arc'; arc: ArchetypeSummary }
  >(null)
  const [dragOverPath, setDragOverPath] = useState<string | '__root__' | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(EXPANSION_KEY)
      return new Set(raw ? JSON.parse(raw) as string[] : [])
    } catch { return new Set() }
  })
  useEffect(() => {
    try { localStorage.setItem(EXPANSION_KEY, JSON.stringify([...expanded])) } catch { /* ignore */ }
  }, [expanded])

  useEffect(() => { fetchArchetypes() }, [fetchArchetypes])

  useEffect(() => {
    if (active) {
      setNameDraft(active.name)
      setDescDraft(active.description ?? '')
    }
  }, [active])

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus()
  }, [editingName])

  // Close context menu on outside click / escape.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const tree = useMemo(() => buildTree(archetypes, folders, search), [archetypes, folders, search])

  // When searching, auto-expand all ancestors that contain a match.
  useEffect(() => {
    if (!search.trim()) return
    const paths = collectFolderPaths(tree)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const p of paths) next.add(p)
      return next
    })
  }, [search, tree])

  const toggle = (path: string) => setExpanded((s) => {
    const next = new Set(s)
    if (next.has(path)) next.delete(path); else next.add(path)
    return next
  })

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleNew = async () => {
    await createNew({
      name: 'New archetype',
      category: '',
      description: '',
      folder: null,
      bom: [
        { name: 'Body', node_type: 'component', quantity: 1, unit: 'piece', children: [] },
      ],
    })
    setEditingName(true)
  }

  const handleNewArchetypeInFolder = async (folderPath: string) => {
    try {
      await createNew({
        name: 'New archetype',
        category: '',
        description: '',
        folder: folderPath,
        bom: [
          { name: 'Body', node_type: 'component', quantity: 1, unit: 'piece', children: [] },
        ],
      })
      setExpanded((s) => new Set(s).add(folderPath))
      setEditingName(true)
    } catch (e) {
      alert(`Create failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleNewFolder = async (parent: string | null = null) => {
    const base = parent ? `${parent}/` : ''
    const input = prompt(
      `New folder path (relative to root).\nExample: ${base}Electric\nAllowed: letters, digits, spaces, "_", "-". Max depth ${MAX_FOLDER_DEPTH}.`,
      base,
    )
    if (!input) return
    const err = validateFolderPath(input)
    if (err) { alert(err); return }
    try {
      await createFolder(input.trim().replace(/^\/+|\/+$/g, ''))
      setExpanded((s) => new Set(s).add(input.trim().replace(/^\/+|\/+$/g, '')))
    } catch (e) {
      alert(`Create failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleRenameFolder = async (path: string) => {
    const input = prompt(`Rename folder "${path}" to:`, path)
    if (!input || input === path) return
    const err = validateFolderPath(input)
    if (err) { alert(err); return }
    try {
      await renameFolder(path, input.trim().replace(/^\/+|\/+$/g, ''))
    } catch (e) {
      alert(`Rename failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleDeleteFolder = async (path: string) => {
    const inside = archetypes.filter(
      (a) => a.folder === path || (a.folder && a.folder.startsWith(path + '/')),
    )
    let deleteArcs = false
    if (inside.length > 0) {
      const choice = prompt(
        `Folder "${path}" contains ${inside.length} archetype(s).\n\n` +
        `Type "move" to move them to the root and delete the folder,\n` +
        `or type "delete" to delete the folder AND all archetypes inside.`,
        'move',
      )
      if (!choice) return
      if (choice.toLowerCase() === 'delete') deleteArcs = true
      else if (choice.toLowerCase() !== 'move') return
    } else if (!confirm(`Delete empty folder "${path}"?`)) {
      return
    }
    try {
      await deleteFolder(path, deleteArcs)
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleDuplicateArc = async (arc: ArchetypeSummary) => {
    try {
      // Load the full archetype to copy its BOM tree.
      const { getArchetype } = await import('../api/client')
      const full = await getArchetype(arc.id)
      // Strip node ids so the server re-assigns.
      const stripIds = (nodes: typeof full.bom): typeof full.bom =>
        nodes.map((n) => ({ ...n, id: null, children: n.children ? stripIds(n.children) : n.children }))
      await createNew({
        name: `${full.name} (copy)`,
        description: full.description ?? null,
        category: full.category ?? null,
        folder: full.folder ?? null,
        bom: stripIds(full.bom),
      })
    } catch (e) {
      alert(`Duplicate failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleAddStage = async () => {
    const name = prompt('Life cycle stage name (e.g. Body, Battery Pack, Maintenance, End of Life):', 'New stage')
    if (!name?.trim()) return
    await addRootStage(name.trim())
  }

  const handleExport = async () => {
    try { await exportActive() } catch (e) { alert(`Export failed: ${e instanceof Error ? e.message : e}`) }
  }

  const commitName = async () => {
    if (!active) return
    const trimmed = nameDraft.trim() || active.name
    setEditingName(false)
    if (trimmed === active.name) return
    await saveActive({
      name: trimmed,
      category: active.category ?? null,
      description: active.description ?? null,
      folder: active.folder ?? null,
      bom: active.bom,
    })
  }

  const commitDesc = async () => {
    if (!active) return
    const next = descDraft.trim() || null
    setEditingDesc(false)
    if ((next ?? '') === (active.description ?? '')) return
    await saveActive({
      name: active.name,
      category: active.category ?? null,
      description: next,
      folder: active.folder ?? null,
      bom: active.bom,
    })
  }

  const handleDelete = async () => {
    if (!active?.id) return
    if (!confirm(`Delete "${active.name}"? This cannot be undone.`)) return
    // removeArchetype already refreshes the list and clears `active` when it was the deleted one.
    // Do NOT call clear() here — that wipes the archetypes array and hides siblings.
    await removeArchetype(active.id)
  }

  const handleFlatten = async () => {
    await flatten()
    setShowFlattened(true)
  }

  // ── Tree row renderers ────────────────────────────────────────────────────

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.kind === 'folder') {
      const open = expanded.has(node.path) || !!search.trim()
      const isDropTarget = dragOverPath === node.path
      return (
        <div key={`folder:${node.path}`}>
          <div
            onClick={() => toggle(node.path)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, kind: 'folder', path: node.path })
            }}
            onDragOver={(e) => {
              // Always preventDefault to allow the drop. Checking dataTransfer.types
              // during dragover is unreliable across browsers, so we accept any drag
              // here and only act on our MIME type in onDrop.
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOverPath !== node.path) setDragOverPath(node.path)
            }}
            onDragLeave={(e) => {
              // Ignore leaves to child elements of the same folder row.
              const related = e.relatedTarget as Node | null
              if (related && e.currentTarget.contains(related)) return
              if (dragOverPath === node.path) setDragOverPath(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOverPath(null)
              const id = e.dataTransfer.getData('application/mapper-archetype-id')
              if (!id) return
              void moveArchetype(id, node.path).catch((err) =>
                alert(`Move failed: ${err instanceof Error ? err.message : err}`),
              )
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 8px 4px 0',
              paddingLeft: 6 + depth * 14,
              cursor: 'pointer',
              userSelect: 'none',
              backgroundColor: isDropTarget ? 'color-mix(in srgb, var(--mod-lca) 20%, transparent)' : 'transparent',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {open ? <ChevronDown size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  : <ChevronRight size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
            {open ? <FolderOpen size={13} style={{ color: 'var(--mod-lca)', flexShrink: 0 }} />
                  : <Folder size={13} style={{ color: 'var(--mod-lca)', flexShrink: 0 }} />}
            <span style={{
              fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
            }}>
              {node.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenu({ x: e.clientX, y: e.clientY, kind: 'folder', path: node.path })
              }}
              title="Folder actions"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-tertiary)', padding: 2, display: 'flex',
              }}
            >
              <MoreHorizontal size={12} />
            </button>
          </div>
          {open && node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      )
    }

    const arc = node.arc
    const isActive = active?.id === arc.id
    return (
      <div
        key={`arc:${arc.id}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/mapper-archetype-id', arc.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => selectArchetype(arc.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, kind: 'arc', arc })
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 8px 5px 0',
          paddingLeft: 6 + depth * 14 + 14,
          cursor: 'pointer',
          backgroundColor: isActive ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--mod-lca)' : '2px solid transparent',
        }}
      >
        <div style={{
          fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
        }}>
          {arc.name}
        </div>
        {arc.unlinked_count > 0 && (
          <span title={`${arc.unlinked_count} unlinked`} style={{ color: 'var(--warning)', display: 'inline-flex', alignItems: 'center' }}>
            <AlertCircle size={11} />
          </span>
        )}
        {arc.category && <Badge label={arc.category} variant="lca" />}
      </div>
    )
  }

  const rootDropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dragOverPath !== '__root__') setDragOverPath('__root__')
    },
    onDragLeave: (e: React.DragEvent) => {
      const related = e.relatedTarget as Node | null
      if (related && e.currentTarget.contains(related)) return
      if (dragOverPath === '__root__') setDragOverPath(null)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragOverPath(null)
      const id = e.dataTransfer.getData('application/mapper-archetype-id')
      if (!id) return
      void moveArchetype(id, null).catch((err) =>
        alert(`Move failed: ${err instanceof Error ? err.message : err}`),
      )
    },
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-5)', height: '100%', minHeight: 0 }}>
      {/* ── Tree sidebar ─────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>Archetypes</h2>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              {archetypes.length} total · {folders.length} folder{folders.length === 1 ? '' : 's'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="ghost" onClick={() => handleNewFolder(null)} title="New folder" style={{ height: 30, fontSize: 'var(--text-xs)' }}>
              <FolderPlus size={12} /> Folder
            </Button>
            <Button variant="primary" onClick={handleNew} style={{ height: 30, fontSize: 'var(--text-xs)', backgroundColor: 'var(--mod-lca)' }}>
              <Plus size={12} /> New
            </Button>
          </div>
        </div>
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archetypes…"
              style={{
                width: '100%', height: 28, padding: '0 8px 0 26px',
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                fontSize: 'var(--text-xs)', outline: 'none',
              }}
            />
          </div>
        </div>
        <div
          style={{
            flex: 1, overflow: 'auto', padding: '6px 4px',
            outline: dragOverPath === '__root__' ? '2px dashed var(--mod-lca)' : 'none',
            outlineOffset: -2,
          }}
          {...rootDropHandlers}
        >
          {isLoading && archetypes.length === 0 && (
            <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Loading…</div>
          )}
          {!isLoading && tree.length === 0 && (
            <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              {search.trim() ? 'No matches.' : 'No archetypes defined. Create one to define product compositions.'}
            </div>
          )}
          {tree.map((node) => renderNode(node, 0))}
        </div>
      </div>

      {/* ── Detail editor ────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
      }}>
        {!active ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
            Select an archetype or create a new one.
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    onMouseEnter={() => setHoverName(true)}
                    onMouseLeave={() => setHoverName(false)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36 }}
                  >
                    {editingName ? (
                      <input
                        ref={nameInputRef}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={commitName}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitName() }
                          if (e.key === 'Escape') { setNameDraft(active.name); setEditingName(false) }
                        }}
                        style={{
                          flex: 1, minWidth: 0, height: 40, padding: '0 10px',
                          backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                          fontSize: 'var(--text-xl)', fontWeight: 600, outline: 'none',
                        }}
                      />
                    ) : (
                      <>
                        <h2
                          onClick={() => setEditingName(true)}
                          title="Click to rename"
                          style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)', cursor: 'text', margin: 0 }}
                        >
                          {active.name}
                        </h2>
                        <Pencil
                          size={14}
                          strokeWidth={1.5}
                          onClick={() => setEditingName(true)}
                          style={{
                            color: 'var(--text-tertiary)',
                            cursor: 'pointer',
                            opacity: hoverName ? 1 : 0,
                            transition: 'opacity 120ms ease',
                          }}
                        />
                        {active.category && <Badge label={active.category} variant="lca" />}
                        {active.folder && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
                            padding: '2px 8px', backgroundColor: 'var(--bg-elevated)',
                            borderRadius: 'var(--radius-full)',
                          }}>
                            <Folder size={10} /> {active.folder}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {editingDesc ? (
                      <textarea
                        value={descDraft}
                        onChange={(e) => setDescDraft(e.target.value)}
                        onBlur={commitDesc}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitDesc() }
                          if (e.key === 'Escape') { setDescDraft(active.description ?? ''); setEditingDesc(false) }
                        }}
                        autoFocus
                        rows={2}
                        placeholder="Add a description…"
                        style={{
                          width: '100%', padding: '6px 10px',
                          backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                          fontSize: 'var(--text-sm)', outline: 'none', fontFamily: 'inherit', resize: 'vertical',
                        }}
                      />
                    ) : (
                      <p
                        onClick={() => setEditingDesc(true)}
                        style={{
                          fontSize: 'var(--text-sm)',
                          color: active.description ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                          cursor: 'text',
                          margin: 0,
                          fontStyle: active.description ? 'normal' : 'italic',
                        }}
                      >
                        {active.description || 'Add a description…'}
                      </p>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                  <Button variant="secondary" onClick={() => setShowBulkLR(true)} title="Set learning rates">
                    <TrendingDown size={14} /> Learning rates
                  </Button>
                  <Button variant="secondary" onClick={() => setShowBulkRebound(true)} title="Set rebound effects" style={{ color: 'var(--warning)' }}>
                    <TrendingUp size={14} /> Rebound effects
                  </Button>
                  <Button variant="secondary" onClick={() => setShowTimeline(true)} title="Preview timeline">
                    <CalendarRange size={14} /> Timeline
                  </Button>
                  <div style={{ width: 1, height: 24, backgroundColor: 'var(--border-subtle)', margin: '0 4px' }} />
                  <Button variant="secondary" onClick={handleExport} title="Export archetype" aria-label="Export archetype">
                    <Download size={14} />
                  </Button>
                  <Button variant="secondary" onClick={handleFlatten} title="Flatten BOM" aria-label="Flatten BOM">
                    <Layers size={14} />
                  </Button>
                  <Button variant="ghost" onClick={handleDelete} title="Delete archetype" aria-label="Delete archetype" style={{ color: 'var(--danger)' }}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '8px var(--space-6)', color: 'var(--danger)', fontSize: 'var(--text-sm)', backgroundColor: 'var(--danger-muted)' }}>
                {error}
              </div>
            )}

            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              {active.bom.length === 0 && (
                <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                  No life cycle stages yet. Add one below to start building the BOM.
                </div>
              )}
              {active.bom.map((root) => {
                const StageIcon = stageIcon(root.name)
                return (
                  <div key={root.id ?? root.name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: 'var(--space-3) var(--space-5)',
                      backgroundColor: 'color-mix(in srgb, var(--mod-lca) 6%, transparent)',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      <StageIcon size={14} style={{ color: 'var(--mod-lca)', flexShrink: 0 }} />
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Life cycle stage
                      </span>
                      <button
                        onClick={() => {
                          if (confirm(`Delete stage "${root.name}" and everything inside it?`)) {
                            removeNode(root.id ?? '')
                          }
                        }}
                        title="Delete this life cycle stage"
                        style={{
                          marginLeft: 'auto', background: 'none', border: 'none',
                          cursor: 'pointer', color: 'var(--danger)', padding: 4,
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <BOMTree
                      node={root}
                      isRoot
                      onPatch={patchNode}
                      onAddChild={addNode}
                      onDelete={removeNode}
                    />
                  </div>
                )
              })}
              <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
                <Button
                  variant="secondary"
                  onClick={handleAddStage}
                  style={{ height: 32, fontSize: 'var(--text-xs)' }}
                >
                  <Plus size={12} /> Add life cycle stage
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Context menu ─────────────────────────────────────────────── */}
      {menu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: menu.y, left: menu.x, zIndex: 1000,
            backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            padding: 4, minWidth: 180,
          }}
        >
          {menu.kind === 'folder' ? (
            <>
              <MenuItem icon={<FilePlus2 size={12} />} onClick={() => { handleNewArchetypeInFolder(menu.path); setMenu(null) }}>
                New archetype
              </MenuItem>
              <MenuItem icon={<FolderPlus size={12} />} onClick={() => { handleNewFolder(menu.path); setMenu(null) }}>
                New subfolder
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<Pencil size={12} />} onClick={() => { handleRenameFolder(menu.path); setMenu(null) }}>
                Rename folder
              </MenuItem>
              <MenuItem icon={<Trash2 size={12} />} danger onClick={() => { handleDeleteFolder(menu.path); setMenu(null) }}>
                Delete folder
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem icon={<FolderInput size={12} />} onClick={() => { setMovePickerFor(menu.arc); setMenu(null) }}>
                Move to folder…
              </MenuItem>
              <MenuItem icon={<Plus size={12} />} onClick={() => { handleDuplicateArc(menu.arc); setMenu(null) }}>
                Duplicate
              </MenuItem>
              <MenuItem icon={<Trash2 size={12} />} danger onClick={() => {
                if (confirm(`Delete "${menu.arc.name}"? This cannot be undone.`)) {
                  removeArchetype(menu.arc.id)
                }
                setMenu(null)
              }}>
                Delete
              </MenuItem>
            </>
          )}
        </div>
      )}

      {/* ── Move modal ───────────────────────────────────────────────── */}
      {movePickerFor && (
        <FolderPickerModal
          title={`Move "${movePickerFor.name}"`}
          currentFolder={movePickerFor.folder}
          folders={folders}
          onPick={async (target) => {
            try {
              await moveArchetype(movePickerFor.id, target)
            } catch (e) {
              alert(`Move failed: ${e instanceof Error ? e.message : e}`)
            } finally {
              setMovePickerFor(null)
            }
          }}
          onCancel={() => setMovePickerFor(null)}
        />
      )}

      {showFlattened && flattened && (
        <FlattenedBOM
          data={flattened}
          year={flattenYear}
          onYearChange={(y) => { setFlattenYear(y).catch((e) => alert(e instanceof Error ? e.message : String(e))) }}
          onClose={() => setShowFlattened(false)}
        />
      )}

      {showBulkLR && active && (
        <BulkLearningRateModal
          archetype={active}
          onApply={applyLearningRateToAll}
          onClose={() => setShowBulkLR(false)}
        />
      )}

      {showBulkRebound && active && (
        <BulkReboundModal
          archetype={active}
          onApply={applyReboundEffectToAll}
          onClose={() => setShowBulkRebound(false)}
        />
      )}

      {showTimeline && active && (
        <TimelinePreviewModal
          archetypeName={active.name}
          fetchTimeline={fetchTimeline}
          onClose={() => setShowTimeline(false)}
        />
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MenuDivider() {
  return <div style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />
}

function MenuItem({
  icon, children, onClick, danger,
}: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', background: 'none', border: 'none',
        cursor: 'pointer', borderRadius: 'var(--radius-sm)',
        color: danger ? 'var(--danger)' : 'var(--text-primary)',
        fontSize: 'var(--text-xs)', textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <span style={{ display: 'inline-flex', color: danger ? 'var(--danger)' : 'var(--text-tertiary)' }}>{icon}</span>
      {children}
    </button>
  )
}

function FolderPickerModal({
  title, currentFolder, folders, onPick, onCancel,
}: {
  title: string
  currentFolder: string | null
  folders: string[]
  onPick: (target: string | null) => void
  onCancel: () => void
}) {
  const [custom, setCustom] = useState('')
  const sorted = useMemo(() => [...folders].sort(), [folders])

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
          width: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        }}
      >
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Current: <span style={{ color: 'var(--text-secondary)' }}>{currentFolder ?? '(root)'}</span>
        </div>

        <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 4 }}>
          <FolderOption label="(root)" active={currentFolder === null} onClick={() => onPick(null)} />
          {sorted.map((f) => (
            <FolderOption key={f} label={f} depth={f.split('/').length - 1} active={currentFolder === f} onClick={() => onPick(f)} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Or type a new folder path…"
            style={{
              flex: 1, height: 28, padding: '0 8px',
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
              fontSize: 'var(--text-xs)', outline: 'none',
            }}
          />
          <Button
            variant="secondary"
            onClick={() => {
              const trimmed = custom.trim().replace(/^\/+|\/+$/g, '')
              if (!trimmed) return
              const err = validateFolderPath(trimmed)
              if (err) { alert(err); return }
              onPick(trimmed)
            }}
            disabled={!custom.trim()}
            style={{ height: 28, fontSize: 'var(--text-xs)' }}
          >
            Move here
          </Button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

function FolderOption({
  label, depth = 0, active, onClick,
}: { label: string; depth?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 8px', paddingLeft: 6 + depth * 14,
        background: active ? 'color-mix(in srgb, var(--mod-lca) 14%, transparent)' : 'none',
        border: 'none', borderRadius: 'var(--radius-sm)',
        cursor: 'pointer', color: 'var(--text-primary)',
        fontSize: 'var(--text-xs)', textAlign: 'left',
      }}
    >
      <Folder size={12} style={{ color: 'var(--mod-lca)' }} />
      {label}
    </button>
  )
}
