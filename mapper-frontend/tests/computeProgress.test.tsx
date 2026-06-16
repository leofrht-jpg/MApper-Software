import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { act } from 'react'
import { ComputeProgress } from '../src/components/ui/ComputeProgress'

// Patch 5AL — the shared live compute-progress card. Elapsed comes from
// useElapsedSeconds (one source) and renders M:SS via formatElapsed. The bar is
// determinate only from a real pct, else 'none' (no fabricated progress).

afterEach(cleanup)

describe('<ComputeProgress>', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<ComputeProgress label="Computing…" active={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders M:SS elapsed fed by useElapsedSeconds (ticks with fake timers)', () => {
    vi.useFakeTimers()
    try {
      const { getByTestId } = render(
        <ComputeProgress label="Computing…" active data-testid="cp" />,
      )
      // starts at 0:00
      expect(getByTestId('cp-elapsed').textContent).toContain('0:00')
      act(() => { vi.advanceTimersByTime(65_000) })
      // 65s → 1:05 (M:SS via formatElapsed)
      expect(getByTestId('cp-elapsed').textContent).toContain('1:05')
      expect(getByTestId('cp-elapsed').textContent).toContain('elapsed')
    } finally {
      vi.useRealTimers()
    }
  })

  it("bar='none' renders no progress bar", () => {
    const { queryByTestId } = render(
      <ComputeProgress label="Computing…" active bar="none" data-testid="cp" />,
    )
    expect(queryByTestId('cp-bar-determinate')).toBeNull()
    expect(queryByTestId('cp-bar-indeterminate')).toBeNull()
  })

  it("bar='determinate' renders a width from pct + a {pct}% readout", () => {
    const { getByTestId } = render(
      <ComputeProgress label="Running" active bar="determinate" pct={0.42} data-testid="cp" />,
    )
    const barEl = getByTestId('cp-bar-determinate')
    expect(barEl.style.width).toBe('42%')
    expect(getByTestId('cp-elapsed').textContent).toContain('42% ·')
  })

  it("bar='indeterminate' renders the animated bar (no pct readout)", () => {
    const { getByTestId, queryByTestId } = render(
      <ComputeProgress label="Running" active bar="indeterminate" data-testid="cp" />,
    )
    expect(getByTestId('cp-bar-indeterminate')).toBeTruthy()
    expect(queryByTestId('cp-bar-determinate')).toBeNull()
    expect(getByTestId('cp-elapsed').textContent).not.toContain('%')
  })

  it('renders an optional cancel control and invokes onCancel', () => {
    const onCancel = vi.fn()
    const { getByText } = render(
      <ComputeProgress label="Running" active onCancel={onCancel} cancelLabel="Stop" />,
    )
    fireEvent.click(getByText('Stop'))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
