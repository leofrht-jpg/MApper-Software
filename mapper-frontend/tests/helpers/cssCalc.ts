// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * `calc()` strings, compared by value instead of by how the engine writes them.
 *
 * jsdom 30 hands back the text the component set (`calc(100vh - 96px)`); jsdom 31
 * serialises the same expression through its own CSS implementation and returns
 * `calc(-96px + 100vh)`. Both mean the same thing, so a test that is about WHICH
 * height the element carries (a `minHeight` of "viewport minus 96px", not a
 * `maxHeight`) must not depend on the spelling.
 *
 * Only a sum of terms is understood: each term a number with an optional unit,
 * joined by `+` or `-`. Anything else (a nested calc, a product, a division) is
 * returned unchanged, so such a string still compares as plain text and a test
 * that uses one fails loudly rather than passing by accident.
 */
const TERM = /^[+-]?\d*\.?\d+[a-z%]*$/i

/** The terms of `calc(a - b)`, signed and sorted, or `null` when it is not a plain sum. */
function signedTerms(value: string): string[] | null {
  const match = value.trim().match(/^calc\((.*)\)$/i)
  if (!match) return null
  const inner = match[1].trim().replace(/\s+-\s+/g, ' + -')
  const terms = inner.split(/\s+\+\s+/).map((t) => t.trim())
  if (!terms.every((t) => TERM.test(t))) return null
  return terms.map((t) => (t.startsWith('+') ? t.slice(1) : t)).sort()
}

/** A form of the value that is the same however the engine spelled a sum. */
export function normalizeCalc(value: string): string {
  const terms = signedTerms(value)
  return terms ? `calc(${terms.join(' ')})` : value
}
