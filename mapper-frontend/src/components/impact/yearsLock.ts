/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/** The tooltip on the Years box while it is locked. */
export const YEARS_LOCKED_TOOLTIP = 'Choose a basis for every stage first (per unit or per year). Then you can enter the years.'

/** Moves the keyboard focus to the select with this test id; false when it is not on the screen. */
export function focusSelectByTestId(testId: string): boolean {
  const el = Array.from(document.querySelectorAll<HTMLElement>('select[data-testid]')).find((n) => n.getAttribute('data-testid') === testId)
  if (!el) return false
  el.focus()
  return true
}
