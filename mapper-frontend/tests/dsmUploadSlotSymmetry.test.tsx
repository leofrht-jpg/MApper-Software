import { describe, it, expect, vi } from 'vitest'
import { render, within } from '@testing-library/react'
import { DSMUploadSlot } from '../src/components/dsm/DSMUploadSlot'

/**
 * Annual inflows and Annual outflows are methodologically-parallel time-series
 * CSV inputs for stock dynamics. Their upload boxes must stay visually
 * symmetric: same header / status / action-prompt / schema-subtitle / Download
 * template / drop-zone structure, same drop-zone size, same Download-template
 * position. These tests lock that symmetry in as an invariant.
 */

const inflowsProps = {
  title: 'Annual inflows',
  status: 'Required to run simulation',
  uploadLabel: 'Upload inflow CSV',
  schemaSubtitle: 'year, dims…, count. Sets new units entering the stock each year.',
  onUpload: vi.fn(async () => ({ summary: 'ok' })),
  onDownloadTemplate: vi.fn(async () => {}),
}

const outflowsProps = {
  title: 'Annual outflows',
  status: 'Required for manual cohorts',
  uploadLabel: 'Upload outflow CSV',
  schemaSubtitle: 'year, dims…, count. Optional age / birth_year column targets a specific cohort.',
  onUpload: vi.fn(async () => ({ summary: 'ok' })),
  onDownloadTemplate: vi.fn(async () => {}),
}

function renderSlot(props: typeof inflowsProps) {
  const { container } = render(<DSMUploadSlot {...props} />)
  return container.querySelector('[data-testid="dsm-upload-slot"]') as HTMLElement
}

describe('DSMUploadSlot symmetry (inflows vs outflows)', () => {
  it('both boxes expose the same structural elements', () => {
    for (const props of [inflowsProps, outflowsProps]) {
      const slot = renderSlot(props)
      const scope = within(slot)
      // header
      expect(scope.getByText(props.title)).toBeTruthy()
      // status line
      expect(scope.getByText(props.status)).toBeTruthy()
      // action prompt
      expect(scope.getByText(props.uploadLabel)).toBeTruthy()
      // schema subtitle
      expect(scope.getByText(props.schemaSubtitle)).toBeTruthy()
      // Download template link
      expect(scope.getByText(/Download template/)).toBeTruthy()
      // drop-zone
      expect(slot.querySelector('[data-testid="csv-dropzone"]')).toBeTruthy()
    }
  })

  it('both drop-zones render at the same height', () => {
    const inflowsZone = renderSlot(inflowsProps).querySelector('[data-testid="csv-dropzone"]') as HTMLElement
    const outflowsZone = renderSlot(outflowsProps).querySelector('[data-testid="csv-dropzone"]') as HTMLElement
    expect(inflowsZone.style.minHeight).toBeTruthy()
    expect(inflowsZone.style.minHeight).toBe(outflowsZone.style.minHeight)
  })

  it('reserves equal subtitle-area height despite different subtitle text lengths', () => {
    // The two subtitles differ in length and wrap to different line counts at
    // narrow widths; a reserved min-height keeps the drop-zone starting at the
    // same vertical offset in both boxes.
    const inflowsSub = renderSlot(inflowsProps).querySelector('[data-testid="csv-subtitle"]') as HTMLElement
    const outflowsSub = renderSlot(outflowsProps).querySelector('[data-testid="csv-subtitle"]') as HTMLElement
    expect(inflowsSub.style.minHeight).toBeTruthy()
    expect(inflowsSub.style.minHeight).toBe(outflowsSub.style.minHeight)
    // Sanity: the two boxes genuinely carry different subtitle text — the equal
    // reservation is what makes them align, not identical content.
    expect(inflowsSub.textContent).not.toBe(outflowsSub.textContent)
  })

  it('both slots grow to fill a stretch-aligned grid cell (height backstop)', () => {
    for (const props of [inflowsProps, outflowsProps]) {
      const slot = renderSlot(props)
      // flexGrow lets align-items: stretch equalize box heights to the tallest sibling.
      expect(slot.style.flexGrow).toBe('1')
    }
  })

  it('Download template renders in the same relative position (before the drop-zone) in both boxes', () => {
    for (const props of [inflowsProps, outflowsProps]) {
      const slot = renderSlot(props)
      const download = within(slot).getByText(/Download template/).closest('button') as HTMLElement
      const dropzone = slot.querySelector('[data-testid="csv-dropzone"]') as HTMLElement
      // DOCUMENT_POSITION_FOLLOWING (4) means the drop-zone comes AFTER the download link.
      expect(download.compareDocumentPosition(dropzone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('every parallel input carries a one-line schema subtitle', () => {
    // Regression guard: the inflows box previously shipped without a schema
    // subtitle, breaking symmetry with outflows.
    for (const props of [inflowsProps, outflowsProps]) {
      const slot = renderSlot(props)
      expect(within(slot).getByText(props.schemaSubtitle)).toBeTruthy()
    }
  })
})
