import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SimulationWarningsPanel, isPerCohortWarning } from '../src/components/dsm/SimulationWarningsPanel'

// Mirror the exact backend formats (dsm_engine.py:1104 advisory; 1458/1433 per-cohort).
const ADVISORY =
  'Total fleet stock drifted to 3,033,756 in 2050 (+9.1% vs 2,781,604 baseline). ' +
  'Verify that Mode A inflows and Mode B stock targets come from a consistent scenario.'
const PER_COHORT_OUTFLOW =
  "Year 2041: manual outflow of 6612 for cohort 'BEV-NCA|Small' exceeds available stock by 3684 — excess ignored."
const PER_COHORT_AGE =
  "Year 2038: requested 1200 outflows at age 7 for cohort 'HEV-LFP|Sedan' but only 800 available."

const WARNINGS = [ADVISORY, PER_COHORT_OUTFLOW, PER_COHORT_OUTFLOW, PER_COHORT_AGE]

describe('SimulationWarningsPanel collapse/expand', () => {
  it('renders the collapse toggle and the count in the header', () => {
    const { getByTestId } = render(<SimulationWarningsPanel warnings={WARNINGS} />)
    const toggle = getByTestId('simulation-warnings-toggle')
    expect(toggle).toBeTruthy()
    expect(toggle.textContent).toContain(`Simulation warnings (${WARNINGS.length})`)
  })

  it('defaults to expanded (body visible)', () => {
    const { getByTestId } = render(<SimulationWarningsPanel warnings={WARNINGS} />)
    const body = getByTestId('simulation-warnings-body')
    expect(body.style.display).not.toBe('none')
    expect(getByTestId('simulation-warnings-toggle').getAttribute('aria-expanded')).toBe('true')
  })

  it('collapsing hides the body but keeps header + count visible', () => {
    const { getByTestId } = render(<SimulationWarningsPanel warnings={WARNINGS} />)
    fireEvent.click(getByTestId('simulation-warnings-toggle'))
    const body = getByTestId('simulation-warnings-body')
    expect(body.style.display).toBe('none')
    // Header + count remain.
    const toggle = getByTestId('simulation-warnings-toggle')
    expect(toggle.textContent).toContain(`Simulation warnings (${WARNINGS.length})`)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('re-expanding shows the body again (visibility-toggle, not remount)', () => {
    const { getByTestId } = render(<SimulationWarningsPanel warnings={WARNINGS} />)
    const toggle = getByTestId('simulation-warnings-toggle')
    const bodyBefore = getByTestId('simulation-warnings-body')
    fireEvent.click(toggle) // collapse
    fireEvent.click(toggle) // expand
    const bodyAfter = getByTestId('simulation-warnings-body')
    // Same DOM node persists across the round-trip — body was hidden, not unmounted.
    expect(bodyAfter).toBe(bodyBefore)
    expect(bodyAfter.style.display).not.toBe('none')
  })

  it('keeps every warning row mounted even while collapsed', () => {
    const { getByTestId } = render(<SimulationWarningsPanel warnings={WARNINGS} />)
    fireEvent.click(getByTestId('simulation-warnings-toggle'))
    const body = getByTestId('simulation-warnings-body')
    // Rows still in the DOM (hidden via the parent's display:none), not removed.
    expect(body.children.length).toBe(WARNINGS.length)
  })

  it('renders nothing when there are no warnings', () => {
    const { queryByTestId } = render(<SimulationWarningsPanel warnings={[]} />)
    expect(queryByTestId('simulation-warnings')).toBeNull()
  })
})

describe('SimulationWarningsPanel advisory vs per-cohort classification', () => {
  it('classifier matches both per-cohort formats and treats the advisory as advisory', () => {
    expect(isPerCohortWarning(PER_COHORT_OUTFLOW)).toBe(true)
    expect(isPerCohortWarning(PER_COHORT_AGE)).toBe(true)
    expect(isPerCohortWarning(ADVISORY)).toBe(false)
    // A non-matching, differently-worded line is advisory (robust to rephrasing).
    expect(isPerCohortWarning('Some future aggregate notice about the run.')).toBe(false)
  })

  it('styles the advisory line in the warning accent and per-cohort lines muted', () => {
    const { getByTestId, getAllByText } = render(<SimulationWarningsPanel warnings={WARNINGS} />)
    const body = getByTestId('simulation-warnings-body')

    const advisory = body.querySelector('[data-warning-kind="advisory"]') as HTMLElement
    const perCohort = body.querySelectorAll('[data-warning-kind="per-cohort"]')

    // Exactly one advisory, the rest per-cohort.
    expect(advisory.textContent).toContain('drifted')
    expect(perCohort.length).toBe(WARNINGS.length - 1)

    // Distinct colors, sourced from theme tokens.
    expect(advisory.style.color).toContain('--warning')
    ;(perCohort as NodeListOf<HTMLElement>).forEach((el) => {
      expect(el.style.color).toContain('--text-secondary')
      expect(el.style.color).not.toBe(advisory.style.color)
    })
    // Sanity: the WARNINGS fixture really did contain the advisory line.
    expect(getAllByText(/Verify that Mode A inflows/).length).toBeGreaterThan(0)
  })
})
