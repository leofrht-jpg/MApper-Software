/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { Button } from './ui/Button'
import { loadDemoProject } from '../api/client'
import { useProjectStore } from '../stores/projectStore'

/**
 * One-click entry into the licence-free demo.
 *
 * A new user with no ecoinvent licence lands on an empty Database Explorer and
 * has nothing to do — this is what gives them something to run. Builds a
 * dedicated synthetic Brightway2 project and switches to it; existing projects
 * are untouched.
 *
 * The first call runs bw2setup() (biosphere3 + ~760 LCIA methods), which takes
 * around a minute, hence the explicit pending state.
 */
export function DemoLoadButton({ onLoaded }: { onLoaded?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refreshProjects = useProjectStore((s) => s.fetchProjects)

  const handleClick = async () => {
    setBusy(true)
    setError(null)
    try {
      await loadDemoProject()
      await refreshProjects?.()
      onLoaded?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <Button variant="secondary" onClick={handleClick} disabled={busy}>
        <FlaskConical size={14} />
        {busy ? 'Building demo project…' : 'Load demo project (no licence needed)'}
      </Button>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: 460 }}>
        Creates a separate project with <b>synthetic, fictional</b> data so you can
        try the full DSM → material flows → LCA → AESA workflow without an
        ecoinvent licence. Your own projects are not modified. First run takes about
        10 seconds and ~150 MB of disk.
      </div>
      {error && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--zone-highrisk, #ef4444)' }}>
          Could not build the demo project: {error}
        </div>
      )}
    </div>
  )
}
