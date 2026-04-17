import { X, AlertCircle, CalendarRange } from 'lucide-react'
import { Badge } from '../ui/Badge'
import type { FlattenedBOM as FlattenedBOMType } from '../../api/client'

interface FlattenedBOMProps {
  data: FlattenedBOMType
  year?: number | null
  onYearChange?: (year: number | null) => void
  onClose: () => void
}

const YEAR_OPTIONS = [null, 2025, 2030, 2035, 2040, 2045, 2050] as const

const fmt = (n: number) => {
  if (Math.abs(n) >= 1000 || (Math.abs(n) > 0 && Math.abs(n) < 0.01)) return n.toExponential(3)
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export function FlattenedBOM({ data, year = null, onYearChange, onClose }: FlattenedBOMProps) {
  const headerCell: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
    backgroundColor: 'var(--bg-elevated)', position: 'sticky', top: 0,
  }
  const cell: React.CSSProperties = { padding: '8px 12px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 880, maxHeight: '90vh', backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
              Flattened BOM
              {year != null && <span style={{ marginLeft: 8, fontSize: 'var(--text-sm)', color: 'var(--mod-plca)' }}>· {year}</span>}
            </h3>
            <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              Materials after multiplicative cascade through the tree.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {onYearChange && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                <CalendarRange size={13} strokeWidth={1.5} />
                Year
                <select
                  value={year ?? ''}
                  onChange={(e) => onYearChange(e.target.value === '' ? null : Number(e.target.value))}
                  style={{ padding: '4px 8px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)' }}
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y ?? 'static'} value={y ?? ''}>{y == null ? 'Static (no evolution)' : y}</option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Summary strip */}
        <div style={{
          padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', gap: 'var(--space-6)', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>Materials</div>
            <div style={{ fontSize: 'var(--text-lg)', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{data.materials.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>Total mass (kg)</div>
            <div style={{ fontSize: 'var(--text-lg)', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--mod-lca)' }}>{fmt(data.total_mass_kg)}</div>
          </div>
          {data.unlinked_count > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warning)', fontSize: 'var(--text-sm)' }}>
              <AlertCircle size={16} />
              {data.unlinked_count} unlinked material{data.unlinked_count === 1 ? '' : 's'}
            </div>
          )}
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {data.materials.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              No materials in this BOM.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headerCell}>Material</th>
                  <th style={headerCell}>Path</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Effective qty</th>
                  <th style={headerCell}>Unit</th>
                  <th style={headerCell}>Ecoinvent activity</th>
                  <th style={headerCell}>Location</th>
                </tr>
              </thead>
              <tbody>
                {data.materials.map((m) => {
                  const linked = m.ecoinvent_activity
                  return (
                    <tr key={m.node_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ ...cell, fontWeight: 500 }}>{m.name}</td>
                      <td style={{ ...cell, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {m.path.length > 0 ? m.path.join(' › ') : '—'}
                      </td>
                      <td style={{ ...cell, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmt(m.quantity)}</td>
                      <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{m.unit}</td>
                      <td style={cell}>
                        {linked ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span>{linked.name}</span>
                            <Badge label={linked.database} variant="lca" />
                          </span>
                        ) : (
                          <span style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <AlertCircle size={12} /> not linked
                          </span>
                        )}
                      </td>
                      <td style={cell}>{linked?.location ? <Badge label={linked.location} /> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
