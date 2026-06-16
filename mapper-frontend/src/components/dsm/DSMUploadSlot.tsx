import { CSVUploader } from './CSVUploader'

/**
 * Vertical space reserved for the schema-subtitle row, covering two wrapped
 * lines at the subtitle font-size (line-height 1.4). The parallel inflows /
 * outflows subtitles differ in length and wrap to different line counts; the
 * reservation keeps the drop-zone starting at the same offset in both boxes.
 */
const SUBTITLE_MIN_HEIGHT = '2.8em'

interface DSMUploadSlotProps {
  /** Box header, e.g. "Annual inflows". */
  title: string
  /** Status line under the header (one consistent pattern across parallel inputs). */
  status: string
  /** Action prompt on the uploader, e.g. "Upload inflow CSV". */
  uploadLabel: string
  /** One-line CSV schema description. */
  schemaSubtitle: string
  onUpload: (file: File) => Promise<{ summary: string }>
  onDownloadTemplate: () => Promise<void>
}

/**
 * Unified upload box for the methodologically-parallel time-series CSV inputs
 * on the DSM Dashboard (Annual inflows, Annual outflows). Both feed stock
 * dynamics from the same kind of data stream, so they share one layout:
 * header → status line → action prompt → schema subtitle → Download template
 * (top-right of the uploader header) → drop-zone.
 *
 * Keeping them in one component enforces visual symmetry by construction — the
 * two boxes cannot drift apart as their copy evolves.
 */
export function DSMUploadSlot({
  title,
  status,
  uploadLabel,
  schemaSubtitle,
  onUpload,
  onDownloadTemplate,
}: DSMUploadSlotProps) {
  return (
    <div
      data-testid="dsm-upload-slot"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        // Grow to fill a stretch-aligned grid cell so parallel boxes equalize
        // to the tallest sibling (backstop to the subtitle-area reservation).
        flexGrow: 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{status}</div>
        </div>
      </div>
      <CSVUploader
        label={uploadLabel}
        description={schemaSubtitle}
        descriptionMinHeight={SUBTITLE_MIN_HEIGHT}
        onUpload={onUpload}
        onDownloadTemplate={onDownloadTemplate}
      />
    </div>
  )
}
