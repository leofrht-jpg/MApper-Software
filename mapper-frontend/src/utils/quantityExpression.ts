/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Quantity expressions in the editors (a BOM row, an archetype include). Moved
// out of BOMTree.tsx unchanged so two components share one resolver.

// An amount that starts with a letter or underscore (snake_case) is treated as
// an expression, else as a plain number.
export function isExpressionInput(s: string): boolean {
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

export function resolveExpression(expr: string, params: Map<string, number>): { value: number | null; error: string | null } {
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
