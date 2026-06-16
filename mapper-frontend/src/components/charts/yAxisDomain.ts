/**
 * Tight y-axis domain for stacked charts.
 *
 * Recharts' default `[0, 'auto']` adds 10–25% headroom above the data, which
 * misleads readers (the chart looks taller than the largest stacked total).
 * This helper returns `[0, dataMax × 1.05]` rounded up to a sensible tick —
 * just enough breathing room for the top label without exaggerating the gap.
 *
 * Usage:
 *   <YAxis domain={tightStackedDomain} ... />
 */
export const tightStackedDomain: [0, (dataMax: number) => number] = [
  0,
  (dataMax: number) => {
    if (!isFinite(dataMax) || dataMax <= 0) return 1
    const padded = dataMax * 1.05
    const magnitude = Math.pow(10, Math.floor(Math.log10(padded)))
    return Math.ceil(padded / magnitude) * magnitude
  },
]
