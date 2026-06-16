/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import { ImpactAssessment } from '../src/pages/ImpactAssessment'
import { useDSMStore } from '../src/stores/dsmStore'
import { usePLCAStore } from '../src/stores/plcaStore'
import { useImpactStore } from '../src/stores/impactStore'
import { useBOMStore } from '../src/stores/bomStore'
import { useSingleProductImpactStore } from '../src/stores/singleProductImpactStore'

// Patch 5AA — System-level assessment needs a DSM (the fleet to assess). When
// the project has no DSM, the "run a DSM first" helper replaces the sub-tab
// content; once a DSM exists it yields to the assessment panels. The CTA
// navigates to the Dynamic Stock Modeller tab. Single-product is unaffected.

beforeEach(() => {
  // @ts-expect-error recharts ResizeObserver stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useImpactStore.setState({ staticResult: null, projectedResult: null, projectedMultiResult: null, compareResult: null, staticJob: null, projectedJob: null, error: null } as any)
  usePLCAStore.setState({ databases: [] } as any)
  useBOMStore.setState({ archetypes: [] } as any)
  useSingleProductImpactStore.getState().reset()
})

// No DSM at all (none exists, none active).
const noDSM = () => useDSMStore.setState({ activeSystem: null, systems: [] } as any)
// Patch 5AC — DSMs EXIST but none is selected/active (the reported MAp-test
// state). Helper must still show: an unselected DSM has no fleet to assess.
const dsmsButNoneActive = () => useDSMStore.setState({
  activeSystem: null,
  systems: [{ id: 'sys-1', name: 'Fleet' } as any, { id: 'sys-2', name: 'Wind' } as any],
} as any)
// A DSM is selected/active → assessment panels render.
const withActiveDSM = () => useDSMStore.setState({
  activeSystem: { id: 'sys-1', name: 'Fleet', time_horizon: { start_year: 2020, end_year: 2030 }, dimensions: [] } as any,
  systems: [{ id: 'sys-1', name: 'Fleet' } as any],
  systemState: { scenarios: [{ id: 'b', name: 'Base', is_base: true }], active_scenario_id: 'b' } as any,
} as any)

const goSystemMode = (getByTestId: any) => fireEvent.click(getByTestId('impact-mode-system'))

describe('System-level assessment — DSM-required helper (Patch 5AA → 5AC)', () => {
  it('shows the helper when DSMs EXIST but none is active (gate is activeSystem, not systems.length)', () => {
    dsmsButNoneActive()
    const { getByTestId, queryByTestId } = render(<ImpactAssessment />)
    goSystemMode(getByTestId)
    expect(getByTestId('system-assessment-dsm-required')).toBeInTheDocument()
    expect(queryByTestId('impact-tab-pane-static')).toBeNull()
    // Copy says "Select and run" (DSMs exist to select).
    expect(getByTestId('system-assessment-dsm-required-heading').textContent).toMatch(/^Select and run/)
  })

  it('shows the helper when there are no systems at all ("Create and run")', () => {
    noDSM()
    const { getByTestId, queryByTestId } = render(<ImpactAssessment />)
    goSystemMode(getByTestId)
    expect(getByTestId('system-assessment-dsm-required')).toBeInTheDocument()
    expect(queryByTestId('impact-tab-pane-static')).toBeNull()
    // No DSM to select → "Create and run".
    expect(getByTestId('system-assessment-dsm-required-heading').textContent).toMatch(/^Create and run/)
  })

  it('hides the helper and renders the assessment content once a DSM is ACTIVE/selected', () => {
    withActiveDSM()
    const { getByTestId, queryByTestId } = render(<ImpactAssessment />)
    goSystemMode(getByTestId)
    expect(queryByTestId('system-assessment-dsm-required')).toBeNull()
    expect(getByTestId('impact-tab-pane-static')).toBeInTheDocument()
    expect(getByTestId('impact-tab-pane-projected')).toBeInTheDocument()
  })

  it('CTA navigates to the Dynamic Stock Modeller tab', () => {
    dsmsButNoneActive()
    const onNavigate = vi.fn()
    const { getByTestId } = render(<ImpactAssessment onNavigate={onNavigate} />)
    goSystemMode(getByTestId)
    fireEvent.click(getByTestId('system-assessment-goto-dsm'))
    expect(onNavigate).toHaveBeenCalledWith('dsm')
  })

  it('does not affect single-product assessment (helper is system-mode only)', () => {
    noDSM()
    const { getByTestId, queryByTestId } = render(<ImpactAssessment />)
    // Default mode is single-product → its pane is visible, no DSM helper there.
    const spPane = getByTestId('impact-mode-pane-single-product')
    expect(spPane).toHaveStyle({ display: 'flex' })
    expect(within(spPane).queryByTestId('system-assessment-dsm-required')).toBeNull()
    // The helper lives in the (hidden) system pane, not the single-product one.
    const sysPane = getByTestId('impact-mode-pane-system')
    expect(within(sysPane).getByTestId('system-assessment-dsm-required')).toBeInTheDocument()
  })
})
