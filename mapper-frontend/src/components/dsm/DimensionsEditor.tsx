import { useRef, useState } from 'react'
import { Plus, Trash2, X, Upload, Download } from 'lucide-react'
import { Button } from '../ui/Button'
import { parseLabelFile, type DimensionDef } from '../../api/client'

interface DimensionsEditorProps {
  dimensions: DimensionDef[]
  onChange: (dimensions: DimensionDef[]) => void
  timeHorizon: { start_year: number; end_year: number }
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

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

export function DimensionsEditor({ dimensions, onChange, timeHorizon }: DimensionsEditorProps) {
  const nonAgeDims = dimensions.filter((d) => !d.is_age)
  const horizonLen = timeHorizon.end_year - timeHorizon.start_year + 1

  const updateDim = (idx: number, patch: Partial<DimensionDef>) => {
    const editable = dimensions.filter((d) => !d.is_age)
    const updated = editable.map((d, i) => (i === idx ? { ...d, ...patch } : d))
    const ageDims = dimensions.filter((d) => d.is_age)
    onChange([...updated, ...ageDims])
  }

  const addDim = () => {
    const ageDims = dimensions.filter((d) => d.is_age)
    const editable = dimensions.filter((d) => !d.is_age)
    onChange([...editable, { name: '', display_name: '', labels: [], is_age: false }, ...ageDims])
  }

  const deleteDim = (idx: number) => {
    const editable = dimensions.filter((d) => !d.is_age).filter((_, i) => i !== idx)
    const ageDims = dimensions.filter((d) => d.is_age)
    onChange([...editable, ...ageDims])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Define the characteristics that describe items in your system.{' '}
        <strong style={{ color: 'var(--text-primary)' }}>Age is added automatically</strong> from the time horizon.
      </p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', backgroundColor: 'var(--bg-elevated)',
        border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)',
      }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)' }}>age</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          auto-generated · {horizonLen} possible values (0 – {horizonLen - 1})
        </span>
      </div>

      {nonAgeDims.map((dim, idx) => (
        <SingleDimensionEditor
          key={idx}
          dim={dim}
          siblingDimensionNames={nonAgeDims.map((d) => d.name).filter((n) => n && n !== dim.name)}
          onChange={(patch) => updateDim(idx, patch)}
          onDelete={() => deleteDim(idx)}
        />
      ))}

      <Button variant="ghost" onClick={addDim} style={{ alignSelf: 'flex-start', color: 'var(--mod-dsm)' }}>
        <Plus size={14} strokeWidth={1.5} /> Add dimension
      </Button>
    </div>
  )
}

interface SingleDimensionEditorProps {
  dim: DimensionDef
  siblingDimensionNames: string[]
  onChange: (patch: Partial<DimensionDef>) => void
  onDelete: () => void
}

function SingleDimensionEditor({ dim, siblingDimensionNames, onChange, onDelete }: SingleDimensionEditorProps) {
  const [labelDraft, setLabelDraft] = useState('')
  const [flash, setFlash] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addLabel = (label: string) => {
    const trimmed = label.trim()
    if (!trimmed) return
    if (dim.labels.includes(trimmed)) return
    onChange({ labels: [...dim.labels, trimmed] })
  }

  const removeLabel = (label: string) => {
    onChange({ labels: dim.labels.filter((l) => l !== label) })
  }

  const setLabels = (labels: string[]) => onChange({ labels })

  const handleLabelKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addLabel(labelDraft)
      setLabelDraft('')
    }
  }

  const showFlash = (msg: string, isError = false) => {
    setFlash((isError ? '⚠ ' : '') + msg)
    setTimeout(() => setFlash(''), 2500)
  }

  const handleUploadClick = () => {
    if (!dim.name) {
      showFlash('Set a machine name first', true)
      return
    }
    fileInputRef.current?.click()
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const valid = [dim.name, ...siblingDimensionNames].filter(Boolean)
      const res = await parseLabelFile(file, dim.name, valid)
      const parsed = res.labels
      if (parsed.length === 0) { showFlash('No labels found', true); return }
      const merged = Array.from(new Set([...dim.labels, ...parsed]))
      const added = merged.length - dim.labels.length
      setLabels(merged)
      showFlash(`Loaded ${parsed.length} label${parsed.length === 1 ? '' : 's'}${added < parsed.length ? ` (${added} new)` : ''}`)
    } catch (err) {
      showFlash(err instanceof Error ? err.message : 'Failed to parse file', true)
    }
  }

  const handleDownloadTemplate = () => {
    if (!dim.name) {
      showFlash('Set a machine name first', true)
      return
    }
    const rows = [dim.name, ...dim.labels]
    const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${dim.name}_labels.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{
      padding: 'var(--space-4)', backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
        <div>
          <label style={labelCol}>Display name</label>
          <input
            type="text"
            value={dim.display_name}
            onChange={(e) => {
              const display = e.target.value
              onChange({ display_name: display, name: dim.name || slugify(display) })
            }}
            placeholder="e.g. Material, Technology, Size"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelCol}>Machine name</label>
          <input
            type="text"
            value={dim.name}
            onChange={(e) => onChange({ name: slugify(e.target.value) })}
            placeholder="dimension_name"
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          />
        </div>
        <button
          onClick={onDelete}
          aria-label="Delete dimension"
          style={{
            height: 36, width: 36, background: 'none',
            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
            cursor: 'pointer', color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.borderColor = 'var(--danger)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-default)' }}
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ ...labelCol, marginBottom: 0 }}>Labels</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {flash && (
              <span style={{ fontSize: 'var(--text-xs)', color: flash.startsWith('⚠') ? 'var(--danger)' : 'var(--success)' }}>
                {flash}
              </span>
            )}
            <button
              onClick={handleUploadClick}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mod-dsm)', fontSize: 'var(--text-xs)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}
            >
              <Upload size={11} strokeWidth={1.5} /> Upload CSV/Excel
            </button>
            <button
              onClick={handleDownloadTemplate}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mod-dsm)', fontSize: 'var(--text-xs)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}
            >
              <Download size={11} strokeWidth={1.5} /> Download template
            </button>
            {dim.labels.length > 0 && (
              <button
                onClick={() => setLabels([])}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 'var(--text-xs)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}
              >
                <Trash2 size={11} strokeWidth={1.5} /> Clear all
              </button>
            )}
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={handleFile} style={{ display: 'none' }} />
          </div>
        </div>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6,
          backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)', minHeight: 36,
        }}>
          {dim.labels.map((l) => (
            <span key={l} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'color-mix(in srgb, var(--mod-dsm) 12%, transparent)',
              color: 'var(--mod-dsm)', fontSize: 'var(--text-xs)', fontWeight: 500,
            }}>
              {l}
              <button onClick={() => removeLabel(l)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex' }}>
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={handleLabelKey}
            onBlur={() => { if (labelDraft) { addLabel(labelDraft); setLabelDraft('') } }}
            placeholder="Type a label and press Enter…"
            style={{ flex: 1, minWidth: 140, height: 24, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none' }}
          />
        </div>
      </div>
    </div>
  )
}
