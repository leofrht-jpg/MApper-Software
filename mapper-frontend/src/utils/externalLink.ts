// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * External links in the packaged app: which ones may leave, and how.
 *
 * The packaged page is a remote http origin with no Tauri IPC, so a link cannot
 * be handed to the OS from the page. The navigation guard (`navigationGuard.ts`)
 * stops every click that would navigate the app away; for a real click on an
 * https, http or mailto anchor it then calls `openExternal`, which asks the
 * backend (`POST /system/open-external`) to open the URL in the system default
 * handler. One helper serves every anchor, so no link needs its own handler.
 *
 * Only these three schemes may leave. javascript:, file:, data:, blob: and any
 * custom scheme stay blocked, here and again on the backend.
 */
import { openExternalUrl } from '../api/client'

/** The schemes handed to the OS. Nothing else. */
export const EXTERNAL_SCHEMES: readonly string[] = ['https:', 'http:', 'mailto:']

const MAX_SHOWN = 100

function hasWhitespaceOrControl(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 32 || code === 127 || /\s/.test(ch)) return true
  }
  return false
}

/** The URL if it is an https, http or mailto link with a host or address, else null. */
export function allowedExternalUrl(href: string | null | undefined): string | null {
  if (typeof href !== 'string') return null
  const text = href.trim()
  if (!text || hasWhitespaceOrControl(text)) return null
  let url: URL
  try { url = new URL(text) } catch { return null }
  if (!EXTERNAL_SCHEMES.includes(url.protocol)) return null
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) return null
  if (url.protocol === 'mailto:' && !url.pathname) return null
  return url.href
}

/** The URL as shown in a message: the real address, shortened if it is very long. */
export function shownUrl(href: string): string {
  const text = href.trim()
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}...` : text
}

/** Open an allowed link in the system default handler (packaged app). */
export async function openExternal(url: string): Promise<void> {
  const allowed = allowedExternalUrl(url)
  if (!allowed) throw new Error(`Only https, http and mailto links can be opened (${shownUrl(url)}).`)
  await openExternalUrl(allowed)
}
