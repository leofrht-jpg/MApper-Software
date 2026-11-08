/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/** The one neutral line shown after "Stop waiting": not an error, so not a <Diagnostic>. */
export function StoppedNotice({ 'data-testid': testId = 'calc-stopped' }: { 'data-testid'?: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}
    >
      Stopped. No result was applied.
    </div>
  )
}
