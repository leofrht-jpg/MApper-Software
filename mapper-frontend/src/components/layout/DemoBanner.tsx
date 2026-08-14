/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { getDemoStatus } from '../../api/client'
import { useProjectStore } from '../../stores/projectStore'

/**
 * Persistent warning shown whenever the synthetic demo project is active.
 *
 * The demo exists so MApper can be run without an ecoinvent licence, which
 * means every number on screen while it is loaded is fictional. Nothing about
 * a chart or an export distinguishes demo output from a real assessment, so
 * this banner is the only thing preventing a screenshot being mistaken for
 * one. It is deliberately NOT dismissible, and it sits above the content so it
 * appears in screenshots of any page.
 *
 * Re-checks whenever the active project changes, since switching projects is
 * exactly how a user leaves (or enters) the demo.
 */
export function DemoBanner() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    let alive = true
    getDemoStatus()
      .then((s) => { if (alive) setIsDemo(s.is_demo_active) })
      .catch(() => { if (alive) setIsDemo(false) })
    return () => { alive = false }
  }, [currentProject])

  if (!isDemo) return null

  return (
    <div
      role="alert"
      style={{
        gridArea: 'demobanner',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 16px',
        background: 'var(--zone-highrisk-bg, #4a1d1d)',
        borderBottom: '1px solid var(--zone-highrisk, #b91c1c)',
        color: 'var(--text-primary)',
        fontSize: 'var(--text-xs)',
        lineHeight: 1.4,
      }}
    >
      <AlertTriangle size={14} style={{ flexShrink: 0 }} />
      <span>
        <b>Demo project. Synthetic data.</b>{' '}
        Every value shown is fictional and exists only to demonstrate the
        software. This is not an environmental assessment; do not cite or
        publish these results. Switch project to leave the demo.
      </span>
    </div>
  )
}
