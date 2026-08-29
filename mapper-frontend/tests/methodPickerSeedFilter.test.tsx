/* SPDX-License-Identifier: MPL-2.0
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, cleanup, screen } from '@testing-library/react'
import { MethodPicker } from '../src/components/MethodPicker'
import * as client from '../src/api/client'

// A seeded tuple used to be trusted verbatim, including one whose family is not
// installed. It then rode the Single-product handoff into Monte Carlo's
// switch_method, where bw2calc raises a bare KeyError deep inside the worker.
// The seed is now reconciled against the registry -- VISIBLY.

const EFT = ['EF v3.1', 'acidification', 'accumulated exceedance (AE)']
const IWT = ['IMPACT World+ Midpoint', 'climate change', 'GWP100']
const IW: any = { family: 'IMPACT World+ Midpoint', categories: [
  { category: 'climate change', indicators: [{ tuple: IWT }] }] }
const EF: any = { family: 'EF v3.1', categories: [
  { category: 'acidification', indicators: [{ tuple: EFT }] }] }

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }
  vi.restoreAllMocks()
})
afterEach(cleanup)

const last = (spy: any): string[][] => (spy.mock.calls.at(-1)?.[0] ?? []) as string[][]

describe('MethodPicker drops unregistered seeded tuples, visibly', () => {
  it('an unregistered seeded tuple is NOT emitted', async () => {
    vi.spyOn(client, 'getMethods').mockResolvedValue([IW] as any)   // EF absent
    const spy = vi.fn()
    render(<MethodPicker initialSelected={[IWT, EFT]} onChange={spy} />)
    await waitFor(() => expect(last(spy).length).toBe(1))
    expect(last(spy)).toEqual([IWT])
    expect(last(spy).some((t) => t[0] === 'EF v3.1')).toBe(false)
  })

  it('the drop is REPORTED on screen with the count and the tuple', async () => {
    vi.spyOn(client, 'getMethods').mockResolvedValue([IW] as any)
    render(<MethodPicker initialSelected={[IWT, EFT]} onChange={vi.fn()} />)
    const note = await screen.findByTestId('method-picker-dropped-seed')
    expect(note.textContent).toMatch(/1 previously selected indicator/)
    expect(note.textContent).toContain('accumulated exceedance (AE)')
  })

  it('no notice when every seeded tuple is registered', async () => {
    vi.spyOn(client, 'getMethods').mockResolvedValue([EF, IW] as any)
    const spy = vi.fn()
    render(<MethodPicker initialSelected={[IWT, EFT]} onChange={spy} />)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByTestId('method-picker-dropped-seed')).toBeNull()
    expect(last(spy).length).toBe(2)   // both families kept when both installed
  })

  it('a fully-unregistered seed empties the selection rather than passing it on', async () => {
    vi.spyOn(client, 'getMethods').mockResolvedValue([IW] as any)
    const spy = vi.fn()
    render(<MethodPicker initialSelected={[EFT]} onChange={spy} />)
    await waitFor(() => expect(last(spy)).toEqual([]))
    expect(await screen.findByTestId('method-picker-dropped-seed')).toBeTruthy()
  })
})
