# MApper frontend: conventions and gotchas

> Moved out of the root CLAUDE.md. Loads when working under mapper-frontend/.

## Favicon (Patch 5AH)

The browser/tab favicon is the purple MApper bolt set in a solid **brand-teal
circle** (`#14b8a6`, `--accent`/`--mod-lca`) with a soft **light-green aura**
(`#34D399`, `--success`); bolt purple is `#863bff` (the existing logo path,
preserved at `mapper-frontend/public/bolt-logo.svg`). Master is
`public/favicon.svg` (64×64). The aura is **concentric semi-transparent green
circles, not a radial-gradient/filter** — ImageMagick's SVG rasterizer drops
gradients/filters (renders them transparent), so the gradient version produced
auraless PNGs; plain circles render in every engine.

Generated set (via `magick`, in `public/`): `favicon.ico` (multi-res 16/32/48),
`favicon-16/32/48.png`, `apple-touch-icon.png` (180), `icon-192.png`,
`icon-512.png` (PWA), `site.webmanifest` (192/512 + `theme_color #14b8a6`).
**Small-size aura simplification:** the 16/32 PNGs are rasterized from a
no-aura mini (bolt + solid circle only) for crispness; 48/180/192/512 carry the
full aura. Wired in `index.html` head (svg + ico + png + apple-touch + manifest
links). Vite app only — there's no Next.js marketing site in this workspace; if
the `mapper.leonardoferhati.com` site exists as a separate repo, repeat the
asset there. Locked by `tests/faviconAssets.test.ts` (head/manifest references
+ files exist + brand colors).

**Desktop app icon (Patch 5AH, same design).** The Tauri dock/taskbar/window
icon is a SEPARATE set from the web favicon — generated from the same
`favicon.svg` master into `mapper-tauri/icons/`: `icon.png` (1024² master),
`32x32.png` / `128x128.png` / `128x128@2x.png` (Linux), `icon.ico` (Windows,
multi-res 16/32/48/64/256), `icon.icns` (macOS, via `iconutil`). Wired via
`bundle.icon` in `mapper-tauri/tauri.conf.json` (Tauri v2 config skeleton —
`frontendDist` → `../mapper-frontend/dist`, `devUrl` → Vite). The Rust crate is
NOT yet scaffolded (see `mapper-tauri/README.md`); regenerate the icons with
`tauri icon icons/icon.png`. (No tauri CLI in this env — the set was built with
`magick` + `iconutil`.)

## Chart axis-title room (rotated y-axis labels)

A rotated (`angle: -90`) y-axis title placed in the left MARGIN
(`position: 'left'`) clips at the SVG's left edge: its x depends on Recharts'
left-margin math (`margin.left`, `<YAxis width>`, `offset`) and readily goes
negative, cropped on-screen AND in the export (the export serializes the same
SVG). **Don't reason about / tune those margins** — and **you can't measure the
title coordinate in a test either: Recharts 3.x renders NOTHING in jsdom** (0
`<svg>`/`<text>`/`.recharts-*` nodes even with `ResponsiveContainer` mocked), so
there's no serialized SVG to read x/transform from. For a left clip the fix is
an inside position (`position: 'insideLeft'`, structurally `x > 0`); for a wide,
short inset a rotated title may not *fit vertically* at all (see below).

**Durable export lesson — chart labels that must appear in exports have to be
IN the `<svg>`.** `exportChart` serializes ONLY the chart `<svg>`
(`findChartSvg` → `serializeSvgForExport`); HTML siblings of the chart (an HTML
caption above/around it, a `<div>` title) are NOT captured. So a title rendered
as an HTML caption looks fine on-screen but is **absent from the PNG/SVG/PDF
export**. If a label must show in exports, render it inside the chart svg (a
Recharts axis `<Label>`, or a `<Customized>` `<text>`), not as surrounding HTML.

**AESA carbon-budget inset — intentionally UNTITLED (labelled externally).**
That inset is short (120px, ~86px plot). A rotated full-text y-title (~144px)
can't fit its plot height → top-clips on-screen AND export regardless of
position/offset (a FIT problem, not export-bounds). Iterations: rotated
`insideLeft` (5AV, still top-clipped) → HTML caption (on-screen only, dropped
from export per the lesson above) → in-svg `<Customized>` horizontal `<text>` →
**final: no chart title at all** (per Leo — the chart shows axes + data only;
it's titled in the surrounding figure/report). The methodological note ("Based
on projected global emissions…") stays as an HTML caption — it's a caveat, not a
title. `margin.top: 12` keeps the top tick ("1,200.0") off the SVG top edge (it
clipped at the original `2`). `tests/aesaCarbonBudgetTitleRoom.test.ts` now
GUARDS the no-title state (no svg `<text>`/`<Customized>`/`angle:-90` title, no
HTML caption title, note retained, `margin.top:12`) — source-level, since
Recharts isn't observable in jsdom; the real check is **eyeballing a fresh
export**.

(5AU's "`margin.left − YAxis width ≥ offset + ~10px`" rule checked a proxy, not
the outcome, and still clipped — superseded above.)

## Chart export discipline

> Reference detail lives in the `mapper-chart-export` skill (invoke it before changing this area). Rules that always apply:

- Don't place reference-line labels inside the chart plot area when the chart's Y-range can vary widely.
- Don't try to fix label overlap by repositioning within the chart.
- Don't pass reference-line entries via Recharts 3.x's `<Legend payload={[...]}>` prop and expect them to render alongside indicator entries.
- Don't change the boundary thresholds (1.0 / 2.0) — they're methodologically defined by the Sala 2020 framework (zone transitions Safe → Uncertainty → High-Risk).
- Don't expand Advanced by default "for discoverability." The collapsed summary already shows the active values.
- Don't persist Advanced expansion across menu opens (e.g. via localStorage).
- Don't hide the format picker behind Advanced.
- Don't reach for `<CollapsibleCard>` for popup-menu collapses.
- [Legend export] Don't reinvent legend extraction per chart. Use the shared `legendRef` / `legendSelector` API on `<ChartExportButton>`. Per- chart extraction would diverge over time (style inlining, computed- size rounding, light-bg color swaps) and the ...
- [Legend export] Don't define a local color palette for charts that share dimensions with other charts.
- [Legend export] Don't use CSS variables (`var(--mod-aesa)` etc.) for chart series colors that flow through Recharts.
- [Legend export] Don't trust Recharts' auto-derived legend payload.
- [Legend export] Don't ship Export Legend on charts without a legend ELEMENT.
- [Legend export] Don't change the existing chart-only export's filename to add `_chart`.
- [Legend export] Don't use `<foreignObject>` for chart export.
- [Legend export] Don't reference external fonts in exported SVGs even if you think they're safe.
- [Legend export] Don't pull in `html-to-image` for the legend export.
- [Legend export] Don't add a new colour-source check without putting it in the priority order.
- [Legend export] Don't return colour strings unvalidated from the extractor ("just trust Recharts").
- [Legend export] Don't drop the `renderLegendSvg` defensive `#888` coercion even though the extractor "should never" leak a transparent value.
- [Legend export] Don't test legend extraction with custom-HTML fixtures only.
- Every chart in the frontend must use `<ChartExportButton>` from `components/charts/ChartExportButton.tsx` (paired with `<ChartExportContainer>` as the capture target).
- When adding a new visualization panel, audit chart coverage as part of the patch — don't ship a new chart without export.
- Don't put `mapper_` in the prop; it would double.
- Format settings are display-only — they do not affect data exports or stored values.
- Don't hard-code a hex/black on these lines (use `ZONE_COLOR`), and don't drop the explicit `strokeWidth`.
- > Chart exports re-theme INK only (text/axes/grid/background → black-on-white); data series colours are never recoloured, and the on-screen dark theme is untouched.
- [Legend export] Charts without a legend (or whose legend is part of the chart visual itself, like `<StageBreakdownChart>`) MUST omit both props.
- [Legend export] The exported chart legend is centered horizontally within the export width (clamped to margins) and stays visible-only (5O) — centering is layout only; it must never change which series are exported.
- [Legend export] Don't fold visibility logic into the centering, and don't center by trimming/reordering items.
- [Legend export] Charts with multi-category visual encoding (stacked, colored, faceted) MUST render a legend AND must use shared color mappings when their categories overlap with other charts in the codebase.
- [Legend export] The colors half (Patch 4N): if two charts visualize overlapping dimensions, the same value MUST get the same color.
- [Legend export] Patch 5AG — the MULTI-scenario "By cohort" facets must also use the shared resolver.
- [Legend export] By-cohort impact charts inherit colors from the shared cohort resolver (`useDSMSystemColors`), keyed by cohort identity — never a default/index palette; the same cohort must be the same color across DSM and impact charts, and overrides must flow through.
- [Legend export] They stack at the same level (cohort keys) and MUST share this one source so the same cohort/fuel keeps its color when the user switches tabs.
- [Legend export] Prospective's fuel colors — do not reintroduce a second color-assignment path.
- [Legend export] Every chart that visualises DSM cohorts or AESA indicators must import the shared helper — never re-implement per chart.
- [Legend export] The fill must win; putting the stroke walk first or accepting "none" as a colour produces the invisible-swatch regression.
- [Legend export] Always include Recharts-DOM-shape fixtures (`<svg><path stroke="none" fill={color}>`) when changing extraction logic.
- [Legend export] This still applies — the prior rule's intent stands, but the audit must distinguish "doesn't need a legend" from "needs one but doesn't have one."

## UI conventions

> Reference detail lives in the `mapper-ui-conventions` skill (invoke it before changing this area). Rules that always apply:

- [Multi-select chips/selectors anchor Pick/Add on the LEFT] Don't render Pick/Add after selected items in multi-select chips.
- [Multi-select chips/selectors anchor Pick/Add on the LEFT] Don't apply the left-anchor rule to single-select dropdowns (impact method family picker, archetype picker, AESA cascade selectors).
- [Multi-select chips/selectors anchor Pick/Add on the LEFT] Don't apply the rule to vertical row editors (`PairListEditor`, list editors).
- [Multi-select chips/selectors anchor Pick/Add on the LEFT] Don't drop the `data-testid="*-pick"` selector when refactoring a chip.
- [Page-level scroll for chart-rendering pages] Don't constrain chart-rendering pages to viewport height.
- [Page-level scroll for chart-rendering pages] Don't add `flex: 1, minHeight: 0, overflow: auto` to chart containers thinking it "constrains" the chart.
- [Page-level scroll for chart-rendering pages] Don't reach for sticky sidebars without `alignItems: flex-start` on the flex container.
- [Single-product mode uses page-level scroll] Don't constrain Single-product mode section heights with flex layouts.
- [Single-product mode uses page-level scroll] Don't add a `fill` prop (or equivalent) back to `<CollapsibleCard>`.
- [Single-product mode uses page-level scroll] Don't conditionally mount the inactive tab panes in the single- product wrapper.
- [Pages unmount on tab switch; results live in `useSessionState`] Don't hold a result, or the selection it belongs to, in `useState` in a page.
- [Pages unmount on tab switch; results live in `useSessionState`] Don't key `useSessionState` without the identity it belongs to (the archetype for single-product runs).
- [Pages unmount on tab switch; results live in `useSessionState`] Don't persist it. Session only; a stored result outliving its inputs is the stale-number class the provenance work exists to prevent.
- [Visibility-toggle vs. conditional mount] Don't switch back to `{condition && <Panel />}`.
- [Visibility-toggle vs. conditional mount] Don't leave `data-testid` selectors in place but make them conditional (e.g. on activeTab or expanded).
- [Visibility-toggle vs. conditional mount] Don't move CollapsibleCard's children outside the toggle wrapper to "save renders".
- [Effects in visibility-toggle-mounted panels] Don't add `staticConfigByArc` (the whole map) to the deps, only the per-archetype slice.
- [Effects in visibility-toggle-mounted panels] Don't subscribe to `projectedConfigByArc` in the deps to "keep things consistent".
- [Effects in visibility-toggle-mounted panels] Don't reintroduce the "one-shot inheritance" semantic.
- [Effects in visibility-toggle-mounted panels] Don't move the banner-suppression off `bannerShownForArcRef`.
- [Effects in visibility-toggle-mounted panels] Don't set `defaultAllSelected` (or any auto-default) on a panel whose selection FEEDS a live-mirror — let it inherit.
- [Render-test discipline for result-presence states] Don't place hooks after early returns to "scope them" to the full-render path.
- [Render-test discipline for result-presence states] Don't write a single-state render test and assume it catches hook-ordering bugs.
- [Render-test discipline for result-presence states] Don't lift the affected state into a store as a workaround.
- [Render-test discipline for result-presence states] Don't disable the React error boundary that catches the throw in dev.
- [Single-product Impact Assessment Excel exports] Don't bundle Static + Prospective + Comparison into one mega-workbook.
- [Single-product Impact Assessment Excel exports] Don't move the builders into `mapper/api/lca.py`.
- [Single-product Impact Assessment Excel exports] Don't include the Stage breakdown sheet for specific-stage scopes.
- [Single-product Impact Assessment Excel exports] Don't write `Δ% = inf` or `NaN` when Static is zero.
- [Single-product Impact Assessment Excel exports] Don't reach for the per-scenario detail in the Comparison workbook for "rich" exports.
- [Onboarding tour] Don't blindly add a tour step for every new tab or feature.
- [Onboarding tour] Don't add per-feature deep-dive steps ("here's the multi-LCI chip, here's the format control, here's how to export charts").
- [Onboarding tour] Don't remove the `data-tour` attributes on sidebar tabs without updating the corresponding step's `target` selector.
- [DSM Dashboard parallel-input upload boxes] Don't ship visually asymmetric layouts for methodologically parallel inputs.
- [DSM Dashboard parallel-input upload boxes] Don't patch one box's props inline to fix the symmetry.
- [DSM Dashboard parallel-input upload boxes] Don't fold Stock into `<DSMUploadSlot>`. Stock isn't part of the parallel pair — it carries an aggregate toggle and single-upload semantics. Forcing it into the shared component would require bending the component with optional slots.
- [DSM Dashboard parallel-input upload boxes] Don't drop the drop-zone `minHeight` when refactoring `<CSVUploader>`.
- [Patch 5A+ — layout structure] Don't shoehorn Stock into a 3-/4-column grid with the temporal inputs.
- [Patch 5A+ — layout structure] Don't rely on `align-items: stretch` alone for parallel-input symmetry.
- [Patch 5A+ — layout structure] Don't drop `flexGrow`/`height: 100%` from `<DSMUploadSlot>` / `<SlotFrame>` when refactoring — without them the stretch backstop is a no-op (the bordered card won't fill the stretched grid cell).
- [Patch 5A+ — layout structure] Don't shorten or rewrite the subtitle / drop-zone text to "fix" wrapping.
- [DSM Simulation warnings panel collapse] Don't drop the count from the header when collapsed.
- [DSM Simulation warnings panel collapse] Don't conditional-unmount the warning body on collapse.
- [DSM Simulation warnings panel collapse] Don't default the panel to collapsed. Warnings signal data problems; hiding them by default risks users shipping analyses with unaddressed issues.
- [DSM Simulation warnings panel collapse] Don't classify the advisory warning by position (`warnings[0]`) or by matching its specific wording.
- [DSM start/end stock figures — top-left KPI card] Don't source `start` from `Σ YearResult.stock` / `summary.totalStock`.
- [DSM start/end stock figures — top-left KPI card] Don't compute `end` by reading the next year's record (`stock[year+1]`).
- [DSM start/end stock figures — top-left KPI card] Don't crash (or show 0) when the first-year initial stock is absent.
- [DSM start/end stock figures — top-left KPI card] Don't make one figure visually dominant. 5E equalizes them — same `valueStyle` object on both value nodes.
- [DSM start/end stock figures — top-left KPI card] Don't re-add a standalone "Total stock {year}" card.
- [Cohort → Archetype mapping is one source of truth] Don't snapshot store-derived data (cohort mapping, system definition, etc.) into component-local `useState`/`useRef` at mount.
- [Cohort → Archetype mapping is one source of truth] Don't keep a second copy of the cohort mapping in the Impact Assessment tab (or any consumer).
- [Cohort → Archetype mapping is one source of truth] Don't re-add an editing surface to IA without a product decision.
- [Cohort → Archetype mapping is one source of truth] Don't put the cohort mapping into the IA compute request body.
- [Header affordances must look actionable] Don't style a supporting header action as `ghost` (or bare text + click handler).
- [Header affordances must look actionable] Don't give a supporting action a filled/primary style on a page that already has a primary CTA.
- [Header affordances must look actionable] Don't hand-roll a bespoke button style. Reuse the `<Button>` primitive so border/hover/focus/cursor and icon+label `gap` stay consistent app-wide; let the primitive's `gap` space the icon (don't re-add manual icon margins).
- [Multi-item comparison page sections are collapsible] Don't build multi-item prospective/comparison compute or sensitivity cases under the banner of "structural alignment." Those are flagged functional gaps requiring an explicit decision — layout reshuffles must not silently grow new compute.
- [Within-type multi-item comparison + per-item vintages] Don't offer superstructure vintages for compute.
- [Within-type multi-item comparison + per-item vintages] Don't mix archetypes and activities in one comparison.
- [Within-type multi-item comparison + per-item vintages] Don't reintroduce positional `CHART_PALETTE[idx]` coloring for solid-mode items.
- [Within-type multi-item comparison + per-item vintages] Don't make the backend echo a bare reference-product label for activity items when a vintage is set.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Provenance is never shortened — the export's Vintages sheet (5R) reads structured `activity_vintage_meta`, not display strings.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Don't reuse `MultiScenarioImpactChart` or generalize `ProjectedTimeSeriesChart` for the Line view.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Don't make the grouped panel anything but display-only.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Don't key Line series color or Bar item color by the (shortenable) display label.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Don't conditionally unmount a section body on collapse.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Don't reach for the lighter popup-menu collapse (Advanced, Patch 4L) for page sections — that's for menus.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Don't over-nest — three top-level collapsibles only.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Don't auto-collapse Scope/Items when compute finishes.
- [Stage amounts are a shared capability — Single item + Multi-item] Don't hardcode the lighter surface — it's the `var(--bg-elevated)` token (one step up the surface scale), not a hex.
- [Stage amounts are a shared capability — Single item + Multi-item] Don't fork the stage-amount calculation for multi-item.
- [Stage amounts are a shared capability — Single item + Multi-item] Don't reimplement the preset math or summary line in the multi-item component.
- [Stage amounts are a shared capability — Single item + Multi-item] Don't change the default global preset away from `1year` without re-checking the backward-compat test — a different default would shift existing default multi-item results.
- [Multi-item export records per-item stage amounts] Don't export computed impact figures without the parameters that produced them (stage amounts, and more broadly scenario / method / scope).
- [Multi-item export records per-item stage amounts] Don't let single-item and multi-item exports diverge in what provenance they record.
- [Multi-item export records per-item stage amounts] Don't derive preset/lifetime from the resolved amounts.
- [Multi-item export records per-item stage amounts] Don't key `stage_amounts_meta` by `productItemKey` (`arc:{id}`) — the workbook identifies archetype items by `item_id` (= `archetype_id`).
- [Multi-item export records per-item stage amounts] Don't make the "Stage amounts" sheet replace or reorder existing sheets.
- [Multi-select chips/selectors anchor Pick/Add on the LEFT] Don't apply the rule here; reordering would break expected dropdown semantics.
- [Multi-select chips/selectors anchor Pick/Add on the LEFT] When establishing a layout convention, apply it universally in one patch; don't accumulate technical debt by deferring siblings.
- [Multi-select chips/selectors anchor Pick/Add on the LEFT] Hide the Results card entirely until a calculation has produced data — don't render an empty stub.
- [Page-level scroll for chart-rendering pages] Don't constrain page or result-body containers to viewport height — sequential reading (scroll the page) is preferred over panel-internal scrolling.
- [Page-level scroll for chart-rendering pages] Always-mount tab panels via the visibility-toggle convention (the existing rule) applies here too — don't conditional-mount panels to "save scroll height," just let `display: none` do the work.
- [Single-product mode uses page-level scroll] Spacing comes from the scale token, never hardcoded px.
- [Single-product mode uses page-level scroll] Any future card added to this pane follows the same rhythm (scale token, never hardcoded px).
- [Single-product mode uses page-level scroll] Don't reintroduce `height: 100%` / `minHeight: 0` / `flex: 1` on panel roots, tab panes, or `<CollapsibleCard>` instances within the single-product subtree.
- [Single-product mode uses page-level scroll] Same visibility-toggle rule as everywhere else — panel-local state (Configuration expanded/collapsed, scenario tab idx) must survive a tab switch.
- [Pages unmount on tab switch; results live in `useSessionState`] Anything computed, and the selection that produced it, goes through `useSessionState(key, initial)` (`stores/sessionStateStore.ts`): a drop-in for `useState` backed by a project-scoped store (reset on project change, session only, never persisted).
- [Visibility-toggle vs. conditional mount] When fixing a "state disappears on switching" bug, do NOT lift the affected state into a store as a first instinct.
- [Visibility-toggle vs. conditional mount] Lift state only when you have a separate reason to share it across components — never as a workaround for unmount-on-hide.
- [Effects in visibility-toggle-mounted panels] The mirror source being seeded to the full default regardless of visit order is the convention; `projectedCustomized` is set only by genuine user changes, never by the default seed.
- [Effects in visibility-toggle-mounted panels] The fix is almost always "add the slice of X to Y's deps." Then ask "what's the off-switch?" — explicit user customization is usually the right answer; first-fire heuristics fail in incremental-edit workflows.
- [Hooks must be called unconditionally] The rule: every hook (`useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, custom hooks, store hooks like `useSomeStore(...)`) must run before ANY conditional `return`.
- [Render-test discipline for result-presence states] A hook that's only "needed" in one branch must still be called unconditionally — its return value can be ignored when the branch isn't taken.
- [Δ chart framing in Single-product Comparison] Do not relitigate without a user-driven reason; document the next pivot here so the back-and-forth is visible.
- [Onboarding tour] If a new feature is genuinely load-bearing for the canonical research path, replace or modify an existing step — don't append.
- [DSM combined "Inflows & Outflows" flows chart] Don't fetch/recompute inflows (sum `simulationResult.years[].inflow`); don't index-color the series (fixed per-key via `FLOW_COLORS`); don't stack inflow into the outflow column (separate `stackId` → grouped, side-by-side).
- [Patch 5A+ — layout structure] The inflows/outflows pair always splits its row 50/50 regardless of stock upload state.
- [DSM Simulation warnings panel collapse] Hide the body, never the `(N)`.
- [DSM start/end stock figures — top-left KPI card] Do NOT revert to `start = Σ stock` of the selected year — that's the END figure (the 5C/5D bug).
- [Cohort → Archetype mapping is one source of truth] One mapping in `dsmStore`, consumed downstream by Material Flows and Impact Assessment — never duplicated per consumer.
- [Header affordances must look actionable] Actionable header affordances must render with the shared `<Button>` primitive (`components/ui/Button.tsx`), never plain text with a click handler.
- [Multi-item comparison page sections are collapsible] Collapsed headers carry a live summary read at render (never snapshotted at collapse time): Scope → `scope · method · N indicators` (selected family + selected count; the bare `<MethodPicker>` owns its selection internally, so the family's *total* "of M" isn't available to the parent without swapping the picker — out of scope, so we show the selected count); Items → `N selected`; Results → `N successful, M failed`.
- [Multi-item comparison page sections are collapsible] Multi-item is N-item — align it to single-item's structure by analogy, never by forcing single-select shapes onto it.
- [Multi-item comparison page sections are collapsible] Don't replace the multi-select selector with a single-archetype dropdown, and don't collapse the per-item editors into one.
- [Within-type multi-item comparison + per-item vintages] Multi-item comparison is within-type: a comparison is of ONE type — archetypes OR activities, never mixed.
- [Within-type multi-item comparison + per-item vintages] (The old `mode="mixed"` is retired here — `<MultiItemSelector>` still supports `'mixed'` for other contexts, but multi-item comparison never uses it.)
- [Within-type multi-item comparison + per-item vintages] We do NOT reimplement prospective resolution and do NOT call `_resolve_prospective_dbs` per item — the registry is the single source of truth on both sides.
- [Within-type multi-item comparison + per-item vintages] Each activity × vintage is an independent comparison item with its own DB; reuse `_resolve_prospective_dbs` (via the registry the frontend reads), don't reimplement prospective resolution.
- [Within-type multi-item comparison + per-item vintages] The vintage picker groups by the full scenario (model · ssp-budget), matching single-item — never group by SSP alone (it collapses pkbudg1150 vs base); the grouping and ALL YEARS/CLEAR controls are display-only and must not change the checked-vintage → comparison-item mapping.
- [Within-type multi-item comparison + per-item vintages] The multi-item database selector belongs to Activities mode only and must not render in Archetypes mode — but never remove it without first confirming the archetype compute path does not read selectedDatabase as its background.
- [Within-type multi-item comparison + per-item vintages] Lifecycle scope (and stages) apply to archetypes only — the SCOPE selector must not render in Activities mode, and activities compute against Full Lifecycle; never remove the selector without confirming activity compute doesn't depend on a non-Full scope.
- [Within-type multi-item comparison + per-item vintages] Per-item color must be stable (keyed by `item_id` via the shared resolution — Patch 5S moved the key off the label so display-shortening can't recolor) so a removed/reordered item doesn't recolor its neighbours — the whole point for comparing N vintages over time.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Derived from the results being charted, never from the live selection or compareMode: results can outlive a mode switch (the selection clears per 5R) and not every Activities-mode result is line-able (multi-distinct-activity has no year axis).
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] `effectiveChartType` never renders Line when disabled.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Line availability is derived from the displayed results' year axis (≥2 distinct years across scenarios) — never from the live selection or compareMode; keying it to the selection disables Line on valid line-able results once the selection changes, and keying it to the mode disables it on stale-but-line-able results and wrongly enables it for multi-distinct-activity comparisons.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Line view is per-scenario over years, not per-item — group by (base+IAM+SSP+budget) and plot by year; don't string-parse the label if structured coordinates exist.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Display-shorten labels via common-prefix stripping; never drop provenance from the export.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Shortening is display-only; the Vintages sheet always records the full structured database/SSP/year.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Reuse `useElapsedSeconds` (it does both via effect cleanup); don't hand-roll a `setInterval` without a cleanup path.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] It's rendered via the selector's `renderSelectedItems` seam; it must not own selection/removal logic beyond calling the parent's `onRemove`, and must never alter the compute payload.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Archetype mode must keep the default chip list (don't pass the override there).
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Use the collapsible's visibility-toggle (`display: none`, body stays mounted) so item selection, search text, scroll, and chart/table state survive collapse/expand — same reason tabs don't unmount.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Collapsed-header summaries must read from the live source at render, never a value captured when the section collapsed — or the summary goes stale (cf. the cohort-mapping single-source fix, Patch 5F).
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] `<CollapsibleCard>` is the right primitive for big content blocks; don't swap them.
- [Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer] Don't make Indicator Selection independently collapsible *inside* the now-collapsible Scope card.
- [Stage amounts are a shared capability — Single item + Multi-item] A global preset (in `MultiProductLCA`) sets the default for all items (apply-to-all overwrites every entry); new items seed from the current global preset, removed items are pruned — reconciled against the live selection by a `useEffect`, never a parallel copy of `selectedItems`.
- [Stage amounts are a shared capability — Single item + Multi-item] The elevated + numbered treatment is an opt-in CollapsibleCard variant for per-item cards only — never lighten the shared card globally, or the hierarchy with ITEMS TO COMPARE / CONFIGURATION is lost.
- [Stage amounts are a shared capability — Single item + Multi-item] The number badge is display order, 1-based, re-sequenced on add/remove — derive it from the rendered/filtered item list's index, not a stored field; it must track selection order/count (reinforcing "N selected" / "Compute (N items)").
- [Stage amounts are a shared capability — Single item + Multi-item] Both Single item and Multi-item compute MUST call the same server-side `calculate_archetype_lca`, so an equivalent configuration produces identical results.
- [Stage amounts are a shared capability — Single item + Multi-item] Don't maintain a parallel copy of the selected-items list (it drifts); the `stageAmountsByItem` map is reconciled by an effect with an only-set-if-changed guard.
- [Multi-item export records per-item stage amounts] Exported research outputs must be reconstructable from the export itself — the numbers PLUS the assumptions, not the numbers alone.
- [Multi-item export records per-item stage amounts] Both capture preset + lifetime + per-stage amounts via the shared `StageAmountsMeta`; a new field added to one path's provenance must be added to the other (and to the type). 5K+ closed the 5J gap — don't reopen it.
- [Multi-item export records per-item stage amounts] Thread them from the frontend store via `stage_amounts_meta`; fall back to "—" when absent, never guess.
- [Within-type multi-item comparison + per-item vintages] (Patch 5Z: grouping uses the structured `(base_db, iam, ssp)` coords, not string-parsing; the shared `<ScenarioYearPicker>` is selection-agnostic — changing it must keep both single-item and multi-item behavior-preserving.)

## Frontend type-check (canonical gate)

The canonical per-patch type-check is **`npm run type-check`** (= `tsc -b`),
which is the SAME tsc invocation `npm run build` (`tsc -b && vite build`)
enforces. Run it after any frontend change and treat a non-zero exit as a
blocking failure — a patch is not "tsc clean" until this passes.

**The gap that let errors accumulate (Patch 5AI):** earlier patches verified
with a bare `tsc --noEmit`, which checks the ROOT `tsconfig.json` — but the
root config is `{ "files": [], "references": [...] }`, so `tsc --noEmit`
type-checks **nothing** and exits 0 even with real errors. The strict rules
(`strict`, `noUnusedLocals`, `noUnusedParameters`) live in `tsconfig.app.json`,
which only the project-reference build (`tsc -b`) walks. Always use `tsc -b`
(via `npm run type-check` or `npm run build`); never `tsc --noEmit` against the
root config as a gate.

Patch 5AI cleared the 60→0 accumulated backlog with no suppression: the
dominant bucket was the Recharts 2→3 type migration — custom tooltips switch
from `TooltipProps<V,N>` to `Partial<TooltipContentProps<V,N>>` (active /
payload / label live on `TooltipContentProps`, not `TooltipProps`), and
`<Tooltip formatter>` callbacks must type their value param as Recharts'
`ValueType` (drop the `(v: number)` annotation, coerce with `Number(v)` in the
body) because `Formatter`'s value param is contravariant.

## Frontend testing

Vitest + @testing-library/react + @testing-library/jest-dom + jsdom configured
end-to-end (shipped alongside Patch 2E.2). `vitest.config.ts` loads
`tests/setup.ts` (jest-dom matchers imported); test files live under
`mapper-frontend/tests/` matching `**/*.test.{ts,tsx}`.

Scripts (in `mapper-frontend/package.json`):
- `npm test` — watch mode for active development
- `npm run test:run` — one-shot run for CI / verification

Convention: frontend state-machine tests should be added in the same patch
that ships the state-machine logic. The "skip frontend tests, no runner"
exception is retired.

First landing: `tests/axisConflict.test.ts` (9 cases on the 3-way
axisConflict rule, covering all single-axis allowances, the three pairwise
conflicts, the three-way conflict, and the N=0 boundary).

### A frontend suite that will not start is the TOOLCHAIN, not the test

Observation, recorded because the error names nothing useful and the machine it
happened on is the one MApper is developed on.

Every frontend test file — including ones the branch never touched — failed with

    Error: [vitest-pool]: Failed to start forks worker for test files ...
    Caused by: TypeError: Class extends value undefined is not a constructor or null

reported as `Test Files no tests`, which reads like a discovery problem. It is
not. `--pool=vmForks` surfaces the real frame:
`jsdom/lib/generated/idl/AbortSignal.js:249` — jsdom's `AbortSignal` shim is
incompatible with the locally installed **Node 25.9.0** (Homebrew). CI pins Node
**24**, so it never appears there, and vitest's own `engines` (`>=24.0.0`)
accepts 25, so the version looks supported.

Two things that follow:

- **Check whether an UNTOUCHED test file fails the same way before debugging the
  branch.** That one check separates "my change broke the suite" from "the
  runner cannot start", and the second costs nothing to rule out.
- **A test with no DOM can still run**: `--environment=node`. The
  filename-parity test is pure functions and passes locally that way (16/16)
  while the jsdom-environment files cannot start at all.

**RESOLVED by the jsdom 26 → 30 bump (#89) — the limitation above is over.**
Measured on the same machine, same Node **25.9.0**, immediately after #89
merged: the full frontend suite runs locally, **198 files / 1412 tests, all
passing, 230 s**. A single jsdom file also runs under `--pool=forks`,
`--pool=threads` and `--no-file-parallelism` alike. Nothing about the Node
install changed; jsdom 30 simply no longer trips over it.

**The lesson is about the note, not the bug.** This was written down as a
durable property of the machine ("changing the user's Node install is their
call"), and it then stopped being true because of an unrelated routine
dependency bump — with nothing to announce it. It had been re-diagnosed as an
unexplained local limitation three times in a week — including once in the very
session that then measured it working, where the fix had already merged an hour
earlier and the limitation was quoted as a reason to defer a check to CI.

So: **an environment limitation recorded here is a snapshot,
not a standing fact — re-test it after a major bump of the tool it names,
before quoting it as a reason.** The re-test cost one command.

Two corollaries that survive:

- `--environment=node` is still the right runner for a DOM-less guard — it is
  faster, not a workaround, and the source-sweeping guards use it by choice.
- **Check CI for the same commit before debugging a local-only failure.** If CI
  is green on the very commit that fails here, the toolchain is the difference,
  and that remains the cheapest first check.

The original entry closed by saying it was "not fixed here — changing the user's
Node install is their call". That was true when written and is now superseded:
no Node change was ever needed. Kept above rather than deleted, because the
crash signature is still the thing to search for if a future jsdom or Node pairing
regresses, and because the shape of the mistake is the more durable lesson.
Related in kind to the disk-pressure episode: check the environment before the
data — and then check that the environment note is still true.

### Test determinism — mock the function the component actually calls (Patch 5L)

`tests/logEntryCopy.test.tsx` was intermittently failing on full-suite runs
(~25–30%), clean on re-run. **Root cause: the test mocked the wrong function
name.** `LogsPanel`'s mount effect calls `getSystemLogs(500)`, but the test
mocked `fetchSystemLogs` — a name the panel never calls. So the *real*
`getSystemLogs` ran on mount, making a real network `fetch` whose
resolve/reject timing varies with machine load; its `setLoading` /
`setLoadError` / `setBackendLines` updates fired at unpredictable moments
*during* the test, re-rendering the row mid-interaction. That produced the
load-dependent, order-independent flake — surfacing variously as "writeText
called 0 times", "Copied ✓ not found", or the row's button not appearing.
It was NOT a clipboard mock bleed (instrumentation confirmed the stub stayed
intact every run) and NOT a real bug in the copy feature. Fix: mock
`getSystemLogs` (correct name + `log_path` return shape) so the mount resolves
immediately and deterministically — no stray network call, no mid-test
re-render. Verified green 12/12 isolated and 10/10 full-suite consecutive.

#### What NOT to do

- **Tests must be order-independent and not depend on real I/O.** Mock the
  function the component *actually calls* — verify the import name against the
  component, don't assume. A mock under the wrong name silently no-ops: the
  real network/clipboard/timer call runs, and its variable async timing
  becomes a load-dependent flake. (Here: mocked `fetchSystemLogs`, component
  called `getSystemLogs`.) When a test is "flaky on first full-suite run,
  clean on re-run", suspect a real async call (wrong/absent mock) before
  blaming the assertion.
- **Async clipboard + `setTimeout` label flips need deterministic flushing,
  not bare/`waitFor` assertions racing real time.** Click inside
  `await act(async () => { fireEvent.click(...) })` (flushes the awaited write
  AND the resulting re-render), then assert synchronously — so the "Copied ✓"
  check can't lose to the component's 1500ms revert-to-"Copy" timer.
- **Don't reach for `vi.useFakeTimers()` to fix a `findBy`/mount-driven
  test.** Freezing timers reorders a component's mount-fetch resolution and
  can detach the very nodes the test queries. Fix the mock + flush with `act`
  instead.

## Cohort mapping section + per-dim-value color overrides (Patch 4AJ)

Patch 4AJ does two small but coupled things on the Impact Assessment
Cohort mapping section:

**Section rename.** The collapsible header in `CohortMappingEditor.tsx`
reads `Cohort mapping` (previously `Cohort → Archetype`). The arrow
glyph is an unforced naming wart — the section maps cohorts, that's
the noun.

**Per-dimension-value color overrides.** Each Fuel / Size / etc.
dim-value pill in the cohort mapping table is now a clickable button
that opens `<DimensionColorPicker>` anchored to the pill. The picker
offers a 20-swatch preset grid (CHART_PALETTE), a hex input, and a
Reset-to-auto button. Selecting a color via any path overrides that
dim value's color **everywhere it appears** — DSM Stock Composition,
Impact Assessment by-cohort, Material Flows, any future chart that
visualizes the same dim. Per-project persistence (writes to the same
`useChartColors` localStorage map already keyed by current project).

**Three architectural decisions locked in**:

1. **Per-dim-value, not per-row.** Setting BEV-LFP → teal changes
   BEV-LFP's color in every cohort it appears in, not just the
   clicked row's cohort. The user's mental model is "BEV-LFP is
   teal everywhere"; per-row overrides would fragment that.

2. **Per-project, single map.** Overrides write through to the
   existing `mapper-color-assignments-<project>` localStorage map
   that `useChartColors` already reads. No new persistence layer.
   A parallel `mapper-color-overrides-<project>` JSON array tracks
   which entries in the color map were set explicitly by the user
   vs. assigned by the deterministic algorithm — `getOverriddenLabels(scope)`
   reads it. The split lets `Reset to auto` distinguish "no
   override → button disabled" from "override exists → click to
   revert."

3. **Click-pill popover, not a column.** The pill IS the affordance.
   Adding a separate "Color" column would clutter the table and
   spatially separate the action from the thing it changes. Click,
   pick, close. No commit button — every interaction in the picker
   is immediate.

**Reactivity contract.** `useChartColors` listens for a
`mapper-color-changed` `CustomEvent` on `window`; `setLabelColor` /
`clearLabelColor` dispatch it with `detail.scope`. Consumers in the
matching scope re-render via an internal `tick` state. Without this
event, localStorage writes are invisible to React.

**Determinism preserved.** `assignColors` continues to assign new
labels deterministically (alphabetical + skip-used-palette-slot).
Reset clears the user override; the next `assignColors` call
reassigns the same auto color it would have picked originally,
because the algorithm walks `CHART_PALETTE` in order skipping
already-used colors. The "Reset to auto" guarantee is that the
revert is to the SAME color the user would see on a fresh project
with no overrides — not a random shuffle.

### What NOT to do

- **Don't add a separate `mapper-color-overrides-*` map of `{label →
  color}` and read color from it.** That would mean two sources of
  truth (overrides map + assignments map) and a precedence rule the
  rest of the codebase doesn't know about. The override IS just a
  user-set entry in the assignments map; the parallel set tracks
  only "is this entry a user choice" — never the color itself. One
  source of truth for color resolution.
- **Don't fan out the picker to other panels (DSM Dashboard, Impact
  Assessment by-cohort chart, etc.) as additional click affordances**
  for the same dim values. The Cohort mapping table is the single
  entry point — adding more click sites would invite confusion when
  two pills look slightly different in different panels (which they
  shouldn't, but discoverability vs. consistency is a UI tradeoff
  that breaks). If a future patch wants to make legends clickable to
  pick colors, that's a separate design decision.
- **Don't bypass `setLabelColor` and write to localStorage
  directly.** The function maintains the parallel overrides set, the
  event pubsub, and the no-op short-circuits in one place.
  Bypassing it means the Reset button can't tell if a label is a
  user override, AND consumers won't re-render.
- **Don't trigger `setLabelColor` from any code path the user didn't
  intend as an override.** Algorithm-derived assignments must go
  through `assignColors` (which writes to `mapper-color-assignments-*`
  WITHOUT touching the overrides set). The promotion-to-override
  semantics is the contract: only the picker writes to the overrides
  set, only the picker calls `setLabelColor` / `clearLabelColor`.
- **Don't make the picker show all rendered colors as preset
  options.** The preset grid is `CHART_PALETTE` exactly — 20 fixed
  colors. Pulling in scenario palettes, AESA indicator palettes, or
  other palette sources would invite cross-palette mixing (e.g.
  picking a SCENARIO_PALETTE blue for a cohort, then the same blue
  appearing on an unrelated scenario line). One palette for one
  picker; the hex input is the escape hatch.
- **Don't persist the picker's open state.** It's a per-click
  popover — closing on outside-click / Escape / color-applied is
  the only valid lifecycle. State persistence (e.g. "reopen the last
  pill the user touched") would be a fix to a problem nobody has.
- **When testing the picker, set `useProjectStore.currentProject`
  in the test fixture.** The picker writes to
  `mapper-color-assignments-<currentProject>` — tests that omit the
  project setter will write to `_global` and assertions against the
  project-scoped key will silently miss. The fixture in
  `tests/cohortMappingColorOverride.test.tsx` is the template.

### Palettes are PER SYSTEM, and MAp-test's two disagree on one archetype

`row_colors` lives on each system's `cohort_mappings.json`, so two systems in
the same project hold independent palettes. In MAp-test they were assigned
separately and **agree on 16 of 17 archetypes, differing on ICEV-Petrol**:

| | Car Fleet | WP5 |
|---|---|---|
| ICEV-Petrol (all three sizes) | `#ea580c` | `#ef4444` |
| the other 16 archetypes | identical | identical |

Harmless inside either system — each is internally consistent, one colour per
archetype across all its sizes. But **a figure drawing on both would render that
archetype in two colours**, which reads as a data problem rather than a palette
one and is the sort of thing that costs an afternoon.

Not "fixed": neither palette is authoritative, and silently rewriting one
system's colours to match the other would change published figures for whichever
system lost. If a cross-system figure is ever needed, harmonise deliberately and
say which way it went.

## Two-layer color overrides — per-dim + per-row (Patch 4AK)

Patch 4AK adds a **per-row coloring layer that COEXISTS with** Patch 4AJ's
per-dimension layer. Two color systems with different scopes and
different resolution rules, side by side:

- **Per-dimension (Patch 4AJ)** — a single dim value (e.g.
  `BEV-LFP`) gets a color applied to single-dim stacked charts
  (DSM Stock Composition stacked by Fuel, Impact-by-cohort grouped
  by Fuel). Persisted in localStorage via `setLabelColor` /
  `clearLabelColor`. PRESERVED unchanged.
- **Per-row (Patch 4AK)** — one cohort row (e.g. `BEV-LFP|Small`)
  gets a color applied to both pills in the Cohort Mapping table
  AND to that cohort key in **cohort-key stacked charts** (DSM
  Stock Composition with stackByDimension=null, Impact-by-cohort
  without grouping). Persisted server-side on
  `CohortMapping.row_colors: dict[cohort_key, hex]` so Excel
  round-trip carries them.

### Resolution priority

Two distinct chart contexts, two distinct rules:

| Chart context             | Resolution priority                                              |
|---------------------------|-----------------------------------------------------------------|
| Cohort-key stacking       | Row override → algorithm modulo fallback                        |
| Single-dim stacking       | Row override → per-dim override (Patch 4AJ) → algorithm fallback |

`useDSMSystemColors(activeSystem, stackByDimension, { rowColorOverrides })`
is the single source of truth.

**An EXPLICIT per-cohort override always wins — in BOTH cohort-key and
single-dim stacking (colour-fix, supersedes the original Patch 4AK
"single-dim ignores row overrides" rule).** `colorForCohort` is only
ever called with full cohort KEYS by "by-cohort" charts (Impact-over-time
by cohort, `ExpandedCohortChart`, multi-scenario facets), where each
series is exactly ONE cohort — so a per-cohort colour is well-defined
regardless of the Stack-by grouping. Because `stackByDimension` defaults
to the first non-age dimension on every system load (`dsmStore`), the
old "single-dim ignores row overrides" rule silently dropped every
user-assigned primary `CohortMapping.row_colors` AND subsystem
`SubsystemCohortMapping.color` to the algorithmic palette on the
"Impact over time, by cohort" chart — the reported "chart ignores my
assigned colours" bug. The refined rule: **row override first (both
modes); a cohort WITHOUT an override still groups under its dim value in
single-dim mode** (per-dim colour → Patch 4N/5AG cross-chart fuel-colour
consistency preserved), or gets the deterministic palette in cohort-key
mode.

This does **NOT** affect DSM Stock Composition: that chart reads
`colorMap` directly (one colour per merged dim band) and never calls
`colorForCohort`. Locked by `tests/byCohortAssignedColors.test.tsx`
(assigned primary + subsystem colours resolve under the DEFAULT non-null
`stackByDimension`; both bare and `<system_id>::`-prefixed key formats
resolve; unassigned cohorts unaffected by the override map) and the
updated `tests/patch4ak.test.tsx`.

### Storage models, deliberately different

Per-dim is a chart-display preference that spans dimensions outside
the cohort mapping, so it lives in **localStorage** (Patch 4AJ
contract preserved). Per-row IS a property of the cohort mapping
entry, so it lives **server-side** on `CohortMapping.row_colors`.
This split:

- Avoids dual sources of truth (localStorage + backend) that Excel
  round-trip would force on a unified model.
- Lets the per-row state flow through `saveCohortMappings`
  end-to-end without a parallel sync layer.
- Keeps Patch 4AJ's reactivity contract (the
  `mapper-color-changed` custom event) targeted to per-dim only —
  per-row reactivity flows through zustand state updates on
  `dsmStore.cohortRowColors`.

### Picker mode toggle

`<DimensionColorPicker>` now has a **mode toggle** at the top of the
popover: "This row" / "All {label}". Defaults to "This row" — the
more granular and (per the user spec) more common workflow. Both
modes share the same 40-color palette, hex input, and Reset-to-auto
button. Each mode's Reset clears ONLY that layer's override; the
other layer is unaffected.

`onSetRowColor` / `onClearRowColor` callbacks wire the row mode to
the `dsmStore` actions; the dim mode continues to call
`setLabelColor` / `clearLabelColor` directly (Patch 4AJ path
unchanged).

### Excel upload derivation — row → dim at the import boundary (Patch 4AK²)

When the Excel cohort-mapping file is uploaded, the per-row colors
in the Color column are **also derived into per-dim overrides at
the import boundary**, but ONLY when unambiguous.

**Derivation rule** (`deriveDimColorsFromRowColors` in
`utils/dsmCohortColors.ts`):

For each dimension value V, collect the colors of every row whose
cohort key contains V:
- 1 unique color across all V-containing rows → that color is the
  derived per-dim override for V.
- 0 colors (no rows have a color set for V) → no derivation.
- ≥2 colors → ambiguous → no derivation; per-row overrides still
  apply in cohort-key stacked charts.

**Example (the WP5 bug-fix scenario)** — Excel with 51 rows, where
each Fuel family (BEV-LFP, HEV-LFP, …) has 3 rows (Small, Sedan,
SUV) all sharing one hex:
- BEV-LFP rows all carry `#60a5fa` → derived: `BEV-LFP → #60a5fa`
- HEV-LFP rows all carry `#22c55e` → derived: `HEV-LFP → #22c55e`
- Size values (Small, Sedan, SUV) each appear across 15 fuel
  families with 15 different colors → ambiguous → NOT derived

Result: DSM Stock Composition stacked by Fuel reflects the
uploaded palette immediately (via per-dim Patch 4AJ resolution).
Cohort-key stacked charts also reflect it (via per-row Patch 4AK
resolution). The user's intent "BEV-LFP is blue everywhere" is
served by both layers without aggregating row colors at chart
resolution time.

**Why at upload only, not in-app**:
- Upload is a one-shot bulk expression of user intent. The "if
  unambiguous, derive" rule translates the Excel data shape (one
  Color column per row) into the two-layer resolution model
  without UI complexity.
- The in-app per-row picker stays one-way (row only) — propagating
  to per-dim on every picker click would silently overwrite
  intentional per-dim variations the user set via the
  picker's dim mode.

**The runtime architectural separation is preserved**: chart
resolution still reads per-dim for single-dim stacking, per-row
for cohort-key stacking. The derivation only happens at the
import boundary, populating both layers from one source.

### Excel round-trip scope

Excel template export/import handles **per-row only**:

- Template export (`GET .../cohort-mappings/template`): emits a
  `color` column at the end. Populated with `#RRGGBB` hex when the
  row has an override, blank otherwise.
- Template upload (`POST .../cohort-mappings/upload`): parses the
  `color` column. Empty / `auto` → no override. Valid 6-digit hex
  → stored in `CohortMapping.row_colors`. Invalid → surfaced in
  `CohortMappingResult.invalid_row_colors` as `<cohort_key>: <bad
  value>` without dropping the row's archetype + scaling_factor.

**Per-dim overrides DO NOT round-trip through Excel.** They're
UI-driven via the per-dim picker mode. Documented limitation
because per-dim isn't a property of the cohort mapping data — it's
a chart preference that spans dimensions.

### Picker palette: 40 colors

`CHART_PALETTE` expanded from 20 → 40 (Patch 4AK). Organized as 20
base hues + 20 darker shades, laid out in 4 rows × 10 columns in the
picker preset grid. The wider palette supports light/dark curation
(e.g. picking a darker shade for the "older" cohort vs. a lighter
shade for the "newer" cohort in a fleet over time).

The expanded palette is shared by both picker modes AND by the
existing algorithm fallback in `assignColors`. Algorithm
deterministic-assignment behaviour is byte-stable: it just has more
distinct slots before wrap.

### What NOT to do

- **Don't aggregate row colors when stacking by single dimension.**
  Single-dim stacked charts MUST use per-dim Patch 4AJ overrides;
  row colors apply only when stacking by cohort key. Mixing systems
  creates visual inconsistency — a user-set BEV-LFP|Small row color
  silently bleeding into the BEV-LFP fuel-stack slot would conflict
  with other (BEV-LFP, *) cohorts that don't carry the same row
  color.
- **Don't make the per-row override apply to one pill only.**
  Per-row colors both pills in the row. The user's intent in
  setting a row color is visual unity within that cohort —
  individual-pill coloring within a row would be the per-dim
  affordance, which already exists as the "All {label}" mode in
  the picker.
- **Don't remove the Patch 4AJ per-dim picker mode.** Both layers
  coexist for different chart workflows; removing per-dim would
  break single-dim chart customization (e.g. "BEV-LFP is always
  teal everywhere" across DSM Dashboard's various stack-by views).
- **Don't propagate per-dim colors to cohort-key chart stacking.**
  When a row has a row override, cohort-key chart uses it. When a
  row doesn't, cohort-key chart falls back to algorithm modulo —
  NOT to per-dim. Per-dim and per-row are parallel systems, not
  nested. A user who wants "all BEV-LFP rows to share the BEV-LFP
  per-dim color in cohort-key stacking" should set the per-dim
  override AND switch the chart to single-dim stacking — the
  cohort-key view is for distinguishing individual cohorts.
- **Don't unify the storage models.** localStorage for per-dim,
  backend for per-row is intentional. localStorage-only per-row
  would force frontend post-processing of Excel exports (no
  client-side xlsx library) or a separate sync layer with the
  backend; backend-only per-dim would couple chart preferences to
  cohort mapping data semantically. Different scopes → different
  storage models.
- **Don't move the per-row state out of `cohortRowColors` into a
  separate localStorage layer for "consistency with Patch 4AJ".**
  See above. The reactivity flow (zustand `cohortRowColors` state →
  chart re-render) is enough; adding a parallel localStorage layer
  creates dual-source-of-truth bugs the first time the server-side
  storage is updated (e.g. via Excel upload from another browser
  tab).
- **Don't pass `rowColorOverrides` to `useDSMSystemColors` in
  charts that visualize per-dim slices.** Single-dim charts must
  pass through to the per-dim resolution — passing row overrides
  in is a no-op today (the hook ignores them in single-dim mode)
  but invites future misuse. Charts that visualize cohort-key
  stacking MUST pass them in.
- **Don't auto-derive per-row color from per-dim colors** (e.g.
  "BEV-LFP|Small = avg(BEV-LFP per-dim, Small per-dim)"). The two
  layers are independent expressions of user intent; cross-layer
  derivation would silently invalidate either pick when the other
  changes.
- **Don't drop the picker's mode toggle for "discoverability".**
  Per the user spec (option c), the mode toggle is the load-bearing
  affordance that exposes both layers in one picker UI. Defaulting
  to "This row" makes the common case one-click; switching to
  "All {label}" is one extra click for the per-dim case.
- **Don't round-trip per-dim overrides through Excel.** Out of
  scope. Per-dim is a chart preference, not part of the cohort
  mapping data structure. If a future workflow needs per-dim
  round-trip, ship a separate export/import action for it (e.g. a
  JSON-based "Chart preferences" import) rather than bolting it
  onto the cohort mapping Excel template.
- **Don't strict-match 3-digit hex (`#abc`)** in the Color column
  parser. Excel doesn't auto-expand 3-digit hex on save; users who
  type `#abc` likely meant `#aabbcc` but the parser can't know.
  Strict 6-digit-only matching with row-level error surfacing is
  the safest contract.
- **Don't make the dim derivation bidirectional.** Excel upload
  propagates row → dim when unambiguous; the in-app per-row picker
  does NOT auto-update dim overrides. Each layer stays addressable
  independently after the initial upload. Bidirectional propagation
  would silently overwrite intentional per-dim picks every time the
  user adjusts a row.
- **Don't propagate dim overrides to row overrides on upload (or
  ever).** Asymmetric: row → dim (when consistent), dim → row
  (never). Reason: dim is the broader scope; deriving rows from dim
  would overwrite intentional per-row variations. A user who sets a
  per-dim color via the picker's "All {label}" mode is expressing
  a chart-level preference, not a cohort-mapping data property.
- **Don't run the derivation on every `fetchCohortMappings` call.**
  Derivation runs at the **upload boundary** (`handleFile` in
  `CohortMappingEditor`), not on every fetch. Running on fetch
  would re-derive on page reload, potentially overwriting per-dim
  picks the user made between uploads. The fetch path is read-only
  for the per-dim layer.
- **Don't move the derivation to the backend** as "the parser
  should produce the per-dim map too." Per-dim is a frontend-only
  state (localStorage chart preference, Patch 4AJ contract). Moving
  derivation server-side would force the backend to know about a
  storage layer it has no reason to know about and would couple
  the import handler to chart-rendering concerns.
- **Hex case must be normalized to a single canonical form
  (lowercase `#rrggbb`) before storage AND comparison.** User
  input from Excel comes uppercase; UI picker may emit lowercase;
  hex-input field accepts either. Without normalization, equality
  checks fail across sources: a row written `#FF00FF` and another
  written `#ff00ff` for the same Fuel would be classified as
  "different colors" by a Set-based comparison, breaking the
  derivation's "all rows share one color" check. The
  `normalizeHex()` utility in `utils/chartColors.ts` is the
  canonical normaliser; apply at every write boundary
  (`setLabelColor`, `setRowColor`, future stores) and at the
  derivation's comparison set.
- **Treat 'auto' / empty Color cells as 'no opinion' in
  derivation, not as conflict.** A Fuel value with 2 colored rows
  + 1 auto/empty row should still derive when the 2 agree. The
  backend already strips auto/empty before persisting to
  `row_colors`, but the derivation function ALSO filters them out
  defensively so any future caller (manual JSON edit, test
  fixture, a different upload path) can't trip the function into
  a false-conflict state. Real conflicts are 2+ DIFFERENT hex
  values for the same dim value — those still correctly suppress
  derivation.
- **Don't introduce a separate write path that bypasses
  `normalizeHex`.** Every persisted color must flow through the
  utility. Most callers won't bother thinking about case; the
  invariant should be enforced at the boundary, not relied on at
  every call site. If a future store action persists colors, it
  MUST call `normalizeHex` first.

## Project-scoped stores must reset on project change (Database Explorer staleness)

Found 2026-08-07 verifying the Windows v0.1.6 installer; **fixed before
v0.1.6 shipped** (Cause B sat on the licence-free demo path a JOSS reviewer
follows). Kept here because it is a two-part failure that a green test suite
actively concealed.

**Symptom.** Switching projects leaves the Database Explorer rendering the
PREVIOUS project's database list and activity table. Switch to a project the
backend reports as having 0 databases and the page still shows the old
project's activity count (e.g. "4,362 activities") with the database
`<select>` gone; the `hasDatabases === false` empty state — and with it the
**"Load demo project" button, which only renders inside that empty state** —
never appears. Symmetric in the other direction: right after the demo button
switches projects, the explorer says "No databases in this project yet" while
`GET /api/databases` returns two.

**Not a backend bug.** `GET /api/databases` is correct throughout; only the
frontend view is stale. A webview reload (Ctrl+R) fixes it every time, which
is the tell: the data is refetched on mount but not on project change.

**Reproduced** from both Settings and the Database Explorer itself, before
and after an app restart. A **cold boot into a database-less project renders
correctly**, so a genuinely new user (fresh install, empty project) is NOT
affected — this bites mid-session project switching, which includes anyone
demoing MApper by hopping between projects.

**Root cause — TWO independent bugs that produce the same symptom.** Diagnosed
2026-08-07; both are small fixes, but fixing only one leaves half the symptom.

*Cause A — switching TO a project (stale activity table).*
`projectStore.switchProject` is fine: it calls `refreshProjectsAndDatabases`,
so `projectStore.databases` DOES update. The stale data lives in the OTHER
store — **`useActivityStore` is never reset on project change**.
`selectedDatabase` keeps pointing at the previous project's db (e.g.
`biosphere3`) and `activities` keeps the previous page. The initialise effect
(`DatabaseExplorer.tsx` ~line 687) is guarded by `!selectedDatabase`:

```ts
useEffect(() => {
  if (databases.length > 0 && !selectedDatabase) setDatabase(databases[0].name)
}, [databases, selectedDatabase, setDatabase])
```

With a stale-but-truthy `selectedDatabase` it does nothing — no re-select, no
refetch, no clear. Two knock-on effects: the db `<select>`'s value is no longer
in `databases`, so the picker renders no matching option (looks like it
"disappeared"); and `<EmptyState>` is gated on `activities.length === 0`
(`DatabaseExplorer.tsx` ~line 937), so a stale NON-empty `activities` means the
empty state — **and the "Load demo project" button inside it** — can never
render even though `databases.length === 0` is correct.

*Cause B — the demo button (says "No databases" when there are two).*
`DemoLoadButton` calls `useProjectStore.fetchProjects`, and **`fetchProjects`
sets only `{projects, currentProject}` — it never calls `getDatabases()`.**
Only `refreshProjectsAndDatabases` (used by `switchProject` / `createProject`)
refreshes both. So after the demo builds and switches, `databases` is still the
previous project's `[]` → `hasDatabases === false` → "No databases in this
project yet", while the backend already has `biosphere3` +
`demo-synthetic-technosphere`.

**The fix.**

*A* — `useActivityStore` gained the standard project-change reset. **Every
project-scoped store ends with the same block** (`bomStore`, `dsmStore`,
`aesaStore`, `impactStore`, `plcaStore`, `parameterStore`, `subsystemStore`
already had it; `activityStore` was the ONLY one missing it):

```ts
let _lastProject: string | null = useProjectStore.getState().currentProject
useProjectStore.subscribe((state) => {
  if (state.currentProject === _lastProject) return
  _lastProject = state.currentProject
  useXStore.getState().reset()
})
```

It resets ONLY — the explorer's own effect re-selects `databases[0]` once
`selectedDatabase` is null, so selection logic stays in one place. **When you
add a new project-scoped store, add this block.**

*B* — new `projectStore.resyncAfterProjectChange()` (project list + databases,
refreshed atomically). `DemoLoadButton` and App's project-guard 409 handler now
call it instead of `fetchProjects`.

**Do NOT make `fetchProjects` fetch databases.** It is the cold-boot mount
fetch with a deliberately tuned ~22.5 s retry budget; awaiting a second request
inside it changes its timing contract and took down all 4 `projectColdBoot`
tests (which drive it under fake timers). That was tried and reverted — use
`resyncAfterProjectChange` from callers that know the project changed.
`tests/databaseExplorerProjectSwitch.test.tsx` B3 guards this.

**Two more stores lacked it until 0.3.0's second walk-through:**
`singleProductImpactStore` and `multiProductLCAStore` — both keyed by archetype
ids that belong to one project. And the store reset is not enough on its own
when the id ALSO lives in component state: `SingleProductImpact` held the
selected archetype in `useState` inside an always-mounted subtree, so after a
switch the previous project's id stayed selected. The dropdown read "Pick an
archetype" (the id is not in the new list), Calculate stayed enabled, the run
404'd on the stale id, and the panel's error banner — cleared only by the next
Calculate — then sat under a freshly picked BEV-NCA, which is how it was
reported. `SingleProductImpact` is now a wrapper keyed by `currentProject`, so
its subtree remounts on a switch. **A project change is not a hide**: keying by
project does not break the visibility-toggle rule, which is about tabs and
collapses. `tests/singleProductProjectSwitch.test.tsx` drives the real panel
through a switch and a Prospective run; reverting the key alone fails 2 of 4,
the store resets the other 2.

**Publish the project and its databases in ONE `set()`.** The first attempt set
`currentProject` then `databases` separately; the intermediate render held the
NEW project with the OLD database list, and the explorer's initialise effect
ran in that window and re-selected a database from the old project — undoing
the reset. `refreshProjectsAndDatabases` is now atomic.

**Why the existing tests didn't catch it:** `projectSwitcherRefetch.test.tsx`
and `projectColdBoot.test.ts` are both green and both are about **`fetchProjects`
resilience only** — cold-boot retry, not clobbering on persistent failure, and
re-fetching the PROJECT LIST when the dropdown opens. Neither asserts anything
downstream of a project *change*, and neither renders `DatabaseExplorer`. The
area looks covered and isn't.

**The regression test must switch project on an ALREADY-MOUNTED explorer** — a
mount-time-only test passes against the bug. `tests/databaseExplorerProjectSwitch.test.tsx`
renders `<DatabaseExplorer>`, then switches in BOTH directions (has-dbs →
no-dbs, and no-dbs → has-dbs via the demo path) without unmounting, asserting
the picker AND the activity table follow. Both halves were verified
load-bearing by disabling each fix in turn and watching the suite go red.

**Seeding order gotcha for other tests:** set `useProjectStore.currentProject`
BEFORE seeding `useActivityStore`, or the reset subscription wipes the seeded
activities (this is why `multiProductActivityVintage.test.tsx` reorders its
`beforeEach`). Same hazard already applied to `bomStore`.

### Replace = Merge + delete what's absent. Nothing else.

Both import modes match by NAME and preserve the archetype id. The ONLY
difference is that replace deletes archetypes absent from the workbook.

It did not used to be. Replace re-minted every id — not as a feature, but
because it cleared the dict BEFORE building the name index, having captured the
old library two lines earlier and used it solely to delete files. The
name→id map was in hand and thrown away.

**An archetype id is referenced from exactly THREE places**, and re-minting
orphaned all of them:

| surface | repair path |
|---|---|
| `CohortMapping.mappings[].archetype_id` | rebuildable by hand in the UI |
| `Subsystem.cohort_mappings[].archetype_id` | re-import repairs it |
| `Archetype.includes[].archetype_id` | **none** |

`DependencyRule.dependent_archetype_id` looks like a fourth and is not — it
holds a dependent COHORT KEY (`"Fuel Station|Large"`). Measured on the live
project: 0 of its 6 values resolve as BOM archetype ids, all 21
`SubsystemCohortMapping.archetype_id` do.

This orphaned WP5's 51-row cohort mapping **twice**. Warning people to use
merge mode had failed twice, which is the evidence it belonged in the importer.

**Composition was broken a second way, and by BOTH modes**: `_upsert` never
carried `includes` at all, so even a preserved id came back with an empty list.
The BOM workbook cannot express a composition reference — `_assert_exportable`
REFUSES to write a composed archetype — so a blank `includes` on import means
"not expressible here", never "the user removed it".

**Ids are stable PER SURVIVING NAME, never across the set.** A name new to the
workbook has no id to preserve and gets a fresh one. Nothing may assume the id
SET is unchanged.

**Preserving an id re-opens a staleness window that re-minting had accidentally
closed.** `_contribution_cache` is keyed by `("archetype", archetype_id, …)`
and is never cleared anywhere; while ids changed, a stale entry was unreachable
because its key changed. Now the id survives and the BOM does not, so the
import evicts entries for every touched archetype — in BOTH modes, since merge
always preserved ids and so was always exposed.

**A rename is warned about, never refused.** An archetype whose name is absent
is deleted; that is the mode's job and rename-and-replace is legitimate. But it
is the one case an id cannot survive, so the import names the archetype and
every place that pointed at it. Unreferenced deletions stay silent — warning on
those trains people to ignore the warning that matters.

#### What NOT to do

- **Don't restore the mode-conditional name match.** Locked by
  `test_import_preserves_archetype_ids.py` (all three surfaces, both modes) and
  a source guard in `test_archetype_composition.py`.
- **Don't drop a field in `_upsert` because the workbook lacks a column for
  it.** `includes` has no column BY DESIGN. `validation_report` is the only
  field legitimately not carried, because it is recomputed after import.
- **Don't describe Replace as "re-creates everything" in UI copy.** It updates
  matched archetypes in place and deletes the rest. Two modes whose difference
  nobody can state is how the wrong one gets picked.
- **Don't refuse on a rename.** Warn, naming the orphaned references.

### The fifth was an ABSENCE, not a gate

The four above were all gates: a call to `resolve_archetype_with_engine`
wrapped in a condition. The fifth had no call at all.

`_build_archetype_demand` (contribution analysis, `api/lca.py`) held its OWN
copy of the flatten loop and never resolved. Same defect, sibling builder,
invisible to a sweep that asks "is this call conditioned?" — you cannot gate a
call that does not exist. On WP5's ICEV-Petrol it reported **61.51 kg CO2-eq
against a true 3,195.16**, and because only the EXPRESSION rows collapsed to
their 1.0 placeholder while the literal maintenance rows kept full size, it did
not merely scale the total — **it inverted the ranking**. Synthetic rubber (13 kg
of tyres, a literal) showed as **70%** of the use phase; it is 1.4%. Petrol
combustion showed as **5.2%**; it is **73.3%**.

The sweep found two more of the same shape once it was looking for absence:
`api/bom.py:standalone_lca` (computes an LCA; **no frontend caller**, so nothing
hand-tested it) and `api/bom.py:flatten_archetype` (reports `total_mass_kg`,
which was 1 kg of petrol on a parameterised BOM).

**The fix is one shared implementation, not a fifth copy.** `api/lca.py` now
carries two helpers that every demand builder goes through:

- `_load_and_splice_archetype(id)` — load + composition splice.
- `_resolve_archetype_parameters(arc, scenario, year)` — validate the scenario
  name and resolve every expression.

They are split in two rather than fused so `_build_archetype_source_demand`'s
HTTPException ORDER is preserved byte-for-byte (it validates methods and scope
between loading and resolving). `ContributionAnalysisRequest` and
`ArchetypeLCARequest` gained `parameter_scenario`, and for contribution analysis
**the scenario is part of the cache key** — it changes the resolved quantities,
so omitting it would serve one scenario's result for another.

**The guard now asserts presence, enumerated.**
`test_parameter_resolution_never_gated.py` gained an absence rule beside the
gate rule: it discovers every function that **loads an archetype by id AND
flattens it**, requires each to be listed in `DEMAND_BUILDERS`, and requires
each listed one to reach a resolver. Load-then-flatten is the criterion because
it is the real distinction — a function that loads owns the raw tree and is the
only place that can resolve it, while one that RECEIVES an `Archetype` is
downstream of whoever did. That is why `dsm_lca_engine._flatten` and
`material_flow_engine._compute_single_scope` are correctly NOT on the list:
their callers resolve first.

Verified load-bearing by removing the resolve call from each builder in turn —
each removal fails naming that function.

#### What NOT to do

- **Don't write a third copy of the resolution logic.** A second copy is how
  this survived four fixes; call `_resolve_archetype_parameters`.
- **Don't add a demand builder without adding it to `DEMAND_BUILDERS`.** The
  discovery test fails on an undeclared load-then-flatten function, and a
  companion test fails on a stale entry that no longer matches — a stale entry
  passes vacuously, which is as bad as a missing one.
- **Don't extend the GATE sweep and think it covers absence.** "Is this call
  conditioned?" cannot fire when there is no call. The two rules are
  complements; both are needed.
- **Don't omit the parameter scenario from a result's cache key.** Two
  scenarios resolve the same BOM to different quantities. On MAp-test they
  happen to coincide (both cases carry zero overrides across 43 parameters),
  which is exactly the kind of coincidence that hides a key bug.

### The class, and the guard that closes it

The same false premise shipped **four** times:

| # | site | gate | live? |
|---|---|---|---|
| 1 | `api/lca.py` single-product | `parameter_scenario is not None or table.has_time_varying()` | yes — 727× on WP5 use phase, ~1600× on Battery Circularity totals |
| 2 | `api/bom.py` `material_flows` | `is not None and != "Base"` | yes — reported the **vehicle count as kilograms** |
| 3 | `api/bom.py` dsm-lca | `param_table` assigned only inside `if body.parameter_set_id:` | latent |
| 4 | `api/impact.py` | same | latent |

3 and 4 are a **data-flow** gate, not a syntactic one: `DSMLCAPipeline`
resolves iff it is handed a table, so a falsy `parameter_set_id` left
`parameter_table=None` and silently disabled resolution for a whole
system-level run. They were latent only because every UI path sends `"Base"`
(truthy) and `/impact/calculate-scenarios` defaults to `"Base"`.

`tests/test_parameter_resolution_never_gated.py` closes the class. It is
AST-based, not textual — it finds every call to `resolve_archetype_with_engine`
and walks the enclosing `if` statements, because all four gates lived in
*enclosing scope* where a line-oriented grep cannot see them. A separate rule
covers the data-flow shape (3 and 4) by asserting `param_table` is never
assigned inside a `parameter_set_id` branch. `ALLOWED` is empty on purpose;
an entry must say why a gate is correct, not merely that it exists.

Anti-vacuity: `test_the_guard_catches_each_historical_gate` replays all four
shapes through the same analyser and requires each to be flagged, and
`test_the_guard_accepts_the_corrected_shape` pins that *validating* a scenario
name is not the same as *gating* on it. The one conditional that legitimately
wraps a resolve call — `DSMLCAPipeline`'s year-varying branch, which chooses
resolve-once vs resolve-per-year — is pinned unflagged by its own test.

## Truncated lists must be reachable

A list that shows the first N and closes with a plain `…and M more` caption
strands M items with no way to see them. The import panel
(`pages/LCAManager.tsx`) did this twice — warnings at 10, archetypes at 8 — and
`ValidationReportPanel` carried a third copy that was unreachable **code**: its
`…and N more` sat inside a `{open && …}` branch and was itself guarded by
`{!open && …}`, so it could never render.

**Expand in place on click** is the convention, matching the two in-app
precedents: `ValidationReportPanel`'s `GroupRow` (chevron header, expands to the
full affected-row list) and `SimulationWarningsPanel` (collapse with a persistent
count). Not "scroll the panel with everything present" — that keeps 14
repetitive lines pushing the actual content off screen.

**The truncation was frontend-only.** Nothing in `bom.py` caps the warnings
list, so the displayed count was accurate and expanding the UI genuinely reaches
more data. Check which side truncates before designing the fix: if the backend
capped it, an expand control would be a lie.

### Splitting informational warnings from real ones

Import warnings are a flat `string[]` with no severity field — the same shape
problem as the DSM simulation warnings. A parameterised BOM emits one
`Quantity '…' stored as expression; resolved at pipeline time.` per row, so a
dozen benign lines bury `parent '…' not found; attached to stage root instead`.

`isInformationalImportWarning` (exported from `LCAManager.tsx`) matches on the
**emitted suffix** of that one format string, not the whole sentence: the row
number varies and the expression is user data. Real warnings render always;
informational ones collapse behind a count that expands. That keeps the
`SimulationWarningsPanel` rule ("don't default a warnings panel to collapsed —
warnings signal data problems") intact, because nothing that signals a problem
is hidden.

The durable fix remains a structured `{severity, message}` shape from the
backend; when that lands, read the field instead of pattern-matching.

#### What NOT to do

- **Don't ship a `…and N more` caption that is not a control.** Either make it
  clickable or don't truncate.
- **Don't classify by position (`warnings[0]`) or by matching a whole
  sentence.** Reordering breaks the first; rephrasing breaks the second. Match
  the stable part of the format string.
- **Don't treat an unrecognised warning as informational.** Anything that does
  not match is surfaced by default — a warning type added later must not be
  silently collapsed out of sight.
- **Don't collapse the real warnings too** to make the panel shorter. The
  reason the informational class can be collapsed is precisely that the real
  ones stay visible.

## Chart expand pattern — `<ChartExpandModal>` (Patch 4AL)

Grid-of-charts views (Impact Assessment by-cohort, future AESA
Radar / Material Flows / etc. adopters) render small chart facets
at overview size. Patch 4AL adds an **expand-to-detail-view**
affordance: each facet renders a small `Maximize2` icon in its
top-right corner; clicking it opens a portaled modal with the
chart at full size for detailed inspection.

**Component**: `<ChartExpandModal>` in
`src/components/ui/ChartExpandModal.tsx`. Pure composition —
takes `isOpen`, `onClose`, `title`, optional `actions` slot
(for export / format / auto-fit toggles), and `children` (the
chart itself). Portals to `document.body` per the Patch 4X
stacking-context discipline. Backdrop click + Escape + close
button all dismiss.

**First consumer**: `<MultiScenarioImpactChart>`'s
`<FacetedView>` for Impact Assessment "Impact over time, by
cohort (per scenario)". The SVG-based facet grid is wrapped in
an absolutely-positioned HTML overlay layer that renders one
expand button per facet, positioned via the same grid math
(col/row → percent of container) so the buttons follow the SVG's
responsive scaling.

**Y-axis behavior**:
- **Default**: same Y-axis range as the grid (`yMax` from the
  shared scenarios max). Preserves cross-scenario visual
  comparison — a user mentally calibrated to the grid carries
  that calibration into the expanded view.
- **Auto-fit toggle** (modal header `actions` slot): when on,
  recomputes `yMax` from JUST that scenario's data, revealing
  more detail within that scenario but breaking
  cross-scenario comparability. Default off.

**Pattern reuse**: future grid views (AESA Radar, Material
Flows, single-product LCA stage breakdown, etc.) should adopt
`<ChartExpandModal>` rather than re-implementing the chrome.
The modal owns no chart logic — only the chrome, portaling,
dismissal handlers, and slot for actions. The parent grid owns:
(a) which facet is expanded, (b) how to re-render the chart at
full size, (c) what auto-fit / format / export options to
expose in the actions slot.

**Patch 4AL+ — full single-scenario affordances inside the
modal.** Patch 4AL shipped the modal with auto-fit-Y-axis
toggle only; the expanded chart was the same hand-drawn
`<Facet>` SVG rendered at larger size, which deliberately
omitted tooltip / legend / export. Patch 4AL+ replaced the
modal body with `<ExpandedCohortChart>` —  a Recharts-based
component that mirrors the canonical single-scenario by-cohort
view (`ProjectedImpactPanel.tsx`) exactly:

- **Export button** via the existing `<ChartExportButton>` (Patch
  4K legend extraction pipeline). Mounts inside the chart's own
  header alongside the format control + auto-fit toggle, NOT in
  the modal's actions slot. Filename pattern
  `{filenameBase}_facet_{scenario_label}` keeps the scenario
  identifiable in the user's downloads folder.
- **Legend** below the chart, one entry per cohort key, swatch
  colors resolved via the SAME color path the chart fills use
  (the `colorForCohort` callback passed in). Patch 4AJ per-dim
  overrides → propagate to legend swatches because both read
  from `cohortColorMap` (which `useChartColors` populates with
  user overrides). Full cohort list — no top-N truncation; if
  the modal grows tall, the modal body scrolls.
- **Tooltip** via the shared `<StackedTotalTooltip>` (same
  component the single-scenario view uses) — hover shows per-
  cohort contributor values + Total row at the hovered year.

The auto-fit-Y-axis toggle moved from the modal's actions slot
into the chart's `extraHeader` slot, grouped with format +
export for coherent "chart-display controls" placement.

**Color resolution invariant**: chart fills, legend swatches,
and tooltip swatches MUST all read from the same source. In
`<ExpandedCohortChart>`, the parent passes a single
`colorForCohort(cohortKey, fallbackIdx) => string` callback;
the component uses it for Area `stroke`/`fill` AND legend
swatch `backgroundColor`. The Recharts Tooltip inherits Area
colors via dataKey, so swatch consistency follows. Any future
patch that adds a fourth color-rendering surface (legend
export pipeline, screenshot watermark, etc.) MUST route
through the same callback.

### What NOT to do

- **Don't make the entire chart area clickable to trigger
  expand.** Conflicts with hover tooltips, legend interactions,
  data-point hover, and any other chart-native gestures
  (selection brushes, zoom controls). Use an explicit expand
  icon affordance in the header / corner.
- **Don't change the Y-axis range in the expanded view by
  default.** Users carry their visual calibration from the
  grid; auto-fitting breaks cross-scenario comparability and
  invites misreading ("scenario A is twice scenario B" when
  they're not — the auto-fit just rescaled). If detail-view
  auto-fit is needed, expose it as an explicit user toggle in
  the modal's actions slot.
- **Don't duplicate `<ChartExpandModal>` logic per grid
  context.** The chrome (portal, backdrop, Esc handler, close
  button, title bar, actions slot) is identical across grids.
  Extract once, reuse. Future grid-of-charts views should
  consume the shared component; copying it creates drift the
  first time someone updates one copy but not the other.
- **Don't skip portaling for expand modals.** Per the Patch 4X
  precedent: stacking contexts from `position: sticky`
  (AESA sidebar), `transform`, etc., trap z-index. Even
  `z-index: 9999` can't escape its parent stacking context.
  Always portal to `document.body`.
- **Don't co-locate the expand button with the SVG's title
  text.** The button needs to be HTML (for icon rendering,
  accessibility tooltip, click handler ergonomics). Wrap the
  SVG-based grid in a relatively-positioned container and
  render an absolutely-positioned HTML overlay with the
  buttons, positioned via percent-of-container so the overlay
  follows the SVG's responsive scaling. Putting the button as
  an SVG `<g>` element with a click handler works but requires
  reimplementing icon rendering, accessible labels, and
  hover-state styling that lucide-react + CSS give you for free.
- **Don't conditionally mount the modal's children when isOpen
  toggles.** Render the chart fresh each time the modal opens —
  the modal subtree is short-lived and chart-local state
  (hover, format setting in the actions slot) is expected to
  reset on each open. This is opposite to the visibility-toggle
  pattern for long-lived tab panels (where conditional mount
  kills `useState` you want preserved); short-lived modals are
  the right place for conditional mount.
- **Don't add expand to charts that aren't part of a grid.** A
  single-chart view at full panel width already IS the
  detailed view — there's nothing to expand to. The pattern
  exists to scale from grid-overview to single-chart-detail;
  applying it to charts that are already detail-sized adds a
  redundant control that does nothing useful.
- **Don't invent new chart affordance patterns inside the expand
  modal.** When the same chart type already exists as a
  single-scenario view elsewhere in the app (Impact Assessment's
  by-cohort single-scenario chart is the canonical source), the
  expanded modal MUST mirror it: same export button via
  `<ChartExportButton>`, same tooltip component
  (`<StackedTotalTooltip>` for stacked-area), same legend layout,
  same color resolution path. Don't reach for a new tooltip
  shape, a custom legend layout, or a parallel export
  implementation — users carry their mental model from the
  single-scenario view into the modal and any divergence reads
  as inconsistency.
- **Don't reach for a parallel color resolution path inside the
  expand modal.** All chart-rendering surfaces (Area fills,
  legend swatches, tooltip swatches) must read from the SAME
  `colorForCohort` callback that the grid uses, so per-dim
  (Patch 4AJ) and per-row (Patch 4AK) overrides propagate
  uniformly. The 4AL+ invariant test
  (`chartExpandModalAffordances.test.tsx::legend swatches use
  the same colors as the chart cohortColorMap`) locks this in —
  if a future patch routes legend colors through a different
  lookup, the test breaks.
- **Don't bolt the expanded chart's affordances into the
  existing `<Facet>` SVG via conditional props.** Patch 4AL+
  considered adding `expanded?: boolean` to toggle legend +
  tooltip + export rendering inside `<Facet>`, but `<Facet>`
  is hand-drawn SVG (paths + ticks) while the affordances need
  Recharts (Tooltip hit-detection, ResponsiveContainer). Two
  rendering models in one component splits maintenance
  attention. Use a separate component
  (`<ExpandedCohortChart>`) for the expanded path; the grid's
  `<Facet>` stays minimal for overview density.

## Biosphere-flow compartment picker (step 3a of authored databases)

Biosphere flows that share a name differ only by compartment (biosphere3 has
562 names shared by more than one flow; Nitrogen oxides has five), and the
compartment can change a characterisation factor while leaving the others
identical. So choosing a flow by name is a guess. The picker shows what a
method family does with each compartment.

- **Backend:** `GET /api/biosphere-flows/search?q=&database=&family=&limit=`
  (`mapper/api/biosphere_flows.py`; separate prefix because
  `/authored-databases/{name}` would capture `/flows`). Pure search in
  `mapper/core/flow_characterisation.py::search_groups`. The flow → (method,
  factor) index over ALL installed methods builds in 0.23 s and is rebuilt
  when the installed method set changes (fingerprint: each method's CF count
  and registration id).
- **Per compartment:** full path, flow type, factors for the selected family,
  "characterised by X of Y", ecoinvent usage count, and whether a GSD² floor
  applies (from the same single statistics pass as authoring).
- **Per substance:** `varying_methods` (a factor present for one compartment
  and absent for another counts as differing) and `uniform_methods`.
- **Family:** EF v3.1 by default, else the alphabetically first installed
  family — the Impact Assessment picker's fallback — with a switcher.
- **Frontend:** `<BiosphereFlowPicker>` (`components/authored/`), mounted in
  the Database Explorer as "Browse by substance" for biosphere databases (list
  view hidden, not unmounted). Choosing a compartment opens its detail.

**Measured on MAp-test (EF v3.1):** for NOx only particulate-matter formation
differs (1.6e-6 urban / ground-level / unspecified vs 2.1e-7 high stacks /
stratosphere); acidification, marine and terrestrial eutrophication and
photochemical ozone are uniform. Coverage does NOT differ under EF v3.1 (every
compartment 5 of 25). It differs under the **"no LT" variants**, which exclude
long-term emissions by design: under "EF v3.1 no LT" the long-term NOx
compartment is characterised by 0 indicators; 14 of 46 installed families show
some compartment coverage gap for NOx. The family switcher is what surfaces
this.

#### What NOT to do

- **Don't sort candidates by ecoinvent usage, or preselect one.** A first row
  or a big number reads as a recommendation. Candidates are alphabetical by
  compartment, the UI says the order means nothing, and the usage column is
  labelled as information. Each rule has a test that fails if it is broken.
- **Don't show factors from families other than the selected one.**
- **Don't treat a missing factor as "same".** Absent in one compartment and
  present in another is exactly the difference that silently zeroes an
  indicator.
- **Don't let the coverage check fall silent.** Each expanded substance shows
  either a warning on the compartment with fewer indicators, or the line "No
  coverage gap: every compartment is characterised by the same N of M <family>
  indicators." At the default family (EF v3.1) NOx has no gap, so without the
  positive line the check would be invisible exactly where most users sit, and
  silence reads as "not checked" rather than "nothing to report".

## Authoring UI (step 3b of authored databases)

Mounted in the **Database Explorer**, not a new tab: "New authored database"
beside Import; an **Authored** section in the database dropdown; for a
selected authored database a bar with its activity count, **Add activity**,
**Delete database**, and (when the Brightway copy is `pending` / `failed`) a
**Rebuild** button calling `/reconcile`; **Edit / Delete** on an authored
activity's detail panel (`ActivityDetailPanel` gained an optional `actions`
slot). Components live in `components/authored/`
(`AuthoredActivityEditor`, `AuthoredDatabaseControls`).

### The editor restates NO rule. It shows the preview's verdict.

`POST /api/authored-databases/preview-exchange` runs **`resolve_exchange`**, the
same function saving reaches through `build_activity`, and writes nothing. The
editor previews each exchange (debounced, ticketed so a late reply for an older
version of the row is dropped, and cleared on every edit) and renders what it is
told: GSD², floored / below-floor / **Unfloored**, and the problems on refusal.

**Agreement is tested, not assumed.** `tests/test_authored_preview.py` sends 16
inputs to BOTH endpoints and requires the same verdict, the same problem list,
the same codes, and the stored exchange equal to the previewed one. A table
only covers the inputs it lists, so two AST guards cover the rest: the
`build_activity` exchange loop may contain **only** `try: resolve_exchange(...)`,
and the preview route must call `resolve_exchange`. Break-checked: a
save-only rule, "preview supplies the floor reason", and "report only the first
problem" are each caught.

**Refusals carry machine-readable `codes`, parallel to `problems`**
(`negative_amount`, `below_floor`, `bv_required`, `unknown_flow`, ...). The UI
keys on the code, never on message text -- the floor-reason box appears because
the preview returned `below_floor`. A new refusal must get its own code; the
agreement test fails on the generic `invalid`.

### The shared pedigree editor, opt-in props

`PedigreeEditor` serves Monte Carlo scoring AND authoring. Authoring's needs are
props that default to the old behaviour, so Monte Carlo is unchanged:

- `requireAll` -- a score of 1 must be CHOSEN, not defaulted: no Clear, unset
  indicators read "not scored yet" and are listed. An authored exchange is
  refused unless all five are recorded.
- `basicVarianceMode` -- `derived` (ecoinvent's median, read-only; decided by
  `derived_basic_variance()`, the same helper the engine uses, served on the
  picker candidate as `basic_variance`) or `required` (empty until the user
  types one; a reason box sits beside it). `editable` is the Monte Carlo mode.
- `basicVarianceNote` -- where the value comes from.

### Scope has no default

Complete / Partial is a required choice; neither radio is pre-selected, and
Partial requires a note saying what was left out. A pre-selected "complete"
would let an inventory of CO₂ alone pass as a whole inventory.

### Verified live, not assumed: a BOM row can link an authored activity

In a throwaway Brightway project (`BRIGHTWAY2_DIR` and every storage root
pointed at a scratch dir, deleted afterwards): the activity's code is 32 chars
(`uuid4().hex`, what the validator's length check expects); `GET /databases`
lists the database unfiltered and `GET /activities/{db}?search=` finds the
activity -- the two calls `EcoinventLinker` makes; `validate_bom` accepts the
link with no issues; and `POST /lca/calculate-archetype` through it returned
**6.0 = 3 MJ × 2 kg CO₂/MJ × CF 1** exactly. The `biosphere` substring the four
link refusals filter on is already refused in authored database names.

#### What NOT to do

- **Don't add an exchange rule anywhere but `resolve_exchange`.** The AST guard
  fails; more to the point, preview would then approve what save refuses.
- **Don't branch the UI on problem text.** Key on `codes`.
  The text is for a person: it says "give a reason", never a request field name
  like `floor_reason`. Changing the wording must never change a code; a test
  pins both (`test_the_below_floor_message_speaks_to_a_person_not_a_field`).
- **Don't default the scope, a pedigree score, or the basic variance.** Each is
  a statement about the data the user has to make.
- **Don't use `window.confirm` for the deletes.** It is a no-op in WKWebView;
  both deletes confirm with a second in-place button, and a refusal lists the
  BOM rows (`detail.links`) that would dangle.
- **Don't remove `pythonpath = ["."]` from `mapper-backend/pyproject.toml`.**
  The backend is not pip-installed; without that line bare `pytest` fails to
  import `mapper` in every file (127 collection errors), which reads as a
  broken branch, and only `python -m pytest` works. Guarded by
  `tests/test_bare_pytest_collects.py`, which runs pytest from a directory
  outside the backend.

## A string body is JSON, and `fetch` will not say so

`fetch` sets no `Content-Type` for a string body. Starlette then never parses
it, and FastAPI reports **422 `model_attributes_type`** — "Input should be a
valid dictionary or object to extract fields from" — with the JSON quoted back
in `input` **as a string**. That error names the schema, so it reads as a model
bug; the body never reached the model.

Found walking 0.3.0 by hand: the entire authoring UI was dead — in `npm run
dev` exactly as in the packaged app, since `fetch` omits the header in both.
Five calls in `api/client.ts` (`createAuthoredDatabase`,
`addAuthoredActivity`, `updateAuthoredActivity`, `fetchReachedIndicators`,
`previewAuthoredExchange`) sent `JSON.stringify(...)` bare. They were a
contiguous block added together, which is how five arrived at once and why the
guard discovers sites rather than listing them.

The header is set in `_withProjectHeader` — the one place this client builds
headers, used by `request()` and by the direct `fetch` calls — for any string
body with no Content-Type of its own.

- **Don't set it at the call site.** 54 `fetch` calls, ~120 bodies; the audit
  found exactly five missing it, and the next one added will miss it too.
- **Don't widen it past strings.** A `FormData` body must stay unlabelled so
  the browser can set the multipart boundary. `typeof body === 'string'` is the
  whole condition.
- **Don't test it with `TestClient(json=...)`.** That helper sets the header
  for you, so the test passes while the app is unusable from a browser. The
  backend half (`tests/test_json_body_needs_content_type.py`) posts raw bytes
  with no header and pins the 422 as the observable symptom, for all five
  routes.
- **Don't mock `request()` to test it.** The frontend half drives the real
  exported functions through the real `request()` with a spy on `fetch`;
  mocking the thing under test asserts nothing.

## Every node gets an id ON LOAD, not only on create

`assign_ids_to_roots` runs on the create and import routes, but an archetype can
reach disk without passing either: the demo builder constructs its two and calls
`dsm_storage.save_archetype` directly. Those stage roots had `id: None`, and
`ArchetypeSummary.stage_ids` is `dict[str, str]` — so `GET /bom/archetypes`
returned **500 for the whole project**, not just for that archetype. Shipped in
0.2.x and 0.3.0: the demo project every install gets could not open its
Archetypes page. Found while verifying the 0.3.0 @ `99df3fa` build; of 73
archetypes on the author's machine, the 4 affected were the demo's two and their
`.bak` copies — every hand-built project was clean.

`dsm_storage._backfill_root_ids` fills them in `_load_project`, which both
loaders funnel through, so **every project already on disk is repaired** rather
than only the one seeded today.

- **Persisted, not only held in memory.** A regenerated id differs between
  restarts, and the UI PUTs a stage basis BY that id. Written once; later loads
  find the ids present and change nothing.
- **The check walks the whole tree**, not just the roots: `assign_ids_to_roots`
  fills children too, and an id assigned but never written is a new id next
  time. `test_a_child_only_gap_is_persisted_too` is the one that catches this —
  a fixture missing ids everywhere passes either way.
- **A failed write must not break loading.** Read-only or full disk leaves the
  in-memory ids in place and is otherwise ignored.
- The demo builder now assigns ids itself, so a demo built today does not rely
  on the repair. **Don't treat that as the fix** — it only stops new bad data.

Tests: `tests/test_root_ids_backfilled_on_load.py` (7).
