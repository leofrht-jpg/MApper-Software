/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * In-app replacements for window.confirm / prompt / alert.
 *
 * The packaged app is a WKWebView with no dialog delegate: confirm() answers
 * false, prompt() returns null and alert() shows nothing. So every native call
 * either blocked its action or swallowed its message. These helpers are
 * promise-based so a call site changes by one line:
 *
 *   if (!window.confirm(x)) return
 *   if (!(await confirmDialog({ title: x, destructive: true }))) return
 *
 * - confirmDialog  -> boolean     (Escape / Cancel / backdrop = false)
 * - promptDialog   -> string|null (trimmed; Escape / Cancel = null)
 * - choose         -> value|null  (pick one of several; Escape = null, never a default branch)
 * - messageDialog  -> void        (blocking acknowledgement, e.g. a validation message)
 * - notify         -> void        (non-blocking toast; errors stay until dismissed)
 *
 * One <DialogHost/> is mounted in App.tsx, outside the per-tab ErrorBoundary,
 * portalled to document.body (ComputeOverlay sets `inert` on #root). One
 * dialog shows at a time; a project change resolves pending ones as cancel.
 * Calling a helper with no host mounted throws, so a missing host is loud.
 * tests/noNativeDialogs.test.ts forbids the native calls everywhere else.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { X } from 'lucide-react'
import { Button } from './Button'
import { useProjectStore } from '../../stores/projectStore'
import { IDENTIFIER_INPUT_PROPS } from './identifierInput'

// ── Public option types ───────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Danger-styled confirm button, role="alertdialog", focus starts on Cancel. */
  destructive?: boolean
}

export interface PromptOptions {
  title: string
  label?: string
  body?: ReactNode
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Return an error message to keep the dialog open, or null to accept. */
  validate?: (value: string) => string | null
  /**
   * The input is an identifier by default (case, stage, scenario, folder):
   * no auto-capitalisation, autocorrect or spell check. Set for prose.
   */
  freeText?: boolean
}

export interface ChoiceOption {
  value: string
  label: string
  destructive?: boolean
}

export interface ChooseOptions {
  title: string
  body?: ReactNode
  options: ChoiceOption[]
  cancelLabel?: string
  /** Option focused first. Without it focus starts on Cancel (the safe choice). */
  defaultValue?: string
}

export interface MessageOptions {
  title: string
  body?: ReactNode
  confirmLabel?: string
}

export interface NotifyOptions {
  tone?: 'error' | 'info'
  detail?: string
}

// ── Store ─────────────────────────────────────────────────────────────────

type Request =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void; returnFocus: Element | null }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void; returnFocus: Element | null }
  | { id: number; kind: 'choose'; opts: ChooseOptions; resolve: (v: string | null) => void; returnFocus: Element | null }
  | { id: number; kind: 'message'; opts: MessageOptions; resolve: () => void; returnFocus: Element | null }

export interface Toast {
  id: number
  message: string
  tone: 'error' | 'info'
  detail?: string
}

interface DialogState {
  queue: Request[]
  toasts: Toast[]
  /** Hosts currently mounted; only the first renders. */
  hosts: number[]
}

const useDialogStore = create<DialogState>(() => ({ queue: [], toasts: [], hosts: [] }))

/** How long an info toast stays. Error toasts stay until dismissed. */
export const INFO_TOAST_MS = 8000

let nextId = 1

function requireHost(): void {
  if (useDialogStore.getState().hosts.length === 0) {
    throw new Error('DialogHost is not mounted: render <DialogHost /> once in the app shell.')
  }
}

function currentFocus(): Element | null {
  return typeof document !== 'undefined' ? document.activeElement : null
}

function enqueue(req: Request): void {
  useDialogStore.setState((s) => ({ queue: [...s.queue, req] }))
}

/** Resolve a request with its cancel answer. */
function cancelOf(req: Request): void {
  if (req.kind === 'confirm') req.resolve(false)
  else if (req.kind === 'message') req.resolve()
  else req.resolve(null)
}

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  requireHost()
  const o = typeof opts === 'string' ? { title: opts } : opts
  return new Promise((resolve) => {
    enqueue({ id: nextId++, kind: 'confirm', opts: o, resolve, returnFocus: currentFocus() })
  })
}

export function promptDialog(opts: PromptOptions | string): Promise<string | null> {
  requireHost()
  const o = typeof opts === 'string' ? { title: opts } : opts
  return new Promise((resolve) => {
    enqueue({ id: nextId++, kind: 'prompt', opts: o, resolve, returnFocus: currentFocus() })
  })
}

export function choose(opts: ChooseOptions): Promise<string | null> {
  requireHost()
  return new Promise((resolve) => {
    enqueue({ id: nextId++, kind: 'choose', opts, resolve, returnFocus: currentFocus() })
  })
}

export function messageDialog(opts: MessageOptions | string): Promise<void> {
  requireHost()
  const o = typeof opts === 'string' ? { title: opts } : opts
  return new Promise((resolve) => {
    enqueue({ id: nextId++, kind: 'message', opts: o, resolve, returnFocus: currentFocus() })
  })
}

export function notify(message: string, opts: NotifyOptions = {}): void {
  requireHost()
  const toast: Toast = { id: nextId++, message, tone: opts.tone ?? 'info', detail: opts.detail }
  useDialogStore.setState((s) => ({ toasts: [...s.toasts, toast] }))
}

function dismissToast(id: number): void {
  useDialogStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

/** Remove a request from the queue and answer it. */
function settle(req: Request, answer: () => void): void {
  useDialogStore.setState((s) => ({ queue: s.queue.filter((r) => r.id !== req.id) }))
  answer()
}

// A dialog opened for one project must not act on another: a project switch
// resolves every pending dialog as cancel (the same subscription shape the
// project-scoped stores use).
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  const pending = useDialogStore.getState().queue
  if (pending.length === 0) return
  useDialogStore.setState({ queue: [] })
  pending.forEach(cancelOf)
})

/**
 * True while an in-app dialog is on screen. A modal underneath uses it to
 * ignore keys and backdrop clicks that belong to the dialog.
 */
export function isDialogOpen(): boolean {
  return useDialogStore.getState().queue.length > 0
}

/** Test-only: clear queue and toasts without answering. */
export function __resetDialogsForTests(): void {
  useDialogStore.setState({ queue: [], toasts: [] })
}

// ── Host ──────────────────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function DialogHost() {
  const [hostId] = useState(() => nextId++)
  const hosts = useDialogStore((s) => s.hosts)
  const current = useDialogStore((s) => s.queue[0])
  const toasts = useDialogStore((s) => s.toasts)

  useLayoutEffect(() => {
    useDialogStore.setState((s) => ({ hosts: [...s.hosts, hostId] }))
    return () => useDialogStore.setState((s) => ({ hosts: s.hosts.filter((h) => h !== hostId) }))
  }, [hostId])

  if (hosts[0] !== hostId || typeof document === 'undefined') return null
  return createPortal(
    <>
      {current && <DialogView key={current.id} req={current} />}
      {toasts.length > 0 && <Toasts toasts={toasts} />}
    </>,
    document.body,
  )
}

function DialogView({ req }: { req: Request }) {
  const titleId = useId()
  const bodyId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const initialRef = useRef<HTMLElement | null>(null)
  const [value, setValue] = useState(req.kind === 'prompt' ? (req.opts.defaultValue ?? '') : '')
  const [error, setError] = useState<string | null>(null)

  const destructive =
    (req.kind === 'confirm' && !!req.opts.destructive) ||
    (req.kind === 'choose' && req.opts.options.some((o) => o.destructive))

  // Focus the initial control; on close, return focus to what had it before
  // the dialog opened, unless another dialog is about to take over.
  useEffect(() => {
    (initialRef.current ?? panelRef.current)?.focus()
    return () => {
      if (useDialogStore.getState().queue.length > 0) return
      const back = req.returnFocus
      if (back instanceof HTMLElement && back.isConnected) back.focus()
      else if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) {
        document.activeElement.blur()
      }
    }
  }, [req])

  const cancel = () => settle(req, () => cancelOf(req))

  const submitPrompt = () => {
    if (req.kind !== 'prompt') return
    const v = value.trim()
    const err = req.opts.validate?.(v) ?? null
    if (err) { setError(err); return }
    settle(req, () => req.resolve(v))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // Runs in the CAPTURE phase on window, before any listener of the page or
    // of a modal underneath, and stops the key there: a dialog stacked on a
    // modal owns the keyboard, so Escape or Enter here can never also close
    // or submit the modal below.
    e.stopPropagation()
    const t = e.target as HTMLElement | null
    const inside = !!t && !!panelRef.current?.contains(t)
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
    if (e.key === 'Enter') {
      if (inside && t!.tagName === 'TEXTAREA') return
      e.preventDefault()
      // Enter outside the panel (focus left on the page) must not activate a
      // control underneath; it does nothing.
      if (!inside) return
      if (t!.tagName === 'BUTTON') (t as HTMLButtonElement).click()
      else if (req.kind === 'prompt') submitPrompt()
      return
    }
    if (e.key === 'Tab' && panelRef.current) {
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
        e.preventDefault(); first.focus()
      }
    }
  }

  const keyHandler = useRef(onKeyDown)
  useLayoutEffect(() => { keyHandler.current = onKeyDown })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  const setInitial = (el: HTMLElement | null) => { if (el) initialRef.current = el }

  let content: ReactNode
  let footer: ReactNode
  if (req.kind === 'confirm') {
    const o = req.opts
    footer = (
      <>
        <Button variant="secondary" onClick={cancel} ref={o.destructive ? setInitial : undefined} data-testid="dialog-cancel">
          {o.cancelLabel ?? 'Cancel'}
        </Button>
        <Button
          variant={o.destructive ? 'danger' : 'primary'}
          onClick={() => settle(req, () => req.resolve(true))}
          ref={o.destructive ? undefined : setInitial}
          data-testid="dialog-confirm"
        >
          {o.confirmLabel ?? (o.destructive ? 'Delete' : 'OK')}
        </Button>
      </>
    )
  } else if (req.kind === 'prompt') {
    const o = req.opts
    content = (
      <div style={{ marginTop: 8 }}>
        {o.label && (
          <label htmlFor={`${titleId}-input`} style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {o.label}
          </label>
        )}
        <input
          id={`${titleId}-input`}
          ref={setInitial}
          value={value}
          placeholder={o.placeholder}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          aria-invalid={error ? true : undefined}
          {...(o.freeText ? {} : IDENTIFIER_INPUT_PROPS)}
          data-testid="dialog-input"
          style={{
            width: '100%', height: 30, padding: '0 8px', boxSizing: 'border-box',
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--border-default)'}`,
            borderRadius: 'var(--radius-md)', fontSize: 12, outline: 'none',
          }}
        />
        {error && (
          <div role="alert" data-testid="dialog-error" style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </div>
    )
    footer = (
      <>
        <Button variant="secondary" onClick={cancel} data-testid="dialog-cancel">{o.cancelLabel ?? 'Cancel'}</Button>
        <Button onClick={submitPrompt} data-testid="dialog-confirm">{o.confirmLabel ?? 'OK'}</Button>
      </>
    )
  } else if (req.kind === 'choose') {
    const o = req.opts
    footer = (
      <>
        <Button variant="secondary" onClick={cancel} ref={o.defaultValue ? undefined : setInitial} data-testid="dialog-cancel">
          {o.cancelLabel ?? 'Cancel'}
        </Button>
        {o.options.map((opt) => (
          <Button
            key={opt.value}
            variant={opt.destructive ? 'danger' : opt.value === o.defaultValue ? 'primary' : 'secondary'}
            onClick={() => settle(req, () => req.resolve(opt.value))}
            ref={opt.value === o.defaultValue ? setInitial : undefined}
            data-testid={`dialog-choice-${opt.value}`}
          >
            {opt.label}
          </Button>
        ))}
      </>
    )
  } else {
    footer = (
      <Button onClick={() => settle(req, () => req.resolve())} ref={setInitial} data-testid="dialog-confirm">
        {req.opts.confirmLabel ?? 'OK'}
      </Button>
    )
  }

  const body = req.opts.body
  return (
    <div
      data-testid="dialog-backdrop"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel() }}
    >
      <div
        ref={panelRef}
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        tabIndex={-1}
        data-testid="dialog"
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)', maxWidth: 420, width: '100%', padding: 16,
          boxShadow: 'var(--shadow-lg)', outline: 'none',
        }}
      >
        <div id={titleId} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, whiteSpace: 'pre-wrap' }}>
          {req.opts.title}
        </div>
        {body && (
          <div id={bodyId} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {body}
          </div>
        )}
        {content}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          {footer}
        </div>
      </div>
    </div>
  )
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      data-testid="toasts"
      style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380,
      }}
    >
      {toasts.map((t) => <ToastView key={t.id} toast={t} />)}
    </div>
  )
}

function ToastView({ toast }: { toast: Toast }) {
  useEffect(() => {
    if (toast.tone !== 'info') return
    const id = setTimeout(() => dismissToast(toast.id), INFO_TOAST_MS)
    return () => clearTimeout(id)
  }, [toast])
  const isError = toast.tone === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      data-testid={`toast-${toast.tone}`}
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start',
        background: 'var(--bg-surface)',
        border: `1px solid ${isError ? 'var(--danger)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-md)', padding: '10px 12px',
        boxShadow: 'var(--shadow-lg)', fontSize: 12, color: 'var(--text-primary)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' }}>
        {toast.message}
        {toast.detail && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>{toast.detail}</div>
        )}
      </div>
      <button
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss"
        data-testid="toast-dismiss"
        style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0 }}
      >
        <X size={12} />
      </button>
    </div>
  )
}
