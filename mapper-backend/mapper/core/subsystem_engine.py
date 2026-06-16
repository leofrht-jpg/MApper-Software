"""Compute stock/inflows/outflows for dependent subsystems.

A dependent subsystem has no inflows of its own. For each year, its stock per
archetype is the sum over its ``DependencyRule``s of

    rule.expression(filtered_stock, total_primary_stock, year, **parameters)

where ``filtered_stock`` is the primary subsystem's stock for the same year,
restricted to cohorts matching ``rule.driver_filter``. Flow direction is then
back-calculated from the year-over-year stock delta::

    inflows(t)  = max(0, stock(t) - stock(t-1))
    outflows(t) = max(0, stock(t-1) - stock(t))

Dependent cohorts are keyed by ``dependent_archetype_id`` — each archetype is
its own cohort. This keeps the downstream cohort-mapping layer trivial
(identity mapping: archetype_id → (archetype_id, 1.0)).
"""
from __future__ import annotations

from mapper.core.dsm_engine import cohort_key_to_dict, largest_remainder_round
from mapper.core.parameter_engine import ParameterEngine, ParameterError
from mapper.models.dsm_schemas import (
    DimensionDef,
    SimulationResult,
    SimulationSummary,
    SystemDefinition,
    YearResult,
)
from mapper.models.subsystem_schemas import DependencyRule, Subsystem


# ── Primary stock filter ────────────────────────────────────────────────────


def filter_primary_stock(
    year_result: YearResult,
    driver_filter: dict[str, list[str]],
    primary_dimensions: list[DimensionDef],
) -> float:
    """Sum primary stock for cohorts satisfying every (dim, allowed-values)
    constraint in ``driver_filter``. Empty filter → total primary stock.
    """
    if not driver_filter:
        return float(sum(year_result.stock.values()))

    # Normalize allowed values to sets for O(1) lookup.
    allowed = {dim: set(vals) for dim, vals in driver_filter.items() if vals}
    if not allowed:
        return float(sum(year_result.stock.values()))

    total = 0.0
    for cohort_key, count in year_result.stock.items():
        cohort_dict = cohort_key_to_dict(cohort_key, primary_dimensions)
        if all(cohort_dict.get(dim) in vals for dim, vals in allowed.items()):
            total += count
    return float(total)


# ── Stock → flows ───────────────────────────────────────────────────────────


def stock_to_flows(
    stock_by_year: dict[int, dict[str, float]],
    years: list[int],
) -> dict[int, tuple[dict[str, float], dict[str, float]]]:
    """Convert a stock trajectory to per-year (inflows, outflows).

    For the first year the "previous" stock is taken as zero, so all of that
    year's stock is reported as inflow. Negative stock inputs are treated as
    zero (the caller should clip to avoid this).
    """
    out: dict[int, tuple[dict[str, float], dict[str, float]]] = {}
    prev: dict[str, float] = {}
    for year in years:
        curr = stock_by_year.get(year, {})
        inflows: dict[str, float] = {}
        outflows: dict[str, float] = {}
        for key in set(curr) | set(prev):
            delta = curr.get(key, 0.0) - prev.get(key, 0.0)
            if delta > 0:
                inflows[key] = delta
            elif delta < 0:
                outflows[key] = -delta
        out[year] = (inflows, outflows)
        prev = curr
    return out


# ── Dependent subsystem simulation ──────────────────────────────────────────


_RESERVED_EXTRA_VARS = frozenset({"filtered_stock", "total_primary_stock", "year"})


def compute_dependent_subsystem(
    subsystem: Subsystem,
    primary_def: SystemDefinition,
    primary_result: SimulationResult,
    parameter_engine: ParameterEngine | None = None,
) -> SimulationResult:
    """Simulate a dependent subsystem by evaluating its rules against the
    primary subsystem's year-by-year stock.

    Raises :class:`ValueError` if ``subsystem.type`` is not ``"dependent"``.
    Raises :class:`ParameterError` when an expression references an unknown
    parameter (the active parameter set must contain every referenced name).

    A user parameter named ``filtered_stock``, ``total_primary_stock``, or
    ``year`` would shadow the built-in variables; this is rejected up front.
    """
    if subsystem.type != "dependent":
        raise ValueError(
            f"compute_dependent_subsystem requires type='dependent', got {subsystem.type!r}"
        )

    engine = parameter_engine or ParameterEngine()
    collisions = _RESERVED_EXTRA_VARS & set(engine.params)
    if collisions:
        raise ParameterError(
            f"Parameter name(s) {sorted(collisions)} collide with built-in subsystem variables"
        )

    rules = subsystem.dependency_rules or []
    initial_stock = {k: float(v) for k, v in (subsystem.initial_stock or {}).items() if v}
    stock_by_year: dict[int, dict[str, float]] = {}

    base_year = primary_result.years[0].year if primary_result.years else None
    for yr in primary_result.years:
        year_stock: dict[str, float] = {}
        total_primary = float(sum(yr.stock.values()))
        for rule in rules:
            filtered = filter_primary_stock(yr, rule.driver_filter, primary_def.dimensions)
            try:
                value = engine.resolve(
                    rule.expression,
                    extra_vars={
                        "filtered_stock": filtered,
                        "total_primary_stock": total_primary,
                        "year": float(yr.year),
                    },
                )
            except ParameterError as e:
                raise ParameterError(
                    f"Dependency rule {rule.id!r} for archetype "
                    f"{rule.dependent_archetype_id!r} in year {yr.year}: {e}"
                ) from e
            # Negative stock is non-physical — clip at zero so stock_to_flows
            # doesn't emit phantom negative outflows.
            value = max(0.0, float(value))
            arch = rule.dependent_archetype_id
            year_stock[arch] = year_stock.get(arch, 0.0) + value

        # Base-year floor: if an existing installed base was uploaded, it sets
        # a minimum for year t₀ only. Subsequent years are rule-driven so the
        # back-calculated flows (stock_to_flows) can emit outflows when rules
        # push below the inherited stock.
        if yr.year == base_year and initial_stock:
            for arch, init_val in initial_stock.items():
                if init_val > year_stock.get(arch, 0.0):
                    year_stock[arch] = init_val

        if subsystem.integer_units and year_stock:
            year_stock = largest_remainder_round(year_stock)

        stock_by_year[yr.year] = year_stock

    years_list = [yr.year for yr in primary_result.years]
    flows = stock_to_flows(stock_by_year, years_list)

    year_results: list[YearResult] = []
    total_in = 0.0
    total_out = 0.0
    for yr in primary_result.years:
        stock_map = stock_by_year.get(yr.year, {})
        inflow_map, outflow_map = flows[yr.year]
        total_in += sum(inflow_map.values())
        total_out += sum(outflow_map.values())
        # No survival → no meaningful age distribution. Expose stock at age 0
        # so the DSM-LCA pipeline (which reads stock_by_age for some scopes)
        # still sees a coherent structure.
        stock_by_age = {k: {0: v} for k, v in stock_map.items() if v > 0}
        year_results.append(
            YearResult(
                year=yr.year,
                stock=stock_map,
                stock_by_age=stock_by_age,
                inflow=inflow_map,
                outflow=outflow_map,
                outflow_by_age={},
            )
        )

    start_stock = float(sum(year_results[0].stock.values())) if year_results else 0.0
    end_stock = float(sum(year_results[-1].stock.values())) if year_results else 0.0
    return SimulationResult(
        system_id=subsystem.id,
        years=year_results,
        summary=SimulationSummary(
            total_stock_start=start_stock,
            total_stock_end=end_stock,
            total_inflows=total_in,
            total_outflows=total_out,
        ),
    )


# ── Helpers ──────────────────────────────────────────────────────────────────


def validate_dependency_rule(
    rule: DependencyRule,
    primary_dimensions: list[DimensionDef],
) -> list[str]:
    """Return a list of human-readable errors for ``rule``. Empty list = OK.

    Validates: driver_filter keys refer to real primary dimensions, values
    are declared labels of those dimensions, expression is non-empty, and
    ``dependent_archetype_id`` is non-empty.
    """
    errors: list[str] = []
    if not rule.dependent_archetype_id:
        errors.append("dependent_archetype_id is required")
    if not (rule.expression or "").strip():
        errors.append("expression is required")

    dim_by_name = {d.name: d for d in primary_dimensions if not d.is_age}
    for dim_name, values in (rule.driver_filter or {}).items():
        dim = dim_by_name.get(dim_name)
        if dim is None:
            errors.append(f"driver_filter references unknown primary dimension '{dim_name}'")
            continue
        label_set = set(dim.labels)
        for v in values or []:
            if v not in label_set:
                errors.append(
                    f"driver_filter[{dim_name}] contains value '{v}' not in dimension labels"
                )
    return errors
