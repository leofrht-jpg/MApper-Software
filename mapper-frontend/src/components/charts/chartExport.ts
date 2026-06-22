/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'

export type ExportFormat = 'svg' | 'pdf' | 'png' | 'jpeg'
export type BgOption = 'dark' | 'light' | 'transparent'
export type RasterScale = 1 | 2 | 3 | 4

// Patch 4I — three export modes for charts that ship a separate legend.
// `chart` is the existing single-button behavior (chart SVG only, no
// legend). `legend` exports just the legend element wrapped in a
// foreignObject SVG. `combined` stacks chart on top of legend in one
// SVG and exports the composite. Filename discriminator suffix is
// applied per-mode: `_chart`, `_legend`, or no suffix.
export type ExportMode = 'chart' | 'legend' | 'combined'

const DARK_BG = '#0B0E11'
const LIGHT_BG = '#ffffff'

// Dark-theme INK source colours (the CSS tokens the on-screen chart paints
// axes / ticks / labels / grid / borders with). The print re-theme (Patch 5AJ)
// maps these → black ink + grey grid at EXPORT time only. Data series use
// saturated palette hexes (CHART_PALETTE / SCENARIO_PALETTE / colorForCohort),
// which appear in NONE of the source lists below — so the remap never touches
// a data fill.
const DARK_TEXT = '#E8ECF1'           // --text-primary
const DARK_TEXT_SECONDARY = '#8B95A5' // --text-secondary
const DARK_TEXT_TERTIARY = '#5A6577'  // --text-tertiary
const DARK_BORDER_SUBTLE = '#1E2530'  // --border-subtle
const DARK_BORDER_DEFAULT = '#2A3340' // --border-default

// Print palette (Patch 5AJ). Exports re-theme INK only.
const PRINT_INK = '#000000'   // text, axis lines, tick marks → black
const PRINT_GRID = '#cbd5e1'  // gridlines / subtle borders → light grey on white
const PRINT_REF = '#374151'   // dashed reference / annotation lines → dark on white

// Each ink/grid token can appear in a serialized export in three forms: the
// CSS var (preserved as an attribute on the clone), the hex literal, and the
// rgb(...) form getComputedStyle emits when inlining. We remap all three. The
// legacy GitHub-ish greys (#e6edf3 / #8b949e / #30363d) are kept for older
// hardcoded usages.
const INK_SOURCE_HEX = [DARK_TEXT, DARK_TEXT_SECONDARY, DARK_TEXT_TERTIARY, '#e6edf3', '#8b949e']
const INK_SOURCE_VARS = ['--text-primary', '--text-secondary', '--text-tertiary']
const GRID_SOURCE_HEX = [DARK_BORDER_SUBTLE, DARK_BORDER_DEFAULT, '#30363d']
const GRID_SOURCE_VARS = ['--border-subtle', '--border-default']

function sanitizeFilename(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_\-.]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

export function buildFilename(base: string, ext: ExportFormat, scale?: RasterScale, mode?: ExportMode): string {
  const safe = sanitizeFilename(base || 'chart')
  const isRaster = ext === 'png' || ext === 'jpeg'
  const scaleSuffix = isRaster && scale ? `@${scale}x` : ''
  // mode discriminator. `combined` (or undefined) → no suffix to preserve
  // back-compat with existing filenames.
  const modeSuffix = mode === 'chart' ? '_chart' : mode === 'legend' ? '_legend' : ''
  return `mapper_${safe}${modeSuffix}${scaleSuffix}.${ext === 'jpeg' ? 'jpg' : ext}`
}

function replaceColors(svg: string, mapping: Record<string, string>): string {
  let out = svg
  for (const [from, to] of Object.entries(mapping)) {
    const re = new RegExp(from.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi')
    out = out.replace(re, to)
  }
  return out
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

// Patch 5AJ — the print INK/GRID remap (exported for unit testing). Maps every
// ink source (hex / rgb / var) → black and every grid source → grey. Data
// palette colours are absent from the source lists, so they pass through
// untouched — the contract this function exists to guarantee.
export function buildPrintInkMapping(): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const hex of INK_SOURCE_HEX) { mapping[hex] = PRINT_INK; mapping[hexToRgb(hex)] = PRINT_INK }
  for (const v of INK_SOURCE_VARS) mapping[`var(${v})`] = PRINT_INK
  for (const hex of GRID_SOURCE_HEX) { mapping[hex] = PRINT_GRID; mapping[hexToRgb(hex)] = PRINT_GRID }
  for (const v of GRID_SOURCE_VARS) mapping[`var(${v})`] = PRINT_GRID
  return mapping
}

// Re-theme INK only (text / axes / ticks / grid / borders → black-on-grey).
// Pure string transform → unit-testable without a layout engine (per 5AD/5AF).
export function adaptInkForPrint(svgString: string): string {
  return replaceColors(svgString, buildPrintInkMapping())
}

// Reference / annotation lines (Recharts `<ReferenceLine>`, e.g. the year-detail
// cursor) use module accent colours that DO collide with the data palette
// (`--mod-plca` #f59e0b is in CHART_PALETTE), so they can't be safely remapped
// by colour. Target them by Recharts' semantic class and darken to a
// print-readable stroke. DOM pass on the clone, before serialization.
export function darkenReferenceLines(root: SVGElement): void {
  const refs = root.querySelectorAll<SVGElement>(
    '.recharts-reference-line-line, .recharts-reference-line line',
  )
  refs.forEach((el) => {
    // `mapper-semantic-ref` reference lines (e.g. the AESA SR=1.0/2.0 zone
    // boundaries) carry a SEMANTIC colour matched to their legend swatch —
    // retain it in the export instead of darkening to ink.
    if (el.closest('.recharts-reference-line')?.classList.contains('mapper-semantic-ref')) {
      return
    }
    el.style.setProperty('stroke', PRINT_REF, 'important')
    el.setAttribute('stroke', PRINT_REF)
  })
}

function inlineComputedStyles(source: SVGElement, target: SVGElement): void {
  const srcChildren = source.querySelectorAll<SVGElement>('*')
  const tgtChildren = target.querySelectorAll<SVGElement>('*')
  const minLen = Math.min(srcChildren.length, tgtChildren.length)
  const rootCs = window.getComputedStyle(source)
  const props = [
    'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
    'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity',
    'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
  ]
  const copy = (src: Element, tgt: SVGElement) => {
    const cs = window.getComputedStyle(src)
    let style = ''
    for (const p of props) {
      const v = cs.getPropertyValue(p)
      if (v && v !== 'none' && v !== 'normal') style += `${p}:${v};`
    }
    if (style) tgt.setAttribute('style', style)
  }
  copy(source, target)
  void rootCs
  for (let i = 0; i < minLen; i++) {
    copy(srcChildren[i], tgtChildren[i])
  }
}

function serializeSvgForExport(sourceSvg: SVGSVGElement, bg: BgOption): {
  svgString: string
  width: number
  height: number
} {
  const rect = sourceSvg.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width || sourceSvg.clientWidth || 800))
  const height = Math.max(1, Math.round(rect.height || sourceSvg.clientHeight || 400))

  const clone = sourceSvg.cloneNode(true) as SVGSVGElement
  inlineComputedStyles(sourceSvg, clone)

  // Patch 5AJ — print re-theme applies to any non-dark export (light=white bg,
  // transparent=slide bg shows through). Reference lines are darkened by class
  // on the DOM clone (their accent colour collides with the data palette).
  const print = bg !== 'dark'
  if (print) darkenReferenceLines(clone)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  let svgString = new XMLSerializer().serializeToString(clone)

  // INK-only string remap (text/axes/ticks/grid → black-on-grey). Never touches
  // data series colours — they're not in the source lists.
  if (print) svgString = adaptInkForPrint(svgString)

  return { svgString, width, height }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function findChartSvg(container: HTMLElement): SVGSVGElement | null {
  const svgs = container.querySelectorAll<SVGSVGElement>('svg')
  let best: SVGSVGElement | null = null
  let bestArea = 0
  svgs.forEach((s) => {
    const r = s.getBoundingClientRect()
    const a = r.width * r.height
    if (a > bestArea) { bestArea = a; best = s }
  })
  return best
}

async function svgToRaster(
  svgString: string,
  width: number,
  height: number,
  bg: BgOption,
  format: 'png' | 'jpeg',
  filename: string,
  scale: RasterScale,
): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context not available')

  if (bg === 'light' || format === 'jpeg') {
    ctx.fillStyle = LIGHT_BG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  } else if (bg === 'dark') {
    ctx.fillStyle = DARK_BG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(url)
  }

  const outBlob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b),
      format === 'png' ? 'image/png' : 'image/jpeg',
      format === 'jpeg' ? 0.95 : undefined,
    )
  })
  if (!outBlob) throw new Error('Canvas export failed')
  triggerDownload(outBlob, filename)
}

async function svgToPdf(
  sourceSvg: SVGSVGElement,
  svgString: string,
  width: number,
  height: number,
  bg: BgOption,
  filename: string,
): Promise<void> {
  const doc = new jsPDF({
    orientation: width >= height ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [width, height],
  })

  if (bg === 'light') {
    doc.setFillColor(255, 255, 255)
    doc.rect(0, 0, width, height, 'F')
  } else if (bg === 'dark') {
    doc.setFillColor(11, 14, 17)
    doc.rect(0, 0, width, height, 'F')
  }

  const parser = new DOMParser()
  const docSvg = parser.parseFromString(svgString, 'image/svg+xml').documentElement as unknown as SVGSVGElement
  try {
    await svg2pdf(docSvg, doc, { x: 0, y: 0, width, height })
  } catch {
    await svg2pdf(sourceSvg, doc, { x: 0, y: 0, width, height })
  }

  const blob = doc.output('blob')
  triggerDownload(blob, filename)
}

// ── HTML legend → native SVG (Patch 4K) ────────────────────────────────────
// Patch 4I shipped a `<foreignObject>` strategy that wrapped the cloned
// legend HTML inside an SVG and rasterised through the existing pipeline.
// That tainted the canvas in production: MApper loads Geist + Geist Mono
// from `fonts.gstatic.com`, so the foreignObject's HTML — which inherits
// `font-family: Geist, ...` from inlined computed styles — triggered a
// cross-origin font fetch when the browser painted the SVG to canvas.
// The browser then refused `toBlob` with "Tainted canvases may not be
// exported."
//
// Fix: render legends as native SVG (`<rect>` + `<text>`) using a
// system-font stack. No HTML, no foreignObject, no font fetch, no
// taint. Smaller export files too.
//
// `extractLegendItems` reads the live legend's DOM — one row per
// top-level child, swatch color from the first descendant element with
// a non-transparent background, label from the row's text content.
// Special-cased: ComparisonReferenceLineChart's "Static (St)" item has
// a dashed border-top instead of a backgroundColor; detected via the
// fallback color (we render it as a small rect in the same color
// family as the dashed line — visually approximate, methodologically
// equivalent because the user reads the label, not the swatch shape).

export interface LegendItem {
  color: string
  label: string
}

const SYSTEM_FONT_STACK = 'Helvetica, Arial, sans-serif'
const LEGEND_FONT_SIZE = 11
const LEGEND_SWATCH = 10
const LEGEND_ROW_H = 18
const LEGEND_ITEM_GAP = 12
const LEGEND_SWATCH_GAP = 5

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function legendFgColor(bg: BgOption): string {
  // Foreground (text) color for the SVG legend. Dark export → light text;
  // light / transparent (print) → black ink (Patch 5AJ), matching the chart's
  // re-themed axis/label ink. Transparent assumes a light consuming surface
  // (papers / slides), the common case.
  if (bg === 'dark') return DARK_TEXT
  return PRINT_INK
}

function isTransparentColor(color: string): boolean {
  if (!color) return true
  const c = color.replace(/\s+/g, '').toLowerCase()
  // Patch 4AE — reject "none" (SVG paint keyword meaning "do not paint")
  // and "currentcolor" (ancestor-dependent; won't resolve in the
  // standalone-rendered legend SVG). Pre-Patch-4AE, Recharts'
  // `iconType="square"` emitted swatches as `<path stroke="none"
  // fill="#34D399">`; the stroke walk matched `"none"` (not in the
  // reject list) → color became `"none"` → rendered `<rect fill="none">`
  // = invisible.
  return (
    c === 'transparent'
    || c === 'rgba(0,0,0,0)'
    || c === ''
    || c === 'none'
    || c === 'currentcolor'
  )
}

// Patch 4AE — read an SVG paint attribute (`fill` or `stroke`) as a
// candidate color. Returns the raw attribute value or null when it's
// missing/transparent. Centralised so both the extraction priorities
// (fill first, then stroke fallback) use the same transparency rule.
function svgPaintAttr(el: Element, attr: 'fill' | 'stroke'): string | null {
  const v = el.getAttribute(attr)
  if (!v) return null
  return isTransparentColor(v) ? null : v
}

export function extractLegendItems(legend: HTMLElement): LegendItem[] {
  const items: LegendItem[] = []
  // Recharts' default legend wraps swatches in a `<ul class="recharts-default-legend">`
  // with `<li class="recharts-legend-item">` rows. Custom HTML legends
  // use top-level `<span>` children. Pick the right level.
  let rowParent: HTMLElement = legend
  const rechartsList = legend.querySelector<HTMLElement>('ul.recharts-default-legend')
  if (rechartsList) rowParent = rechartsList

  const rows = Array.from(rowParent.children)
  for (const row of rows) {
    if (!(row instanceof HTMLElement) && !(row instanceof SVGElement)) continue
    // Walk descendants once; subsequent priority passes filter from
    // this list. querySelectorAll('*') hits nested span swatches AND
    // SVG path/rect/circle/polygon icons (Recharts iconType variants).
    let color = ''
    const candidates: Element[] = [row, ...Array.from(row.querySelectorAll('*'))]

    // Patch 4AE — Priority 1: SVG fill attribute. Recharts'
    // `<Legend iconType="square">` (used by AESA Timeline, the multi-
    // scenario chart, comparison-line chart, etc.) emits the swatch
    // icon as `<path stroke="none" fill={color} d="...">` inside a
    // `<svg class="recharts-surface">`. The actual color lives on
    // `fill`. Pre-Patch-4AE the extractor skipped this attribute
    // entirely and either fell to `stroke="none"` (treated as a
    // valid color → invisible swatch) or to the `#888` fallback.
    for (const el of candidates) {
      const fill = svgPaintAttr(el, 'fill')
      if (fill) { color = fill; break }
    }

    // Priority 2: descendant element with a non-transparent CSS
    // backgroundColor. Covers custom HTML legends (BoxPlot, AESA
    // RadarView zone swatches) where the swatch is a styled
    // `<span style="background: ...">`.
    if (!color) {
      for (const el of candidates) {
        const cs = window.getComputedStyle(el)
        const bg = cs.backgroundColor
        if (!isTransparentColor(bg)) {
          color = bg
          break
        }
      }
    }

    // Priority 3: SVG stroke attribute (covers Recharts'
    // `iconType="line"` swatches, where the icon is a horizontal
    // line drawn with stroke + fill="none"). Also covers the
    // dashed-line "Static" item in ComparisonReferenceLineChart's
    // legend. `isTransparentColor("none")` now returns true
    // (Patch 4AE) so a `stroke="none"` Recharts square icon no
    // longer claims the color slot.
    if (!color) {
      for (const el of candidates) {
        const stroke = svgPaintAttr(el, 'stroke')
        if (stroke) { color = stroke; break }
      }
    }

    // Priority 4: CSS border-top color (custom dashed-line legend
    // entries that use `border-top: ... dashed ...` to render the
    // line preview).
    if (!color) {
      for (const el of candidates) {
        const cs = window.getComputedStyle(el)
        if (cs.borderTopColor && !isTransparentColor(cs.borderTopColor)
            && cs.borderTopStyle !== 'none') {
          color = cs.borderTopColor
          break
        }
      }
    }

    if (!color) color = '#888'  // last-resort fallback so the row still shows.
    const label = (row.textContent ?? '').trim()
    if (!label) continue
    items.push({ color, label })
  }
  return items
}

function measureLegendText(label: string): number {
  // Use a 2D canvas to measure text width with the export font. This
  // doesn't paint cross-origin content, so no taint. Fallback to a
  // rough char-width estimate when canvas isn't available (jsdom in
  // some test setups).
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.font = `${LEGEND_FONT_SIZE}px ${SYSTEM_FONT_STACK}`
      return Math.ceil(ctx.measureText(label).width)
    }
  } catch { /* fall through */ }
  // ~6 px per char at 11 px Helvetica is a workable estimate.
  return Math.ceil(label.length * 6)
}

export function renderLegendSvg(items: LegendItem[], maxWidth: number, bg: BgOption): {
  svgString: string
  width: number
  height: number
} {
  if (items.length === 0) {
    // Empty legend → one-pixel SVG so downstream `Image` loaders don't
    // choke on zero-dim. Caller should ideally never reach this path.
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>`
    return { svgString, width: 1, height: 1 }
  }

  const fg = legendFgColor(bg)
  const widths = items.map((i) => LEGEND_SWATCH + LEGEND_SWATCH_GAP + measureLegendText(i.label))

  // Wrap items into rows at maxWidth, matching the live legend's
  // visual width. A single very-wide item still occupies its own row.
  const rows: number[][] = [[]]
  let curWidth = 0
  for (let i = 0; i < items.length; i++) {
    const w = widths[i]
    const cur = rows[rows.length - 1]
    if (cur.length === 0) {
      cur.push(i)
      curWidth = w
      continue
    }
    if (curWidth + LEGEND_ITEM_GAP + w <= maxWidth) {
      cur.push(i)
      curWidth += LEGEND_ITEM_GAP + w
    } else {
      rows.push([i])
      curWidth = w
    }
  }

  // Compute total dimensions. totalWidth is the widest row.
  const rowWidths = rows.map((row) =>
    row.reduce((acc, idx, j) => acc + widths[idx] + (j > 0 ? LEGEND_ITEM_GAP : 0), 0),
  )
  const totalWidth = Math.max(...rowWidths, 1)
  const totalHeight = rows.length * LEGEND_ROW_H

  // Emit `<rect>` + `<text>` per item. Text baseline is centered on
  // the row mid-line via dominant-baseline.
  let body = ''
  for (let ri = 0; ri < rows.length; ri++) {
    let x = 0
    const yMid = ri * LEGEND_ROW_H + LEGEND_ROW_H / 2
    for (let j = 0; j < rows[ri].length; j++) {
      const idx = rows[ri][j]
      if (j > 0) x += LEGEND_ITEM_GAP
      const item = items[idx]
      // Patch 4AE — defensive: never emit a rect with empty / "none" /
      // "transparent" fill. The extractor should already coerce to
      // #888 as a last-resort fallback, but transparent-background
      // PNG exports turn any non-painted rect into pure invisibility
      // with no visual hint that something went wrong. Belt-and-
      // suspenders: validate at the render boundary too.
      const safeColor = isTransparentColor(item.color) ? '#888' : item.color
      body += `<rect x="${x}" y="${yMid - LEGEND_SWATCH / 2}" `
        + `width="${LEGEND_SWATCH}" height="${LEGEND_SWATCH}" rx="2" `
        + `fill="${escapeXml(safeColor)}" />`
      body += `<text x="${x + LEGEND_SWATCH + LEGEND_SWATCH_GAP}" y="${yMid}" `
        + `font-family="${SYSTEM_FONT_STACK}" font-size="${LEGEND_FONT_SIZE}" `
        + `fill="${fg}" dominant-baseline="middle">${escapeXml(item.label)}</text>`
      x += widths[idx]
    }
  }

  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" `
    + `width="${totalWidth}" height="${totalHeight}" `
    + `viewBox="0 0 ${totalWidth} ${totalHeight}">${body}</svg>`
  return { svgString, width: totalWidth, height: totalHeight }
}

function serializeLegendForExport(legend: HTMLElement, bg: BgOption): {
  svgString: string
  width: number
  height: number
} {
  const items = extractLegendItems(legend)
  // Use the live legend's bounding-box width as the wrap point so the
  // exported SVG mirrors how the user sees it on screen — single line
  // legends export as single line, multi-line wrapping is preserved.
  const rect = legend.getBoundingClientRect()
  const liveWidth = Math.max(1, Math.ceil(rect.width || legend.clientWidth || 240))
  return renderLegendSvg(items, liveWidth, bg)
}

// Patch 5AF — horizontal x-offset that centers a legend of width `legendWidth`
// within the export's full `totalWidth`. Clamped to >= 0 so a legend wider than
// the export (shouldn't happen since totalWidth = max(chart, legend)) stays
// within the left margin rather than pushing off-edge. Pure (no DOM/layout) so
// the math is unit-testable — the SVG export has no jsdom layout engine.
export function centeredLegendX(totalWidth: number, legendWidth: number): number {
  return Math.max(0, Math.round((totalWidth - legendWidth) / 2))
}

function buildCombinedSvg(
  chartSvgString: string, chartWidth: number, chartHeight: number,
  legendSvgString: string, legendWidth: number, legendHeight: number,
): { svgString: string; width: number; height: number } {
  // Vertical stack: chart on top, legend below, with a small gap.
  // Strip the outer `<svg ...>` wrappers from the input strings — we
  // re-wrap each as a nested `<svg>` element with the original
  // dimensions but a positioned origin inside the parent.
  const GAP = 8
  const totalWidth = Math.max(chartWidth, legendWidth)
  const totalHeight = chartHeight + GAP + legendHeight
  // Patch 5AF — center the legend horizontally within the export's full width
  // (clamped to the left margin) instead of hugging the left edge. Layout only:
  // the legend's items/visible-only set are unchanged.
  const legendX = centeredLegendX(totalWidth, legendWidth)

  const innerChart = chartSvgString.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  const innerLegend = legendSvgString.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')

  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" `
    + `xmlns:xlink="http://www.w3.org/1999/xlink" `
    + `width="${totalWidth}" height="${totalHeight}" `
    + `viewBox="0 0 ${totalWidth} ${totalHeight}">`
    + `<svg x="0" y="0" width="${chartWidth}" height="${chartHeight}" `
    + `viewBox="0 0 ${chartWidth} ${chartHeight}" overflow="visible">${innerChart}</svg>`
    + `<svg x="${legendX}" y="${chartHeight + GAP}" width="${legendWidth}" height="${legendHeight}" `
    + `viewBox="0 0 ${legendWidth} ${legendHeight}" overflow="visible">${innerLegend}</svg>`
    + `</svg>`
  return { svgString, width: totalWidth, height: totalHeight }
}

export async function exportLegend(
  legend: HTMLElement,
  filenameBase: string,
  format: ExportFormat,
  bg: BgOption,
  scale: RasterScale = 2,
): Promise<void> {
  const { svgString, width, height } = serializeLegendForExport(legend, bg)
  const filename = buildFilename(filenameBase, format, scale, 'legend')
  if (format === 'svg') {
    triggerDownload(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }), filename)
    return
  }
  if (format === 'pdf') {
    const parser = new DOMParser()
    const docSvg = parser.parseFromString(svgString, 'image/svg+xml').documentElement as unknown as SVGSVGElement
    await svgToPdf(docSvg, svgString, width, height, bg, filename)
    return
  }
  await svgToRaster(svgString, width, height, bg, format, filename, scale)
}

export async function exportChartWithLegend(
  container: HTMLElement,
  legend: HTMLElement,
  filenameBase: string,
  format: ExportFormat,
  bg: BgOption,
  scale: RasterScale = 2,
): Promise<void> {
  const chartSvg = findChartSvg(container)
  if (!chartSvg) throw new Error('No <svg> found inside chart container')
  const { svgString: chartString, width: cw, height: ch } = serializeSvgForExport(chartSvg, bg)
  const { svgString: legendString, width: lw, height: lh } = serializeLegendForExport(legend, bg)
  const { svgString, width, height } = buildCombinedSvg(chartString, cw, ch, legendString, lw, lh)
  const filename = buildFilename(filenameBase, format, scale, 'combined')
  if (format === 'svg') {
    triggerDownload(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }), filename)
    return
  }
  if (format === 'pdf') {
    const parser = new DOMParser()
    const docSvg = parser.parseFromString(svgString, 'image/svg+xml').documentElement as unknown as SVGSVGElement
    await svgToPdf(docSvg, svgString, width, height, bg, filename)
    return
  }
  await svgToRaster(svgString, width, height, bg, format, filename, scale)
}

export async function exportChart(
  container: HTMLElement,
  filenameBase: string,
  format: ExportFormat,
  bg: BgOption,
  scale: RasterScale = 2,
  mode: ExportMode = 'chart',
): Promise<void> {
  const svg = findChartSvg(container)
  if (!svg) throw new Error('No <svg> found inside chart container')

  const { svgString, width, height } = serializeSvgForExport(svg, bg)
  const filename = buildFilename(filenameBase, format, scale, mode)

  if (format === 'svg') {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    triggerDownload(blob, filename)
    return
  }
  if (format === 'pdf') {
    await svgToPdf(svg, svgString, width, height, bg, filename)
    return
  }
  if (format === 'png' || format === 'jpeg') {
    await svgToRaster(svgString, width, height, bg, format, filename, scale)
    return
  }
}
