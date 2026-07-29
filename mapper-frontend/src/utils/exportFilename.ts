/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

// Impact-export filename builder — the frontend mirror of the backend
// `_impact_export_filename` (bom.py). Keeping both in lockstep means the
// browser download name (a.download) matches the Content-Disposition.

/** Sanitise a name for a filename: strip filename-invalid characters
 *  (/ \ : * ? " < > |) and collapse whitespace runs to underscores. */
export function sanitizeForFilename(name: string): string {
  return (name || '').replace(/[/\\:*?"<>|]/g, '').trim().replace(/\s+/g, '_')
}

/**
 * Build the fleet Impact-export filename.
 *   no subsystems → `{primary}_impact_{scope}.xlsx`
 *   with subsystems → `{primary}+{sub1}+{sub2}_impact_{scope}.xlsx`
 *   base > `maxBase` chars → `{primary}+{N}_subsystems_impact_{scope}.xlsx`
 */
export function buildImpactExportFilename(
  primaryName: string,
  subsystemNames: string[],
  scope: string,
  maxBase = 100,
): string {
  const p = sanitizeForFilename(primaryName) || 'system'
  const subs = subsystemNames.map(sanitizeForFilename).filter(Boolean)
  let base: string
  if (subs.length === 0) {
    base = `${p}_impact_${scope}`
  } else {
    const combined = `${p}+${subs.join('+')}_impact_${scope}`
    base = combined.length <= maxBase ? combined : `${p}+${subs.length}_subsystems_impact_${scope}`
  }
  return `${base}.xlsx`
}
