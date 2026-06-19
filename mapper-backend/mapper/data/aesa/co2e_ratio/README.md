# CO₂ → CO₂e (Kyoto-gases) conversion data — PROVISIONAL

**Status: PROVISIONAL data backing a NOW-WIRED conversion.** These files are the
sourced inputs for the AESA carbon-budget `budget_basis = "CO2e_GHG"` path
(`CarbonBudgetConfig.co2e_conversion`). As of the CO₂e-basis wiring, a per-budget
`RatioCO2eConversion` factor IS computed in `build_carbon_budget` and the basis
is user-selectable (default CO₂-eq). **See "WIRED per-budget factors" at the
bottom for the live factors + arithmetic.** The numbers below document the
derivation/exploration that led to the wired factors; the data + coefficients
remain provisional pending a publication-time refresh.

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
| `ar6_2c_analog_fit.json` | The fitted 2°C-analog of the Bjørn formula (slope, intercept, R, N, x-range, implied ratio at 1150). |

## 2°C-analog of the Bjørn formula (Step 5)

No published off-the-shelf 2°C version of Bjørn et al. 2023 exists (their fit is
sub-1.5°C, valid x ∈ [223, 440] GtCO₂ — which excludes the 2°C-scale budgets).
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
  | R | **0.944** |
  | N scenarios | **343** (232 C3 + 111 C4; dropped 84 no-net-zero, 38 missing a variable) |
  | fitted x-range | **[292.9, 1568.2] GtCO₂** |
  | **x = 1150 in range?** | **✅ yes** (unlike Bjørn's [223,440]) |
  | implied CO₂e at x=1150 | **1705.9 GtCO₂e** |
  | implied ratio y/x at 1150 | **1.483** |

- **vs Bjørn 1.5°C extrapolated to 1150:** ratio 1.298 (out-of-range,
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

## Cross-check vs Bjørn et al. 2023 affine (y = 1.1614·x + 157.27)

The Bjørn formula maps a CO₂ budget `x` (GtCO₂) to a CO₂e budget `y`; its fitted
domain is **x ∈ [223, 440] GtCO₂**. Implied f = y/x per `carbon_budgets.json`
budget (using `remaining_gt_from_2025` as x):

| Budget option | x (Gt) | in-range? | y = 1.1614x+157.27 | f = y/x |
|---|---|---|---|---|
| `IPCC_AR6_1p5C_50` | 300 | ✅ in range | 505.7 | **1.69** |
| `IPCC_AR6_1p5C_67` | 200 | ⚠️ just below (200<223) | 389.6 | 1.95 |
| `IPCC_AR6_2C_50` (current default) | 1150 | ❌ far out of range | 1492.9 | 1.30 |
| `IPCC_AR6_2C_67` | 950 | ❌ far out of range | 1260.6 | 1.33 |

**Convergence at 1.5°C scale:** Bjørn f≈1.69 at x=300 matches the AR6 REMIND
cum→net-zero ratios (~1.6–1.75). **Divergence at 2°C scale:** Bjørn extrapolates
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
   2°C), which is **out of the Bjørn formula's validated range** and where the
   affine f (~1.30) and the scenario ratio (~1.7) disagree. Decide whether to (a)
   use the scenario-derived ratio (budget-robust ~1.7), (b) use Bjørn affine only
   within its 1.5°C in-range budgets, or (c) restrict CO2e basis to in-range
   budgets.
3. **Scenario substitution** — PkBudg1100 (AR6) as proxy for premise's PkBudg1150.

Until resolved, `CarbonBudgetConfig.co2e_conversion` stays `None` (inert) and the
compute guard rejects a CO2e basis with no sourced conversion.

## Provenance / reproduction

- Pull: `pyam.iiasa.Connection('ar6-public').query(model='REMIND 2.1',
  scenario=[R2p1_SSP{1,2,5}-PkBudg{900,1100,1300}],
  variable=['Emissions|CO2','Emissions|Kyoto Gases'], region='World')`.
- Ratios: cumulative trapezoidal integration of the annual pathway (Mt→Gt),
  2025→window; net-zero = first downward zero-crossing of `Emissions|CO2`
  (linear-interpolated).
- Cross-check: premise `remind_SSPx-PkBudg1150.csv` (Fernet-decrypted via the
  installed premise key) `Emi|CO2` World vs the AR6 long file.

**Pull date:** 2026-06-19. **Flagged provisional** pending the open decision and a
publication-time refresh.

## WIRED per-budget factors (Phase 2/3 — now live)

The two affine formulas + a re-baselining offset are wired into
`build_carbon_budget` (`mapper/core/aesa_engine.py`) as a per-BUDGET
`RatioCO2eConversion(factor=f)`. Branch by temperature target:

- **1.5°C** budgets → **Bjørn et al. 2023**: y = 1.1614·x + 157.27
- **2°C** budgets → **AR6 C3+C4 analog** (this dir): y = 1.2935·x + 218.41

where x = from-2020 CO₂ budget, y = from-2020 CO₂e (GWP100) budget.

**Re-baselining to AESA's from-2025 framing.** AESA's budget is from-2025
(`remaining_gt_from_2025`); the fits are from-2020. So subtract the cumulative
CO₂e emitted over the same 2020–2024 block as the budgets' −200 GtCO₂ deduction:

- **C = 257.4 GtCO₂e** — median `Emissions|Kyoto Gases` 2020–2024 over the AR6
  C3+C4 ensemble (427 scenarios; IQR [250.5, 271.0]).
- **CO₂ companion cross-check:** the same ensemble's median `Emissions|CO2`
  2020–2024 = **193.2 GtCO₂**, agreeing with the budgets' −200 deduction
  (Δ −6.8 Gt, ~3%) — confirming window/source consistency.

Then `x25 = remaining_gt_from_2025`, `y25 = (m·x20 + b) − C`, **`f = y25 / x25`**.
The factor is recomputed from these stored inputs (no magic number;
`co2e_factor_for_budget`, locked by `tests/test_aesa_co2e_factors.py`).

| Budget | T | formula | x20 | y20 | C | x25 | y25 | **f** |
|---|---|---|---|---|---|---|---|---|
| `IPCC_AR6_1p5C_50` | 1.5°C | Bjørn 2023 | 500 | 737.97 | 257.4 | 300 | 480.57 | **1.6019** |
| `IPCC_AR6_1p5C_67` | 1.5°C | Bjørn 2023 | 400 | 621.83 | 257.4 | 200 | 364.43 | **1.8222** |
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
- `1.5C_50` x20=**500 exceeds Bjørn's documented in-range [223,440]** — a mild
  extrapolation. His SI's exact fitted-domain upper bound wasn't re-checked here;
  flagged for verification. The 2°C analog's range [293,1568] covers all 2°C x.

**Provisional** — coefficients (Bjørn 2023, AR6-analog), C, and the budget data
itself all remain provisional pending publication-time refresh.
