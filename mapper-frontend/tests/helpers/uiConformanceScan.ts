/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Scans mapper-frontend/src for buttons that do not follow the UI templates (see the
// "UI templates" section of mapper-frontend/CLAUDE.md). Source-level, regex + a small tag
// tokenizer: no JSX parser is installed, and the question is only "which element, which
// variant, which label".
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { relPosix } from './relPosix'

export type ViolationKind =
  | 'raw-button-labelled'      // a raw <button> whose label is export/discard/delete/remove/cancel
  | 'template-variant'         // a <Button> with such a label but not the template variant
  | 'raw-button'               // any other raw <button>

export interface Violation {
  kind: ViolationKind
  file: string                 // relative to mapper-frontend/, forward slashes
  line: number
  label: string                // the visible/aria label, normalised ('' when there is none)
  detail: string               // what is wrong, one line
  key: string                  // file | kind | label : the ratchet key (no line number)
}

/** The label words the templates cover. */
export const LABEL_RE = /\b(export|discard|delete|remove|cancel)\b/i

/** What each label word must use. Cancel follows the app's predominant usage (CLAUDE.md). */
export const TEMPLATE: Record<string, { variant: string; note: string }> = {
  export: { variant: 'secondary', note: 'secondary variant with the download icon' },
  discard: { variant: 'danger', note: 'danger variant' },
  delete: { variant: 'danger', note: 'danger variant' },
  remove: { variant: 'danger', note: 'danger variant' },
  cancel: { variant: 'ghost', note: 'ghost variant' },
}

/** The primitive itself and the tests' own helpers are not violations. */
const SKIP_FILES = new Set([
  'components/ui/Button.tsx', 'components/ui/InfoButton.tsx', 'components/ui/DetailsToggle.tsx',
])

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
}

/** Index just past the `>` that closes the opening tag starting at `start` (a `<`). */
function endOfOpeningTag(src: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue }
    if (depth > 0 && (c === '"' || c === "'" || c === '`')) { quote = c; continue }
    if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i + 1
  }
  return -1
}

/**
 * The template word a label is about: its first word, or its last word when the label is short
 * ("Deleting… Delete"). A word buried in a sentence ("Or restore from a previous export") is not
 * a button called Export.
 */
function templateWord(label: string): string {
  const words = label.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const first = words[0].match(LABEL_RE)?.[1]
  if (first) return first.toLowerCase()
  if (words.length <= 4) return (words[words.length - 1].match(LABEL_RE)?.[1] ?? '').toLowerCase()
  return ''
}

/** The raw text of an attribute, whether a string or an expression. */
function attrRaw(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\})`))
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*['"\`]([^'"\`]*)['"\`]\\s*\\})`))
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null
}

/** The words a person reads on the button: text nodes and string literals, tags dropped. */
function labelOf(tag: string, inner: string): string {
  const parts: string[] = []
  const aria = attr(tag, 'aria-label') ?? attr(tag, 'title')
  const body = inner
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{[^}]*\}/g, (m) => (m.match(/(['"`])([^'"`]*)\1/g) ?? []).map((s) => s.slice(1, -1)).join(' ') + ' ')
  parts.push(body)
  if (!body.trim() && aria) parts.push(aria)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function scanSource(rel: string, src: string): Violation[] {
  const found: Violation[] = []
  const lineAt = (i: number) => src.slice(0, i).split('\n').length
  for (const m of src.matchAll(/<(Button|button)\b/g)) {
    const start = m.index!
    const tagName = m[1]
    const end = endOfOpeningTag(src, start)
    if (end < 0) continue
    const tag = src.slice(start, end)
    const selfClosing = tag.endsWith('/>')
    let inner = ''
    if (!selfClosing) {
      const close = src.indexOf(`</${tagName}>`, end)
      inner = close < 0 ? '' : src.slice(end, close)
    }
    const label = labelOf(tag, inner)
    const hit = templateWord(label)
    const line = lineAt(start)
    const push = (kind: ViolationKind, detail: string) =>
      found.push({ kind, file: rel, line, label, detail, key: `${rel} | ${kind} | ${label}` })

    if (tagName === 'button') {
      if (hit) push('raw-button-labelled', `raw <button> labelled "${label}": use <Button> with the ${TEMPLATE[hit].note}`)
      else push('raw-button', label ? `raw <button> "${label}": use <Button>` : 'raw <button> (icon or unlabelled): use <Button> or a named primitive')
      continue
    }
    if (!hit) continue
    const want = TEMPLATE[hit]
    const rawVariant = attrRaw(tag, 'variant')
    // A conditional variant (`o.destructive ? 'danger' : 'primary'`) that names the template one is accepted.
    const variant = rawVariant === null ? 'primary'
      : /^[a-z]+$/.test(rawVariant) ? rawVariant
      : rawVariant.includes(`'${want.variant}'`) || rawVariant.includes(`"${want.variant}"`) ? want.variant
      : rawVariant
    const exportNeedsIcon = hit === 'export' && !/\bDownload\b/.test(inner)
    const colourOverride = /style=\{\{[^}]*color:\s*['"]?(?:"?)var\(--danger\)/.test(tag)
    if (variant !== want.variant || exportNeedsIcon || colourOverride) {
      const why = [
        variant !== want.variant ? `variant="${variant}" instead of "${want.variant}"` : '',
        exportNeedsIcon ? 'no download icon' : '',
        colourOverride ? 'red text hand-set on the button' : '',
      ].filter(Boolean).join(', ')
      push('template-variant', `"${label}" is ${why}: use the ${want.note}`)
    }
  }
  return found
}

/** Every violation in mapper-frontend/src, in file/line order. */
export function scanFrontend(frontendRoot: string): Violation[] {
  const files: string[] = []
  walk(join(frontendRoot, 'src'), files)
  const all: Violation[] = []
  for (const f of files.sort()) {
    const rel = relPosix(frontendRoot, f)
    if (SKIP_FILES.has(rel.replace(/^src\//, ''))) continue
    all.push(...scanSource(rel, readFileSync(f, 'utf8')))
  }
  return all
}

/** key -> how many violations share it (two identical raw buttons in one file are two). */
export function countByKey(vs: Violation[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of vs) out[v.key] = (out[v.key] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

export function formatReport(vs: Violation[]): string {
  const kinds: ViolationKind[] = ['raw-button-labelled', 'template-variant', 'raw-button']
  const lines: string[] = []
  for (const k of kinds) {
    const group = vs.filter((v) => v.kind === k)
    lines.push(`\n${k}: ${group.length}`)
    for (const v of group) lines.push(`  ${v.file}:${v.line}  ${v.detail}`)
  }
  return lines.join('\n')
}
