import type { AESAZone, SharingPrincipleId } from '../../api/client'

export const ZONE_COLOR: Record<AESAZone, string> = {
  safe: '#1D9E75',
  zone_of_uncertainty: '#EF9F27',
  high_risk: '#E24B4A',
}

export const ZONE_LABEL: Record<AESAZone, string> = {
  safe: 'Safe',
  zone_of_uncertainty: 'Zone of Uncertainty',
  high_risk: 'High Risk',
}

export const PRINCIPLE_COLOR: Record<SharingPrincipleId, string> = {
  EpC: '#60A5FA',
  IN:  '#F59E0B',
  AGR: '#34D399',
  LA:  '#A78BFA',
  AR:  '#F87171',
}

export const PRINCIPLE_LABEL: Record<SharingPrincipleId, string> = {
  EpC: 'Equality per Capita',
  IN:  'Industrial Output',
  AGR: 'Agricultural Output',
  LA:  'Land Area',
  AR:  'Acquired Rights',
}

export function zoneFromSR(sr: number): AESAZone {
  if (sr <= 1.0) return 'safe'
  if (sr <= 2.0) return 'zone_of_uncertainty'
  return 'high_risk'
}

export function fmt(n: number): string {
  if (!isFinite(n)) return '—'
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1e6 || a < 0.01) return n.toExponential(2)
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

/** Render an SR value that may be null (budget depleted → SR=∞). */
export function fmtSR(sr: number | null): string {
  if (sr === null) return '∞'
  if (!isFinite(sr)) return '∞'
  return sr.toFixed(3)
}

/** Effective SR for numeric ops (plotting, sorting): null → Infinity. */
export function srOrInf(sr: number | null): number {
  return sr === null ? Infinity : sr
}

export function shortPbName(name: string): string {
  const s = name.replace(/_/g, ' ')
  if (s.length <= 18) return s
  return s.split(' ').map((w) => (w.length > 10 ? w.slice(0, 9) + '…' : w)).join(' ')
}
