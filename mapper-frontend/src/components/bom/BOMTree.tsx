import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, Circle, Plus, Trash2, Link as LinkIcon, Pencil, TrendingDown, TrendingUp, Minus, RotateCcw, AlertCircle } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { NumberInput } from '../ui/NumberInput'
import { EcoinventLinker } from './EcoinventLinker'
import type { BOMNode, EcoinventLink, MaterialEvolution, QuantityMilestone } from '../../api/client'
import { useParameterStore } from '../../stores/parameterStore'

// An amount that starts with a letter or underscore (snake_case) is treated as
// an expression, else as a plain number.
function isExpressionInput(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  return /^[a-z_]/.test(t)
}

// Client-side expression resolver — mirrors backend ParameterEngine for the
// common subset (identifiers, + - * / ** unary-minus, parentheses, numeric
// literals, and the reserved functions min/max/abs/round/sum). Anything outside
// this subset surfaces as an error rather than silently passing.
const RESERVED_FNS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  round: (x: number, digits = 0) => {
    const f = Math.pow(10, digits)
    return Math.round(x * f) / f
  },
  sum: (...xs: number[]) => xs.reduce((a, b) => a + b, 0),
}

function resolveExpression(expr: string, params: Map<string, number>): { value: number | null; error: string | null } {
  const src = expr.trim()
  if (!src) return { value: null, error: 'empty' }
  try {
    // Fast path: plain number.
    if (/^-?\d+(\.\d+)?$/.test(src)) return { value: Number(src), error: null }
    // Replace identifiers with their values or function calls. Tokenize simply.
    // Supports: name, number, + - * / ** ( ) , whitespace.
    const tokens = tokenize(src)
    let pos = 0
    const peek = () => tokens[pos]
    const eat = (t?: string) => {
      const tok = tokens[pos]
      if (t != null && tok !== t) throw new Error(`Expected '${t}'`)
      pos++
      return tok
    }
    // Recursive descent: expr → term (('+'|'-') term)*
    //   term → factor (('*'|'/') factor)*
    //   factor → unary ('**' factor)?
    //   unary → '-' unary | primary
    //   primary → number | name | name '(' args ')' | '(' expr ')'
    const parseExpr = (): number => {
      let v = parseTerm()
      while (peek() === '+' || peek() === '-') {
        const op = eat()
        const r = parseTerm()
        v = op === '+' ? v + r : v - r
      }
      return v
    }
    const parseTerm = (): number => {
      let v = parseFactor()
      while (peek() === '*' || peek() === '/') {
        const op = eat()
        const r = parseFactor()
        if (op === '/') {
          if (r === 0) throw new Error('Division by zero')
          v = v / r
        } else {
          v = v * r
        }
      }
      return v
    }
    const parseFactor = (): number => {
      const v = parseUnary()
      if (peek() === '**') { eat(); return Math.pow(v, parseFactor()) }
      return v
    }
    const parseUnary = (): number => {
      if (peek() === '-') { eat(); return -parseUnary() }
      if (peek() === '+') { eat(); return parseUnary() }
      return parsePrimary()
    }
    const parsePrimary = (): number => {
      const tok = peek()
      if (tok == null) throw new Error('Unexpected end of expression')
      if (tok === '(') {
        eat('(')
        const v = parseExpr()
        eat(')')
        return v
      }
      if (/^-?\d+(\.\d+)?$/.test(tok)) { eat(); return Number(tok) }
      if (/^[a-z_][a-z0-9_]*$/.test(tok)) {
        eat()
        if (peek() === '(') {
          eat('(')
          const args: number[] = []
          if (peek() !== ')') {
            args.push(parseExpr())
            while (peek() === ',') { eat(','); args.push(parseExpr()) }
          }
          eat(')')
          const fn = RESERVED_FNS[tok]
          if (!fn) throw new Error(`Unknown function '${tok}'`)
          return fn(...args)
        }
        if (!params.has(tok)) throw new Error(`Undefined parameter: '${tok}'`)
        return params.get(tok)!
      }
      throw new Error(`Unexpected token '${tok}'`)
    }
    const v = parseExpr()
    if (pos < tokens.length) throw new Error(`Unexpected token '${tokens[pos]}'`)
    if (!Number.isFinite(v)) throw new Error('Non-finite result')
    return { value: v, error: null }
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) }
  }
}

function tokenize(src: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t') { i++; continue }
    if (c === '*' && src[i + 1] === '*') { out.push('**'); i += 2; continue }
    if ('+-*/(),'.includes(c)) { out.push(c); i++; continue }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      out.push(src.slice(i, j))
      i = j
      continue
    }
    if (/[a-z_]/.test(c)) {
      let j = i
      while (j < src.length && /[a-z0-9_]/.test(src[j])) j++
      out.push(src.slice(i, j))
      i = j
      continue
    }
    throw new Error(`Unexpected character '${c}'`)
  }
  return out
}

// Pull the last identifier-like token from a partially typed expression, so we
// can show autocomplete suggestions that prefix-match it.
function extractCurrentToken(s: string): string {
  const m = s.match(/[a-z_][a-z0-9_]*$/)
  return m ? m[0] : ''
}

const UNIT_OPTIONS = ['kg', 'g', 't', 'piece', 'm', 'm2', 'm3', 'l', 'kWh', 'MJ']

interface BOMTreeProps {
  node: BOMNode
  depth?: number
  isRoot?: boolean
  onPatch: (nodeId: string, patch: { name?: string; quantity?: number; quantity_expression?: string | null; unit?: string; is_annual?: boolean; scope?: 'inflows' | 'stock' | 'outflows' | null; ecoinvent_activity?: EcoinventLink | null; evolution?: MaterialEvolution | null }) => Promise<void>
  onAddChild: (parentId: string, child: BOMNode) => Promise<void>
  onDelete: (nodeId: string) => Promise<void>
}

function projectLR(base: number, rate: number, baseYear: number, year: number): number {
  return base * Math.pow(1 + rate, year - baseYear)
}

function evolutionSummary(ev: MaterialEvolution | null | undefined): string {
  if (!ev || ev.method === 'fixed') return 'Fixed'
  if (ev.method === 'learning_rate') {
    const r = ev.learning_rate ?? 0
    return `${(r * 100).toFixed(1)}%/yr LR (from ${ev.base_year})`
  }
  if (ev.method === 'rebound_effect') {
    const r = ev.rebound_rate ?? 0
    const sign = r >= 0 ? '+' : ''
    return `${sign}${(r * 100).toFixed(1)}%/yr rebound (from ${ev.base_year})`
  }
  if (ev.method === 'milestones' && ev.milestones && ev.milestones.length > 0) {
    const ms = [...ev.milestones].sort((a, b) => a.year - b.year)
    return `${ms.length} milestones (${ms[0].year}→${ms[ms.length - 1].year})`
  }
  return 'Evolving'
}

export function BOMTree({ node, depth = 0, isRoot = false, onPatch, onAddChild, onDelete }: BOMTreeProps) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const initialAmount = node.quantity_expression ?? String(node.quantity)
  const [draft, setDraft] = useState({
    name: node.name,
    amount: initialAmount,
    unit: node.unit,
  })
  const [linkerOpen, setLinkerOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [evolutionOpen, setEvolutionOpen] = useState(false)
  const [showAutocomplete, setShowAutocomplete] = useState(false)

  // Active parameter set — used to resolve expressions for preview + autocomplete.
  const activeSet = useParameterStore((s) => s.activeSet)
  const paramMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of activeSet?.parameters ?? []) if (p.value != null) m.set(p.name, p.value)
    return m
  }, [activeSet])
  const paramNames = useMemo(() => Array.from(paramMap.keys()).sort(), [paramMap])

  const isComponent = node.node_type === 'component'
  const hasChildren = (node.children?.length ?? 0) > 0
  const linked = node.ecoinvent_activity
  const nodeId = node.id ?? ''
  const hasExpression = !!node.quantity_expression

  // Resolve the node's saved expression (for display) against active params.
  const expressionResolve = useMemo(() => {
    if (!node.quantity_expression) return null
    return resolveExpression(node.quantity_expression, paramMap)
  }, [node.quantity_expression, paramMap])

  // Resolve the in-progress draft (for live preview while editing).
  const draftResolve = useMemo(() => {
    if (!editing) return null
    if (!isExpressionInput(draft.amount)) return null
    return resolveExpression(draft.amount, paramMap)
  }, [editing, draft.amount, paramMap])

  // Autocomplete suggestions — prefix match on current token.
  const autocompleteMatches = useMemo(() => {
    if (!editing || !showAutocomplete) return []
    const token = extractCurrentToken(draft.amount)
    if (!token) return []
    return paramNames.filter((n) => n.startsWith(token) && n !== token).slice(0, 6)
  }, [editing, showAutocomplete, draft.amount, paramNames])

  const beginEdit = () => {
    setDraft({
      name: node.name,
      amount: node.quantity_expression ?? String(node.quantity),
      unit: node.unit,
    })
    setEditing(true)
    setShowAutocomplete(false)
  }

  const applyAutocomplete = (name: string) => {
    const token = extractCurrentToken(draft.amount)
    if (!token) return
    const idx = draft.amount.lastIndexOf(token)
    const next = draft.amount.slice(0, idx) + name + draft.amount.slice(idx + token.length)
    setDraft({ ...draft, amount: next })
    setShowAutocomplete(false)
  }

  const saveEdit = async () => {
    const patch: { name?: string; quantity?: number; quantity_expression?: string | null; unit?: string } = {}
    if (draft.name !== node.name) patch.name = draft.name
    if (draft.unit !== node.unit) patch.unit = draft.unit

    const trimmed = draft.amount.trim()
    if (isExpressionInput(trimmed)) {
      const res = resolveExpression(trimmed, paramMap)
      if (res.error) {
        alert(`Expression error: ${res.error}`)
        return
      }
      if (trimmed !== (node.quantity_expression ?? '')) patch.quantity_expression = trimmed
      if (res.value != null && res.value !== node.quantity) patch.quantity = res.value
    } else {
      const num = Number(trimmed)
      if (!Number.isFinite(num)) {
        alert('Quantity must be a number or a parameter expression.')
        return
      }
      if (node.quantity_expression) patch.quantity_expression = null
      if (num !== node.quantity) patch.quantity = num
    }
    if (Object.keys(patch).length > 0) await onPatch(nodeId, patch)
    setEditing(false)
    setShowAutocomplete(false)
  }

  const cancelEdit = () => setEditing(false)

  const addComponent = async () => {
    await onAddChild(nodeId, {
      name: 'New component',
      node_type: 'component',
      quantity: 1,
      unit: 'piece',
      children: [],
    })
    setExpanded(true)
  }

  const addMaterial = async () => {
    await onAddChild(nodeId, {
      name: 'New material',
      node_type: 'material',
      quantity: 1,
      unit: 'kg',
    })
    setExpanded(true)
  }

  const handlePickActivity = async (link: EcoinventLink) => {
    await onPatch(nodeId, { ecoinvent_activity: link })
  }

  const clearActivity = async () => {
    await onPatch(nodeId, { ecoinvent_activity: null })
  }

  const indent = depth * 24

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          paddingLeft: 10 + indent,
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: hovered ? 'var(--bg-hover)' : 'transparent',
          minHeight: 40,
        }}
      >
        {/* Expand chevron / leaf icon */}
        <button
          onClick={() => isComponent && setExpanded(!expanded)}
          disabled={!isComponent}
          style={{
            width: 18, height: 18, padding: 0, background: 'none', border: 'none',
            cursor: isComponent ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', flexShrink: 0,
          }}
        >
          {isComponent
            ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
            : <Circle size={8} fill="var(--mod-lca)" color="var(--mod-lca)" />}
        </button>

        {/* Name + qty + unit */}
        {editing ? (
          <>
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
              style={{
                flex: 1, height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none', minWidth: 120,
              }}
            />
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={draft.amount}
                placeholder="100 or mass_per_unit"
                onChange={(e) => {
                  setDraft({ ...draft, amount: e.target.value })
                  setShowAutocomplete(isExpressionInput(e.target.value))
                }}
                onFocus={() => setShowAutocomplete(isExpressionInput(draft.amount))}
                onBlur={() => setTimeout(() => setShowAutocomplete(false), 150)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                title={isExpressionInput(draft.amount) ? 'Expression — resolves against active parameter set' : 'Numeric quantity'}
                style={{
                  width: 160, height: 28, padding: '0 8px 0 24px', backgroundColor: 'var(--bg-elevated)',
                  border: `1px solid ${draftResolve?.error ? 'var(--danger)' : 'var(--border-default)'}`,
                  borderRadius: 'var(--radius-md)',
                  color: isExpressionInput(draft.amount) ? 'var(--mod-plca)' : 'var(--text-primary)',
                  fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', outline: 'none',
                }}
              />
              {isExpressionInput(draft.amount) && (
                <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, fontStyle: 'italic', color: 'var(--mod-plca)', pointerEvents: 'none' }}>fx</span>
              )}
              {autocompleteMatches.length > 0 && (
                <div style={{
                  position: 'absolute', top: 30, left: 0, zIndex: 20,
                  backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)',
                  minWidth: 160, maxHeight: 180, overflow: 'auto',
                }}>
                  {autocompleteMatches.map((n) => (
                    <div
                      key={n}
                      onMouseDown={(e) => { e.preventDefault(); applyAutocomplete(n) }}
                      style={{
                        padding: '4px 8px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)', cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      {n} <span style={{ color: 'var(--text-tertiary)' }}>= {paramMap.get(n)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {draftResolve && !draftResolve.error && draftResolve.value != null && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                = {draftResolve.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
            )}
            {draftResolve?.error && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <AlertCircle size={11} /> {draftResolve.error}
              </span>
            )}
            <select
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              style={{
                height: 28, padding: '0 8px', backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none',
              }}
            >
              {UNIT_OPTIONS.includes(draft.unit) ? null : <option value={draft.unit}>{draft.unit}</option>}
              {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <Button variant="primary" onClick={saveEdit} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', backgroundColor: 'var(--mod-lca)' }}>Save</Button>
            <Button variant="ghost" onClick={cancelEdit} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)' }}>Cancel</Button>
          </>
        ) : (
          <>
            <span
              onClick={beginEdit}
              style={{
                fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: isComponent ? 500 : 400,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {node.name}
            </span>
            {hasExpression ? (
              <span
                onClick={beginEdit}
                title={`Expression${expressionResolve?.error ? ` — ${expressionResolve.error}` : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, fontStyle: 'italic', color: 'var(--mod-plca)' }}>fx</span>
                <span style={{ color: expressionResolve?.error ? 'var(--danger)' : 'var(--mod-plca)' }}>
                  {node.quantity_expression}
                </span>
                {expressionResolve && !expressionResolve.error && expressionResolve.value != null ? (
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    = {expressionResolve.value.toLocaleString(undefined, { maximumFractionDigits: 4 })} {node.unit}
                  </span>
                ) : expressionResolve?.error ? (
                  <span style={{ color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <AlertCircle size={11} /> {expressionResolve.error}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>{node.unit}</span>
                )}
              </span>
            ) : (
              <span onClick={beginEdit} style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                {node.quantity} {node.unit}
              </span>
            )}
            {isComponent && (node.children?.length ?? 0) > 0 && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                · {node.children!.length} {node.children!.length === 1 ? 'component' : 'components'}
              </span>
            )}

            {/* Scope selector (root stage nodes only). Setting scope auto-
                derives is_annual on the backend (scope=stock → annual). */}
            {isRoot && isComponent && (
              <select
                value={node.scope ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  const next = v === '' ? null : (v as 'inflows' | 'stock' | 'outflows')
                  onPatch(nodeId, { scope: next })
                }}
                title="DSM scope — inflows (manufacturing), stock (per-year use/maintenance), outflows (end of life). Empty falls back to keyword matching on the stage name."
                style={{
                  height: 22,
                  padding: '0 6px',
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.05em',
                  backgroundColor: node.scope
                    ? 'color-mix(in srgb, var(--mod-dsm) 12%, transparent)'
                    : 'transparent',
                  border: `1px solid ${node.scope ? 'var(--mod-dsm)' : 'var(--border-default)'}`,
                  borderRadius: 'var(--radius-sm)',
                  color: node.scope ? 'var(--mod-dsm)' : 'var(--text-tertiary)',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="">auto (by name)</option>
                <option value="inflows">inflows</option>
                <option value="stock">stock</option>
                <option value="outflows">outflows</option>
              </select>
            )}

            {/* Annual toggle (root stage nodes only) */}
            {isRoot && isComponent && (
              <button
                onClick={() => onPatch(nodeId, { is_annual: !node.is_annual })}
                title={node.is_annual ? 'Annual quantities (per year) — click to set as one-time' : 'One-time quantities — click to set as annual'}
                style={{
                  background: node.is_annual
                    ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                    : 'transparent',
                  border: `1px solid ${node.is_annual ? 'var(--accent)' : 'var(--border-default)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  color: node.is_annual ? 'var(--accent)' : 'var(--text-tertiary)',
                  padding: '2px 6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 9,
                  fontWeight: 600,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.05em',
                }}
              >
                {node.is_annual ? 'ANNUAL' : 'ONE-TIME'}
              </button>
            )}

            {/* Evolution badge (materials only) */}
            {!isComponent && (() => {
              const ev = node.evolution
              const isRebound = ev?.method === 'rebound_effect'
              const active = !!ev && ev.method !== 'fixed'
              const accent = isRebound ? 'var(--warning)' : 'var(--mod-plca)'
              return (
                <button
                  onClick={() => setEvolutionOpen((v) => !v)}
                  title={`Quantity evolution — ${evolutionSummary(ev)}`}
                  style={{
                    background: active
                      ? `color-mix(in srgb, ${accent} 15%, transparent)`
                      : 'transparent',
                    border: `1px solid ${active ? accent : 'var(--border-default)'}`,
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    color: active ? accent : 'var(--text-tertiary)',
                    padding: '2px 6px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  {(() => {
                    const r = ev?.learning_rate ?? 0
                    if (ev?.method === 'rebound_effect') return <TrendingUp size={11} />
                    if (ev?.method === 'learning_rate' && r < 0) return <TrendingDown size={11} />
                    if (ev?.method === 'learning_rate' && r > 0) return <TrendingUp size={11} />
                    if (ev?.method === 'milestones') return <TrendingDown size={11} />
                    return <Minus size={11} />
                  })()}
                  <span>{evolutionSummary(ev)}</span>
                </button>
              )
            })()}

            {/* Ecoinvent link section (materials only) */}
            {!isComponent && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                {linked ? (
                  <>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {linked.name}
                    </span>
                    {linked.location && <Badge label={linked.location} />}
                    <Badge label={linked.database} variant="lca" />
                    <button
                      onClick={() => setLinkerOpen(true)}
                      title="Change linked activity"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={clearActivity}
                      title="Unlink"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => setLinkerOpen(true)}
                    style={{ height: 26, padding: '0 10px', fontSize: 'var(--text-xs)', borderColor: 'var(--warning)', color: 'var(--warning)' }}
                  >
                    <LinkIcon size={12} />
                    Link to ecoinvent
                  </Button>
                )}
              </div>
            )}

            {/* Action buttons (right side, components push these to far right) */}
            <div style={{ display: 'flex', gap: 4, marginLeft: isComponent ? 'auto' : 8, opacity: hovered ? 1 : 0, transition: 'opacity var(--duration-fast) var(--ease-out)' }}>
              {isComponent && (
                <>
                  <button
                    onClick={addComponent}
                    title="Add sub-component"
                    style={{ background: 'none', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--text-xs)' }}
                  >
                    <Plus size={11} /> Component
                  </button>
                  <button
                    onClick={addMaterial}
                    title="Add material"
                    style={{ background: 'none', border: `1px solid var(--mod-lca)`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--mod-lca)', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--text-xs)' }}
                  >
                    <Plus size={11} /> Material
                  </button>
                </>
              )}
              {!isRoot && (
                <button
                  onClick={() => onDelete(nodeId)}
                  title="Delete node"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4 }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Evolution editor panel (materials only) */}
      {!isComponent && evolutionOpen && (
        <EvolutionPanel
          node={node}
          depth={depth}
          onSave={(ev) => onPatch(nodeId, { evolution: ev })}
          onClose={() => setEvolutionOpen(false)}
        />
      )}

      {/* Children */}
      {isComponent && expanded && hasChildren && (
        <>
          {node.children!.map((child, idx) => (
            <BOMTree
              key={child.id ?? `${idx}-${child.name}`}
              node={child}
              depth={depth + 1}
              onPatch={onPatch}
              onAddChild={onAddChild}
              onDelete={onDelete}
            />
          ))}
        </>
      )}

      {/* Empty state for empty component */}
      {isComponent && expanded && !hasChildren && (
        <div style={{
          padding: '6px 10px',
          paddingLeft: 10 + indent + 28,
          fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          No children. Add a component or material above.
        </div>
      )}

      {/* Ecoinvent linker modal */}
      {linkerOpen && (
        <EcoinventLinker
          current={linked ?? null}
          onClose={() => setLinkerOpen(false)}
          onPick={handlePickActivity}
        />
      )}
    </>
  )
}


// ── Evolution panel ──────────────────────────────────────────────────────────
// Rendered inline below a material row. Lets the user pick method = fixed |
// learning_rate | milestones and shows a live projection of the per-unit qty
// across a reference horizon (2025 → 2050, step 5).

const PREVIEW_YEARS = [2025, 2030, 2035, 2040, 2045, 2050]

function EvolutionPanel({
  node, depth, onSave, onClose,
}: {
  node: BOMNode
  depth: number
  onSave: (ev: MaterialEvolution | null) => Promise<void>
  onClose: () => void
}) {
  const initial = node.evolution
  const [method, setMethod] = useState<'fixed' | 'learning_rate' | 'rebound_effect' | 'milestones'>(
    initial?.method ?? 'fixed',
  )
  const [learningRate, setLearningRate] = useState<number>(initial?.learning_rate ?? -0.02)
  const [reboundRate, setReboundRate] = useState<number>(initial?.rebound_rate ?? 0.02)
  const [baseYear, setBaseYear] = useState<number>(initial?.base_year ?? 2025)
  const [milestones, setMilestones] = useState<QuantityMilestone[]>(
    initial?.milestones && initial.milestones.length > 0
      ? initial.milestones
      : [
          { year: 2025, quantity: node.quantity },
          { year: 2050, quantity: node.quantity * 0.5 },
        ],
  )

  const preview = useMemo(() => {
    return PREVIEW_YEARS.map((y) => {
      if (method === 'fixed') return { year: y, qty: node.quantity }
      if (method === 'learning_rate') {
        return { year: y, qty: projectLR(node.quantity, learningRate, baseYear, y) }
      }
      if (method === 'rebound_effect') {
        return { year: y, qty: projectLR(node.quantity, reboundRate, baseYear, y) }
      }
      const ms = [...milestones].sort((a, b) => a.year - b.year)
      if (ms.length === 0) return { year: y, qty: node.quantity }
      if (y <= ms[0].year) return { year: y, qty: ms[0].quantity }
      if (y >= ms[ms.length - 1].year) return { year: y, qty: ms[ms.length - 1].quantity }
      for (let i = 0; i < ms.length - 1; i++) {
        const a = ms[i]
        const b = ms[i + 1]
        if (y >= a.year && y <= b.year) {
          const t = (y - a.year) / (b.year - a.year)
          return { year: y, qty: a.quantity + t * (b.quantity - a.quantity) }
        }
      }
      return { year: y, qty: node.quantity }
    })
  }, [method, learningRate, reboundRate, baseYear, milestones, node.quantity])

  const handleSave = async () => {
    if (method === 'fixed') {
      await onSave(null)
    } else if (method === 'learning_rate') {
      await onSave({ method: 'learning_rate', learning_rate: learningRate, base_year: baseYear })
    } else if (method === 'rebound_effect') {
      await onSave({ method: 'rebound_effect', rebound_rate: reboundRate, base_year: baseYear })
    } else {
      if (milestones.length < 2) {
        alert('Milestones require at least two (year, value) pairs.')
        return
      }
      await onSave({ method: 'milestones', milestones: [...milestones].sort((a, b) => a.year - b.year), base_year: baseYear })
    }
    onClose()
  }

  const handleReset = async () => {
    if (!initial) { onClose(); return }
    await onSave(null)
    onClose()
  }

  const indent = depth * 24

  const updateMilestone = (idx: number, patch: Partial<QuantityMilestone>) => {
    setMilestones((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)))
  }
  const addMilestone = () => {
    const last = milestones[milestones.length - 1]
    setMilestones([...milestones, { year: (last?.year ?? 2025) + 5, quantity: last?.quantity ?? node.quantity }])
  }
  const removeMilestone = (idx: number) => {
    setMilestones((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)))
  }

  return (
    <div
      style={{
        paddingLeft: 10 + indent + 28,
        paddingRight: 'var(--space-5)',
        paddingTop: 'var(--space-3)',
        paddingBottom: 'var(--space-3)',
        backgroundColor: 'color-mix(in srgb, var(--mod-plca) 6%, transparent)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 'var(--text-xs)', flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text-primary)' }}>Quantity evolution</strong>
        {(['fixed', 'learning_rate', 'rebound_effect', 'milestones'] as const).map((m) => {
          const label =
            m === 'fixed' ? 'Fixed'
            : m === 'learning_rate' ? 'Learning rate'
            : m === 'rebound_effect' ? 'Rebound effect'
            : 'Milestones'
          return (
            <label key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input type="radio" checked={method === m} onChange={() => setMethod(m)} />
              {label}
            </label>
          )
        })}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {initial && initial.method !== 'fixed' && (
            <Button
              variant="ghost"
              onClick={handleReset}
              title="Clear evolution (back to fixed quantity)"
              style={{ height: 26, padding: '0 8px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <RotateCcw size={11} /> Reset to fixed
            </Button>
          )}
          <Button variant="primary" onClick={handleSave} style={{ height: 26, padding: '0 10px', fontSize: 'var(--text-xs)', backgroundColor: 'var(--mod-plca)' }}>Save</Button>
          <Button variant="ghost" onClick={onClose} style={{ height: 26, padding: '0 10px', fontSize: 'var(--text-xs)' }}>Cancel</Button>
        </span>
      </div>

      {method === 'learning_rate' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          <label>
            Annual change (%)
            <NumberInput
              value={Number((learningRate * 100).toFixed(4))}
              onChange={(v) => setLearningRate(v / 100)}
              allowNegative
              style={{ marginLeft: 6, width: 80, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
            />
          </label>
          <label>
            Base year
            <NumberInput
              value={baseYear}
              onChange={setBaseYear}
              integerOnly
              emptyValue={2025}
              style={{ marginLeft: 6, width: 76, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
            />
          </label>
          <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            q(y) = {node.quantity} × (1 + r)^(y − {baseYear})
          </span>
        </div>
      )}

      {method === 'rebound_effect' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <label>
              Rebound rate
              <NumberInput
                value={Number((reboundRate * 100).toFixed(4))}
                onChange={(v) => setReboundRate(v / 100)}
                allowNegative
                style={{ marginLeft: 6, width: 80, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
              />
              <span style={{ marginLeft: 4, color: 'var(--text-tertiary)' }}>% / year</span>
            </label>
            <label>
              Base year
              <NumberInput
                value={baseYear}
                onChange={setBaseYear}
                integerOnly
                emptyValue={2025}
                style={{ marginLeft: 6, width: 76, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
              />
            </label>
            <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              q(y) = {node.quantity} × (1 + r)^(y − {baseYear})
            </span>
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            Represents increased consumption from efficiency gains (rebound effect). Common on use-phase processes — appliance operation, lighting, heating, transport, etc.
          </span>
        </div>
      )}

      {method === 'milestones' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {milestones.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--text-xs)' }}>
              <NumberInput
                value={m.year}
                onChange={(v) => updateMilestone(i, { year: v })}
                integerOnly
                emptyValue={2025}
                style={{ width: 72, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
              />
              <NumberInput
                value={m.quantity}
                onChange={(v) => updateMilestone(i, { quantity: v })}
                allowNegative
                style={{ width: 96, height: 24, padding: '0 6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
              />
              <span style={{ color: 'var(--text-tertiary)' }}>{node.unit}</span>
              <button
                onClick={() => removeMilestone(i)}
                disabled={milestones.length <= 2}
                title="Remove milestone"
                style={{ background: 'none', border: 'none', cursor: milestones.length <= 2 ? 'not-allowed' : 'pointer', color: 'var(--danger)', padding: 2, opacity: milestones.length <= 2 ? 0.3 : 1 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <Button variant="ghost" onClick={addMilestone} style={{ height: 24, padding: '0 8px', fontSize: 'var(--text-xs)', alignSelf: 'flex-start' }}>
            <Plus size={11} /> Add milestone
          </Button>
        </div>
      )}

      {/* Live preview — simple table showing per-unit qty at reference years */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Preview</span>
        {preview.map((p) => (
          <span key={p.year} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>{p.year}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {Math.abs(p.qty) >= 1000 ? p.qty.toExponential(2) : p.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
