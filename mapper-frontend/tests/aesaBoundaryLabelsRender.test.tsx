/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RadarView } from '../src/components/aesa/RadarView'
import { BoundaryGlossary } from '../src/components/aesa/BoundaryGlossary'
import type { BoundarySet, SustainabilityRatioResult } from '../src/api/client'

// The radar is hand-drawn SVG, so unlike the Recharts views it IS observable
// in jsdom — the labels and their <title> elements are real nodes. Geometry
// still isn't (no font metrics); that lives in aesaBoundaryLabels.test.ts.

const SALA: BoundarySet = (() => {
  const json = JSON.parse(readFileSync(
    resolve(process.cwd(), '../mapper-backend/mapper/data/aesa/boundary_sets.json'),
    'utf-8',
  ))
  const set = json.sets.find((s: { id: string }) => s.id === 'Sala2020_EF')
  // Serve the same shape the API does: boundaries keyed by id.
  const bs = set.boundaries
  const list = Array.isArray(bs) ? bs : Object.values(bs)
  return {
    ...set,
    boundaries: Object.fromEntries((list as Array<{ id: string }>).map((b) => [b.id, b])),
  } as BoundarySet
})()

const BOUNDARIES = Object.values(SALA.boundaries) as Array<{
  id: string; name: string; unit: string; conventional_acronym?: string | null
}>

/** One SR row per shipped boundary, as the engine stamps them. */
const ROWS: SustainabilityRatioResult[] = BOUNDARIES.map((b, i) => ({
  year: 2035,
  pb_id: b.id,
  pb_name: b.name,
  pb_short_name: b.name,
  impact: 1,
  allocated_sos: 1,
  sr: 0.5 + i * 0.1,
  zone: 'safe',
} as any))

beforeEach(() => { cleanup() })

describe('the radar labels every category, in full, with no ellipsis', () => {
  it('renders one label per boundary', () => {
    const { container } = render(<RadarView results={ROWS} />)
    for (const b of BOUNDARIES) {
      expect(container.querySelector(`[data-testid="radar-label-${b.id}"]`),
        `${b.name} has no label`).not.toBeNull()
    }
  })

  it('no label text is truncated', () => {
    // The reported symptom: "Ecotoxici… freshwater", "…zone depletion".
    const { container } = render(<RadarView results={ROWS} />)
    for (const b of BOUNDARIES) {
      const node = container.querySelector(`[data-testid="radar-label-${b.id}"]`)!
      expect(node.textContent, `${b.name} rendered truncated`).not.toMatch(/…|\.\.\./)
    }
  })

  it('every word of the category name survives on the axis', () => {
    const { container } = render(<RadarView results={ROWS} />)
    for (const b of BOUNDARIES) {
      const text = container.querySelector(`[data-testid="radar-label-${b.id}"]`)!.textContent ?? ''
      for (const word of b.name.replace(',', '').split(/\s+/)) {
        expect(text, `"${word}" missing from ${b.name}'s label`).toContain(word)
      }
    }
  })

  it('carries the full name in an SVG <title>, so it survives export', () => {
    // Chart export serialises this <svg>; an HTML tooltip would be dropped.
    // The title must be a real child of the <text>, not a wrapper attribute.
    const { container } = render(<RadarView results={ROWS} />)
    for (const b of BOUNDARIES) {
      const node = container.querySelector(`[data-testid="radar-label-${b.id}"]`)!
      const title = node.querySelector('title')
      expect(title, `${b.name} label has no <title>`).not.toBeNull()
      expect(title!.textContent).toBe(b.name)
    }
  })

  it('shows no acronym on any axis', () => {
    // EF defines none, so MApper must not assert one. This is the rendered
    // counterpart to the source-level guard.
    const { container } = render(<RadarView results={ROWS} />)
    const svgText = container.querySelector('svg')!.textContent ?? ''
    for (const b of BOUNDARIES) {
      if (!b.conventional_acronym) continue
      expect(svgText, `${b.conventional_acronym} appears on the chart`)
        .not.toMatch(new RegExp(`(^|\\s)${b.conventional_acronym.replace(/[-]/g, '\\-')}(\\s|$)`))
    }
  })

  it('a row saved before pb_short_name existed still labels itself', () => {
    // Three rows minimum — RadarView renders an explanatory note below that,
    // which is correct behaviour and not what this case is about.
    const legacy = ROWS.slice(0, 3).map((r) => ({ ...r, pb_short_name: undefined })) as any
    const { container } = render(<RadarView results={legacy} />)
    const node = container.querySelector(`[data-testid="radar-label-${ROWS[0].pb_id}"]`)
    expect(node?.textContent).toContain('Climate change')
  })
})

describe('the glossary explains the categories from the boundary records', () => {
  it('lists every boundary in the active set', () => {
    render(<BoundaryGlossary boundarySet={SALA} onClose={() => {}} />)
    for (const b of BOUNDARIES) {
      expect(screen.getByTestId(`glossary-row-${b.id}`)).toBeTruthy()
    }
  })

  it('gives each row its name, unit and conventional acronym', () => {
    render(<BoundaryGlossary boundarySet={SALA} onClose={() => {}} />)
    for (const b of BOUNDARIES) {
      const row = screen.getByTestId(`glossary-row-${b.id}`)
      expect(row.textContent).toContain(b.name)
      expect(row.textContent).toContain(b.unit)
      if (b.conventional_acronym) expect(row.textContent).toContain(b.conventional_acronym)
    }
  })

  it('frames the acronym as convention, not as a MApper label', () => {
    // The wording is the whole point of showing them: the user asked for
    // "commonly written AP", explicitly not adopted as notation.
    render(<BoundaryGlossary boundarySet={SALA} onClose={() => {}} />)
    const body = document.body.textContent ?? ''
    expect(body).toMatch(/commonly written/i)
    expect(body).toMatch(/EF defines no per-category acronyms/i)
  })

  it('renders nothing hardcoded when no set is loaded', () => {
    render(<BoundaryGlossary boundarySet={null} onClose={() => {}} />)
    expect(screen.getByText(/No boundary set loaded/i)).toBeTruthy()
  })

  it('is portalled out of the sidebar stacking context', () => {
    // The AESA sidebar is position: sticky, which traps a modal rendered
    // inside it (Patch 4X) — the delete-session modal shipped unreachable
    // that way.
    const { container } = render(<BoundaryGlossary boundarySet={SALA} onClose={() => {}} />)
    expect(container.querySelector('[data-testid="boundary-glossary"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="boundary-glossary"]')).not.toBeNull()
  })

  it('closes on the close button and on a backdrop click', () => {
    const onClose = vi.fn()
    render(<BoundaryGlossary boundarySet={SALA} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close glossary'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('boundary-glossary'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
