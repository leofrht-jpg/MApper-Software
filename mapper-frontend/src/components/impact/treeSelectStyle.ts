/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { CSSProperties } from 'react'

/** The select next to a supply chain tree button (indicator, sensitivity case). */
export const treeSelectStyle: CSSProperties = {
  fontSize: 11, padding: '4px 6px', background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)', maxWidth: 320,
}
