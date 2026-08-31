// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

import { relative, sep } from 'node:path'

/**
 * Project-relative path, ALWAYS posix — the only way a source-sweeping guard
 * should build a path.
 *
 * `node:path`'s `relative()` yields `components\\impact\\Foo.tsx` on Windows.
 * Every guard in this suite compares that against a posix-keyed ALLOWED map,
 * so on Windows nothing matches and the guard reports its own exemptions as
 * offenders — the WHOLE TREE, not one file. The failure is maximally
 * confusing precisely because it is total.
 *
 * There is no Windows job in the frontend CI, so nothing here will ever catch
 * it for us: a Windows contributor running `npm test` is the first to find
 * out. The backend hit the identical bug in its package-walk guard, where CI
 * did catch it.
 *
 * Shared rather than copied because this had already been written three times
 * — correctly once, and wrongly twice.
 */
export function relPosix(from: string, file: string): string {
  return relative(from, file).split(sep).join('/')
}
