/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { create } from 'zustand'

/** The window event the app shell listens to, to switch the open page. */
export const NAVIGATE_EVENT = 'mapper-navigate'

interface DiagnosticHelpStore {
  /** The code whose Settings entry should be opened, until the Settings page has consumed it. */
  target: string | null
  /** Open Settings at the entry for `code`. */
  requestHelp: (code: string) => void
  consume: () => void
}

export const useDiagnosticHelpStore = create<DiagnosticHelpStore>((set) => ({
  target: null,
  requestHelp: (code) => {
    set({ target: code })
    window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: 'settings' }))
  },
  consume: () => set({ target: null }),
}))
