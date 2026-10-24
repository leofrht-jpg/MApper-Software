/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useRef } from 'react'
import type { MouseEvent } from 'react'
import { isDialogOpen } from './dialogs'

/**
 * Props for a modal's backdrop that close it only on a real backdrop click.
 *
 * A browser fires `click` on the nearest common ancestor of the press and the
 * release. A press that starts in a field inside the panel (selecting a letter
 * to fix it) and ends over the backdrop therefore clicks the BACKDROP itself,
 * and `e.target === e.currentTarget` passes: the modal closed mid-edit and lost
 * what was typed. Requiring the press to have started on the backdrop too
 * closes only on a click that was meant for it. While an in-app dialog is open
 * above, the modal never closes from its backdrop.
 */
export function useBackdropDismiss(onClose: () => void) {
  const pressedOnBackdrop = useRef(false)
  return {
    onMouseDown: (e: MouseEvent) => {
      pressedOnBackdrop.current = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent) => {
      const close = pressedOnBackdrop.current && e.target === e.currentTarget && !isDialogOpen()
      pressedOnBackdrop.current = false
      if (close) onClose()
    },
  }
}
