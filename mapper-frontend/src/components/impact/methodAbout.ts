/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import type { LCIAMethodInfo } from '../../api/client'

/** An (i) text longer than this (characters) is condensed: three short sentences, the rest under Details. */
export const ABOUT_LIMIT = 350

type AboutFields = Pick<LCIAMethodInfo, 'long_description' | 'factor_source' | 'notes'>

/** The characters of text the (i) of a method entry would hold in full. */
export function aboutLength(m: AboutFields): number {
  return (m.long_description ?? '').length + (m.factor_source ?? '').length + (m.notes ?? '').length
}

/** The first sentence of a text (up to the first full stop that is followed by a new sentence), or all of it. */
export function firstSentence(text: string): string {
  const m = /[.!?](?=\s+[A-Z0-9'"“])/.exec(text)
  return m ? text.slice(0, m.index + 1) : text
}

export interface MethodAbout {
  /** True when the full text fits the (i) and is shown there unchanged. */
  full: boolean
  /** Condensed: what it installs, the note on offline and needs. */
  lead: string | null
  note: string | null
  /** Condensed: the text that moved to Details, word for word. */
  moreDescription: string | null
  moreSource: string | null
}

/**
 * What the (i) of a method entry shows. A short text is shown unchanged. A long one is cut to what it
 * installs (the first sentence of the description) and the entry's note (whether it works offline and what
 * it needs), then a pointer to Details; the rest of the description and the factor source go to Details
 * with their wording untouched.
 */
export function methodAbout(m: AboutFields): MethodAbout {
  if (aboutLength(m) <= ABOUT_LIMIT) {
    return { full: true, lead: null, note: null, moreDescription: null, moreSource: null }
  }
  const desc = m.long_description ?? ''
  const lead = desc ? firstSentence(desc) : null
  const rest = desc ? desc.slice(lead!.length).trim() : ''
  return {
    full: false,
    lead,
    note: m.notes ?? null,
    moreDescription: rest || null,
    moreSource: m.factor_source ?? null,
  }
}

/** The pointer sentence that ends a condensed (i). */
export const ABOUT_MORE_POINTER = 'More under Details.'
