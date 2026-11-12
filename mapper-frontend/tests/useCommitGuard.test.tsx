// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * The commit guard: taken synchronously, released only after the render that follows end().
 */
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCommitGuard } from '../src/hooks/useCommitGuard'

describe('useCommitGuard', () => {
  it('begin() takes it once; a second begin() in the same tick is refused', () => {
    const { result } = renderHook(() => useCommitGuard())
    expect(result.current.busy()).toBe(false)
    expect(result.current.begin()).toBe(true)
    expect(result.current.begin()).toBe(false)
    expect(result.current.busy()).toBe(true)
  })

  it('end() does not release it until the render it caused has been committed', async () => {
    const { result } = renderHook(() => useCommitGuard())
    result.current.begin()
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    env.IS_REACT_ACT_ENVIRONMENT = false              // let the update wait for the scheduler
    try {
      result.current.end()
      expect(result.current.busy()).toBe(true)        // still held: nothing has rendered
      expect(result.current.begin()).toBe(false)
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true
    }
    await act(async () => {})                          // the render and its effect
    expect(result.current.busy()).toBe(false)
    expect(result.current.begin()).toBe(true)          // and it can be taken again (a retry)
  })
})
