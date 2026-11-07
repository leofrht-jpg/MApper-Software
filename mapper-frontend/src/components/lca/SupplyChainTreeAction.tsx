/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { Network } from 'lucide-react'
import { Button } from '../ui/Button'
import { ComputeProgress } from '../ui/ComputeProgress'
import { InfoButton } from '../ui/InfoButton'

interface Props {
  /** Prefix of the test ids: 'lca-activity' or 'lca-archetype'. */
  testId: string
  /** Prefix of the control test ids (button, hint, notes). 'lca' keeps the LCA Architect ids;
   *  Impact Assessment passes one per item so several instances on a page stay distinct. */
  idPrefix?: string
  /** A tree request is in flight. The button is disabled meanwhile: one at a time. */
  running: boolean
  /** ANOTHER tree on the page is in flight (Impact Assessment, one button per item). */
  buildDisabled?: boolean
  /** Why the last attempt failed, for this very target and indicator. */
  error: string | null
  /** The previous request was discarded on the client (a recalculation, another indicator). */
  discarded: boolean
  /** The database selected now differs from the one the shown result was calculated with. */
  databaseNote: string | null
  onBuild: () => void
  onDiscard: () => void
}

/**
 * The supply chain tree is a separate, slow request (about 15 s to a minute on a large
 * ecoinvent database), so it is asked for explicitly instead of after every Calculate.
 *
 * "Discard" is deliberately not "Stop": it ends the client's wait and ignores the late
 * response, but the server cannot cancel a running computation. It finishes anyway and
 * holds the compute lock until then, so a new calculation may queue behind it.
 */
export function SupplyChainTreeAction({
  testId, idPrefix = 'lca', running, buildDisabled = false, error, discarded, databaseNote, onBuild, onDiscard,
}: Props) {
  return (
    <div
      data-testid={`${testId}-tree-action`}
      style={{
        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Button
          variant="secondary"
          data-testid={`${idPrefix}-build-tree`}
          disabled={running || buildDisabled}
          onClick={onBuild}
        >
          <Network size={14} />
          {error ? 'Try again' : 'Build supply chain tree'}
        </Button>
        <span data-testid={`${idPrefix}-tree-hint`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Up to a minute on large databases.
        </span>
      </div>

      {running && (
        <ComputeProgress
          active
          label="Building the supply chain tree…"
          bar="none"
          cancelSlot={(
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Button variant="danger" size="sm" data-testid={`${idPrefix}-tree-discard`} onClick={onDiscard}>
                Discard
              </Button>
              <InfoButton label="About discarding" data-testid={`${idPrefix}-tree-discard-info`}>
                <span data-testid={`${idPrefix}-tree-discard-note`}>
                  Discard stops waiting for the result. The server may keep computing until it finishes.
                </span>
              </InfoButton>
            </span>
          )}
          data-testid={`${testId}-contribution-progress`}
        />
      )}

      {!running && discarded && (
        <span data-testid={`${idPrefix}-tree-discarded`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          The previous request was discarded. The server may still be computing it, so the next one can take longer.
        </span>
      )}

      {error && !running && (
        <div role="alert" data-testid={`${idPrefix}-tree-error`} style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
          Contribution analysis failed: {error}
        </div>
      )}

      {databaseNote && (
        <span data-testid={`${idPrefix}-tree-database-note`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          {databaseNote}
        </span>
      )}
    </div>
  )
}
