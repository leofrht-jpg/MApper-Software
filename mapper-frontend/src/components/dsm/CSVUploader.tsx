import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { Button } from '../ui/Button'

interface CSVUploaderProps {
  label: string
  description?: string
  /**
   * Reserve a fixed vertical space for the schema-subtitle (`description`) row.
   * Used by parallel-input boxes (DSM inflows/outflows) so the drop-zone starts
   * at the same vertical offset regardless of how many lines the subtitle wraps
   * to. Omit for boxes that don't need wrap-independent alignment.
   */
  descriptionMinHeight?: number | string
  onUpload: (file: File) => Promise<{ summary: string }>
  onDownloadTemplate?: () => Promise<void>
}

interface PreviewRow {
  cells: string[]
}

const MAX_PREVIEW_ROWS = 5

function parsePreview(text: string): { headers: string[]; rows: PreviewRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, MAX_PREVIEW_ROWS + 1)
  if (lines.length === 0) return { headers: [], rows: [] }
  const delim = (lines[0].match(/;/g) ?? []).length > (lines[0].match(/,/g) ?? []).length ? ';' : ','
  const headers = lines[0].split(delim).map((c) => c.trim())
  const rows: PreviewRow[] = lines.slice(1).map((l) => ({ cells: l.split(delim).map((c) => c.trim()) }))
  return { headers, rows }
}

export function CSVUploader({ label, description, descriptionMinHeight, onUpload, onDownloadTemplate }: CSVUploaderProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{ headers: string[]; rows: PreviewRow[] } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (f: File) => {
    setFile(f)
    setError('')
    setSuccess('')
    const isCSV = /\.csv$/i.test(f.name)
    if (isCSV) {
      const text = await f.text()
      setPreview(parsePreview(text))
    } else {
      // Excel files can't be previewed client-side; parsing happens server-side.
      setPreview(null)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleSubmit = async () => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const res = await onUpload(file)
      setSuccess(res.summary)
      setFile(null)
      setPreview(null)
      if (inputRef.current) inputRef.current.value = ''
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleCancel = () => {
    setFile(null)
    setPreview(null)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
          {description && (
            <div
              data-testid="csv-subtitle"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                marginTop: 2,
                lineHeight: 1.4,
                ...(descriptionMinHeight != null ? { minHeight: descriptionMinHeight } : {}),
              }}
            >
              {description}
            </div>
          )}
        </div>
        {onDownloadTemplate && (
          <button
            onClick={onDownloadTemplate}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mod-dsm)', fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Download size={12} strokeWidth={1.5} /> Download template
          </button>
        )}
      </div>

      {!file ? (
        <label
          data-testid="csv-dropzone"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: 'var(--space-6)',
            // Fixed height so the drop-zone renders identically across boxes and
            // upload states regardless of how much header content sits above it.
            minHeight: 110,
            border: `1px dashed ${dragOver ? 'var(--mod-dsm)' : 'var(--border-default)'}`,
            borderRadius: 'var(--radius-md)',
            backgroundColor: dragOver ? 'color-mix(in srgb, var(--mod-dsm) 6%, transparent)' : 'var(--bg-elevated)',
            cursor: 'pointer',
            transition: 'border-color var(--duration-fast), background-color var(--duration-fast)',
          }}
        >
          <Upload size={20} strokeWidth={1.5} color="var(--text-secondary)" />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Drop CSV or Excel file here or click to browse
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </label>
      ) : (
        <div style={{ padding: 'var(--space-4)', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileSpreadsheet size={16} color="var(--mod-dsm)" />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>{file.name}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {(file.size / 1024).toFixed(1)} KB
              </span>
            </div>
            <button onClick={handleCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>

          {preview && preview.headers.length > 0 && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-surface)' }}>
                    {preview.headers.map((h) => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: 'var(--tracking-wide)', borderBottom: '1px solid var(--border-subtle)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      {r.cells.map((c, j) => (
                        <td key={j} style={{ padding: '4px 8px', color: 'var(--text-primary)', fontFamily: j === r.cells.length - 1 ? 'var(--font-mono)' : 'inherit', borderBottom: '1px solid var(--border-subtle)' }}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={handleCancel}>Cancel</Button>
            <Button variant="primary" onClick={handleSubmit} disabled={uploading} style={{ backgroundColor: 'var(--mod-dsm)' }}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: '8px 12px', backgroundColor: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: '8px 12px', backgroundColor: 'var(--success-muted)', border: '1px solid var(--success)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--success)' }}>
          {success}
        </div>
      )}
    </div>
  )
}
