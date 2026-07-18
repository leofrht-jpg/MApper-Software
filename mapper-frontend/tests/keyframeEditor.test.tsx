/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { KeyframeEditor } from '../src/components/parameters/KeyframeEditor'
import type { Parameter } from '../src/api/client'
import type { LeverReferenceMaterial } from '../src/utils/keyframes'

// Recharts renders nothing in jsdom, so chart assertions read the hidden
// `keyframe-trajectory-points` span (chartData length) + component testids.

const scalar: Parameter = { name: 'battery_mass', base_value: 250 }
const timeVaryingParam: Parameter = {
  name: 'battery_mass', base_value: 250,
  keyframes: [{ year: 2025, value: 250 }, { year: 2050, value: 200 }],
}

function yearInputs(c: HTMLElement): HTMLInputElement[] {
  return Array.from(c.querySelectorAll('[data-testid^="keyframe-year-"]')) as HTMLInputElement[]
}

let onPatch: ReturnType<typeof vi.fn>
beforeEach(() => { onPatch = vi.fn() })

describe('KeyframeEditor', () => {
  it('reveals the keyframe editor + seeds 2 rows when time-varying is toggled on', () => {
    const { container, getByTestId } = render(<KeyframeEditor param={scalar} onPatch={onPatch} />)
    expect(yearInputs(container)).toHaveLength(0)
    fireEvent.click(getByTestId('keyframe-timevarying-toggle'))
    expect(yearInputs(container)).toHaveLength(2)
  })

  it('adds a blank keyframe row and deletes a row', () => {
    const { container, getByTestId } = render(<KeyframeEditor param={timeVaryingParam} onPatch={onPatch} />)
    expect(yearInputs(container)).toHaveLength(2)
    fireEvent.click(getByTestId('keyframe-add-row'))
    const rows = yearInputs(container)
    expect(rows).toHaveLength(3)
    expect(rows.some((i) => i.value === '')).toBe(true)
    // Delete the blank row.
    const blank = rows.find((i) => i.value === '')!
    const id = blank.getAttribute('data-testid')!.replace('keyframe-year-', '')
    fireEvent.click(getByTestId(`keyframe-delete-${id}`))
    expect(yearInputs(container)).toHaveLength(2)
  })

  it('re-sorts rows by year after editing a year value', () => {
    const p: Parameter = { name: 'x', base_value: 1, keyframes: [{ year: 2025, value: 1 }, { year: 2040, value: 2 }] }
    const { container } = render(<KeyframeEditor param={p} onPatch={onPatch} />)
    const [first] = yearInputs(container)
    // Edit the earliest (2025) to 2045 → it should sink below 2040.
    fireEvent.change(first, { target: { value: '2045' } })
    expect(yearInputs(container).map((i) => i.value)).toEqual(['2040', '2045'])
  })

  it('disables Save when years duplicate', () => {
    const p: Parameter = { name: 'x', base_value: 1, keyframes: [{ year: 2025, value: 1 }, { year: 2050, value: 2 }] }
    const { container, getByTestId } = render(<KeyframeEditor param={p} onPatch={onPatch} />)
    const [, second] = yearInputs(container)
    fireEvent.change(second, { target: { value: '2025' } })  // duplicate
    expect((getByTestId('keyframe-apply') as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables Save when a year is outside 2025–2050', () => {
    const p: Parameter = { name: 'x', base_value: 1, keyframes: [{ year: 2025, value: 1 }, { year: 2050, value: 2 }] }
    const { container, getByTestId } = render(<KeyframeEditor param={p} onPatch={onPatch} />)
    const [, second] = yearInputs(container)
    fireEvent.change(second, { target: { value: '2099' } })
    expect((getByTestId('keyframe-apply') as HTMLButtonElement).disabled).toBe(true)
  })

  it('saving sends keyframes payload (base_value unchanged)', () => {
    const { getByTestId } = render(<KeyframeEditor param={timeVaryingParam} onPatch={onPatch} />)
    fireEvent.click(getByTestId('keyframe-apply'))
    expect(onPatch).toHaveBeenCalledWith({ keyframes: [{ year: 2025, value: 250 }, { year: 2050, value: 200 }] })
    // No call touched base_value.
    expect(onPatch.mock.calls.every((c) => !('base_value' in c[0]))).toBe(true)
  })

  it('toggling time-varying OFF on a scalar (no committed keyframes) sends keyframes: null', () => {
    const { getByTestId } = render(<KeyframeEditor param={scalar} onPatch={onPatch} />)
    fireEvent.click(getByTestId('keyframe-timevarying-toggle'))  // on
    fireEvent.click(getByTestId('keyframe-timevarying-toggle'))  // off (nothing committed)
    expect(onPatch).toHaveBeenCalledWith({ keyframes: null })
  })

  it('disabling time-varying when committed keyframes exist shows the warning dialog', () => {
    const { getByTestId, queryByTestId } = render(<KeyframeEditor param={timeVaryingParam} onPatch={onPatch} />)
    fireEvent.click(getByTestId('keyframe-timevarying-toggle'))  // off → warn (has committed keyframes)
    expect(getByTestId('keyframe-disable-warning')).toBeTruthy()
    expect(onPatch).not.toHaveBeenCalled()
    fireEvent.click(getByTestId('keyframe-disable-confirm'))
    expect(onPatch).toHaveBeenCalledWith({ keyframes: null })
    expect(queryByTestId('keyframe-disable-warning')).toBeNull()
  })

  it('trajectory preview computes one data point per year 2025–2050', () => {
    const { getByTestId } = render(<KeyframeEditor param={timeVaryingParam} onPatch={onPatch} />)
    expect(getByTestId('keyframe-trajectory-points').textContent).toBe('26')
  })

  // ── p_bp composed-rate preview ──────────────────────────────────────────
  const pbp: Parameter = {
    name: 'p_bp', base_value: 1,
    keyframes: [{ year: 2025, value: 1 }, { year: 2050, value: 0.8 }],
  }
  const tagged: LeverReferenceMaterial[] = [
    { archetypeName: 'BEV-LFP Small', nodeName: 'cells', learningRate: -0.03, baseYear: 2025 },
  ]

  it('p_bp shows the composed-rate section with a tagged material', () => {
    const { getByTestId, queryByTestId } = render(
      <KeyframeEditor param={pbp} onPatch={onPatch} taggedMaterials={tagged} />,
    )
    expect(getByTestId('pbp-composed-rate')).toBeTruthy()
    expect(queryByTestId('pbp-no-tagged')).toBeNull()
    expect(within(getByTestId('pbp-composed-rate')).getByText(/BEV-LFP Small/)).toBeTruthy()
  })

  it('p_bp shows the hint when no tagged material exists', () => {
    const { getByTestId } = render(<KeyframeEditor param={pbp} onPatch={onPatch} taggedMaterials={[]} />)
    expect(getByTestId('pbp-no-tagged')).toBeTruthy()
  })

  it('a non-p_bp parameter never shows the composed-rate section', () => {
    const { queryByTestId } = render(<KeyframeEditor param={timeVaryingParam} onPatch={onPatch} taggedMaterials={tagged} />)
    expect(queryByTestId('pbp-composed-rate')).toBeNull()
  })
})
