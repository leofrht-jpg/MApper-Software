import { useEffect, useRef, useState } from 'react'

// Live elapsed-second counter while `active` is true. Used by single-product
// Impact panels to render "Calculating 1/3 · 4s" during synchronous fan-out.
// Resets to 0 on every active=false → true transition.
export function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      startRef.current = null
      setElapsed(0)
      return
    }
    startRef.current = Date.now()
    setElapsed(0)
    const id = setInterval(() => {
      if (startRef.current != null) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [active])

  return elapsed
}
