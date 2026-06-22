/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '../ui/Button'
import { DimensionsEditor } from '../dsm/DimensionsEditor'
import { UnitTypePicker } from '../dsm/UnitTypePicker'
import { useSubsystemStore } from '../../stores/subsystemStore'
import { useDSMStore } from '../../stores/dsmStore'
import type { DimensionDef } from '../../api/client'

interface AddSubsystemDialogProps {
  onClose: () => void
  onCreated?: (subsystemId: string) => void
}

const labelCol: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  display: 'block',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 12px',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
}

export function AddSubsystemDialog({ onClose, onCreated }: AddSubsystemDialogProps) {
  const addDependent = useSubsystemStore((s) => s.addDependent)
  const activeSystem = useDSMStore((s) => s.activeSystem)
  const horizon = activeSystem?.time_horizon ?? { start_year: 2020, end_year: 2050 }

  const [name, setName] = useState('Dependent subsystem')
  const [dimensions, setDimensions] = useState<DimensionDef[]>([
    { name: '', display_name: '', labels: [], is_age: false },
  ])
  const [integerUnits, setIntegerUnits] = useState<boolean>(true)
  const [unitName, setUnitName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

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
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    const validDims = dimensions.filter((d) => !d.is_age && d.name && d.labels.length > 0)
    if (validDims.length === 0) { setError('Define at least one dimension with labels'); return }
    const names = validDims.map((d) => d.name)
    if (new Set(names).size !== names.length) { setError('Dimension names must be unique'); return }

    setSubmitting(true)
    try {
      const cleaned: DimensionDef[] = validDims.map((d) => ({
        name: d.name, display_name: d.display_name || d.name, labels: d.labels, is_age: false,
      }))
      const created = await addDependent({
        name: name.trim(),
        dimensions: cleaned,
        dependency_rules: [],
        unit_name: unitName.trim() || (integerUnits ? 'units' : 'kg'),
        integer_units: integerUnits,
      })
      onCreated?.(created.id)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create subsystem')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        width: 640, maxHeight: '92vh', overflow: 'auto',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Add subsystem</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              A dependent product group whose stock is derived from {activeSystem?.name ?? 'the primary system'}.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 'var(--radius-sm)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label style={labelCol}>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>

          <div>
            <label style={{ ...labelCol, marginBottom: 10 }}>Dimensions</label>
            <DimensionsEditor
              dimensions={dimensions}
              onChange={setDimensions}
              timeHorizon={horizon}
            />
          </div>

          <UnitTypePicker
            integerUnits={integerUnits}
            unitName={unitName}
            onIntegerUnitsChange={setIntegerUnits}
            onUnitNameChange={setUnitName}
          />

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Dependency rules are added from the subsystem's own tab after creation.
          </p>

          {error && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleCreate} disabled={submitting} style={{ backgroundColor: 'var(--mod-dsm)' }}>
              {submitting ? 'Creating…' : 'Create subsystem'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
