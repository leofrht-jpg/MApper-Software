import { useEffect, useMemo, useRef, useState } from 'react'

// Patch 5Y — shared client-side option-search for filter dropdowns
// (FilterDropdown in MultiItemSelector + Database Explorer's
// MultiSelectDropdown). Extracted from Patch 5T's inline FilterDropdown logic
// so the two dropdowns share ONE implementation (no drift).
//
// View-only: it filters the in-memory `options` for DISPLAY only. It never
// triggers a backend call and never touches the dropdown's selection — a
// checked option filtered out of view stays selected and reappears checked
// once the search clears (selection lives in the dropdown's own state).

// Show the in-dropdown search only when the list is long enough to be worth
// scanning. Short lists (e.g. a handful of units) stay clean.
export const OPTION_SEARCH_THRESHOLD = 8

export interface OptionSearch {
  /** Current raw query text. */
  query: string
  setQuery: (q: string) => void
  /** Attach to the search <input> for autofocus-on-open. */
  searchRef: React.RefObject<HTMLInputElement | null>
  /** Render the search input only when this is true (threshold-gated). */
  showSearch: boolean
  /** Options to render — filtered by case-insensitive substring when querying. */
  visibleOptions: string[]
}

/**
 * @param options  the full in-memory option set
 * @param open     whether the dropdown is open (drives autofocus + reset)
 * @param threshold show the search only when options.length exceeds this
 */
export function useOptionSearch(
  options: string[],
  open: boolean,
  threshold: number = OPTION_SEARCH_THRESHOLD,
): OptionSearch {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const showSearch = options.length > threshold

  // Autofocus the search on open; reset the text on close (fresh each open).
  useEffect(() => {
    if (open) {
      if (showSearch) searchRef.current?.focus()
    } else {
      setQuery('')
    }
  }, [open, showSearch])

  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options
  }, [options, query])

  return { query, setQuery, searchRef, showSearch, visibleOptions }
}
