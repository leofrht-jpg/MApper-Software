/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import {
  forwardRef, useEffect, useRef, useState,
  type FocusEvent, type InputHTMLAttributes, type Ref,
} from 'react'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number
  onChange: (value: number) => void
  /** Value committed when the field is blurred while empty/invalid. Defaults to 0. */
  emptyValue?: number
  /** Reject decimals (round on commit). */
  integerOnly?: boolean
  /** Allow negative values. Default false. */
  allowNegative?: boolean
  /** Inclusive lower bound; clamped on blur. */
  min?: number
  /** Inclusive upper bound; clamped on blur. */
  max?: number
}

/**
 * Controlled numeric input that holds its own string state so we can render
 * canonical forms ("15") even when the user typed something denormal ("015").
 *
 * Why this exists: a `<input type="number" value={n} onChange={parseFloat(...)}>`
 * controlled by a numeric prop fails to re-render when the parsed value matches
 * the previous render's value. Typing "0" before "15" leaves "015" stuck in the
 * DOM. Holding the displayed text in local state fixes the round-trip.
 */
export const NumberInput = forwardRef(function NumberInput(
  {
    value, onChange, emptyValue = 0, integerOnly = false, allowNegative = false,
    min, max, onBlur, inputMode, ...rest
  }: Props,
  ref: Ref<HTMLInputElement>,
) {
  const [text, setText] = useState<string>(() => formatCanonical(value))
  // Track the last numeric value we emitted so we can detect external updates.
  const lastEmitted = useRef<number>(value)

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(formatCanonical(value))
      lastEmitted.current = value
    }
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value

    const allowedChars = integerOnly
      ? (allowNegative ? /[^\d-]/g : /[^\d]/g)
      : (allowNegative ? /[^\d.\-]/g : /[^\d.]/g)
    raw = raw.replace(allowedChars, '')

    if (allowNegative) {
      // Only one leading '-', and only at position 0.
      raw = raw.replace(/(?!^)-/g, '')
    }
    if (!integerOnly) {
      // Only one '.'.
      const i = raw.indexOf('.')
      if (i !== -1) raw = raw.slice(0, i + 1) + raw.slice(i + 1).replace(/\./g, '')
    }
    raw = stripLeadingZeros(raw)
    setText(raw)

    if (isIntermediate(raw)) return
    const n = parseFloat(raw)
    if (Number.isFinite(n)) {
      const final = integerOnly ? Math.trunc(n) : n
      if (final !== lastEmitted.current) {
        lastEmitted.current = final
        onChange(final)
      }
    }
  }

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    let n: number
    if (text === '' || text === '-' || text === '.' || text === '-.') {
      n = emptyValue
    } else {
      const parsed = parseFloat(text)
      n = Number.isFinite(parsed) ? parsed : emptyValue
    }
    if (integerOnly) n = Math.trunc(n)
    if (min !== undefined && n < min) n = min
    if (max !== undefined && n > max) n = max
    setText(formatCanonical(n))
    if (n !== lastEmitted.current) {
      lastEmitted.current = n
      onChange(n)
    }
    onBlur?.(e)
  }

  return (
    <input
      ref={ref}
      {...rest}
      type="text"
      inputMode={inputMode ?? (integerOnly ? 'numeric' : 'decimal')}
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  )
})

function formatCanonical(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return String(n)
}

/** Strip leading zeros from an integer prefix while preserving "0", "0.x" and the negative sign. */
function stripLeadingZeros(s: string): string {
  let neg = ''
  if (s.startsWith('-')) { neg = '-'; s = s.slice(1) }
  if (s.length > 1 && s[0] === '0' && s[1] !== '.') {
    s = s.replace(/^0+/, '')
    if (s === '' || s.startsWith('.')) s = '0' + s
  }
  return neg + s
}

/** Transitional strings that shouldn't trigger an onChange yet. */
function isIntermediate(s: string): boolean {
  if (s === '' || s === '-' || s === '.' || s === '-.') return true
  // Trailing decimal point: "1.", "-1." — user is mid-typing.
  if (/^-?\d+\.$/.test(s)) return true
  // Leading decimal: ".5", "-.5" — accept value but defer canonical form to blur.
  return false
}
