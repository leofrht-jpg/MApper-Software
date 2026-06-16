/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { DSMScenariosChip } from '../src/components/dsm/DSMScenariosChip'
import { useDSMStore } from '../src/stores/dsmStore'

// UI convention: multi-select chips/selectors anchor the Pick/Add
// button on the LEFT. Selected items flow rightward in selection
// order — newest-at-rightmost. The Pick button stays in the same
// position regardless of how many items are selected, avoiding
// layout drift over add/remove cycles.
//
// Components in scope (audit complete as of this patch):
//   - DSMScenariosChip (component)
//   - LCI Scenarios chip group inline in ProjectedImpactPanel
//
// Excluded: vertical checkbox lists (parameter sensitivity cases),
// single-select dropdowns (archetype, method family, AESA cascade),
// vertical row editors (PairListEditor, DimensionsEditor, etc.).
// Single-select has no "accumulation" concern; vertical lists
// don't drift horizontally.

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  useDSMStore.setState({
    systemState: {
      scenarios: [
        { id: 'base', name: 'Base', is_base: true } as any,
        { id: 'ssp1', name: 'SSP1', is_base: false } as any,
        { id: 'ssp2', name: 'SSP2', is_base: false } as any,
        { id: 'ssp5', name: 'SSP5', is_base: false } as any,
      ],
      active_scenario_id: 'base',
    } as any,
    isSimulating: false,
  } as any)
})

describe('DSMScenariosChip — left-anchored Pick (UI convention)', () => {
  // The wrapper span carries `display: inline-flex` with `flex-wrap:
  // wrap`. Inside, JSX order is the LABEL, then PICK, then SELECTED.
  // We assert Pick is the first non-label child element so users
  // see Pick at the left regardless of selection count.

  const getButtonAndChips = (container: HTMLElement) => {
    const wrap = container.querySelector('span')!
    const pick = wrap.querySelector('[data-testid="dsm-scenarios-pick"]') as HTMLElement
    // Selected chips are the styled <span> children with the
    // accent-coloured pill style. Identify them as <span> children
    // OTHER than the label and the popover wrapper.
    const allSpans = Array.from(wrap.querySelectorAll(':scope > span'))
    // The first span is the LABEL ("DSM scenarios"). Subsequent
    // spans are the selected chips.
    const label = allSpans[0]
    const chips = allSpans.slice(1) as HTMLElement[]
    return { pick, label, chips, wrap }
  }

  it('renders Pick before any selected chip in DOM order', () => {
    const onChange = () => {}
    const { container } = render(
      <DSMScenariosChip
        selectedIds={['ssp1', 'ssp2', 'ssp5']}
        onChange={onChange}
      />,
    )
    const { pick, chips } = getButtonAndChips(container)
    expect(pick).not.toBeNull()
    expect(chips.length).toBe(3)
    // The Pick button must precede every chip in the document.
    for (const chip of chips) {
      const rel = pick.compareDocumentPosition(chip)
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('keeps Pick in the same DOM position when selection grows from 1 to 3', () => {
    const { container, rerender } = render(
      <DSMScenariosChip selectedIds={['ssp1']} onChange={() => {}} />,
    )
    const pick1 = container.querySelector('[data-testid="dsm-scenarios-pick"]') as HTMLElement
    const wrap1 = container.querySelector('span')!
    // Position of Pick within the wrap = index of pick among children.
    const idx1 = Array.from(wrap1.children).indexOf(pick1)
    rerender(
      <DSMScenariosChip selectedIds={['ssp1', 'ssp2', 'ssp5']} onChange={() => {}} />,
    )
    const pick2 = container.querySelector('[data-testid="dsm-scenarios-pick"]') as HTMLElement
    const wrap2 = container.querySelector('span')!
    const idx2 = Array.from(wrap2.children).indexOf(pick2)
    // Position MUST remain the same — left-anchored. With selection
    // appending to the RIGHT of Pick, Pick's index stays constant.
    expect(idx2).toBe(idx1)
  })

  it('newest selection lands at the rightmost position', () => {
    const { container, rerender } = render(
      <DSMScenariosChip selectedIds={['ssp1', 'ssp2']} onChange={() => {}} />,
    )
    rerender(
      <DSMScenariosChip selectedIds={['ssp1', 'ssp2', 'ssp5']} onChange={() => {}} />,
    )
    const wrap = container.querySelector('span')!
    const allSpans = Array.from(wrap.querySelectorAll(':scope > span'))
    // Skip the first span (label) — chips follow.
    const chips = allSpans.slice(1) as HTMLElement[]
    expect(chips.length).toBe(3)
    // SSP5 is the newest — must be the rightmost (last) chip.
    expect(chips[chips.length - 1].textContent).toContain('SSP5')
  })

  it('Pick button has dashed border (visual cue distinguishing it from solid-border chips)', () => {
    const { container } = render(
      <DSMScenariosChip selectedIds={['ssp1']} onChange={() => {}} />,
    )
    const pick = container.querySelector('[data-testid="dsm-scenarios-pick"]') as HTMLElement
    // Inline style includes "1px dashed". Locking this in keeps the
    // dashed-border affordance from regressing — it's the visual
    // signal that Pick is an action button, not a static chip.
    expect(pick.getAttribute('style')).toMatch(/dashed/)
  })
})
