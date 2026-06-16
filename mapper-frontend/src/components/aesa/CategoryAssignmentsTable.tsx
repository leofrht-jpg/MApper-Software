import { useMemo } from 'react'
import { useAESAStore } from '../../stores/aesaStore'
import type { BoundarySet, PlanetaryBoundary } from '../../api/client'

interface Props {
  boundarySet: BoundarySet
}

/** Per-PB principle assignment table. Only relevant when the chain has at
 *  least one ``category_specific`` layer — otherwise returns a hint. */
export function CategoryAssignmentsTable({ boundarySet }: Props) {
  const { draft, updateAssignment } = useAESAStore()

  const hasCategoryLayer = useMemo(
    () => !!draft?.sharing.chain.layers.some((ly) => ly.principle_mode === 'category_specific'),
    [draft],
  )

  if (!draft) return null

  const principles = draft.sharing.principles
  const assignments = new Map(draft.sharing.category_assignments.map((a) => [a.pb_id, a]))
  const readOnly = draft.sharing.built_in

  if (!hasCategoryLayer) {
    return (
      <div style={{
        padding: 8, fontSize: 11, color: 'var(--text-tertiary)',
        border: '1px dashed var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
      }}>
        No category-specific layers in the chain — all categories use the fixed principles above.
      </div>
    )
  }

  if (principles.length === 0) {
    return (
      <div style={{
        padding: 8, fontSize: 11, color: 'var(--warning)',
        border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
        background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
        borderRadius: 'var(--radius-sm)',
      }}>
        No principles defined. Add at least one principle first.
      </div>
    )
  }

  return (
    <div style={{ overflow: 'auto', maxHeight: 320, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
            <th style={th}>Boundary</th>
            <th style={{ ...th, width: 100 }}>Principle</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(boundarySet.boundaries).map(([pbId, pb]) => {
            const current = assignments.get(pbId)?.principle_id ?? principles[0]?.id ?? ''
            return (
              <tr key={pbId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={td}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {formatPbName(pb)}
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 10, marginTop: 1 }}>
                    {pb.boundary_type}
                  </div>
                </td>
                <td style={td}>
                  <select
                    value={current}
                    onChange={(e) => updateAssignment(pbId, e.target.value)}
                    disabled={readOnly}
                    style={select}
                  >
                    {principles.map((p) => (
                      <option key={p.id} value={p.id}>{p.id}</option>
                    ))}
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function formatPbName(pb: PlanetaryBoundary): string {
  return pb.name.replace(/_/g, ' ')
}

const th: React.CSSProperties = {
  padding: '5px 8px', fontWeight: 600, fontSize: 10,
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
}

const td: React.CSSProperties = {
  padding: '5px 8px', verticalAlign: 'middle',
}

const select: React.CSSProperties = {
  width: '100%', height: 24,
  padding: '2px 4px', fontSize: 11,
  color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none', fontFamily: 'inherit',
}
