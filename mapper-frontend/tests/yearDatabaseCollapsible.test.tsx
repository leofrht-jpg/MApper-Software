import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { CollapsibleCard } from '../src/components/ui/CollapsibleCard'

// Patch 5AE Part 1 — the system-level Prospective "Year → Database" mapping is a
// default-collapsed CollapsibleCard with an informative collapsed summary
// (year range · count). Rendering the full ProjectedImpactPanel is
// disproportionate; this mirrors the exact usage shape (default expanded=false,
// summary, visibility-toggle body) against the real CollapsibleCard.

// Mirror of ProjectedImpactPanel's Year→Database wiring.
function YearDbCard() {
  const [expanded, setExpanded] = useState(false)  // default COLLAPSED
  const years = [2025, 2030, 2040, 2050]
  return (
    <CollapsibleCard
      title="Year → Database"
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      summary={!expanded ? <span data-testid="year-db-summary">{years[0]}–{years[years.length - 1]} · {years.length} years</span> : undefined}
    >
      <div data-testid="year-db-body">
        {years.map((y) => <span key={y}>{y}</span>)}
      </div>
    </CollapsibleCard>
  )
}

const bodyWrapper = (node: HTMLElement) => node.parentElement as HTMLElement

describe('Year → Database collapsible (Patch 5AE)', () => {
  it('is collapsed by default (body hidden via visibility-toggle) with an informative summary', () => {
    const { getByTestId, getByRole } = render(<YearDbCard />)
    expect(getByRole('heading', { name: 'Year → Database' })).toBeTruthy()
    // Default collapsed → body wrapper display:none, summary visible.
    expect(bodyWrapper(getByTestId('year-db-body')).style.display).toBe('none')
    expect(getByTestId('year-db-summary').textContent).toContain('2025–2050')
    expect(getByTestId('year-db-summary').textContent).toContain('4 years')
  })

  it('expands and collapses on header click; body node persists across toggle', () => {
    const { getByTestId, getByRole } = render(<YearDbCard />)
    const before = getByTestId('year-db-body')
    fireEvent.click(getByRole('heading', { name: 'Year → Database' }))   // expand
    expect(bodyWrapper(getByTestId('year-db-body')).style.display).toBe('block')
    fireEvent.click(getByRole('heading', { name: 'Year → Database' }))   // collapse
    expect(bodyWrapper(getByTestId('year-db-body')).style.display).toBe('none')
    // Same DOM node throughout → visibility-toggle, not unmount.
    expect(getByTestId('year-db-body')).toBe(before)
  })
})
