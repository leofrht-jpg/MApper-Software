/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { forwardRef, type CSSProperties, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  style?: CSSProperties
  className?: string
}

export const ChartExportContainer = forwardRef<HTMLDivElement, Props>(
  ({ children, style, className }, ref) => {
    return (
      <div ref={ref} className={className} style={{ width: '100%', height: '100%', ...style }}>
        {children}
      </div>
    )
  },
)

ChartExportContainer.displayName = 'ChartExportContainer'
