/* SPDX-License-Identifier: MPL-2.0 */
import { describe, it, expect, vi } from 'vitest'
import { render, renderHook, fireEvent, waitFor } from '@testing-library/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  CHART_EXPORT_ATTR,
  NO_VECTOR_MESSAGE,
  findChartSvg,
} from '../src/components/charts/chartExport'
import { ChartExportButton } from '../src/components/charts/ChartExportButton'
import { StageBreakdownChart } from '../src/components/charts/StageBreakdownChart'
import { useNumberFormatter } from '../src/components/charts/numberFormat'
import { useRef } from 'react'

/**
 * These are the first tests findChartSvg has ever had, and they are only
 * possible because the rule stopped depending on layout: jsdom reports every
 * getBoundingClientRect as 0x0, so a largest-by-area rule was untestable here.
 */

function mount(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

describe('findChartSvg picks the chart, not whatever svg is lying around', () => {
  it('THE REGRESSION: a container of divs and chevrons yields NOTHING', () => {
    // The Contribution supply tree: indented divs plus lucide chevrons. The
    // old largest-by-area rule returned a 12px chevron, so the export
    // "succeeded" and wrote a chevron icon to disk as the user's contribution
    // tree. A file they might never open and check.
    const el = mount(`
      <div>
        <div><svg width="12" height="12" class="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg><span>market for steel</span></div>
        <div><svg width="12" height="12" class="lucide lucide-chevron-right"><path d="m9 18 6-6-6-6"/></svg><span>pig iron</span></div>
      </div>`)
    expect(findChartSvg(el)).toBeNull()
  })

  it('finds a Recharts surface without any opt-in', () => {
    const el = mount('<div><svg class="recharts-surface" width="400" height="300"></svg></div>')
    expect(findChartSvg(el)).not.toBeNull()
    expect(findChartSvg(el)!.getAttribute('class')).toContain('recharts-surface')
  })

  it('finds a hand-drawn svg that opts in', () => {
    const el = mount(`<div><svg ${CHART_EXPORT_ATTR} width="400" height="300"></svg></div>`)
    expect(findChartSvg(el)).not.toBeNull()
  })

  it('ignores icons even when they sit beside a real chart', () => {
    const el = mount(`
      <div>
        <svg width="14" height="14" class="lucide"><path d="M0 0"/></svg>
        <svg class="recharts-surface" width="400" height="300"><rect/></svg>
      </div>`)
    const found = findChartSvg(el)!
    expect(found.getAttribute('class')).toContain('recharts-surface')
  })

  it('a hand-drawn chart that FORGETS the marker fails loudly, not silently', () => {
    // The trade the opt-in rule makes: omission produces an error on the first
    // click rather than a plausible-looking wrong file. A size threshold would
    // have guessed instead, and guessed wrong the moment someone dropped a
    // large decorative graphic into a chart card.
    const el = mount('<div><svg width="400" height="300"><rect/></svg></div>')
    expect(findChartSvg(el)).toBeNull()
  })
})

describe('div-based charts export as raster, and say so', () => {
  it('hides the vector formats so nobody picks one and gets an error', () => {
    function Harness({ rasterOnly }: { rasterOnly: boolean }) {
      const ref = useRef<HTMLDivElement>(null)
      return (
        <div>
          <div ref={ref} />
          <ChartExportButton chartRef={ref} filename="x" rasterOnly={rasterOnly} />
        </div>
      )
    }
    const { container, rerender } = render(<Harness rasterOnly={false} />)
    fireEvent.click(container.querySelector('button')!)
    expect(container.textContent).toContain('SVG (vector)')
    expect(container.textContent).toContain('PDF (vector)')

    rerender(<Harness rasterOnly />)
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('SVG (vector)')
    expect(txt).not.toContain('PDF (vector)')
    // Raster formats stay.
    expect(txt).toContain('PNG')
    expect(txt).toContain('JPEG')
  })

  it('the error names something the user can act on', () => {
    // Not "No <svg> found inside chart container", which names an internal
    // precondition and tells the user nothing to do.
    expect(NO_VECTOR_MESSAGE).toMatch(/try png/i)
    expect(NO_VECTOR_MESSAGE).not.toMatch(/<svg>|container|precondition/i)
  })

  it('the four div-based charts all opt in to rasterOnly', async () => {
    // Source-level, because rendering all four needs four prop shapes. The
    // point is that none is left offering a vector format that cannot work.
    const files = [
      'src/components/charts/StageBreakdownChart.tsx',
      'src/components/charts/SensitivityRangeChart.tsx',
      'src/components/charts/MultiProductSensitivityChart.tsx',
      'src/components/lca/ContributionAnalysisPanel.tsx',
    ]
    const { readFileSync } = await import('node:fs')
    for (const f of files) {
      expect(readFileSync(f, 'utf-8'), `${f} must pass rasterOnly`).toContain('rasterOnly')
    }
  })
})

describe('the supply tree rasterises the TREE, not a chevron', () => {
  it('html2canvas is handed the tree container itself', async () => {
    // The regression in its strongest form. It is not enough that the old
    // rule stopped returning a chevron: the replacement has to paint the
    // actual tree. Asserting the element handed to html2canvas is the
    // container holding the tree rows, and that its own size dwarfs the 12px
    // icons that used to win.
    const captured: HTMLElement[] = []
    vi.doMock('html2canvas', () => ({
      default: (el: HTMLElement) => {
        captured.push(el)
        return Promise.resolve({
          width: 800, height: 520,
          toBlob: (cb: (b: Blob) => void) => cb(new Blob(['x'], { type: 'image/png' })),
        })
      },
    }))
    vi.resetModules()
    const { exportContainerAsRaster } = await import('../src/components/charts/chartExport')

    const tree = mount(`
      <div id="supply-tree">
        <div><svg width="12" height="12" class="lucide"><path d="m6 9 6 6 6-6"/></svg><span>market for steel</span></div>
        <div><svg width="12" height="12" class="lucide"><path d="m9 18 6-6-6-6"/></svg><span>pig iron</span></div>
        <div><span>iron ore</span></div>
      </div>`)

    const clicks: string[] = []
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: () => clicks.push((el as HTMLAnchorElement).download) })
      }
      return el
    })
    // jsdom has no URL.createObjectURL
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:x', writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true })

    await exportContainerAsRaster(tree, 'contribution_tree', 'png', 'light', 2)

    expect(captured).toHaveLength(1)
    // THE container that was passed in, not one of its icons.
    expect(captured[0]).toBe(tree)
    expect(captured[0].tagName).toBe('DIV')
    expect(captured[0].querySelector('#supply-tree')).not.toBeNull()
    expect(captured[0].textContent).toContain('market for steel')
    expect(captured[0].textContent).toContain('iron ore')
    // And what was rasterised is not a 12px icon.
    expect(captured[0].querySelectorAll('svg.lucide').length).toBe(2)
    expect(clicks[0]).toMatch(/contribution_tree.*\.png$/)

    vi.restoreAllMocks()
    vi.doUnmock('html2canvas')
  })

  it('refuses a vector format with the actionable message', async () => {
    const { exportContainerAsRaster } = await import('../src/components/charts/chartExport')
    const el = mount('<div><span>tree</span></div>')
    await expect(exportContainerAsRaster(el, 'x', 'svg', 'light')).rejects.toThrow(/try png/i)
  })
})

describe('every export-bearing chart resolves to something', () => {
  it('is either svg-based or declared rasterOnly', async () => {
    // The guard that protects charts added after today. A new chart whose
    // container holds no marked svg AND does not declare rasterOnly would
    // throw on first click; this fails in CI instead.
    const { readFileSync } = await import('node:fs')
    const { execSync } = await import('node:child_process')
    const files = execSync('grep -rl "<ChartExportButton" --include="*.tsx" src/', { encoding: 'utf-8' })
      .trim().split('\n')
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf-8')
      const svgBased = /recharts|ResponsiveContainer|data-chart-export-target|<(Line|Bar|Area|Composed|Radar|Pie|Scatter)Chart|<Treemap|<Sankey|SankeyChart|StageBreakdownChart|MultiScenarioImpactChart|UncertaintyBoxPlot|BoxPlotView|RadarView/.test(src)
      const raster = src.includes('rasterOnly')
      if (!svgBased && !raster) offenders.push(f)
    }
    expect(offenders, `these have an export button with no resolvable chart: ${offenders.join(', ')}`)
      .toEqual([])
  })
})

describe('Stage breakdown', () => {
  it('offers PNG but not SVG', () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { container } = render(
      <StageBreakdownChart
        stageBreakdown={{ m: { Manufacturing: 300 } }}
        methods={[{ method_label: 'm', score: 300, unit: 'kg' }]}
        format={result.current} filenameBase="x" />,
    )
    fireEvent.click(container.querySelectorAll('button')[container.querySelectorAll('button').length - 1])
    const txt = container.textContent ?? ''
    expect(txt).toContain('PNG')
    expect(txt).not.toContain('SVG (vector)')
  })

  it('no longer surfaces the internal precondition', async () => {
    const { result } = renderHook(() => useNumberFormatter())
    const { container } = render(
      <StageBreakdownChart
        stageBreakdown={{ m: { Manufacturing: 300 } }}
        methods={[{ method_label: 'm', score: 300, unit: 'kg' }]}
        format={result.current} filenameBase="x" />,
    )
    const btns = container.querySelectorAll('button')
    fireEvent.click(btns[btns.length - 1])
    const png = Array.from(container.querySelectorAll('button')).find((b) => /PNG/.test(b.textContent ?? ''))!
    fireEvent.click(png)
    await new Promise((r) => setTimeout(r, 300))
    expect(container.textContent).not.toContain('No <svg> found')
  })
})
