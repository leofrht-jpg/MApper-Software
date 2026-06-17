import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Carbon-budget inset — NO chart title (per Leo). History: a rotated YAxis
// <Label> (angle -90) clipped; an HTML caption was absent from export; an
// in-svg <Customized> <text> survived export — then the title was removed
// entirely. The chart shows axes + data only. This test now GUARDS that no
// title creeps back (rotated, svg <text>, or HTML caption) and pins the
// margin.top headroom that keeps the top tick from clipping.
//
// Recharts renders nothing in jsdom, so these are SOURCE-LEVEL checks; the real
// check is eyeballing a fresh export.

const dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(dir, '..', 'src/components/aesa/TimelineView.tsx'), 'utf8')

// Isolate the CarbonBudgetInset, then split at the LineChart (`data={series}`):
// `aboveChart` is the HTML caption/header area; `chartBlock` is the svg chart.
const insetBlock = src.slice(src.indexOf('function CarbonBudgetInset'))
const chartStart = insetBlock.indexOf('data={series}')
const aboveChart = insetBlock.slice(0, chartStart)
const chartBlock = insetBlock.slice(chartStart)

describe('AESA carbon-budget inset has NO chart title (per Leo)', () => {
  it('no title anywhere — not in the chart svg, not as an HTML caption', () => {
    expect(insetBlock).not.toContain('Global remaining budget')
  })

  it('no svg <text> title and no rotated angle:-90 label in the chart', () => {
    expect(chartBlock).not.toMatch(/<text\b/)
    expect(chartBlock).not.toMatch(/angle:\s*-90/)
    expect(chartBlock).not.toMatch(/<Customized\b/)
  })

  it('keeps the methodological note (a caveat, not a title)', () => {
    expect(aboveChart).toContain('Based on projected global emissions')
  })

  it('margin.top 12 gives the top tick headroom (clipped at the original 2)', () => {
    expect(chartBlock).toMatch(/margin=\{\{\s*top:\s*12\b/)
  })
})
