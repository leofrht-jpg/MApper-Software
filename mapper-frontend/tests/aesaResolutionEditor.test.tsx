/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, fireEvent } from '@testing-library/react'
import { LayerEditModal } from '../src/components/aesa/LayerEditModal'
import type { DownscalingLayer, PrincipleDefinition } from '../src/api/client'

// The per-principle resolution mode was surfaced in the chain editor before it
// was editable anywhere but a workbook import. Showing a setting the UI will
// not let you change is worse than not showing it, so the step/interpolate
// control lives beside the data it governs.
//
// The invariant that matters: only NON-DEFAULT entries are stored. Picking
// "step" CLEARS the entry rather than writing "step" — matching the backend
// validator, which drops an explicit "step" so one behaviour has exactly one
// representation. Two spellings of the default would make round-trip equality
// depend on which one a configuration happened to take.

const PRINCIPLES: PrincipleDefinition[] = [
  { id: 'EpC', name: 'Per capita', description: '' },
  { id: 'AR', name: 'Acquired rights', description: '' },
]

function layer(overrides: Partial<DownscalingLayer> = {}): DownscalingLayer {
  return {
    layer_number: 1, name: 'Global → DK',
    principle_mode: 'category_specific', fixed_principle: null, description: '',
    data: {
      EpC: { 2025: [100, 1000], 2050: [200, 1000] },  // a series
      AR: { 2025: [5, 100] },                          // a constant
    },
    resolution: {},
    ...overrides,
  } as DownscalingLayer
}

function open(l: DownscalingLayer, onSave = vi.fn()) {
  const utils = render(
    <LayerEditModal layer={l} principles={PRINCIPLES} onClose={() => {}} onSave={onSave} />,
  )
  return { ...utils, onSave }
}

describe('the resolution mode is editable where it is shown', () => {
  it('offers step / interpolate for a principle carrying a series', () => {
    const { queryByTestId } = open(layer())
    expect(queryByTestId('resolution-control-EpC')).not.toBeNull()
    expect(queryByTestId('resolution-step-EpC')).not.toBeNull()
    expect(queryByTestId('resolution-interpolate-EpC')).not.toBeNull()
  })

  it('does NOT offer it for a single-value principle', () => {
    // With one anchor the mode cannot change any result; offering it would
    // imply otherwise.
    const { queryByTestId } = open(layer())
    expect(queryByTestId('resolution-control-AR')).toBeNull()
  })

  it('reflects the stored mode', () => {
    const { getByTestId } = open(layer({ resolution: { EpC: 'interpolate' } }))
    // The active option carries the accent border; the inactive one does not.
    const interp = getByTestId('resolution-interpolate-EpC')
    const step = getByTestId('resolution-step-EpC')
    expect(interp.style.border).toContain('var(--mod-aesa)')
    expect(step.style.border).not.toContain('var(--mod-aesa)')
  })

  it('defaults to step when the layer carries no resolution map at all', () => {
    const { getByTestId } = open(layer({ resolution: undefined }))
    expect(getByTestId('resolution-step-EpC').style.border).toContain('var(--mod-aesa)')
  })
})

describe('only non-default entries are stored', () => {
  it('selecting interpolate writes the entry', () => {
    const { getByTestId, onSave } = open(layer())
    fireEvent.click(getByTestId('resolution-interpolate-EpC'))
    fireEvent.click(getByTestId('layer-edit-apply'))
    expect(onSave.mock.calls[0][0].resolution).toEqual({ EpC: 'interpolate' })
  })

  it('selecting step CLEARS the entry rather than writing "step"', () => {
    const { getByTestId, onSave } = open(layer({ resolution: { EpC: 'interpolate' } }))
    fireEvent.click(getByTestId('resolution-step-EpC'))
    fireEvent.click(getByTestId('layer-edit-apply'))
    // Not { EpC: 'step' } — the default has one representation, its absence.
    expect(onSave.mock.calls[0][0].resolution).toEqual({})
  })

  it('leaves other principles\' modes alone', () => {
    const l = layer({
      data: {
        EpC: { 2025: [100, 1000], 2050: [200, 1000] },
        AR: { 2025: [5, 100], 2050: [7, 100] },
      },
      resolution: { AR: 'interpolate' },
    })
    const { getByTestId, onSave } = open(l)
    fireEvent.click(getByTestId('resolution-interpolate-EpC'))
    fireEvent.click(getByTestId('layer-edit-apply'))
    expect(onSave.mock.calls[0][0].resolution).toEqual({
      AR: 'interpolate', EpC: 'interpolate',
    })
  })

  it('round-trips a mode through open → change → change back', () => {
    const { getByTestId, onSave } = open(layer())
    fireEvent.click(getByTestId('resolution-interpolate-EpC'))
    fireEvent.click(getByTestId('resolution-step-EpC'))
    fireEvent.click(getByTestId('layer-edit-apply'))
    expect(onSave.mock.calls[0][0].resolution).toEqual({})
  })

  it('does not disturb the layer data it governs', () => {
    const l = layer()
    const { getByTestId, onSave } = open(l)
    fireEvent.click(getByTestId('resolution-interpolate-EpC'))
    fireEvent.click(getByTestId('layer-edit-apply'))
    expect(onSave.mock.calls[0][0].data).toEqual(l.data)
  })
})

describe('the built-in template no longer gates editing', () => {
  // Inverted deliberately. The layer editor used to be disabled whenever the
  // configuration's sharing snapshot came from the shipped template, which is
  // every fresh configuration — so the chain, principles and assignments were
  // read-only by default and the only way to edit was to duplicate the preset
  // first. That gate is gone with the sharing-preset section; the snapshot
  // belongs to the configuration and is directly editable. (The shipped
  // template is still protected where it matters: PUT/DELETE on
  // /sharing-presets/{id} still 400 for a built-in id.)
  it('the resolution controls are editable', () => {
    const utils = render(
      <LayerEditModal
        layer={layer()} principles={PRINCIPLES}
        onClose={() => {}} onSave={vi.fn()}
      />,
    )
    expect((utils.getByTestId('resolution-step-EpC') as HTMLButtonElement).disabled).toBe(false)
    expect((utils.getByTestId('resolution-interpolate-EpC') as HTMLButtonElement).disabled).toBe(false)
  })

  it('accepts no readOnly prop at all', () => {
    // The prop is removed rather than left permanently false: a dead
    // conditional is an invitation to re-enable the gate by accident.
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/aesa/LayerEditModal.tsx'), 'utf-8')
    expect(src).not.toMatch(/\breadOnly\b/)
  })
})
