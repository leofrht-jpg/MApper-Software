/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import {
  type ActivitySummary,
  type DatabaseResponse,
  type EcoinventLink,
  getActivities,
  getDatabases,
} from '../../api/client'

interface EcoinventLinkerProps {
  current?: EcoinventLink | null
  onClose: () => void
  onPick: (link: EcoinventLink) => void
}

export function EcoinventLinker({ current, onClose, onPick }: EcoinventLinkerProps) {
  const [databases, setDatabases] = useState<DatabaseResponse[]>([])
  const [database, setDatabase] = useState<string>(current?.database ?? '')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ActivitySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<ActivitySummary | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    getDatabases()
      .then((dbs) => {
        setDatabases(dbs)
        if (!database && dbs.length > 0) setDatabase(dbs[0].name)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    if (!database || query.trim().length < 2) {
      setResults([])
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      getActivities(database, 0, 30, query.trim())
        .then((page) => setResults(page.items))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false))
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [database, query])

  const confirm = () => {
    if (!selected) return
    const link: EcoinventLink = {
      database: selected.database || database,
      code: selected.code,
      name: selected.name,
      location: selected.location,
      unit: selected.unit,
      reference_product: selected.product,
    }
    onPick(link)
    onClose()
  }

  const headerCell: React.CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
    backgroundColor: 'var(--bg-elevated)', position: 'sticky', top: 0,
  }
  const cell: React.CSSProperties = { padding: '6px 10px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 760, maxHeight: '90vh', backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Link to ecoinvent activity</h3>
            {current && (
              <div style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                Currently linked: <strong>{current.name}</strong> · <Badge label={current.database} variant="lca" />
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-6)', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}>
          <select
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            style={{ height: 32, padding: '0 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
          >
            {databases.map((db) => <option key={db.name} value={db.name}>{db.name}</option>)}
          </select>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} color="var(--text-tertiary)" style={{ position: 'absolute', left: 10, top: 9, pointerEvents: 'none' }} />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search activities (min 2 chars)…"
              style={{ width: '100%', height: 32, padding: '0 8px 0 30px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none' }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 200 }}>
          {error && <div style={{ padding: 12, color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{error}</div>}
          {loading && <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Searching…</div>}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>No matches.</div>
          )}
          {results.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headerCell}>Name</th>
                  <th style={headerCell}>Reference product</th>
                  <th style={headerCell}>Location</th>
                  <th style={headerCell}>Unit</th>
                </tr>
              </thead>
              <tbody>
                {results.map((a) => {
                  const isSel = selected?.code === a.code && selected?.database === a.database
                  return (
                    <tr
                      key={`${a.database}_${a.code}`}
                      onClick={() => setSelected(a)}
                      style={{ cursor: 'pointer', backgroundColor: isSel ? 'color-mix(in srgb, var(--mod-lca) 12%, transparent)' : 'transparent', borderBottom: '1px solid var(--border-subtle)' }}
                    >
                      <td style={cell}>{a.name}</td>
                      <td style={cell}>{a.product}</td>
                      <td style={cell}><Badge label={a.location || '—'} /></td>
                      <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{a.unit}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={!selected} style={{ backgroundColor: 'var(--mod-lca)' }}>
            Link activity
          </Button>
        </div>
      </div>
    </div>
  )
}
