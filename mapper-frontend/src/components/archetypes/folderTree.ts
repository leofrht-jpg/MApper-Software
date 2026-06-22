/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { ArchetypeSummary } from '../../api/client'

export type TreeNode =
  | { kind: 'folder'; path: string; name: string; children: TreeNode[] }
  | { kind: 'arc'; arc: ArchetypeSummary }

export function buildArchetypeTree(
  archetypes: ArchetypeSummary[],
  folders: string[],
  search: string,
): TreeNode[] {
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

export function subtreeHasArc(node: TreeNode): boolean {
  if (node.kind === 'arc') return true
  return node.children.some(subtreeHasArc)
}

export function collectFolderPaths(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'folder') {
      out.push(n.path)
      collectFolderPaths(n.children, out)
    }
  }
  return out
}

export function collectArcIds(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'arc') out.push(n.arc.id)
    else collectArcIds(n.children, out)
  }
  return out
}
