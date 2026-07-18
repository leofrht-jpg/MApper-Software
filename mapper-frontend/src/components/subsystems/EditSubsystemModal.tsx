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
import { useSubsystemStore } from '../../stores/subsystemStore'
import { useDSMStore } from '../../stores/dsmStore'
import type { DimensionDef, Subsystem } from '../../api/client'

interface EditSubsystemModalProps {
  subsystem: Subsystem
  onClose: () => void
}

const labelCol: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 12px',
  backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none',
}

// Edit a dependent subsystem (name / unit / integer flag / dimensions) — the
// subsystem counterpart of EditSystemModal. Saves via the subsystem store's
// saveDependent (PUT). Subsystems inherit the primary's time horizon, so no
// year fields here.
export function EditSubsystemModal({ subsystem, onClose }: EditSubsystemModalProps) {
  const saveDependent = useSubsystemStore((s) => s.saveDependent)
  const primaryHorizon = useDSMStore((s) => s.activeSystem?.time_horizon)

  const [name, setName] = useState(subsystem.name)
  const [unitName, setUnitName] = useState(subsystem.unit_name ?? 'units')
  const [integerUnits, setIntegerUnits] = useState<boolean>(!!subsystem.integer_units)
  const [dimensions, setDimensions] = useState<DimensionDef[]>(subsystem.dimensions)
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

  const validate = (): string => {
    if (!name.trim()) return 'Name is required'
    const editable = dimensions.filter((d) => !d.is_age && d.name && d.labels.length > 0)
    if (editable.length === 0) return 'Define at least one dimension with labels'
    const names = editable.map((d) => d.name)
    if (new Set(names).size !== names.length) return 'Dimension names must be unique'
    return ''
  }

  const handleSave = async () => {
    setError('')
    const err = validate()
    if (err) { setError(err); return }
    setSubmitting(true)
    try {
      const cleaned: DimensionDef[] = dimensions
        .filter((d) => !d.is_age && d.name && d.labels.length > 0)
        .map((d) => ({ name: d.name, display_name: d.display_name || d.name, labels: d.labels, is_age: false }))
      await saveDependent({
        ...subsystem,
        name: name.trim(),
        unit_name: unitName.trim() || 'units',
        integer_units: integerUnits,
        dimensions: cleaned,
      })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update subsystem')
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
        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)', width: 640, maxHeight: '92vh', overflow: 'auto',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Edit subsystem</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              Rename this subsystem or adjust its dimensions and units.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 'var(--radius-sm)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div>
            <label style={labelCol}>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} data-testid="edit-subsystem-name" />
          </div>
          <div>
            <label style={labelCol}>Unit name</label>
            <input
              type="text" value={unitName} onChange={(e) => setUnitName(e.target.value)}
              placeholder="chargers, kg, units…" style={inputStyle}
            />
          </div>

          <div>
            <div style={{ ...labelCol, marginBottom: 10 }}>Dimensions</div>
            <DimensionsEditor
              dimensions={dimensions}
              onChange={setDimensions}
              timeHorizon={primaryHorizon ?? { start_year: 2025, end_year: 2050 }}
            />
          </div>

          <label
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: 'var(--space-3) var(--space-4)', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-elevated)', cursor: 'pointer', userSelect: 'none',
            }}
          >
            <input type="checkbox" checked={integerUnits} onChange={(e) => setIntegerUnits(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--mod-dsm)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>Integer units</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                For discrete products (chargers, buildings), enable to keep counts whole. For continuous quantities (mass, energy), leave off.
              </span>
            </div>
          </label>

          {error && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={submitting} style={{ backgroundColor: 'var(--mod-dsm)' }}>
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
