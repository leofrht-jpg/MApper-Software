# CO₂ → CO₂e (Kyoto-gases) conversion data

**Status: the derivation sets are REPRODUCED and ship in full; the underlying
budget data remains provisional.** These files are the sourced inputs for the
AESA carbon-budget `budget_basis = "CO2e_GHG"` path
(`CarbonBudgetConfig.co2e_conversion`). A per-budget `RatioCO2eConversion`
factor IS computed in `build_carbon_budget` and the basis is user-selectable
(default CO₂-eq). **See "WIRED per-budget factors" at the bottom for the live
factors + arithmetic.**

Both derivation sets are now verifiable from the bundled CSVs: the 343-row
regression set (`ar6_2c_analog_pairs.csv`) regresses to the published
coefficients, and the 427-row offset set (`ar6_c34_offset_2020_2024.csv`) has
**C** as the median of a column. What remains provisional is
`carbon_budgets.json` (AR6 WG1 values + the −200 GtCO₂ deduction), a separate
AR6/GCB question. The 1.5 °C affine is fully cited (Tilsted & Bjørn 2023,
doi:10.1007/s10584-023-03583-4); see "Pull dates" for the two extractions and
the reproduction evidence.

## The 1.5 °C leg — precedent, and the refit

### Methodological precedent (not the coefficients in use)

**Tilsted, J. P. & Bjørn, A. (2023).** *Green frontrunner or indebted culprit?
Assessing Denmark's climate targets in light of fair contributions under the
Paris Agreement.* **Climatic Change 176:103.**
<https://doi.org/10.1007/s10584-023-03583-4>

Their §2 regresses a CO₂ budget `x` (GtCO₂) onto the corresponding CO₂e budget
`y`, giving **y = 1.1614·x + 157.27** over **80** scenarios labelled "Below
1.5 °C", "1.5 °C low overshoot" or "1.5 °C high overshoot" from the **IAMC
1.5 °C Scenario Explorer** (Huppmann et al. 2019), cumulative **2020 →
net-zero CO₂**, **R = 0.80**, domain **x ∈ [223, 427] GtCO₂**, following
**Meinshausen et al. (2018; 2019)**. Those parameters are kept in the code as
`TILSTED_BJORN_2023_PUBLISHED` for comparison; **they are not used to compute a
factor.**

### What MApper uses: the same approach, refitted over AR6 C1+C2

| | 1.5 °C (AR6 **C1+C2**) | 2 °C (AR6 **C3+C4**) |
|---|---|---|
| slope m | **1.3142** | 1.2935 |
| intercept b | **149.1242** | 218.41 |
| R | **0.9565** | 0.9444 |
| regression N | **214** (C1 91, C2 123) | 343 (C3 232, C4 111) |
| domain | **[196.3, 1036.2]** | [292.9, 1568.2] |
| **offset C** | **250.665 GtCO₂e** (N=217) | 257.449 → 257.4 (N=427) |
| files | `ar6_c1c2_pairs.csv`, `ar6_c1c2_offset_2020_2024.csv` | `ar6_2c_analog_pairs.csv`, `ar6_c34_offset_2020_2024.csv` |

Both legs now do the same thing: **one method — Meinshausen et al. (2018; 2019)
as applied by Tilsted & Bjørn (2023) — refitted over the AR6 category that
matches the temperature target**, with the affine and the 2020–2024 offset drawn
from the *same* scenario set. Tilsted & Bjørn are the precedent, not a
coefficient supplier.

### This is a deliberate methodological choice, not a correction

Nothing was wrong with Tilsted & Bjørn's numbers. Four grounds for refitting:

1. **Symmetry.** The 2 °C leg was already an AR6 refit. Leaving 1.5 °C on a
   published SR15-era fit meant the two targets were derived differently.
2. **AR6 vs SR15.** Their fit predates AR6; the IAMC 1.5 °C Scenario Explorer
   (Huppmann et al. 2019) is a different database and vintage from the AR6
   Scenario Database used here.
3. **Fit quality.** R = **0.9565** over 214 scenarios versus **0.80** over 80.
4. **Domain.** `IPCC_AR6_1p5C_50` enters at x₂₀ = 500, **outside** their
   published [223, 427]. It sits **inside** [196.3, 1036.2] — at the 17th
   percentile of the fitted scenarios (37/214 fall below 500). The refit
   removes the out-of-domain problem instead of arguing around it.

Comparison at the same x — the refit implies a **larger** CO₂e budget throughout:

| x₂₀ | Tilsted & Bjørn y₂₀ | C1+C2 y₂₀ | Δ |
|---|---|---|---|
| 223 | 416.3 | 442.2 | **+6.2 %** |
| 300 | 505.7 | 543.4 | +7.5 % |
| 427 | 653.2 | 710.3 | +8.7 % |
| 500 | 738.0 | 806.2 | **+9.3 %** |

**Direction of the effect: the 1.5 °C factors rise ~16 %, so the 1.5 °C
climate-change Sustainability Ratios FALL by ~14 %.**

| budget | f before | f after | Δf | climate SR |
|---|---|---|---|---|
| 1.5 °C / 50 | 1.6019 | **1.8519** | +15.60 % | **−13.50 %** |
| 1.5 °C / 67 | 1.8222 | **2.1207** | +16.38 % | **−14.08 %** |

### What drove it: the database, not the offset mismatch

The refit fixes two things at once, but they are not equal in size:

| contribution | 1.5 °C / 50 | 1.5 °C / 67 |
|---|---|---|
| **affine** (SR15 → AR6 C1+C2) | **+14.20 %** | **+14.54 %** |
| **offset** (C3+C4 → C1+C2) | +1.23 % | +1.61 % |
| total | +15.60 % | +16.38 % |

So the offset mismatch — pairing a sub-1.5 °C affine with a 2 °C ensemble's
2020–2024 median — was real and is now fixed, but it accounts for only about a
tenth of the change. **The refit's primary justification is the SR15 → AR6
database change.** That matters for how it is described: this is a
re-derivation on newer data, not a bug fix.

### MApper's default is unaffected

The shipped default budget is **2 °C / 50th percentile** (`IPCC_AR6_2C_50`,
1150 Gt from 2025), whose factor **f = 1.484552 is unchanged**, as is
`IPCC_AR6_2C_67` at 1.524774. This refit moves the 1.5 °C targets only. A user
who has never changed the budget sees no difference.

### Procedural asymmetry between the two legs — stated, not hidden

The two pairs files were produced by **different code**, and the original was
not kept:

- `ar6_2c_analog_pairs.csv` (June 2026) came from a script that no longer
  exists — only its outputs survive.
- `ar6_c1c2_pairs.csv` (August 2026) came from the current re-derivation code.

Run on C3+C4, the current code yields **m = 1.2942, b = 218.0024** against the
shipped **1.2935 / 218.41** — **+0.05 % / −0.19 %**, worth about **0.03 % on
f**. So the C1+C2 coefficients carry that same ~0.1 % procedural signature
relative to whatever produced the C3+C4 ones.

This is tolerable because **each shipped CSV refits its own published
coefficients exactly** (asserted by `test_each_fit_refits_from_its_own_shipped_rows`):
both legs are independently reproducible from the rows that ship, whichever code
wrote them. Unifying the implementation is **deferred** — it would move
already-published 2 °C figures for a sub-0.1 % gain. Revisit at the
publication-time refresh, when both legs can be re-pulled together.

> Historical note: the "Open decision" / "candidate factor" / Bjørn-extrapolation
> sections below were the pre-wiring exploration. The decisions were resolved as:
> **per-temperature affine** (Bjørn 1.5°C / AR6-analog 2°C) on the **from-2020**
> budget x20, re-baselined to from-2025 by subtracting **C** (2020–2024 CO₂e),
> giving the per-budget `f` in the final table. Kept for provenance.

## Why this exists

The AESA climate-change SR **numerator** is EF v3.1 GWP100 = **CO₂e** (all GHGs);
the carbon-budget **denominator** is IPCC CO₂-only (`carbon_budgets.json`). That
scope mismatch inflates the climate SR. Closing it needs a sourced CO₂→CO₂e
ratio (or affine) per scenario. premise's bundled REMIND files carry CO₂ totals
but **no economy-wide Kyoto-gases total** (only transport-sector GHG), so the
CO₂e leg was pulled from the IIASA AR6 Scenario Database.

## Source

- **Database:** IIASA AR6 Scenario Explorer & Database (`ar6-public`), hosted by
  IIASA. Pulled via `pyam` 3.4.0 → `pyam.iiasa.Connection('ar6-public')`
  (anonymous guest token; no credentials).
- **Model:** `REMIND 2.1`. **Region:** `World`. **Years:** 2005–2100 (5–10-yr steps).
- **Variables:** `Emissions|CO2` (Mt CO2/yr) and `Emissions|Kyoto Gases`
  (Mt CO2-equiv/yr).
- **Scenarios (9):** `R2p1_SSP{1,2,5}-PkBudg{900,1100,1300}`.

### ⚠️ Exact `PkBudg1150` is NOT in AR6 public
premise bundles `remind_SSPx-PkBudg1150` (from premise's own REMIND submission,
not AR6 WGIII). AR6 public has **PkBudg{900, 1100, 1300}** — no 1150. **PkBudg1100
is the nearest proxy** (900/1300 included to bracket budget-sensitivity).

## Files

| File | Contents |
|---|---|
| `ar6_remind_co2_kyoto_long.csv` | Raw long-format pull (288 rows): model/scenario/region/variable/unit/year/value. |
| `ar6_remind_co2_kyoto_wide.csv` | Same, pivoted to year columns. |
| `ar6_remind_ratio_summary.csv` | Per-scenario CO₂e÷CO₂ ratios across integration windows + net-zero year. |
| `premise_vs_ar6_co2_crosscheck.csv` | premise `Emi|CO2` (PkBudg1150) vs AR6 `Emissions|CO2` (PkBudg1100), World, 2025/30/50/70. |
| `ar6_2c_analog_pairs.csv` | Per-scenario (cum CO₂, cum CO₂e, ratio) pairs for the AR6 C3+C4 (~2°C) ensemble, all models — the regression inputs (Step 5). |
| `ar6_2c_analog_fit.json` | The fitted 2°C-analog of the Tilsted & Bjørn formula (slope, intercept, R, N, x-range, implied ratio at 1150). |
| `ar6_c1c2_pairs.csv` | **1.5 °C leg** regression inputs: **214**-scenario (cum CO₂, cum CO₂e, ratio) pairs over AR6 **C1+C2**, 2020 → net-zero. |
| `ar6_c1c2_offset_2020_2024.csv` | **1.5 °C leg** offset set: **217** rows of 2020–2024 cumulative CO₂/CO₂e, whose CO₂e median is **C = 250.665**. |
| `ar6_c34_offset_2020_2024.csv` | The **427**-scenario offset set: per-scenario 2020–2024 cumulative CO₂ and CO₂e that **C** is the median of. Superset of the 343 pairs; rows with a blank `netzero_co2_year` are the 84 excluded from the regression. |

## 2°C-analog of the Tilsted & Bjørn formula (Step 5)

No published off-the-shelf 2°C version of the Tilsted & Bjørn (2023) affine
exists (their fit is sub-1.5°C, domain x ∈ [223, 427] GtCO₂ — which excludes the
2°C-scale budgets).
Derived here by the same procedure over the AR6 ~2°C ensemble.

- **Ensemble:** AR6 categories **C3** ("likely below 2°C", >67%) **+ C4**
  (">50%"), **all models** (not just REMIND). Pulled `Emissions|CO2` +
  `Emissions|Kyoto Gases`, World.
- **Per scenario:** cumulative CO₂ (x) and cumulative CO₂e (y), **2020 → the year
  net-zero CO₂ is reached** (trapezoidal over linearly-interpolated annual values;
  net-zero = first downward zero-crossing). Scenarios that never reach net-zero
  CO₂ are dropped.
- **Regression** y = m·x + b across the ensemble:

  | | value |
  |---|---|
  | slope m | **1.2935** |
  | intercept b | **218.41 GtCO₂e** |
  | R | **0.9444** (as recorded in `ar6_2c_analog_fit.json`) |
  | N scenarios | **343** (232 C3 + 111 C4; dropped 84 no-net-zero, 38 missing a variable) |
  | fitted x-range | **[292.9, 1568.2] GtCO₂** |
  | **x = 1150 in range?** | **✅ yes** (unlike Tilsted & Bjørn's [223, 427]) |
  | implied CO₂e at x=1150 | **1705.9 GtCO₂e** |
  | implied ratio y/x at 1150 | **1.483** |

### Two scenario counts, two filters — 343 vs 427

The regression and the re-baselining offset **C** are computed over *different
subsets of the same C3+C4 pull*, because they need different things from a
scenario. Stating one count for both would be wrong:

| Quantity | N | Filter |
|---|---|---|
| regression (m, b) | **343** | has BOTH `Emissions|CO2` and `Emissions|Kyoto Gases`, **AND** reaches net-zero CO₂ — the fit integrates 2020 → net-zero, so a scenario with no crossing has no defined window |
| offset **C** | **427** | has both variables; **no net-zero requirement**, since C only needs the cumulative over the fixed 2020–2024 block |

So `427 = 343 + 84` (the no-net-zero scenarios, usable for C but not for the
fit), and `465 = 427 + 38` C3+C4 scenarios were retrieved in total, 38 of which
were missing one of the two variables and are excluded from both.

**Both sets ship.** `ar6_2c_analog_pairs.csv` is the 343-row regression set
(232 C3 + 111 C4, x ∈ [292.9, 1568.2]); `ar6_c34_offset_2020_2024.csv` is the
427-row offset set, of which the 343 are a strict subset — the 84 rows with a
blank `netzero_co2_year` are exactly those the regression drops. **C**, its IQR
and the CO₂ companion are the medians of that file's columns, not prose (locked
by `tests/test_aesa_co2e_ratio_provenance.py`).

- **vs Tilsted & Bjørn 1.5°C extrapolated to 1150:** ratio 1.298 (out-of-range,
  unreliable). The proper in-range 2°C analog gives **1.483** — higher.
- **Sanity vs REMIND PkBudg1100:** the one REMIND 2.1 PkBudg1100 scenario that
  lands in the C3/C4 ensemble with a net-zero crossing (`R2p1_SSP2-PkBudg1100`,
  C3, x=735 Gt) has actual ratio **1.658** vs the fit's **1.591** at that x
  (~4%, on the line). Consistent.

### ⚠️ Baseline-consistency trap (read before wiring)
The regression x is **cumulative CO₂ from 2020**. The `carbon_budgets.json`
default `IPCC_AR6_2C_50` is **1150 from 2025** (and **1350 from 2020**). Feeding
x must use the **same 2020 baseline** as the fit: for the 2C_50 budget that's
x≈1350 → y = 1.2935·1350 + 218.41 ≈ 1964.6 GtCO₂e, ratio ≈ **1.455**; feeding the
from-2025 value (1150) instead gives 1.483. Don't conflate the two baselines.
Also note the window difference: this analog integrates **from 2020 to
net-zero**, whereas the REMIND `ar6_remind_ratio_summary.csv` ratios (~1.6–1.75)
integrate **from 2025** — including the high-emission 2020–2025 years in the
denominator lowers the from-2020 ratio.

## Cumulative CO₂e ÷ CO₂ ratio (the candidate factor)

The factor is **window-sensitive** — it depends on the integration window of the
cumulative CO₂e and CO₂. From `ar6_remind_ratio_summary.csv`:

| Scenario (PkBudg1100, nearest 1150) | ratio @2025 (inst.) | cum→2050 | cum→net-zero | net-zero CO₂ |
|---|---|---|---|---|
| SSP1 | 1.37 | 1.48 | **1.62** | ~2067 |
| SSP2 | 1.37 | 1.51 | **1.75** | ~2068 |
| SSP5 | 1.35 | 1.46 | **1.62** | ~2062 |

Budget level (900 / 1100 / 1300) moves the cum→net-zero ratio only ~±0.1
(range across all 9 scenarios: **1.58 – 1.89**). Net-zero CO₂ falls ~2048–2097
(well past 2050).

## Cross-check vs the Tilsted & Bjørn (2023) affine (y = 1.1614·x + 157.27)

The Tilsted & Bjørn formula maps a CO₂ budget `x` (GtCO₂) to a CO₂e budget `y`;
its published domain is **x ∈ [223, 427] GtCO₂** (R = 0.80, 80 scenarios). Implied f = y/x per `carbon_budgets.json`
budget (using `remaining_gt_from_2025` as x):

| Budget option | x (Gt) | in-range? | y = 1.1614x+157.27 | f = y/x |
|---|---|---|---|---|
| `IPCC_AR6_1p5C_50` | 300 | ✅ in range | 505.7 | **1.69** |
| `IPCC_AR6_1p5C_67` | 200 | ⚠️ just below (200<223) | 389.6 | 1.95 |
| `IPCC_AR6_2C_50` (current default) | 1150 | ❌ far out of range | 1492.9 | 1.30 |
| `IPCC_AR6_2C_67` | 950 | ❌ far out of range | 1260.6 | 1.33 |

**Convergence at 1.5°C scale:** Tilsted & Bjørn f≈1.69 at x=300 matches the AR6 REMIND
cum→net-zero ratios (~1.6–1.75). **Divergence at 2°C scale:** the affine extrapolates
to f≈1.30 at x=1150 — but x=1150 is far outside the formula's validated domain,
so that value is unreliable, **and** it disagrees with the scenario-derived ratio
(~1.7, which stays ~budget-independent). This tension is the heart of the open
decision below.

## premise vs AR6 CO₂ cross-check (do NOT mix sources)

`premise_vs_ar6_co2_crosscheck.csv` — premise `Emi|CO2` (PkBudg1150) runs **far
above** AR6 `Emissions|CO2` (PkBudg1100), World:

| | 2025 | 2030 | 2050 | 2070 |
|---|---|---|---|---|
| SSP2 premise (Mt) | 43,265 | 36,282 | 11,635 | 5,781 |
| SSP2 AR6 (Mt) | 33,389 | 29,112 | 7,303 | −680 |
| Δ | +30% | +25% | +59% | premise +ve, AR6 net-negative |

Even in **2025** the gap is ~29% — too large for budget difference alone; it
reflects a **variable-scope and/or vintage difference** (premise's `Emi|CO2`
aggregate vs AR6's `Emissions|CO2`; premise's bundled REMIND vintage never
reaches net-zero, AR6 REMIND 2.1 does). **Implication:** derive the CO₂e/CO₂
ratio from a SINGLE consistent source (AR6, both legs) — **never** pair premise
CO₂ (denominator) with AR6 CO₂e. This is why both legs were pulled from AR6.

## Open decision (blocks wiring)

The factor depends on choices that are methodological, not mechanical:

1. **Integration window** — instantaneous-2025 (~1.37), cum→2050 (~1.5), or
   cum→net-zero (~1.6–1.75)? Must match how AESA frames its budget (the budget
   `end_year` is 2100; the SR timeline tracks the DSM fleet years).
2. **Budget mapping** — the current default budget is `IPCC_AR6_2C_50` (1150 Gt,
   2°C), which is **out of the Tilsted & Bjørn formula's validated range** and where the
   affine f (~1.30) and the scenario ratio (~1.7) disagree. Decide whether to (a)
   use the scenario-derived ratio (budget-robust ~1.7), (b) use the Tilsted & Bjørn affine only
   within its 1.5°C in-range budgets, or (c) restrict CO2e basis to in-range
   budgets.
3. **Scenario substitution** — PkBudg1100 (AR6) as proxy for premise's PkBudg1150.

> ~~Until resolved, `CarbonBudgetConfig.co2e_conversion` stays `None` (inert) and
> the compute guard rejects a CO2e basis with no sourced conversion.~~
>
> **SUPERSEDED.** The decisions above were resolved and the conversion is wired:
> `build_carbon_budget` now populates a per-budget `RatioCO2eConversion` for
> EVERY budget (`co2e_conversion_for_budget`), so `co2e_conversion` is **not**
> `None` on a freshly built budget. The compute guard still stands, but it now
> only fires for a config that reaches it WITHOUT a factor — in practice a
> workbook import whose Carbon Budget sheet leaves `co2e_factor` blank, since
> the import path uses the sheet value verbatim and never recomputes. See
> "WIRED per-budget factors" below.

## Provenance / reproduction

- Pull: `pyam.iiasa.Connection('ar6-public').query(model='REMIND 2.1',
  scenario=[R2p1_SSP{1,2,5}-PkBudg{900,1100,1300}],
  variable=['Emissions|CO2','Emissions|Kyoto Gases'], region='World')`.
- Ratios: cumulative trapezoidal integration of the annual pathway (Mt→Gt),
  2025→window; net-zero = first downward zero-crossing of `Emissions|CO2`
  (linear-interpolated).
- Cross-check: premise `remind_SSPx-PkBudg1150.csv` (Fernet-decrypted via the
  installed premise key) `Emi|CO2` World vs the AR6 long file.

### Pull dates — TWO extractions, not one

The files are **not** a single extraction, and should not be cited as one:

| File(s) | Pulled | pyam | API |
|---|---|---|---|
| `ar6_remind_*`, `premise_vs_ar6_*`, `ar6_2c_analog_pairs.csv`, `ar6_2c_analog_fit.json` | **2026-06-19** | 3.4.0 | (not recorded) |
| `ar6_c34_offset_2020_2024.csv` | **2026-08-12** | 3.4.0 | `db1.ene.iiasa.ac.at/ar6-public-api/rest/v2.1` |
| `ar6_c1c2_pairs.csv`, `ar6_c1c2_offset_2020_2024.csv` | **2026-08-12** | 3.4.0 | `db1.ene.iiasa.ac.at/ar6-public-api/rest/v2.1` |

The offset set was re-derived in **August 2026** because the June extraction was
not retained — only its summary statistics had been written into this README.
The re-derivation **reproduced the June values**, which is a stronger statement
than a single-pull claim because it is independently checkable:

| Quantity | June (this README) | August re-derivation | Δ |
|---|---|---|---|
| scenarios present in pull | 465 | 465 | 0 |
| missing a variable | 38 | 38 | 0 |
| **offset N** | **427** | **427** | **0** |
| **median C** | **257.4** | **257.449** | +0.05 (0.02 %) |
| IQR | [250.5, 271.0] | [250.460, 271.003] | ≈0 |
| CO₂ companion | 193.2 | 193.217 | +0.02 (0.01 %) |
| no-net-zero | 84 | 84 | 0 |
| **regression N** | **343** (232 C3 + 111 C4) | **343** (232 C3 + 111 C4) | **0** |

**Scenario identity, not just counts:** the 343 model/scenario identifier pairs
in the August pull are **identical name-for-name** to those in the June
`ar6_2c_analog_pairs.csv` — 343/343, none on either side only. Since the June
pull recorded no API version, this identity is the strongest available evidence
that the underlying scenario population is unchanged between the two dates.

Two caveats, stated rather than smoothed over:

- The August re-derivation's own OLS gave m=1.2942, b=218.0024 (R=0.9444,
  identical) — a 0.05 % / 0.19 % difference from the shipped coefficients. That
  is **an artefact of the re-derivation's interpolate-and-integrate code**, not a
  data change: regressing the *shipped* `ar6_2c_analog_pairs.csv` reproduces
  **m=1.293507, b=218.411131, R=0.944374** → exactly the published 1.2935 /
  218.41 / 0.9444. The shipped file and these coefficients are internally
  consistent; the August coefficients were **not** adopted.
- `ar6_c34_offset_2020_2024.csv` carries **3 decimal places** on the
  cumulatives, unlike the pairs file's 2. At 2 dp the median lands on exactly
  257.45 — a rounding knife-edge that could be read as either 257.4 or 257.5.
  The extra digit removes the ambiguity.

**Status:** the regression set and the offset set are **no longer provisional** —
both reproduced. The **budget data itself** (`carbon_budgets.json`: AR6 WG1
values, the −200 GtCO₂ deduction) remains provisional pending a separate
AR6/GCB review. The 1.5°C citation gap is CLOSED — see "The 1.5 °C affine —
source" at the top (Tilsted & Bjørn 2023, doi:10.1007/s10584-023-03583-4).

## WIRED per-budget factors (Phase 2/3 — now live)

The two affine formulas + a re-baselining offset are wired into
`build_carbon_budget` (`mapper/core/aesa_engine.py`) as a per-BUDGET
`RatioCO2eConversion(factor=f)`. Branch by temperature target:

- **1.5°C** budgets → **AR6 C1+C2 refit** (this dir): y = 1.3142·x + 149.1242,
  offset **C = 250.665**, domain [196.3, 1036.2]
- **2°C** budgets → **AR6 C3+C4 analog** (this dir): y = 1.2935·x + 218.41,
  offset **C = 257.4**, domain [292.9, 1568.2]

**The offset branches with the affine.** It used to be a single unconditional
module constant (257.4, a C3+C4 median) applied to both targets. In code the two
now travel together in one `CO2eBudgetFit` per target, so a third target cannot
be added while silently inheriting another ensemble's offset — and
`test_no_target_mixes_ensembles` checks each fit's declared categories against
the rows of its own two files.

where x = from-2020 CO₂ budget, y = from-2020 CO₂e (GWP100) budget.

**Re-baselining to AESA's from-2025 framing.** AESA's budget is from-2025
(`remaining_gt_from_2025`); the fits are from-2020. So subtract the cumulative
CO₂e emitted over the same 2020–2024 block as the budgets' −200 GtCO₂ deduction:

- **2 °C: C = 257.4 GtCO₂e** — median `cum_co2e_2020_2024_gt` over the 427 rows
  of `ar6_c34_offset_2020_2024.csv` (exactly **257.449**; IQR [250.460, 271.003]).
- **1.5 °C: C = 250.665 GtCO₂e** — median over the 217 rows of
  `ar6_c1c2_offset_2020_2024.csv` (IQR [239.579, 265.000]; CO₂ companion
  **186.776**). Lower than the 2 °C figure, as expected: sub-1.5 °C scenarios
  cut sooner, though 2020–2024 is largely locked in, which is why the gap is
  only ~6.8 Gt.
- **CO₂ companion cross-check:** the same file's median `cum_co2_2020_2024_gt`
  = **193.217 GtCO₂**, agreeing with the budgets' −200 deduction (Δ −6.8 Gt,
  ~3%) — confirming window/source consistency.

Then `x25 = remaining_gt_from_2025`, `y25 = (m·x20 + b) − C`, **`f = y25 / x25`**.
The factor is recomputed from these stored inputs (no magic number;
`co2e_factor_for_budget`, locked by `tests/test_aesa_co2e_factors.py`).

| Budget | T | formula | x20 | y20 | C | x25 | y25 | **f** |
|---|---|---|---|---|---|---|---|---|
| `IPCC_AR6_1p5C_50` | 1.5°C | AR6 C1+C2 | 500 | 806.22 | 250.665 | 300 | 555.56 | **1.8519** |
| `IPCC_AR6_1p5C_67` | 1.5°C | AR6 C1+C2 | 400 | 674.80 | 250.665 | 200 | 424.14 | **2.1207** |
| `IPCC_AR6_2C_50`  | 2°C | AR6 C3+C4 | 1350 | 1964.64 | 257.4 | 1150 | 1707.24 | **1.4846** |
| `IPCC_AR6_2C_67`  | 2°C | AR6 C3+C4 | 1150 | 1705.94 | 257.4 | 950 | 1448.54 | **1.5248** |

**Effect:** with `budget_basis = "CO2e_GHG"`, `with_basis_applied(f)` scales the
budget + depletion pathway by f → the climate-change SR is divided by f
(uniform, single-scalar Route B; the affine intercept is absorbed into the
per-budget f). The numerator (EF v3.1 GWP100) is unchanged; only the
climate-change SR responds; other planetary-boundary SRs are untouched.

**Frontend:** an AESA SR-view toggle ("CO₂ budget" / "CO₂-eq budget"), **default
CO₂-eq**, sets `budget_basis` and re-runs the compute under the new basis.

### Flags (carried from Phase 1)
- `1.5C_67` f=**1.822** sits marginally above the ~1.45–1.80 sanity band — expected
  (smallest x25=200; the intercept dominates at low x). Not an error.
- **`1.5C_50` (x20=500): the out-of-domain problem is GONE.** It was outside
  Tilsted & Bjørn's published [223, 427], which previously required an argument
  (that the quoted range is the budget-*insertion* range, not the regression's
  fitted scenario domain). The C1+C2 refit removes the need for that argument:
  x₂₀ = 500 sits **inside** the fitted domain **[196.3, 1036.2]**, at the 17th
  percentile — **37/214** fitted scenarios fall below 500. Exact counts on the
  shipped `ar6_c1c2_pairs.csv`, now measured at the correct 427 threshold rather
  than the previously mis-stated 440:

  | threshold | scenarios exceeding it |
  |---|---|
  | 427 GtCO₂ | **198/214** |
  | 440 GtCO₂ | 196/214 |
  | 500 GtCO₂ | 177/214 |

  (Earlier revisions quoted 209/227 and 190/227 against 440, as a lower bound
  for 427. These supersede them: same conclusion, exact, and computed on rows
  that ship.)

- **`1.5C_67` f = 2.121** is higher than the pre-refit 1.822 — the smallest
  from-2025 budget (x₂₅ = 200) makes the intercept dominate, and the C1+C2
  affine implies a larger CO₂e budget throughout. Expected, not an error.

**Status recap** — the AR6-analog coefficients and **C** are reproduced from the
shipped CSVs and are no longer flagged provisional. Still open: the **budget
data** (`carbon_budgets.json`) pending an AR6/GCB review. The 1.5 °C citation is
now complete (Tilsted & Bjørn 2023, Climatic Change 176:103,
doi:10.1007/s10584-023-03583-4).
