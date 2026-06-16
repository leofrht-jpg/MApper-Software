import { describe, it, expect, beforeEach } from 'vitest'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'

// Patch 4C — view-mode persistence. Both single-product Projected and
// single-product Comparison panels remember the user's last chart/table
// choice across calculations. The two slots are independent so the user
// can leave Projected in chart view and Comparison in table view, or
// vice versa.

describe('useSingleProductImpactStore — view-mode persistence (Patch 4C)', () => {
  beforeEach(() => {
    useSingleProductImpactStore.setState({
      archetypeId: null,
      staticResult: null,
      projectedRuns: [],
      projectedViewMode: 'chart',
      comparisonViewMode: 'chart',
    })
  })

  it('defaults both view modes to chart', () => {
    const s = useSingleProductImpactStore.getState()
    expect(s.projectedViewMode).toBe('chart')
    expect(s.comparisonViewMode).toBe('chart')
  })

  it('stores projected and comparison view mode independently', () => {
    const { setProjectedViewMode, setComparisonViewMode } = useSingleProductImpactStore.getState()

    setProjectedViewMode('table')
    expect(useSingleProductImpactStore.getState().projectedViewMode).toBe('table')
    expect(useSingleProductImpactStore.getState().comparisonViewMode).toBe('chart')

    setComparisonViewMode('table')
    expect(useSingleProductImpactStore.getState().projectedViewMode).toBe('table')
    expect(useSingleProductImpactStore.getState().comparisonViewMode).toBe('table')

    setProjectedViewMode('chart')
    expect(useSingleProductImpactStore.getState().projectedViewMode).toBe('chart')
    expect(useSingleProductImpactStore.getState().comparisonViewMode).toBe('table')
  })

  it('preserves view modes across an archetype change (data clears, view persists)', () => {
    const { setProjectedViewMode, setComparisonViewMode, setArchetypeId, setStaticResult, setProjectedRuns } =
      useSingleProductImpactStore.getState()

    setProjectedViewMode('table')
    setComparisonViewMode('table')
    setArchetypeId('a1')
    setStaticResult({
      archetype_id: 'a1', archetype_name: 'A', scope: 'all', amount: 1,
      stage_amounts: {}, stages_included: [], results: [], elapsed_seconds: 0.1,
    })
    setProjectedRuns([
      { dbName: 'db1', year: 2030, iam: 'remind', ssp: 'ssp2',
        result: { archetype_id: 'a1', archetype_name: 'A', scope: 'all', amount: 1,
          stage_amounts: {}, stages_included: [], results: [], elapsed_seconds: 0.1 } },
    ])

    // Switching archetype clears results but must not touch view modes —
    // the user just paid the cost of picking chart/table once.
    setArchetypeId('a2')
    const s = useSingleProductImpactStore.getState()
    expect(s.staticResult).toBeNull()
    expect(s.projectedRuns).toHaveLength(0)
    expect(s.projectedViewMode).toBe('table')
    expect(s.comparisonViewMode).toBe('table')
  })
})
