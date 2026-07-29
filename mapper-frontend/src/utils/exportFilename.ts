/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Excel-export filename builder — the frontend mirror of the backend
// `build_export_filename` (bom.py). Keeping both in lockstep means the browser
// download name (a.download) matches the Content-Disposition. Locked by a
// parity test on shared fixtures (tests/exportFilename.test.ts).

/** Domain acronym (exact casing — these are field acronyms). */
export type ExportDomain = 'LCA' | 'pLCA' | 'AESA' | 'DSM' | 'MFA'

/** Sanitise a name for a filename: strip filename-invalid characters
 *  (/ \ : * ? " < > |) and collapse whitespace runs to underscores. */
export function sanitizeForFilename(name: string): string {
  return (name || '').replace(/[/\\:*?"<>|]/g, '').trim().replace(/\s+/g, '_')
}

/**
 * The ONE Excel-export filename scheme, shared across every domain:
 *   `{system}+{sub1}+{sub2}_{DOMAIN}.xlsx`
 *   no subsystems → `{system}_{DOMAIN}.xlsx`
 *   base (before `_{DOMAIN}.xlsx`) > `maxBase` → `{system}+{N}_subsystems_{DOMAIN}.xlsx`
 * Only pass subsystems that CONTRIBUTED results; empties are dropped. No date /
 * timestamp / UUID / scenario count. Byte-for-byte identical to the backend
 * `build_export_filename`.
 */
export function buildExportFilename(
  systemName: string,
  subsystemNames: string[],
  domain: ExportDomain | string,
  maxBase = 80,
): string {
  const p = sanitizeForFilename(systemName) || 'system'
  const subs = subsystemNames.map(sanitizeForFilename).filter(Boolean)
  let base: string
  if (subs.length === 0) {
    base = p
  } else {
    const combined = `${p}+${subs.join('+')}`
    base = combined.length <= maxBase ? combined : `${p}+${subs.length}_subsystems`
  }
  return `${base}_${domain}.xlsx`
}
