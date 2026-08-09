/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { Lock } from 'lucide-react'
import { buildMappingTable, type MethodCoverage, type MappingLike, type BoundaryLike } from '../../utils/aesaMethodCoverage'
import { pbLabel } from '../../utils/aesaBoundaryLabels'

interface Props {
  mappings: readonly MappingLike[]
  boundaries: Readonly<Record<string, BoundaryLike>> | null | undefined
  coverage: MethodCoverage | null
}

/**
 * Which method characterises which boundary — the mapping itself, not just a
 * count of it.
 *
 * READ-ONLY, deliberately. The mapping is derived: `suggest_method_mapping`
 * matches a boundary's `ef_indicator` against `method[1]` exactly, and
 * Re-suggest regenerates it. An editable cell here would be the most dangerous
 * control in AESA — a wrong pairing (acidification characterised against the
 * water-use method) produces a Sustainability Ratio that is simply wrong, with
 * no symptom: the number renders, the zone colours, the export writes. Nothing
 * downstream can validate it, because any method yields *a* number for any
 * boundary.
 *
 * An edit path already exists and is the better one: the AESACFG workbook
 * round-trips `method_mapping` on its Method Mapping sheet. A deliberate edit
 * there is a file — diffable, reviewable, attachable to a paper — rather than
 * an in-place click nobody can audit afterwards. So the affordance is stated
 * rather than hidden: the header carries a lock and names where to change it,
 * so nobody hunts for a control that is not there.
 *
 * Rows come from the MAPPINGS, so this table and that workbook sheet show the
 * same facts. See `buildMappingTable`.
 */
export function MethodMappingTable({ mappings, boundaries, coverage }: Props) {
  const table = buildMappingTable(mappings, boundaries, coverage)

  if (table.mapped.length === 0 && table.unrecognised.length === 0) {
    return (
      <div data-testid="aesa-mapping-table-empty" style={emptyBox}>
        No methods mapped yet. Run an impact assessment, then use
        “Re-suggest from impact methods”.
      </div>
    )
  }

  return (
    <div data-testid="aesa-mapping-table">
      <div style={readOnlyNote}>
        <Lock size={10} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Derived from the boundary set’s EF indicators — read-only here. Use
          “Re-suggest” below, or edit the Method Mapping sheet of the
          configuration workbook.
        </span>
      </div>

      <div style={scrollBox}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
              <th style={th}>Boundary</th>
              <th style={th}>Method</th>
              <th style={{ ...th, width: 52, textAlign: 'right' }}>Factor</th>
            </tr>
          </thead>
          <tbody>
            {table.mapped.map((row) => {
              const label = row.boundary ? pbLabel(row.boundary) : null
              return (
                <tr
                  key={`${row.pb_id}|${row.tuple.join('|')}`}
                  data-testid={`aesa-mapping-row-${row.pb_id}`}
                  style={{ borderTop: '1px solid var(--border-subtle)' }}
                >
                  <td style={td}>
                    {label ? (
                      <>
                        <div title={label.full} style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                          {label.lines.join(' ')}
                        </div>
                        <div style={subLabel}>
                          {row.boundary?.boundary_type ?? ''}
                          {row.duplicate && (
                            <span data-testid={`aesa-mapping-duplicate-${row.pb_id}`} style={{ color: 'var(--warning)' }}>
                              {' '}· duplicate
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      // Not in the active boundary set. It is still in the
                      // config and still in the workbook, so it is shown —
                      // dropping it is how the two views start disagreeing.
                      <>
                        <div style={{ color: 'var(--warning)', fontWeight: 500 }}>{row.pb_id}</div>
                        <div data-testid={`aesa-mapping-orphan-${row.pb_id}`} style={subLabel}>
                          not in this boundary set
                        </div>
                      </>
                    )}
                  </td>
                  {/* The full tuple: ("EF v3.1", "acidification", "accumulated
                      exceedance (AE)") — only the whole thing identifies a
                      method unambiguously, since EF reuses indicator names
                      across versions. */}
                  <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontSize: 10 }}>
                    {row.tuple.join(' · ')}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                    {row.conversion_factor === 1 ? '—' : row.conversion_factor}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {table.uncovered.length > 0 && (
        <div data-testid="aesa-mapping-uncovered" style={{ ...blockNote, color: 'var(--warning)' }}>
          <strong>No method for {table.uncovered.length} boundar
          {table.uncovered.length === 1 ? 'y' : 'ies'}:</strong>{' '}
          {table.uncovered.map((u) => pbLabel(u.boundary).lines.join(' ')).join(', ')}.
          {' '}Each is absent from every SR, radar and timeline.
        </div>
      )}

      {table.unrecognised.length > 0 && (
        <div data-testid="aesa-mapping-unrecognised" style={{ ...blockNote, color: 'var(--warning)' }}>
          <div style={{ fontWeight: 600 }}>
            {table.unrecognised.length} unrecognised method
            {table.unrecognised.length === 1 ? '' : 's'}
          </div>
          <div style={{ color: 'var(--text-tertiary)', marginBottom: 3 }}>
            Nothing in this boundary set matched these. Either the set’s
            <code> ef_indicator</code> does not match the installed method’s
            name, or the method lies outside the set.
          </div>
          {table.unrecognised.map((u) => (
            <div
              key={u.tuple.join('|')}
              data-testid={`aesa-mapping-unrecognised-row`}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
            >
              {u.tuple.join(' · ')}
            </div>
          ))}
        </div>
      )}

      {table.expectedGroups.length > 0 && (
        <div data-testid="aesa-mapping-expected" style={{ ...blockNote, color: 'var(--text-tertiary)' }}>
          <div style={{ fontWeight: 600 }}>
            {table.expectedGroups.reduce((n, g) => n + g.members.length, 0)} unmapped,
            as expected
          </div>
          <div style={{ marginBottom: 3 }}>
            EF publishes each aggregate alongside its decomposition.
            Characterising a boundary against one slice of its own aggregate
            would double-count, and two rows for one boundary collide on
            (year, pb_id) — so the sub-components are deliberately left
            unmapped.
          </div>
          {table.expectedGroups.map((g) => (
            <div key={g.parent} data-testid={`aesa-mapping-expected-group-${g.parent}`} style={{ marginTop: 3 }}>
              <div style={{ color: 'var(--text-secondary)' }}>{g.parent}</div>
              {g.members.map((m) => (
                <div
                  key={m.tuple.join('|')}
                  data-testid="aesa-mapping-expected-row"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10, paddingLeft: 10 }}
                >
                  ↳ {m.indicator}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const scrollBox: React.CSSProperties = {
  overflow: 'auto', maxHeight: 320,
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
}

const th: React.CSSProperties = {
  padding: '5px 8px', fontWeight: 600, fontSize: 10,
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
}

const td: React.CSSProperties = { padding: '5px 8px', verticalAlign: 'top' }

const subLabel: React.CSSProperties = {
  color: 'var(--text-tertiary)', fontSize: 10, marginTop: 1,
}

const readOnlyNote: React.CSSProperties = {
  display: 'flex', gap: 5, alignItems: 'flex-start',
  fontSize: 10, lineHeight: 1.45, color: 'var(--text-tertiary)',
  marginBottom: 5,
}

const blockNote: React.CSSProperties = {
  fontSize: 10, lineHeight: 1.45, marginTop: 6,
}

const emptyBox: React.CSSProperties = {
  padding: 8, fontSize: 11, color: 'var(--text-tertiary)',
  border: '1px dashed var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
}
