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

## UI conventions

### Multi-select chips/selectors anchor Pick/Add on the LEFT

Multi-select chip components (selected items rendered as removable
chips next to a Pick/Add affordance) anchor the Pick button on the
LEFT of the row. Selected chips flow rightward in selection order —
newest additions land at the rightmost position. The Pick button
stays in the same DOM/visual position regardless of selection state.

Why: the alternative — Pick on the right — produces layout drift.
As selections grow, Pick shifts right; when selections shrink, Pick
doesn't always shift back the same distance (because of wrap
behaviour); add/remove cycles produce awkward gaps. Left-anchored
Pick is stable: users always reach for the same place to add a
selection, and the rightward flow gives a clear "newest at the
right" reading order.

**Components in scope** (audit complete as of this patch):

- `<DSMScenariosChip>` (`components/dsm/DSMScenariosChip.tsx`) — used
  in `DSMImpactPanel`, `ProjectedImpactPanel`, `MaterialFlowPanel`.
- LCI Scenarios chip group (inline in
  `components/impact/ProjectedImpactPanel.tsx`).

**Components correctly excluded from the rule**:

- **Single-select dropdowns** (Archetype picker, Method family
  `<select>`, AESA cascade DSM-model / scenario / background). No
  "selections accumulating" — only one value, no shifting layout.
  Don't apply the rule here; reordering would break expected
  dropdown semantics.
- **Vertical checkbox lists** (Sensitivity cases checklist in
  `DSMImpactPanel` + `MaterialFlowPanel`, AESA principle assignments,
  ArchetypeCheckboxTree). Every option is permanently rendered —
  there's no popover affordance to anchor.
- **Vertical row editors** (`PairListEditor` in
  `ProjectedImpactPanel`, `DimensionsEditor`, `DependencyRulesEditor`,
  `DownscalingChainEditor`, `PrinciplesEditor`,
  `ScalingRulesEditor`, parameter table rows). Add buttons live at
  the bottom of vertical lists where new rows naturally appear —
  there is no horizontal drift problem.
- **Single-button-with-popover pattern** (Patch 4T's
  `<IndicatorDisplayFilter>`). The chip IS the trigger; selections
  live inside the popover, not as adjacent chips. No layout drift
  to fix.

**Visual convention**: Pick/Add button uses a **dashed border**
(`1px dashed var(--border-default)`) to distinguish it from
solid-bordered selected chips. The dashed border is the "this is an
action button, not a static value" affordance. Match across all
multi-select chip implementations.

#### What NOT to do

- **Don't render Pick/Add after selected items in multi-select
  chips.** The button shifts right as selections grow, doesn't
  always shift back when selections shrink (wrap behaviour, gap
  collapse), creating awkward layout drift. Anchor Pick on the left.
- **Don't apply the left-anchor rule to single-select dropdowns**
  (impact method family picker, archetype picker, AESA cascade
  selectors). Single-select has no "accumulation" concern — there's
  only ever one value, no shifting layout. The rule is multi-select
  only.
- **Don't apply the rule to vertical row editors** (`PairListEditor`,
  list editors). Vertical lists have no horizontal drift; "Add row"
  belongs at the bottom where new rows naturally appear.
- **Audit-and-fix-all is the right discipline for layout consistency
  rules.** Fixing one chip while leaving siblings inconsistent
  produces a worse UX than the original — users notice the
  inconsistency and start hunting for which-chip-uses-which-pattern.
  When establishing a layout convention, apply it universally in
  one patch; don't accumulate technical debt by deferring siblings.
- **Don't drop the `data-testid="*-pick"` selector** when refactoring
  a chip. The convention test
  (`tests/multiSelectChipLeftAnchor.test.tsx`) keys off it to assert
  DOM order. Without the testid the regression is invisible.

Year-detail UI uses the shared `<YearSlider>` component
(`components/ui/YearSlider.tsx`), not a `<select>` dropdown or bare
`<input type="range">`. The slider syncs with chart cursors live (every drag
step, not just on release) — the chart's `<ReferenceLine>` and any per-year
tables/sub-charts read the same `detailYear` state, so binding it to the
slider's `onChange` propagates on every input event.

**When it applies — single-year-focus pattern**: the user inspects details
for one year out of N (cohort table for {year}, age distribution at {year},
SR radar at {year}, top-N materials in {year}, AESA box plot at {year}).
The chart/table re-renders to show that year's slice.

**When it doesn't — all-years-at-once pattern**: the visualization shows
all years simultaneously without a focal year (multi-year trajectory line
charts, time-series stacked areas, AESA Timeline). No slider — the chart
*is* the year navigator.

**Currently used by**: DSM Dashboard (system dynamics + age distribution),
DSM Material Flows (top-N detail year), Impact Assessment (Static +
Prospective Background cohort year), AESA Dashboard (top-level year), AESA RadarView,
AESA BoxPlotView. Pass `accentColor` matching the module (`--mod-dsm`,
`--mod-lca`, `--mod-plca`, `--mod-aesa`); use `variant="inline"` when the
slider sits inside a chart card, `variant="card"` for a standalone year
picker; `showDots={years.length <= 30}` keeps dots from cluttering long
horizons. Range pickers (start-year + end-year) and parameter sliders
(Weibull k/λ, mode parameters) keep their bespoke `<input type="range">` —
this convention is for single-year inspection only.

Long-form panels (configuration + results pairs) use `<CollapsibleCard>` for
the configuration and results sections so users can focus on either input or
output. Default both expanded; user controls collapse. Collapsed-state
summary line includes key headline metrics so the card is informative
without expansion (e.g. `{N} indicators · {scope} · {years range} ·
Sensitivity: {name}` for config; `Calculated in {time} · {N} indicators ·
Peak: {value} {unit} ({year})` for results). Hide the Results card entirely
until a calculation has produced data — don't render an empty stub. Used in
Impact Assessment (Static + Prospective Background tabs).

**Where the pattern applies**: `<CollapsibleCard>` applies where a config
block stacks vertically above a results block. Where config and results are
arranged side-by-side (sidebar + main), the layout itself provides the
separability and `<CollapsibleCard>` isn't needed.

**LCA Architect Manager tab** uses `<CollapsibleCard>` for Import, Export,
and Archetype Summary — same pattern as Configuration cards in Impact
Assessment. Import + Export sit side-by-side at the top (responsive grid)
and Archetype Summary stacks below. Each card collapses independently.
Import and Export default expanded (primary affordances on first visit);
Archetype Summary defaults collapsed (informational, surfaces totals via
the summary line).

**AESA exception**: AESA Dashboard does not use the `<CollapsibleCard>`
pattern. AESA uses a sidebar+main layout where configuration is already
separable via the existing `sidebarCollapsed` toggle, and the main content
(zone headline cards + active view) is primary content that should remain
visible. `<CollapsibleCard>` is for vertical config/results stacks like
Impact Assessment, not for horizontal sidebar+main layouts.

### Page-level scroll for chart-rendering pages

Page-level scroll is MApper's default for any page rendering charts
at natural height. Don't constrain page or result-body containers
to viewport height — sequential reading (scroll the page) is
preferred over panel-internal scrolling. Charts have natural sizes
determined by content (radar axis count, time-series year range,
stack of indicators with axis labels). Forcing them into bounded
containers either clips them (Patch 4V's regression) or shrinks
them illegibly.

**Currently applied to**:

- **Single-product Impact Assessment** (Patch 4D era — see the
  detail below this section).
- **AESA result body** (Patch 4V). Drops `height: 100%` from the
  AESA root, `overflow: hidden` from inner `<main>`, and
  `flex: 1, minHeight: 0, overflow: auto` from the active-view
  section. Configuration sidebar becomes `position: sticky, top: 0,
  maxHeight: calc(100vh - 96px)` so it stays visible while main
  scrolls; the body wrapper uses `alignItems: flex-start` so the
  sidebar's height is content-driven (precondition for sticky).

**Future pages** with chart-rendering result bodies should follow
the same pattern: drop viewport-fit constraints, let Shell's outer
`<main overflow: auto>` handle the scroll, sticky-position any
sidebar that should stay visible during scroll. Always-mount tab
panels via the visibility-toggle convention (the existing rule)
applies here too — don't conditional-mount panels to "save scroll
height," just let `display: none` do the work.

#### What NOT to do

- **Don't constrain chart-rendering pages to viewport height.** A
  fixed-height ancestor with `overflow: hidden` (or `auto`) creates
  an internal scroll container that fragments the reading
  experience and clips chart content positioned outside the SVG
  bounding box (radar axis labels, legend overflows). The single-
  scroll-container rule keeps the page coherent.
- **Don't add `flex: 1, minHeight: 0, overflow: auto` to chart
  containers** thinking it "constrains" the chart. It clips. SVG
  charts often render content (axis labels, tooltips) outside
  their reported bounding box; `overflow: auto` on the container
  hides those instead of letting the page scroll to reveal them.
- **Don't reach for sticky sidebars without `alignItems:
  flex-start` on the flex container.** Without it, flexbox stretches
  the sidebar to the container's content height; there's then no
  room for the sidebar to "stick" within its own container, and
  `position: sticky` becomes a no-op. The combination of `align-
  items: flex-start` (sidebar = content height) + `position:
  sticky` (anchored to scrollable ancestor = Shell `<main>`) is
  load-bearing.

### Single-product mode uses page-level scroll

Single-product Impact Assessment sections take their content's natural
height; the page itself scrolls. Configuration and Results stack
vertically and grow to whatever vertical space their content needs.

**Why**: LCA results are long-form analysis output — many indicators,
stage breakdowns, scenario tabs, and tables meant to be reviewed
sequentially. A bounded-height-with-internal-scrolling layout was
attempted (Patch 4 — `fill` prop on `<CollapsibleCard>`, `flex: 1` +
`minHeight: 0` on panel sections, internal scrolling within
Configuration and Results) and reverted after dogfooding: section-level
scrolling fragments the reading experience because LCA review is
inherently sequential reading rather than dashboard-style at-a-glance
comparison. Two scroll containers (page + section) compete and force
the user to track which one their cursor controls.

**Stage Amounts collapsibility (kept)**: the wrapper-level Stage Amounts
editor sits inside its own `<CollapsibleCard>`, default collapsed — most
users keep Lifetime defaults; the editor is an advanced tweak.
Collapsed-state summary shows preset + abbreviated per-stage amounts
(`Lifetime · 15 yr · Mfg 1 · Use 15 · Maint 15 · EoL 1`) so users see
the active configuration without expanding. Locked in by
`tests/singleProductLayout.test.tsx`.

**Sub-tab nav → content separation (Patch 5K)**: the Single-item content
block (`single-product-tab-content`) carries a `marginTop: var(--space-4)`
so the Static/Prospective/Comparison tab row reads as distinct from the
CONFIGURATION card below it (matches the System-level layout's tab→content
gap). Spacing comes from the scale token, never hardcoded px.

**Single-pane card spacing (Patch 5U)**: the single-pane is a plain block
container (no flex `gap`), so stacked cards space via a scale-token `marginTop`
on the lower element. The Archetype → Stage amounts gap (`single-product-stage-amounts`)
uses `marginTop: var(--space-4)` — the same token + mechanism as the
tab-nav → content gap above. Any future card added to this pane follows the
same rhythm (scale token, never hardcoded px).

#### What NOT to do

- **Don't constrain Single-product mode section heights with flex
  layouts.** Page-level scroll is the established pattern. The
  bounded-height-with-internal-scrolling layout was attempted and
  reverted because it fragments long-form LCA result review. Don't
  reintroduce `height: 100%` / `minHeight: 0` / `flex: 1` on panel
  roots, tab panes, or `<CollapsibleCard>` instances within the
  single-product subtree.
- **Don't add a `fill` prop (or equivalent) back to
  `<CollapsibleCard>`.** It was removed cleanly when the bounded-height
  pattern was reverted because no consumer outside single-product used
  it. If a future panel genuinely needs viewport-bounded scroll, build
  it as a one-off rather than re-introducing a generic prop that
  invites the failed pattern.
- **Don't conditionally mount the inactive tab panes** in the single-
  product wrapper. Same visibility-toggle rule as everywhere else —
  panel-local state (Configuration expanded/collapsed, scenario tab
  idx) must survive a tab switch. The wrapper uses `display:
  block|none` per pane, not conditional render.

### Pages unmount on tab switch; results live in `useSessionState` (walkthrough 5)

`App.tsx` renders ONE page at a time, so leaving a top-level tab unmounts the
whole page and every `useState` in it. That is how a finished single-product
result vanished when the user glanced at another tab: Impact Assessment kept
the selected archetype in local state, which restarted at `null` on remount
and was mirrored into `singleProductImpactStore`, whose setter clears the
results; the Static/Prospective panels and the LCA Architect calculator held
their runs locally too.

- **The selected archetype is the store's `archetypeId`**, read directly; no
  local copy, no mirror effect.
- **Anything computed, and the selection that produced it, goes through
  `useSessionState(key, initial)`** (`stores/sessionStateStore.ts`): a drop-in
  for `useState` backed by a project-scoped store (reset on project change,
  session only, never persisted). Single-product panels key it per archetype
  (`singleProduct.static.<arcId>.*`), so a run in flight lands under its own
  archetype even if the user picks another.
- `tests/setup.ts` resets it after every test through a hook the store puts on
  `globalThis`; without that, one test's kept state is on screen in the next.
- Locked by `tests/resultsSurviveTabSwitch.test.tsx` (compute, UNMOUNT,
  remount, result back), reverted-source break-checked.
- **Each tab also has its own `ErrorBoundary`** in `App.tsx`, keyed by tab:
  a page that throws shows the error in the content area and the sidebar keeps
  working, instead of the root boundary replacing the app.

#### What NOT to do

- **Don't hold a result, or the selection it belongs to, in `useState` in a
  page.** It is gone the next time the user opens another tab. Form-only
  values (an expanded card, a search box) can stay local.
- **Don't key `useSessionState` without the identity it belongs to** (the
  archetype for single-product runs). A shared key shows one archetype's
  result under another.
- **Don't persist it.** Session only; a stored result outliving its inputs is
  the stale-number class the provenance work exists to prevent.

### Visibility-toggle vs. conditional mount (general UI rule)

**General rule.** Any UI element that hides and reappears — tab panel,
collapsible card, modal, accordion, mode wrapper, sub-tab — defaults to
**visibility-toggle** (`display: none`), not conditional mount/unmount.
Conditional mount kills component-local React state silently and forces
store-lifting that wouldn't otherwise be necessary. Reach for conditional
mount only when there's a specific reason to free memory (e.g. heavy
lazy-loaded components that aren't worth keeping in memory across the
entire session, or panels with side-effecting mount logic that should
re-run when the user returns). Default to visibility-toggle.

The "conditional-mount eats useState" failure mode has been root-caused
multiple times in this codebase: tab panels (Patch 3), mode toggle
wrappers (Patch 3), sub-tab panels (Patch 3), and `CollapsibleCard`
(Patch 4A). The pattern is established enough to be the default rule for
all hide/reappear UI.

**Concrete instances in this codebase.**

- **Impact Assessment tab panels** (`ImpactAssessment.tsx`): renders all
  three panes (`static`, `projected`, `compare`) simultaneously and flips
  the `display` style on the inactive ones. Each pane carries a
  `data-testid="impact-tab-pane-<key>"`. Locked in by
  `tests/impactAssessment.tabPersistence.test.tsx`.
- **Impact Assessment mode toggle** (Patch 3): single-product and
  system-mode subtrees both stay mounted; `display: none` on the
  inactive pane. Locked in by `tests/impactAssessment.modeToggle.test.tsx`.
- **`CollapsibleCard`** (Patch 4A): body wrapped in `<div style={{display:
  expanded ? 'block' : 'none'}}>` so MethodPicker selections, scope picks,
  and other indicator-row state survive collapse/expand round-trips.
  Locked in by `tests/collapsibleCard.visibilityToggle.test.tsx`.

Each long-lived panel (`DSMImpactPanel`, `ProjectedImpactPanel`,
`ComparisonPanel`) is wrapped in `React.memo` so unrelated parent
re-renders (e.g. opening the Method Library modal, toggling tabs) don't
cascade. memo doesn't help with the panels' own store-subscription
re-renders, but those only fire while a calculation is active and the
hidden subtree skips layout/paint via `display: none`.

#### What NOT to do

- **Don't switch back to `{condition && <Panel />}`.** That kills every
  panel-local `useState` on hide/reappear — the bug this pattern fixes.
  Render tests will catch the regression, but only if a future dev runs
  the suite. The pattern itself (visibility-toggle) is the primary
  defense.
- **When fixing a "state disappears on switching" bug, do NOT lift the
  affected state into a store as a first instinct.** Investigate whether
  the parent wrapper conditionally mounts/unmounts. The wrapper-level
  fix (visibility-toggle) is principled and benefits all consumers;
  state-lifting is symptomatic, adds store complexity for one specific
  case, and creates two sources of truth (store slot + any mirrored
  local state) that are easy to desync. Lift state only when you have a
  separate reason to share it across components — never as a workaround
  for unmount-on-hide.
- **Don't leave `data-testid` selectors in place but make them
  conditional** (e.g. on activeTab or expanded). Render tests assert
  panes/wrappers are always present; conditional `data-testid` would
  break the always-present invariant silently.
- **Don't move CollapsibleCard's children outside the toggle wrapper to
  "save renders".** The wrapper exists precisely to scope `display: none`
  to the body while leaving header (chevron, title, summary, actions)
  visible. Splitting the children across the wrapper would either
  require duplicating the toggle logic per child or break the
  always-mounted contract for some children.

### Effects in visibility-toggle-mounted panels (Patch 4E)

When two panels are mounted simultaneously via the visibility-toggle
pattern, `useEffect` dependencies on the wrapping panel's "primary"
identity (e.g. `[archetypeId]`, `[systemId]`) are NOT enough to drive
cross-panel synchronization. Both panels are alive at the same time;
the user can edit data in one and expect it to flow to the other
without an archetype/system change. Subscribe to the **actual data
being synchronized** — the source-of-truth slice — so the effect fires
whenever that slice changes, not just on identity switch.

**Concrete instance — Static→Projected inheritance.** The Projected
panel's first-visit-inheritance effect (Patch 4D) was originally keyed
on `[archetypeId]` only. Bug: user picks an archetype before
configuring Static; the inherit effect fires once with `staticCfg ===
undefined` (path 3 → defaults), then never re-fires. User then
configures Static and switches tabs — Projected silently stays on
defaults because `archetypeId` didn't change.

**Patch 4E fix** in `SingleProductProjectedPanel.tsx`:

- Add a sliced selector
  `useSingleProductImpactStore((s) => s.staticConfigByArc[archetypeId])`
  so the effect re-fires when *just this archetype's* static config
  changes (not on every store write).
- Add the sliced value to deps. Read `projectedConfigByArc` and
  `projectedCustomizedByArc` fresh via `getState()` rather than
  subscribing — they're written by the effect itself, and subscribing
  would re-fire from the effect's own write.

**Patch 4F amendment — live mirror, not one-shot.** Patch 4E shipped a
guard ref that fired Path 2 inheritance only the first time the
staticCfg slice changed for an archetype, with subsequent changes
falling through Path 1 (early-return on non-archetype-change). The
unit tests passed because they wrote one staticCfg payload then
asserted; the real workflow — user adds 4 indicators sequentially on
Static — only inherited the first. Patch 4F flipped the semantic:
**live mirror Static→Projected until `projectedCustomizedByArc[arc]`
flips true.** Each Static slice change re-bumps the picker; the
banner shows only once per arc per session
(`bannerShownForArcRef`). Once the user clicks anything on Projected
that calls `setProjectedCustomized(arc, true)`, the mirror stops and
Path 1 takes over (restore-only-on-archetype-change).

**Patch 5AY — cold-load default seed (closes the parked single-item Prospective
watch-item / image-1's 0/N).** The mirror has no SOURCE until Static publishes
to `staticConfigByArc[arc]`; opening Prospective FIRST (Static not effectively
published yet) left it at 0/N. Fix: `SingleProductProjectedPanel` fetches the
full indicator set (all-N, EF v3.1 else first family — matching MethodPicker's
cold default) and a dedicated **cold-seed effect** seeds it via `initialSelected`
(+ picker remount) ONLY when truly cold: no `staticCfgForArc` methods, no
`projectedConfigByArc[arc]`, not customized, and `selectedMethods` empty. The
seed flows through the SAME single-echo + `skipNextMethodsChangeRef` path the
mirror uses → `projectedCustomized` stays **false**, so a later Static publish
still mirrors over the default (the cold-seed's `staticCfgForArc` guard yields),
and a genuine user edit still flips customized true and freezes the mirror.

**Why NOT `defaultAllSelected` on the Projected MethodPicker (the rejected
naive fix).** `defaultAllSelected` fires its all-N onChange ASYNCHRONOUSLY
(after `getMethods` resolves), so it arrives as a SECOND onChange the single-use
skip ref can't cover — `handleMethodsChange` reads it as a user edit →
`setProjectedCustomized(true)` → freezes the mirror, regressing
`singleProductStaticDefaultPublish (b)` + `singleProductInheritanceUserFlow`.
Seeding all-N via `initialSelected` instead fires exactly ONE mount echo, which
the skip absorbs — no async double-onChange, no false customization. The
mirror source being seeded to the full default regardless of visit order is the
convention; `projectedCustomized` is set only by genuine user changes, never by
the default seed. Locked by `tests/singleProductProjectedColdLoad.test.tsx`
(cold → all-N + not customized; later Static change still mirrors; real user
edit customizes + freezes).

**Lock in by user-click test, not store-mutation test.** The 4E test
suite stubbed `setStaticConfigForArc` directly via the store, which
bypasses the actual `MethodPicker.onChange → handleMethodsChange →
store-write → slice-selector → Projected-effect` chain. The user-flow
test (`tests/singleProductInheritanceUserFlow.test.tsx`) renders both
panels and clicks rendered MethodPicker checkboxes. That's the
pattern for any cross-panel sync regression — store mutation alone
doesn't catch the lifecycle/effect-ordering shape that broke 4E.

#### What NOT to do

- **Don't add `staticConfigByArc` (the whole map) to the deps**, only
  the per-archetype slice. Subscribing to the whole map fires on
  every other arc's edits too, which is needless churn (and would
  bypass zustand's reference-equality optimization).
- **Don't subscribe to `projectedConfigByArc` in the deps to "keep
  things consistent".** The effect writes to that slot on every
  mirror, so subscribing creates a self-trigger loop. Read fresh via
  `getState()` for slots the effect itself writes.
- **Don't reintroduce the "one-shot inheritance" semantic.** It looks
  defensible on paper ("only inherit once, then user owns Projected")
  but doesn't match the user's mental model when configuring
  indicators piece-by-piece. Live mirror is the contract; the
  customized flag is the off-switch.
- **Don't move the banner-suppression off
  `bannerShownForArcRef`.** The mirror fires N times per arc as the
  user adds indicators on Static; only the first fire should pop the
  banner. A flag tied to projCfg presence (4E's
  `inheritedForArcRef`) was wrong because projCfg gets rewritten on
  every mirror — using it as the "first inheritance" signal also
  broke the live-mirror semantic.
- **When debugging "data X doesn't update in panel Y after I edit
  panel Z", first check: are X and Y both mounted simultaneously,
  and is Y's effect keyed on something other than X?** That's the
  failure mode. The fix is almost always "add the slice of X to Y's
  deps." Then ask "what's the off-switch?" — explicit user
  customization is usually the right answer; first-fire heuristics
  fail in incremental-edit workflows.
- **Don't set `defaultAllSelected` (or any auto-default) on a panel whose
  selection FEEDS a live-mirror — let it inherit.** Self-defaulting fires the
  panel's `onChange` → trips its customize handler (`setProjectedCustomized(true)`)
  on mount → freezes the mirror, so upstream (Static) edits stop propagating.
  `SingleProductProjected` deliberately omits `defaultAllSelected`; it gets "all"
  via the 4F mirror from Static. Default-all belongs on the SOURCE panel only.

### Hooks must be called unconditionally (Patch 4H)

React's Rules of Hooks require every functional component to call the
same hooks in the same order on every render. Violating this throws
**"Rendered more hooks than during the previous render"** at runtime
the moment a re-render takes a different code path through the
component body. Patch 4G shipped a regression in
`SingleProductComparisonPanel.tsx` that exemplifies the failure mode
— `const [isExporting, setIsExporting] = useState(false)` and the
matching `useCallback` were placed AFTER the early-return guards on
`archetypeId`/`staticResult`/`projectedRuns`. Single-state tests
passed because each test exercised only one path per component
instance. The bug surfaced in the field when the user transitioned
from "no results" to "both results computed" within the SAME instance
— render N: 7 hooks, render N+1: 9 hooks → React throws.

**The rule:** every hook (`useState`, `useEffect`, `useMemo`,
`useCallback`, `useRef`, custom hooks, store hooks like
`useSomeStore(...)`) must run before ANY conditional `return`.

```tsx
function Panel({ id }) {
  // ALL hooks first, unconditional.
  const [a, setA] = useState(...)
  const value = useStore((s) => s.value)
  const memo = useMemo(...)
  const handler = useCallback(...)
  useEffect(...)

  // THEN conditional returns.
  if (id == null) return <Empty />
  if (!value) return <Loading />
  return <Full ... />
}
```

The hook body itself can branch on conditions (e.g. `useEffect(() =>
{ if (!result) return; ... })`). What can't branch is whether the
hook is *called* — that's a positional contract React enforces by
hook count.

#### Render-test discipline for result-presence states

Components with multiple result-presence states (no result, partial
result, full result) need render tests for **each** state — and at
least one test that **transitions between states within a single
component instance.** Single-state tests pass against hook-ordering
bugs because each test renders only one path. The transitioning
test is the one that catches the regression.

`tests/singleProductComparisonHookOrder.test.tsx` is the template:
five cases covering all three single-state renders plus an explicit
empty → full transition via store mutation + `rerender`. The
transition assertion (`expect(...).not.toThrow()` around the
`rerender` call) was the only one that failed against the buggy
implementation; the four single-state cases passed even before the
fix. When you add a new conditional branch to a panel, add the
transitioning render test before shipping.

#### What NOT to do

- **Don't place hooks after early returns to "scope them" to the
  full-render path.** A hook that's only "needed" in one branch
  must still be called unconditionally — its return value can be
  ignored when the branch isn't taken.
- **Don't write a single-state render test and assume it catches
  hook-ordering bugs.** Single-state tests took 4G to production
  green. The transition test is the load-bearing one.
- **Don't lift the affected state into a store as a workaround.**
  The fix is structural (move the hook above the early return), not
  state-architectural. State-lifting addresses a different failure
  mode (visibility-toggle conditional-mount eating useState — see
  the existing rule above) and adds store complexity for no benefit
  here.
- **Don't disable the React error boundary that catches the throw
  in dev.** The "Rendered more hooks" error is loud on purpose; if
  you're tempted to swallow it, that's the bug telling you a
  re-render path is structurally broken.

### Δ chart framing in Single-product Comparison

`<ComparisonDeltaChart>` (in
`components/charts/ComparisonReferenceLineChart.tsx`) ships with the
title **"Impact assessment change compared to Static Background
(Δ > 0 → worsening, Δ < 0 → improvement)"**. Explicit Δ math wins
over visual-direction framing — both are methodologically valid
(`Δ = P − S` in both single-product and system Comparison code), but
user preference is the explicit math. The earlier "downward =
improvement" framing was tried in Patch 4E and replaced in 4F. Do
not relitigate without a user-driven reason; document the next pivot
here so the back-and-forth is visible.

The chart is a `<LineChart>` (no area fill). Patch 4F also dropped
the original vertical-gradient `<Area>` fill — it conveyed
direction (red top = bad, green bottom = good) but read as a
shadow/halo against the page background. Sign legibility is preserved
by the curve crossing the y=0 reference line and the tooltip's
green/red value tone. Match the sibling `<ComparisonReferenceLineChart>`
styling — both are now Line-only with no fill.

### Single-product Impact Assessment Excel exports (Patch 4G)

Three sibling builders in `mapper/api/impact.py`, paralleling the
per-axis system-mode builders (`_build_multi_param_workbook`,
`_build_multi_dsm_workbook`, `_build_multi_paired_workbook`,
`_build_multi_scenario_workbook`):

- `_build_single_product_static_workbook(archetype_name, scope,
  scenarios)` — Configuration / Total impacts / Stage breakdown.
  Multi-parameter sensitivity adds one column per case to the totals
  sheet. Stage breakdown sheet appears only when `scope == "all"` AND
  at least one scenario carries a non-empty `stage_breakdown`.
- `_build_single_product_prospective_workbook(archetype_name, scope,
  runs)` — Configuration / Time series (wide) / Time series (long) /
  Stage breakdown by year (only when `scope == "all"`). Wide layout is
  for skim-the-trajectory reading; long layout is for downstream
  pandas/R consumption.
- `_build_single_product_comparison_workbook(archetype_name, scope,
  static_result, projected_runs)` — Configuration / Comparison data /
  Cumulative summary per traj. Sign convention `Δ = P − S` (matches
  the in-app Δ chart from Patches 4E/4F). Δ% normalisation handles
  `S == 0` by writing an empty cell rather than `inf`/`NaN`.

Routes: `POST /impact/export-single-product-{static,prospective,comparison}`.
Each takes a typed envelope (`SingleProduct{Static,Prospective,
Comparison}ExportRequest` in `mapper/models/schemas.py`) carrying the
archetype name, scope, and the data — no task_id lookup needed
because the frontend already has the result objects in
`useSingleProductImpactStore`. Filenames follow
`MApper_Impact_SingleProduct_<Static|Prospective|Comparison>_<archetype>_<date>.xlsx`,
sanitised via `_sanitize_filename`.

**Frontend wiring**: each Single-product Results card has a
`<button data-testid="single-product-{static,projected,compare}-export">`
in the CollapsibleCard `actions` slot. The button is absent (not
disabled) before a result exists — the Results card itself is gated
on `hasResults`, so a no-data state shows the empty state, not a
greyed-out button. Loading state during export shows a spinner.

#### What NOT to do

- **Don't bundle Static + Prospective + Comparison into one
  mega-workbook.** Each sub-tab gets its own export — matches the
  per-axis convention from system-mode (multi-LCI, multi-DSM,
  multi-param, multi-paired all ship as separate files), keeps each
  file shareable in isolation, and avoids a workbook that's
  load-bearing on three different result shapes at once. If a user
  wants both Static and Prospective, they download two files.
- **Don't move the builders into `mapper/api/lca.py`.** That module
  owns LCA Architect's Calculator export
  (`_build_lca_export_workbook` + `/lca/export-archetype`), which is
  a workshop tool tied to BOM authoring. Single-product Impact
  Assessment is a sibling to system-mode Impact Assessment, both
  computing through `/lca/calculate-archetype` but with different
  framing (sensitivity / prospective / comparison). Keeping the
  Patch-4G builders next to the multi-axis system-mode builders in
  `impact.py` makes the per-axis pattern easier to extend.
- **Don't include the Stage breakdown sheet for specific-stage
  scopes.** When `scope ∈ {"inflows", "stock", "outflows"}`, the
  result is already that one stage — a "breakdown" would just have
  one column, which is redundant with the Total impacts sheet. The
  test `test_stage_breakdown_omitted_for_specific_scope` enforces
  this.
- **Don't write `Δ% = inf` or `NaN` when Static is zero.** Empty
  cell is the right surface — analysts opening the workbook in
  Excel won't get NaN-cascading-into-formulas surprises.
- **Don't reach for the per-scenario detail in the Comparison
  workbook for "rich" exports.** Multi-axis exports across modes
  deliberately ship narrower — re-run a single scenario's Static or
  Prospective for cohort-level / contribution-level depth. This
  mirrors the multi-LCI / multi-DSM convention.

### Onboarding tour

`OnboardingTour.tsx` (react-joyride) walks first-time users through one
representative research workflow end-to-end — computing a product's climate
impact against an ecoinvent base, with each step pinned to the next sidebar
tab in research order: Database Explorer → Archetypes (LCA) → Stock
Modeller (DSM) → Impact Assessment → AESA. Tour design is **goal-driven**
(one canonical research question executed end-to-end), not feature-driven
(per-button tooltips). pLCA and other branching paths get one-line mentions
in the welcome and closing steps, not dedicated stops.

Anchored via `data-tour="nav-<id>"` attributes on the Sidebar tab buttons
(`Sidebar.tsx`). Auto-start gated by the `mapper-onboarding-complete`
localStorage flag; manual restart via the `window.__mapperStartTour` global
exposed for the Settings → "Restart tour" button.

**When adding new tabs or major features, the tour does NOT automatically
need updating** — only update if the new feature changes the canonical
research workflow itself. New features get documented in CLAUDE.md and/or
in-app tooltips, not the tour.

#### What NOT to do

- **Don't blindly add a tour step for every new tab or feature.** The tour
  stays focused on one workflow; turning it into a feature catalog
  defeats its purpose and pads the run-time past the "2-minute" promise
  in the welcome copy. If a new feature is genuinely load-bearing for the
  canonical research path, replace or modify an existing step — don't
  append.
- **Don't add per-feature deep-dive steps** ("here's the multi-LCI chip,
  here's the format control, here's how to export charts"). Those belong
  in tooltips, the Help/Settings panels, or CLAUDE.md — not the tour.
- **Don't remove the `data-tour` attributes** on sidebar tabs without
  updating the corresponding step's `target` selector. Joyride silently
  drops steps with missing targets, which leaves users mid-tour at a
  blank screen.

### DSM combined "Inflows & Outflows" flows chart (Patch 5AD)

The DSM Dashboard's former single-series "Outflows" chart is now **"Inflows &
Outflows"** — two flows in one chart. **Inflows** render as a GROUPED bar (its
own Recharts `stackId="i"`) beside the **outflow** column (the existing
natural/forced/uploaded breakdown stays stacked under `stackId="o"`), with a
legend. Inflow data is the per-year total from the SAME DSM result
(`Σ simulationResult.years[].inflow`) — added to the `outflowBreakdown` memo; no
DSM compute/simulation change. There was no separate Inflows chart to remove
(inflows only had an upload card + a summary card). The chart shows whenever
there are inflows OR outflows.

**Colors match the table coding and are fixed per series** (not index-based):
inflow = `var(--success)` (the table/summary green), outflow sources keep
`--chart-3` / `--danger` / `--mod-dsm`. The legend/series model is the pure
`buildFlowLegend(breakdown)` (`utils/dsmFlowLegend.ts`) — Inflows lead, then a
single "Outflows" entry (single source) or the natural/forced/uploaded split —
keeping bars and legend swatches in lockstep. The legend always renders now (≥2
series) and legend export is always enabled; the chart-image + legend export
cover both flows. Filename `flows_<start>-<end>`. Locked by
`tests/dsmFlowLegend.test.ts`.

#### What NOT to do

- **The flows chart displays inflows and outflows together from the existing DSM
  result series — it is a visualization, not a compute change; series colors
  match the table's inflow/outflow coding and stay stable per series.** Don't
  fetch/recompute inflows (sum `simulationResult.years[].inflow`); don't
  index-color the series (fixed per-key via `FLOW_COLORS`); don't stack inflow
  into the outflow column (separate `stackId` → grouped, side-by-side).

### DSM Dashboard parallel-input upload boxes (Patch 5A)

Annual inflows and Annual outflows on the DSM Dashboard System dynamics
tab are methodologically parallel — both are time-series CSV inputs that
feed stock dynamics from the same kind of data stream. They share one
layout, rendered through the shared `<DSMUploadSlot>` component
(`components/dsm/DSMUploadSlot.tsx`): header → status line → action
prompt → schema subtitle → Download template link (top-right of the
uploader header, owned by `<CSVUploader>`) → drop-zone. The shared
component enforces the symmetry by construction — the two boxes cannot
drift apart as their copy evolves. `<CSVUploader>`'s drop-zone carries a
fixed `minHeight` so it renders at the same size across boxes and upload
states regardless of header content above it. Symmetry is locked by
`tests/dsmUploadSlotSymmetry.test.tsx`.

The two status lines differ in wording because the methodological
conditions differ (inflows: "Required to run simulation"; outflows:
"Required for manual cohorts"), but both follow the same "Required …"
framing and the same structural slot. The schema subtitles differ in
content (inflows describes new units entering; outflows notes the
optional age/birth_year cohort-targeting column) but both occupy the
same one-line subtitle slot.

The Stock and Stock-targets boxes deliberately stay on `<SetupCard>`,
not `<DSMUploadSlot>` — Stock has a different purpose (single upload +
aggregate toggle in its header `right` slot), and the parallel-input
symmetry rule is specific to the inflows/outflows pair.

#### What NOT to do

- **Don't ship visually asymmetric layouts for methodologically
  parallel inputs.** Side-by-side boxes serving the same structural
  purpose (upload a time-series CSV) should follow identical layout
  patterns even when their content differs. Asymmetry signals
  "different thing" to users when these are actually the same thing
  applied to different data streams. The pre-Patch-5A inflows box
  shipped without a schema subtitle and with a non-parallel status
  ("Not yet uploaded"), making it read as a different kind of control
  than outflows.
- **Don't patch one box's props inline** to fix the symmetry. The
  shared `<DSMUploadSlot>` is the enforcement mechanism; editing one
  box's `<SetupCard>`/`<CSVUploader>` directly re-opens the drift the
  component closes.
- **Don't fold Stock into `<DSMUploadSlot>`.** Stock isn't part of the
  parallel pair — it carries an aggregate toggle and single-upload
  semantics. Forcing it into the shared component would require
  bending the component with optional slots.
- **Don't drop the drop-zone `minHeight`** when refactoring
  `<CSVUploader>`. Without it, a box with more header content pushes
  its drop-zone to a different size/offset than its sibling.

#### Patch 5A+ — layout structure (Stock banner + parallel pair)

Patch 5A unified the *component*; the boxes still rendered at different
sizes because (a) the schema subtitles wrap to different line counts at
narrow column widths, shifting the drop-zone start, and (b) Stock took a
full equal-width grid column, compressing the inflows/outflows pair. The
DSM Data-setup grid (`DSMDashboard.tsx`) is now two stacked rows:

- **Stock = system identity → full-width row.** Renders as a horizontal
  banner (`<CompactCard>`) when uploaded, a full-width `<SetupCard>` (with
  the by-age / Aggregate toggle) when empty. It is NOT a column in the
  temporal grid.
- **Temporal inputs → equal-width parallel row below.** A nested grid
  (`data-testid="dsm-temporal-grid"`) with `gridTemplateColumns:
  repeat(N, 1fr)` and `alignItems: 'stretch'`, where N = inflows +
  conditionally outflows (manual mode) + stock-targets (stock-driven
  mode). The inflows/outflows pair always splits its row 50/50 regardless
  of stock upload state.

This layout is **methodologically meaningful**: Stock defines the system;
inflows + outflows describe its temporal evolution. The visual hierarchy
(identity banner above, temporal pair below) reflects that.

Two complementary mechanisms guarantee identical box dimensions in the
parallel pair:

1. **Subtitle-area reservation** (primary). `<CSVUploader>` accepts
   `descriptionMinHeight`; `<DSMUploadSlot>` passes a 2-line reservation
   (`SUBTITLE_MIN_HEIGHT = '2.8em'`). The drop-zone starts at the same
   vertical offset in both boxes no matter how the subtitle wraps.
2. **Stretch backstop** (secondary). The temporal grid's
   `align-items: stretch` + `<SlotFrame>` `height: 100%` + `<DSMUploadSlot>`
   `flexGrow: 1` make boxes equalize to the tallest sibling if a subtitle
   ever exceeds the reservation.

#### What NOT to do (layout)

- **Don't shoehorn Stock into a 3-/4-column grid with the temporal
  inputs.** Stock has different semantics (system identity) and different
  upload UI (aggregate toggle, larger empty state). An equal-width grid
  produces asymmetry when stock is uploaded (compact chip beside full
  boxes) and compresses the parallel pair below visual minimums. Stock is
  its own full-width row.
- **Don't rely on `align-items: stretch` alone for parallel-input
  symmetry.** Variable-length subtitles cause inconsistent drop-zone
  offsets even when total box heights are equalized (extra height pools at
  the box bottom, not above the drop-zone). Reserve the subtitle-area
  min-height (`descriptionMinHeight`) so the drop-zone starts at the same
  offset; stretch is only the height backstop.
- **Don't drop `flexGrow`/`height: 100%`** from `<DSMUploadSlot>` /
  `<SlotFrame>` when refactoring — without them the stretch backstop is a
  no-op (the bordered card won't fill the stretched grid cell).
- **Don't shorten or rewrite the subtitle / drop-zone text to "fix"
  wrapping.** The subtitles are methodological documentation; the fix is
  the reservation + wider 50/50 columns, not truncation.

### DSM Simulation warnings panel collapse (Patch 5B)

`<SimulationWarningsPanel>` (`components/dsm/SimulationWarningsPanel.tsx`)
renders the DSM simulation warnings. The per-cohort-per-year "manual
outflow exceeds available stock" lines are repetitive and can run long
(37+ rows), pushing the results/charts far down the page. The header
carries a collapse toggle (Chevron, mirrors `<CollapsibleCard>`'s icons)
and a **persistent count** — `Simulation warnings (N)` — so collapsing
hides the body without erasing the signal that warnings exist.

- **Default expanded.** Warnings flag real data issues the user
  shouldn't miss; collapse is a manual action once they've read them.
- **Visibility-toggle, not unmount.** The body is `display: none` when
  collapsed (per the codebase-wide convention) so re-expanding is
  instant and scroll/row state is preserved. Locked by
  `tests/simulationWarningsPanel.test.tsx`.
- **Not `<CollapsibleCard>`.** That primitive hardcodes neutral
  `--bg-surface` / `--border-subtle` styling; the warnings panel needs
  its `--warning`-tinted background + border as a semantic signal. The
  inline panel keeps the warning styling and adds the same
  visibility-toggle behaviour rather than losing the colour by reusing
  the neutral card.

Warning data is a **flat `string[]`** (`simulationResult.summary.warnings`)
with no severity/type field, so summary-vs-per-cohort lines are only
distinguishable positionally — the panel collapses the whole body
uniformly rather than pinning the first "fleet stock drifted" summary
line. If a future patch adds a structured warning shape (type/severity),
keeping the summary line visible while collapsing the repetitive
per-cohort lines becomes worthwhile.

**Patch 5B+ — advisory vs per-cohort font color.** Within the body,
advisory/summary warnings render in the warning accent
(`var(--warning)`) and the repetitive per-cohort lines recede to a muted
`var(--text-secondary)`, so the advisory stands out from the high-volume
noise. Classification is by `isPerCohortWarning(msg)` — a regex on the
regular high-volume prefix `^Year \d{4}: (manual outflow|requested )`,
which matches BOTH per-cohort formats `dsm_engine.py` emits (the
`exceeds available stock` line at 1458 AND the `requested … outflows at
age` line at 1433). Everything that doesn't match is treated as advisory
(today only the aggregate `Total fleet stock drifted … baseline … Verify
…` line at 1104). Colors come from theme tokens (theme-aware), not
hardcoded hex. This is purely a per-row text-color change; collapse,
count, visibility-toggle, and empty-state are untouched. The durable fix
remains a structured `{severity, message}` shape from the backend, at
which point the UI should read the field instead of pattern-matching.

#### What NOT to do

- **Don't drop the count from the header when collapsed.** The count is
  the whole reason collapse is safe — without it a user can forget there
  were warnings. Hide the body, never the `(N)`.
- **Don't conditional-unmount the warning body on collapse.** Use
  `display: none`; the rows stay mounted so re-expand is instant. The
  test asserts the body node persists across a collapse/expand round-trip.
- **Don't default the panel to collapsed.** Warnings signal data
  problems; hiding them by default risks users shipping analyses with
  unaddressed issues.
- **Don't classify the advisory warning by position (`warnings[0]`) or by
  matching its specific wording.** Both break under backend changes —
  reordering shifts the position; rephrasing the "drifted/baseline/Verify"
  copy breaks a wording match. Match the regular high-volume per-cohort
  prefix (`^Year \d{4}: (manual outflow|requested )`) and treat the
  remainder as advisory. And match BOTH per-cohort formats — keying only
  on `manual outflow` mis-styles the `requested … outflows at age` line
  as advisory.

### DSM start/end stock figures — top-left KPI card (Patch 5C → 5D → 5E)

The selected year's **start** and **end** total-stock figures live in the
top-left KPI card of the DSM results 2×2 grid (`<StartEndStockCard>` in
`components/dsm/StartEndStockCard.tsx`, helper `yearStockStartEnd`). The
card label is "Total stock"; "Start of {year}" and "End of {year}" render
at **identical typographic scale/weight/mono** (5E — neither dominant).
Both track the year slider.

**Correct semantics (Patch 5E — fixes the 5C/5D mislabeling).** The engine
snapshots `YearResult.stock` AFTER the year's inflows/outflows
(`dsm_engine.py` ~1464), so it is the END-of-year figure. Therefore:

- `end(Y) = Σ YearResult[Y].stock` (the post-flows snapshot — this is the
  number 5C/5D wrongly labelled "start").
- `start(Y) = Σ YearResult[Y−1].stock` (end of the prior year). For the
  FIRST horizon year there is no prior `YearResult`, so `start` is the
  **uploaded initial-stock total** — `Σ` of the resolved `initial_stock`
  slot (`resolveSlot(systemState, 'initial_stock')`, the `"{cohort}|{age}"
  → count` dict), summed before any simulation flows. `null` → em-dash.

Invariant `start + net == end` (`net = Σ inflow − Σ outflow`) holds by
engine construction: at idx 0, `stock[0] = initial − Σoutflow + Σinflow`,
so `initialStockTotal + net[firstYear] == YearResult[firstYear].stock`
exactly. Reads as `start + Net change = end` next to the flow cards.

`yearStockStartEnd(years, selectedYear, initialStockTotal)` takes the whole
`years` array (needs the prior year), not a single `YearResult`. Do NOT
revert to `start = Σ stock` of the selected year — that's the END figure
(the 5C/5D bug).

**Patch 5D — relocation history.** 5C placed these in the Age-distribution
box header (`AgeDistributionStockFigures`); 5D moved them into the KPI card,
removed the redundant single "Total stock {year}" `SummaryCard`, renamed the
component → `StartEndStockCard` (SummaryCard chrome, 2×2 grid). 5E corrected
the data source + equalized the two figures' styling.

#### What NOT to do

- **Don't source `start` from `Σ YearResult.stock` / `summary.totalStock`.**
  That is the END-of-year snapshot (the 5C/5D bug). `start` is the prior
  year's snapshot, or the uploaded initial-stock total for the first year.
- **Don't compute `end` by reading the next year's record** (`stock[year+1]`).
  `end(Y) = Σ YearResult[Y].stock` directly — the final horizon year works
  with no "next year".
- **Don't crash (or show 0) when the first-year initial stock is absent.**
  Pass `null` and render an em-dash. Only the first year depends on the
  initial-stock slot; later years read the prior `YearResult`.
- **Don't make one figure visually dominant.** 5E equalizes them — same
  `valueStyle` object on both value nodes. The locked test asserts equal
  `fontSize`/`fontFamily`/`fontWeight`/`color`.
- **Don't re-add a standalone "Total stock {year}" card.** Its single
  number is now the End figure — showing both duplicates it.

### Cohort → Archetype mapping is one source of truth (Patch 5F)

The cohort → archetype mapping (DSM cohort+size → BOM archetype + scale)
is a **single source of truth owned by the DSM store** —
`dsmStore.cohortMappings: Record<cohortKey, {archetype_id, scaling_factor}>`,
fetched/saved via `fetchCohortMappings`/`saveCohortMappings` against
`/dsm/systems/{id}/cohort-mappings`. Every surface reads (and the one editor
writes) that slice:

- **DSM tab (canonical editor)** — `CohortMappingEditor` inside
  `CohortMappingDialog`. The ONLY editing surface. Reads the store live,
  debounced auto-save to the backend.
- **IA Static Background** (`DSMImpactPanel`) — **read-only** summary row
  ("Cohort → Archetype · N of M mapped" + "Edit in DSM →"). The count
  derives DIRECTLY from `cohortMappings` (no local snapshot).
- **IA Prospective Background** (`ProjectedImpactPanel`) — read-only,
  already store-direct.
- **Material Flows** and **IA compute** consume the same slice; the
  backend reads its persisted copy keyed by `mfa_system_id` (the
  `ImpactAssessmentRequest` / `dsm-lca` body carries **no** mapping
  payload), so compute can't run against a client-side stale copy.

The "N of M mapped" count derives from this slice **everywhere it appears**,
so the numbers are always identical. Locked by
`tests/cohortMappingSync.test.tsx` (propagation without remount, post-mount
subscription, no duplicate slice, compute keyed by system id).

**Patch 5F history.** Before 5F, `DSMImpactPanel` carried its own full
inline editor + a `draftMappings` local snapshot and derived the count from
the draft — so the IA count could disagree with the DSM editor (unsaved
draft, or divergence) and Static/Prospective could disagree with each other.
5F (per product decision: DSM-canonical, read-only IA) removed the inline
editor + draft buffer; IA now reads the store directly.

#### What NOT to do

- **Don't snapshot store-derived data (cohort mapping, system definition,
  etc.) into component-local `useState`/`useRef` at mount.** With the
  visibility-toggle mounting convention the component never remounts, so the
  snapshot goes stale when the source is edited from another surface.
  Subscribe to the store directly (the same root-cause family as Patch 4E).
- **Don't keep a second copy of the cohort mapping in the Impact Assessment
  tab** (or any consumer). One mapping in `dsmStore`, consumed downstream by
  Material Flows and Impact Assessment — never duplicated per consumer. The
  test asserts `impactStore` has no `cohortMappings` slice.
- **Don't re-add an editing surface to IA without a product decision.** IA
  is read-only by the 5F decision; editing is DSM-only via "Edit in DSM →".
  A second editor reintroduces the draft-vs-store divergence 5F removed.
- **Don't put the cohort mapping into the IA compute request body.** The
  backend resolves it from its persisted copy via `mfa_system_id`; sending a
  client snapshot would risk computing against stale data and is a backend
  data-shape change (out of scope).

### Header affordances must look actionable (Patch 5G)

Actionable header affordances must render with the shared `<Button>`
primitive (`components/ui/Button.tsx`), never plain text with a click
handler. The Impact Assessment header's **Method Library** action uses
`<Button variant="secondary">` (bordered, elevated bg, pointer cursor) —
evidently clickable yet visually subordinate to the filled
`variant="primary"` "Calculate" CTA. It's a single shared header serving
both Single-product and System-level views. Locked by
`tests/methodLibraryButton.test.tsx`.

Variant guide: `primary` = the one filled CTA per surface; `secondary` =
evident-but-subordinate supporting actions; `ghost` = transparent, for
in-context/low-emphasis controls where a border would be visual noise — NOT
for a top-level header action that should read as a button.

#### What NOT to do

- **Don't style a supporting header action as `ghost` (or bare text + click
  handler).** `ghost` has a transparent border, so it reads as plain text
  and users don't recognize it as clickable — the exact bug 5G fixed
  (Method Library was `variant="ghost"`).
- **Don't give a supporting action a filled/primary style on a page that
  already has a primary CTA.** Two filled buttons compete. Calculate is the
  filled CTA; Method Library (and peers) use `secondary` — evidently
  clickable, visually subordinate.
- **Don't hand-roll a bespoke button style.** Reuse the `<Button>` primitive
  so border/hover/focus/cursor and icon+label `gap` stay consistent app-wide;
  let the primitive's `gap` space the icon (don't re-add manual icon margins).

### Multi-item comparison page sections are collapsible (Patch 5H)

The three top-level sections of Single-product → **Multi-item comparison**
(`components/impact/MultiProductLCA.tsx`) — **Scope**, **Items to compare**,
**Results** — are each wrapped in the shared `<CollapsibleCard>` primitive
(the same one behind Configuration / Results / Stage Amounts). Wrapping, not
building: the card supplies the chrome + title + collapse, so each section's
own outer chrome/title was removed to avoid double-nesting.

- **Collapsed headers carry a live summary** read at render (never snapshotted
  at collapse time): Scope → `scope · method · N indicators` (selected
  family + selected count; the bare `<MethodPicker>` owns its selection
  internally, so the family's *total* "of M" isn't available to the parent
  without swapping the picker — out of scope, so we show the selected count);
  Items → `N selected`; Results → `N successful, M failed`.
- **Defaults**: Scope and Items expanded; Results expanded and **only
  rendered post-compute** (when `multiResult` exists) — the card appears with
  the results.
- **Collapse is `useState`, session-local, no persistence.** It survives the
  Single item / Multi-item sub-tab switch because that sub-tab is
  visibility-toggled (the pane never unmounts).
- **No auto-collapse-on-compute** — collapsing is user-only (predictable over
  clever).
- The Items DB picker sits in the card's `actions` slot (the slot
  stop-propagates clicks so it doesn't toggle the card).
- Locked by `tests/multiProductCollapsibleSections.test.tsx`.

**Structural alignment to the Single item tab (Patch 5Q).** Multi-item now
mirrors Single item's **selection-first** flow. Section order:
**Items to compare → Stage amounts → Configuration → Compute → Results**
(was Scope/config-first). The config card is titled **"Configuration"** (was
"Scope"), and the scope-stage buttons + the collapsed-summary use the Single
item tab's wording/casing — **Full Lifecycle / Manufacturing / Operation /
End of Life** (same underlying `all/inflows/stock/outflows` map; cosmetic
only, also the app-wide convention incl. System-level). This is alignment **by
analogy** (the N-item nature is preserved): the `<MultiItemSelector>`
(multi-select) sits at the top mirroring single-item's Archetype picker — NOT
replaced by a single dropdown; the per-item stage editors (5I) mirror
single-item's single STAGE AMOUNTS section. All existing multi-item
functionality is preserved (per-item stage amounts 5I, look-alike
discriminating rows 5M, scenario-visibility 5O, exports). Locked by
`tests/multiProductStructureAlignment.test.tsx`.

**Known functional differences (flagged, deliberately NOT built in 5Q — would
be new compute features, not layout):**
- **No background-tab layer — but prospective IS reachable via per-item
  vintages (Patch 5R, below).** Multi-item has no Static/Prospective/Comparison
  tab triplet; instead, *activity* mode lets each item carry its own database
  vintage (ecoinvent + premise SSP×year). That fills the prospective gap in a
  per-item-vintage flavor — see "Within-type multi-item comparison + per-item
  vintages". A year-matched Δ-comparison tab layer remains unbuilt (separate
  decision).
- **No sensitivity-cases control.** Single item's config exposes multi-parameter
  sensitivity cases; multi-item has none in the UI (the per-item
  `parameter_scenario` field exists in the wire schema but is unexposed). Adding
  it is functional.

#### What NOT to do (alignment)

- **Multi-item is N-item — align it to single-item's structure by analogy,
  never by forcing single-select shapes onto it.** The `<MultiItemSelector>` at
  the top mirrors the single Archetype picker; the per-item stage editors mirror
  the single STAGE AMOUNTS section. Don't replace the multi-select selector with
  a single-archetype dropdown, and don't collapse the per-item editors into one.
- **Don't build multi-item prospective/comparison compute or sensitivity cases
  under the banner of "structural alignment."** Those are flagged functional
  gaps requiring an explicit decision — layout reshuffles must not silently grow
  new compute.

### Within-type multi-item comparison + per-item vintages (Patch 5R)

Multi-item comparison is **within-type**: a comparison is of ONE type —
archetypes OR activities, never mixed. A **mode toggle** (Archetypes |
Activities) in `MultiProductLCA.tsx` drives the shared `<MultiItemSelector>`'s
`mode` prop (`'archetype'` / `'activity'`, both pre-existing); switching mode
clears `selectedItems` so cross-type items can't linger. (The old `mode="mixed"`
is retired here — `<MultiItemSelector>` still supports `'mixed'` for other
contexts, but multi-item comparison never uses it.)

**Activity mode = per-item-vintage model.** An activity can be added at several
**vintages** — base ecoinvent (static) and/or premise SSP×year databases —
**each a distinct comparison item computed against its own database**. Picking
an activity opens `<ActivityVintagePicker>` (ecoinvent + the installed premise
vintages for that base_db); each checked vintage appends one
`ActivityProductItem` whose `database` IS the vintage's DB name, labeled
`<reference product> [<vintage>]` (e.g. `electricity, low voltage [SSP1 2040]`).
`productItemKey` is `act:{database}|{code}` → unique per vintage → distinct
item, distinct stable color.

**This fills the previously-flagged Gap A (prospective compute) in a
per-item-vintage flavor — NOT a background-tab layer.** There is no
Static/Prospective/Comparison tab triplet; prospective enters as per-item
database selection.

**Database selector is Activities-mode-only (Patch 5V).** The "Items to compare"
header database dropdown (`multi-product-database-select`) renders only when
`compareMode === 'activity'`. It scopes the activity search (`useActivityStore`)
and is the base_db for the vintage picker — neither applies to archetypes.
Archetype compute does NOT read `selectedDatabase`: `handleCompute` sends only
`{scope, methods}`, so `compute_database` is null and each archetype resolves
against its BOM's base ecoinvent links. `selectedDatabase` is store-backed
(`useActivityStore`), so the Activities selection survives Archetypes↔Activities
switches. Locked by `tests/multiProductDatabaseSelector.test.tsx`.

**Lifecycle SCOPE is Archetypes-only (Patch 5X).** The CONFIGURATION SCOPE
selector (Full Lifecycle / Manufacturing / Operation / End of Life) renders only
when `compareMode === 'archetype'`. Activities are single ecoinvent processes
with no lifecycle stages — the backend ignores scope for them
(`ActivityLCARequest = {activities, methods}` has no scope field;
`calculate_activity_lca` never reads it; the activity branch of
`calculate_multi_product_lca` builds the request WITHOUT `body.scope`). So
activities lock to **Full Lifecycle** via `scopeForMode(mode, scope)` (returns
`'all'` for activities) — the payload rule that keeps a leftover non-`'all'`
archetype scope from leaking into an activity run, leaving the payload/result
identical to today's default. The CONFIGURATION collapsed summary omits the
scope token in Activities (methods only). Extends the 5V/5W mode-scoping family.
Locked by `tests/multiProductActivityScope.test.tsx`.

**Backend per-item DB is the EXISTING contract — not new compute.** The
activity branch of `calculate_multi_product_lca` (lca.py) already builds an
`ActivityLCARequest` keyed by `item.database` and calls `calculate_activity_lca`,
which resolves the activity in that DB via `bw2data.get_activity((database,
code))` and runs the LCA against THAT vintage's technosphere. Premise preserves
codes (the same invariant `_translate_demand_to_database` relies on), so one
picked activity resolves in every vintage by code. The only backend lift in 5R
was a vintage-aware result `label` (composed from `ActivityProductItem.vintage_label`)
so two vintages of one activity don't collide on a chart axis. Per-vintage
results reflect each DB's intrinsic intensity — e.g. SSP1 > SSP5 for the DK grid
(the audited premise/REMIND ordering from the Patch 5P diagnostic), locked by
`tests/test_multi_product_activity_vintage.py`.

**Vintage resolution is Design A (frontend-resolves).** The concrete premise DB
name comes from `usePLCAStore.databases` (`ProspectiveDB[]` — the same registry
`_resolve_prospective_dbs` reads). The frontend picks the DB name and sets it as
the item's `database`; the backend's existing per-item-DB passthrough computes
against it. We do NOT reimplement prospective resolution and do NOT call
`_resolve_prospective_dbs` per item — the registry is the single source of truth
on both sides.

**Separate-mode vintages only (v1).** Only per-year **separate**-mode premise
DBs (concrete `year`, own `name`) are offerable — the entire prospective compute
pipeline targets only these (`_resolve_prospective_dbs` rejects superstructure's
`year: null`, and no SDF/presamples year-slice activation engine exists).
Superstructure DBs are listed **disabled** in the picker with a tooltip
("generate separate-mode for per-year comparison"). Computing a year-slice from
a superstructure DB would silently use one ambiguous stored scenario — deferred
until a year-slice activation engine is built (a separate, methodology-adjacent
effort).

**Grouped scenario template + shared `<ScenarioYearPicker>` (Patch 5Z).** The
picker mirrors the single-item Prospective Background "LCI scenarios" picker:
premise vintages are **grouped by the FULL scenario (model · ssp-budget)**
(label `${iam} · ${ssp}`, e.g. "remind · SSP1-PkBudg1150"; `ssp` carries the
budget so this is model · ssp-budget, never SSP alone), each group with per-group
**ALL YEARS / CLEAR** controls and year checkboxes. The **"ecoinvent (static)"**
option stays **ungrouped above** the groups and toggles independently; the
Cancel / "Add N to comparison" footer is unchanged. The grouping + controls are
**display-only** — they drive the same `checked` set and `buildItems()` mapping
as the old flat list (the per-item DB / coords are untouched). Superstructure DBs
join their scenario group as **disabled** year-entries. The grouped UI is the
shared presentational `<ScenarioYearPicker>` (`components/impact/ScenarioYearPicker.tsx`),
extracted from the single-item picker and reused by BOTH (single-item →
prospective DBs via `selectedDbs`/`toggleDb`/`setTrajectoryDbs`; multi-item →
the `checked` vintage set). The component is selection-AGNOSTIC (no state); each
parent owns its selection + handlers + testids — the two parents stay separate,
sharing only the picker. The single-item refactor is behavior-preserving (its
testids + Prospective flow unchanged). Locked by `tests/scenarioYearPicker.test.tsx`
(component) + `tests/activityVintagePickerGrouped.test.tsx` (multi-item grouped).

**Per-item color stability.** The comparison chart's solid mode (activity
vintages / stage-less archetypes) colors each bar by a STABLE per-item color via
`useChartColors(itemLabels, 'multi-product')` + `colorFor`, keyed by item label
— removing/reordering an item never recolors the survivors. (Stacked/archetype
mode keeps the per-STAGE positional palette — that's a different axis.) Locked by
`tests/multiProductActivityVintage.test.tsx` + `tests/multiProductComparisonChart.test.tsx`.

**Export-vintage provenance (mirrors stage-amounts 5J/5K+).** The export records
each activity item's vintage on a **"Vintages" sheet** (`# · Item · Vintage ·
Database · Base database · IAM · SSP · Year`), threaded via
`MultiProductExportRequest.activity_vintage_meta` (keyed by item_id
`{database}|{code}`, the `ActivityVintageMeta` shape). Emitted only when ≥1
activity item; falls back to deriving the DB from item_id when no meta is
supplied (older clients). Built by `_build_multi_product_workbook` in `impact.py`
(a sheet, not a conditional on existing sheets). Locked by
`tests/test_multi_product_vintage_export.py`.

#### What NOT to do

- **Activity vintages are per-item database selection, not a global background
  mode.** Each activity × vintage is an independent comparison item with its own
  DB; reuse `_resolve_prospective_dbs` (via the registry the frontend reads),
  don't reimplement prospective resolution. There is no "set the prospective
  background for the whole comparison" toggle — the vintage is per item.
- **The vintage picker groups by the full scenario (model · ssp-budget),
  matching single-item — never group by SSP alone (it collapses pkbudg1150 vs
  base); the grouping and ALL YEARS/CLEAR controls are display-only and must not
  change the checked-vintage → comparison-item mapping.** (Patch 5Z: grouping
  uses the structured `(base_db, iam, ssp)` coords, not string-parsing; the
  shared `<ScenarioYearPicker>` is selection-agnostic — changing it must keep
  both single-item and multi-item behavior-preserving.)
- **The multi-item database selector belongs to Activities mode only and must
  not render in Archetypes mode — but never remove it without first confirming
  the archetype compute path does not read selectedDatabase as its background.**
  (Patch 5V confirmed: `handleCompute` sends only `{scope, methods}` →
  `compute_database` null → archetypes resolve against their BOM's base
  ecoinvent links. The dropdown is vestigial search-scope in Archetypes mode.)
- **Lifecycle scope (and stages) apply to archetypes only — the SCOPE selector
  must not render in Activities mode, and activities compute against Full
  Lifecycle; never remove the selector without confirming activity compute
  doesn't depend on a non-Full scope.** (Patch 5X confirmed:
  `ActivityLCARequest` has no scope field and `calculate_activity_lca` never
  reads scope, so it's a no-op for activities; `scopeForMode` locks them to
  `'all'`.)
- **Don't offer superstructure vintages for compute.** `_resolve_prospective_dbs`
  rejects `year: null`; there's no year-slice activation. Naming a superstructure
  DB directly computes one ambiguous stored scenario, not the requested year.
  List them disabled; defer until an activation engine exists.
- **Don't mix archetypes and activities in one comparison.** Within-type is the
  contract; the mode toggle enforces it (switching clears the selection). Mixed
  comparison was the pre-5R `mode="mixed"` and is retired here.
- **Don't reintroduce positional `CHART_PALETTE[idx]` coloring for solid-mode
  items.** Per-item color must be stable (keyed by `item_id` via the shared
  resolution — Patch 5S moved the key off the label so display-shortening can't
  recolor) so a removed/reordered item doesn't recolor its neighbours — the
  whole point for comparing N vintages over time.
- **Don't make the backend echo a bare reference-product label for activity
  items when a vintage is set.** Two vintages of one activity would collide on
  the chart axis. The label is composed `<reference product> [<vintage_label>]`;
  the `vintage_label` is frontend-owned (the DB IS the per-item selection).

### Multi-item comparison UX — Bar|Line toggle, label cleanup, grouped panel, live timer (Patch 5S)

Frontend-only polish on the Patch 5R multi-item comparison. No backend/schema
change; the compute payload + export provenance are untouched.

**Bar | Line chart-type toggle (Chart view only).** A segmented control in the
results toolbar (next to the method dropdown + view toggle) switches the chart
between Bar (`MultiProductComparisonChart`) and Line (`MultiProductLineChart`).
Table view is unaffected. State is `ResultsSection`-local.

**Line view = per-scenario over years (NOT per-item).** `MultiProductLineChart`
is a thin sibling — it does NOT reuse `MultiScenarioImpactChart` (consumes
cohort-aware `ImpactAssessmentResult`) or `ProjectedTimeSeriesChart` (its runs
carry `ArchetypeLCAResult` + it lives in the single-item tab). It reuses the
shared primitives (`SCENARIO_PALETTE`, `ChartExportButton`/`Container`,
native-SVG legend, `NumberFormatControl`, 5O-style clickable per-series
visibility) — not a duplicated charting stack. The pure `buildVintageLineModel`
groups items into one series per **(base_database + iam + ssp)** scenario and
plots the selected method's score by **year**, reading the **structured vintage
coords** (Patch 5R `ActivityVintageMeta`, joined to result items by `item_id`)
— never by string-parsing the label. So 18 vintage items → 3 SSP series. Series
colored by ORIGINAL sorted index (stable under hide/show). Sparse years →
`connectNulls={false}` (gaps, no interpolation). The **static (ecoinvent)
vintage** (no ssp/year) renders as a labeled horizontal `<ReferenceLine>`, not a
series.

**Line gating (DATA-driven from the DISPLAYED results — 5S follow-up fix).**
The Line toggle is enabled only when the **charted results** yield a usable year
axis — ≥2 distinct years across premise vintages (`ssp` + `year` present).
Derived from the results being charted, **never from the live selection or
compareMode**: results can outlive a mode switch (the selection clears per 5R)
and not every Activities-mode result is line-able (multi-distinct-activity has
no year axis). The year-axis coords come from `multiVintageCoords` — a
**compute-time snapshot** in `useMultiProductLCAStore`, keyed by item_id and
results-aligned (NOT the live `selectedItems`-derived map, whose original
coupling disabled Line on valid line-able results once the selection changed).
The same snapshot feeds the Line chart's `vintageCoords` and the export
provenance. Otherwise disabled with tooltip *"Line view needs vintages across
multiple years"*; Bar always available. `effectiveChartType` never renders Line
when disabled. **State hygiene**: `switchMode` clears the results
(`clearResults()` → `multiResult` + `multiVintageCoords` null) alongside the
selection, so a stale cross-mode chart can't linger after a mode switch.

**Common-prefix label cleanup (display-only).** `shortenByCommonPrefix`
(`utils/labelPrefix.ts`) strips the shared activity prefix so bars/legend show
only the differing vintage (e.g. "SSP1-PkBudg1150 2025"), with the shared
activity ("electricity, low voltage") shown once as a chart subtitle. Trims the
LCP to a clean token boundary (last space / `[`) and degrades to full labels
when there's no usable common prefix (multi-distinct-activity, archetype names).
**Provenance is never shortened** — the export's Vintages sheet (5R) reads
structured `activity_vintage_meta`, not display strings.

**Selected-panel grouping (Part B).** `MultiItemSelector` gained an OPTIONAL
`renderSelectedItems?: ReactNode` display override (absent → unchanged default
`<SelectedChip>` list, so archetype mode + LCA Calculator are untouched).
Activities mode passes `<GroupedVintagePanel>`: vintages of one activity (same
`code`) render under ONE header (ref product · location · unit · code shown
once) with compact removable vintage chips beneath. **Display-only** — selection
state, item identity, per-item removal (still `onRemoveItem`), and the compute
payload are all unchanged.

**Live compute timer (Part C).** The post-run time is backend-returned
(`result.elapsed_seconds`); there's no client start timestamp. The live timer
reuses the existing `useElapsedSeconds(active)` hook (1s cadence, same as the
single-product panels) keyed on `multiLoading` — the button shows
"Computing… {n}s", and the precise final value still comes from the backend on
the Results card. The hook clears its interval on completion (active→false) AND
on unmount (effect cleanup).

#### What NOT to do

- **Line availability is derived from the displayed results' year axis (≥2
  distinct years across scenarios) — never from the live selection or
  compareMode; keying it to the selection disables Line on valid line-able
  results once the selection changes, and keying it to the mode disables it on
  stale-but-line-able results and wrongly enables it for multi-distinct-activity
  comparisons.** The gate reads the compute-time `multiVintageCoords` snapshot
  (results-aligned), not the live `selectedItems`. Results also clear on a mode
  switch so a stale cross-mode chart can't linger.
- **Line view is per-scenario over years, not per-item — group by
  (base+IAM+SSP+budget) and plot by year; don't string-parse the label if
  structured coordinates exist.** The coords are snapshotted into
  `multiVintageCoords` at compute time (from the run's `ActivityProductItem`s,
  Patch 5R), joined to result items by `item_id` (`{database}|{code}`).
  String-parsing the composed label is brittle and unnecessary.
- **Display-shorten labels via common-prefix stripping; never drop provenance
  from the export.** Shortening is display-only; the Vintages sheet always
  records the full structured database/SSP/year.
- **Clear the compute-timer interval on completion AND unmount.** Reuse
  `useElapsedSeconds` (it does both via effect cleanup); don't hand-roll a
  `setInterval` without a cleanup path.
- **Don't reuse `MultiScenarioImpactChart` or generalize
  `ProjectedTimeSeriesChart` for the Line view.** The former consumes
  cohort-aware `ImpactAssessmentResult`; the latter carries `ArchetypeLCAResult`
  and lives in the single-item tab (out of scope). The thin sibling reuses
  shared primitives without a duplicated stack.
- **Don't make the grouped panel anything but display-only.** It's rendered via
  the selector's `renderSelectedItems` seam; it must not own selection/removal
  logic beyond calling the parent's `onRemove`, and must never alter the compute
  payload. Archetype mode must keep the default chip list (don't pass the
  override there).
- **Don't key Line series color or Bar item color by the (shortenable) display
  label.** Bar keys by `item_id`; Line keys by original scenario index. Keying
  by a label that common-prefix-stripping can change would recolor series when
  the selection changes.

**LCA Architect → Single-product LCA gets the same treatment (Patch 5N).**
`pages/LCACalculator.tsx` wraps its **Configuration** (the setup form: FU
archetype/activity selection + scope + method + indicators + database/year +
Calculate buttons) and its **Results** sections in the shared
`<CollapsibleCard>`. Configuration's collapsed summary is
`database · method · N indicators` (live: `computeDatabase` || "base
ecoinvent", `selectedMethods[0]?.[0]`, `selectedMethods.length`); Results'
is `item · N indicators · elapsed` (per mode — activity: `actDemand[0]`
name / `actResult`; archetype: `arcResult.archetype_name` or `N archetypes`
when multi). Configuration expanded by default; Results only renders
**post-compute** (gated on `actResult`/`arcResult`), expanded. There are two
Results branches (`fuMode === 'activity'` and `'archetype'`) — each wraps its
own results-present block; loading/error states stay outside the card.
`configOpen`/`resultsOpen` are session-local `useState`. Existing testids
preserved; `data-testid="lca-config-body"` added. Locked by
`tests/lcaCalculatorSections.test.tsx`.

**"New Calculation" is a secondary button (Patch 5G/5N).** In
`LCACalculator`, the header "New Calculation" affordance is a start-over/reset
(`handleReset` clears all results), so it uses `<Button variant="secondary">`
— evidently clickable but subordinate to the filled primary "Calculate" CTA
(per the 5G convention). Not `primary` (it's not the compute trigger), not
`ghost`/bare text. `data-testid="lca-new-calculation"`.

#### What NOT to do

- **Don't conditionally unmount a section body on collapse.** Use the
  collapsible's visibility-toggle (`display: none`, body stays mounted) so
  item selection, search text, scroll, and chart/table state survive
  collapse/expand — same reason tabs don't unmount.
- **Collapsed-header summaries must read from the live source at render**,
  never a value captured when the section collapsed — or the summary goes
  stale (cf. the cohort-mapping single-source fix, Patch 5F). The regression
  test mutates the store *while collapsed* and asserts the header updates.
- **Don't reach for the lighter popup-menu collapse** (Advanced, Patch 4L)
  for page sections — that's for menus. `<CollapsibleCard>` is the right
  primitive for big content blocks; don't swap them.
- **Don't over-nest** — three top-level collapsibles only. Don't make
  Indicator Selection independently collapsible *inside* the now-collapsible
  Scope card.
- **Don't auto-collapse Scope/Items when compute finishes.** Deliberate
  non-feature.

### Stage amounts are a shared capability — Single item + Multi-item (Patch 5I)

Stage amounts (preset 1 year / Lifetime (Nyr) / Custom; ANNUAL stages scale
by the year count, one-time stages stay at 1) are a **shared capability**
across Single item and Multi-item comparison:

- **Frontend component**: one `<StageAmountsEditor>`
  (`components/impact/StageAmountsEditor.tsx`) serves both. The preset→amounts
  math (`stageAmountsForPreset`), the collapsed summary
  (`stageAmountsSummary` / `abbreviateStage` / `formatStageAmount`), and
  `defaultStageAmounts` are all exported from that file. Single item and
  Multi-item import them — there is no second copy (these were extracted from
  `SingleProductImpact.tsx` in 5I; the Single-item behavior is unchanged).
- **Backend application**: one function — `calculate_archetype_lca`
  (`mapper/api/lca.py`) applies `stage_amounts` inline (each stage's material
  quantities × that stage's amount). The multi-product handler
  (`calculate_multi_product_lca`) dispatches each `ArchetypeProductItem` to
  `calculate_archetype_lca` with that item's `stage_amounts` — the SAME
  function. The ANNUAL-vs-one-time distinction lives in the `stage_amounts`
  dict the frontend computes; the backend multiplies uniformly. **No backend
  change was needed in 5I** — the field + passthrough already existed
  (`ArchetypeProductItem.stage_amounts`, `MultiProductRequestItem`).

**Multi-item model**: per-item amounts keyed by `productItemKey` in
`useMultiProductLCAStore.stageAmountsByItem` (reusing `ArchetypeStageAmounts`
per entry). A **global preset** (in `MultiProductLCA`) sets the default for
all items (apply-to-all overwrites every entry); new items **seed** from the
current global preset, removed items are **pruned** — reconciled against the
live selection by a `useEffect`, never a parallel copy of `selectedItems`.
At compute, each entry's `amounts` is injected into the wire item's
`stage_amounts` (in `toWireItem`). Per-item editors render as collapsible
cards (default collapsed; summary line carries the values), one per archetype
item, after selection. Activities have no stages → no editor. Default global
preset is `1year` (all stages = 1 ≡ no per-item amounts), so existing
default multi-item results don't shift. Locked by
`tests/multiProductStageAmounts.test.tsx` (frontend) +
`tests/test_multi_product_stage_amounts.py` (backend scaling + single-vs-
one-item-multi parity + default backward-compat).

**Per-item card treatment — elevated + numbered (Patch 5W)**: the per-item
STAGE AMOUNTS cards use an OPT-IN `<CollapsibleCard variant="item">` that sits
on the **elevated** surface (`var(--bg-elevated)`, one step up the surface
scale) so selected items stand out from the structural cards (ITEMS TO COMPARE
/ CONFIGURATION / Results), which stay on the base `var(--bg-surface)`. Each
per-item card carries a leading **1-based number badge** (`<ItemNumberBadge>`,
muted `--mod-lca` accent) via CollapsibleCard's new optional `leading` slot —
indexed by display order over the renderable items, so it re-sequences on
add/remove (remove the first of two → the remaining card shows "1"). Both new
CollapsibleCard props (`variant`, `leading`) default to the current look, so
every other consumer (structural cards, single-item view) is unchanged.
Display-only — no change to selection, stage-amounts values, collapse, or the
compute payload. Locked by `tests/collapsibleCardVariant.test.tsx` (component
contract) + `tests/multiProductItemCards.test.tsx` (variant token + badge text
+ re-sequence + structural-stays-base).

#### What NOT to do

- **The elevated + numbered treatment is an opt-in CollapsibleCard variant for
  per-item cards only — never lighten the shared card globally, or the
  hierarchy with ITEMS TO COMPARE / CONFIGURATION is lost.** `variant` defaults
  to `'default'` (base surface); only the per-item loop passes `variant="item"`.
- **Don't hardcode the lighter surface** — it's the `var(--bg-elevated)` token
  (one step up the surface scale), not a hex.
- **The number badge is display order, 1-based, re-sequenced on add/remove** —
  derive it from the rendered/filtered item list's index, not a stored field;
  it must track selection order/count (reinforcing "N selected" / "Compute (N
  items)").

**Export note**: multi-item Excel export does not yet record the per-item
stage amounts used. Deferred follow-up (the export builder would add an
amounts column/sheet); flagged, not done in 5I.

#### What NOT to do

- **Don't fork the stage-amount calculation for multi-item.** Both Single
  item and Multi-item compute MUST call the same server-side
  `calculate_archetype_lca`, so an equivalent configuration produces identical
  results. The parity test asserts single vs one-item-multi are byte-equal.
- **Don't reimplement the preset math or summary line in the multi-item
  component.** Import `stageAmountsForPreset` / `stageAmountsSummary` from
  `StageAmountsEditor`. Two copies drift.
- **Key per-item state by item id and reconcile against the live
  selection** — seed on add, prune on remove. Don't maintain a parallel copy
  of the selected-items list (it drifts); the `stageAmountsByItem` map is
  reconciled by an effect with an only-set-if-changed guard.
- **Don't change the default global preset away from `1year`** without
  re-checking the backward-compat test — a different default would shift
  existing default multi-item results.

### Multi-item export records per-item stage amounts (Patch 5J)

The Multi-item comparison export (`_build_multi_product_workbook` in
`mapper/api/impact.py`) records per-item stage amounts in a dedicated
**"Stage amounts" sheet** (columns `#·Item·Preset·Lifetime (yr)·<per-stage
columns>`) so a run is reproducible from the export alone. Emitted whenever
≥1 archetype item is present (activities have no stages → skipped); placed
after Configuration (sheets are accessed by name, so order is non-load-
bearing — additive, existing sheets unchanged).

**Why frontend + backend**: the compute result echoes only the resolved
per-stage `amounts` map (`ArchetypeLCACalculateResult.stage_amounts`).
`preset` ('1year'/'lifetime'/'custom') and `lifetime` are frontend-only
concepts, so they're threaded through the export request as
`MultiProductExportRequest.stage_amounts_meta: dict[item_id,
StageAmountsMeta{preset, lifetime, amounts}]` (the frontend builds it from
`useMultiProductLCAStore.stageAmountsByItem`, keyed by `archetype_id` =
`item_id`). The builder reads preset/lifetime from the meta and the per-stage
amounts from the meta — **falling back** to the result-echoed
`stage_amounts` (preset/lifetime → "—") when no meta is supplied (older
clients), so it degrades gracefully. Locked by
`tests/test_multi_product_stage_amounts_export.py` (backend) +
`tests/multiProductStageAmounts.test.tsx` (frontend: request carries the meta).

**Single-item parity (Patch 5K+, closes the 5J divergence)**: the single-item
export builders (`_build_single_product_{static,prospective,comparison}_workbook`)
now ALSO record preset + lifetime, alongside the existing per-stage amounts
one-liner, in the **Configuration block** (single archetype → fields, not a
separate sheet). Both export paths reuse the shared `StageAmountsMeta{preset,
lifetime, amounts}` and use the same labels (`Preset`, `Lifetime (yr)`):
multi-item in the "Stage amounts" sheet, single-item in the Configuration
block. Single-item threads a **single** `StageAmountsMeta` (not a dict) on
each `SingleProduct*ExportRequest`, sourced from
`useSingleProductImpactStore.stageAmountsByArc[archetypeId]`; per-stage
amounts still come from the result echo. Same backward-compat fallback as
5J (no meta → preset/lifetime "—", amounts still shown). Locked by
`tests/test_impact_single_product_export_stage_meta.py` (backend) +
`tests/singleProductExportButtons.test.tsx` (frontend threads the store meta).

#### What NOT to do

- **Don't export computed impact figures without the parameters that
  produced them** (stage amounts, and more broadly scenario / method /
  scope). Exported research outputs must be reconstructable from the export
  itself — the numbers PLUS the assumptions, not the numbers alone.
- **Don't let single-item and multi-item exports diverge in what
  provenance they record.** Both capture preset + lifetime + per-stage
  amounts via the shared `StageAmountsMeta`; a new field added to one path's
  provenance must be added to the other (and to the type). 5K+ closed the
  5J gap — don't reopen it.
- **Don't derive preset/lifetime from the resolved amounts.** They're
  ambiguous (all-ones could be '1year' or 'custom'; annual=15 could be
  lifetime-15 or custom). Thread them from the frontend store via
  `stage_amounts_meta`; fall back to "—" when absent, never guess.
- **Don't key `stage_amounts_meta` by `productItemKey`** (`arc:{id}`) — the
  workbook identifies archetype items by `item_id` (= `archetype_id`). The
  frontend converts the store's productItemKey-keyed map to archetype_id
  keys when building the export request.
- **Don't make the "Stage amounts" sheet replace or reorder existing
  sheets.** It's additive; existing tests assert sheets by name. Keep
  Configuration / Comparison (wide|long) / SB_* / Errors exactly as they are.

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
