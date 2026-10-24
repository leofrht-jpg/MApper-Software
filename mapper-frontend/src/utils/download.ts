// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * The one way the app saves a file from the browser side.
 *
 * Every export used to build its own `<a href="blob:…" download>` and click it.
 * The navigation guard (`navigationGuard.ts`) cancels any click on a blob:,
 * data: or file: anchor, because following one replaces the app page; it lets
 * through only anchors carrying {@link DOWNLOAD_MARKER}, which only this helper
 * sets. So an export that bypasses the helper is blocked, loudly, instead of
 * risking the page.
 *
 * The anchor is appended to the document before the click: a detached anchor's
 * click never reaches window listeners, so the guard could not see it.
 */
export const DOWNLOAD_MARKER = 'data-mapper-download'

export function downloadBlob(blob: Blob, filename: string, opts: { revokeDelayMs?: number } = {}): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.setAttribute(DOWNLOAD_MARKER, '')
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  const revoke = () => { try { URL.revokeObjectURL(url) } catch { /* already gone */ } }
  if (opts.revokeDelayMs) setTimeout(revoke, opts.revokeDelayMs)
  else revoke()
}
