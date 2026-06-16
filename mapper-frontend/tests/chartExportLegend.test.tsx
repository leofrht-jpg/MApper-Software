import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { ChartExportButton } from '../src/components/charts/ChartExportButton'
import * as chartExport from '../src/components/charts/chartExport'

// Patch 4I — Export-Legend affordance on charts. The button opens a
// menu; when the chart provides a legend (via legendRef or
// legendSelector) the menu adds a Mode picker (Chart only / Legend only
// / Chart + Legend). When neither is provided the menu keeps its
// chart-only shape and routes through the original exportChart path
// with no filename suffix — preserving backward compat for every
// existing single-line chart.

beforeEach(() => {
  // Reset call counts between tests; spy on a freshly-cleared module so
  // assertions like "called once" don't accumulate across tests in the
  // same file.
  vi.restoreAllMocks()
  vi.spyOn(chartExport, 'exportChart').mockResolvedValue(undefined)
  vi.spyOn(chartExport, 'exportLegend').mockResolvedValue(undefined)
  vi.spyOn(chartExport, 'exportChartWithLegend').mockResolvedValue(undefined)
})

function ChartOnlyHarness() {
  const chartRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={chartRef} data-testid="chart-container" />
      <ChartExportButton chartRef={chartRef} filename="x" />
    </>
  )
}

function ChartWithLegendHarness() {
  const chartRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={chartRef} data-testid="chart-container" />
      <div ref={legendRef} data-testid="legend">legend content</div>
      <ChartExportButton chartRef={chartRef} legendRef={legendRef} filename="x" />
    </>
  )
}

function ChartWithRechartsLegendHarness() {
  const chartRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={chartRef} data-testid="chart-container">
        {/* Simulates Recharts' default legend wrapper. */}
        <div className="recharts-legend-wrapper">recharts legend</div>
      </div>
      <ChartExportButton
        chartRef={chartRef}
        legendSelector=".recharts-legend-wrapper"
        filename="x"
      />
    </>
  )
}

describe('ChartExportButton — legend export (Patch 4I)', () => {
  it('hides the Mode picker when no legend affordance is provided', () => {
    const { getByRole, queryByTestId } = render(<ChartOnlyHarness />)
    fireEvent.click(getByRole('button'))
    // Mode picker absent → legend-only / chart+legend cannot be reached
    // for charts without a legend (per the "don't ship Export Legend on
    // charts without a legend" anti-pattern).
    expect(queryByTestId('chart-export-mode-chart')).toBeNull()
    expect(queryByTestId('chart-export-mode-legend')).toBeNull()
    expect(queryByTestId('chart-export-mode-combined')).toBeNull()
  })

  it('routes chart-only to exportChart with no filename suffix when no legend', () => {
    const { getByRole, getByText } = render(<ChartOnlyHarness />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByText('PNG (2×)'))
    expect(chartExport.exportChart).toHaveBeenCalled()
    // No legend export functions touched.
    expect(chartExport.exportLegend).not.toHaveBeenCalled()
    expect(chartExport.exportChartWithLegend).not.toHaveBeenCalled()
    // Calling with default mode (no 6th arg, or anything other than
    // 'chart') means buildFilename omits the _chart suffix. Verified
    // structurally — the call has 5 args, not 6 with mode='chart'.
    const call = (chartExport.exportChart as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[5]).toBeUndefined()
  })

  it('shows the Mode picker when legendRef is provided', () => {
    const { getByRole, getByTestId } = render(<ChartWithLegendHarness />)
    fireEvent.click(getByRole('button'))
    expect(getByTestId('chart-export-mode-combined')).toBeInTheDocument()
    expect(getByTestId('chart-export-mode-chart')).toBeInTheDocument()
    expect(getByTestId('chart-export-mode-legend')).toBeInTheDocument()
  })

  it('routes "Legend only" through exportLegend with the legend element', () => {
    const { getByRole, getByText, getByTestId } = render(<ChartWithLegendHarness />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByTestId('chart-export-mode-legend'))
    fireEvent.click(getByText('PNG (2×)'))
    expect(chartExport.exportLegend).toHaveBeenCalledTimes(1)
    expect(chartExport.exportChart).not.toHaveBeenCalled()
    expect(chartExport.exportChartWithLegend).not.toHaveBeenCalled()
    // First arg is the legend HTMLElement (not the chart container) —
    // the load-bearing routing assertion the brief calls out.
    const legendArg = (chartExport.exportLegend as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(legendArg).toBe(getByTestId('legend'))
  })

  it('routes "Chart + Legend" through exportChartWithLegend (default mode)', () => {
    const { getByRole, getByText } = render(<ChartWithLegendHarness />)
    fireEvent.click(getByRole('button'))
    // Default mode is 'combined' — clicking PNG without changing mode
    // routes through the composite exporter.
    fireEvent.click(getByText('PNG (2×)'))
    expect(chartExport.exportChartWithLegend).toHaveBeenCalledTimes(1)
    expect(chartExport.exportChart).not.toHaveBeenCalled()
    expect(chartExport.exportLegend).not.toHaveBeenCalled()
  })

  it('routes "Chart only" through exportChart with mode="chart" (suffix _chart)', () => {
    const { getByRole, getByText, getByTestId } = render(<ChartWithLegendHarness />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByTestId('chart-export-mode-chart'))
    fireEvent.click(getByText('PNG (2×)'))
    expect(chartExport.exportChart).toHaveBeenCalledTimes(1)
    // 6th arg ('mode') === 'chart' so filename gets the _chart suffix.
    const call = (chartExport.exportChart as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[5]).toBe('chart')
  })

  it('resolves Recharts-internal legend via legendSelector', () => {
    const { getByRole, getByText, getByTestId } = render(<ChartWithRechartsLegendHarness />)
    fireEvent.click(getByRole('button'))
    fireEvent.click(getByTestId('chart-export-mode-legend'))
    fireEvent.click(getByText('PNG (2×)'))
    expect(chartExport.exportLegend).toHaveBeenCalledTimes(1)
    const legendArg = (chartExport.exportLegend as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // The query selector resolved to the recharts-legend-wrapper div.
    expect(legendArg).toBeTruthy()
    expect((legendArg as HTMLElement).className).toContain('recharts-legend-wrapper')
  })
})

describe('chartExport buildFilename mode discriminator', () => {
  it('appends _chart for mode="chart"', () => {
    expect(chartExport.buildFilename('foo', 'png', 2, 'chart')).toBe('mapper_foo_chart@2x.png')
  })

  it('appends _legend for mode="legend"', () => {
    expect(chartExport.buildFilename('foo', 'png', 2, 'legend')).toBe('mapper_foo_legend@2x.png')
  })

  it('omits suffix for mode="combined" (chart + legend default)', () => {
    expect(chartExport.buildFilename('foo', 'png', 2, 'combined')).toBe('mapper_foo@2x.png')
  })

  it('omits suffix when mode is undefined (legacy single-mode callers)', () => {
    expect(chartExport.buildFilename('foo', 'png', 2)).toBe('mapper_foo@2x.png')
  })
})
