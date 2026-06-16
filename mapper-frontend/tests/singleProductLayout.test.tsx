import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { useBOMStore } from '../src/stores/bomStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'
import type { ArchetypeSummary } from '../src/api/client'

// Stage Amounts CollapsibleCard contract:
//   1. default collapsed (advanced tweak; most users keep Lifetime defaults)
//   2. summary line visible when collapsed (preset + per-stage abbreviations)
//   3. clicking the header expands and surfaces the StageAmountsEditor
// Bounded-height layout assertions intentionally not present — single-
// product mode uses page-level scroll (the bounded-height pattern was
// tried and reverted; see CLAUDE.md "Single-product mode uses page-level
// scroll").

const mkArchetype = (id: string, name: string, stages: string[]): ArchetypeSummary => ({
  id, name, folder: null,
  material_count: 10, unlinked_count: 0,
  stages,
  stage_annual: { 'Use Phase': true },
  validation_error_rows: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

beforeEach(() => {
  useBOMStore.setState({
    archetypes: [
      mkArchetype('arc-1', 'Arc A', ['Manufacturing', 'Use Phase', 'End of Life']),
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  useSingleProductImpactStore.getState().reset()
})

describe('SingleProductImpact — Stage Amounts collapsible (Patch 4)', () => {
  it('Stage Amounts card is default collapsed and shows a summary line', () => {
    const { getByTestId, queryByTestId } = render(<SingleProductImpact />)
    // Wait for the auto-pick effect to seed the archetype + stage amounts.
    // The auto-pick is synchronous within React's render cycle; the seed
    // effect runs immediately after.
    expect(getByTestId('single-product-stage-amounts')).toBeInTheDocument()
    // Summary line is visible in the collapsed header.
    const summary = getByTestId('single-product-stage-amounts-summary')
    expect(summary).toBeInTheDocument()
    // Default summary: preset is '1year', so summary starts with '1 year'.
    expect(summary.textContent).toMatch(/1 year/i)
    // The full editor is NOT in the DOM tree's visible body when collapsed.
    // CollapsibleCard renders the body with display:none when collapsed,
    // so the editor element itself stays mounted (visibility-toggle
    // pattern) — the assertion is that it's hidden, not absent.
    const editor = queryByTestId('stage-amounts-editor')
    expect(editor).toBeInTheDocument()
    // The editor's parent (the body wrapper) should have display: none
    // because the card is collapsed. We walk up to find the wrapper.
    // Simpler: the surrounding card body should be display:none. Assert
    // by peeking at the parent's computed style via inline style.
    // CollapsibleCard sets `display: 'none'` inline when collapsed.
    let node: HTMLElement | null = editor as HTMLElement
    let foundHidden = false
    while (node) {
      if (node.style.display === 'none') {
        foundHidden = true
        break
      }
      node = node.parentElement
    }
    expect(foundHidden).toBe(true)
  })

  it('clicking the Stage Amounts header expands and surfaces the editor', () => {
    const { getByTestId, getByText } = render(<SingleProductImpact />)
    fireEvent.click(getByText('Stage amounts'))
    // After expansion, the editor's body should NOT have display:none.
    const editor = getByTestId('stage-amounts-editor') as HTMLElement
    let node: HTMLElement | null = editor
    let foundHidden = false
    while (node) {
      if (node.style.display === 'none') {
        foundHidden = true
        break
      }
      node = node.parentElement
    }
    expect(foundHidden).toBe(false)
  })
})

describe('SingleProductImpact — sub-tab nav / content separation (Patch 5K)', () => {
  it('separates the sub-tab nav row from the content cards with a spacing-scale token', () => {
    const { getByTestId } = render(<SingleProductImpact />)
    // Mechanism lock: the content block carries a scale-token marginTop (not
    // hardcoded px, not absent) so the CONFIGURATION card isn't flush against
    // the Static/Prospective/Comparison tab row. (jsdom can't measure pixels.)
    const content = getByTestId('single-product-tab-content')
    expect(content.style.marginTop).toBe('var(--space-4)')
  })

  it('separates the Archetype card from the Stage amounts card with the same scale token (Patch 5U)', () => {
    const { getByTestId } = render(<SingleProductImpact />)
    // The single-pane is a plain block container (no flex gap), so the gap is a
    // scale-token marginTop on the Stage amounts wrapper — same token + mechanism
    // as the tab-nav → content gap above. (jsdom can't measure pixels.)
    const stage = getByTestId('single-product-stage-amounts')
    expect(stage.style.marginTop).toBe('var(--space-4)')
  })
})
