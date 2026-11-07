/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import React, { useEffect, useState } from 'react'
import { Topbar } from './Topbar'
import { Sidebar } from './Sidebar'
import { DemoBanner } from './DemoBanner'
import { StatusBar } from './StatusBar'
import { NAVIGATE_EVENT } from '../../stores/diagnosticHelpStore'

interface ShellProps {
  children: (activeItem: string, setActiveItem: (id: string) => void) => React.ReactNode
  headerActions?: React.ReactNode
}

export function Shell({ children, headerActions }: ShellProps) {
  const [activeItem, setActiveItem] = useState('databases')

  // A Help link on a warning or error opens its entry in Settings from wherever it is rendered.
  useEffect(() => {
    const go = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (typeof id === 'string') setActiveItem(id)
    }
    window.addEventListener(NAVIGATE_EVENT, go)
    return () => window.removeEventListener(NAVIGATE_EVENT, go)
  }, [])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateAreas: `
          "topbar  topbar"
          "demobanner demobanner"
          "sidebar content"
          "statusbar statusbar"
        `,
        gridTemplateColumns: '56px 1fr',
        // demo banner row is 'auto': zero-height when DemoBanner renders null,
        // so a non-demo project keeps the original layout exactly.
        gridTemplateRows: '48px auto 1fr 24px',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      <Topbar actions={headerActions} />
      <DemoBanner />
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
