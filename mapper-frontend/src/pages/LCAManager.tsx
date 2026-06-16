import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Download, Upload, Search, Loader2, CheckCircle, AlertTriangle,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { CollapsibleCard } from '../components/ui/CollapsibleCard'
import { ValidationReportPanel } from '../components/bom/ValidationReportPanel'
import { useBOMStore } from '../stores/bomStore'
import {
  downloadBOMTemplate,
  exportAllArchetypes,
  type MultiImportResult,
} from '../api/client'

type SortKey = 'name' | 'folder' | 'category' | 'material_count' | 'unlinked_count' | 'updated_at'
type SortDir = 'asc' | 'desc'

interface LCAManagerProps {
  onOpenArchetype?: (id: string) => void
}

export function LCAManager({ onOpenArchetype }: LCAManagerProps) {
  const { archetypes, folders, fetchArchetypes, importFromFile, isLoading } = useBOMStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [exporting, setExporting] = useState(false)
  const [exportFolder, setExportFolder] = useState<string>('')
  const [result, setResult] = useState<MultiImportResult | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [importExpanded, setImportExpanded] = useState(true)
  const [exportExpanded, setExportExpanded] = useState(true)

  useEffect(() => { void fetchArchetypes() }, [fetchArchetypes])

  const handleImportClick = () => {
    if (importMode === 'replace' && archetypes.length > 0) {
      const ok = window.confirm(
        `Replace all will delete the ${archetypes.length} existing archetype${archetypes.length === 1 ? '' : 's'} before importing. Continue?`,
      )
      if (!ok) return
    }
    fileRef.current?.click()
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setResult(null)
    try {
      const res = await importFromFile(file, importMode)
      setResult(res)
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setImporting(false)
    }
  }

  const handleExportAll = async () => {
    setExporting(true)
    try { await exportAllArchetypes(null) }
    catch (e) { alert(`Export failed: ${e instanceof Error ? e.message : e}`) }
    finally { setExporting(false) }
  }

  const handleExportFolder = async () => {
    if (!exportFolder) return
    setExporting(true)
    try { await exportAllArchetypes(exportFolder) }
    catch (e) { alert(`Export failed: ${e instanceof Error ? e.message : e}`) }
    finally { setExporting(false) }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = needle
      ? archetypes.filter((a) =>
          a.name.toLowerCase().includes(needle) ||
          (a.folder ?? '').toLowerCase().includes(needle) ||
          (a.category ?? '').toLowerCase().includes(needle) ||
          (a.description ?? '').toLowerCase().includes(needle),
        )
      : [...archetypes]
    rows.sort((a, b) => {
      const av = (a[sortKey] ?? '') as string | number
      const bv = (b[sortKey] ?? '') as string | number
      let cmp = 0
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else cmp = String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [archetypes, search, sortKey, sortDir])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'name' || k === 'folder' || k === 'category' ? 'asc' : 'desc') }
  }

  const sortArrow = (k: SortKey) => (sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '')

  const totals = useMemo(() => {
    const mats = archetypes.reduce((s, a) => s + a.material_count, 0)
    const unlinked = archetypes.reduce((s, a) => s + a.unlinked_count, 0)
    return { count: archetypes.length, mats, unlinked }
  }, [archetypes])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', height: '100%', overflow: 'auto', padding: '2px' }}>
      {/* Top grid: two cards side-by-side */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        gap: 'var(--space-4)',
      }}>
        {/* ── Card 1: Template & Bulk Import (collapsible) ───────────── */}
        <CollapsibleCard
          expanded={importExpanded}
          onToggle={() => setImportExpanded((v) => !v)}
          title="Import"
          summary={`Import .xlsx · Mode: ${importMode === 'merge' ? 'Merge' : 'Replace all'}`}
        >
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '0 0 var(--space-3) 0', lineHeight: 1.5 }}>
            Download the multi-archetype Excel template. Each workbook can declare several archetypes
            with folder paths on its <strong>Archetypes</strong> sheet, then list every BOM row on the
            <strong> BOM</strong> sheet with an <code style={codeStyle}>archetype_name</code> column. Legacy
            single-archetype workbooks are still accepted.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => downloadBOMTemplate().catch((e) => alert(`Download failed: ${e}`))}>
              <Download size={14} /> Download template
            </Button>
            <Button variant="primary" onClick={handleImportClick} disabled={importing} style={{ backgroundColor: 'var(--mod-lca)' }}>
              {importing ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
              {importing ? 'Importing…' : 'Import .xlsx'}
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleImportFile} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginRight: 4 }}>Mode:</span>
            {(['merge', 'replace'] as const).map((m) => {
              const active = importMode === m
              return (
                <button
                  key={m}
                  onClick={() => setImportMode(m)}
                  disabled={importing}
                  style={{
                    height: 24,
                    padding: '0 10px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: active ? 600 : 400,
                    backgroundColor: active ? 'var(--bg-elevated)' : 'transparent',
                    border: `1px solid ${active ? 'var(--mod-lca)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-sm)',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: importing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {m === 'merge' ? 'Merge (add/update)' : 'Replace all'}
                </button>
              )
            })}
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 6 }}>
              {importMode === 'merge'
                ? 'Existing archetypes matched by name are updated; new ones added.'
                : 'Deletes every existing archetype before importing.'}
            </span>
          </div>
          {result && (
            <div style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3)',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontWeight: 600, marginBottom: 6 }}>
                <CheckCircle size={12} /> {result.format === 'multi' ? 'Multi-archetype import' : 'Single-archetype import'}
                {result.mode && (
                  <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
                    · {result.mode === 'replace' ? 'replace all' : 'merge'}
                  </span>
                )}
              </div>
              <div>
                Created <strong>{result.created}</strong>
                {typeof result.updated === 'number' && result.updated > 0 && (
                  <> · Updated <strong>{result.updated}</strong></>
                )}
                {' · '}<strong>{result.folders_created}</strong> new folder{result.folders_created === 1 ? '' : 's'}
              </div>
              {(() => {
                const totErr = result.archetypes.reduce((s, a) => s + (a.validation_error_rows ?? 0), 0)
                const totWarn = result.archetypes.reduce((s, a) => s + (a.validation_warning_rows ?? 0), 0)
                if (totErr === 0 && totWarn === 0) return null
                return (
                  <div style={{
                    marginTop: 6,
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: totErr > 0 ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : 'color-mix(in srgb, var(--warning) 8%, transparent)',
                    border: `1px solid ${totErr > 0 ? 'var(--danger)' : 'var(--warning)'}`,
                    color: totErr > 0 ? 'var(--danger)' : 'var(--warning)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <AlertTriangle size={12} />
                    <span>
                      <strong>{totErr}</strong> error row{totErr === 1 ? '' : 's'} · <strong>{totWarn}</strong> warning row{totWarn === 1 ? '' : 's'} across imported archetypes.
                      {totErr > 0 && ' LCA computation is blocked on archetypes with errors until fixed.'}
                    </span>
                  </div>
                )
              })()}
              {result.archetypes.length > 0 && (
                <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
                  {result.archetypes.slice(0, 8).map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => onOpenArchetype?.(a.id)}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--mod-lca)', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline' }}
                      >
                        {a.name}
                      </button>
                      {a.action && (
                        <span style={{
                          marginLeft: 6,
                          padding: '0 6px',
                          fontSize: 10,
                          borderRadius: 3,
                          color: a.action === 'updated' ? 'var(--warning)' : 'var(--success)',
                          border: `1px solid ${a.action === 'updated' ? 'var(--warning)' : 'var(--success)'}`,
                          textTransform: 'uppercase',
                          letterSpacing: 'var(--tracking-wide)',
                        }}>
                          {a.action}
                        </span>
                      )}
                      {a.folder ? <span style={{ color: 'var(--text-tertiary)' }}> · {a.folder}</span> : null}
                      <span style={{ color: 'var(--text-tertiary)' }}> · {a.materials} materials ({a.unlinked} unlinked)</span>
                      {(a.validation_error_rows ?? 0) > 0 && (
                        <span style={{ color: 'var(--danger)', marginLeft: 4 }}>
                          · {a.validation_error_rows} error{a.validation_error_rows === 1 ? '' : 's'}
                        </span>
                      )}
                      {(a.validation_warning_rows ?? 0) > 0 && (
                        <span style={{ color: 'var(--warning)', marginLeft: 4 }}>
                          · {a.validation_warning_rows} warning{a.validation_warning_rows === 1 ? '' : 's'}
                        </span>
                      )}
                    </li>
                  ))}
                  {result.archetypes.length > 8 && (
                    <li style={{ color: 'var(--text-tertiary)' }}>…and {result.archetypes.length - 8} more</li>
                  )}
                </ul>
              )}
              {result.validation_reports && Object.entries(result.validation_reports).map(([arcName, vr]) => {
                if (vr.error_rows === 0 && vr.warning_rows === 0) return null
                const arc = result.archetypes.find((a) => a.name === arcName)
                return (
                  <ValidationReportPanel
                    key={arcName}
                    report={vr}
                    archetypeName={arcName}
                    onAccept={arc ? () => onOpenArchetype?.(arc.id) : undefined}
                    onReupload={() => fileRef.current?.click()}
                  />
                )
              })}
              {result.warnings.length > 0 && (
                <div style={{ marginTop: 8, color: 'var(--warning)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <strong>Warnings ({result.warnings.length}):</strong>
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
                      {result.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}
                      {result.warnings.length > 10 && <li>…and {result.warnings.length - 10} more</li>}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </CollapsibleCard>

        {/* ── Card 2: Export (collapsible) ────────────────────────────── */}
        <CollapsibleCard
          expanded={exportExpanded}
          onToggle={() => setExportExpanded((v) => !v)}
          title="Export"
          summary={`Export all (${archetypes.length}) · ${archetypes.length} archetype${archetypes.length === 1 ? '' : 's'}`}
        >
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '0 0 var(--space-3) 0', lineHeight: 1.5 }}>
            Export all archetypes, or just the ones under a specific folder, into a single multi-archetype
            workbook you can re-import on another project.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            <Button variant="secondary" onClick={handleExportAll} disabled={exporting || archetypes.length === 0}>
              {exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              Export all ({archetypes.length})
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={exportFolder}
              onChange={(e) => setExportFolder(e.target.value)}
              style={{
                flex: 1, minWidth: 160, height: 32, padding: '0 8px',
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)',
              }}
            >
              <option value="">Select folder…</option>
              {[...folders].sort().map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <Button variant="secondary" onClick={handleExportFolder} disabled={!exportFolder || exporting}>
              {exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              Export folder
            </Button>
          </div>
          {folders.length === 0 && (
            <div style={{ marginTop: 8, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              No folders defined yet. Create folders on the Archetypes tab.
            </div>
          )}
        </CollapsibleCard>
      </div>

      {/* ── Card 3: Archetype Summary (collapsible) ───────────────────── */}
      <CollapsibleCard
        expanded={summaryExpanded}
        onToggle={() => setSummaryExpanded((v) => !v)}
        title="Archetype summary"
        summary={
          <>
            <span><strong style={{ color: 'var(--text-primary)' }}>{totals.count}</strong> archetype{totals.count === 1 ? '' : 's'}</span>
            <span><strong style={{ color: 'var(--text-primary)' }}>{totals.mats}</strong> materials</span>
            {totals.unlinked > 0 && (
              <span style={{ color: 'var(--warning)' }}>
                <strong>{totals.unlinked}</strong> unlinked
              </span>
            )}
          </>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <div style={{ position: 'relative', width: 260 }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, folder, category…"
              style={{
                width: '100%', height: 28, padding: '0 8px 0 26px',
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                fontSize: 'var(--text-xs)', outline: 'none',
              }}
            />
          </div>
        </div>

        <div style={{ overflow: 'auto', maxHeight: 420 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
                {([
                  ['name', 'Name'],
                  ['folder', 'Folder'],
                  ['category', 'Category'],
                  ['material_count', 'Materials'],
                  ['unlinked_count', 'Unlinked'],
                  ['updated_at', 'Updated'],
                ] as Array<[SortKey, string]>).map(([k, label]) => (
                  <th
                    key={k}
                    onClick={() => toggleSort(k)}
                    style={{
                      padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)',
                      fontWeight: 600, cursor: 'pointer', userSelect: 'none',
                      color: sortKey === k ? 'var(--text-primary)' : undefined,
                    }}
                  >
                    {label} <span style={{ color: 'var(--mod-lca)', marginLeft: 2 }}>{sortArrow(k)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && archetypes.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 16, color: 'var(--text-tertiary)' }}>Loading…</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 16, color: 'var(--text-tertiary)' }}>
                  {search.trim() ? 'No archetypes match.' : 'No archetypes defined yet.'}
                </td></tr>
              )}
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => onOpenArchetype?.(a.id)}
                  style={{ color: 'var(--text-primary)', cursor: onOpenArchetype ? 'pointer' : 'default' }}
                >
                  <td style={td}>{a.name}</td>
                  <td style={{ ...td, color: 'var(--text-tertiary)' }}>{a.folder ?? '—'}</td>
                  <td style={{ ...td, color: 'var(--text-tertiary)' }}>{a.category ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{a.material_count}</td>
                  <td style={{ ...td, textAlign: 'right', color: a.unlinked_count > 0 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                    {a.unlinked_count > 0 ? a.unlinked_count : '—'}
                  </td>
                  <td style={{ ...td, color: 'var(--text-tertiary)' }}>
                    {a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleCard>

      <style>{`.spin { animation: spin 1s linear infinite } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)' }
const codeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11, padding: '1px 4px',
  backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
}
