/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { MethodPicker } from '../src/components/MethodPicker'
import * as client from '../src/api/client'

// Stage A — the <MethodPicker> COMPONENT must forward `defaultAllSelected` into
// useMethodSelection (it previously dropped it). Hook behaviour itself is locked
// by methodSelectionDefaultAll.test.ts; here we lock the component threading +
// the seed-vs-default reconciliation at the component boundary.

const FAM_A: any = {
  family: 'Method A',
  categories: [
    { category: 'climate', indicators: [{ tuple: ['A', 'climate change', 'gwp100'] }] },
    { category: 'water', indicators: [
      { tuple: ['A', 'water use', 'aware'] },
      { tuple: ['A', 'acidification', 'ae'] },
    ] },
  ],
}

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.restoreAllMocks()
  vi.spyOn(client, 'getMethods').mockResolvedValue([FAM_A] as any)
})
afterEach(cleanup)

function lastSelection(spy: ReturnType<typeof vi.fn>): string[][] {
  return (spy.mock.calls.at(-1)?.[0] ?? []) as string[][]
}

describe('<MethodPicker> forwards defaultAllSelected', () => {
  it('seedless + defaultAllSelected → starts with ALL of the method selected', async () => {
    const onChange = vi.fn()
    render(<MethodPicker onChange={onChange} defaultAllSelected />)
    await waitFor(() => expect(lastSelection(onChange)).toHaveLength(3))  // all of Method A
  })

  it('seeded (initialSelected) + defaultAllSelected → defers to the seed, no override', async () => {
    const onChange = vi.fn()
    const seed = [['A', 'climate change', 'gwp100']]
    render(<MethodPicker onChange={onChange} initialSelected={seed} defaultAllSelected />)
    // Give the load + any effects time to settle, then assert it stayed the seed.
    await waitFor(() => expect(client.getMethods).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    expect(lastSelection(onChange)).toHaveLength(1)  // seed wins, not 3
  })

  it('no flag → starts EMPTY (unchanged legacy behaviour)', async () => {
    const onChange = vi.fn()
    render(<MethodPicker onChange={onChange} />)
    await waitFor(() => expect(client.getMethods).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    expect(lastSelection(onChange)).toHaveLength(0)
  })
})
