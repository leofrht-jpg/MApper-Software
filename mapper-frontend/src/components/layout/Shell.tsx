/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import React, { useState } from 'react'
import { Topbar } from './Topbar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'

interface ShellProps {
  children: (activeItem: string, setActiveItem: (id: string) => void) => React.ReactNode
  headerActions?: React.ReactNode
}

export function Shell({ children, headerActions }: ShellProps) {
  const [activeItem, setActiveItem] = useState('databases')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateAreas: `
          "topbar  topbar"
          "sidebar content"
          "statusbar statusbar"
        `,
        gridTemplateColumns: '56px 1fr',
        gridTemplateRows: '48px 1fr 24px',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      <Topbar actions={headerActions} />
      <Sidebar activeItem={activeItem} onItemClick={setActiveItem} />
      <main
        style={{
          gridArea: 'content',
          backgroundColor: 'var(--bg-root)',
          padding: 'var(--space-6)',
          overflow: 'auto',
        }}
      >
        {children(activeItem, setActiveItem)}
      </main>
      <StatusBar />
    </div>
  )
}
