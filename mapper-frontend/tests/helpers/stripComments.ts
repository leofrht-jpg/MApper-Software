// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Blank out comments (keeping line numbers) so a source-sweeping guard does
 * not count prose that names the call it forbids. Moved here from
 * projectHeaderEveryRequest.test.ts, now shared with noNativeDialogs.test.ts.
 */
export function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, (m, p) => p + ' '.repeat(m.length - p.length))
}
