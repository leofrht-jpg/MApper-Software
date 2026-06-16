import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOptionSearch, OPTION_SEARCH_THRESHOLD } from '../src/hooks/useOptionSearch'

// Patch 5Y — shared option-search hook (extracted from Patch 5T's FilterDropdown
// inline logic, now also used by Database Explorer's MultiSelectDropdown).
// Lock: threshold gate, client-side substring filter, reset-on-close.

const MANY = ['AE', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'CH', 'DE', 'DK', 'FR', 'IT'] // 12 > 8
const FEW = ['kWh', 'm3']

describe('useOptionSearch (Patch 5Y)', () => {
  it('showSearch gates on the threshold (> 8 options)', () => {
    expect(OPTION_SEARCH_THRESHOLD).toBe(8)
    const long = renderHook(() => useOptionSearch(MANY, true))
    expect(long.result.current.showSearch).toBe(true)
    const short = renderHook(() => useOptionSearch(FEW, true))
    expect(short.result.current.showSearch).toBe(false)
  })

  it('filters visibleOptions by case-insensitive substring; clearing restores all', () => {
    const { result } = renderHook(() => useOptionSearch(MANY, true))
    expect(result.current.visibleOptions).toEqual(MANY)
    act(() => result.current.setQuery('d'))
    expect(result.current.visibleOptions).toEqual(['DE', 'DK'])  // lowercase matches uppercase
    act(() => result.current.setQuery(''))
    expect(result.current.visibleOptions).toEqual(MANY)
  })

  it('resets the query when the dropdown closes (fresh each open)', () => {
    const { result, rerender } = renderHook(({ open }) => useOptionSearch(MANY, open), {
      initialProps: { open: true },
    })
    act(() => result.current.setQuery('dk'))
    expect(result.current.query).toBe('dk')
    act(() => rerender({ open: false }))   // close
    expect(result.current.query).toBe('')  // reset
  })
})
