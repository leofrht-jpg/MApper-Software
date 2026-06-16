// Patch 5S — common-prefix label shortening for the multi-item comparison
// chart. When all series share a leading activity string (e.g. "electricity,
// low voltage [SSP1 2040]" × N vintages), strip the shared part so the chart
// shows only the differing vintage ("SSP1 2040"), with the shared activity
// shown once as a subtitle. Degrades safely to full labels when there's no
// usable common prefix (e.g. multiple distinct activities, archetype names).
//
// Display-only: this NEVER feeds the export (provenance comes from structured
// vintage meta, not display strings).

export interface ShortenedLabels {
  /** Per-input shortened label (same order/length as input). */
  shortened: string[]
  /** The shared prefix, cleaned of trailing separators/brackets. Empty when
   *  no usable common prefix exists (callers then show no subtitle). */
  shared: string
}

/** Longest common character prefix across the strings. */
function lcp(strings: string[]): string {
  if (strings.length === 0) return ''
  let prefix = strings[0]
  for (const s of strings) {
    let i = 0
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++
    prefix = prefix.slice(0, i)
    if (!prefix) break
  }
  return prefix
}

export function shortenByCommonPrefix(labels: string[]): ShortenedLabels {
  if (labels.length < 2) return { shortened: labels.slice(), shared: '' }

  const common = lcp(labels)
  // Trim the LCP back to a clean token boundary — the LAST space or '[' — so
  // we never cut mid-word (e.g. "…[SSP" → trim to "…[").
  let cut = -1
  for (let i = 0; i < common.length; i++) {
    if (common[i] === ' ' || common[i] === '[') cut = i
  }
  if (cut < 0) return { shortened: labels.slice(), shared: '' }

  const prefix = common.slice(0, cut + 1)  // includes the separator
  // Require a meaningful shared prefix, else don't bother shortening.
  if (prefix.trim().length < 4) return { shortened: labels.slice(), shared: '' }

  const shared = prefix.replace(/[\s[(]+$/, '').trim()
  const shortened = labels.map((l) => {
    const rest = l.slice(prefix.length).replace(/^\[/, '').replace(/\]$/, '').trim()
    return rest || l  // never produce an empty label
  })
  return { shortened, shared }
}
