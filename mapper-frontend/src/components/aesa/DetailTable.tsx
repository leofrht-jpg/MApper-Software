import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { SustainabilityRatioResult } from '../../api/client'
import { ZONE_COLOR, ZONE_LABEL, fmt, fmtSR, srOrInf } from './zones'

interface Props {
  results: SustainabilityRatioResult[]
}

type SortKey = 'year' | 'pb_name' | 'sr' | 'impact' | 'allocated_sos' | 'zone' | 'principle'

export function DetailTable({ results }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('sr')
  const [sortDesc, setSortDesc] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const sorted = useMemo(() => {
    const arr = [...results]
    arr.sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0
      switch (sortKey) {
        case 'year': av = a.year; bv = b.year; break
        case 'pb_name': av = a.pb_name; bv = b.pb_name; break
        case 'sr': av = srOrInf(a.sr); bv = srOrInf(b.sr); break
        case 'impact': av = a.impact; bv = b.impact; break
        case 'allocated_sos': av = a.allocated_sos; bv = b.allocated_sos; break
        case 'zone': av = a.zone; bv = b.zone; break
        case 'principle': av = a.sharing_principle; bv = b.sharing_principle; break
      }
      if (av === bv) return 0
      const cmp = av < bv ? -1 : 1
      return sortDesc ? -cmp : cmp
    })
    return arr
  }, [results, sortKey, sortDesc])

  const rowKey = (r: SustainabilityRatioResult) => `${r.year}|${r.pb_id}`

  const toggle = (k: string) => {
    const next = new Set(expanded)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setExpanded(next)
  }

  const headers: { key: SortKey; label: string; align?: 'right' }[] = [
    { key: 'year', label: 'Year' },
    { key: 'pb_name', label: 'Boundary' },
    { key: 'principle', label: 'SP-I' },
    { key: 'impact', label: 'Impact', align: 'right' },
    { key: 'allocated_sos', label: 'Allocated SOS', align: 'right' },
    { key: 'sr', label: 'SR', align: 'right' },
    { key: 'zone', label: 'Zone' },
  ]

  return (
    <div style={{ overflow: 'auto', maxHeight: 480 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', zIndex: 1 }}>
          <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
            <th style={{ ...thStyle, width: 24 }}></th>
            {headers.map((h) => (
              <th
                key={h.key}
                onClick={() => {
                  if (sortKey === h.key) setSortDesc(!sortDesc)
                  else { setSortKey(h.key); setSortDesc(true) }
                }}
                style={{
                  ...thStyle,
                  textAlign: h.align ?? 'left',
                  cursor: 'pointer',
                  userSelect: 'none',
                  color: sortKey === h.key ? 'var(--text-primary)' : undefined,
                }}
              >
                {h.label}{sortKey === h.key ? (sortDesc ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
            <th style={{ ...thStyle, textAlign: 'left' }}>Unit</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const k = rowKey(r)
            const open = expanded.has(k)
            const cohorts = Object.entries(r.impact_by_cohort).filter(([, v]) => v)
            const total = cohorts.reduce((s, [, v]) => s + v, 0)
            return (
              <Fragment key={k}>
                <tr style={{ color: 'var(--text-primary)', borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={td}>
                    {cohorts.length > 0 && (
                      <button
                        onClick={() => toggle(k)}
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: 'var(--text-tertiary)', display: 'flex', padding: 2,
                        }}
                        aria-label="Expand cohorts"
                      >
                        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    )}
                  </td>
                  <td style={td}>{r.year}</td>
                  <td style={td}>
                    <div>{r.pb_name.replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{r.ef_indicator}</div>
                  </td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block',
                      padding: '1px 5px',
                      fontSize: 10,
                      fontWeight: 600,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }}>
                      {r.sharing_principle}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmt(r.impact)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmt(r.allocated_sos)}</td>
                  <td style={{ ...td, textAlign: 'right', color: ZONE_COLOR[r.zone], fontWeight: 700 }}>
                    {fmtSR(r.sr)}
                  </td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block',
                      padding: '1px 6px',
                      fontSize: 10,
                      fontWeight: 600,
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: `color-mix(in srgb, ${ZONE_COLOR[r.zone]} 18%, transparent)`,
                      color: ZONE_COLOR[r.zone],
                    }}>
                      {ZONE_LABEL[r.zone]}
                    </span>
                  </td>
                  <td style={{ ...td, color: 'var(--text-tertiary)' }}>{r.unit}</td>
                </tr>
                {open && cohorts.length > 0 && (
                  <tr key={`${k}-exp`} style={{ background: 'var(--bg-elevated)' }}>
                    <td colSpan={8} style={{ padding: '6px 12px 10px 40px' }}>
                      <div style={{
                        fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
                        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 4,
                      }}>
                        By fuel type / cohort
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>
                          {cohorts.map(([cohort, v]) => {
                            const pct = total > 0 ? (v / total) * 100 : 0
                            return (
                              <tr key={cohort}>
                                <td style={{ ...td, width: 140 }}>{cohort}</td>
                                <td style={{ ...td, textAlign: 'right', width: 120 }}>{fmt(v)}</td>
                                <td style={td}>
                                  <div style={{
                                    position: 'relative',
                                    height: 6,
                                    background: 'var(--border-subtle)',
                                    borderRadius: 3,
                                    overflow: 'hidden',
                                  }}>
                                    <div style={{
                                      width: `${pct}%`,
                                      height: '100%',
                                      background: ZONE_COLOR[r.zone],
                                    }} />
                                  </div>
                                </td>
                                <td style={{ ...td, textAlign: 'right', width: 60, color: 'var(--text-tertiary)' }}>
                                  {pct.toFixed(1)}%
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid var(--border-subtle)',
  fontWeight: 600,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
}

const td: React.CSSProperties = {
  padding: '6px 10px',
  verticalAlign: 'top',
}
