// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * "One at a time" for a commit that Enter and a blur can both start.
 *
 * An inline editor commits on Enter, saving disables the field, and an engine may blur a field that
 * becomes disabled, so the commit can start twice. State is too slow to stop it (Enter and the blur
 * arrive before React re-renders), so the guard is a ref: `begin()` takes it synchronously.
 *
 * `end()` does NOT release it at once. A blur can still arrive between the end of the save and the
 * render that closes the editor, and the handler it reaches is the old one, which would commit the
 * same value again (seen on jsdom 31 under load: the rename API was called twice). So `end()` asks
 * for a render and an effect releases the guard once that render has been committed, when the
 * handlers are current and the editor is gone, or open again after a failure.
 */
export function useCommitGuard() {
  const taken = useRef(false)
  const [released, setReleased] = useState(0)

  // Runs after the render that `end()` caused (and once on mount, where it changes nothing).
  useEffect(() => { taken.current = false }, [released])

  /** Take the guard; false when a commit is already in progress. */
  const begin = useCallback(() => {
    if (taken.current) return false
    taken.current = true
    return true
  }, [])

  /** Whether a commit is in progress. */
  const busy = useCallback(() => taken.current, [])

  /** The commit is over, successfully or not. Call from `finally`. */
  const end = useCallback(() => setReleased((n) => n + 1), [])

  return { begin, busy, end }
}
