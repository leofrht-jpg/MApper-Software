/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { materialDisplayLabel, materialDisplayString } from '../src/utils/dsmCohortColors'
import { truncateLabel, TruncatedAxisTick } from '../src/components/charts/TruncatedAxisTick'

/**
 * "Material contribution (YEAR)" chart labels. When a subsystem is linked, the
 * backend prefixes material keys with the SUBSYSTEM/SYSTEM id
 * (`dsm_lca_engine.aggregate_subsystem_results` → `_prefix_key`), identical in
 * shape to cohort keys. The raw UUID must never reach the user; dependent-
 * subsystem materials are disambiguated by the subsystem name (bars are
 * per-(subsystem, material)).
 */

const SYSTEM_ID = '667f6ecd-08bf-4a1e-9c2d-000000000000'
const SUBSYSTEMS = [{ id: 'sub-fuel', name: 'Fueling Infrastructure' }]

describe('materialDisplayLabel — strips the UUID, disambiguates by subsystem', () => {
  it('a material key "<uuid>::Steel frame" renders WITHOUT the UUID', () => {
    const d = materialDisplayLabel(`${SYSTEM_ID}::Steel frame`, { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })
    expect(d.label).toBe('Steel frame')
    expect(JSON.stringify(d)).not.toContain('667f6ecd')
  })

  it('primary-system material → material name alone (no suffix)', () => {
    const d = materialDisplayLabel(`${SYSTEM_ID}::Cathode active material (LFP)`, { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })
    expect(d).toEqual({ label: 'Cathode active material (LFP)', subsystem: null })
  })

  it('Case A: a DEPENDENT subsystem material carries the resolved subsystem name', () => {
    const d = materialDisplayLabel('sub-fuel::Nozzle', { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })
    expect(d).toEqual({ label: 'Nozzle', subsystem: 'Fueling Infrastructure' })
    expect(materialDisplayString('sub-fuel::Nozzle', { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS }))
      .toBe('Nozzle · Fueling Infrastructure')
  })

  it('an UNRESOLVABLE id falls back to the material name alone — never the raw key', () => {
    const key = 'deadbeef-0000-0000-0000-000000000000::Petrol consumption (annual)'
    const d = materialDisplayLabel(key, { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })
    expect(d).toEqual({ label: 'Petrol consumption (annual)', subsystem: null })
    expect(materialDisplayString(key, { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })).toBe('Petrol consumption (annual)')
    expect(materialDisplayString(key, { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })).not.toContain('deadbeef')
    expect(materialDisplayString(key, { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })).not.toContain('::')
  })

  it('no-prefix key (no subsystems present) is returned as-is', () => {
    expect(materialDisplayString('Steel frame', {})).toBe('Steel frame')
    expect(materialDisplayLabel('Steel frame', {})).toEqual({ label: 'Steel frame', subsystem: null })
  })

  it('same material name under primary vs dependent produces DISTINCT labels (no ambiguous duplicates)', () => {
    const primary = materialDisplayString(`${SYSTEM_ID}::Steel frame`, { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })
    const dependent = materialDisplayString('sub-fuel::Steel frame', { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })
    expect(primary).toBe('Steel frame')
    expect(dependent).toBe('Steel frame · Fueling Infrastructure')
    expect(primary).not.toBe(dependent)
  })
})

describe('truncateLabel', () => {
  it('leaves short labels unchanged', () => {
    expect(truncateLabel('Steel frame', 28)).toBe('Steel frame')
  })
  it('truncates long labels with a trailing ellipsis', () => {
    const out = truncateLabel('Cathode active material (LFP) · BEV-NMC811 extra long', 28)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(28)
    expect(out).not.toContain('::')
  })
})

describe('TruncatedAxisTick — renders REAL SVG text for native-SVG export', () => {
  const format = (raw: string) => materialDisplayString(raw, { systemId: SYSTEM_ID, subsystems: SUBSYSTEMS })

  it('renders the cleaned label as SVG <text> (what the chart export serializes), no UUID', () => {
    const { container } = render(
      <svg>
        <TruncatedAxisTick x={100} y={20} payload={{ value: `${SYSTEM_ID}::Steel frame` }} format={format} />
      </svg>,
    )
    const text = container.querySelector('text')
    expect(text).not.toBeNull()
    expect(text?.textContent).toContain('Steel frame')
    expect(container.innerHTML).not.toContain('667f6ecd')
  })

  it('a long label truncates in the tick but keeps the FULL cleaned label in an SVG <title> (hover)', () => {
    const longKey = 'sub-fuel::Cathode active material (LFP) with a very long descriptive name'
    const { container } = render(
      <svg>
        <TruncatedAxisTick x={100} y={20} payload={{ value: longKey }} format={format} max={20} />
      </svg>,
    )
    const title = container.querySelector('title')
    // Full cleaned label (material · subsystem) preserved in <title>.
    expect(title?.textContent).toBe('Cathode active material (LFP) with a very long descriptive name · Fueling Infrastructure')
    // Visible tick text is truncated with an ellipsis.
    const text = container.querySelector('text')
    expect(text?.textContent?.endsWith('…')).toBe(true)
    expect(container.innerHTML).not.toContain('sub-fuel::')
  })
})
