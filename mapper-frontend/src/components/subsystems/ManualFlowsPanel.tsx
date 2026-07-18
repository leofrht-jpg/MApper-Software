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
import {
  uploadSubsystemManualFlow,
  clearSubsystemManualFlow,
  downloadSubsystemManualFlowTemplate,
} from '../../api/client'
import type { Subsystem } from '../../api/client'

interface ManualFlowsPanelProps {
  subsystem: Subsystem
}

// Manual-mode editor: the subsystem's stock is simulated from its OWN uploaded
// inflows (+ optional outflows), independent of the primary system — the same
// CSV/XLSX upload convention as the primary's Annual inflows/outflows.
export function ManualFlowsPanel({ subsystem }: ManualFlowsPanelProps) {
  const systemId = useSubsystemStore((s) => s.currentSystemId)
  const fetchForSystem = useSubsystemStore((s) => s.fetchForSystem)

  return (
    <div
      data-testid="subsystem-manual-flows"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
    >
      <FlowSlot
        kind="inflows"
        title="Annual inflows"
        description="Required. New units added per cohort per year. Drives the subsystem's independent stock simulation."
        subsystem={subsystem}
        systemId={systemId}
        onChanged={() => systemId && fetchForSystem(systemId)}
        data={subsystem.manual_inflows ?? {}}
      />
      <FlowSlot
        kind="outflows"
        title="Annual outflows"
        description="Optional. Explicit removals per cohort per year. If omitted, Weibull survival derives outflows."
        subsystem={subsystem}
        systemId={systemId}
        onChanged={() => systemId && fetchForSystem(systemId)}
        data={subsystem.manual_outflows ?? {}}
      />
    </div>
  )
}

function FlowSlot({
  kind, title, description, subsystem, systemId, onChanged, data,
}: {
  kind: 'inflows' | 'outflows'
  title: string
  description: string
  subsystem: Subsystem
  systemId: string | null
  onChanged: () => void
  data: Record<string, Record<string, number>>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')

  const cohorts = Object.keys(data).filter((c) => Object.keys(data[c] ?? {}).length > 0)

  const handleUpload = async (file: File) => {
    if (!systemId) return
    setBusy(true); setError(''); setFlash('')
    try {
      const res = await uploadSubsystemManualFlow(systemId, subsystem.id, kind, file)
      setFlash(`Loaded ${res.cohorts_found} cohort${res.cohorts_found === 1 ? '' : 's'} · ${res.rows_parsed} rows`)
      setTimeout(() => setFlash(''), 3000)
      onChanged()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleClear = async () => {
    if (!systemId) return
    setBusy(true); setError('')
    try {
      await clearSubsystemManualFlow(systemId, subsystem.id, kind)
      onChanged()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Clear failed')
    } finally { setBusy(false) }
  }

  const handleTemplate = async () => {
    if (!systemId) return
    setError('')
    try {
      await downloadSubsystemManualFlowTemplate(systemId, subsystem.id, kind, subsystem.name)
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{description}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {flash && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--success)' }}>
              <CheckCircle2 size={12} /> {flash}
            </span>
          )}
          <Button variant="ghost" onClick={handleTemplate} disabled={busy || !systemId}>
            <Download size={14} strokeWidth={1.5} /> Template
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy || !systemId} data-testid={`manual-${kind}-upload`}>
            <Upload size={14} strokeWidth={1.5} /> {busy ? 'Uploading…' : 'Upload'}
          </Button>
          {cohorts.length > 0 && (
            <Button variant="ghost" onClick={handleClear} disabled={busy} title={`Clear ${kind}`}>
              <Trash2 size={14} strokeWidth={1.5} /> Clear
            </Button>
          )}
          <input
            ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
          />
        </div>
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', backgroundColor: 'var(--danger-muted)',
          border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-xs)', color: 'var(--danger)',
        }}>{error}</div>
      )}

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        {cohorts.length === 0
          ? `No ${kind} uploaded.`
          : `${cohorts.length} cohort${cohorts.length === 1 ? '' : 's'}: ${cohorts.slice(0, 6).join(', ')}${cohorts.length > 6 ? '…' : ''}`}
      </div>
    </div>
  )
}
