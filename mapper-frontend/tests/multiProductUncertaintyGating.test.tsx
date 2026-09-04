/**
 * "Run uncertainty" is offered in Archetypes mode ONLY.
 *
 * Monte Carlo takes archetype ids — `MonteCarloRequest.archetype_id` and
 * `MonteCarloMultiRequest.archetype_ids` — and an activities comparison has
 * none. So the action cannot work there BY CONSTRUCTION, not for want of
 * wiring, and no amount of plumbing would change that.
 *
 * Before this it rendered unconditionally and its handler returned silently on
 * the empty archetype filter: visible, clickable, and doing nothing at all —
 * no navigation, no message. That is worse than an absent control, because the
 * user cannot tell a broken feature from a misunderstood one.
 *
 * A banner would be worse still: it would explain, on every prospective
 * result, why a thing that is offered does not work.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MultiProductLCA } from '../src/components/impact/MultiProductLCA'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import type { MultiProductLCAResult } from '../src/api/client'

function result(): MultiProductLCAResult {
  return {
    items: [{
      type: 'activity', item_id: 'db|code', label: 'electricity [SSP1 2030]',
      status: 'success',
      activity_result: { results: [{ method: ['m'], method_label: 'm', unit: 'kg', score: 1 }] },
    }],
    success_count: 1, error_count: 0, elapsed_seconds: 0.1,
  } as unknown as MultiProductLCAResult
}

beforeEach(() => {
  useMultiProductLCAStore.setState({
    multiResult: result(), selectedItems: [], multiLoading: false,
    multiError: null, multiByCase: null, multiCaseOrder: [],
    multiVintageCoords: {},
  } as never)
})

describe('Run uncertainty gating', () => {
  it('is ABSENT in Activities mode — MC has no archetype to run on', () => {
    // NOTE: do NOT reach this state by clicking the mode toggle. `switchMode`
    // calls `clearResults()`, so the Results card unmounts and the button
    // disappears for a reason that has nothing to do with the gate -- the
    // first version of this test passed with the gate REMOVED, which is worse
    // than no test. Switch mode first, THEN seed a result, so the only thing
    // deciding the button's presence is the gate itself.
    const { rerender } = render(<MultiProductLCA />)
    const toggle = screen.getByTestId('multi-product-mode-toggle')
    const activities = Array.from(toggle.querySelectorAll('button'))
      .find((b) => /activities/i.test(b.textContent ?? ''))
    expect(activities).toBeTruthy()
    act(() => { fireEvent.click(activities!) })

    // Re-seed the result that switchMode just cleared.
    act(() => {
      useMultiProductLCAStore.setState({ multiResult: result() } as never)
    })
    rerender(<MultiProductLCA />)

    // The Results card IS present ...
    expect(screen.queryByTestId('multi-product-results-summary')
      ?? screen.queryByTestId('multi-product-lca')).not.toBeNull()
    // ... and the action is not offered.
    expect(screen.queryByTestId('multi-product-run-uncertainty')).toBeNull()
  })

  it('is PRESENT in Archetypes mode', () => {
    render(<MultiProductLCA />)
    expect(screen.queryByTestId('multi-product-run-uncertainty')).not.toBeNull()
  })
})
