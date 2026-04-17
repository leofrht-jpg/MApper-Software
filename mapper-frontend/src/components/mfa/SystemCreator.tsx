import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '../ui/Button'
import { DimensionsEditor } from './DimensionsEditor'
import { useMFAStore } from '../../stores/mfaStore'
import type { DimensionDef } from '../../api/client'

interface SystemCreatorProps {
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

export function SystemCreator({ onClose }: SystemCreatorProps) {
  const createSystem = useMFAStore((s) => s.createSystem)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState('Danish Automotive Fleet')
  const [description, setDescription] = useState('')
  const [startYear, setStartYear] = useState(2025)
  const [endYear, setEndYear] = useState(2050)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [dimensions, setDimensions] = useState<DimensionDef[]>([
    { name: 'fuel_type', display_name: 'Fuel Type', labels: ['BEV', 'PHEV', 'Petrol', 'Diesel', 'HEV', 'LPG/CNG'], is_age: false },
    { name: 'size', display_name: 'Size', labels: ['Small', 'Medium', 'SUV'], is_age: false },
  ])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const cohortCount = useMemo(
    () => dimensions.filter((d) => !d.is_age).reduce((acc, d) => acc * Math.max(d.labels.length, 1), 1),
    [dimensions],
  )

  const validateBasic = () => {
    if (!name.trim()) return 'Name is required'
    if (endYear < startYear) return 'End year must be ≥ start year'
    if (endYear - startYear > 200) return 'Time horizon too long'
    return ''
  }

  const validateDims = () => {
    const validDims = dimensions.filter((d) => !d.is_age && d.name && d.labels.length > 0)
    if (validDims.length === 0) return 'Define at least one dimension with labels'
    const names = validDims.map((d) => d.name)
    if (new Set(names).size !== names.length) return 'Dimension names must be unique'
    return ''
  }

  const handleNext = () => {
    setError('')
    if (step === 1) {
      const err = validateBasic()
      if (err) { setError(err); return }
      setStep(2)
    } else if (step === 2) {
      const err = validateDims()
      if (err) { setError(err); return }
      setStep(3)
    }
  }

  const handleCreate = async () => {
    setError('')
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
      await createSystem({
        name: name.trim(),
        description: description.trim() || null,
        time_horizon: { start_year: startYear, end_year: endYear },
        dimensions: cleaned,
      })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create system')
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
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Create MFA system</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>Step {step} of 3</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 'var(--radius-sm)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 'var(--space-4) 0 0' }}>
          {[1, 2, 3].map((s) => (
            <div key={s} style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', backgroundColor: s <= step ? 'var(--mod-mfa)' : 'var(--bg-active)' }} />
          ))}
        </div>

        <div style={{ padding: 'var(--space-6)' }}>
          {step === 1 && (
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
                  rows={3}
                  style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical', fontFamily: 'inherit' }}
                />
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
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {endYear - startYear + 1} years tracked. Max possible age = {endYear - startYear + 1}.
              </p>
            </div>
          )}

          {step === 2 && (
            <DimensionsEditor
              dimensions={dimensions}
              onChange={setDimensions}
              timeHorizon={{ start_year: startYear, end_year: endYear }}
            />
          )}

          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <SummaryRow label="Name" value={name} />
              {description && <SummaryRow label="Description" value={description} />}
              <SummaryRow label="Time horizon" value={`${startYear} – ${endYear} (${endYear - startYear + 1} years)`} />
              <div>
                <div style={{ ...labelCol, marginBottom: 8 }}>Dimensions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dimensions.filter((d) => !d.is_age && d.name && d.labels.length).map((d) => (
                    <div key={d.name} style={{ padding: '10px 12px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{d.display_name || d.name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
                        {d.labels.length} labels · {d.labels.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding: 'var(--space-4)', backgroundColor: 'color-mix(in srgb, var(--mod-mfa) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mod-mfa) 30%, transparent)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                  This system will track <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--mod-mfa)' }}>{cohortCount}</strong> cohort combinations.
                </span>
              </div>
            </div>
          )}

          {error && (
            <p style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</p>
          )}

          <div style={{ marginTop: 'var(--space-6)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {step > 1 && <Button variant="ghost" onClick={() => setStep((step - 1) as 1 | 2)}>Back</Button>}
            {step < 3 && <Button variant="primary" onClick={handleNext} style={{ backgroundColor: 'var(--mod-mfa)' }}>Next</Button>}
            {step === 3 && (
              <Button variant="primary" onClick={handleCreate} disabled={submitting} style={{ backgroundColor: 'var(--mod-mfa)' }}>
                {submitting ? 'Creating…' : 'Create system'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={labelCol}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}
