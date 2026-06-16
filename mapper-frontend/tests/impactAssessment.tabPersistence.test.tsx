import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import { ImpactAssessment } from '../src/pages/ImpactAssessment'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useImpactStore } from '../src/stores/impactStore'

// Regression: Impact Assessment must keep ALL THREE tab panes mounted across
// tab switches. Switching tabs uses a visibility toggle (display: none), NOT
// conditional `{activeTab === 'X' && <Panel />}` mount/unmount. The reflex to
// write the latter silently kills every panel-local `useState` (scope, methods,
// year range, DSM scenario picks, expanded flags, computed-result render
// conditions, etc.) on every tab switch — the bug that motivated this test.
//
// This is the structural guarantee. With it in place, individual panels stay
// free to use `useState` without each selection having to be lifted into a
// global store. See CLAUDE.md → UI conventions → "Tab-based panels in Impact
// Assessment".

beforeEach(() => {
  // ResizeObserver — recharts ResponsiveContainer uses it.
  // @ts-expect-error — minimal stub
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // Reset store slots that gate tab visibility & panel content.
  useImpactStore.setState({
    staticResult: null,
    projectedResult: null,
    projectedMultiResult: null,
    compareResult: null,
    staticJob: null,
    projectedJob: null,
    error: null,
  })
  useDSMStore.setState({
    activeSystem: {
      id: 'sys-test',
      name: 'Test System',
      time_horizon: { start_year: 2020, end_year: 2030 },
      dimensions: [],
    },
    systemState: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scenarios: [{ id: 'base-1', name: 'Base', is_base: true } as any],
      active_scenario_id: 'base-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  })
  usePLCAStore.setState({
    databases: [{
      name: 'ei310-remind-ssp2-2030',
      base_db: 'ecoinvent-3.10-cutoff',
      iam: 'remind',
      ssp: 'SSP2-PkBudg1150',
      year: 2030,
      years: [2030],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: 'separate' as any,
      created_at: '2026-01-01',
    }],
  })
})

describe('ImpactAssessment — tab pane persistence (visibility toggle)', () => {
  it('mounts all panes simultaneously and never unmounts on tab switch', () => {
    const { getByTestId } = render(<ImpactAssessment />)
    // Scope tab clicks to the system-mode pane. With the Patch 3 mode toggle,
    // the single-product subtree mounts a sibling tab bar with the same
    // labels — getByText('Prospective Background') would now collide.
    const systemPane = getByTestId('impact-mode-pane-system')
    const sysQ = within(systemPane)

    // All three pane wrappers exist regardless of activeTab. Compare pane is
    // present (gated visibility), but ComparisonPanel itself only renders
    // inside it when canCompare flips true — that's a separate concern from
    // the structural guarantee we're locking in here.
    const staticPane = getByTestId('impact-tab-pane-static')
    const projectedPane = getByTestId('impact-tab-pane-projected')
    const comparePane = getByTestId('impact-tab-pane-compare')
    expect(staticPane).toBeInTheDocument()
    expect(projectedPane).toBeInTheDocument()
    expect(comparePane).toBeInTheDocument()

    // Initial: Static visible, others hidden.
    expect(staticPane).toHaveStyle({ display: 'block' })
    expect(projectedPane).toHaveStyle({ display: 'none' })
    expect(comparePane).toHaveStyle({ display: 'none' })

    // Switch to Projected. All three panes still in DOM; only the visibility
    // flag flips. If any pane disappears, conditional rendering snuck back in.
    fireEvent.click(sysQ.getByText('Prospective Background'))
    expect(getByTestId('impact-tab-pane-static')).toBeInTheDocument()
    expect(getByTestId('impact-tab-pane-projected')).toBeInTheDocument()
    expect(getByTestId('impact-tab-pane-compare')).toBeInTheDocument()
    expect(getByTestId('impact-tab-pane-static')).toHaveStyle({ display: 'none' })
    expect(getByTestId('impact-tab-pane-projected')).toHaveStyle({ display: 'block' })

    // Switch back to Static. Same identity — pane is the same node, never
    // unmounted, so its child <DSMImpactPanel> kept its useState.
    fireEvent.click(sysQ.getByText('Static Background'))
    expect(getByTestId('impact-tab-pane-static')).toBe(staticPane)
    expect(getByTestId('impact-tab-pane-projected')).toBe(projectedPane)
    expect(getByTestId('impact-tab-pane-compare')).toBe(comparePane)
  })
})
