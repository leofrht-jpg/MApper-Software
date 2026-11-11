// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Keeps the app page from being navigated away.
 *
 * MApper is a single page. In the packaged app (a WKWebView on
 * http://localhost:8765) anything that navigates the main frame replaces the
 * whole app, open dialogs included, and there is no back button to recover:
 * the 0.3.2 dev build was seen loading a file WebKit chose to display instead
 * of download, and the window stayed off the app until it was quit. So:
 *
 * - **Clicks** (capture phase, before anything else sees them) on an anchor
 *   whose target is a blob:, data: or file: URL, or another origin, are
 *   cancelled and reported with a toast, UNLESS the anchor carries `download`
 *   and the marker only `downloadBlob` sets. That is how every export saves a
 *   file, so exports keep working; anything else that would follow such a link
 *   is stopped.
 * - **External links.** A REAL user click on an https, http or mailto anchor is
 *   cancelled too, and the URL is opened in the system default handler through
 *   the backend (`externalLink.ts`). A click a script made (not trusted) is only
 *   blocked, and any other scheme stays blocked. The same path serves the
 *   packaged app and `npm run dev`.
 * - **Drag and drop**: a file dropped where no dropzone took it makes the
 *   browser open the file in place. Window listeners cancel dragover/drop only
 *   when nothing earlier did (`defaultPrevented` is false). React handlers run
 *   at the root before the window sees the event, so real dropzones still work.
 * - **beforeunload** logs an unexpected unload, so the next incident leaves a
 *   trace in the console.
 */
import { notify } from '../components/ui/dialogs'
import { DOWNLOAD_MARKER } from './download'
import { allowedExternalUrl, openExternal, shownUrl } from './externalLink'

export const NAVIGATION_BLOCKED = 'Navigation blocked: the page was not changed'

function anchorFor(event: Event): HTMLAnchorElement | SVGAElement | null {
  for (const node of event.composedPath()) {
    if (node instanceof Element && node.tagName.toLowerCase() === 'a' && node.hasAttribute('href')) {
      return node as HTMLAnchorElement | SVGAElement
    }
  }
  return null
}

function hrefOf(a: HTMLAnchorElement | SVGAElement): string {
  if (a instanceof HTMLAnchorElement) return a.href
  const raw = a.getAttribute('href') ?? a.getAttribute('xlink:href') ?? ''
  try { return new URL(raw, document.baseURI).href } catch { return raw }
}

/** What kind of target this is, or null when following it keeps the page. */
export function blockedTargetType(href: string): string | null {
  let url: URL
  try { url = new URL(href, document.baseURI) } catch { return null }
  if (url.protocol === 'blob:') return 'blob: URL'
  if (url.protocol === 'data:') return 'data: URL'
  if (url.protocol === 'file:') return 'file: URL'
  // Always the real URL: an opaque origin (mailto:, javascript:) prints as "null".
  if (url.origin !== window.location.origin) return `external link to ${shownUrl(url.href)}`
  return null
}

function report(type: string): void {
  const message = `${NAVIGATION_BLOCKED} (${type})`
  console.warn(`[mapper] ${message}`)
  try { notify(message, { tone: 'error' }) } catch { /* no dialog host yet */ }
}

export interface GuardOptions {
  /** Whether a click came from the user. Defaults to the browser's `isTrusted`. */
  isUserClick?: (event: MouseEvent) => boolean
}

let isUserClick: (event: MouseEvent) => boolean = (event) => event.isTrusted

function onClick(event: MouseEvent): void {
  const a = anchorFor(event)
  if (!a) return
  const href = hrefOf(a)
  const type = blockedTargetType(href)
  if (!type) return
  if (a.hasAttribute('download') && a.hasAttribute(DOWNLOAD_MARKER)) return
  const external = allowedExternalUrl(href)
  if (external) {
    event.preventDefault()
    if (!isUserClick(event)) { report(type); return }
    openExternal(external).catch((e: unknown) => {
      const reason = e instanceof Error ? e.message : String(e)
      const message = `Could not open the link: ${reason}`
      console.warn(`[mapper] ${message}`)
      try { notify(message, { tone: 'error' }) } catch { /* no dialog host yet */ }
    })
    return
  }
  event.preventDefault()
  report(type)
}

function isFileInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === 'file'
}

function onDragOver(event: DragEvent): void {
  if (event.defaultPrevented || isFileInput(event.target)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

function onDrop(event: DragEvent): void {
  if (event.defaultPrevented || isFileInput(event.target)) return
  event.preventDefault()
}

function onBeforeUnload(): void {
  console.warn('[mapper] the app page is unloading', { href: window.location.href })
}

let uninstall: (() => void) | null = null

/** Install once; a second call returns the same uninstaller. */
export function installNavigationGuard(options: GuardOptions = {}): () => void {
  if (uninstall) return uninstall
  isUserClick = options.isUserClick ?? ((event) => event.isTrusted)
  window.addEventListener('click', onClick, true)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  window.addEventListener('beforeunload', onBeforeUnload)
  uninstall = () => {
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('drop', onDrop)
    window.removeEventListener('beforeunload', onBeforeUnload)
    uninstall = null
  }
  return uninstall
}
