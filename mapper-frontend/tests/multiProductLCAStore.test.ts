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
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import * as client from '../src/api/client'
import type {
  ArchetypeProductItem, ActivityProductItem,
} from '../src/components/shared/productItem'
import type {
  MultiProductLCAResult, MultiProductRequestItem,
} from '../src/api/client'

// Patch 4AG.3 — useMultiProductLCAStore unit tests.
//
// Coverage:
//   - addItem appends; idempotent on duplicates (keyed by productItemKey)
//   - removeItem removes by key
//   - clearItems empties
//   - compute posts the wire-shape MultiProductRequestItem[] (NOT the
//     UI-side ProductItem with display metadata)
//   - compute sets loading state, populates multiResult on success
//   - compute sets multiError + clears multiResult on top-level fetch failure
//   - Partial success (mixed per-item statuses) populates multiResult AND
//     leaves multiError null — top-level vs per-item error distinction
//   - reset clears everything

const ARCHETYPE_ITEM: ArchetypeProductItem = {
  type: 'archetype',
  archetype_id: 'arc-bev',
  display_name: 'BEV-LFP small',
  folder: 'Passenger cars',
}

const ACTIVITY_ITEM: ActivityProductItem = {
  type: 'activity',
  database: 'ei-3.10',
  code: 'c1',
  amount: 1.0,
  display_name: 'battery, lithium-ion',
  location: 'GLO',
  unit: 'kg',
}

const FAKE_RESULT: MultiProductLCAResult = {
  items: [
    {
      type: 'archetype', item_id: 'arc-bev', label: 'BEV-LFP small',
      status: 'success',
      archetype_result: {
        archetype_id: 'arc-bev', archetype_name: 'BEV-LFP small',
        scope: 'all', amount: 1.0, stage_amounts: {},
        stages_included: ['Manufacturing'],
        results: [{
          method: ['EF v3.1', 'climate change', 'GWP100'],
          method_label: 'EF v3.1 › climate change › GWP100',
          score: 1234.5, unit: 'kg CO2 eq', contributions: [],
        }],
        elapsed_seconds: 0.1,
      } as any,
    },
  ],
  elapsed_seconds: 0.1,
  success_count: 1,
  error_count: 0,
}

beforeEach(() => {
  vi.restoreAllMocks()
  useMultiProductLCAStore.getState().reset()
})

describe('useMultiProductLCAStore — selection state', () => {
  it('addItem appends to selectedItems', () => {
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    useMultiProductLCAStore.getState().addItem(ACTIVITY_ITEM)
    const items = useMultiProductLCAStore.getState().selectedItems
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual(ARCHETYPE_ITEM)
    expect(items[1]).toEqual(ACTIVITY_ITEM)
  })

  it('addItem is idempotent — adding an already-selected item is a no-op', () => {
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    expect(useMultiProductLCAStore.getState().selectedItems).toHaveLength(1)
  })

  it('addItem distinguishes archetype vs activity by namespaced key (no collision)', () => {
    // Theoretical edge case: an archetype with id "ei-3.10|c1" and an
    // activity with the same database|code would have the same string
    // value if keys weren't namespaced. The store uses
    // `productItemKey` which prefixes "arc:" / "act:" — so both
    // coexist.
    const arcWithCollidingId: ArchetypeProductItem = {
      type: 'archetype',
      archetype_id: 'ei-3.10|c1',
      display_name: 'collision test',
    }
    useMultiProductLCAStore.getState().addItem(arcWithCollidingId)
    useMultiProductLCAStore.getState().addItem(ACTIVITY_ITEM)
    expect(useMultiProductLCAStore.getState().selectedItems).toHaveLength(2)
  })

  it('removeItem removes by key', () => {
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    useMultiProductLCAStore.getState().addItem(ACTIVITY_ITEM)
    useMultiProductLCAStore.getState().removeItem(ARCHETYPE_ITEM)
    const items = useMultiProductLCAStore.getState().selectedItems
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual(ACTIVITY_ITEM)
  })

  it('clearItems empties the selection but does NOT touch result/error', () => {
    useMultiProductLCAStore.setState({
      selectedItems: [ARCHETYPE_ITEM],
      multiResult: FAKE_RESULT,
      multiError: null,
    })
    useMultiProductLCAStore.getState().clearItems()
    expect(useMultiProductLCAStore.getState().selectedItems).toEqual([])
    // Result preserved — the user may want to inspect last-run
    // results after clearing their selection to start fresh.
    expect(useMultiProductLCAStore.getState().multiResult).toEqual(FAKE_RESULT)
  })

  it('reset clears everything', () => {
    useMultiProductLCAStore.setState({
      selectedItems: [ARCHETYPE_ITEM],
      multiResult: FAKE_RESULT,
      multiLoading: true,
      multiError: 'something',
    })
    useMultiProductLCAStore.getState().reset()
    const s = useMultiProductLCAStore.getState()
    expect(s.selectedItems).toEqual([])
    expect(s.multiResult).toBeNull()
    expect(s.multiLoading).toBe(false)
    expect(s.multiError).toBeNull()
  })
})

describe('useMultiProductLCAStore — compute wiring', () => {
  it('compute POSTs wire-shape items (NOT UI-side ProductItem with display metadata)', async () => {
    const spy = vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue(FAKE_RESULT)
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    useMultiProductLCAStore.getState().addItem(ACTIVITY_ITEM)
    await useMultiProductLCAStore.getState().compute({
      scope: 'all',
      methods: [['EF v3.1', 'climate change', 'GWP100']],
    })
    expect(spy).toHaveBeenCalledOnce()
    const body = spy.mock.calls[0][0]
    expect(body.scope).toBe('all')
    expect(body.methods).toEqual([['EF v3.1', 'climate change', 'GWP100']])
    expect(body.items).toHaveLength(2)
    // Wire shape is the discriminator + dispatch keys ONLY; display
    // metadata (display_name, folder, location, unit) NOT round-tripped.
    const arcItem = body.items[0] as MultiProductRequestItem & { display_name?: string }
    expect(arcItem.type).toBe('archetype')
    expect((arcItem as any).archetype_id).toBe('arc-bev')
    expect((arcItem as any).display_name).toBeUndefined()
    expect((arcItem as any).folder).toBeUndefined()
    const actItem = body.items[1] as MultiProductRequestItem & { display_name?: string }
    expect(actItem.type).toBe('activity')
    expect((actItem as any).database).toBe('ei-3.10')
    expect((actItem as any).code).toBe('c1')
    expect((actItem as any).amount).toBe(1.0)
    expect((actItem as any).display_name).toBeUndefined()
    expect((actItem as any).location).toBeUndefined()
  })

  it('compute populates multiResult on success and clears loading', async () => {
    vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue(FAKE_RESULT)
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    await useMultiProductLCAStore.getState().compute({
      scope: 'all', methods: [['m']],
    })
    const s = useMultiProductLCAStore.getState()
    expect(s.multiLoading).toBe(false)
    expect(s.multiResult).toEqual(FAKE_RESULT)
    expect(s.multiError).toBeNull()
  })

  it('compute sets multiError on top-level fetch failure; clears multiResult', async () => {
    vi.spyOn(client, 'calculateMultiProductLCA').mockRejectedValue(new Error('Network down'))
    useMultiProductLCAStore.setState({ multiResult: FAKE_RESULT } as any)
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    await useMultiProductLCAStore.getState().compute({
      scope: 'all', methods: [['m']],
    })
    const s = useMultiProductLCAStore.getState()
    expect(s.multiLoading).toBe(false)
    expect(s.multiError).toBe('Network down')
    expect(s.multiResult).toBeNull()
  })

  it('partial success populates multiResult AND leaves multiError null', async () => {
    // Mixed per-item statuses come back as a normal MultiProductLCAResult
    // envelope. The TOP-LEVEL fetch succeeded; per-item errors are
    // signalled via items[i].status="error". multiError is reserved
    // for top-level failures (network, 500, etc.).
    const partial: MultiProductLCAResult = {
      items: [
        { type: 'archetype', item_id: 'arc-1', label: 'OK', status: 'success', archetype_result: FAKE_RESULT.items[0].archetype_result },
        { type: 'archetype', item_id: 'arc-2', label: 'bad', status: 'error', error_message: 'archetype not found' },
      ],
      elapsed_seconds: 0.2,
      success_count: 1,
      error_count: 1,
    }
    vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue(partial)
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    await useMultiProductLCAStore.getState().compute({
      scope: 'all', methods: [['m']],
    })
    const s = useMultiProductLCAStore.getState()
    expect(s.multiError).toBeNull()
    expect(s.multiResult).toEqual(partial)
    expect(s.multiResult?.items[0].status).toBe('success')
    expect(s.multiResult?.items[1].status).toBe('error')
  })

  it('compute refuses to fire with empty selection — multiError set', async () => {
    const spy = vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue(FAKE_RESULT)
    await useMultiProductLCAStore.getState().compute({
      scope: 'all', methods: [['m']],
    })
    expect(spy).not.toHaveBeenCalled()
    expect(useMultiProductLCAStore.getState().multiError).toContain('one item')
  })

  it('compute refuses to fire with empty methods — multiError set', async () => {
    const spy = vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue(FAKE_RESULT)
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    await useMultiProductLCAStore.getState().compute({
      scope: 'all', methods: [],
    })
    expect(spy).not.toHaveBeenCalled()
    expect(useMultiProductLCAStore.getState().multiError).toContain('impact method')
  })

  it('compute threads compute_database through to the wire payload when set', async () => {
    const spy = vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue(FAKE_RESULT)
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    await useMultiProductLCAStore.getState().compute({
      scope: 'all', methods: [['m']],
      computeDatabase: 'ecoinvent-3.10_remind_SSP2_2030',
    })
    const body = spy.mock.calls[0][0]
    expect(body.compute_database).toBe('ecoinvent-3.10_remind_SSP2_2030')
  })

  it('compute clears multiError on retry success', async () => {
    useMultiProductLCAStore.setState({ multiError: 'previous failure' })
    vi.spyOn(client, 'calculateMultiProductLCA').mockResolvedValue(FAKE_RESULT)
    useMultiProductLCAStore.getState().addItem(ARCHETYPE_ITEM)
    await useMultiProductLCAStore.getState().compute({
      scope: 'all', methods: [['m']],
    })
    expect(useMultiProductLCAStore.getState().multiError).toBeNull()
  })
})
