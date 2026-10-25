---
name: mapper-ui-conventions
description: "MApper frontend UI conventions: tabs and pages, modals, scroll, collapsibles, comparison pages, DSM dashboard, exports UI. Use when building or changing frontend pages, components or UI patterns."
---

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
