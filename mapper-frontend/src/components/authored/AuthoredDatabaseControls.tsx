/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * The Database Explorer's handles on authored databases: the list, creating
 * one, the per-database bar (status, rebuild, add, delete) and the per-activity
 * Edit / Delete buttons.
 *
 * Deletions that would dangle a BOM link are refused by the backend with the
 * links named; these components show that list rather than a generic failure,
 * because the list IS the instruction for what to do next.
 */

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, RefreshCw, Trash2, Pencil } from 'lucide-react'
import { Button } from '../ui/Button'
import { useProjectStore } from '../../stores/projectStore'
import {
  type AuthoredActivity,
  type AuthoredDatabaseView,
  createAuthoredDatabase,
  deleteAuthoredActivity,
  deleteAuthoredDatabase,
  listAuthoredDatabases,
  reconcileAuthoredDatabases,
  structuredErrorDetail,
} from '../../api/client'

/** Authored databases of the current project; reloads on project change. */
export function useAuthoredDatabases() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const [views, setViews] = useState<AuthoredDatabaseView[]>([])
  const reload = useCallback(async () => {
    try { setViews(await listAuthoredDatabases()) } catch { setViews([]) }
  }, [])
  useEffect(() => { void reload() }, [reload, currentProject])
  return { views, reload }
}

/** What went wrong, and -- for a link refusal -- which rows link in. */
export interface ActionError { message: string; links: string[] }

export function actionError(e: unknown, fallback: string): ActionError {
  const d = structuredErrorDetail(e)
  if (d) {
    return {
      message: typeof d.message === 'string' ? d.message : fallback,
      links: Array.isArray(d.links) ? d.links.map(String) : [],
    }
  }
  return { message: e instanceof Error ? e.message : fallback, links: [] }
}

export function ActionErrorView({ error, testId }: { error: ActionError; testId: string }) {
  return (
    <div data-testid={testId} role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>
      {error.message}
      {error.links.length > 0 && (
        <ul data-testid={`${testId}-links`} style={{ margin: '4px 0 0 16px', padding: 0 }}>
          {error.links.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
    </div>
  )
}

const STATUS_TEXT: Record<string, string> = {
  pending: 'Not yet built in this Brightway project. Rebuild to make it computable.',
  failed: 'The last build failed. Rebuild to retry.',
}

export function AuthoredDatabaseBar({ view, onAddActivity, onChanged, onDeleted }: {
  view: AuthoredDatabaseView
  onAddActivity: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const { database: db, status } = view
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)
  useEffect(() => { setConfirming(false); setError(null) }, [db.name])

  const rebuild = async () => {
    setBusy(true); setError(null)
    try { await reconcileAuthoredDatabases(); onChanged() }
    catch (e) { setError(actionError(e, 'Rebuild failed')) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setError(null)
    try { await deleteAuthoredDatabase(db.name); onDeleted() }
    catch (e) { setError(actionError(e, 'Delete failed')); setConfirming(false) }
    finally { setBusy(false) }
  }
  const needsRebuild = status.state === 'pending' || status.state === 'failed'

  return (
    <div data-testid="authored-db-bar" style={{ display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Authored database · {db.activities.length} {db.activities.length === 1 ? 'activity' : 'activities'}
        </span>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" data-testid="authored-add-activity" onClick={onAddActivity} disabled={busy}>
          <Plus size={14} /> Add activity
        </Button>
        {confirming ? (
          <>
            <Button variant="secondary" data-testid="authored-db-delete-confirm" style={{ color: "var(--danger)" }} onClick={remove} disabled={busy}>Delete {db.name}</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          </>
        ) : (
          <Button variant="ghost" data-testid="authored-db-delete" onClick={() => setConfirming(true)} disabled={busy}>
            <Trash2 size={14} /> Delete database
          </Button>
        )}
      </div>
      {needsRebuild && (
        <div data-testid="authored-db-status" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: 'var(--warning)', fontSize: 'var(--text-xs)' }}>
          <span style={{ flex: 1 }}>{STATUS_TEXT[status.state]}{status.detail ? ` (${status.detail})` : ''}</span>
          <Button variant="secondary" data-testid="authored-db-rebuild" onClick={rebuild} disabled={busy}>
            <RefreshCw size={14} /> Rebuild
          </Button>
        </div>
      )}
      {error && <ActionErrorView error={error} testId="authored-db-error" />}
    </div>
  )
}

export function AuthoredActivityActions({ database, activity, onEdit, onDeleted }: {
  database: string
  activity: AuthoredActivity
  onEdit: () => void
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)
  useEffect(() => { setConfirming(false); setError(null) }, [activity.code])

  const remove = async () => {
    setBusy(true); setError(null)
    try { await deleteAuthoredActivity(database, activity.code); onDeleted() }
    catch (e) { setError(actionError(e, 'Delete failed')); setConfirming(false) }
    finally { setBusy(false) }
  }
  return (
    <div data-testid="authored-activity-actions" style={{ display: 'grid', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button variant="secondary" data-testid="authored-activity-edit" onClick={onEdit} disabled={busy}>
          <Pencil size={14} /> Edit
        </Button>
        {confirming ? (
          <>
            <Button variant="secondary" data-testid="authored-activity-delete-confirm" style={{ color: "var(--danger)" }} onClick={remove} disabled={busy}>Delete activity</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          </>
        ) : (
          <Button variant="ghost" data-testid="authored-activity-delete" onClick={() => setConfirming(true)} disabled={busy}>
            <Trash2 size={14} /> Delete
          </Button>
        )}
      </div>
      {error && <ActionErrorView error={error} testId="authored-activity-error" />}
    </div>
  )
}

export function NewAuthoredDatabaseModal({ existing, onCreated, onCancel }: {
  existing: string[]
  onCreated: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)
  const trimmed = name.trim()
  const clash = existing.includes(trimmed)

  const create = async () => {
    setBusy(true); setError(null)
    try { await createAuthoredDatabase(trimmed, description.trim()); onCreated(trimmed) }
    catch (e) { setError(actionError(e, 'Could not create the database')) }
    finally { setBusy(false) }
  }
  const input = { width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div data-testid="authored-new-db" role="dialog" aria-label="New authored database" style={{ width: 440, display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-5)', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>New authored database</h2>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Activities you write yourself, as biosphere flows with a pedigree score on every exchange.
          It is stored with the project and rebuilt into Brightway from that record.
        </p>
        <label style={{ display: 'grid', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Name
          <input data-testid="authored-new-db-name" value={name} onChange={(e) => setName(e.target.value)} style={input} autoFocus />
        </label>
        {clash && <span style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>A database with this name already exists.</span>}
        <label style={{ display: 'grid', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Description (optional)
          <textarea data-testid="authored-new-db-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={input} />
        </label>
        {error && <ActionErrorView error={error} testId="authored-new-db-error" />}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" data-testid="authored-new-db-create" onClick={create} disabled={busy || !trimmed || clash}>Create</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
