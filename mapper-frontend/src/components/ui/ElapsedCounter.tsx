import { useEffect, useState, type CSSProperties } from 'react'

interface Props {
  /** Wall-clock ms timestamp when the operation began. `null` renders nothing. */
  startedAt: number | null
  /** When set, freeze at this elapsed ms instead of ticking — used after the op finishes if you want to keep the final value visible. */
  frozenMs?: number | null
  className?: string
  style?: CSSProperties
}

/**
 * Live `M:SS` / `MM:SS` counter for long-running operations. Pass a fresh
 * `startedAt` (e.g. `Date.now()`) when the op begins and `null` when it ends.
 */
export function ElapsedCounter({ startedAt, frozenMs, className, style }: Props) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt == null || frozenMs != null) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt, frozenMs])

  if (startedAt == null) return null
  const ms = frozenMs != null ? frozenMs : now - startedAt
  return <span className={className} style={style}>{formatElapsed(ms)}</span>
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec < 10 ? `0${sec}` : sec}`
}
