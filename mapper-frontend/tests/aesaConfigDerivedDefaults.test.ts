/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A configuration must not persist a copy of a default it never diverged from.
 *
 * `sharing` and `method_mapping` both resolve live when absent — the backend
 * falls through to `build_default_sharing_preset()` and auto-suggests an empty
 * mapping, and the sidebar's auto-suggest effect fires on an empty one. Saving
 * an untouched copy of them is what froze existing configurations against a
 * later methodology fix (acidification EpC → AGR, the Patch 4W mapping): an old
 * config computed one way and a fresh one the other, with nothing on screen to
 * say why.
 *
 * So the save payload carries them ONLY when the user authored them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAESAStore } from '../src/stores/aesaStore'
import * as client from '../src/api/client'

const PRESET: any = {
  id: 'ferhati_2026_multi_d', name: 'Multi-D allocation (default)', built_in: true,
  principles: [{ id: 'AR', name: 'Acquired Rights', description: '' }],
  category_assignments: [{ pb_id: 'acidification', principle_id: 'AGR', justification: '' }],
  chain: { layers: [{ layer_number: 1, name: 'L1', principle_mode: 'category_specific', data: {}, resolution: {}, sources: {} }] },
}
const DEFAULTS: any = {
  boundary_sets: [], multi_d_defaults: [], sharing_data: {}, ssp_trajectories: [],
  carbon_budget_options: [], default_multi_d: null, default_carbon_budget: null,
}
const MAPPING: any = [{ method_tuple: ['EF v3.1', 'climate change', 'x'], pb_id: 'climate_change', conversion_factor: 1 }]

function seedFreshDraft() {
  useAESAStore.setState({ defaults: DEFAULTS, presets: [PRESET] } as any)
  useAESAStore.getState().resetDraftToDefaults()
}

let created: any = null

beforeEach(() => {
  created = null
  vi.restoreAllMocks()
  vi.spyOn(client, 'createAESAConfiguration').mockImplementation(async (body: any) => {
    created = body
    return { ...body, id: 'new-1', created_at: 'now' }
  })
  useAESAStore.setState({ configurations: [], activeConfigId: null } as any)
  seedFreshDraft()
})

describe('a fresh configuration follows the defaults', () => {
  it('starts un-customized', () => {
    const d = useAESAStore.getState().draft!
    expect(d.sharingCustomized).toBe(false)
    expect(d.mappingCustomized).toBe(false)
  })

  it('is saved with no sharing snapshot and no mapping', async () => {
    await useAESAStore.getState().saveConfig('sys-1')
    expect(created).not.toBeNull()
    expect(created.sharing).toBeNull()
    expect(created.method_mapping).toEqual([])
  })

  it('still keeps the draft usable on screen — only the PAYLOAD is trimmed', async () => {
    const before = useAESAStore.getState().draft!.sharing
    await useAESAStore.getState().saveConfig('sys-1')
    expect(useAESAStore.getState().draft!.sharing).toEqual(before)
  })
})

describe('an auto-suggested mapping is derivation, not authorship', () => {
  it('suggestMapping does not mark the draft customized', async () => {
    vi.spyOn(client, 'suggestAESAMethodMapping').mockResolvedValue(MAPPING)
    await useAESAStore.getState().suggestMapping([['EF v3.1', 'climate change', 'x']])
    expect(useAESAStore.getState().draft!.method_mapping).toHaveLength(1)
    expect(useAESAStore.getState().draft!.mappingCustomized).toBe(false)

    await useAESAStore.getState().saveConfig('sys-1')
    expect(created.method_mapping).toEqual([])
  })
})

describe('authorship is persisted', () => {
  it('editing the sharing chain marks it customized and saves it', async () => {
    useAESAStore.getState().updateSharing({ name: 'MY CHAIN' } as any)
    expect(useAESAStore.getState().draft!.sharingCustomized).toBe(true)

    await useAESAStore.getState().saveConfig('sys-1')
    expect(created.sharing).not.toBeNull()
    expect(created.sharing.name).toBe('MY CHAIN')
  })

  it('editing a category assignment marks it customized', () => {
    useAESAStore.getState().updateAssignment('acidification', 'EpC', 'because')
    expect(useAESAStore.getState().draft!.sharingCustomized).toBe(true)
  })

  it('applying an AESACFG workbook marks both customized', async () => {
    // The workbook is the ONLY authoring path for the mapping — the in-app
    // table is read-only by design — and it comes through updateDraft.
    useAESAStore.getState().updateDraft({ sharing: PRESET, method_mapping: MAPPING } as any)
    const d = useAESAStore.getState().draft!
    expect(d.sharingCustomized).toBe(true)
    expect(d.mappingCustomized).toBe(true)

    await useAESAStore.getState().saveConfig('sys-1')
    expect(created.sharing).not.toBeNull()
    expect(created.method_mapping).toEqual(MAPPING)
  })

  it('an unrelated updateDraft does not mark anything customized', () => {
    useAESAStore.getState().updateDraft({ impact_mode: 'projected' })
    const d = useAESAStore.getState().draft!
    expect(d.sharingCustomized).toBe(false)
    expect(d.mappingCustomized).toBe(false)
  })
})

describe('a config that survived the storage migration is authored', () => {
  it('a stored sharing snapshot round-trips as customized', () => {
    useAESAStore.setState({
      configurations: [{
        id: 'c1', name: 'saved', mfa_system_id: 'sys-1', impact_mode: 'static',
        boundary_set_id: 'Sala2020_EF', sharing: PRESET, sharing_preset_id: null,
        carbon_budget: null, method_mapping: MAPPING, created_at: 'now',
      }] as any,
    })
    useAESAStore.getState().setActiveConfig('c1')
    const d = useAESAStore.getState().draft!
    expect(d.sharingCustomized).toBe(true)
    expect(d.mappingCustomized).toBe(true)
  })

  it('a migrated config (no sharing, no mapping) is NOT customized', () => {
    useAESAStore.setState({
      configurations: [{
        id: 'c2', name: 'migrated', mfa_system_id: 'sys-1', impact_mode: 'static',
        boundary_set_id: 'Sala2020_EF', sharing: null, sharing_preset_id: null,
        carbon_budget: null, method_mapping: [], created_at: 'now',
      }] as any,
    })
    useAESAStore.getState().setActiveConfig('c2')
    const d = useAESAStore.getState().draft!
    expect(d.sharingCustomized).toBe(false)
    expect(d.mappingCustomized).toBe(false)
    // and it renders against the built-in preset, not an empty one
    expect(d.sharing.category_assignments[0].principle_id).toBe('AGR')
  })
})
