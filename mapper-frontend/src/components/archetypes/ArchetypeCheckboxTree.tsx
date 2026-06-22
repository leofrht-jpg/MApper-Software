/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { ArchetypeSummary } from '../../api/client'
import { SearchInput } from '../ui/SearchInput'
import {
  buildArchetypeTree,
  collectArcIds,
  subtreeHasArc,
  type TreeNode,
} from './folderTree'

interface Props {
  archetypes: ArchetypeSummary[]
  folders: string[]
  selectedIds: string[]
  onToggle: (arc: ArchetypeSummary) => void
  onToggleFolder?: (arcs: ArchetypeSummary[], targetChecked: boolean) => void
  maxHeight?: number
  emptyText?: string
}

/** Checkbox-only folder tree for selecting archetypes. Used in the LCA
 *  Calculator; renders the same folder structure as the Archetypes tab. */
export function ArchetypeCheckboxTree({
  archetypes, folders, selectedIds, onToggle, onToggleFolder,
  maxHeight = 220, emptyText = 'No archetypes available',
}: Props) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const tree = useMemo(
    () => buildArchetypeTree(archetypes, folders, search),
    [archetypes, folders, search],
  )

  // While searching, auto-expand every folder that has a matching descendant.
  useEffect(() => {
    if (!search.trim()) return
    const next = new Set<string>()
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'folder' && subtreeHasArc(n)) {
          next.add(n.path)
          walk(n.children)
        }
      }
    }
    walk(tree)
    setExpanded(next)
  }, [search, tree])

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  const descendantArcs = (node: TreeNode): ArchetypeSummary[] => {
    if (node.kind === 'arc') return [node.arc]
    return node.children.flatMap(descendantArcs)
  }

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.kind === 'arc') {
      const checked = selectedSet.has(node.arc.id)
      return (
        <label
          key={`arc:${node.arc.id}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px',
            paddingLeft: 10 + depth * 16,
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-primary)',
            backgroundColor: checked ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(node.arc)}
            style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
          />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.arc.name}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flexShrink: 0 }}>
            {node.arc.material_count}m{node.arc.unlinked_count > 0 ? ` · ${node.arc.unlinked_count}u` : ''}
          </span>
        </label>
      )
    }
    const isOpen = expanded.has(node.path)
    const arcs = descendantArcs(node)
    const checkedCount = arcs.filter((a) => selectedSet.has(a.id)).length
    const allChecked = arcs.length > 0 && checkedCount === arcs.length
    const someChecked = checkedCount > 0 && !allChecked

    return (
      <div key={`folder:${node.path}`}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px',
            paddingLeft: 10 + depth * 16,
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            userSelect: 'none',
          }}
        >
          <button
            onClick={() => toggleFolder(node.path)}
            title={isOpen ? 'Collapse' : 'Expand'}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: 'inherit', display: 'inline-flex', alignItems: 'center',
              flexShrink: 0,
            }}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {onToggleFolder && (
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => { if (el) el.indeterminate = someChecked }}
              onChange={() => onToggleFolder(arcs, !allChecked)}
              title={allChecked ? 'Unselect all in folder' : 'Select all in folder'}
              style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
            />
          )}
          <span
            onClick={() => toggleFolder(node.path)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}
          >
            {isOpen ? <FolderOpen size={12} /> : <Folder size={12} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
              {node.name}
            </span>
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, flexShrink: 0 }}>
              ({collectArcIds([node]).length})
            </span>
          </span>
        </div>
        {isOpen && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search archetypes…"
      />
      <div style={{
        maxHeight, overflowY: 'auto',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        backgroundColor: 'var(--bg-elevated)',
      }}>
        {archetypes.length === 0 && (
          <div style={{ padding: 10, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            {emptyText}
          </div>
        )}
        {archetypes.length > 0 && tree.length === 0 && (
          <div style={{ padding: 10, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            No matches for "{search}"
          </div>
        )}
        {tree.map((node) => renderNode(node, 0))}
      </div>
    </div>
  )
}
