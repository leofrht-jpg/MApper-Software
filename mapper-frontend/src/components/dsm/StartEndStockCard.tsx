export interface YearStockRecord {
  year: number
  stock: Record<string, number>
}

export interface YearStockStartEnd {
  /** Total stock at the START of the year (before that year's flows):
   *  the uploaded initial-stock total for the first horizon year, else the
   *  prior year's end-of-year snapshot. `null` when unavailable. */
  start: number | null
  /** Total stock at the END of the year = `Σ YearResult[Y].stock` (the engine
   *  snapshots stock AFTER the year's flows). `null` when the year isn't found. */
  end: number | null
}

const sumValues = (o: Record<string, number>): number =>
  Object.values(o).reduce((a, b) => a + b, 0)

/**
 * Start- and end-of-year total stock for the selected simulation year.
 *
 * The engine snapshots `YearResult.stock` AFTER the year's inflows/outflows
 * are applied (`dsm_engine.py` ~1464), so it is the END-of-year figure:
 *
 *   end(Y)   = Σ YearResult[Y].stock
 *   start(Y) = Σ YearResult[Y−1].stock      (= end of the prior year)
 *
 * For the FIRST horizon year there is no prior `YearResult`, so `start` is the
 * uploaded initial-stock total (summed before any simulation flows), passed in
 * as `initialStockTotal`. When that is unavailable (no initial_stock slot),
 * `initialStockTotal` is `null` and the card renders an em-dash.
 *
 * Invariant (engine construction): `start + net == end`, where
 * `net = Σ inflow − Σ outflow` for the year — matching the Net-change card.
 * Do NOT source `start` from `summary.totalStock` (= `Σ stock`); that is the
 * END figure, which is what Patch 5C/5D got wrong.
 */
export function yearStockStartEnd(
  years: YearStockRecord[],
  selectedYear: number,
  initialStockTotal: number | null,
): YearStockStartEnd {
  const idx = years.findIndex((y) => y.year === selectedYear)
  if (idx < 0) return { start: null, end: null }
  const end = sumValues(years[idx].stock)
  const start = idx === 0 ? initialStockTotal : sumValues(years[idx - 1].stock)
  return { start, end }
}

interface StartEndStockCardProps {
  year: number
  start: number | null
  end: number | null
  format: (v: number) => string
}

/**
 * KPI card showing total stock at the start and end of the selected year.
 * Sits in the 2×2 KPI grid with `SummaryCard` chrome. Both figures use the
 * SAME typographic scale/weight/mono treatment — neither is more important.
 * Both update with the year slider. `null` values render as an em-dash.
 */
export function StartEndStockCard({ year, start, end, format }: StartEndStockCardProps) {
  const subLabelStyle: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-tertiary)',
  }
  // Identical style object for both values — equal visual weight by construction.
  const valueStyle: React.CSSProperties = {
    fontSize: 'var(--text-2xl)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    color: 'var(--text-primary)',
  }
  const show = (v: number | null) => (v == null ? '—' : format(v))
  return (
    <div
      data-testid="total-stock-card"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 110,
      }}
    >
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', fontWeight: 600 }}>
        Total stock
      </div>
      <div style={{ marginTop: 6 }}>
        <div style={subLabelStyle}>Start of {year}</div>
        <span data-testid="total-stock-start" style={valueStyle}>{show(start)}</span>
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={subLabelStyle}>End of {year}</div>
        <span data-testid="total-stock-end" style={valueStyle}>{show(end)}</span>
      </div>
    </div>
  )
}
