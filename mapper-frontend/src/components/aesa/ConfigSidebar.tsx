import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Loader2, Pencil, Play, Plus, Save, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { ComputeProgress } from '../ui/ComputeProgress'
import { NumberInput } from '../ui/NumberInput'
import { useAESAStore, type AESAConfigLoadKind } from '../../stores/aesaStore'
import { useDSMStore } from '../../stores/dsmStore'
import { useImpactStore } from '../../stores/impactStore'
import { PresetSelector } from './PresetSelector'
import { CategoryAssignmentsTable } from './CategoryAssignmentsTable'
import { DownscalingChainEditor } from './DownscalingChainEditor'
import { PrinciplesEditor } from './PrinciplesEditor'
import type {
  CarbonBudgetOption,
  SSPTrajectory,
} from '../../api/client'

interface Props {
  collapsed: boolean
  onToggle: () => void
}

// Patch 5AM — human-readable label per config-load kind (never the raw URL/error).
const CONFIG_LOAD_LABELS: Record<AESAConfigLoadKind, string> = {
  defaults: 'Couldn’t load AESA defaults.',
  presets: 'Couldn’t load sharing presets.',
  configurations: 'Couldn’t load saved configurations.',
  sessions: 'Couldn’t load saved sessions.',
}

export function ConfigSidebar({ collapsed, onToggle }: Props) {
  const {
    defaults, defaultsLoading, draft, running, error,
    loadDefaults, loadConfigurations, loadPresets, loadSessions, updateDraft,
    updateCarbonBudget, resetDraftToDefaults, suggestMapping, saveConfig, compute,
    configurations, activeConfigId, creatingNewConfig, startNewConfig,
    activeSessionId, clearActiveSession,
    configLoadError, dismissConfigLoadError,
  } = useAESAStore()

  // Patch 5AM — re-run just the config load that failed (the network-level
  // first-paint race already self-retries inside the store; this is the manual
  // recovery for the case where it still surfaced).
  const retryConfigLoad = () => {
    const kind = configLoadError?.kind
    if (kind === 'defaults') void loadDefaults()
    else if (kind === 'presets') void loadPresets()
    else if (kind === 'configurations') void loadConfigurations()
    else if (kind === 'sessions') void loadSessions()
  }

  // Patch 4R — loaded-session frozen mode. When a saved session is
  // active, the cascade + sections become read-only and the footer
  // Compute is replaced with "Return to live view". The user can
  // still see exactly what was computed (cascade values mirror the
  // session's snapshot), but edits are blocked until they explicitly
  // exit session mode.
  const inSessionMode = activeSessionId !== null

  // Patch 4Y — drag-resizable sidebar width. Persisted in
  // localStorage so the user's width preference survives reloads.
  // Bounds: [SIDEBAR_MIN_WIDTH, min(SIDEBAR_MAX_WIDTH, 50% viewport)].
  // The handle is a 4px vertical strip on the sidebar's right edge.
  //
  // Architecture note (stale-closure avoidance): all drag state lives
  // in refs that the SAME pair of stable listener functions read on
  // each mousemove/mouseup. Listeners are created exactly once in a
  // mount-time effect, added to `document` on mousedown, removed on
  // mouseup. This sidesteps the cross-re-render identity problem that
  // arises when listeners are recreated each render (addEventListener
  // and removeEventListener referencing different function instances).
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
      const n = stored ? Number(stored) : NaN
      if (Number.isFinite(n) && n >= SIDEBAR_MIN_WIDTH) {
        return Math.min(n, SIDEBAR_MAX_WIDTH)
      }
    } catch { /* localStorage unavailable in tests; fall through */ }
    return SIDEBAR_DEFAULT_WIDTH
  })
  const widthRef = useRef(sidebarWidth)
  widthRef.current = sidebarWidth
  const dragStartRef = useRef<{ x: number; startWidth: number } | null>(null)

  // Listeners defined ONCE on mount; ref-based state access keeps
  // them current without re-binding. Cleanup on unmount.
  const moveListenerRef = useRef<((e: MouseEvent) => void) | undefined>(undefined)
  const upListenerRef = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    moveListenerRef.current = (e: MouseEvent) => {
      const start = dragStartRef.current
      if (!start) return
      const dx = e.clientX - start.x
      const viewportCap = Math.floor(window.innerWidth * 0.5)
      const maxW = Math.min(SIDEBAR_MAX_WIDTH, viewportCap)
      const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxW, start.startWidth + dx))
      setSidebarWidth(next)
    }
    upListenerRef.current = () => {
      dragStartRef.current = null
      document.removeEventListener('mousemove', moveListenerRef.current!)
      document.removeEventListener('mouseup', upListenerRef.current!)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current)) } catch { /* ignore */ }
    }
  }, [])

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!moveListenerRef.current || !upListenerRef.current) return
    dragStartRef.current = { x: e.clientX, startWidth: widthRef.current }
    document.addEventListener('mousemove', moveListenerRef.current)
    document.addEventListener('mouseup', upListenerRef.current)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  // Patch 4Q — empty-state gate. Render the guidance UI when the
  // project has zero saved AESA configurations AND the user hasn't
  // yet expressed creation intent (via the page-header
  // "+ New configuration" button or the inline action below).
  // Hides the cascade + sections + footer Compute/Save controls
  // so the user can't edit-without-persistence orphan state.
  const showEmptyState = !creatingNewConfig
    && activeConfigId === null
    && configurations.length === 0

  const { activeSystem, systemState, activeView } = useDSMStore()
  const { staticResult, projectedResult, projectedMultiResult } = useImpactStore()

  // Patch 4AA — resolve the cascade-visible DSM scenario name from
  // `draft.dsm_scenario_id` FIRST (the cascade's source of truth,
  // Patch 4O), falling back to the DSM page's notion of active only
  // when the draft hasn't pinned a scenario. Pre-Patch-4AA this
  // derivation skipped `draft.dsm_scenario_id` entirely — the
  // cascade dropdown updated draft state but the Background-option
  // description strings stayed pinned to the DSM page's active
  // scenario, producing the visible desync (cascade says SSP5,
  // descriptions still say "DSM scenario: SSP1"). Compute itself
  // always used `draft.dsm_scenario_id`, so the bug was cosmetic —
  // not methodological — but the desync was confusing and made the
  // dropdown look decorative.
  const dsmScenarioName = useMemo(() => {
    if (!systemState) return null
    const sid = draft?.dsm_scenario_id
      ?? activeView?.scenarioId
      ?? systemState.active_scenario_id
    if (!sid) return systemState.scenarios.find((s) => s.is_base)?.name ?? 'Base'
    return systemState.scenarios.find((s) => s.id === sid)?.name
      ?? systemState.scenarios.find((s) => s.is_base)?.name
      ?? 'Base'
  }, [systemState, activeView, draft?.dsm_scenario_id])

  const [runSensitivity, setRunSensitivity] = useState(true)
  const [saving, setSaving] = useState(false)

  // Patch 5AQ — which of the multi-LCI Prospective Background scenarios AESA
  // assesses. The run persists all N full ImpactAssessmentResults in
  // `projectedMultiResult.scenarios[]`; AESA consumes one inline. Default 0
  // (was the only reachable scenario). Reset to 0 when a fresh multi run lands.
  const [lciScenarioIdx, setLciScenarioIdx] = useState(0)
  useEffect(() => { setLciScenarioIdx(0) }, [projectedMultiResult?.task_id])

  // Per-session collapsible reset key. Loading a different session OR
  // returning to live view resets every <CollapsibleSection> back to
  // its default-collapsed state via the `useEffect([openKey])` hook
  // inside the helper. Prevents the "previous session left section X
  // open" carryover that would otherwise confuse review.
  const collapsibleOpenKey = activeSessionId ?? activeConfigId ?? 'live'

  useEffect(() => {
    void loadDefaults()
    void loadConfigurations()
    void loadPresets()
  }, [loadDefaults, loadConfigurations, loadPresets])

  const boundarySet = useMemo(
    () => defaults?.boundary_sets.find((b) => b.id === draft?.boundary_set_id) ?? defaults?.boundary_sets[0] ?? null,
    [defaults, draft?.boundary_set_id],
  )

  // Patch 5AQ — multi-LCI scenario selection. When a Prospective Background run
  // computed N>1 LCI scenarios, the user picks which one AESA assesses; the
  // chosen scenario's full result drives the whole config (mapping count,
  // compute). Single-scenario / static modes are unchanged.
  const lciScenarios = projectedMultiResult?.scenarios ?? []
  const isMultiLci = draft?.impact_mode === 'projected' && lciScenarios.length > 1
  const safeLciIdx = isMultiLci && lciScenarioIdx < lciScenarios.length ? lciScenarioIdx : 0
  const chosenLciResult = isMultiLci ? (lciScenarios[safeLciIdx]?.result ?? projectedResult) : null

  const activeImpact = draft?.impact_mode === 'projected'
    ? (chosenLciResult ?? projectedResult)
    : staticResult
  const hasImpact = !!activeImpact
  const canCompute = !!draft && !!activeSystem && hasImpact && !running

  // Auto-prefer Projected LCI on first load if it's available and the draft is still untouched
  useEffect(() => {
    if (!draft) return
    if (projectedResult && draft.impact_mode === 'static' && draft.method_mapping.length === 0) {
      updateDraft({ impact_mode: 'projected' })
    }
  }, [projectedResult, draft, updateDraft])

  // Auto-suggest mapping when impact result lands and mapping is empty
  useEffect(() => {
    if (!draft || !activeImpact) return
    if (draft.method_mapping.length > 0) return
    const methods = activeImpact.results.map((r) => [...r.method])
    if (methods.length) void suggestMapping(methods)
  }, [draft, activeImpact, suggestMapping])

  const handleCompute = async () => {
    if (!activeSystem?.id || !draft || !activeImpact) return
    const taskId = activeImpact.task_id
    const isMirror = taskId.startsWith('dsm-mirror-')
    // Patch 5AQ — for multi-LCI, the single shared task_id only resolves
    // scenario 1, so pass the CHOSEN scenario's result inline (AESA accepts a
    // single ImpactAssessmentResult inline, same as the mirror path).
    const passInline = isMirror || isMultiLci
    await compute({
      mfaSystemId: activeSystem.id,
      impactTaskId: passInline ? null : taskId,
      impactInline: passInline ? activeImpact : null,
      runSensitivity,
    })
  }

  const staticSubtitle = staticResult ? describeStatic(staticResult, dsmScenarioName) : '(not yet computed)'
  const projectedSubtitle = projectedResult ? describeProjected(projectedResult, dsmScenarioName) : '(not yet computed)'

  const handleSave = async () => {
    if (!activeSystem?.id) return
    setSaving(true)
    try { await saveConfig(activeSystem.id) } finally { setSaving(false) }
  }

  if (collapsed) {
    return (
      <aside data-testid="aesa-config-sidebar-collapsed" style={collapsedStyle}>
        <button onClick={onToggle} style={toggleButton} title="Expand configuration">
          <ChevronRight size={16} />
        </button>
        <span style={{
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
          letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase',
        }}>
          AESA configuration
        </span>
      </aside>
    )
  }

  return (
    <aside
      data-testid="aesa-config-sidebar"
      style={{ ...sidebarStyle, width: sidebarWidth }}
    >
      {/* Patch 4Y — drag-to-resize handle on the right edge.
          4px wide, full sidebar height, faintly visible on hover.
          The sidebar's own `position: sticky` (set inline above)
          becomes the offset parent for the absolutely-positioned
          handle. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize configuration sidebar"
        data-testid="aesa-sidebar-resize-handle"
        onMouseDown={startDrag}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 2,
          // Subtle hover highlight via CSS variable (avoids a hover
          // state hook just for one pixel band).
          background: 'transparent',
          transition: 'background 120ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'color-mix(in srgb, var(--mod-aesa) 30%, transparent)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      />
      {/* Patch 4AC — Configuration header carries Compute + Save +
          Run-sensitivity, moved up from the pre-Patch-4AC footer.
          Co-locating the primary actions with the section they
          apply to removes the spatial gap between configuration
          and action. Icons follow the Patch 4Z icon-only convention
          (compact padding, title + aria-label). The error / hint
          row below the header surfaces "why Compute is disabled"
          for users who don't hover. The footer is removed entirely.
      */}
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{
            fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
            whiteSpace: 'nowrap',
          }}>
            Configuration
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!showEmptyState && (inSessionMode ? (
            // Session-loaded mode: Compute is replaced with
            // Return-to-live (Patch 4R semantics, now in the header).
            <Button
              variant="secondary"
              onClick={() => clearActiveSession()}
              data-testid="aesa-sidebar-return-to-live"
              title="Return to live view"
              aria-label="Return to live view"
              style={{ padding: '0 10px', height: 28 }}
            >
              <ArrowLeft size={14} />
            </Button>
          ) : (
            <>
              {/* Run-sensitivity toggle inline with Compute. ONE control: the
                  whole label (checkbox + "σ" glyph) toggles `runSensitivity`,
                  which is sent as `run_sensitivity` to the AESA compute. When
                  on, Compute ALSO evaluates the Sustainability Ratio under all
                  five uniform sharing principles (EpC, IN, AGR, LA, AR) — the
                  per-principle spread that powers the box-plot view. Off =
                  primary principle only (no spread). σ = the sensitivity
                  (sigma) glyph; the tooltip spells it out. */}
              <label
                data-testid="aesa-run-sensitivity-toggle"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 10, color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title="Sensitivity analysis (σ): also compute the Sustainability Ratio under all 5 uniform sharing principles (EpC, IN, AGR, LA, AR) — the spread shown in the box-plot view. Off = primary principle only."
                aria-label="Run sensitivity analysis across the five uniform sharing principles"
              >
                <input
                  type="checkbox"
                  checked={runSensitivity}
                  onChange={(e) => setRunSensitivity(e.target.checked)}
                  style={{ margin: 0 }}
                />
                σ
              </label>
              <Button
                onClick={handleCompute}
                disabled={!canCompute}
                data-testid="aesa-sidebar-compute"
                title={
                  !activeSystem ? 'Select a DSM system first'
                    : !hasImpact ? `Run the ${draft?.impact_mode === 'projected' ? 'Projected' : 'Static'} LCI first`
                    : running ? 'Computing…'
                    : 'Compute'
                }
                aria-label="Compute"
                style={{ padding: '0 10px', height: 28 }}
              >
                {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
              </Button>
              {/* Patch 4Y — footer save persists the AESAConfiguration
                  TEMPLATE (cascade + sharing preset + method mapping)
                  — the pill the user names and reuses across runs.
                  Distinct from the page-header "Save session" button
                  (Patch 4R), which persists a frozen result snapshot.
                  Tooltip + aria-label make the distinction explicit. */}
              <Button
                variant="secondary"
                onClick={handleSave}
                disabled={!draft || !activeSystem || saving}
                data-testid="aesa-save-config"
                title="Save configuration template (reusable)"
                aria-label="Save configuration template"
                style={{ padding: '0 10px', height: 28 }}
              >
                {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              </Button>
            </>
          ))}
          <button onClick={onToggle} style={toggleButton} title="Collapse">
            <ChevronLeft size={16} />
          </button>
        </div>
      </header>

      {/* Patch 5AM — config-load failure banner. Named, non-blocking, with a
          targeted Retry + dismiss. Separate from the compute/save `error`
          (hint row below). AESA results still render — only this side load
          failed. */}
      {configLoadError && (
        <div
          data-testid="aesa-config-load-error"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            margin: '8px 12px', padding: '8px 10px',
            backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
            borderRadius: 'var(--radius-md)',
            fontSize: 11, color: 'var(--danger)', lineHeight: 1.4,
          }}
        >
          <AlertCircle size={13} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{CONFIG_LOAD_LABELS[configLoadError.kind]}</span>
          <button
            data-testid="aesa-config-load-retry"
            onClick={retryConfigLoad}
            style={{
              background: 'none', border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)', color: 'var(--danger)',
              fontSize: 11, fontWeight: 600, padding: '2px 8px', cursor: 'pointer',
            }}
          >
            Retry
          </button>
          <button
            data-testid="aesa-config-load-dismiss"
            onClick={dismissConfigLoadError}
            aria-label="Dismiss"
            title="Dismiss"
            style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex', padding: 0 }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Patch 4AC — contextual hint / error row. Surfaces compute
          gating reasons ("Select a DSM system", "Run the … LCI
          first") for users who don't hover the disabled button.
          Errors render here too — same row, danger color. Hidden in
          session mode (cascade is read-only there) and in empty
          state (the empty-state UI explains itself). */}
      {!showEmptyState && !inSessionMode && (error || !activeSystem || !hasImpact) && (
        <div
          data-testid="aesa-sidebar-hint"
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: error ? 'var(--danger)' : 'var(--text-tertiary)',
            backgroundColor: error
              ? 'color-mix(in srgb, var(--danger) 10%, transparent)'
              : 'transparent',
            borderBottom: '1px solid var(--border-subtle)',
            lineHeight: 1.4,
          }}
        >
          {error
            ? error
            : !activeSystem
              ? 'Select a DSM system to enable Compute.'
              : !hasImpact
                ? `Run the ${draft?.impact_mode === 'projected' ? 'Projected' : 'Static'} LCI first.`
                : ''}
        </div>
      )}

      {/* Patch 5AL — shared live compute-progress card. AESA compute exposes no
          pct (in-process pipeline), so bar='none' (spinner + elapsed). */}
      {!showEmptyState && !inSessionMode && (
        <ComputeProgress
          active={running}
          label="Computing AESA…"
          bar="none"
          statusColor="var(--mod-aesa)"
          data-testid="aesa-compute-progress"
          style={{ margin: '8px 12px' }}
        />
      )}

      <div style={bodyStyle}>
        {defaultsLoading && !defaults && (
          <div style={{ padding: 'var(--space-3)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
            Loading defaults…
          </div>
        )}

        {showEmptyState && (
          <div
            data-testid="aesa-config-empty-state"
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-5)',
              textAlign: 'center',
            }}
          >
            <div style={{
              fontSize: 'var(--text-sm)', fontWeight: 600,
              color: 'var(--text-primary)',
            }}>
              No AESA configuration yet
            </div>
            <div style={{
              fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
              maxWidth: 280, lineHeight: 1.5,
            }}>
              Create your first configuration to set up the compute
              source, planetary boundary set, and sharing preset.
            </div>
            <button
              type="button"
              data-testid="aesa-config-empty-state-create"
              onClick={() => startNewConfig()}
              style={{
                marginTop: 'var(--space-2)',
                padding: '6px 14px',
                background: 'var(--mod-aesa)',
                color: 'var(--text-inverse, #fff)',
                border: '1px solid var(--mod-aesa)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)', fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Plus size={12} /> Create your first configuration
            </button>
            <div style={{
              fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
              marginTop: 'var(--space-2)',
            }}>
              Or click <strong>+ New configuration</strong> at the top right.
            </div>
          </div>
        )}

        {!showEmptyState && draft && defaults && boundarySet && (
          <>
            {/* Patch 4R — frozen-mode banner. Names the loaded session
                + tells the user how to exit. Edits to the cascade /
                sections below are blocked by `inert` on the wrapping
                div (visual + semantic disabling in one). */}
            {inSessionMode && (
              <div
                data-testid="aesa-session-frozen-banner"
                style={{
                  padding: '8px 10px',
                  background: 'color-mix(in srgb, var(--mod-aesa) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--mod-aesa) 35%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                }}
              >
                Viewing saved session — Configuration is read-only.
                Click <strong>Return to live view</strong> in the page
                header to compute new results.
              </div>
            )}
          </>
        )}
        {!showEmptyState && draft && defaults && boundarySet && (
          <fieldset
            data-testid="aesa-config-fieldset"
            disabled={inSessionMode}
            style={{
              border: 'none', padding: 0, margin: 0,
              display: 'flex', flexDirection: 'column',
              gap: 'var(--space-3)',
              opacity: inSessionMode ? 0.7 : 1,
            }}
          >
            {/* Patch 4O — Compute Source cascade. Three orthogonal axes:
                DSM model → Scenario → Background. The cascade picks
                which UPSTREAM Impact Assessment result feeds AESA;
                AESA itself doesn't run LCA (it's a downstream
                consumer). Selections persist on the draft as
                `dsm_scenario_id` + `impact_mode`; the DSM model is
                tracked via `dsmStore.activeSystem`. Switching levels
                cascades — picking a different model resets scenario
                to the new system's active. */}
            <Section title="Compute Source">
              <ComputeSourceCascade
                draft={draft}
                updateDraft={updateDraft}
                dsmScenarioName={dsmScenarioName}
                staticAvailable={!!staticResult}
                projectedAvailable={!!projectedResult}
                staticSubtitle={staticSubtitle}
                projectedSubtitle={projectedSubtitle}
                inSessionMode={inSessionMode}
              />
              {isMultiLci && (
                <div style={{
                  marginTop: 'var(--space-2)', padding: 'var(--space-2)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)', display: 'flex',
                  flexDirection: 'column', gap: 4,
                }}>
                  <label style={labelStyle}>LCI scenario</label>
                  <select
                    data-testid="aesa-lci-scenario-select"
                    value={safeLciIdx}
                    onChange={(e) => setLciScenarioIdx(Number(e.target.value))}
                    style={inputStyle}
                  >
                    {lciScenarios.map((s, i) => (
                      <option key={i} value={i}>{s.scenario.iam} / {s.scenario.ssp}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                    AESA assesses the selected LCI scenario ({lciScenarios.length} computed in the Prospective Background run) — no re-run needed.
                  </div>
                </div>
              )}
            </Section>

            {/* Configuration template name (Patch 4Y). Bound to
                `draft.name`, which `saveConfig` writes onto the
                persisted `AESAConfiguration` — it becomes the pill
                text in the top-right Configurations dropdown.
                DISTINCT from session naming: the page-header "Save
                session" modal builds its own timestamped default and
                takes user input at save time. The two tiers (Patch 4U
                save model) have separate naming surfaces; renaming
                this field makes the role unambiguous to users who
                otherwise conflate them. */}
            <Section title="Configuration template name">
              <input
                data-testid="aesa-config-template-name"
                value={draft.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                placeholder="e.g. WP5 – SSP2 – Prospective"
                style={inputStyle}
              />
              <div style={{
                fontSize: 10, color: 'var(--text-tertiary)',
                marginTop: 4, lineHeight: 1.4,
              }}>
                Names the reusable template (the pill in the top-right
                Configurations dropdown). Sessions get their own
                timestamped name at <strong>Save session</strong>.
              </div>
            </Section>

            {/* Boundary set */}
            <Section title="Planetary Boundary set">
              <select
                value={draft.boundary_set_id}
                onChange={(e) => updateDraft({ boundary_set_id: e.target.value })}
                style={inputStyle}
              >
                {defaults.boundary_sets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <div style={hintText}>{boundarySet.source}</div>
            </Section>

            {/* Sharing preset selector — collapsible. Once chosen,
                rarely revisited per run; collapse by default and show
                the active preset name as the summary. */}
            <CollapsibleSection
              title="Sharing preset"
              openKey={collapsibleOpenKey}
              summary={draft.sharing?.name ?? '—'}
            >
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <button onClick={resetDraftToDefaults} style={ghostBtnStyle} title="Reset to defaults">
                  <RotateCcw size={11} /> Reset
                </button>
              </div>
              <PresetSelector />
            </CollapsibleSection>

            {/* Downscaling chain editor — collapsible. Layer count is
                the most useful at-a-glance summary. */}
            <CollapsibleSection
              title="Downscaling chain"
              openKey={collapsibleOpenKey}
              summary={`${draft.sharing?.chain.layers.length ?? 0} layer${(draft.sharing?.chain.layers.length ?? 0) === 1 ? '' : 's'}`}
            >
              <DownscalingChainEditor />
            </CollapsibleSection>

            {/* Principles — collapsible. */}
            <CollapsibleSection
              title="Sharing principles"
              openKey={collapsibleOpenKey}
              summary={`${draft.sharing?.principles.length ?? 0} defined`}
            >
              <PrinciplesEditor />
            </CollapsibleSection>

            {/* Category assignments — collapsible. Show the modal
                principle (most-frequently-assigned) as the summary
                so users see the dominant choice without expanding. */}
            <CollapsibleSection
              title="Category assignments"
              openKey={collapsibleOpenKey}
              summary={summarizeCategoryAssignments(draft.sharing?.category_assignments ?? [])}
            >
              <CategoryAssignmentsTable boundarySet={boundarySet} />
            </CollapsibleSection>

            {/* Carbon budget — collapsible. */}
            <CollapsibleSection
              title="Carbon budget (cumulative climate)"
              openKey={collapsibleOpenKey}
              summary={
                draft.carbon_budget
                  ? `${draft.carbon_budget.initial_budget_gt} Gt · ${draft.carbon_budget.ssp_scenario}`
                  : 'disabled'
              }
            >
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={!!draft.carbon_budget}
                    onChange={(e) => {
                      if (e.target.checked) {
                        updateCarbonBudget(defaults.default_carbon_budget)
                      } else {
                        updateCarbonBudget(null)
                      }
                    }}
                  />
                  enabled
                </label>
              </div>
              {draft.carbon_budget ? (
                <CarbonBudgetEditor
                  budget={draft.carbon_budget}
                  options={defaults.carbon_budget_options}
                  ssps={defaults.ssp_trajectories}
                  onPatch={(p) => updateCarbonBudget(p)}
                />
              ) : (
                <div style={hintText}>
                  Climate change will use the standard PB × Multi-D path instead.
                </div>
              )}
            </CollapsibleSection>

            {/* Mapping status — collapsible. */}
            <CollapsibleSection
              title="Method → PB mapping"
              openKey={collapsibleOpenKey}
              summary={
                activeImpact
                  ? `${draft.method_mapping.length}/${activeImpact.results.length} mapped`
                  : `${draft.method_mapping.length} mapped`
              }
            >
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {draft.method_mapping.length} method{draft.method_mapping.length === 1 ? '' : 's'} mapped
                {activeImpact && draft.method_mapping.length < activeImpact.results.length && (
                  <span style={{ color: 'var(--warning)' }}>
                    {' '}· {activeImpact.results.length - draft.method_mapping.length} unmapped
                  </span>
                )}
              </div>
              {activeImpact && (
                <button
                  onClick={() => {
                    const methods = activeImpact.results.map((r) => [...r.method])
                    void suggestMapping(methods)
                  }}
                  style={ghostBtnStyle}
                >
                  Re-suggest from impact methods
                </button>
              )}
            </CollapsibleSection>
          </fieldset>
        )}
        {/* Saved sessions list rendered OUTSIDE the fieldset so it
            stays interactive even in session-loaded mode — users can
            switch to another session, rename one, or delete one
            without exiting the frozen view first. The fieldset
            disables only the configuration-editing controls
            (cascade, name, presets, mapping). */}
        {!showEmptyState && draft && defaults && (
          <Section title="Saved sessions">
            <SavedSessionsList />
          </Section>
        )}
      </div>

      {/* Patch 4AC — footer removed. Compute, Save (configuration
          template), and Run-sensitivity moved to the header; the
          hint / error row above renders gating context. */}
    </aside>
  )

}

// ── Compute Source cascade (Patch 4O) ──────────────────────────────────────
//
// Three-level cascade picking the upstream Impact Assessment result that
// feeds AESA. AESA is a downstream consumer (no own LCA pipeline) — the
// cascade routes selections to existing actions:
//
//   - DSM model → ``dsmStore.selectSystem(id)`` (swaps activeSystem).
//   - Scenario → ``selectStaticDsmScenario`` / ``selectProjectedDsmScenario``
//     (mirrors the picked scenario's per-tab run into ``staticResult`` /
//     ``projectedResult``). When the picked scenario has no run cached
//     yet, surfaces an inline hint pointing the user to Impact
//     Assessment.
//   - Background → ``updateDraft({impact_mode})`` — same as the old
//     LciSourceRadio flag.
//
// Persisted on the draft as ``dsm_scenario_id`` + ``impact_mode``;
// ``mfa_system_id`` is captured at save time from ``activeSystem.id``.

function ComputeSourceCascade({
  draft, updateDraft,
  dsmScenarioName,
  staticAvailable, projectedAvailable,
  staticSubtitle, projectedSubtitle,
  inSessionMode = false,
}: {
  draft: import('../../stores/aesaStore').AESAConfigDraft
  updateDraft: (patch: Partial<import('../../stores/aesaStore').AESAConfigDraft>) => void
  dsmScenarioName: string | null
  staticAvailable: boolean
  projectedAvailable: boolean
  staticSubtitle: string
  projectedSubtitle: string
  // When viewing a saved session, the cascade reflects the SESSION's
  // frozen state — the live `staticDsmScenarioRuns` /
  // `projectedDsmScenarioRuns` maps are NOT populated by session
  // load. The "no Static run" / "no Prospective run" annotations
  // would erroneously fire against an empty live runs map. Suppress
  // them in session mode; the session's own result is on screen.
  inSessionMode?: boolean
}) {
  const { systems, activeSystem, systemState, selectSystem } = useDSMStore()
  const {
    staticDsmScenarioRuns, projectedDsmScenarioRuns,
    selectStaticDsmScenario, selectProjectedDsmScenario,
  } = useImpactStore()

  // Effective scenario id for the cascade picker. Saved configs may
  // carry ``draft.dsm_scenario_id = null`` ("use whatever's active");
  // resolve to the system's current active or base scenario for
  // display, but don't write back unless the user makes an explicit
  // pick.
  const resolvedScenarioId =
    draft.dsm_scenario_id
    ?? systemState?.active_scenario_id
    ?? systemState?.scenarios.find((s) => s.is_base)?.id
    ?? systemState?.scenarios[0]?.id
    ?? null

  // Per-mode availability for the picked scenario. Two regimes:
  //   - Multi-DSM fan-out mode (runs map populated): strict — the
  //     picked scenario must be a key in the runs map.
  //   - Single-scenario mode (runs map empty): can't disambiguate
  //     which scenario the lone result represents; suppress the
  //     "no run cached" hint to avoid false positives.
  const staticRunsPopulated = Object.keys(staticDsmScenarioRuns).length > 0
  const projectedRunsPopulated = Object.keys(projectedDsmScenarioRuns).length > 0
  const hasStaticRunForActiveScenario =
    !staticRunsPopulated
      ? staticAvailable
      : (resolvedScenarioId != null && resolvedScenarioId in staticDsmScenarioRuns)
  const hasProjectedRunForActiveScenario =
    !projectedRunsPopulated
      ? projectedAvailable
      : (resolvedScenarioId != null && resolvedScenarioId in projectedDsmScenarioRuns)

  const handleModelChange = async (sid: string) => {
    if (sid === activeSystem?.id) return
    // Switching DSM model invalidates the current scenario id (it
    // belongs to the previous system). Clear it on the draft —
    // resolution falls back to the new system's active scenario.
    updateDraft({ dsm_scenario_id: null })
    try {
      await selectSystem(sid)
    } catch { /* error surfaces via dsmStore */ }
  }

  const handleScenarioChange = (sid: string) => {
    updateDraft({ dsm_scenario_id: sid })
    // Mirror the scenario's run into the per-tab `staticResult` /
    // `projectedResult` slot so AESA's compute path reads the right
    // payload. No-op when no run is cached for this scenario yet —
    // the inline hint covers that case.
    if (sid in staticDsmScenarioRuns) selectStaticDsmScenario(sid)
    if (sid in projectedDsmScenarioRuns) selectProjectedDsmScenario(sid)
  }

  const scenarioMissingRun =
    resolvedScenarioId != null && (
      (draft.impact_mode === 'static' && !hasStaticRunForActiveScenario)
      || (draft.impact_mode === 'projected' && !hasProjectedRunForActiveScenario)
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {/* Level 1 — DSM model */}
      <CascadeRow label="DSM model">
        <select
          value={activeSystem?.id ?? ''}
          onChange={(e) => void handleModelChange(e.target.value)}
          disabled={systems.length === 0}
          data-testid="aesa-cascade-model"
          style={cascadeSelectStyle}
        >
          {systems.length === 0 && <option value="">No DSM systems</option>}
          {systems.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </CascadeRow>

      {/* Level 2 — Scenario within model */}
      <CascadeRow
        label="Scenario"
        hint={dsmScenarioName ? null : 'Active'}
      >
        <select
          value={resolvedScenarioId ?? ''}
          onChange={(e) => handleScenarioChange(e.target.value)}
          disabled={!systemState || systemState.scenarios.length === 0}
          data-testid="aesa-cascade-scenario"
          style={cascadeSelectStyle}
        >
          {!systemState && <option value="">Select a DSM model first</option>}
          {systemState?.scenarios.map((s) => {
            const hasStatic = s.id in staticDsmScenarioRuns
            const hasProj = s.id in projectedDsmScenarioRuns
            // Patch 4W (Issue 1) — three-state badge gate. The badge is
            // comparative information ("this scenario has no run while
            // others do"); it's only meaningful when SOME scenarios
            // have runs and others don't.
            //
            //   - Session mode → suppress (Patch 4U): the session is
            //     self-contained; the live runs map is empty by design.
            //   - Empty runs map (live mode, just-arrived) → suppress:
            //     no scenario has a run; annotating EVERY scenario with
            //     "no run" is noise. The user needs to run Impact
            //     Assessment first; per-scenario badging adds nothing.
            //   - Partial runs map (multi-DSM fan-out) → show badge for
            //     scenarios that DON'T have a cached run, so users can
            //     compare cached vs uncached.
            const showBadgeForAxis = draft.impact_mode === 'static'
              ? staticRunsPopulated
              : projectedRunsPopulated
            const badge = (inSessionMode || !showBadgeForAxis)
              ? ''
              : draft.impact_mode === 'static'
                ? (hasStatic ? '' : ' · no Static run')
                : (hasProj ? '' : ' · no Prospective run')
            return (
              <option key={s.id} value={s.id}>
                {s.name}{badge}
              </option>
            )
          })}
        </select>
      </CascadeRow>

      {/* Level 3 — Background */}
      <CascadeRow label="Background">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <LciOption
            label="Static Background"
            subtitle={staticSubtitle}
            checked={draft.impact_mode === 'static'}
            disabled={!staticAvailable}
            onSelect={() => updateDraft({ impact_mode: 'static' })}
          />
          <LciOption
            label="Prospective Background"
            subtitle={projectedSubtitle}
            checked={draft.impact_mode === 'projected'}
            disabled={!projectedAvailable}
            onSelect={() => updateDraft({ impact_mode: 'projected' })}
          />
        </div>
      </CascadeRow>

      {/* Inline hint when the (system, scenario, background) trio
          doesn't have an Impact Assessment run cached. Tells the user
          where to go to fix it. */}
      {scenarioMissingRun && (
        <div
          data-testid="aesa-cascade-no-run"
          style={{
            marginTop: 'var(--space-1)', padding: 'var(--space-2)',
            background: 'color-mix(in srgb, var(--status-warning) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--status-warning) 25%, transparent)',
            borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)', lineHeight: 1.4,
          }}
        >
          No {draft.impact_mode === 'projected' ? 'Prospective' : 'Static'} Background
          result cached for this scenario. Run Impact Assessment for the
          selected scenario first, then return to AESA.
        </div>
      )}
    </div>
  )
}

function CascadeRow({ label, hint, children }: {
  label: string
  hint?: string | null
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        fontSize: 10, fontWeight: 600,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        {label}
        {hint && (
          <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>
            · {hint}
          </span>
        )}
      </span>
      {children}
    </div>
  )
}

const cascadeSelectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-xs)',
  outline: 'none',
  cursor: 'pointer',
}

function LciOption({
  label, subtitle, checked, disabled, onSelect,
}: {
  label: string
  subtitle: string
  checked: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <label
      onClick={() => { if (!disabled) onSelect() }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '6px 8px',
        border: `1px solid ${checked && !disabled ? 'var(--mod-aesa)' : 'var(--border-subtle)'}`,
        background: checked && !disabled
          ? 'color-mix(in srgb, var(--mod-aesa) 10%, transparent)'
          : 'var(--bg-elevated)',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="radio"
        checked={checked && !disabled}
        disabled={disabled}
        readOnly
        style={{ marginTop: 2, accentColor: 'var(--mod-aesa)' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{
          fontSize: 10, color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={subtitle}>
          {subtitle}
        </span>
      </div>
    </label>
  )
}

// DSM-scenario × parameter-set are non-SSP coordinates — render them with
// labels rather than A × B typography to avoid mimicking the IAM/SSP format.
function lciTag(r: import('../../api/client').ImpactAssessmentResult, dsmScenarioName: string | null): string {
  const dsm = dsmScenarioName ?? 'Base'
  const cas = r.meta.parameter_set_id ?? 'Base'
  return ` · DSM scenario: ${dsm} · Parameters: ${cas}`
}

function describeStatic(r: import('../../api/client').ImpactAssessmentResult, dsmScenarioName: string | null): string {
  return `LCI: ${r.meta.base_db ?? 'base ecoinvent'}${lciTag(r, dsmScenarioName)}`
}

function describeProjected(r: import('../../api/client').ImpactAssessmentResult, dsmScenarioName: string | null): string {
  const s = r.meta.scenario
  const base = s ? `${s.iam.toUpperCase()} / ${s.ssp}` : 'prospective background'
  return `LCI: ${base}${lciTag(r, dsmScenarioName)}`
}

// ── CarbonBudgetEditor ──────────────────────────────────────────────────────

function CarbonBudgetEditor({
  budget, options, ssps, onPatch,
}: {
  budget: import('../../api/client').CarbonBudgetConfig
  options: CarbonBudgetOption[]
  ssps: SSPTrajectory[]
  onPatch: (p: Partial<import('../../api/client').CarbonBudgetConfig>) => void
}) {
  const selectedOption = options.find(
    (o) => Math.abs(o.remaining_gt_from_2025 - budget.initial_budget_gt) < 0.5,
  )?.id ?? 'custom'

  const selectedSsp = ssps.find((s) => s.id === budget.ssp_scenario) ?? ssps[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={labelStyle}>IPCC AR6 budget</label>
      <select
        value={selectedOption}
        onChange={(e) => {
          const opt = options.find((o) => o.id === e.target.value)
          if (!opt) return
          onPatch({ initial_budget_gt: opt.remaining_gt_from_2025, budget_source: opt.source })
        }}
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name} — {o.remaining_gt_from_2025} Gt</option>
        ))}
        {selectedOption === 'custom' && <option value="custom">Custom ({budget.initial_budget_gt} Gt)</option>}
      </select>

      <label style={labelStyle}>SSP trajectory</label>
      <select
        value={budget.ssp_scenario}
        onChange={(e) => {
          const ssp = ssps.find((s) => s.id === e.target.value)
          if (!ssp) return
          onPatch({ ssp_scenario: ssp.id, projected_emissions: ssp.projected_emissions })
        }}
        style={inputStyle}
      >
        {ssps.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumberField label="Start" value={budget.start_year} onChange={(v) => onPatch({ start_year: v })} int />
        <NumberField label="End" value={budget.end_year} onChange={(v) => onPatch({ end_year: v })} int />
      </div>

      <BudgetSparkline budget={budget} />
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
        {selectedSsp?.source}
      </div>
    </div>
  )
}

function BudgetSparkline({ budget }: { budget: import('../../api/client').CarbonBudgetConfig }) {
  const W = 240, H = 48, PAD = 2
  const years = Object.keys(budget.projected_emissions).map(Number).filter((y) => y >= budget.start_year && y <= budget.end_year).sort((a, b) => a - b)
  if (years.length < 2) return null
  // Cumulative usage as fraction of initial budget
  let cum = 0
  const points = years.map((y) => {
    cum += budget.projected_emissions[y] ?? 0
    return { year: y, used: cum }
  })
  const maxUsed = Math.max(budget.initial_budget_gt, points[points.length - 1].used)
  const xFor = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD)
  const yFor = (used: number) => H - PAD - (used / maxUsed) * (H - 2 * PAD)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)} ${yFor(p.used).toFixed(1)}`).join(' ')
  const budgetY = yFor(budget.initial_budget_gt)
  const depleted = points.find((p) => p.used >= budget.initial_budget_gt)

  return (
    <div style={{ marginTop: 4 }}>
      <svg width={W} height={H} style={{ display: 'block', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)' }}>
        <line x1={0} x2={W} y1={budgetY} y2={budgetY} stroke="var(--danger)" strokeDasharray="3 2" strokeWidth={1} />
        <path d={path} fill="none" stroke="var(--mod-aesa)" strokeWidth={1.5} />
      </svg>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
        Cumulative emissions vs {budget.initial_budget_gt} Gt budget
        {depleted && <span style={{ color: 'var(--danger)' }}> · depleted ~{depleted.year}</span>}
      </div>
    </div>
  )
}

// ── Small primitives ────────────────────────────────────────────────────────

// Pick the modal (most-frequent) principle id from the category
// assignments — the single value that best summarises the cascade
// when the section is collapsed. Returns "—" for empty input.
function summarizeCategoryAssignments(
  assignments: ReadonlyArray<{ principle_id: string }>,
): string {
  if (assignments.length === 0) return '—'
  const counts = new Map<string, number>()
  for (const a of assignments) counts.set(a.principle_id, (counts.get(a.principle_id) ?? 0) + 1)
  let best = ''
  let bestN = -1
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n }
  }
  const total = assignments.length
  if (counts.size === 1) return `${best} (${total})`
  return `${best} (${bestN}/${total})`
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
          {title}
        </span>
        {right}
      </div>
      {children}
    </section>
  )
}

// Lightweight collapsible section. Same chrome as `<Section>` but
// the title acts as a toggle and the body hides via `display: none`
// (visibility-toggle pattern, not conditional mount — preserves
// child-component-local state across collapse/expand cycles).
//
// Used for infrequently-changed AESA configuration sections (sharing
// preset, downscaling chain, category assignments, carbon budget,
// method → PB mapping). Frequently-changed sections (compute source,
// name) and small ones (planetary boundary set) keep the always-on
// `<Section>` chrome so the cascade and headline pickers stay
// visible at a glance.
//
// `summary` is rendered in the header row when collapsed — a one-
// liner showing the active values so the user knows what they're
// expanding into. Rendered next to the chevron, faded.
//
// `id` is a stable per-section key so the parent's per-session
// reset (collapse-on-load) can drive the open state from outside.
function CollapsibleSection({
  title, children, summary, defaultOpen = false, openKey,
}: {
  title: string
  children: React.ReactNode
  summary?: React.ReactNode
  defaultOpen?: boolean
  /** When this key changes, the section resets to `defaultOpen`.
   *  Pass the active session id (or `'live'`) so loading a different
   *  session collapses everything back to the per-session default. */
  openKey?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  // Reset on session-key change. Effect runs on mount + whenever
  // openKey flips; setting state inside an effect is intentional
  // here — collapse semantics are tied to the parent's lifecycle,
  // not the user's local interactions across that lifecycle.
  useEffect(() => {
    setOpen(defaultOpen)
  }, [openKey])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section
      data-testid={`aesa-collapsible-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 6, marginBottom: open ? 6 : 0,
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
        }}>
          <ChevronRight
            size={11}
            style={{
              transition: 'transform 120ms ease',
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          />
          {title}
        </span>
        {!open && summary && (
          <span style={{
            fontSize: 10, color: 'var(--text-tertiary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '60%',
          }}>
            {summary}
          </span>
        )}
      </button>
      <div style={{ display: open ? 'block' : 'none' }}>
        {children}
      </div>
    </section>
  )
}

function NumberField({ label, value, onChange, int }: { label: string; value: number; onChange: (v: number) => void; int?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label}</span>
      <NumberInput
        value={value}
        onChange={onChange}
        integerOnly={int}
        allowNegative
        style={{ ...inputStyle, padding: '3px 6px', height: 24, fontSize: 11 }}
      />
    </label>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

// Patch 4Y — drag-resize bounds + localStorage key. Default and min
// match the pre-Patch-4Y fixed width (300); max is hard-capped at
// 600 but also viewport-clamped at runtime to 50% of innerWidth.
export const SIDEBAR_MIN_WIDTH = 300
export const SIDEBAR_MAX_WIDTH = 600
export const SIDEBAR_DEFAULT_WIDTH = 300
export const SIDEBAR_WIDTH_KEY = 'mapper.aesa.sidebarWidth'

// Patch 4V — sticky sidebar so it stays visible while the AESA page
// scrolls. The parent flex container uses `alignItems: flex-start`,
// so the sidebar's height is content-driven (not stretched to flex
// container height). `position: sticky` then anchors it within
// Shell's scrollable `<main>`. `maxHeight: calc(100vh - 96px)`
// reserves space for Shell's topbar (48) + statusbar (24) + padding
// (~24); the inner `bodyStyle` overflow: auto handles overflow when
// the sidebar's own content is taller than that.
//
// Patch 4Y — `width` is now driven by component state (drag-resizable)
// rather than fixed in this style object; consumers must pass the
// resolved width inline.
const sidebarStyle: React.CSSProperties = {
  flexShrink: 0,
  position: 'sticky',
  top: 0,
  maxHeight: 'calc(100vh - 96px)',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
}

// Patch 4Z — collapsed variant. No internal scrollable content
// (just the expand chevron + rotated label), so the Patch 4V
// `maxHeight` clamp from `sidebarStyle` is wrong here — it visibly
// truncates the slim bar at viewport height even when the page
// has scrolled. Use `minHeight` instead so the bar extends to fill
// the available sticky height; without the max-clamp the bar
// continues naturally below the sticky's anchor.
const collapsedStyle: React.CSSProperties = {
  width: 32,
  flexShrink: 0,
  position: 'sticky',
  top: 0,
  minHeight: 'calc(100vh - 96px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  paddingTop: 8,
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-subtle)',
}

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
}

const toggleButton: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24,
  background: 'transparent', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
  cursor: 'pointer', padding: 0,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 28,
  padding: '4px 8px',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--text-tertiary)',
}

const hintText: React.CSSProperties = {
  fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3,
}

const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  background: 'transparent', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
  padding: '3px 6px', fontSize: 10, cursor: 'pointer',
}

// ── Saved sessions list (Patch 4R) ────────────────────────────────────────
// Renders the per-project session list with rename + delete affordances.
// Click a row to load (mirrors the snapshot into draft + result).
// Empty state guides toward the page-header Save button.

function SavedSessionsList() {
  const {
    sessions, sessionsLoading, activeSessionId,
    loadSession, renameSession, deleteSession,
  } = useAESAStore()
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  if (sessionsLoading) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        Loading sessions…
      </div>
    )
  }
  if (sessions.length === 0) {
    return (
      <div
        data-testid="aesa-sessions-empty"
        style={{
          padding: '8px 10px',
          fontSize: 11,
          color: 'var(--text-tertiary)',
          background: 'var(--bg-elevated)',
          border: '1px dashed var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          lineHeight: 1.5,
        }}
      >
        No saved sessions. Compute and click <strong>Save session</strong> to
        view results here later.
      </div>
    )
  }

  return (
    <div data-testid="aesa-sessions-list" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sessions.map((s) => {
        const active = s.id === activeSessionId
        const isRenaming = renameId === s.id
        return (
          <div
            key={s.id}
            data-testid={`aesa-session-row-${s.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 8px',
              backgroundColor: active
                ? 'color-mix(in srgb, var(--mod-aesa) 12%, transparent)'
                : 'var(--bg-elevated)',
              border: `1px solid ${active ? 'var(--mod-aesa)' : 'var(--border-subtle)'}`,
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
            }}
          >
            {isRenaming ? (
              <input
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const next = renameDraft.trim()
                    if (next && next !== s.name) void renameSession(s.id, next)
                    setRenameId(null)
                  } else if (e.key === 'Escape') {
                    setRenameId(null)
                  }
                }}
                onBlur={() => {
                  const next = renameDraft.trim()
                  if (next && next !== s.name) void renameSession(s.id, next)
                  setRenameId(null)
                }}
                style={{
                  flex: 1, minWidth: 0,
                  padding: '2px 4px', fontSize: 11,
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            ) : (
              <button
                onClick={() => void loadSession(s.id)}
                title={`Load · saved ${new Date(s.created_at).toLocaleString()}`}
                style={{
                  flex: 1, minWidth: 0,
                  background: 'none', border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 11,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 500,
                  padding: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {s.name}
              </button>
            )}
            <button
              onClick={() => { setRenameId(s.id); setRenameDraft(s.name) }}
              title="Rename"
              style={iconBtnSubtle}
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => setConfirmDeleteId(s.id)}
              title="Delete"
              style={iconBtnSubtle}
            >
              <Trash2 size={11} />
            </button>
          </div>
        )
      })}
      {confirmDeleteId && (
        <DeleteSessionModal
          session={sessions.find((s) => s.id === confirmDeleteId) ?? null}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={async () => {
            const id = confirmDeleteId
            setConfirmDeleteId(null)
            if (id) await deleteSession(id)
          }}
        />
      )}
    </div>
  )
}

const iconBtnSubtle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-tertiary)', display: 'flex', padding: 2,
}

function DeleteSessionModal({ session, onCancel, onConfirm }: {
  session: { id: string; name: string } | null
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  if (!session) return null
  // Patch 4X — portal to document.body. The modal renders inside
  // `<SavedSessionsList>` which lives inside the `<aside style={{
  // position: 'sticky' }}>` configuration sidebar (Patch 4V).
  // `position: sticky` creates a new stacking context regardless of
  // z-index; without a portal, the modal's `position: fixed, zIndex:
  // 100` is trapped in the sidebar's local stacking context and the
  // sibling `<main>`'s chart content paints OVER the modal at the
  // root stacking context. `createPortal(..., document.body)`
  // escapes every ancestor stacking context.
  return createPortal(
    <div
      data-testid="aesa-session-delete-modal"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,  // conventional modal layer — above any in-page chrome
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420, maxWidth: 'calc(100% - 32px)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-5)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
          boxShadow: 'var(--shadow-lg, 0 12px 36px rgba(0,0,0,0.18))',
        }}
      >
        <div style={{
          fontSize: 'var(--text-base)', fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          Delete saved session?
        </div>
        <div style={{
          fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}>
          Permanently delete <strong>{session.name}</strong>? This cannot
          be undone — the saved configuration snapshot and result are
          removed from disk.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-xs)',
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            data-testid="aesa-session-delete-confirm"
            onClick={async () => {
              if (busy) return
              setBusy(true)
              try { await onConfirm() } finally { setBusy(false) }
            }}
            disabled={busy}
            style={{
              padding: '6px 12px',
              background: 'var(--danger)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-inverse, #fff)',
              fontSize: 'var(--text-xs)', fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
