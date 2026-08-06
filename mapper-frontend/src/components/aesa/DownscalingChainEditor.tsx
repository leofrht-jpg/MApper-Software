/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useState } from 'react'
import { ArrowDown, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { computeChainFactor, useAESAStore } from '../../stores/aesaStore'
import { describeLayerSeries, resolveYearPair, seriesBadgeText } from '../../utils/aesaSeries'
import type { SeriesShape } from '../../utils/aesaSeries'
import { LayerEditModal } from './LayerEditModal'

interface Props {
  /** Shown in the factor preview — defaults to current year. */
  previewYear?: number
  /** Shown in the factor preview — first PB id that has an assignment. */
  previewPbId?: string
}

/** Visual editor for an N-layer downscaling chain. Each layer is a card
 *  with a ↓ connector; clicking opens LayerEditModal. A live preview of the
 *  product of all layer factors is shown at the bottom. */
export function DownscalingChainEditor({ previewYear, previewPbId }: Props) {
  const { draft, updateLayer, addLayer, removeLayer } = useAESAStore()
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const readOnly = !!draft?.sharing.built_in

  const chain = draft?.sharing.chain
  const year = previewYear ?? new Date().getFullYear()

  const pickPreviewPbId = useMemo(() => {
    if (!draft) return null
    if (previewPbId) return previewPbId
    return draft.sharing.category_assignments[0]?.pb_id ?? null
  }, [draft, previewPbId])

  const assignmentsMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of draft?.sharing.category_assignments ?? []) m[a.pb_id] = a.principle_id
    return m
  }, [draft])

  const layerFactorFor = (pbId: string | null): number[] => {
    if (!chain || !pbId) return []
    // Same resolver the store and the backend use, per-principle resolution
    // mode included. This used to be a third hand-rolled copy of the
    // nearest-year rule; a preview computed differently from Compute is a
    // preview that lies.
    return chain.layers.map((ly) => {
      const principle = ly.principle_mode === 'fixed'
        ? ly.fixed_principle
        : assignmentsMap[pbId]
      if (!principle) return 0
      const pair = resolveYearPair(
        ly.data?.[principle], year, ly.resolution?.[principle] ?? 'step',
      )
      if (!pair) return 0
      const [sys, glob] = pair
      return glob > 0 ? sys / glob : 0
    })
  }

  const perLayerFactors = layerFactorFor(pickPreviewPbId)
  const totalFactor = pickPreviewPbId
    ? computeChainFactor(draft?.sharing ?? null, pickPreviewPbId, year)
    : 0

  if (!draft || !chain) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {chain.layers.map((layer, i) => {
        const factor = perLayerFactors[i] ?? 0
        return (
          <div key={`${layer.layer_number}-${i}`}>
            <LayerCard
              index={i}
              name={layer.name}
              mode={layer.principle_mode}
              fixedPrinciple={layer.fixed_principle ?? null}
              description={layer.description ?? ''}
              series={describeLayerSeries(layer.data, layer.resolution)}
              factor={factor}
              readOnly={readOnly}
              canDelete={chain.layers.length > 1}
              onEdit={() => setEditingIndex(i)}
              onDelete={() => removeLayer(i)}
            />
            {i < chain.layers.length - 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
                <ArrowDown size={14} color="var(--text-tertiary)" />
              </div>
            )}
          </div>
        )
      })}

      {/* Add layer */}
      <button
        onClick={() => addLayer()}
        disabled={readOnly}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          padding: '6px 10px', fontSize: 11,
          color: 'var(--text-secondary)',
          background: 'transparent',
          border: '1px dashed var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          cursor: readOnly ? 'not-allowed' : 'pointer',
          opacity: readOnly ? 0.5 : 1,
        }}
      >
        <Plus size={12} /> Add layer
      </button>

      {/* Factor preview */}
      <div style={preview}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        }}>
          <span style={{
            fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
          }}>
            Total factor
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {pickPreviewPbId ? `${pickPreviewPbId} · ${year}` : 'no assignment'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
          <span style={{
            fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)',
          }}>
            {(totalFactor * 100).toPrecision(4)}%
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            = {perLayerFactors.map((f) => (f * 100).toPrecision(3) + '%').join(' × ') || '—'}
          </span>
        </div>
      </div>

      {editingIndex !== null && chain.layers[editingIndex] && (
        <LayerEditModal
          layer={chain.layers[editingIndex]}
          principles={draft.sharing.principles}
          readOnly={readOnly}
          onClose={() => setEditingIndex(null)}
          onSave={(patch) => updateLayer(editingIndex, patch)}
        />
      )}
    </div>
  )
}

function LayerCard({
  index, name, mode, fixedPrinciple, description, series, factor,
  readOnly, canDelete, onEdit, onDelete,
}: {
  index: number
  name: string
  mode: 'category_specific' | 'fixed'
  fixedPrinciple: string | null
  description: string
  series: SeriesShape[]
  factor: number
  readOnly: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const modeBadge = mode === 'fixed'
    ? `Fixed · ${fixedPrinciple ?? '—'}`
    : 'Category-specific'

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={badge}>{index + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</span>
            {readOnly && <Lock size={10} color="var(--text-tertiary)" />}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {modeBadge}
          </div>
          {description && (
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
              {description}
            </div>
          )}
          {/* Per-principle temporal shape. A chain mixing a moving EpC with a
              frozen AR is a legitimate methodological choice and a silent
              error when unintended — so it is SHOWN, never warned about.
              Series badges carry the module accent; constants stay muted, so
              "which of these actually moves" reads at a glance. */}
          {series.length > 0 && (
            <div
              data-testid={`layer-series-badges-${index}`}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}
            >
              {series.map((s) => (
                <span
                  key={s.principleId}
                  data-testid={`layer-${index}-series-${s.principleId}`}
                  title={s.isSeries
                    ? `${s.principleId}: ${s.points} values from ${s.firstYear} to ${s.lastYear}. `
                      + (s.mode === 'interpolate'
                        ? 'Years in between are interpolated linearly.'
                        : 'Each value holds until the next year supplied (step).')
                      + ' Clamped outside the range.'
                    : `${s.principleId}: one value at ${s.firstYear}, constant across all years.`}
                  style={s.isSeries ? seriesBadge : constantBadge}
                >
                  <strong style={{ fontWeight: 600 }}>{s.principleId}</strong>
                  {' · '}{seriesBadgeText(s)}
                </span>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
            factor = {(factor * 100).toPrecision(4)}%
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={onEdit} style={iconBtn} title={readOnly ? 'View layer (read-only)' : 'Edit layer'}>
            <Pencil size={12} />
          </button>
          {!readOnly && canDelete && (
            <button
              onClick={() => { if (confirm(`Delete "${name}"?`)) onDelete() }}
              style={{ ...iconBtn, color: 'var(--danger)' }}
              title="Delete layer"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const card: React.CSSProperties = {
  padding: 10,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
}

const badge: React.CSSProperties = {
  flexShrink: 0,
  width: 22, height: 22,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 11, fontWeight: 700,
  color: 'var(--mod-aesa)',
  background: 'color-mix(in srgb, var(--mod-aesa) 14%, transparent)',
  border: '1px solid color-mix(in srgb, var(--mod-aesa) 40%, transparent)',
  borderRadius: '50%',
}

const preview: React.CSSProperties = {
  padding: '8px 10px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  marginTop: 4,
}

const badgeBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '1px 6px',
  fontSize: 9.5,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid transparent',
  whiteSpace: 'nowrap',
}

// Accented: this principle's share MOVES over the assessment horizon.
const seriesBadge: React.CSSProperties = {
  ...badgeBase,
  color: 'var(--mod-aesa)',
  background: 'color-mix(in srgb, var(--mod-aesa) 12%, transparent)',
  borderColor: 'color-mix(in srgb, var(--mod-aesa) 35%, transparent)',
}

// Muted: one value, constant across all years. The resolution mode is
// deliberately omitted here — with a single point it changes nothing.
const constantBadge: React.CSSProperties = {
  ...badgeBase,
  color: 'var(--text-tertiary)',
  background: 'var(--bg-surface)',
  borderColor: 'var(--border-subtle)',
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 22,
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  cursor: 'pointer', padding: 0,
}
