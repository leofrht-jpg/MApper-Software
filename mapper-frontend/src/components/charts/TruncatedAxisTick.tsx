/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Truncate a label to `max` characters with a trailing ellipsis. Pure, testable
 * without a DOM (Recharts renders nothing in jsdom). Never returns the ellipsis
 * alone — a `max` below 1 still yields the first character.
 */
export function truncateLabel(label: string, max = 28): string {
  if (label.length <= max) return label
  return `${label.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

/**
 * A vertical-BarChart Y-axis category tick that renders REAL SVG `<text>`
 * (captured by the native-SVG chart export), truncating long labels with an
 * ellipsis and carrying the FULL label in an SVG `<title>` so hovering the tick
 * reveals it. `format` maps the raw category value (e.g. a subsystem-prefixed
 * material key) to its display label before truncation.
 */
export function TruncatedAxisTick(props: {
  x?: number
  y?: number
  payload?: { value?: string | number }
  format?: (raw: string) => string
  max?: number
  fill?: string
  fontSize?: number
}) {
  const { x = 0, y = 0, payload, format, max = 28, fill = 'var(--text-secondary)', fontSize = 11 } = props
  const raw = String(payload?.value ?? '')
  const full = format ? format(raw) : raw
  const shown = truncateLabel(full, max)
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={fill} fontSize={fontSize}>
      {shown !== full && <title>{full}</title>}
      {shown}
    </text>
  )
}
