import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { DimensionsEditor } from './DimensionsEditor'
import { useDSMStore } from '../../stores/dsmStore'
import { getMFAState, patchDSMSettings } from '../../api/client'
import type { DimensionDef, SystemDefinition } from '../../api/client'

interface EditSystemModalProps {
  system: SystemDefinition
  onClose: () => void
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

export function EditSystemModal({ system, onClose }: EditSystemModalProps) {
  const updateSystem = useDSMStore((s) => s.updateSystem)

  const [name, setName] = useState(system.name)
  const [description, setDescription] = useState(system.description ?? '')
  const [unitName, setUnitName] = useState(system.unit_name ?? 'units')
  const [startYear, setStartYear] = useState(system.time_horizon.start_year)
  const [endYear, setEndYear] = useState(system.time_horizon.end_year)
  const [dimensions, setDimensions] = useState<DimensionDef[]>(system.dimensions)
  const [integerUnits, setIntegerUnits] = useState<boolean>(false)
  const [initialIntegerUnits, setInitialIntegerUnits] = useState<boolean>(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    if (!system.id) return
    let cancelled = false
    getMFAState(system.id)
      .then((s) => {
        if (cancelled) return
        setIntegerUnits(!!s.integer_units)
        setInitialIntegerUnits(!!s.integer_units)
      })
      .catch(() => { /* leave default off */ })
    return () => { cancelled = true }
  }, [system.id])

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
    if (endYear < startYear) return 'End year must be ≥ start year'
    if (endYear - startYear > 200) return 'Time horizon too long'
    const editable = dimensions.filter((d) => !d.is_age && d.name && d.labels.length > 0)
    if (editable.length === 0) return 'Define at least one dimension with labels'
    const names = editable.map((d) => d.name)
    if (new Set(names).size !== names.length) return 'Dimension names must be unique'
    return ''
  }

  const handleSave = async () => {
    setError('')
    setWarnings([])
    const err = validate()
    if (err) { setError(err); return }
    if (!system.id) { setError('Missing system id'); return }
    setSubmitting(true)
    try {
      const cleaned: DimensionDef[] = dimensions
        .filter((d) => !d.is_age && d.name && d.labels.length > 0)
        .map((d) => ({
          name: d.name,
          display_name: d.display_name || d.name,
          labels: d.labels,
          is_age: false,
        }))
      const res = await updateSystem({
        id: system.id,
        name: name.trim(),
        description: description.trim() || null,
        time_horizon: { start_year: startYear, end_year: endYear },
        dimensions: cleaned,
        created_at: system.created_at ?? null,
        unit_name: unitName.trim() || 'units',
      })
      if (integerUnits !== initialIntegerUnits) {
        await patchDSMSettings(system.id, { integer_units: integerUnits })
        setInitialIntegerUnits(integerUnits)
      }
      if (res.warnings.length > 0) {
        setWarnings(res.warnings)
      } else {
        onClose()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update system')
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
        width: 640,
        maxHeight: '92vh',
        overflow: 'auto',
        boxShadow: 'var(--shadow-lg)',
        animation: 'modalIn var(--duration-normal) var(--ease-out)',
      }}>
        <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}`}</style>

        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Edit system</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              Changes to dimensions migrate existing stock, inflows and survival configs where possible.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 'var(--radius-sm)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div>
              <label style={labelCol}>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelCol}>Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>
            <div>
              <label style={labelCol}>Unit name</label>
              <input
                type="text"
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                placeholder="vehicles, turbines, buildings, units…"
                style={inputStyle}
              />
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
                Label for one product of this system. Shown alongside kg in Material Flows.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div>
                <label style={labelCol}>Start year</label>
                <input type="number" value={startYear} onChange={(e) => setStartYear(Number(e.target.value))} style={inputStyle} />
              </div>
              <div>
                <label style={labelCol}>End year</label>
                <input type="number" value={endYear} onChange={(e) => setEndYear(Number(e.target.value))} style={inputStyle} />
              </div>
            </div>
          </div>

          <div>
            <div style={{ ...labelCol, marginBottom: 10 }}>Dimensions</div>
            <DimensionsEditor
              dimensions={dimensions}
              onChange={setDimensions}
              timeHorizon={{ start_year: startYear, end_year: endYear }}
            />
          </div>

          <div>
            <div style={{ ...labelCol, marginBottom: 10 }}>Units</div>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: 'var(--space-3) var(--space-4)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-elevated)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              title="For discrete products (vehicles, buildings, machines), enable to ensure stock counts are whole numbers. For continuous quantities (mass, energy, kg), leave disabled."
            >
              <input
                type="checkbox"
                checked={integerUnits}
                onChange={(e) => setIntegerUnits(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--mod-dsm)' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>
                  Integer units
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  For discrete products (vehicles, buildings, machines), enable to ensure stock counts are whole numbers. For continuous quantities (mass, energy, kg), leave disabled.
                </span>
              </div>
            </label>
          </div>

          {warnings.length > 0 && (
            <div style={{
              padding: 'var(--space-4)',
              backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--warning)' }}>
                <AlertTriangle size={14} strokeWidth={1.5} />
                Changes applied with warnings
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {warnings.map((w, i) => (
                  <li key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)' }}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>
              {warnings.length > 0 ? 'Close' : 'Cancel'}
            </Button>
            {warnings.length === 0 && (
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={submitting}
                style={{ backgroundColor: 'var(--mod-dsm)' }}
              >
                {submitting ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
