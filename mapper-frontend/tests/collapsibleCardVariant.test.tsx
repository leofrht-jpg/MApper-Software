import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { CollapsibleCard } from '../src/components/ui/CollapsibleCard'

// Patch 5W — opt-in 'item' variant (elevated surface) + leading slot. Default
// must stay on the base surface (structural cards / single-item view unchanged).
// Lock the surface token + slot, not pixels.

const sectionOf = (container: HTMLElement) => container.querySelector('section') as HTMLElement

describe('CollapsibleCard — variant + leading (Patch 5W)', () => {
  it('defaults to the base surface token (structural look)', () => {
    const { container } = render(
      <CollapsibleCard expanded title="ITEMS" onToggle={() => {}}>body</CollapsibleCard>,
    )
    expect(sectionOf(container).style.backgroundColor).toBe('var(--bg-surface)')
  })

  it('variant="item" uses the elevated surface token (one step up)', () => {
    const { container } = render(
      <CollapsibleCard expanded title="BEV-LFP" variant="item" onToggle={() => {}}>body</CollapsibleCard>,
    )
    expect(sectionOf(container).style.backgroundColor).toBe('var(--bg-elevated)')
  })

  it('renders the leading slot in the header before the title', () => {
    const { getByTestId, getByRole } = render(
      <CollapsibleCard
        expanded title="BEV-LFP" variant="item" onToggle={() => {}}
        leading={<span data-testid="badge">1</span>}
      >body</CollapsibleCard>,
    )
    const badge = getByTestId('badge')
    const title = getByRole('heading', { name: 'BEV-LFP' })
    expect(badge).toBeInTheDocument()
    // Badge precedes the title in document order.
    expect(badge.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('collapse/expand still works regardless of variant', () => {
    let expanded = false
    const { getByRole, rerender } = render(
      <CollapsibleCard expanded={expanded} title="BEV-LFP" variant="item" onToggle={() => { expanded = !expanded }}>
        body
      </CollapsibleCard>,
    )
    fireEvent.click(getByRole('heading', { name: 'BEV-LFP' }))
    expect(expanded).toBe(true)
    rerender(
      <CollapsibleCard expanded={expanded} title="BEV-LFP" variant="item" onToggle={() => {}}>body</CollapsibleCard>,
    )
    // No throw; body wrapper present in both states (visibility-toggle).
    expect(getByRole('heading', { name: 'BEV-LFP' })).toBeInTheDocument()
  })
})
