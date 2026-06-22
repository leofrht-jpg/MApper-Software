/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useRef, useState } from 'react'
import { Download, Upload, Trash2, CheckCircle2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { useSubsystemStore } from '../../stores/subsystemStore'
import type { Subsystem } from '../../api/client'

interface InitialStockPanelProps {
  subsystem: Subsystem
}

export function InitialStockPanel({ subsystem }: InitialStockPanelProps) {
  const uploadInitialStock = useSubsystemStore((s) => s.uploadInitialStock)
  const clearInitialStock = useSubsystemStore((s) => s.clearInitialStock)
  const downloadStockTemplate = useSubsystemStore((s) => s.downloadStockTemplate)

  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')

  const entries = Object.entries(subsystem.initial_stock ?? {}).filter(([, v]) => v)
  const total = entries.reduce((s, [, v]) => s + v, 0)

  const handleUpload = async (file: File) => {
    setBusy(true)
    setError('')
    setFlash('')
    try {
      const summary = await uploadInitialStock(subsystem.id, file)
      setFlash(`Loaded ${summary.archetypes_found} archetype${summary.archetypes_found === 1 ? '' : 's'} · ${formatNumber(summary.total_items)} items`)
      setTimeout(() => setFlash(''), 3500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleClear = async () => {
    setBusy(true)
    setError('')
    setFlash('')
    try {
      await clearInitialStock(subsystem.id)
      setFlash('Cleared')
      setTimeout(() => setFlash(''), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Clear failed')
    } finally {
      setBusy(false)
    }
  }

  const handleTemplate = async () => {
    setError('')
    try {
      await downloadStockTemplate(subsystem.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Template download failed')
    }
  }

  return (
    <div style={{
      padding: 'var(--space-4)', backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            Initial stock
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Base-year floor per archetype. Rules drive subsequent years; outflows emit if rules push below this.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {flash && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--success)' }}>
              <CheckCircle2 size={12} /> {flash}
            </span>
          )}
          <Button variant="ghost" onClick={handleTemplate} disabled={busy}>
            <Download size={14} strokeWidth={1.5} /> Template
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload size={14} strokeWidth={1.5} /> {busy ? 'Uploading…' : 'Upload'}
          </Button>
          {entries.length > 0 && (
            <Button variant="ghost" onClick={handleClear} disabled={busy} title="Clear initial stock">
              <Trash2 size={14} strokeWidth={1.5} /> Clear
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleUpload(f)
            }}
          />
        </div>
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', backgroundColor: 'var(--danger-muted)',
          border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-xs)', color: 'var(--danger)',
        }}>
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{
          padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)',
          border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textAlign: 'center',
        }}>
          No initial stock. Stock trajectory will be pure rule-derived from year one.
        </div>
      ) : (
        <div style={{
          border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
          overflow: 'hidden', backgroundColor: 'var(--bg-elevated)',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-surface)' }}>
                <th style={thStyle}>Archetype</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{k}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatNumber(v)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>Total</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{formatNumber(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontWeight: 600,
  color: 'var(--text-secondary)', textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)', fontSize: '10px',
}

const tdStyle: React.CSSProperties = {
  padding: '6px 10px', color: 'var(--text-primary)',
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
