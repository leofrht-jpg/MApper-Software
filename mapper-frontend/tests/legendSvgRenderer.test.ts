import { describe, it, expect } from 'vitest'
import { renderLegendSvg, extractLegendItems } from '../src/components/charts/chartExport'

// Patch 4K — SVG-native legend renderer. Replaces the Patch 4I
// `<foreignObject>` strategy which tainted the canvas in production:
// MApper's HTML legend inherited `font-family: Geist` from the page,
// the foreignObject tried to fetch the font cross-origin during
// rasterisation, and `toBlob` then refused to export the tainted
// canvas. Native SVG `<rect>` + `<text>` with a system-font stack
// avoids the issue entirely.

describe('renderLegendSvg', () => {
  it('emits one <rect> and one <text> per legend item', () => {
    const { svgString } = renderLegendSvg(
      [
        { color: '#14b8a6', label: 'BEV-LFP' },
        { color: '#f97316', label: 'PHEV' },
      ],
      400,
      'light',
    )
    // Two swatches + two labels.
    expect((svgString.match(/<rect /g) ?? []).length).toBe(2)
    expect((svgString.match(/<text /g) ?? []).length).toBe(2)
    // Colors and labels round-trip exactly (no font-resolution path).
    expect(svgString).toContain('fill="#14b8a6"')
    expect(svgString).toContain('fill="#f97316"')
    expect(svgString).toContain('>BEV-LFP<')
    expect(svgString).toContain('>PHEV<')
  })

  it('uses a system-font stack — never references external fonts', () => {
    const { svgString } = renderLegendSvg(
      [{ color: '#000', label: 'A' }],
      100,
      'light',
    )
    expect(svgString).toContain('font-family="Helvetica, Arial, sans-serif"')
    // Critical regression guard: Geist (loaded from fonts.gstatic.com)
    // must never reach the export pipeline. If it ever does, the
    // canvas-tainting bug returns.
    expect(svgString).not.toMatch(/Geist/i)
    expect(svgString).not.toMatch(/googleapis|gstatic/i)
  })

  it('escapes XML special characters in labels', () => {
    const { svgString } = renderLegendSvg(
      [{ color: '#000', label: 'A & B <c> "d"' }],
      400,
      'light',
    )
    // Raw `<` would break the SVG; escape required.
    expect(svgString).toContain('A &amp; B &lt;c&gt; &quot;d&quot;')
    expect(svgString).not.toContain('<c>')
  })

  it('renders an empty placeholder for zero items', () => {
    const { svgString, width, height } = renderLegendSvg([], 100, 'light')
    expect(width).toBe(1)
    expect(height).toBe(1)
    expect(svgString).toContain('<svg')
    expect(svgString).not.toContain('<rect')
  })

  it('wraps items into multiple rows when they exceed maxWidth', () => {
    const items = [
      { color: '#aaa', label: 'aaaaaaaaaaaaaa' },
      { color: '#bbb', label: 'bbbbbbbbbbbbbb' },
      { color: '#ccc', label: 'cccccccccccccc' },
      { color: '#ddd', label: 'dddddddddddddd' },
    ]
    // Tight maxWidth (50px) forces every item onto its own row.
    const { svgString, height: tightH } = renderLegendSvg(items, 50, 'light')
    // 4 items × 18 px row height (LEGEND_ROW_H).
    expect(tightH).toBe(4 * 18)
    expect((svgString.match(/<rect /g) ?? []).length).toBe(4)

    // Wide maxWidth (4000px) fits everything on one row.
    const { height: wideH } = renderLegendSvg(items, 4000, 'light')
    expect(wideH).toBe(18)
  })

  it('switches text fill color based on background mode', () => {
    const items = [{ color: '#999', label: 'X' }]
    const { svgString: lightSvg } = renderLegendSvg(items, 100, 'light')
    const { svgString: darkSvg } = renderLegendSvg(items, 100, 'dark')
    // Live `<text fill="...">` color differs between light/dark.
    const lightFill = lightSvg.match(/<text [^>]*fill="([^"]+)"/)?.[1]
    const darkFill = darkSvg.match(/<text [^>]*fill="([^"]+)"/)?.[1]
    expect(lightFill).toBeTruthy()
    expect(darkFill).toBeTruthy()
    expect(lightFill).not.toBe(darkFill)
  })
})

describe('extractLegendItems', () => {
  it('reads color + label from a custom HTML legend block', () => {
    document.body.innerHTML = `
      <div id="legend">
        <span><span style="background-color: rgb(20, 184, 166)"></span><span>BEV-LFP</span></span>
        <span><span style="background-color: rgb(249, 115, 22)"></span><span>PHEV</span></span>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    const items = extractLegendItems(legend)
    expect(items).toHaveLength(2)
    expect(items[0].label).toBe('BEV-LFP')
    expect(items[1].label).toBe('PHEV')
    // Colors come from getComputedStyle which normalizes to rgb form.
    expect(items[0].color.replace(/\s+/g, '')).toContain('20,184,166')
    expect(items[1].color.replace(/\s+/g, '')).toContain('249,115,22')
  })

  it('reads a Recharts default legend (ul.recharts-default-legend)', () => {
    document.body.innerHTML = `
      <div id="legend">
        <ul class="recharts-default-legend">
          <li class="recharts-legend-item"><span style="background-color: rgb(0, 150, 0)"></span><span>Series A</span></li>
          <li class="recharts-legend-item"><span style="background-color: rgb(150, 0, 0)"></span><span>Series B</span></li>
        </ul>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    const items = extractLegendItems(legend)
    expect(items).toHaveLength(2)
    expect(items[0].label).toBe('Series A')
    expect(items[1].label).toBe('Series B')
  })

  it('falls back to a sentinel color when no swatch is found', () => {
    document.body.innerHTML = `
      <div id="legend">
        <span><span>Just text, no swatch</span></span>
      </div>
    `
    const legend = document.getElementById('legend') as HTMLElement
    const items = extractLegendItems(legend)
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('Just text, no swatch')
    // Last-resort fallback so the row still appears in the export.
    expect(items[0].color).toBe('#888')
  })
})
