/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MethodPicker } from '../src/components/MethodPicker'
import { SingleProductImpact } from '../src/components/impact/SingleProductImpact'
import { useMultiProductLCAStore } from '../src/stores/multiProductLCAStore'
import { useBOMStore } from '../src/stores/bomStore'
import { useActivityStore } from '../src/stores/activityStore'
import { useProjectStore } from '../src/stores/projectStore'
import * as client from '../src/api/client'
import {
  displayMethod, disambiguatedLabels, indicatorLabel, methodColumns, methodKey, methodPath,
} from '../src/utils/methodLabels'
import { relPosix } from './helpers/relPosix'

// bw2io names the ReCiPe 2016 midpoint (H) and (I) climate indicators "GWP1000" although (H) holds the
// 100-year factors and (I) the 20-year ones. Only what a person READS is corrected. The tuple is the
// method's identity and must come out of every control exactly as it went in. Synthetic tuples only.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  const ResponsiveContainer = ({ children, width = 800, height = 320 }: any) =>
    React.createElement('div', { style: { width, height } }, React.cloneElement(children, { width, height }))
  return { ...actual, ResponsiveContainer }
})

const P = 'global warming potential'
const H = ['ReCiPe 2016 v1.03, midpoint (H)', 'climate change', `${P} (GWP1000)`]
const I = ['ReCiPe 2016 v1.03, midpoint (I)', 'climate change', `${P} (GWP1000)`]
const E = ['ReCiPe 2016 v1.03, midpoint (E)', 'climate change', `${P} (GWP1000)`]
const H_NOLT = ['ReCiPe 2016 v1.03, midpoint (H) no LT', 'climate change no LT', `${P} (GWP1000) no LT`]
const I_NOLT = ['ReCiPe 2016 v1.03, midpoint (I) no LT', 'climate change no LT', `${P} (GWP1000) no LT`]
// a project installed from the ecoinvent LCIA file already carries the right names
const H_OK = ['ReCiPe 2016 v1.03, midpoint (H)', 'climate change', `${P} (GWP100)`]
const I_OK = ['ReCiPe 2016 v1.03, midpoint (I)', 'climate change', `${P} (GWP20)`]
const EF_GWP = ['EF v3.1', 'climate change', `${P} (GWP100)`]

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  vi.restoreAllMocks()
})
afterEach(cleanup)

describe('the helper', () => {
  it.each([
    [H, `${P} (GWP100)`], [I, `${P} (GWP20)`], [E, `${P} (GWP1000)`],
    [H_NOLT, `${P} (GWP100) no LT`], [I_NOLT, `${P} (GWP20) no LT`],
    [H_OK, `${P} (GWP100)`], [I_OK, `${P} (GWP20)`], [EF_GWP, `${P} (GWP100)`],
  ])('reads %j as %s', (t, shown) => {
    expect(indicatorLabel(t)).toBe(shown)
    expect(displayMethod(t).slice(0, -1)).toEqual(t.slice(0, -1))
  })

  it('is idempotent and never mutates the tuple it is given', () => {
    for (const t of [H, I, E, H_NOLT, I_NOLT, H_OK, I_OK, EF_GWP]) {
      const copy = [...t]
      const once = displayMethod(t)
      expect(t).toEqual(copy)
      expect(displayMethod(once)).toEqual(once)
    }
    expect(displayMethod([])).toEqual([])
    expect(indicatorLabel([])).toBe('')
  })

  it('leaves the identity alone: the key is still the raw tuple', () => {
    expect(methodKey(H)).toBe(methodKey([...H]))
    expect(methodKey(displayMethod(H))).not.toBe(methodKey(H))     // so a display tuple must never be used as a key
    const cols = methodColumns([H, I, E])
    expect(cols.map((c) => c.key)).toEqual([methodKey(H), methodKey(I), methodKey(E)])
    expect(cols.map((c) => c.method)).toEqual([H, I, E])           // the stored tuples ride along untouched
  })

  it('tells the three perspectives apart when chosen together', () => {
    const labels = disambiguatedLabels([H, I, E])
    expect(labels.get(methodKey(H))).toBe(`climate change / ${P} (GWP100)`)
    expect(labels.get(methodKey(I))).toBe(`climate change / ${P} (GWP20)`)
    expect(labels.get(methodKey(E))).toBe(`climate change / ${P} (GWP1000)`)
    // and a project with corrected names reads the same
    const ok = disambiguatedLabels([H_OK, I_OK, E])
    expect([...ok.values()]).toEqual([...labels.values()])
  })

  it('shows the corrected indicator in a tooltip path', () => {
    expect(methodPath(I)).toBe(`ReCiPe 2016 v1.03, midpoint (I) › climate change › ${P} (GWP20)`)
  })
})

function family(name: string, tuple: string[]) {
  return { family: name, categories: [{ category: tuple[1], indicators: [{ indicator: tuple[2], tuple }] }] }
}

describe('the method picker', () => {
  it.each([[H, 'GWP100'], [I, 'GWP20'], [E, 'GWP1000'], [H_OK, 'GWP100'], [I_OK, 'GWP20']])(
    'lists %j under its true name and emits the tuple unchanged', async (t, gwp) => {
      vi.spyOn(client, 'getMethods').mockResolvedValue([family(t[0], t)] as any)
      const spy = vi.fn()
      const { container } = render(<MethodPicker initialSelected={[t]} onChange={spy} />)
      await waitFor(() => expect(container.textContent).toContain(`${P} (${gwp})`))
      if (gwp !== 'GWP1000') expect(container.textContent).not.toContain('GWP1000')
      // the selection handed to the caller is the registered tuple, byte for byte
      await waitFor(() => expect(spy).toHaveBeenCalled())
      expect(spy.mock.calls.at(-1)![0]).toEqual([t])
      // the chip's tooltip names the true indicator
      const chip = container.querySelector('[data-testid="method-chip"]') as HTMLElement
      expect(chip.getAttribute('title')).toContain(`(${gwp})`)
    })

  it('ticking an indicator still passes the raw tuple on', async () => {
    vi.spyOn(client, 'getMethods').mockResolvedValue([family(H[0], H)] as any)
    const spy = vi.fn()
    const { container } = render(<MethodPicker onChange={spy} />)
    await waitFor(() => expect(container.querySelector('input[type="checkbox"]')).not.toBeNull())
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    if (!box.checked) fireEvent.click(box)
    await waitFor(() => expect(spy.mock.calls.some((c) => JSON.stringify(c[0]) === JSON.stringify([H]))).toBe(true))
    expect(spy.mock.calls.flatMap((c) => c[0] as string[][]).every((t) => t[2] === H[2])).toBe(true)
  })
})

// ── Multi-item results ───────────────────────────────────────────────────────

describe('multi-item results', () => {
  it('names the three ReCiPe perspectives by their factors, and keys them by the stored tuple', async () => {
    vi.spyOn(client, 'getMethods').mockResolvedValue([] as any)
    useBOMStore.setState({ archetypes: [], fetchArchetypes: vi.fn(async () => {}) } as any)
    useActivityStore.setState({ activities: [], selectedDatabase: 'ei', searchActivities: vi.fn(), setDatabase: vi.fn() } as any)
    useProjectStore.setState({ databases: [{ name: 'ei', size_mb: 1, activity_count: 1 } as any] } as any)
    useMultiProductLCAStore.getState().reset()
    const item: any = {
      type: 'archetype', item_id: 'arc', label: 'Synthetic', status: 'success',
      archetype_result: {
        archetype_id: 'arc', archetype_name: 'Synthetic', scope: 'all', amount: 1, stage_amounts: {}, stages_included: [],
        results: [H, I, E].map((m, i) => ({ method: m, method_label: 'x', score: 1 + i, unit: 'kg CO2-eq', contributions: [] })),
        elapsed_seconds: 0.1, parameter_scenario: 'Base', compute_database: null, warnings: [],
      },
    }
    const base = { items: [item], elapsed_seconds: 0.1, success_count: 1, error_count: 0 }
    useMultiProductLCAStore.setState({ multiResult: base, multiByCase: { Base: base }, multiCaseOrder: ['Base'] } as any)
    const view = render(<SingleProductImpact />)
    fireEvent.click(view.container.querySelector('[data-testid="single-product-mode-multi"]') as HTMLElement)
    const picker = view.container.querySelector('[data-testid="multi-product-method-picker"]') as HTMLSelectElement
    const options = Array.from(picker.options)
    expect(options.map((o) => o.textContent)).toEqual([
      `climate change / ${P} (GWP100)`, `climate change / ${P} (GWP20)`, `climate change / ${P} (GWP1000)`,
    ])
    expect(options.map((o) => o.value)).toEqual([methodKey(H), methodKey(I), methodKey(E)])   // identity untouched
    expect(options[1].title).toContain('(GWP20)')
  })
})

// ── The guard: no render site may print the raw last element or raw tuple again ───────────

describe('no component prints the raw indicator name', () => {
  it('uses indicatorLabel / methodPath / displayMethod, never method[length - 1] or method.join(" › ")', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '../src')
    const bad = /\.method\[[^\]]*length - 1\]|\.method\.join\(' › '\)|\btuple\.join\(' › '\)|\bm\[m\.length - 1\]/
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(e.name)) continue
        if (bad.test(fs.readFileSync(p, 'utf8'))) offenders.push(relPosix(root, p))
      }
    }
    walk(root)
    expect(offenders, 'print the indicator with indicatorLabel(method) and a path with methodPath(method); keys stay methodKey').toEqual([])
  })

  it('the guard would catch a raw print (anti-vacuity)', () => {
    const bad = /\.method\[[^\]]*length - 1\]|\.method\.join\(' › '\)|\btuple\.join\(' › '\)|\bm\[m\.length - 1\]/
    expect(bad.test("const label = r.method[r.method.length - 1] || ''")).toBe(true)
    expect(bad.test("title={r.method.join(' › ')}")).toBe(true)
    expect(bad.test('const label = indicatorLabel(r.method)')).toBe(false)
  })
})
