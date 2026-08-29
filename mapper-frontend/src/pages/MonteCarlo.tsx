/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Dice5, Download, Play } from 'lucide-react'
import {
  UncertaintyBoxPlot,
  UncertaintyHistogram,
  VarianceContributionBar,
} from '../components/charts/UncertaintyCharts'
import { Button } from '../components/ui/Button'
import { CollapsibleCard } from '../components/ui/CollapsibleCard'
import { ComputeProgress } from '../components/ui/ComputeProgress'
import { useMonteCarloStore } from '../stores/monteCarloStore'
import {
  CoverageBanner,
  MaterialPedigreeTable,
} from '../components/uncertainty/MaterialPedigreeTable'
import { exportMonteCarlo, getPedigreeCoverage, type PedigreeCoverage } from '../api/client'

const DEFAULT_ITERATIONS = 1000

/**
 * Ratios outside this band are worth a second look. The band is wide on
 * purpose -- see the note rendered next to it: a Monte Carlo median sitting
 * ABOVE the deterministic score is the expected behaviour of ecoinvent's
 * lognormal exchanges, not a defect, and the offset grows with supply-chain
 * depth. A median BELOW the deterministic score, or more than double it, is
 * the shape that actually indicates a problem.
 */
const PLAUSIBLE_RATIO = { lo: 0.9, hi: 2.0 }

interface Props {
  onNavigate?: (id: string) => void
}

export function MonteCarloPage({ onNavigate }: Props) {
  const { handoff, running, pct, stage, error, cancelled, result, run, cancel, reset } =
    useMonteCarloStore()

  const [iterations, setIterations] = useState(DEFAULT_ITERATIONS)
  const [seedText, setSeedText] = useState('')
  const [configOpen, setConfigOpen] = useState(true)
  const [resultsOpen, setResultsOpen] = useState(true)
  const [selectedMethod, setSelectedMethod] = useState(0)
  const [scoringOpen, setScoringOpen] = useState(false)
  const [coverage, setCoverage] = useState<PedigreeCoverage | null>(null)
  const [coverageNonce, setCoverageNonce] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Coverage is per (archetype, indicator), so it follows the indicator the
  // user is looking at rather than being pinned to the first one.
  const coverageMethod = handoff?.methods[Math.min(selectedMethod, (handoff?.methods.length ?? 1) - 1)]
  useEffect(() => {
    if (!handoff || !coverageMethod) { setCoverage(null); return }
    let alive = true
    void getPedigreeCoverage(handoff.archetypeId, coverageMethod, {
      scope: handoff.scope,
      computeDatabase: handoff.computeDatabase,
    })
      .then((c) => { if (alive) setCoverage(c) })
      .catch(() => { if (alive) setCoverage(null) })
    return () => { alive = false }
  }, [handoff, coverageMethod, coverageNonce])

  // A CHANGED handoff invalidates whatever is on screen -- the previous result
  // belongs to a different archetype or configuration. Keyed against a ref
  // rather than firing on mount: the tab is navigated away from and back to,
  // and clearing on mount would discard a finished run every time the user
  // returned to look at it.
  const lastHandoffKey = useRef<string | null>(null)
  const handoffKey = handoff
    ? `${handoff.archetypeId}|${handoff.scope}|${handoff.methods.length}|${handoff.parameterScenario ?? ''}`
    : null
  useEffect(() => {
    if (handoffKey === null) return
    if (lastHandoffKey.current === null) {
      lastHandoffKey.current = handoffKey
      return
    }
    if (lastHandoffKey.current !== handoffKey) {
      lastHandoffKey.current = handoffKey
      reset()
      setSelectedMethod(0)
    }
  }, [handoffKey, reset])

  const distributions = result?.distributions ?? []
  const selected = distributions[Math.min(selectedMethod, distributions.length - 1)]

  const flagged = useMemo(
    () =>
      distributions.filter((d) => {
        if (!d.deterministic) return false
        const r = d.median / d.deterministic
        return r < PLAUSIBLE_RATIO.lo || r > PLAUSIBLE_RATIO.hi
      }),
    [distributions],
  )

  if (!handoff) {
    return <NoHandoff onNavigate={onNavigate} />
  }

  const onRun = () => {
    const seed = seedText.trim() === '' ? null : Number(seedText.trim())
    void run({
      archetype_id: handoff.archetypeId,
      methods: handoff.methods,
      scope: handoff.scope,
      stage_amounts: handoff.stageAmounts,
      basis_amounts: handoff.basisAmounts ?? null,
      parameter_scenario: handoff.parameterScenario,
      compute_database: handoff.computeDatabase,
      iterations,
      seed: Number.isFinite(seed as number) ? seed : null,
      keep_samples: true,
      variance_contributions: true,
    })
  }

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 1200 }} data-testid="monte-carlo-page">
      <header style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Dice5 size={20} strokeWidth={1.5} color="var(--mod-lca)" />
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, margin: 0 }}>
            Uncertainty propagation
          </h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginTop: 6 }}>
          Monte Carlo over the ecoinvent background and any BOM rows or parameters you have
          scored. Single-product only.
        </p>
      </header>

      <CollapsibleCard
        title="Configuration"
        expanded={configOpen}
        onToggle={() => setConfigOpen((v) => !v)}
        summary={`${handoff.archetypeName} · ${handoff.methods.length} indicators · ${scopeLabel(handoff.scope)} · ${iterations} iterations`}
      >
        <div data-testid="mc-config-body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <FieldRow label="Archetype" value={handoff.archetypeName} />
          <FieldRow label="Indicators" value={`${handoff.methods.length} selected`} />
          <FieldRow label="Scope" value={scopeLabel(handoff.scope)} />
          <FieldRow
            label="Sensitivity case"
            value={handoff.parameterScenario ?? 'Base'}
          />
          <FieldRow
            label="Background database"
            value={handoff.computeDatabase ?? 'base ecoinvent'}
          />

          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Iterations
              </span>
              <input
                data-testid="mc-iterations"
                type="number"
                min={1}
                max={20000}
                value={iterations}
                onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Seed
              </span>
              <input
                data-testid="mc-seed"
                type="text"
                placeholder="random"
                value={seedText}
                onChange={(e) => setSeedText(e.target.value)}
                style={{ ...inputStyle, width: 140 }}
              />
            </label>
            <Button
              variant="primary"
              onClick={onRun}
              disabled={running}
              data-testid="mc-run"
            >
              <Play size={14} strokeWidth={2} />
              {running ? 'Running…' : 'Run'}
            </Button>
          </div>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0 }}>
            1000 iterations settles the 2.5th/97.5th percentiles to within ~0.2%. The seed is
            recorded with the result so a run can be reproduced exactly.
          </p>
        </div>
      </CollapsibleCard>

      {coverage && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <CoverageBanner coverage={coverage} />
        </div>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <CollapsibleCard
          title="Material scoring"
          expanded={scoringOpen}
          onToggle={() => setScoringOpen((v) => !v)}
          summary={
            coverage
              ? `${coverage.materials_scored} of ${coverage.materials_total} materials scored`
              : 'Score by material name'
          }
        >
          <MaterialPedigreeTable
            coverage={coverage}
            onLibraryChange={() => setCoverageNonce((n) => n + 1)}
          />
        </CollapsibleCard>
      </div>

      <ComputeProgress
        label={stage || 'Sampling…'}
        active={running}
        bar="determinate"
        pct={pct}
        statusColor="var(--mod-lca)"
        onCancel={() => void cancel()}
      />

      {exportError && (
        <Banner tone="danger" testId="mc-export-error">{exportError}</Banner>
      )}
      {error && (
        <Banner tone="danger" testId="mc-error">
          {error}
        </Banner>
      )}
      {cancelled && !result && (
        <Banner tone="muted" testId="mc-cancelled">
          Run stopped. No distribution was produced.
        </Banner>
      )}

      {result && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <CollapsibleCard
            title="Results"
            expanded={resultsOpen}
            onToggle={() => setResultsOpen((v) => !v)}
            summary={`${result.n_iterations} iterations · seed ${result.seed} · ${result.elapsed_seconds.toFixed(1)}s`}
            actions={
              <Button
                variant="secondary"
                data-testid="mc-export"
                disabled={exporting}
                onClick={() => {
                  setExporting(true)
                  void exportMonteCarlo(result, coverage)
                    .catch((e) => setExportError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setExporting(false))
                }}
              >
                <Download size={14} strokeWidth={1.8} />
                {exporting ? 'Exporting…' : 'Export'}
              </Button>
            }
          >
            <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
              <LowerBoundNote result={result} />

              {flagged.length > 0 && (
                <Banner tone="warning" testId="mc-ratio-flag">
                  <strong>{flagged.length}</strong>{' '}
                  {flagged.length === 1 ? 'indicator has' : 'indicators have'} a median far from
                  the deterministic score ({flagged.map((d) => d.method_label.split(' | ')[0]).join(', ')}).
                  Worth checking before quoting.
                </Banner>
              )}

              <Section
                title="Spread by indicator"
                note="Each indicator normalised to its own deterministic score, because the 16 indicators span six orders of magnitude and cannot share an absolute axis."
              >
                <UncertaintyBoxPlot
                  distributions={distributions}
                  filenameBase={result.archetype_name}
                />
              </Section>

              <Section title="Deterministic vs Monte Carlo">
                <DistributionTable distributions={distributions} />
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 10 }}>
                  A median <em>above</em> the deterministic score is expected, not a defect:
                  ecoinvent stores each exchange with its median equal to the deterministic
                  amount, and aggregating many such lognormals up a supply chain pulls the total
                  above the sum of medians. The offset grows with supply-chain depth — a bare
                  ecoinvent activity shows 1.00× for a short chain and ~1.14× for a long one. A
                  median <em>below</em> the deterministic score, or more than double it, is the
                  shape worth investigating.
                </p>
              </Section>

              {selected && (
                <Section title="Distribution">
                  <label style={{ display: 'block', marginBottom: 10 }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginRight: 8 }}>
                      Indicator
                    </span>
                    <select
                      data-testid="mc-method-select"
                      value={selectedMethod}
                      onChange={(e) => setSelectedMethod(Number(e.target.value))}
                      style={inputStyle}
                    >
                      {distributions.map((d, i) => (
                        <option key={d.method_label} value={i}>{d.method_label}</option>
                      ))}
                    </select>
                  </label>
                  <UncertaintyHistogram
                    distribution={selected}
                    filenameBase={`${result.archetype_name}_${selected.method_label.split(' | ')[0]}`}
                  />
                </Section>
              )}

              <Section
                title="What drives the spread"
                note="Where a better data source would actually narrow the result — not where the impact happens to be largest."
              >
                <VarianceContributionBar
                  contributors={result.contributors}
                  filenameBase={result.archetype_name}
                />
              </Section>
            </div>
          </CollapsibleCard>
        </div>
      )}
    </div>
  )
}

// ── pieces ───────────────────────────────────────────────────────────────────

function LowerBoundNote({ result }: { result: { rows_with_uncertainty: number; rows_inherited: number; parameters_with_uncertainty: number } }) {
  const fg = result.rows_with_uncertainty + result.parameters_with_uncertainty
  return (
    <div
      data-testid="mc-lower-bound-note"
      style={{
        display: 'flex', gap: 10, alignItems: 'flex-start',
        padding: 'var(--space-3)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-elevated)',
        fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
      }}
    >
      <AlertTriangle size={14} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        <strong style={{ color: 'var(--text-primary)' }}>This spread is a lower bound.</strong>{' '}
        About 12% of ecoinvent&apos;s technosphere exchanges carry no uncertainty distribution and
        are sampled as fixed, so their contribution to the spread is missing.
        {fg === 0
          ? ' No foreground row or parameter is scored either, so this run varies the background alone.'
          : ` ${result.rows_with_uncertainty} row${result.rows_with_uncertainty === 1 ? '' : 's'}${
              result.rows_inherited
                ? ` (${result.rows_inherited} inheriting a material score)`
                : ''
            } and ${result.parameters_with_uncertainty} parameter${result.parameters_with_uncertainty === 1 ? '' : 's'} carry foreground uncertainty.`}
      </div>
    </div>
  )
}

function DistributionTable({ distributions }: { distributions: Array<{ method_label: string; unit: string; deterministic: number; median: number; p2_5: number; p97_5: number; gsd2: number }> }) {
  const num = (v: number) => (Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(3) : v.toFixed(3))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr>
            {['Indicator', 'Deterministic', 'MC median', 'Median / det.', '2.5th', '97.5th', 'GSD²', 'Unit'].map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {distributions.map((d) => {
            const ratio = d.deterministic ? d.median / d.deterministic : NaN
            const odd = Number.isFinite(ratio) && (ratio < PLAUSIBLE_RATIO.lo || ratio > PLAUSIBLE_RATIO.hi)
            return (
              <tr key={d.method_label}>
                <td style={tdStyle}>{d.method_label}</td>
                <td style={tdNum}>{num(d.deterministic)}</td>
                <td style={tdNum}>{num(d.median)}</td>
                <td style={{ ...tdNum, color: odd ? 'var(--warning)' : 'var(--text-primary)', fontWeight: odd ? 600 : 400 }}>
                  {Number.isFinite(ratio) ? `${ratio.toFixed(3)}×` : '—'}
                </td>
                <td style={tdNum}>{num(d.p2_5)}</td>
                <td style={tdNum}>{num(d.p97_5)}</td>
                <td style={tdNum}>{d.gsd2 ? d.gsd2.toFixed(3) : '—'}</td>
                <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{d.unit}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NoHandoff({ onNavigate }: { onNavigate?: (id: string) => void }) {
  return (
    <div
      data-testid="mc-no-handoff"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 12, textAlign: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <Dice5 size={28} strokeWidth={1.4} color="var(--text-secondary)" />
      <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0 }}>
        Nothing to propagate yet
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', maxWidth: 460, margin: 0 }}>
        Uncertainty propagation runs against a single-product computation. Compute one in Impact
        Assessment, then use <strong>Run uncertainty</strong> on the results card — it carries the
        archetype, indicators, scope and sensitivity case over so nothing needs re-specifying.
      </p>
      {onNavigate && (
        <Button variant="secondary" onClick={() => onNavigate('impact')} data-testid="mc-goto-impact">
          Go to Impact Assessment
        </Button>
      )}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
        {title}
      </h3>
      {note && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '0 0 10px' }}>{note}</p>
      )}
      {children}
    </section>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 'var(--text-sm)' }}>
      <span style={{ color: 'var(--text-secondary)', minWidth: 170 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function Banner({ tone, testId, children }: { tone: 'danger' | 'warning' | 'muted'; testId: string; children: React.ReactNode }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--border-default)'
  return (
    <div
      data-testid={testId}
      style={{
        marginTop: 'var(--space-3)', padding: 'var(--space-3)',
        border: `1px solid ${color}`, borderRadius: 'var(--radius-md)',
        background: 'var(--bg-elevated)', color: 'var(--text-primary)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {children}
    </div>
  )
}

function scopeLabel(scope: string): string {
  return { all: 'Full Lifecycle', inflows: 'Manufacturing', stock: 'Operation', outflows: 'End of Life' }[scope] ?? scope
}

const inputStyle: React.CSSProperties = {
  height: 32, padding: '0 10px',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-surface)', color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px',
  borderBottom: '1px solid var(--border-default)',
  fontSize: 'var(--text-xs)', textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--text-secondary)', fontWeight: 600,
  whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '7px 10px', borderBottom: '1px solid var(--border-subtle)',
}
const tdNum: React.CSSProperties = {
  ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--font-mono, monospace)',
}
