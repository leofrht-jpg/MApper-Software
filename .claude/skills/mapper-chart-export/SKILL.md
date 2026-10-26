---
name: mapper-chart-export
description: "Chart export (SVG/PNG/PDF), legend extraction and chart reference-line rules for MApper charts. Use when changing chart export, legends or chart axis/label layout."
---

## Chart export discipline

Every chart in the frontend must use `<ChartExportButton>` from
`components/charts/ChartExportButton.tsx` (paired with `<ChartExportContainer>`
as the capture target). When adding a new visualization panel, audit chart
coverage as part of the patch — don't ship a new chart without export.

Conventions: button placed top-right of the chart container; the `filename`
PROP is lowercase `<topic>_<context>` snake_case and carries no prefix of its
own (e.g. `multiyear_evolution_<target>_<method>_<years>`,
`dsm_survival_default_k<k>_lambda<λ>`,
`timeline_<archetype>_<yearStart>-<yearEnd>`). Match existing siblings in the
same panel before inventing a new naming scheme.

`buildFilename` then adds the `mapper_` prefix, a mode suffix and, for raster
formats, the scale — so the file on disk is
`mapper_<prop>[_chart|_legend][@Nx].<ext>` (and `jpeg` writes `.jpg`). Don't
put `mapper_` in the prop; it would double.

Every chart with numeric axes uses `<NumberFormatControl>` for live display
formatting, placed in the same flex row as `<ChartExportButton>` (button row,
top-right of the chart container). Format settings are display-only — they do
not affect data exports or stored values. State is scoped per chart (or per
panel-pair when summary + detail share a unit) via `useNumberFormatter()`;
formatters are not synced across panels and not persisted to localStorage.
The default `{ notation: 'scientific', sigFigs: 3 }` preserves pre-existing
rendering. Wire the formatter into Y-axis tick labels, Tooltip values,
headline displays, and table cells that sit with the chart.

**Exception — AESA**: `RadarView`, `TimelineView`, and the `CarbonBudgetInset`
restrict the picker to Fixed via `notations={['fixed']}`. SR values cluster
near 1.0 and Gt CO₂ remaining-budget values stay in tens-to-hundreds — neither
benefits from scientific or SI notation, and offering them invites confusion.
Default Fixed decimals: 3 (RadarView), 2 (TimelineView SR), 1 (carbon budget Gt).

**AESA Timeline SR reference-line labels live in the LEGEND, not the
chart plot area** (Patch 4AF, supersedes Patch 4AD). The dashed
boundary lines (`<ReferenceLine y={1.0} strokeDasharray="4 4">` and
`y={2.0}`) still render inside the chart, but their TEXT LABELS are
attached to the Recharts `<Legend>` as additional entries alongside
the indicator data series. Pre-Patch-4AF iterations tried
`insideTopRight` (collapsed at the right edge) and
`insideTopLeft` (collapsed at the bottom-left when Y-range expanded
to ~60 SR for filtered views) — both placements failed because the
two boundary lines fall near identical pixel rows whenever the
visible Y-range is large.

The methodologically-correct framing: SR=1.0 (Safe boundary) and
SR=2.0 (Uncertainty boundary) are **interpretation aids, not data**.
Data lives in the plot area; interpretation aids belong in the
legend (where the chart's meanings are documented). This decouples
label readability from Y-axis range — labels stay legible regardless
of how compressed or expanded the data is.

Implementation note: Recharts 3.x' default `<Legend>` filters
explicit-`payload` entries that don't correspond to a chart series
(only `<Line dataKey>` entries survive), so reference-line entries
added via the `payload` prop get silently dropped. Patch 4AF uses
the `content={(...) => <ul>...</ul>}` API for full custom render
control: the `<ul>` contains indicator entries (`<rect fill>`
swatches) AND the two reference-line entries (`<line stroke
strokeDasharray="4 4">` swatches matching the actual chart lines'
dash pattern). The export pipeline's Patch 4AE color-extraction
priorities pick up both shapes correctly (priority 1 reads `<rect>`
fill for indicators, priority 3 reads `<line>` stroke for reference
lines).

#### What NOT to do (reference-line labels in the chart plot area)

- **Don't place reference-line labels inside the chart plot area
  when the chart's Y-range can vary widely.** Compressed Y-ranges
  collapse multiple reference lines to nearly the same pixel,
  causing label overlap regardless of left/right/top/bottom
  positioning. Move reference markers to the legend, where
  horizontal space and the surrounding context make them
  unambiguous.
- **Don't try to fix label overlap by repositioning within the
  chart.** Patch 4AD tried `insideTopRight → insideTopLeft`;
  Patch 4AF retired the in-chart placement entirely. Any future
  "reference markers overlap" symptom on a Cartesian chart with
  multiple reference lines should reach for the legend, not
  another position keyword.
- **Don't pass reference-line entries via Recharts 3.x's
  `<Legend payload={[...]}>` prop and expect them to render
  alongside indicator entries.** Recharts 3.x filters payload
  entries that lack matching chart series. Use the
  `content={(...) => ...}` render API for full control when
  mixing series and reference markers.
- **Don't change the boundary thresholds** (1.0 / 2.0) — they're
  methodologically defined by the Sala 2020 framework (zone
  transitions Safe → Uncertainty → High-Risk). Only label
  position is a UI concern; values are not.

**SR-timeline reference lines + their legend swatches read from ONE shared
zone-colour source.** The SR=1.0 (safe) and SR=2.0 (uncertainty) `<ReferenceLine>`
strokes AND the legend swatch `<line>` strokes in `TimelineView.tsx` both read
`ZONE_COLOR.safe` (`#1D9E75`) / `ZONE_COLOR.zone_of_uncertainty` (`#EF9F27`) from
`components/aesa/zones.ts` — so they can't desync (lines must match their
swatches). Locked by `tests/aesaTimelineReferenceLineColor.test.ts` (source-level:
Recharts renders nothing in jsdom, so it pins the shared constant + both call
sites deriving from it, not a rendered pixel). **Give the reference lines an
explicit `strokeWidth`** (matching the swatch's `={2}`): Recharts 3.8's default
ReferenceLine `strokeWidth` is `1`, which rendered the (correctly-coloured) zone
line as a faint, near-invisible 1px dash on the dark theme while the 2px swatch
read clearly — the "swatch coloured, line invisible" mismatch was render *weight*,
not a colour-source desync or a black token. Don't hard-code a hex/black on these
lines (use `ZONE_COLOR`), and don't drop the explicit `strokeWidth`.

> **Export colour-retention (resolved).** The SR=1.0/2.0 lines are tagged
> `className="mapper-semantic-ref"`, and `darkenReferenceLines` (`chartExport.ts`)
> SKIPS any line whose `closest('.recharts-reference-line')` carries that class —
> so their `ZONE_COLOR` green/orange survives export (the 5AJ print re-theme would
> otherwise remap every reference line to `PRINT_REF` ink, which on a TRANSPARENT
> export read as muted grey-on-dark). All other reference lines (the year-detail
> cursor, etc.) still darken to ink exactly as before; `adaptInkForPrint` already
> ignores `ZONE_COLOR`, and the background-fill logic is unchanged. The carbon-budget
> `y=0` red floor is deliberately NOT tagged (it darkens as before — a separate
> call). Locked by `tests/aesaTimelineReferenceLineColor.test.ts` (pure-DOM:
> marked line retains `ZONE_COLOR`, plain line → `PRINT_REF`).

**Exception — DSM stock counts**: `DependentStockCharts` defaults to Fixed
because stocks are integer/near-integer (vehicles, units). Picker stays
unrestricted so users can switch to scientific for very large fleets.

**Integer unit-counts** (vehicle counts, system units) on labels adjacent to
formatted quantities should keep their existing `fmtInt`-style helper — those
aren't user-controlled values, just integer counts paired with the formatted
quantity (e.g. MaterialFlowPanel's `... + fmtInt(units) ${unitLabel}`).

**Raster resolution**: PNG and JPEG exports support 1× / 2× / 3× / 4× resolution
multipliers (≈96 / 192 / 288 / 384 DPI). 2× is the default for retina screen
viewing; 3× is recommended for academic publication (~300 DPI standard).
Filenames include an `@<scale>x` suffix for raster formats only (e.g.
`mapper_<chart>_<context>@3x.png`). SVG and PDF exports are
resolution-independent and don't expose this option. Selection persists for
the session via a module-level `sessionScale` in `ChartExportButton.tsx` —
not localStorage — so tweaks propagate across charts within a session but
reset to 2× on reload.

**Print palette (Patch 5AJ)**: chart EXPORTS render print-style — black ink
(text, axis lines, tick marks, tick labels, titles, legend text) on a **white**
background (`light`, the default), with gridlines/borders in light grey and
Recharts `<ReferenceLine>` annotations darkened to a print-readable stroke. Data
series colours (cohort / scenario fills) are **retained**; the **on-screen dark
theme is untouched** (the re-theme runs on the export *clone* only). The
re-theme also applies to `transparent` exports (black ink, page/slide colour
shows through) — only `dark` exports keep the dark ink. Implemented in
`chartExport.ts`: `adaptInkForPrint` (a pure string remap of the dark INK source
colours — `--text-*` / `--border-*` in their hex / `rgb(...)` / `var()` forms —
to black / grey; data palette hexes are absent from the source lists, so they
pass through) plus `darkenReferenceLines` (a DOM pass keyed on
`.recharts-reference-line-line`, because the module accent colours those lines
use — e.g. `--mod-plca` `#f59e0b` — collide with `CHART_PALETTE` and so can't be
remapped by colour). Default export bg is `light`; `BG_STORAGE_KEY` was bumped
to `.v2` so any stale persisted `dark` resets once. Locked by
`tests/chartExportPrintPalette.test.ts`.

> **Chart exports re-theme INK only (text/axes/grid/background → black-on-white); data series colours are never recoloured, and the on-screen dark theme is untouched.**

Known limitation (flagged, not fixed): the hand-drawn faceted by-cohort
view's year-detail *cursor* dashed line uses the module accent directly (no
Recharts class), so it stays accent-coloured rather than darkened in that one
export. It's readable on white; revisit only if it reads poorly.

**Menu structure (Patch 4L)**: two-tier visibility. Primary
affordances — Mode picker (when a legend is wired) and Format picker
— are always visible at the top of the popup. Secondary refinements —
Resolution and Background — are collapsed under a single **Advanced**
toggle that defaults to closed. The collapsed toggle shows a compact
summary (`2× · Light`) so users can confirm active settings without
expanding. Resets to collapsed on every menu open: per-action
behavior, no session persistence. The active values themselves still
persist (Resolution via `sessionScale`, Background via the
`mapper.chartExport.bg` localStorage key) — only the expansion state
resets.

#### What NOT to do

- **Don't expand Advanced by default "for discoverability."** The
  collapsed summary already shows the active values. Defaults
  (2× retina, Light) are reasonable for the overwhelming majority of
  exports; visual quietness on every menu open is more valuable than
  surfacing controls users rarely touch.
- **Don't persist Advanced expansion across menu opens** (e.g. via
  localStorage). The user opening the menu for a quick PNG shouldn't
  see a sprawling form because they expanded Advanced once an hour
  ago. Per-action collapsed-by-default is the contract.
- **Don't hide the format picker behind Advanced.** Format choice is
  the primary export decision — every export touches it. Hiding it
  would invert the affordance hierarchy.
- **Don't reach for `<CollapsibleCard>` for popup-menu collapses.**
  That component is for big content blocks (Configuration, Results,
  Stage Amounts) and brings border / shadow / h3-level title weight.
  In a popup the collapsible should be lighter — small chevron +
  uppercase label, no border. Different visual weight for different
  scale of UI element.

### Legend export (Patch 4I)

Charts that ship a separate legend block can pass either `legendRef`
(direct `RefObject<HTMLElement | null>` to a sibling node) or
`legendSelector` (CSS selector queried inside the chart container —
covers Recharts-internal legends like `.recharts-legend-wrapper` in
AESA TimelineView). When either is provided, the export menu adds a
**Mode** picker with three options:

- **Chart + Legend** — default. Stacks the chart SVG and the
  natively-rendered legend SVG vertically into one combined SVG,
  then runs through the same SVG-to-canvas/PDF/SVG pipeline.
  Filename has no suffix (matches the historical "no-suffix
  combined" convention so paper-figure references stay stable).
  **The legend is centered horizontally (Patch 5AF)**: in
  `buildCombinedSvg`, the legend's nested `<svg>` is placed at
  `centeredLegendX(totalWidth, legendWidth) = max(0, round((totalWidth −
  legendWidth)/2))` within the export's full width (= `max(chartWidth,
  legendWidth)`), instead of `x="0"` (left-aligned, the pre-5AF look).
  Clamped to ≥0 so it never pushes off the left margin. Layout only — the
  legend's items + the 5O visible-only set are unchanged.
- **Chart only** — runs `exportChart` with `mode='chart'`. Filename
  gets `_chart` suffix.
- **Legend only** — extracts `(color, label)` pairs from the live
  legend's DOM, then renders a fresh SVG document with `<rect>`
  swatches and `<text>` labels using a system-font stack. Filename
  gets `_legend` suffix.

Charts without a legend (or whose legend is part of the chart visual
itself, like `<StageBreakdownChart>`) MUST omit both props. The menu
then keeps its single-mode shape — no Mode picker rendered, no
filename suffix, no behavior change. Same module-level `sessionScale`
and `BG_STORAGE_KEY` apply across all three modes.

Currently in scope (have a separately-exportable legend):
`<ProjectedTimeSeriesChart>`, `<ComparisonReferenceLineChart>`,
`<MultiScenarioImpactChart>` (Total view only — faceted view's facets
self-label and the prop is conditionally omitted), `<TimelineView>`
(via `legendSelector`).

Out of scope: `<ComparisonDeltaChart>` (no legend block — its
trajectories share colors with the sibling refline chart's legend
above it), `<StageBreakdownChart>` (legend is a stage swatch row
inside the chart's own export container, captured by the chart
export already), `<RadarView>` (zone colors are self-labelled by
ring text, no category-by-color encoding to legend).

**Patch 4J extended the in-scope set** after a deeper audit of the
DSM Dashboard and the Patch-4I exclusions. Charts added:
`<BoxPlotView>` (custom HTML legend; Patch 4I missed this because it
grepped for Recharts `<Legend>` rather than custom HTML legend
blocks), `<MultiYearTrajectoryPanel>` evolution view (Recharts
`<Legend>`, `legendSelector`), `<TimelinePreviewModal>` (Recharts
`<Legend>`, `legendSelector`). Also: DSM Dashboard's three stacked
charts (Stock composition / Age distribution / Outflow split) had
**no legend rendered at all** — Patch 4J added the legend HTML blocks
+ wired the export affordance.

**Rendering strategy** (Patch 4K — replaces Patch 4I's
`<foreignObject>` approach): native SVG `<rect>` + `<text>` with a
system-font stack (`Helvetica, Arial, sans-serif`).

Patch 4I shipped a `<foreignObject>` wrapper around the cloned
legend HTML, with computed styles inlined. That tainted the canvas
in production: MApper loads Geist + Geist Mono from
`fonts.gstatic.com`, the inlined `font-family: Geist, ...` triggered
a cross-origin font fetch when the browser rasterised the SVG, and
`toBlob` then refused with **"Tainted canvases may not be exported."**
The DSM Dashboard's Stock Composition chart was the most visible
trigger but every legend export was affected.

The native-SVG path avoids the issue entirely:

- `extractLegendItems(legend)` walks the live legend's DOM. One
  row per top-level child (or per `<li>` inside Recharts'
  `ul.recharts-default-legend`). Swatch color = first descendant
  with non-transparent `backgroundColor` (falls back to `stroke` /
  `border-top-color` for SVG-line / dashed-line legend items).
  Label = `textContent`.
- `renderLegendSvg(items, maxWidth, bg)` lays out items into rows,
  wrapping at `maxWidth` (the live legend's bounding-box width so
  the export mirrors what the user sees). Text width measured via a
  2D-canvas `measureText` (no painting → no taint); falls back to
  ~6 px per char when canvas isn't available (jsdom). Outputs one
  `<rect>` + one `<text>` per item, system-font, foreground color
  matched to the chosen background mode.

Live legends in the codebase render with the page's CSS variables
(Geist font, theme-aware colors). The exported legend deliberately
diverges — the export uses generic system fonts so the rendered
image looks reasonable in any consuming surface (paper figure,
slide deck) without depending on Geist being available wherever the
file is pasted.

#### What NOT to do

- **The exported chart legend is centered horizontally within the export
  width (clamped to margins) and stays visible-only (5O) — centering is
  layout only; it must never change which series are exported.** The center
  offset is `centeredLegendX` in `buildCombinedSvg`; the exported series come
  from `extractLegendItems(legendRef)` upstream (visible entries only, hidden
  in a sibling). Don't fold visibility logic into the centering, and don't
  center by trimming/reordering items.
- **Don't reinvent legend extraction per chart.** Use the shared
  `legendRef` / `legendSelector` API on `<ChartExportButton>`. Per-
  chart extraction would diverge over time (style inlining, computed-
  size rounding, light-bg color swaps) and the next person to add a
  chart would inherit three different patterns to choose from.
- **Charts with multi-category visual encoding (stacked, colored,
  faceted) MUST render a legend AND must use shared color mappings
  when their categories overlap with other charts in the codebase.**
  Two related rules from the same observation: legends must exist,
  and colors must align across related charts.
  - The legend half (Patch 4I→4J): without a legend, colors map to
    nothing the user can see. Patch 4J uncovered three DSM Dashboard
    charts where the rule had been silently inverted ("no legend
    element → no Mode picker → ship as-is") — the stacked area /
    stacked bar / multi-source bar were uninterpretable before the
    legend was added. When the audit asks "does this chart visually
    render a separable legend block?", the answer should be driven
    by "does the chart have multi-category color encoding?", not by
    "does the file currently contain a `<Legend>` element?".
  - The colors half (Patch 4N): if two charts visualize overlapping
    dimensions, the same value MUST get the same color. DSM Stock
    Composition and Impact Assessment's "Impact over time, by
    cohort" both encode DSM cohorts; pre-Patch-4N they each built
    their own label set and ended up with different colors per
    cohort. Centralised via `useDSMSystemColors` in
    `src/utils/dsmCohortColors.ts` — the by-cohort chart now colors
    each cohort by its currently-selected DSM Stack-by dim value
    (e.g. `BEV-LFP|Small|2028` → fuel_type → `BEV-LFP` color),
    matching what the user sees in the DSM dashboard.
  - **Patch 5AG — the MULTI-scenario "By cohort" facets must also
    use the shared resolver.** The single-scenario cohort-stacked
    chart used `dsmColors.colorForCohort` (4N), but
    `MultiScenarioImpactChart`'s `cohortColorMap` prop was still being
    fed from generic `useChartColors(cohortStackKeys)` — so the
    per-scenario By-cohort facets fell back to a default palette and
    disagreed with the DSM charts + cohort mapping. Fixed by building
    `cohortColorMap` in `ProjectedImpactPanel` as
    `{ ck: dsmColors.colorForCohort(ck, i) }` (identity-keyed,
    two-layer base + override flows through). The facets read
    `cohortColorMap[ck]` and now match the DSM charts.
  - **By-cohort impact charts inherit colors from the shared cohort
    resolver (`useDSMSystemColors`), keyed by cohort identity — never
    a default/index palette; the same cohort must be the same color
    across DSM and impact charts, and overrides must flow through.**
    (The Total view's per-scenario LINE colors are a different axis —
    `SCENARIO_PALETTE` — and stay as-is.) Locked by
    `tests/byCohortImpactColors.test.tsx`.
  - **BOTH System-level "Impact over time, by cohort" charts — Static
    Background (`DSMImpactPanel`) and Prospective Background
    (`ProjectedImpactPanel`) — build `cohortColorMap` the SAME way:
    `{ ck: dsmColors.colorForCohort(ck, i) }` via `useDSMSystemColors`.
    They stack at the same level (cohort keys) and MUST share this one
    source so the same cohort/fuel keeps its color when the user
    switches tabs. `DSMImpactPanel` previously used an independent
    `useChartColors(cohortStackKeys)` path (algorithmic per-cohort),
    which flipped colors vs. Prospective's fuel colors — do not
    reintroduce a second color-assignment path. Locked by
    `tests/impactByCohortColorParity.test.tsx` (source-invariant +
    behavioral parity).
- **Don't define a local color palette for charts that share
  dimensions with other charts.** Cohort and archetype color mapping
  is centralised in `src/utils/dsmCohortColors.ts` (Patch 4N).
  Indicator color mapping for AESA Timeline lives in
  `src/utils/aesaIndicatorColors.ts` (Patch 4S). Every chart that
  visualises DSM cohorts or AESA indicators must import the shared
  helper — never re-implement per chart. Same principle generalises
  beyond DSM: when adding a chart whose categories overlap with an
  existing chart's, lift the mapping into a shared utility before
  shipping; re-implementing per chart guarantees future drift the
  next time someone adds a hue to one but forgets the other. The
  shared utilities are the single source of truth for their
  respective dimensions.
- **Don't use CSS variables (`var(--mod-aesa)` etc.) for chart
  series colors that flow through Recharts.** CSS-variable
  resolution on SVG presentation attributes inside Recharts'
  detached legend wrapper is browser-flaky — chart lines may
  render fine while legend swatches resolve as transparent or
  stroke-default. Patch 4S hit this on AESA Timeline: the local
  palette had `var(--mod-aesa)` as slot 0; lines rendered teal but
  the legend swatch at that slot was an invisible faint outline.
  Fix: use literal hex (`#34D399`) in palettes that feed Recharts.
  Reserve CSS variables for HTML element styling (page chrome,
  custom legend `<span>` swatches) where the cascade is reliable.
- **Don't trust Recharts' auto-derived legend payload.** Pass
  explicit `payload={[{value, type, color}, ...]}` to `<Legend>`
  with concrete colors per item. Auto-derivation depends on
  `<Line>` / `<Area>` / `<Bar>` sibling rendering order and `stroke`
  attribute resolution — easy to silently break. Explicit payload
  is the safe pattern. Pair with `iconType="square"` for filled
  swatches; the default `iconType="line"` renders a 1-2px stroke
  that's barely visible at legend size.
- **Don't ship Export Legend on charts without a legend ELEMENT.**
  After confirming the chart genuinely doesn't need one (single-line
  charts, single-color charts, zone-coloured charts where labels are
  on the axes / rings), omit `legendRef` / `legendSelector` so the
  Mode picker doesn't render. This still applies — the prior rule's
  intent stands, but the audit must distinguish "doesn't need a
  legend" from "needs one but doesn't have one."
- **Don't change the existing chart-only export's filename to add
  `_chart`.** That's reserved for explicit user picks of "Chart only"
  on charts that have a legend affordance. Backward compat: charts
  without a legend keep their unsuffixed filenames forever.
- **Don't use `<foreignObject>` for chart export.** Patch 4I tried
  this; Patch 4K reverted it. Browser canvas tainting is real and
  triggered by **any** cross-origin reference inside the foreignObject
  — most commonly external fonts (Geist via `fonts.gstatic.com` in
  this app), but also images, SVG icons, and CSS-variable URLs.
  Once the canvas is tainted, `toBlob` throws and PNG/JPEG/PDF all
  fail. SVG export sometimes survives because no rasterisation
  happens, but the failure mode is non-obvious and format-dependent.
  Render legends as native SVG (`<rect>` + `<text>`) with a
  system-font stack and the whole class of bugs disappears.
- **Don't reference external fonts in exported SVGs even if you
  think they're safe.** Today's same-origin `@font-face` is
  tomorrow's CDN-hosted variant; today's non-tainting font load is
  tomorrow's CORS-restricted one. The system-font stack
  (`Helvetica, Arial, sans-serif`) is the universal safe choice for
  exports — the rendered text might not look identical to the live
  app's Geist, but the file always opens cleanly and the reader can
  always read it. Live UI font and export font are deliberately
  decoupled.
- **Don't pull in `html-to-image` for the legend export.** The
  native-SVG renderer reuses the same SVG-to-canvas pipeline the
  chart export already uses. A new dep would re-introduce the same
  taint-vector class of bugs (it ultimately uses canvas
  rasterisation under the hood) plus add bundle weight for a
  rendering surface (flat legend rows) that's a poor fit for the
  library's general-purpose HTML-to-image goals.

**Legend swatch color extraction priority** (Patch 4AE):
`extractLegendItems` walks each row's descendants once and applies
four colour-source rules in order:

1. **SVG `fill` attribute** (`<path>`, `<rect>`, `<circle>`, etc.).
   Highest priority. Recharts `<Legend iconType="square">` emits the
   swatch icon as `<path stroke="none" fill={color}>` — fill is
   where the actual color lives.
2. **CSS `backgroundColor`**. Covers custom HTML legends (BoxPlot,
   RadarView zone swatches, ConfigSidebar pills) where the swatch
   is a styled `<span style="background: ...">`.
3. **SVG `stroke` attribute**. Covers Recharts `iconType="line"`
   swatches (a horizontal stroke with `fill="none"`) and the
   dashed-line "Static" entry in `<ComparisonReferenceLineChart>`.
4. **CSS `border-top-color`** (when style ≠ `none`). Covers custom
   dashed-line legend entries that use `border-top: ... dashed`.

After all four pass empty: last-resort sentinel `#888`.

**`isTransparentColor`** rejects `transparent`, `rgba(0,0,0,0)`,
empty string, **and the SVG paint keywords `none` and
`currentcolor`**. Pre-Patch-4AE the `stroke` walk matched
`stroke="none"` on Recharts square icons and the extractor
returned `color: "none"`; the renderer then emitted
`<rect fill="none">` which is **invisible** in transparent-
background PNG exports (the user-reported bug).

**`renderLegendSvg` defensive guard**: every `<rect>` emitted by
the renderer goes through `isTransparentColor(item.color) ? '#888'
: item.color`. The extractor should never produce a transparent-
paint value (the four priorities plus the `#888` sentinel cover
all cases), but transparent-background exports turn any unpainted
rect into pure invisibility with no visual hint — belt-and-
suspenders the rule at the render boundary too.

#### What NOT to do (legend swatch colours)

- **Don't add a new colour-source check without putting it in the
  priority order.** The order matters: a Recharts square icon has
  BOTH `stroke="none"` and `fill={color}`. The fill must win;
  putting the stroke walk first or accepting "none" as a colour
  produces the invisible-swatch regression.
- **Don't return colour strings unvalidated from the extractor**
  ("just trust Recharts"). External libraries' DOM shapes drift
  with versions; the `isTransparentColor` rejection list is the
  single contract that catches all "would render unpainted"
  values regardless of which extractor branch produced them.
- **Don't drop the `renderLegendSvg` defensive `#888` coercion**
  even though the extractor "should never" leak a transparent
  value. Transparent-background PNG export is a no-margin-for-
  error rendering surface — invisible swatches look like a bug
  in the underlying data rather than an export glitch and erode
  user trust in the export pipeline.
- **Don't test legend extraction with custom-HTML fixtures only.**
  The existing test set (BoxPlot-style `<span style="background:
  ...">`) covers the backgroundColor branch but missed Recharts'
  SVG-path-fill branch for years — the Patch 4AE bug shipped
  with green tests. Always include Recharts-DOM-shape fixtures
  (`<svg><path stroke="none" fill={color}>`) when changing
  extraction logic.
