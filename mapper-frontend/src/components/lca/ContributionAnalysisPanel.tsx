/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, Download, Info, Loader2, X,
} from 'lucide-react'
import { SearchInput } from '../ui/SearchInput'
import { Button } from '../ui/Button'
import { CollapsibleCard } from '../ui/CollapsibleCard'
import { ComputeProgress } from '../ui/ComputeProgress'
import { ChartExportButton } from '../charts/ChartExportButton'
import { ChartExportContainer } from '../charts/ChartExportContainer'
import { NumberFormatControl } from '../charts/NumberFormatControl'
import { useNumberFormatter } from '../charts/numberFormat'
import { SankeyChart } from '../charts/SankeyChart'
import {
  exportContributionAnalysis,
  type BiosphereContributionItem,
  type ContributionAnalysisResult,
  type ContributionItem,
  type ContributionTreeNode,
} from '../../api/client'

type TopN = 5 | 10 | 20 | 'all'
type Tab = 'activities' | 'flows' | 'supply' | 'stage'
type SupplyView = 'tree' | 'sankey'
type Cutoff = 0.001 | 0.01 | 0.05
type Depth = 1 | 2 | 3 | 4 | 5

interface Props {
  result: ContributionAnalysisResult
  /** Phase label rendered when result is being recomputed (depth/cutoff change). */
  loadingPhase?: string | null
  /** When set, render a live M:SS counter next to the loading-phase banner. */
  loadingStartedAt?: number | null
  /** Optional stage breakdown (only meaningful for archetype targets). */
  stageBreakdown?: Array<{ stage: string; impact: number; percentage: number; topName?: string }>
  /** True when this panel is rendered inside MultiYearTrajectoryPanel's
   *  Snapshot tab — the outer multi-year card's Excel button is visible at
   *  the same time, so we relabel both to disambiguate. */
  nestedInMultiYear?: boolean
}

/** Compress a fully-qualified prospective DB name like
 *  ``ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150_2030`` into a
 *  human-friendly tag (``REMIND SSP2-PkBudg1150 · 2030``) for the result
 *  metadata line. The full name stays available as the element's tooltip. */
function shortenComputeDatabaseLabel(name: string, fallbackYear: number | null): string {
  const m = name.match(/_premise_([a-z0-9-]+)_(.+?)(?:_(\d{4}))?$/i)
  if (!m) return name
  const iam = m[1].toUpperCase()
  const ssp = m[2].toUpperCase()
  const year = m[3] ?? (fallbackYear != null ? String(fallbackYear) : null)
  return year ? `${iam} ${ssp} · ${year}` : `${iam} ${ssp}`
}


export function ContributionAnalysisPanel({ result, loadingPhase, stageBreakdown, nestedInMultiYear = false }: Props) {
  const isArchetype = result.target_type === 'archetype'
  const [tab, setTab] = useState<Tab>('activities')
  const [supplyView, setSupplyView] = useState<SupplyView>('tree')
  const [topN, setTopN] = useState<TopN>(10)
  const [query, setQuery] = useState('')
  const [activeActivity, setActiveActivity] = useState<ContributionItem | null>(null)
  const [activeFlow, setActiveFlow] = useState<BiosphereContributionItem | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Client-side filters applied to the cached deepest tree.
  const [depth, setDepth] = useState<Depth>(Math.min(3, result.max_depth) as Depth)
  const [cutoff, setCutoff] = useState<Cutoff>(0.01)

  // Default expanded after a fresh Calculate; identity of `result` changes
  // each recompute so this resets correctly.
  const [expanded, setExpanded] = useState(true)
  useEffect(() => { setExpanded(true) }, [result])

  const supplyTreeRef = useRef<HTMLDivElement>(null)
  const sankeyRef = useRef<HTMLDivElement>(null)

  // Single panel-wide formatter — applied to the headline score, top-activity
  // and top-flow tables, supply-chain tree node scores, by-stage rows, and
  // detail popovers. Scope is per panel (per ContributionAnalysisPanel
  // instance), not per chart; the values share a unit and rendering them
  // inconsistently inside one analysis would be confusing.
  const valueFormat = useNumberFormatter()

  const handleExport = async () => {
    setExporting(true)
    try {
      const safe = (result.target_label || 'target').replace(/[^\w.-]+/g, '_').slice(0, 40)
      const date = new Date().toISOString().slice(0, 10)
      await exportContributionAnalysis(result, `MApper_LCA_Contribution_${safe}_${date}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  const filteredTree = useMemo(
    () => trimTree(result.supply_chain_tree, depth, cutoff),
    [result.supply_chain_tree, depth, cutoff],
  )

  const methodShort = result.method[result.method.length - 1] || result.method.join(' › ')
  const summary = (
    <>
      <span style={{ color: 'var(--text-tertiary)' }}>{methodShort}</span>
    </>
  )
  const exportLabel = nestedInMultiYear ? 'Export single-year XLSX' : 'Export XLSX'
  const exportTitle = nestedInMultiYear
    ? 'Download single-year contribution analysis as Excel'
    : undefined

  return (
    <CollapsibleCard
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      title="Contribution analysis"
      summary={summary}
    >
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }}>
        {result.target_label}{result.scope && result.scope !== 'all' ? ` — scope: ${result.scope}` : ''}
        {result.year != null ? ` — year: ${result.year}` : ''}
        <span style={{ marginLeft: 8 }}>· {result.method.join(' › ')}</span>
        {result.compute_database && (
          <span
            style={{ marginLeft: 8 }}
            title={result.compute_database}
          >
            · {shortenComputeDatabaseLabel(result.compute_database, result.year)}
          </span>
        )}
        {result.elapsed_seconds > 0 && (
          <span style={{ marginLeft: 8 }} title="Wall-clock computation time">
            · {result.elapsed_seconds.toFixed(2)}s
          </span>
        )}
      </div>

      {/* Method box — shows the active LCIA method + impact value, with the
          export button anchored to it so its scope (single-year contribution
          analysis) is visually unambiguous. */}
      <div style={methodBoxStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0,
            fontSize: 'var(--text-xs)', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {result.method.join(' › ')}
          </p>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{
              fontSize: 'var(--text-2xl)', fontFamily: 'var(--font-mono)',
              fontWeight: 700, color: 'var(--accent)',
            }}>
              {valueFormat.format(result.score)}
            </span>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {result.method_unit}
            </span>
          </div>
        </div>
        <NumberFormatControl settings={valueFormat.settings} onChange={valueFormat.setSettings} />
        <Button
          onClick={handleExport}
          disabled={exporting}
          variant="secondary"
          title={exportTitle}
        >
          {exporting ? <Loader2 size={14} className="lca-spin" /> : <Download size={14} />}
          <span style={{ marginLeft: 6 }}>{exportLabel}</span>
        </Button>
      </div>

      {result.warnings && result.warnings.length > 0 && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 12px',
            marginBottom: 'var(--space-3)',
            backgroundColor: 'color-mix(in srgb, #f59e0b 12%, transparent)',
            border: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-primary)',
          }}
        >
          <span
            style={{
              flexShrink: 0,
              padding: '1px 6px',
              borderRadius: 999,
              backgroundColor: '#f59e0b',
              color: '#1f1300',
              fontWeight: 700,
            }}
          >
            {result.warnings.length}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.5 }}>
            <strong>Partial database translation</strong>
            {result.warnings.slice(0, 5).map((w, i) => (
              <span key={i} style={{ color: 'var(--text-secondary)' }}>{w}</span>
            ))}
            {result.warnings.length > 5 && (
              <span style={{ color: 'var(--text-tertiary)' }}>
                …and {result.warnings.length - 5} more.
              </span>
            )}
          </div>
        </div>
      )}

      <div style={cardStyle}>
      <ComputeProgress
        active={!!loadingPhase}
        label={loadingPhase ?? ''}
        bar="none"
        data-testid="contribution-progress"
        style={{ margin: 'var(--space-3) var(--space-5)' }}
      />

      {/* Tab strip */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}>
        {([
          ['activities', 'Top activities'],
          ['flows', 'Top flows'],
          ['supply', 'Supply chain'],
          ...(isArchetype ? ([['stage', 'By stage']] as const) : ([] as const)),
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '0 var(--space-5)', height: 38, background: 'none', border: 'none',
              borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 500,
              color: tab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {label}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, paddingRight: 12 }}>
          {(tab === 'activities' || tab === 'flows') && (
            <>
              <div style={{ width: 220 }}>
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder={tab === 'activities' ? 'Search activity…' : 'Search flow…'}
                  size="sm"
                />
              </div>
              <TopNSwitch value={topN} onChange={setTopN} />
            </>
          )}
          {tab === 'supply' && (
            <>
              <DepthSelect value={depth} onChange={setDepth} max={result.max_depth} />
              <CutoffSelect value={cutoff} onChange={setCutoff} />
              <SegmentedToggle
                value={supplyView}
                onChange={setSupplyView}
                options={[['tree', 'Tree'], ['sankey', 'Sankey']]}
              />
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
        {tab === 'activities' && (
          <ContributionTable
            kind="activities"
            items={result.top_technosphere.items}
            restAmount={result.top_technosphere.rest_amount}
            restPercentage={result.top_technosphere.rest_percentage}
            unit={result.method_unit}
            topN={topN}
            query={query}
            onPick={(it) => setActiveActivity(it as ContributionItem)}
            formatValue={valueFormat.format}
          />
        )}
        {tab === 'flows' && (
          <ContributionTable
            kind="flows"
            items={result.top_biosphere}
            restAmount={result.biosphere_rest_amount}
            restPercentage={result.biosphere_rest_percentage}
            unit={result.method_unit}
            topN={topN}
            query={query}
            onPick={(it) => setActiveFlow(it as BiosphereContributionItem)}
            formatValue={valueFormat.format}
          />
        )}
        {tab === 'supply' && supplyView === 'tree' && (
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: -4, right: 4, zIndex: 5 }}>
              <ChartExportButton chartRef={supplyTreeRef} filename={`contribution_tree_${result.method.join('_')}`} />
            </div>
            <ChartExportContainer ref={supplyTreeRef} style={{ maxHeight: 520, overflow: 'auto', paddingTop: 4 }}>
              <SupplyChainTree node={filteredTree} unit={result.method_unit} formatValue={valueFormat.format} />
            </ChartExportContainer>
          </div>
        )}
        {tab === 'supply' && supplyView === 'sankey' && (
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: -4, right: 4, zIndex: 5 }}>
              <ChartExportButton chartRef={sankeyRef} filename={`contribution_sankey_${result.method.join('_')}`} />
            </div>
            {result.supply_chain_sankey.truncated && (
              <div
                role="status"
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-tertiary)',
                  padding: '4px 8px',
                  marginBottom: 6,
                  backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Showing top {result.supply_chain_sankey.nodes.length} of {result.supply_chain_sankey.total_nodes_discovered ?? result.supply_chain_sankey.nodes.length} nodes by impact contribution.
              </div>
            )}
            <ChartExportContainer ref={sankeyRef} style={{ height: 460 }}>
              <SankeyChart data={result.supply_chain_sankey} />
            </ChartExportContainer>
          </div>
        )}
        {tab === 'stage' && (
          <ByStageView rows={stageBreakdown ?? []} unit={result.method_unit} formatValue={valueFormat.format} />
        )}

        <MethodologyNote
          open={showAbout}
          onToggle={() => setShowAbout((v) => !v)}
          cutoff={cutoff}
          depth={depth}
          serverCutoff={result.cutoff}
          serverMaxDepth={result.max_depth}
          isMultiYear={nestedInMultiYear}
        />
      </div>

      {activeActivity && (
        <DetailPopover title={activeActivity.activity_name} onClose={() => setActiveActivity(null)}>
          <Row label="Key" value={activeActivity.activity_key} />
          <Row label="Location" value={activeActivity.location || '—'} />
          <Row label="Impact" value={`${valueFormat.format(activeActivity.amount)} ${result.method_unit}`} />
          <Row label="Share" value={`${activeActivity.percentage.toFixed(2)}%`} />
        </DetailPopover>
      )}
      {activeFlow && (
        <DetailPopover title={activeFlow.flow_name} onClose={() => setActiveFlow(null)}>
          <Row label="Key" value={activeFlow.flow_key} />
          <Row label="Compartment" value={activeFlow.compartment || '—'} />
          <Row label="Subcompartment" value={activeFlow.subcompartment || '—'} />
          <Row label="Inventory" value={`${valueFormat.format(activeFlow.inventory_amount)} ${activeFlow.inventory_unit || ''}`} />
          <Row label="Impact" value={`${valueFormat.format(activeFlow.amount)} ${result.method_unit}`} />
          <Row label="Share" value={`${activeFlow.percentage.toFixed(2)}%`} />
        </DetailPopover>
      )}
      </div>
    </CollapsibleCard>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function TopNSwitch({ value, onChange }: { value: TopN; onChange: (v: TopN) => void }) {
  const opts: TopN[] = [5, 10, 20, 'all']
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 'var(--text-xs)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>Top</span>
      {opts.map((n) => (
        <button
          key={String(n)}
          onClick={() => onChange(n)}
          style={{
            padding: '3px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            border: '1px solid ' + (value === n ? 'var(--accent)' : 'var(--border-default)'),
            backgroundColor: value === n ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-elevated)',
            color: value === n ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: 'var(--text-xs)', fontWeight: value === n ? 600 : 500,
          }}
        >
          {n === 'all' ? 'All' : n}
        </button>
      ))}
    </div>
  )
}

function DepthSelect({ value, onChange, max }: { value: Depth; onChange: (v: Depth) => void; max: number }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
      Depth
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as Depth)}
        style={selectStyle}
      >
        {[1, 2, 3, 4, 5].filter((d) => d <= max).map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
    </label>
  )
}

function CutoffSelect({ value, onChange }: { value: Cutoff; onChange: (v: Cutoff) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
      Cutoff
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as Cutoff)}
        style={selectStyle}
      >
        <option value={0.001}>0.1%</option>
        <option value={0.01}>1%</option>
        <option value={0.05}>5%</option>
      </select>
    </label>
  )
}

function SegmentedToggle<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: ReadonlyArray<readonly [T, string]> }) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: '4px 10px', border: 'none', cursor: 'pointer',
            backgroundColor: value === key ? 'var(--accent)' : 'var(--bg-elevated)',
            color: value === key ? 'white' : 'var(--text-secondary)',
            fontSize: 'var(--text-xs)', fontWeight: 600,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

interface ContributionTableProps {
  kind: 'activities' | 'flows'
  items: ContributionItem[] | BiosphereContributionItem[]
  restAmount: number
  restPercentage: number
  unit: string
  topN: TopN
  query: string
  onPick: (item: ContributionItem | BiosphereContributionItem) => void
  formatValue: (n: number) => string
}

function ContributionTable({ kind, items, restAmount, restPercentage, unit, topN, query, onPick, formatValue }: ContributionTableProps) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    if (kind === 'activities') {
      return (items as ContributionItem[]).filter(
        (i) => i.activity_name.toLowerCase().includes(q) || (i.location || '').toLowerCase().includes(q),
      )
    }
    return (items as BiosphereContributionItem[]).filter(
      (i) => i.flow_name.toLowerCase().includes(q) || (i.compartment || '').toLowerCase().includes(q),
    )
  }, [items, query, kind])

  const limit = topN === 'all' ? filtered.length : Math.min(topN, filtered.length)
  const visible = filtered.slice(0, limit)
  const hidden = filtered.slice(limit)
  const hiddenAmount = hidden.reduce((s, i) => s + (i as { amount: number }).amount, 0)

  if (items.length === 0) {
    return (
      <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
        {kind === 'activities' ? 'No technosphere contributions returned.' : 'No biosphere contributions returned.'}
      </div>
    )
  }

  const maxPct = Math.max(...items.map((i) => i.percentage), 1)

  return (
    <div style={{ overflow: 'auto', maxHeight: 520 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr>
            <th style={th}>{kind === 'activities' ? 'Activity' : 'Flow'}</th>
            <th style={th}>{kind === 'activities' ? 'Location' : 'Compartment'}</th>
            <th style={{ ...th, textAlign: 'right' }}>Impact ({unit})</th>
            <th style={th}>Share</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((it, idx) => {
            const name = kind === 'activities' ? (it as ContributionItem).activity_name : (it as BiosphereContributionItem).flow_name
            const sub = kind === 'activities' ? (it as ContributionItem).location : (it as BiosphereContributionItem).compartment
            return (
              <tr
                key={idx}
                onClick={() => onPick(it)}
                style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <td style={{ padding: '6px 10px', color: 'var(--text-primary)' }}>{name}</td>
                <td style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{sub || '—'}</td>
                <td style={{ ...numCell, color: 'var(--accent)', fontWeight: 600 }}>{formatValue(it.amount)}</td>
                <td style={{ padding: '6px 10px', minWidth: 180 }}>
                  <PctBar pct={it.percentage} max={maxPct} />
                </td>
              </tr>
            )
          })}
          {hidden.length > 0 && (
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}>
              <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                Other ({hidden.length})
              </td>
              <td />
              <td style={{ ...numCell, color: 'var(--text-secondary)' }}>{formatValue(hiddenAmount)}</td>
              <td style={{ padding: '6px 10px', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                {hidden.reduce((s, i) => s + i.percentage, 0).toFixed(1)}%
              </td>
            </tr>
          )}
          {restAmount !== 0 && (
            <tr style={{ borderTop: '1px solid var(--border-default)' }}>
              <td style={{ padding: '6px 10px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Rest of inventory</td>
              <td />
              <td style={{ ...numCell, color: 'var(--text-tertiary)' }}>{formatValue(restAmount)}</td>
              <td style={{ padding: '6px 10px', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                {restPercentage.toFixed(1)}%
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function PctBar({ pct, max }: { pct: number; max: number }) {
  const w = Math.min(100, (Math.abs(pct) / Math.abs(max)) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, backgroundColor: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', backgroundColor: 'var(--accent)', borderRadius: 3 }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', minWidth: 48, textAlign: 'right' }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function SupplyChainTree({ node, unit, formatValue }: { node: ContributionTreeNode; unit: string; formatValue: (n: number) => string }) {
  return <TreeRow node={node} unit={unit} depth={0} maxPct={Math.max(1, node.percentage)} formatValue={formatValue} />
}

function TreeRow({ node, unit, depth, maxPct, formatValue }: { node: ContributionTreeNode; unit: string; depth: number; maxPct: number; formatValue: (n: number) => string }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children && node.children.length > 0
  const indent = depth * 16
  return (
    <div>
      <div
        onClick={() => hasChildren && setOpen((v) => !v)}
        style={{
          display: 'grid', gridTemplateColumns: `${indent + 18}px 1fr 110px 200px`, alignItems: 'center',
          padding: '4px 6px', cursor: hasChildren ? 'pointer' : 'default',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 'var(--text-sm)',
        }}
      >
        <span style={{ paddingLeft: indent, color: 'var(--text-tertiary)' }}>
          {hasChildren
            ? open
              ? <ChevronDown size={12} />
              : <ChevronRight size={12} />
            : <span style={{ display: 'inline-block', width: 12 }} />}
        </span>
        <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
          {node.location ? <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>[{node.location}]</span> : null}
        </span>
        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600, fontSize: 'var(--text-xs)' }}>
          {formatValue(node.score)} {unit}
        </span>
        <PctBar pct={node.percentage} max={maxPct} />
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((c, i) => (
            <TreeRow key={`${c.key}-${i}`} node={c} unit={unit} depth={depth + 1} maxPct={maxPct} formatValue={formatValue} />
          ))}
        </div>
      )}
    </div>
  )
}

function ByStageView({ rows, unit, formatValue }: { rows: Array<{ stage: string; impact: number; percentage: number; topName?: string }>; unit: string; formatValue: (n: number) => string }) {
  if (rows.length === 0) {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--text-tertiary)', textAlign: 'center' }}>No stage breakdown available.</div>
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.impact)), 1)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
      <thead>
        <tr>
          <th style={th}>Stage</th>
          <th style={{ ...th, textAlign: 'right' }}>Impact ({unit})</th>
          <th style={th}>Share</th>
          <th style={th}>Top contributor</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.stage} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '6px 10px', color: 'var(--text-primary)' }}>{r.stage}</td>
            <td style={{ ...numCell, color: 'var(--accent)', fontWeight: 600 }}>{formatValue(r.impact)}</td>
            <td style={{ padding: '6px 10px', minWidth: 180 }}>
              <PctBar pct={r.percentage} max={(Math.abs(r.impact) / max) * 100} />
            </td>
            <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>{r.topName || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MethodologyNote({
  open,
  onToggle,
  cutoff,
  depth,
  serverCutoff,
  serverMaxDepth,
  isMultiYear,
}: {
  open: boolean
  onToggle: () => void
  cutoff: Cutoff
  depth: Depth
  serverCutoff: number
  serverMaxDepth: number
  isMultiYear: boolean
}) {
  return (
    <div style={{ marginTop: 'var(--space-4)', borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
      <button
        onClick={onToggle}
        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0, color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}
      >
        <Info size={12} />
        About this analysis
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div style={{ marginTop: 8, padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <p style={{ margin: '0 0 6px' }}>
            <strong>Top activities</strong> uses <code>bw2analyzer.ContributionAnalysis.annotated_top_processes</code> — the dominant technosphere processes after solving the LCI system.
          </p>
          <p style={{ margin: '0 0 6px' }}>
            <strong>Top flows</strong> uses <code>annotated_top_emissions</code> — the dominant biosphere flows after characterisation.
          </p>
          <p style={{ margin: '0 0 6px' }}>
            <strong>Supply chain tree</strong> walks the technosphere graph and runs a sub-LCA at every node, so each branch's value is its <em>characterised</em> impact. The <strong>Sankey</strong> view applies the same convention — link width = characterised impact contributed by that exchange, in the active method's unit. The Sankey BFS is cycle-safe (back- and cross-edges are dropped to keep the graph layered) and capped at a node budget; nodes beyond the cap are pruned best-first by edge value from the root.
          </p>
          <p style={{ margin: '0 0 6px' }}>
            <strong>Computed at</strong> depth ≤ {serverMaxDepth}, cutoff ≥ {(serverCutoff * 100).toFixed(2)}% of root. These are the bounds applied server-side when building the tree — branches outside them were never materialised.
          </p>
          <p style={{ margin: isMultiYear ? '0 0 6px' : 0 }}>
            <strong>Current view</strong> further prunes to depth ≤ {depth}, cutoff ≥ {(cutoff * 100).toFixed(1)}% client-side. Lower the cutoff or raise the depth to surface more of the computed tree (capped by the server bounds above).
          </p>
          {isMultiYear && (
            <p style={{ margin: 0 }}>
              <strong>Multi-year note:</strong> trajectory runs use depth=5 by default to keep wall-clock manageable across years. Tree converges by depth=4 for climate methods but ecotoxicity- and human-toxicity-class methods can have hot paths beyond depth=5; for deeper attribution on those methods, use the single-year tab (depth=6).
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DetailPopover({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 240 }}
    >
      <div style={{ width: 520, maxWidth: '92vw', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 'var(--space-4) var(--space-5)' }}>{children}</div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: 'var(--text-xs)', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

// ── Tree pruning helper ────────────────────────────────────────────────────

function trimTree(node: ContributionTreeNode, maxDepth: number, cutoff: number): ContributionTreeNode {
  const recur = (n: ContributionTreeNode, d: number): ContributionTreeNode => {
    if (d >= maxDepth) return { ...n, children: [] }
    const kept = (n.children || [])
      .filter((c) => c.percentage / 100 >= cutoff)
      .map((c) => recur(c, d + 1))
    return { ...n, children: kept }
  }
  return recur(node, 0)
}

// ── Styles ─────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
}

const methodBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--space-4)',
  padding: 'var(--space-4) var(--space-5)',
  marginBottom: 'var(--space-3)',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
}

const th: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
  backgroundColor: 'var(--bg-elevated)', position: 'sticky', top: 0,
}

const numCell: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'right',
  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
}

const selectStyle: React.CSSProperties = {
  height: 24, padding: '0 6px',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-xs)',
}
