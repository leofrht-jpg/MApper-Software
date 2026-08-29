# SPDX-License-Identifier: MPL-2.0
"""Route contract for POST /lca/monte-carlo.

Schema and wiring only -- the sampling itself needs a real technosphere and is
exercised against the WP5 project by hand, not in CI.
"""

import pytest
from fastapi.testclient import TestClient

from mapper.main import app
from mapper.models.bom_schemas import BOMNode, FlattenedMaterial, RowUncertainty
from mapper.models.parameter_schemas import Parameter, ParamUncertainty
from mapper.models.schemas import (
    ArchetypeLCAMethodDistribution,
    MonteCarloRequest,
    MonteCarloResult,
)

client = TestClient(app)


def test_the_route_is_registered_with_its_websocket():
    paths = {getattr(r, "path", "") for r in app.routes}
    assert "/api/lca/monte-carlo" in paths
    assert "/api/lca/monte-carlo/{task_id}" in paths
    assert "/api/lca/monte-carlo/ws/{task_id}" in paths


def test_defaults_match_the_measured_convergence_point():
    """1000 iterations sits at 0.18% drift on the percentiles vs a 1200 run."""
    body = MonteCarloRequest(archetype_id="a", methods=[["m"]])
    assert body.iterations == 1000
    assert body.seed is None          # random unless pinned
    assert body.keep_samples is True  # the histogram needs the draws
    assert body.scope == "all"


def test_methods_are_required():
    r = client.post("/api/lca/monte-carlo", json={"archetype_id": "a", "methods": []})
    assert r.status_code == 400
    assert "method" in r.json()["detail"].lower()


@pytest.mark.parametrize("n", [0, -1, 20_001])
def test_iteration_count_is_bounded(n):
    r = client.post(
        "/api/lca/monte-carlo",
        json={"archetype_id": "a", "methods": [["EF v3.1", "climate change"]], "iterations": n},
    )
    assert r.status_code == 400
    assert "iterations" in r.json()["detail"]


def test_the_route_actually_SPAWNS_a_worker(monkeypatch):
    """The gap that let a 500 ship.

    Every other test here exercises a 4xx path -- missing methods, bad
    iteration count -- and all of those return BEFORE the worker is launched.
    So the launch itself was never executed by a test, and it was wrong:
    ``run_in_thread(work)`` passed a zero-arg closure to a helper whose
    signature is ``run_in_thread(task, fn, *args)``, raising
    ``missing 1 required positional argument: 'fn'`` on every call. The
    endpoint 500'd before any sampling began, and the feature was dead in the
    packaged app.

    This drives the route far enough to launch the thread. The archetype is
    bogus, so the worker fails inside -- which is fine and is the point: the
    failure must surface as a task error, not as a 500 from the POST.
    """
    # The route now validates method tuples against the installed registry
    # up front, so this test must declare the tuple it POSTs as registered --
    # otherwise it 400s before the launch and stops measuring the launch.
    import bw2data

    monkeypatch.setattr(
        bw2data, "methods", {("EF v3.1", "climate change", "GWP100"): {}}
    )
    r = client.post(
        "/api/lca/monte-carlo",
        json={
            "archetype_id": "does-not-exist",
            "methods": [["EF v3.1", "climate change", "GWP100"]],
            "iterations": 2,
        },
    )
    assert r.status_code == 200, f"POST must return a task id, got {r.status_code}: {r.text}"
    task_id = r.json()["task_id"]
    assert task_id

    # The worker runs in a daemon thread; give it a moment to reach its own
    # error handling rather than asserting on a race.
    import time

    for _ in range(50):
        got = client.get(f"/api/lca/monte-carlo/{task_id}")
        if got.status_code != 409:      # 409 == still running
            break
        time.sleep(0.1)
    # A bogus archetype fails INSIDE the worker, reported as a task error.
    # What must not happen is the POST itself throwing.
    assert got.status_code in (200, 500), got.status_code


def test_the_worker_is_not_launched_through_core_tasks_run_in_thread():
    """`core.tasks.run_in_thread` drives a `core.tasks.Task` and calls
    ``fn(task, ...)``. This route owns a WS-oriented `_TaskState` and a
    zero-arg closure, so it launches a plain daemon thread the way `plca` and
    `impact` do. Mixing the two is what broke it."""
    import ast
    from pathlib import Path

    # AST, not a substring: the comment at the call site NAMES run_in_thread in
    # order to explain why it is not used, and a textual check cannot tell
    # prose from a call. Same reason the solver guard in
    # test_monte_carlo_guards.py is AST-based.
    src = (Path(__file__).resolve().parents[1] / "mapper" / "api" / "monte_carlo.py").read_text()
    tree = ast.parse(src)
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "post_monte_carlo"
    )
    called = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Name):
                called.add(f.id)
            elif isinstance(f, ast.Attribute):
                called.add(f.attr)
    assert "run_in_thread" not in called
    assert "Thread" in called and "start" in called


def test_unknown_task_id_is_404_not_500():
    assert client.get("/api/lca/monte-carlo/does-not-exist").status_code == 404


def test_the_distribution_carries_the_seed_so_a_run_is_reproducible():
    """A Monte Carlo result nobody can reproduce is not a research output."""
    d = ArchetypeLCAMethodDistribution(
        method=["EF v3.1", "climate change"], method_label="climate change",
        unit="kg CO2-eq", deterministic=1.0, median=1.1, mean=1.15,
        p2_5=0.9, p25=1.0, p75=1.2, p97_5=1.4, gsd2=1.2,
        n_iterations=1000, seed=42,
    )
    assert d.seed == 42
    assert d.n_iterations == 1000
    assert d.samples is None  # optional -- 1000 floats x 16 indicators is large


def test_the_result_reports_how_much_foreground_was_actually_scored():
    """Zero on both is a legitimate configuration -- background-only -- but the
    UI has to be able to say so rather than implying the foreground was
    covered."""
    r = MonteCarloResult(
        archetype_id="a", archetype_name="A", scope="all",
        n_iterations=10, seed=1, distributions=[],
    )
    assert r.rows_with_uncertainty == 0
    assert r.parameters_with_uncertainty == 0


# ── the two optional fields ───────────────────────────────────────────────────


def test_uncertainty_is_optional_and_legacy_data_deserialises_as_none():
    """Same additive-optional precedent as MaterialEvolution and global_levers."""
    node = BOMNode(name="Steel", node_type="material", quantity=100.0)
    assert node.uncertainty is None
    assert Parameter(name="d_annual", base_value=15000.0).uncertainty is None

    legacy = {"name": "Steel", "node_type": "material", "quantity": 100.0}
    assert BOMNode.model_validate(legacy).uncertainty is None


def test_an_untagged_row_is_provably_unaffected():
    from mapper.core.monte_carlo_engine import sigma_of
    assert sigma_of(None) == 0.0


def test_the_flatten_carries_both_fields_so_the_guard_can_fire():
    """The expression-row rule is enforced on the FLATTENED list. Without these
    two fields surviving the flatten the check reads None on every row and
    never fires -- which is exactly what happened on the first pass."""
    assert "quantity_expression" in FlattenedMaterial.model_fields
    assert "uncertainty" in FlattenedMaterial.model_fields

    from mapper.core.bom_engine import flatten_bom, flatten_root_with_amounts

    root = BOMNode(
        name="Use Phase", node_type="component", quantity=1.0,
        children=[
            BOMNode(
                name="Electricity", node_type="material", quantity=1.0,
                quantity_expression="d_annual * p_bev",
            ),
            BOMNode(
                name="Tyres", node_type="material", quantity=4.0,
                uncertainty=RowUncertainty(pedigree={"reliability": 3}),
            ),
        ],
    )
    # BOTH flatten paths must carry them -- they are separate implementations.
    for flat in (
        flatten_bom(root),
        [m for m, _ in flatten_root_with_amounts(root, {"Use Phase": 1.0})],
    ):
        by_name = {m.name: m for m in flat}
        assert by_name["Electricity"].quantity_expression == "d_annual * p_bev"
        assert by_name["Tyres"].uncertainty is not None


def test_param_uncertainty_round_trips():
    p = Parameter(
        name="d_annual", base_value=15000.0,
        uncertainty=ParamUncertainty(pedigree={"reliability": 2, "temporal correlation": 3}),
    )
    again = Parameter.model_validate(p.model_dump())
    assert again.uncertainty is not None
    assert again.uncertainty.pedigree == {"reliability": 2, "temporal correlation": 3}
