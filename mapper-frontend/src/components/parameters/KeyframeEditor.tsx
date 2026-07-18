/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import type { Parameter } from '../../api/client'
import {
  HORIZON_END, HORIZON_START, lrFactor, sortRowsByYear, trajectorySeries,
  validateKeyframeRows, type KeyframeRow, type LeverReferenceMaterial,
} from '../../utils/keyframes'

interface Row extends KeyframeRow {
  id: string
}

let _uid = 0
const uid = () => `kf-${++_uid}`

function initRows(param: Parameter): Row[] {
  if (param.keyframes && param.keyframes.length > 0) {
    return param.keyframes.map((k) => ({ id: uid(), year: String(k.year), value: String(k.value) }))
  }
  return []
}

function defaultRows(param: Parameter): Row[] {
  const v = Number.isFinite(param.base_value) ? param.base_value : 1
  return [
    { id: uid(), year: String(HORIZON_START), value: String(v) },
    { id: uid(), year: String(HORIZON_END), value: String(v) },
  ]
}

interface KeyframeEditorProps {
  param: Parameter
  onPatch: (patch: Partial<Parameter>) => void
  /** Candidate reference materials for the p_bp composed-rate preview. */
  taggedMaterials?: LeverReferenceMaterial[]
}

export function KeyframeEditor({ param, onPatch, taggedMaterials = [] }: KeyframeEditorProps) {
  const isPbp = param.name === 'p_bp'

  const [timeVarying, setTimeVarying] = useState<boolean>(() => !!(param.keyframes && param.keyframes.length))
  const [rows, setRows] = useState<Row[]>(() => initRows(param))
  const [showDisableWarn, setShowDisableWarn] = useState(false)
  const [refIdx, setRefIdx] = useState(0)

  // Re-sync from the param ONLY when its committed keyframes change externally
  // (e.g. reload / another edit path) — never clobber in-progress local edits.
  const lastKf = useRef<string>(JSON.stringify(param.keyframes ?? null))
  useEffect(() => {
    const key = JSON.stringify(param.keyframes ?? null)
    if (key !== lastKf.current) {
      lastKf.current = key
      setRows(initRows(param))
      setTimeVarying(!!(param.keyframes && param.keyframes.length))
    }
  }, [param])

  // Display is always sorted by year (re-sorts live on edit).
  const display = useMemo(() => sortRowsByYear(rows), [rows])
  const validation = useMemo(() => validateKeyframeRows(display), [display])

  // Live preview keyframes — every row parseable to (year, value).
  const previewKeyframes = useMemo(
    () => display
      .map((r) => ({ year: Number(r.year), value: Number(r.value) }))
      .filter((k) => r_finite(k.year) && r_finite(k.value)),
    [display],
  )
  const anchorYears = useMemo(() => new Set(previewKeyframes.map((k) => k.year)), [previewKeyframes])

  const refMat = isPbp ? taggedMaterials[Math.min(refIdx, Math.max(0, taggedMaterials.length - 1))] : undefined

  const chartData = useMemo(() => {
    if (previewKeyframes.length === 0) return []
    const series = trajectorySeries(previewKeyframes)
    return series.map((pt) => {
      const row: { year: number; value: number; effective?: number } = { year: pt.year, value: pt.value }
      if (isPbp && refMat) row.effective = pt.value * lrFactor(refMat.learningRate, refMat.baseYear, pt.year)
      return row
    })
  }, [previewKeyframes, isPbp, refMat])

  // ── Row ops ────────────────────────────────────────────────────────────────
  const addRow = () => setRows((rs) => [...rs, { id: uid(), year: '', value: '' }])
  const deleteRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id))
  const editRow = (id: string, field: 'year' | 'value', val: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: val } : r)))

  const handleApply = () => {
    if (!validation.valid) return
    const kf = sortRowsByYear(rows).map((r) => ({ year: Number(r.year), value: Number(r.value) }))
    onPatch({ keyframes: kf })
  }

  const handleToggle = (next: boolean) => {
    if (next) {
      setTimeVarying(true)
      setRows((rs) => (rs.length >= 2 ? rs : defaultRows(param)))
    } else if (param.keyframes && param.keyframes.length) {
      // Committed keyframes exist → confirm the destructive revert.
      setShowDisableWarn(true)
    } else {
      setTimeVarying(false)
      onPatch({ keyframes: null })
    }
  }

  const confirmDisable = () => {
    setShowDisableWarn(false)
    setTimeVarying(false)
    setRows([])
    onPatch({ keyframes: null })
  }

  return (
    <div
      data-testid="keyframe-editor"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        backgroundColor: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* Time-varying toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--text-xs)' }}>
        <input
          type="checkbox"
          data-testid="keyframe-timevarying-toggle"
          checked={timeVarying}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Time-varying</span>
        <span style={{ color: 'var(--text-tertiary)' }}>
          — {param.name} varies by year ({HORIZON_START}–{HORIZON_END}) via keyframes.
        </span>
      </label>

      {/* Body — visibility-toggle (kept mounted) */}
      <div
        data-testid="keyframe-body"
        style={{
          display: timeVarying ? 'grid' : 'none',
          gridTemplateColumns: 'minmax(220px, 340px) 1fr',
          gap: 'var(--space-4)',
          marginTop: 'var(--space-3)',
          alignItems: 'start',
        }}
      >
        {/* Keyframe table */}
        <div data-testid="keyframe-table">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 28px', gap: 6, marginBottom: 4 }}>
            <div style={hdr}>Year</div>
            <div style={hdr}>Value{param.unit ? ` (${param.unit})` : ''}</div>
            <div />
          </div>
          {display.map((r) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 28px', gap: 6, marginBottom: 4, alignItems: 'center' }}>
              <input
                data-testid={`keyframe-year-${r.id}`}
                value={r.year}
                inputMode="numeric"
                placeholder="2025"
                onChange={(e) => editRow(r.id, 'year', e.target.value)}
                style={{ ...inputSty, borderColor: rowErr(validation, display, r.id) ? 'var(--danger)' : 'var(--border-default)' }}
              />
              <input
                data-testid={`keyframe-value-${r.id}`}
                value={r.value}
                inputMode="decimal"
                placeholder="1.0"
                onChange={(e) => editRow(r.id, 'value', e.target.value)}
                style={{ ...inputSty, borderColor: rowErr(validation, display, r.id) ? 'var(--danger)' : 'var(--border-default)' }}
              />
              <button
                data-testid={`keyframe-delete-${r.id}`}
                onClick={() => deleteRow(r.id)}
                title="Delete keyframe"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <Button variant="ghost" size="sm" onClick={addRow} data-testid="keyframe-add-row">
              <Plus size={12} /> Add keyframe
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleApply}
              disabled={!validation.valid}
              data-testid="keyframe-apply"
            >
              Save keyframes
            </Button>
          </div>
          {(validation.errors.length > 0 || Object.keys(validation.rowErrors).length > 0) && (
            <div data-testid="keyframe-errors" style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
              {validation.errors.map((e, i) => <div key={`g${i}`}>• {e}</div>)}
              {Object.values(validation.rowErrors).filter((v, i, a) => a.indexOf(v) === i).map((e, i) => <div key={`r${i}`}>• {e}</div>)}
            </div>
          )}
        </div>

        {/* Trajectory preview */}
        <div>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
            Trajectory preview
          </div>
          <div data-testid="keyframe-trajectory-preview" style={{ width: '100%', height: 160 }}>
            <span data-testid="keyframe-trajectory-points" hidden>{chartData.length}</span>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="year" tick={{ fontSize: 10 }} type="number" domain={[HORIZON_START, HORIZON_END]} allowDecimals={false} />
                <YAxis tick={{ fontSize: 10 }} width={44} />
                <Tooltip />
                <Line
                  type="monotone" dataKey="value" name={param.name}
                  stroke="var(--mod-lca)" strokeWidth={2} isAnimationActive={false}
                  dot={(props: { cx?: number; cy?: number; payload?: { year: number } }) =>
                    props.payload && anchorYears.has(props.payload.year) && props.cx != null && props.cy != null ? (
                      <circle key={props.payload.year} cx={props.cx} cy={props.cy} r={3} fill="var(--mod-lca)" />
                    ) : <g key={props.payload?.year} />
                  }
                />
                {isPbp && refMat && (
                  <Line
                    type="monotone" dataKey="effective" name="effective rate"
                    stroke="var(--mod-plca)" strokeWidth={2} strokeDasharray="5 3"
                    isAnimationActive={false} dot={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* p_bp composed-rate preview */}
          {isPbp && (
            <div data-testid="pbp-composed-rate" style={{ marginTop: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Composed rate preview
              </div>
              {taggedMaterials.length === 0 ? (
                <div data-testid="pbp-no-tagged" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
                  Tag a BOM node with <code>global_levers: ['p_bp']</code> to preview the composed rate.
                </div>
              ) : (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                  <div style={{ marginBottom: 4 }}>
                    effective_rate(year) = p_bp(year) × (1 + learning_rate)^(year − base_year)
                  </div>
                  {taggedMaterials.length > 1 && (
                    <select
                      data-testid="pbp-ref-select"
                      value={refIdx}
                      onChange={(e) => setRefIdx(Number(e.target.value))}
                      style={inputSty}
                    >
                      {taggedMaterials.map((m, i) => (
                        <option key={`${m.archetypeName}-${m.nodeName}-${i}`} value={i}>
                          {m.archetypeName} · {m.nodeName}
                        </option>
                      ))}
                    </select>
                  )}
                  {refMat && (
                    <div style={{ marginTop: 4, color: 'var(--text-tertiary)' }}>
                      Reference: <strong>{refMat.archetypeName} · {refMat.nodeName}</strong>{' '}
                      (LR {refMat.learningRate}, base {refMat.baseYear})
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Disable-time-varying confirmation (inline, WKWebView-safe) */}
      {showDisableWarn && (
        <div
          data-testid="keyframe-disable-warning"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            backgroundColor: 'color-mix(in srgb, black 55%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
          }}
          onClick={() => setShowDisableWarn(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', maxWidth: 420,
              display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
            }}
          >
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
              Disable time-varying?
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Disabling time-varying will <strong>remove your keyframes</strong> for{' '}
              <strong>{param.name}</strong> and revert to the scalar base value. Continue?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setShowDisableWarn(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={confirmDisable}
                data-testid="keyframe-disable-confirm"
                style={{ backgroundColor: 'var(--danger)' }}
              >
                Remove keyframes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Finite check kept as a tiny helper so the memo filter reads cleanly above.
function r_finite(n: number): boolean {
  return Number.isFinite(n)
}

function rowErr(
  validation: ReturnType<typeof validateKeyframeRows>,
  display: Row[],
  id: string,
): boolean {
  const idx = display.findIndex((r) => r.id === id)
  return idx >= 0 && validation.rowErrors[idx] !== undefined
}

const hdr: React.CSSProperties = {
  fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
}

const inputSty: React.CSSProperties = {
  height: 26, padding: '0 6px', width: '100%',
  backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', outline: 'none',
}
