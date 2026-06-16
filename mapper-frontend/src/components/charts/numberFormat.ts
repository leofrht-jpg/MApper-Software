import { useCallback, useMemo, useState } from 'react'

export type Notation = 'scientific' | 'fixed' | 'si'

export interface NumberFormatSettings {
  notation: Notation
  sigFigs: number
  decimals: number
}

export const DEFAULT_NUMBER_FORMAT: NumberFormatSettings = {
  notation: 'scientific',
  sigFigs: 3,
  decimals: 0,
}

const SI_PREFIXES: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
]

function pickSiPrefix(absVal: number): [number, string] {
  for (const [scale, prefix] of SI_PREFIXES) {
    if (absVal >= scale) return [scale, prefix]
  }
  return [SI_PREFIXES[SI_PREFIXES.length - 1][0], SI_PREFIXES[SI_PREFIXES.length - 1][1]]
}

export function formatNumber(value: number, s: NumberFormatSettings): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) {
    if (s.notation === 'fixed') return (0).toFixed(s.decimals)
    if (s.notation === 'scientific') return (0).toExponential(Math.max(0, s.sigFigs - 1))
    return '0'
  }
  if (s.notation === 'scientific') {
    return value.toExponential(Math.max(0, s.sigFigs - 1))
  }
  if (s.notation === 'fixed') {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: s.decimals,
      maximumFractionDigits: s.decimals,
    })
  }
  // si
  const abs = Math.abs(value)
  const [scale, prefix] = pickSiPrefix(abs)
  const scaled = value / scale
  const sig = Math.max(1, s.sigFigs)
  return `${scaled.toPrecision(sig)}${prefix}`
}

export function useNumberFormatter(initial: Partial<NumberFormatSettings> = {}) {
  const [settings, setSettings] = useState<NumberFormatSettings>({
    ...DEFAULT_NUMBER_FORMAT,
    ...initial,
  })
  const format = useCallback(
    (value: number) => formatNumber(value, settings),
    [settings],
  )
  const api = useMemo(
    () => ({ settings, setSettings, format }),
    [settings, format],
  )
  return api
}
