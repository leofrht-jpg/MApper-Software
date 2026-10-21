/* SPDX-License-Identifier: MPL-2.0 */
/**
 * The not-specified note counts INDICATORS (method tuples), not labels.
 * EF v3.1's 25 indicators share 14 last elements, so the note said "14" while
 * the table beside it marked 23.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CoverageGapNote } from '../src/components/authored/CoverageMarkers'

const gap = (cat: string, ind: string) => ({
  method: ['EF v3.1', cat, ind], database: 'auth', code: 'c', activity_name: 'Flare',
  scope_note: null, kind: 'not_reached',
}) as never

describe('CoverageGapNote', () => {
  it('four climate indicators sharing one last element count as four', () => {
    const gaps = [
      gap('climate change', 'global warming potential (GWP100)'),
      gap('climate change: biogenic', 'global warming potential (GWP100)'),
      gap('climate change: fossil', 'global warming potential (GWP100)'),
      gap('climate change: land use and land use change', 'global warming potential (GWP100)'),
      gap('acidification', 'accumulated exceedance (AE)'),
      gap('eutrophication: terrestrial', 'accumulated exceedance (AE)'),
    ]
    const { getByTestId } = render(<CoverageGapNote gaps={gaps} />)
    const t = getByTestId('coverage-gap-note').textContent ?? ''
    expect(t).toContain('Not specified for 6 indicators')
    expect(t).toContain('climate change: fossil')
    expect(t).toContain('eutrophication: terrestrial')
  })
})
