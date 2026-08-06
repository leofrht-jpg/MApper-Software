/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAESAStore } from '../src/stores/aesaStore'
import * as client from '../src/api/client'
import type { AESAConfiguration, AESASession, SharingPreset } from '../src/api/client'

// `loadSession` used to build its draft by hand, ending in
//   sharing: cfg.sharing ?? get().draft?.sharing ?? null as never
//
// `AESAConfiguration.sharing` is optional and nullable; `AESAConfigDraft.sharing`
// is neither. `null as never` asserted that gap away — the same defeat-the-checker
// move as the `as unknown as` that hid the export-settings 422. A snapshot with
// no inline sharing would have put null into a field every consumer dereferences
// (`draft.sharing.chain`, `.built_in`, `.principles`).
//
// It now goes through `draftFromConfig`, the same function the saved-config path
// uses, which migrates a legacy `multi_d` and reports "nothing to build from" by
// returning null instead of fabricating a preset.

const SHARING: SharingPreset = {
  id: 'p1', name: 'Preset', description: '', built_in: false,
  principles: [{ id: 'EpC', name: 'Per capita', description: '' }],
  category_assignments: [],
  chain: { layers: [] },
} as any

const MULTI_D = {
  layer1: {
    climate_change: {
      principle: 'EpC', justification: 'legacy',
      system_value: 5.9e6, global_value: 8.1e9,
    },
  },
  layer2_sector_share: 0.12,
  layer2_source: 'legacy',
} as any

function session(cfg: Partial<AESAConfiguration>): AESASession {
  return {
    id: 'ses-1', name: 'Saved', project: 'p',
    created_at: '2026-05-11T10:00:00Z', modified_at: '2026-05-11T10:00:00Z',
    configuration_snapshot: {
      id: 'cfg-1', name: 'snap', mfa_system_id: 'sys-1',
      impact_mode: 'static', boundary_set_id: 'Sala2020_EF',
      sharing_preset_id: null, carbon_budget: null, method_mapping: [],
      created_at: '2026-05-11T10:00:00Z', dsm_scenario_id: 'base',
      ...cfg,
    } as AESAConfiguration,
    result: { config_id: 'cfg-1', results: [], summary_by_year: [] } as any,
    upstream_ia_task_id: null, displayed_indicators: null,
  }
}

describe('loadSession never puts null in draft.sharing', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAESAStore.setState({
      sessions: [], presets: [SHARING], draft: null, result: null,
      activeSessionId: null, error: null,
    } as any)
  })

  it('uses the snapshot\'s inline sharing when it has one', async () => {
    useAESAStore.setState({ sessions: [session({ sharing: SHARING })] } as any)
    await useAESAStore.getState().loadSession('ses-1')
    expect(useAESAStore.getState().draft?.sharing).toEqual(SHARING)
  })

  it('migrates a legacy multi_d snapshot instead of storing null', async () => {
    // A pre-N-layer configuration: multi_d only, sharing absent. This is the
    // case the old `?? null as never` mishandled.
    useAESAStore.setState({
      sessions: [session({ sharing: null, multi_d: MULTI_D })],
      draft: null, presets: [],
    } as any)
    await useAESAStore.getState().loadSession('ses-1')
    const sharing = useAESAStore.getState().draft?.sharing
    expect(sharing).toBeTruthy()
    expect(Array.isArray(sharing!.chain.layers)).toBe(true)
    expect(sharing!.chain.layers.length).toBeGreaterThan(0)
  })

  it('falls back to the live draft\'s preset when the snapshot has neither', async () => {
    useAESAStore.setState({
      sessions: [session({ sharing: null })],
      draft: {
        name: 'live', boundary_set_id: 'Sala2020_EF', sharing: SHARING,
        sharing_preset_id: null, carbon_budget: null, method_mapping: [],
        impact_mode: 'static', dsm_scenario_id: null,
      },
    } as any)
    await useAESAStore.getState().loadSession('ses-1')
    expect(useAESAStore.getState().draft?.sharing).toEqual(SHARING)
  })

  it('leaves the draft alone rather than nulling it when nothing can build one', async () => {
    // No inline sharing, no multi_d, no live draft, no presets. The saved
    // RESULT still loads — that is what the user opened — but the draft is
    // not filled with a fabricated or null preset.
    useAESAStore.setState({
      sessions: [session({ sharing: null })], draft: null, presets: [],
    } as any)
    await useAESAStore.getState().loadSession('ses-1')
    const s = useAESAStore.getState()
    expect(s.activeSessionId).toBe('ses-1')
    expect(s.result).toBeTruthy()
    expect(s.draft).toBeNull()          // absent, never a null-bearing draft
  })

  it('never yields a draft whose sharing is null or undefined', async () => {
    // The invariant the removed cast was violating, stated directly.
    for (const cfg of [{ sharing: SHARING }, { sharing: null, multi_d: MULTI_D }]) {
      useAESAStore.setState({
        sessions: [session(cfg as any)], draft: null, presets: [SHARING],
      } as any)
      await useAESAStore.getState().loadSession('ses-1')
      const draft = useAESAStore.getState().draft
      expect(draft).not.toBeNull()
      expect(draft!.sharing).not.toBeNull()
      expect(draft!.sharing).not.toBeUndefined()
    }
  })

  it('re-fetches the session list when the id is not cached', async () => {
    // Guards the other branch of loadSession through the same draft path.
    // Note the mocked name: loadSession re-fetches the LIST
    // (`getAESASessions`) and finds the id in it — it does not call
    // `getAESASession(id)`. Mocking the singular would leave the real call
    // to run against the never-settling fetch stub, and the test would hang
    // rather than fail, which is how a wrong mock name usually shows up.
    vi.spyOn(client, 'getAESASessions').mockResolvedValue([session({ sharing: SHARING })])
    useAESAStore.setState({ sessions: [], presets: [SHARING] } as any)
    await useAESAStore.getState().loadSession('ses-1')
    expect(useAESAStore.getState().draft?.sharing).toEqual(SHARING)
  })
})
