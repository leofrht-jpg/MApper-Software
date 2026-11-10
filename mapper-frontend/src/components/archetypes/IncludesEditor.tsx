/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useMemo, useState } from 'react'
import { AlertCircle, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { InfoButton } from '../ui/InfoButton'
import { NumberInput } from '../ui/NumberInput'
import { IDENTIFIER_INPUT_PROPS } from '../ui/identifierInput'
import { isExpressionInput, resolveExpression } from '../../utils/quantityExpression'
import { useParameterStore } from '../../stores/parameterStore'
import type { ArchetypeInclude, ArchetypeSummary } from '../../api/client'

interface Props {
  /** The archetype being edited. Its own id is never offered by the picker. */
  archetypeId: string
  includes: ArchetypeInclude[]
  /** Every archetype of the project, any folder. */
  archetypes: ArchetypeSummary[]
  /** Saves the WHOLE list. A rejection is shown by the page's error line. */
  onSave: (includes: ArchetypeInclude[]) => Promise<void>
}

const HELP =
  'The quantity multiplies the included archetype as it is defined, so a 1 kg battery archetype with quantity 450 gives 450 kg. ' +
  'Its stages appear in results with the prefix Child::Stage.'

const folderLabel = (a: ArchetypeSummary) => a.folder || 'root'

/**
 * Archetype composition: one row per archetype this one includes, with a quantity
 * (a number, or a parameter expression resolved in THIS archetype's parameter
 * context) and a picker over the other archetypes of the project, any folder.
 *
 * Every change sends the whole list through the archetype update, so an edit is
 * never a partial write. The backend refuses a cycle, a depth over 4, a missing
 * archetype and the same archetype twice; its message is shown by the page.
 */
export function IncludesEditor({ archetypeId, includes, archetypes, onSave }: Props) {
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const byId = useMemo(() => new Map(archetypes.map((a) => [a.id, a])), [archetypes])
  const includedIds = useMemo(() => new Set(includes.map((i) => i.archetype_id)), [includes])

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return archetypes
      .filter((a) => a.id !== archetypeId && !includedIds.has(a.id))
      .filter((a) => !needle || a.name.toLowerCase().includes(needle) || (a.folder ?? '').toLowerCase().includes(needle))
      .sort((x, y) => (x.folder ?? '').localeCompare(y.folder ?? '') || x.name.localeCompare(y.name))
  }, [archetypes, archetypeId, includedIds, search])

  const save = async (next: ArchetypeInclude[]) => {
    setBusy(true)
    try {
      await onSave(next)
    } catch {
      // The page shows the backend message in its error line; nothing to add here.
    } finally {
      setBusy(false)
    }
  }

  const add = async (a: ArchetypeSummary) => {
    setPicking(false)
    setSearch('')
    await save([...includes, { archetype_id: a.id, quantity: 1, quantity_expression: null }])
  }

  return (
    <div data-testid="includes-editor" style={{ padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Includes
        </span>
        <InfoButton label="About includes" data-testid="includes-info">{HELP}</InfoButton>
        <Button
          variant="secondary"
          size="sm"
          data-testid="include-add"
          disabled={busy}
          onClick={() => setPicking((v) => !v)}
          style={{ marginLeft: 'auto' }}
        >
          <Plus size={13} /> Add include
        </Button>
      </div>

      {picking && (
        <div data-testid="include-picker" style={{ marginTop: 8, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 8 }}>
          <input
            {...IDENTIFIER_INPUT_PROPS}
            data-testid="include-search"
            aria-label="Search archetypes"
            placeholder="Search by name or folder"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', fontSize: 'var(--text-sm)' }}
          />
          <div style={{ maxHeight: 180, overflow: 'auto', marginTop: 6 }}>
            {candidates.length === 0 && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', padding: 4 }}>
                No archetype to include.
              </div>
            )}
            {candidates.map((a) => (
              <Button
                key={a.id}
                variant="ghost"
                size="sm"
                data-testid={`include-candidate-${a.id}`}
                onClick={() => add(a)}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left' }}
              >
                <span>{a.name}</span>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>{folderLabel(a)}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {includes.map((inc, i) => (
        <IncludeRow
          key={`${inc.archetype_id}:${i}`}
          index={i}
          inc={inc}
          target={byId.get(inc.archetype_id)}
          // Until the list is loaded nothing can be called missing.
          dangling={byId.size > 0 && !byId.has(inc.archetype_id)}
          busy={busy}
          onChange={(next) => save(includes.map((x, j) => (j === i ? next : x)))}
          onRemove={() => save(includes.filter((_, j) => j !== i))}
        />
      ))}
    </div>
  )
}

interface RowProps {
  index: number
  inc: ArchetypeInclude
  target: ArchetypeSummary | undefined
  dangling: boolean
  busy: boolean
  onChange: (next: ArchetypeInclude) => void
  onRemove: () => void
}

function IncludeRow({ index, inc, target, dangling, busy, onChange, onRemove }: RowProps) {
  const [qty, setQty] = useState(inc.quantity)
  const [expr, setExpr] = useState(inc.quantity_expression ?? '')
  const [error, setError] = useState<string | null>(null)

  const activeSet = useParameterStore((s) => s.activeSet)
  const paramMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of activeSet?.parameters ?? []) if (p.value != null) m.set(p.name, p.value)
    return m
  }, [activeSet])

  const trimmed = expr.trim()
  const resolved = useMemo(
    () => (trimmed && isExpressionInput(trimmed) ? resolveExpression(trimmed, paramMap) : null),
    [trimmed, paramMap],
  )

  const commit = () => {
    if (trimmed) {
      if (!isExpressionInput(trimmed)) { setError('The expression must start with a parameter name.'); return }
      if (resolved?.error) { setError(`Expression: ${resolved.error}`); return }
      const value = resolved?.value ?? inc.quantity
      if (!(value > 0)) { setError('The quantity must be above 0.'); return }
      setError(null)
      if (trimmed !== (inc.quantity_expression ?? '') || value !== inc.quantity) {
        // As for a BOM row: the resolved value rides along as the last-known quantity.
        onChange({ archetype_id: inc.archetype_id, quantity: value, quantity_expression: trimmed })
      }
      return
    }
    if (!(qty > 0)) { setError('The quantity must be above 0.'); return }
    setError(null)
    if (qty !== inc.quantity || inc.quantity_expression) {
      onChange({ archetype_id: inc.archetype_id, quantity: qty, quantity_expression: null })
    }
  }

  const name = target ? target.name : 'Missing archetype'
  return (
    <div data-testid={`include-row-${index}`} style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          data-testid={`include-name-${index}`}
          title={target ? `${folderLabel(target)} / ${target.name}` : inc.archetype_id}
          style={{ fontSize: 'var(--text-sm)', color: dangling ? 'var(--warning)' : 'var(--text-primary)', minWidth: 140 }}
        >
          {name}
          {target && <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}> {folderLabel(target)}</span>}
        </span>
        <NumberInput
          {...IDENTIFIER_INPUT_PROPS}
          data-testid={`include-qty-${index}`}
          aria-label={`Quantity of ${name}`}
          value={resolved && !resolved.error && resolved.value != null ? resolved.value : qty}
          onChange={setQty}
          onBlur={commit}
          disabled={busy || !!trimmed}
          min={0}
          emptyValue={inc.quantity}
          style={{ width: 90, fontSize: 'var(--text-sm)' }}
        />
        <input
          {...IDENTIFIER_INPUT_PROPS}
          data-testid={`include-expr-${index}`}
          aria-label={`Quantity expression for ${name}`}
          placeholder="Expression (optional)"
          value={expr}
          disabled={busy}
          onChange={(e) => { setExpr(e.target.value); setError(null) }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
          style={{ width: 180, fontSize: 'var(--text-sm)' }}
        />
        <Button
          variant="danger"
          size="sm"
          data-testid={`include-remove-${index}`}
          aria-label={`Remove ${name}`}
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2 size={13} /> Remove
        </Button>
      </div>
      {dangling && (
        <div data-testid={`include-dangling-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
          <AlertCircle size={12} /> This archetype no longer exists. Remove this include.
        </div>
      )}
      {error && (
        <div role="alert" data-testid={`include-error-${index}`} style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
