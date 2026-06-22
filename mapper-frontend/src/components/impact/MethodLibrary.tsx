/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Download, Trash2, Upload, AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { ElapsedCounter } from '../ui/ElapsedCounter'
import {
  cancelTask,
  connectToLcaInstallTask,
  getLcaMethodLibrary,
  installLcaMethod,
  uninstallLcaMethod,
  uploadCustomLcaMethod,
  type LCIAInstallMessage,
  type LCIALibraryResponse,
  type LCIAMethodInfo,
} from '../../api/client'
import { StopButton } from '../ui/StopButton'

interface MethodLibraryProps {
  onClose: () => void
}

interface InstallProgress {
  method_id: string
  task_id: string
  stage: string
  pct: number
  done: boolean
  error: string | null
  cancelled: boolean
  stopping: boolean
  warnings: string[]
  method_tuples: string[][]
  startedAt: number
}

const labelCol: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  display: 'block',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 12px',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
}

type TabKey = 'library' | 'custom'

export function MethodLibrary({ onClose }: MethodLibraryProps) {
  const [tab, setTab] = useState<TabKey>('library')
  const [library, setLibrary] = useState<LCIALibraryResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Record<string, InstallProgress>>({})
  const [versionPickerFor, setVersionPickerFor] = useState<string | null>(null)
  const socketsRef = useRef<Record<string, WebSocket>>({})

  const reload = async () => {
    try {
      const data = await getLcaMethodLibrary()
      setLibrary(data)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load library')
    }
  }

  useEffect(() => {
    reload()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      Object.values(socketsRef.current).forEach((ws) => { try { ws.close() } catch { /* ignore */ } })
    }
  }, [onClose])

  const attachSocket = (methodIdOrCustom: string, taskId: string) => {
    setTasks((prev) => ({
      ...prev,
      [methodIdOrCustom]: {
        method_id: methodIdOrCustom,
        task_id: taskId,
        stage: 'queued',
        pct: 0,
        done: false,
        error: null,
        cancelled: false,
        stopping: false,
        warnings: [],
        method_tuples: [],
        startedAt: Date.now(),
      },
    }))
    const ws = connectToLcaInstallTask(
      taskId,
      (msg: LCIAInstallMessage) => {
        setTasks((prev) => {
          const t = prev[methodIdOrCustom]
          if (!t) return prev
          if (msg.type === 'progress') {
            return { ...prev, [methodIdOrCustom]: { ...t, stage: msg.stage, pct: msg.pct } }
          }
          if (msg.type === 'done') {
            // Tell the rest of the app that the method list changed.
            window.dispatchEvent(new CustomEvent('lcia-library-changed'))
            void reload()
            return {
              ...prev,
              [methodIdOrCustom]: {
                ...t, done: true, pct: 1, stage: 'done',
                method_tuples: msg.method_tuples, warnings: msg.warnings,
              },
            }
          }
          if (msg.type === 'cancelled') {
            return {
              ...prev,
              [methodIdOrCustom]: {
                ...t, done: true, cancelled: true, stage: 'cancelled',
              },
            }
          }
          // error
          return { ...prev, [methodIdOrCustom]: { ...t, done: true, error: msg.error } }
        })
      },
      () => {
        setTasks((prev) => {
          const t = prev[methodIdOrCustom]
          if (!t || t.done) return prev
          return { ...prev, [methodIdOrCustom]: { ...t, done: true, error: 'WebSocket error' } }
        })
      },
    )
    socketsRef.current[methodIdOrCustom] = ws
  }

  const handleInstall = async (method: LCIAMethodInfo, eiVersion?: string) => {
    setVersionPickerFor(null)
    try {
      const res = await installLcaMethod(method.id, eiVersion)
      attachSocket(method.id, res.task_id)
    } catch (e) {
      setTasks((prev) => ({
        ...prev,
        [method.id]: {
          method_id: method.id, task_id: '', stage: 'error', pct: 0,
          done: true, error: e instanceof Error ? e.message : 'Install failed',
          cancelled: false, stopping: false,
          warnings: [], method_tuples: [], startedAt: Date.now(),
        },
      }))
    }
  }

  // POST cancel for an in-flight install. The terminal state arrives via the
  // WS ``cancelled`` frame; we only flip ``stopping`` here to disable the
  // button. 404 means the worker beat us — mark cancelled locally.
  const handleCancel = async (taskKey: string) => {
    const t = tasks[taskKey]
    if (!t || t.done || !t.task_id) return
    setTasks((prev) => {
      const cur = prev[taskKey]
      if (!cur) return prev
      return { ...prev, [taskKey]: { ...cur, stopping: true } }
    })
    const result = await cancelTask(t.task_id).catch(() => null)
    if (result === null) {
      setTasks((prev) => {
        const cur = prev[taskKey]
        if (!cur || cur.done) return prev
        return { ...prev, [taskKey]: { ...cur, done: true, cancelled: true, stage: 'cancelled' } }
      })
    }
  }

  const handleUninstall = async (method: LCIAMethodInfo) => {
    if (!window.confirm(`Uninstall ${method.name}? This removes its methods from the current Brightway2 project.`)) return
    try {
      await uninstallLcaMethod(method.id)
      window.dispatchEvent(new CustomEvent('lcia-library-changed'))
      await reload()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Uninstall failed')
    }
  }

  const downloadableMethods = useMemo(
    () => (library?.methods ?? []).filter((m) => m.source !== 'bundled'),
    [library],
  )
  const bundledMethods = useMemo(
    () => (library?.methods ?? []).filter((m) => m.source === 'bundled'),
    [library],
  )

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        width: 860, maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{
          padding: 'var(--space-5) var(--space-6)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
              LCIA Method Library
            </h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              Install additional impact assessment methods into the current Brightway2 project.
              {library?.detected_ecoinvent_version && (
                <> Detected ecoinvent <strong>{library.detected_ecoinvent_version}</strong>.</>
              )}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 'var(--radius-sm)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-1)', padding: '0 var(--space-6)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          {(['library', 'custom'] as TabKey[]).map((k) => {
            const active = tab === k
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                style={{
                  background: 'transparent', border: 'none',
                  borderBottom: active ? '2px solid var(--mod-lca)' : '2px solid transparent',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer', marginBottom: -1,
                }}
              >
                {k === 'library' ? 'Library' : 'Upload Custom (.xlsx)'}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 'var(--space-6)' }}>
          {loadError && (
            <div style={{ padding: 'var(--space-3)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', marginBottom: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
              {loadError}
            </div>
          )}

          {tab === 'library' && (
            <>
              <Section title="Downloadable methods" subtitle="One-click install from Zenodo / PyPI. Requires internet at install time.">
                {downloadableMethods.length === 0 && <EmptyRow text="None available." />}
                {downloadableMethods.map((m) => (
                  <MethodRow
                    key={m.id}
                    method={m}
                    task={tasks[m.id]}
                    supportedEi={library?.supported_ecoinvent_versions ?? []}
                    detectedEi={library?.detected_ecoinvent_version ?? null}
                    versionPickerOpen={versionPickerFor === m.id}
                    onTogglePicker={() => setVersionPickerFor((v) => v === m.id ? null : m.id)}
                    onInstall={(ei) => handleInstall(m, ei)}
                    onUninstall={() => handleUninstall(m)}
                    onCancel={() => handleCancel(m.id)}
                  />
                ))}
              </Section>

              <Section title="Bundled with ecoinvent / Brightway2" subtitle="Already registered in this project.">
                {bundledMethods.length === 0 && <EmptyRow text="No bundled methods detected." />}
                {bundledMethods.map((m) => (
                  <BundledRow key={m.id} method={m} />
                ))}
              </Section>
            </>
          )}

          {tab === 'custom' && (
            <CustomUploadPanel
              task={tasks['__custom__']}
              onCancel={() => handleCancel('__custom__')}
              onSubmit={async (file, name_tuple, description, unit) => {
                try {
                  const res = await uploadCustomLcaMethod(file, name_tuple, description, unit)
                  attachSocket('__custom__', res.task_id)
                } catch (e) {
                  setTasks((prev) => ({
                    ...prev,
                    __custom__: {
                      method_id: '__custom__', task_id: '', stage: 'error', pct: 0,
                      done: true, error: e instanceof Error ? e.message : 'Upload failed',
                      cancelled: false, stopping: false,
                      warnings: [], method_tuples: [], startedAt: Date.now(),
                    },
                  }))
                }
              }}
            />
          )}
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>{children}</div>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
      {text}
    </div>
  )
}

function BundledRow({ method }: { method: LCIAMethodInfo }) {
  return (
    <div style={{
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{method.name}</div>
        {method.category_count != null && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
            {method.category_count} indicator{method.category_count === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success, #10b981)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
        <CheckCircle2 size={14} /> Installed
      </div>
    </div>
  )
}

interface MethodRowProps {
  method: LCIAMethodInfo
  task: InstallProgress | undefined
  supportedEi: string[]
  detectedEi: string | null
  versionPickerOpen: boolean
  onTogglePicker: () => void
  onInstall: (ei?: string) => void
  onUninstall: () => void
  onCancel: () => void
}

function MethodRow({ method, task, supportedEi, detectedEi, versionPickerOpen, onTogglePicker, onInstall, onUninstall, onCancel }: MethodRowProps) {
  const isInstalling = !!task && !task.done
  const hasError = !!task?.error
  const isDone = !!task?.done && !task.error
  const needsEiPick = method.available_variants && method.available_variants.length > 0

  const installClick = () => {
    if (!needsEiPick) { onInstall(); return }
    if (detectedEi && method.available_variants?.includes(detectedEi)) { onInstall(detectedEi); return }
    onTogglePicker()
  }

  return (
    <div style={{
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{method.name}</div>
            {method.source_url && (
              <a href={method.source_url} target="_blank" rel="noreferrer"
                 style={{ color: 'var(--text-tertiary)', display: 'flex' }} title="Source">
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          {method.description && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
              {method.description}
            </div>
          )}
          {method.long_description && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.5 }}>
              {method.long_description}
            </div>
          )}
          {method.notes && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 6, fontStyle: 'italic' }}>
              {method.notes}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {method.installer && <span>Installer: {method.installer}</span>}
            {method.size_mb != null && <span>~{method.size_mb.toFixed(1)} MB</span>}
            {method.available_variants && (
              <span>ei versions: {method.available_variants.join(', ')}</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          {method.installed ? (
            <Button variant="ghost" onClick={onUninstall} style={{ color: 'var(--danger)' }}>
              <Trash2 size={14} style={{ marginRight: 6 }} /> Uninstall
            </Button>
          ) : isInstalling ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              <Loader2 size={14} className="animate-spin" /> {task!.stage}
              <ElapsedCounter
                startedAt={task!.startedAt}
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginLeft: 4 }}
              />
              <StopButton
                taskId={task!.task_id || null}
                state={task!.stopping ? 'stopping' : 'running'}
                onClick={onCancel}
              />
            </div>
          ) : (
            <Button variant="primary" onClick={installClick} style={{ backgroundColor: 'var(--mod-lca)' }}>
              <Download size={14} style={{ marginRight: 6 }} /> Install
            </Button>
          )}
          {needsEiPick && versionPickerOpen && !method.installed && !isInstalling && (
            <div style={{
              display: 'flex', gap: 6, padding: 'var(--space-2)',
              backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
            }}>
              {(method.available_variants ?? supportedEi).map((v) => (
                <button
                  key={v}
                  onClick={() => onInstall(v)}
                  style={{
                    padding: '4px 10px', fontSize: 'var(--text-xs)',
                    backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer', fontWeight: 500,
                  }}
                >
                  ei {v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isInstalling && (
        <div>
          <div style={{ height: 4, backgroundColor: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(task!.pct * 100)}%`, backgroundColor: 'var(--mod-lca)', transition: 'width 0.2s' }} />
          </div>
        </div>
      )}

      {hasError && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: 'var(--space-2) var(--space-3)',
          backgroundColor: 'rgba(239,68,68,0.08)',
          border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)',
          color: 'var(--danger)', fontSize: 'var(--text-xs)',
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ whiteSpace: 'pre-wrap' }}>{task!.error}</span>
        </div>
      )}

      {task?.cancelled && (
        <div style={{
          padding: 'var(--space-2) var(--space-3)',
          fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
        }}>
          Install cancelled.
        </div>
      )}

      {isDone && task!.warnings.length > 0 && (
        <div style={{
          padding: 'var(--space-2) var(--space-3)',
          backgroundColor: 'rgba(245,158,11,0.08)',
          border: '1px solid var(--warning, #f59e0b)', borderRadius: 'var(--radius-sm)',
          color: 'var(--warning, #f59e0b)', fontSize: 'var(--text-xs)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Installed with warnings:</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {task!.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

interface CustomUploadPanelProps {
  task: InstallProgress | undefined
  onSubmit: (file: File, name_tuple: string[], description: string, unit: string) => Promise<void>
  onCancel: () => void
}

function CustomUploadPanel({ task, onSubmit, onCancel }: CustomUploadPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [nameTuple, setNameTuple] = useState('MyLab, Climate change, GWP100')
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const isRunning = !!task && !task.done
  const isDone = !!task?.done && !task.error
  const hasError = !!task?.error

  const handleSubmit = async () => {
    setLocalError(null)
    if (!file) { setLocalError('Choose an .xlsx file.'); return }
    const parts = nameTuple.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) { setLocalError('Name must be at least one segment.'); return }
    if (!unit.trim()) { setLocalError('Unit is required (e.g. "kg CO2-eq").'); return }
    await onSubmit(file, parts, description, unit.trim())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{
        padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        Upload a single-sheet Excel file that follows the
        {' '}
        <code style={{ fontFamily: 'monospace' }}>bw2io.ExcelLCIAImporter</code>
        {' '}
        format. The file lists characterisation factors (biosphere flow name, category, subcategory, amount).
        The method <em>name</em>, <em>description</em>, and <em>unit</em> are not read from the file — enter them below.
      </div>

      <div>
        <label style={labelCol}>File (.xlsx)</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)', cursor: 'pointer',
            fontSize: 'var(--text-sm)', backgroundColor: 'var(--bg-elevated)',
          }}>
            <Upload size={14} />
            Choose file
            <input
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {file ? file.name : 'No file chosen'}
          </span>
        </div>
      </div>

      <div>
        <label style={labelCol}>Method name (comma-separated, becomes a tuple)</label>
        <input type="text" value={nameTuple} onChange={(e) => setNameTuple(e.target.value)} style={inputStyle}
               placeholder="MyLab, Climate change, GWP100" />
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
          Will be registered as <code>("MyLab", "Climate change", "GWP100")</code> in Brightway2.
        </div>
      </div>

      <div>
        <label style={labelCol}>Description</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle}
               placeholder="(optional)" />
      </div>

      <div>
        <label style={labelCol}>Unit</label>
        <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle}
               placeholder="kg CO2-eq" />
      </div>

      {localError && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{localError}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button variant="primary" onClick={handleSubmit} disabled={isRunning} style={{ backgroundColor: 'var(--mod-lca)' }}>
          {isRunning ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} /> {task!.stage}</> : <><Upload size={14} style={{ marginRight: 6 }} /> Import method</>}
        </Button>
        {isRunning && (
          <>
            <ElapsedCounter
              startedAt={task!.startedAt}
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}
            />
            <StopButton
              taskId={task!.task_id || null}
              state={task!.stopping ? 'stopping' : 'running'}
              onClick={onCancel}
            />
          </>
        )}
      </div>

      {isRunning && (
        <div style={{ height: 4, backgroundColor: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round(task!.pct * 100)}%`, backgroundColor: 'var(--mod-lca)', transition: 'width 0.2s' }} />
        </div>
      )}

      {hasError && (
        <div style={{
          padding: 'var(--space-3)', backgroundColor: 'rgba(239,68,68,0.08)',
          border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)',
          color: 'var(--danger)', fontSize: 'var(--text-sm)',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ whiteSpace: 'pre-wrap' }}>{task!.error}</span>
        </div>
      )}

      {isDone && (
        <div style={{
          padding: 'var(--space-3)',
          backgroundColor: 'rgba(16,185,129,0.08)',
          border: '1px solid var(--success, #10b981)', borderRadius: 'var(--radius-md)',
          color: 'var(--success, #10b981)', fontSize: 'var(--text-sm)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} /> Imported {task!.method_tuples.length} method{task!.method_tuples.length === 1 ? '' : 's'}
          </div>
          {task!.warnings.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: 'var(--warning, #f59e0b)' }}>
              {task!.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
