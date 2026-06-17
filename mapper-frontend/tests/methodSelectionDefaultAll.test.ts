/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useMethodSelection } from '../src/components/MethodPicker'
import * as client from '../src/api/client'

// System-level Indicator Selection defaults to ALL categories of the selected
// method (opt-in `defaultAllSelected`), and RE-defaults to all when the method
// changes. Users can still deselect; clearing the current method's selection
// must not be force-reselected.

const FAM_A: any = {
  family: 'Method A',
  categories: [
    { category: 'climate', indicators: [{ tuple: ['A', 'climate change', 'gwp100'] }] },
    { category: 'water', indicators: [
      { tuple: ['A', 'water use', 'aware'] },
      { tuple: ['A', 'acidification', 'ae'] },
    ] },
  ],
}
const FAM_B: any = {
  family: 'Method B',
  categories: [
    { category: 'toxicity', indicators: [
      { tuple: ['B', 'human tox', 'cancer'] },
      { tuple: ['B', 'human tox', 'noncancer'] },
    ] },
  ],
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(client, 'getMethods').mockResolvedValue([FAM_A, FAM_B] as any)
})
afterEach(cleanup)

describe('useMethodSelection — defaultAllSelected (system-level)', () => {
  it('defaults the selection to ALL categories of the initial method', async () => {
    const { result } = renderHook(() => useMethodSelection(() => {}, undefined, true))
    await waitFor(() => expect(result.current.family).toBe('Method A'))
    await waitFor(() => expect(result.current.count).toBe(3))   // all of Method A
    expect(result.current.count).toBe(result.current.totalIndicators)
  })

  it('re-defaults to ALL of the new method on method change', async () => {
    const { result } = renderHook(() => useMethodSelection(() => {}, undefined, true))
    await waitFor(() => expect(result.current.count).toBe(3))
    act(() => result.current.setFamily('Method B'))
    await waitFor(() => expect(result.current.family).toBe('Method B'))
    await waitFor(() => expect(result.current.count).toBe(2))   // all of Method B
    expect(result.current.count).toBe(result.current.totalIndicators)
  })

  it('does not force-reselect after the user clears the current method', async () => {
    const { result } = renderHook(() => useMethodSelection(() => {}, undefined, true))
    await waitFor(() => expect(result.current.count).toBe(3))
    act(() => result.current.clearAll())
    // Stays cleared — the default fired once for this family; clearing is honoured.
    await waitFor(() => expect(result.current.count).toBe(0))
    expect(result.current.count).toBe(0)
  })

  it('without the flag (default off) the selection starts EMPTY', async () => {
    const { result } = renderHook(() => useMethodSelection(() => {}))
    await waitFor(() => expect(result.current.family).toBe('Method A'))
    expect(result.current.count).toBe(0)   // unchanged legacy behaviour
  })
})
