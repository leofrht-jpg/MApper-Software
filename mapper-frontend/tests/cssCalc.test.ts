// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * The calc() comparison helper used where jsdom 30 and 31 spell a sum differently.
 * It must treat the two spellings as equal and still tell a wrong value apart.
 */
import { describe, expect, it } from 'vitest'
import { normalizeCalc } from './helpers/cssCalc'

describe('normalizeCalc', () => {
  it('jsdom 30 and jsdom 31 spell the same height the same way after normalising', () => {
    expect(normalizeCalc('calc(-96px + 100vh)')).toBe(normalizeCalc('calc(100vh - 96px)'))
  })

  it('a wrong amount, unit, sign or kind of height is still different', () => {
    const want = normalizeCalc('calc(100vh - 96px)')
    expect(normalizeCalc('calc(100vh - 95px)')).not.toBe(want)
    expect(normalizeCalc('calc(100vh + 96px)')).not.toBe(want)
    expect(normalizeCalc('calc(100vw - 96px)')).not.toBe(want)
    expect(normalizeCalc('calc(100% - 96px)')).not.toBe(want)
    expect(normalizeCalc('100vh')).not.toBe(want)
    expect(normalizeCalc('')).not.toBe(want)
  })

  it('handles decimals, three terms and spacing', () => {
    expect(normalizeCalc('calc( 100vh  -  1.5rem + 2px )')).toBe(normalizeCalc('calc(2px + 100vh - 1.5rem)'))
  })

  it('anything that is not a plain sum is returned unchanged', () => {
    expect(normalizeCalc('calc(100vh * 2)')).toBe('calc(100vh * 2)')
    expect(normalizeCalc('calc(100vh - calc(2px + 3px))')).toBe('calc(100vh - calc(2px + 3px))')
    expect(normalizeCalc('auto')).toBe('auto')
  })
})
