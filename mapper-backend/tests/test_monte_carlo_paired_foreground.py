"""The PAIRED path must sample the foreground, and share the draw across items.

Before this, ``_run_monte_carlo_multi`` had no foreground RNG at all: demands
were built once per item before the loop and ``mc.demand`` was only ever
assigned a pre-built constant. ``next(mc)`` shared the technosphere, biosphere
and characterisation factors correctly -- the foreground simply was not
sampled. Measured on Battery Circularity with one scored parameter, the paired
run reported GSD2 1.1099 against the single-item path's 1.2015 at the same
seed: **67.7% of the total log-variance missing**.

It matters most exactly where the paired mode is most useful. Battery
Circularity's A and A0 are 42/42 and 43/43 EXPRESSION rows -- not one literal
row between them -- so their foreground uncertainty is entirely parametric and
the paired A-vs-A0 comparison had no foreground component at all.

Two layers here:

* **structural** (runs everywhere) -- a stubbed chain, asserting the ORDER of
  operations. This is where step 4 goes wrong: ``next(mc)`` must advance the
  sampled world exactly ONCE per iteration, with item 0's demand pushed in
  BEFORE it. Advance twice and the items stop sharing a world, which
  reintroduces precisely the decorrelation the paired mode exists to remove;
  push item 0's demand after, and item 0 silently keeps its deterministic
  foreground while every other item gets a sampled one.
* **numerical** (needs a real technosphere) -- the marginals and the pairing.
"""
from __future__ import annotations

import numpy as np
import pytest

from mapper.api import monte_carlo as MC


# ── shared stubs ────────────────────────────────────────────────────────────

class _Chain:
    """A MonteCarloLCA stand-in that RECORDS the order it is driven in."""

    def __init__(self, demand, method, seed=None):
        self.demand = demand
        self.seed = seed
        self.log: list[str] = []
        self.world = 0                       # incremented by next()
        self.supply_array = np.array([1.0])
        self.biosphere_matrix = np.array([[1.0]])
        self._loaded = None                  # demand at the moment of advance

    def __next__(self):
        self.world += 1
        self.log.append(f"next(world={self.world})")
        self._loaded = self.demand
        return self

    def build_demand_array(self):
        self.log.append(f"build({_tag(self.demand)})")

    def lci_calculation(self):
        self.log.append(f"lci({_tag(self.demand)})")
        self._loaded = self.demand


def _tag(demand) -> str:
    """A short stable label for a demand dict, for the log."""
    if not demand:
        return "empty"
    k = sorted(demand)[0]
    return f"{k[1]}:{demand[k]:.4g}"


def _install(monkeypatch, arcs, draws_by_param=None, row_draws_by_item=None):
    """Wire the paired worker onto stubs. ``arcs`` is {id: (name, demand)}."""
    import mapper.api.monte_carlo as m

    class _Bundle:
        def __init__(self, aid, name, demand):
            self.arc = _Arc(aid, name)
            self.total_demand = demand
            self.method_tuples = [("M", "x")]
            self.linked = []
            self.effective_amounts = {}

    class _Arc:
        def __init__(self, aid, name):
            self.id, self.name, self.bom = aid, name, []

    def _build(archetype_id, **kw):
        name, demand = arcs[archetype_id]
        return _Bundle(archetype_id, name, demand)

    import mapper.api.lca as lca_mod
    monkeypatch.setattr(lca_mod, "_build_archetype_source_demand", _build)
    monkeypatch.setattr(lca_mod, "_translate_demand_to_database",
                        lambda d, db: (d, []))

    class _Runner:
        def __call__(self, demand, methods):
            return {tuple(x): (1.0, "kg") for x in methods}
    import mapper.core.bw2_wrapper as bw
    monkeypatch.setattr(bw, "PersistentLCARunner", lambda *a, **k: _Runner())

    import bw2calc
    chains: list[_Chain] = []

    def _mk(demand, method, seed=None):
        c = _Chain(demand, method, seed)
        chains.append(c)
        return c
    monkeypatch.setattr(bw2calc, "MonteCarloLCA", _mk)

    class _CFRng:
        def next(self):
            return np.array([1.0])
    monkeypatch.setattr(m, "_method_cf_samplers",
                        lambda mc, mts, seed: {tuple(t): (np.array([0]), _CFRng())
                                               for t in mts})

    monkeypatch.setattr(m, "collect_param_draws",
                        lambda table, referenced: list(draws_by_param or []))
    monkeypatch.setattr(m, "collect_row_draws",
                        lambda linked, entries: list(row_draws_by_item or []))
    monkeypatch.setattr(m, "_referenced_parameters", lambda arc: set())

    # Expression RESOLUTION is the single-item path's business and is tested
    # there; here the archetype is a stub and only the ORDER matters.
    import mapper.core.bom_engine as be
    monkeypatch.setattr(be, "resolve_archetype_with_engine", lambda arc, eng: arc)
    monkeypatch.setattr(
        m, "_linked_with_amounts",
        lambda arc, scope, eff, basis: [(_Mat(arc.id), 1.0)],
    )
    monkeypatch.setattr(
        m, "_aggregate",
        lambda materials, factors, key_map: {
            ("db", "x"): sum(
                arcs[mm.arc_id][1][("db", "x")] * factors.get(mm.node_id, 1.0)
                for mm, _ in materials
            )
        },
    )
    monkeypatch.setattr(m, "_translation_map", lambda keys, db: {k: k for k in keys})

    class _Lib:
        entries = {}
    monkeypatch.setattr(m, "load_library", lambda p: _Lib(), raising=False)
    import mapper.core.material_pedigree_storage as mps
    monkeypatch.setattr(mps, "load_library", lambda p: _Lib())

    return chains


class _Mat:
    """Minimal material stand-in: an ecoinvent link and a node id."""

    def __init__(self, arc_id):
        self.arc_id = arc_id
        self.node_id = f"n-{arc_id}"
        self.quantity = 1.0

        class _Link:
            database, code = "db", "x"
        self.ecoinvent_activity = _Link()


class _Task:
    def __init__(self):
        self.subscribers, self.stage, self.pct = [], None, 0.0


def _req(ids, n=3, seed=7):
    from mapper.models.schemas import MonteCarloMultiRequest
    return MonteCarloMultiRequest(
        archetype_ids=ids, methods=[["M", "x"]], scope="all",
        iterations=n, seed=seed, keep_samples=True,
    )


# ── structural: step 4's ordering ───────────────────────────────────────────

def test_next_advances_the_world_exactly_once_per_iteration(monkeypatch):
    """Advance twice and the items stop sharing a world -- which reintroduces
    the decorrelation the paired mode exists to remove."""
    arcs = {"a": ("A", {("db", "x"): 1.0}), "b": ("B", {("db", "x"): 2.0})}
    chains = _install(monkeypatch, arcs)
    MC._run_monte_carlo_multi(_req(["a", "b"], n=5), _Task(), "t")
    c = chains[0]
    advances = [l for l in c.log if l.startswith("next(")]
    # One priming next() before the loop, then exactly one per iteration.
    assert len(advances) == 1 + 5, c.log


def test_item_zero_demand_is_pushed_BEFORE_the_advance(monkeypatch):
    """Push it after and item 0 keeps its deterministic foreground while every
    other item gets a sampled one -- a silent per-item inconsistency."""
    from mapper.core.monte_carlo_engine import _ParamDraw

    arcs = {"a": ("A", {("db", "x"): 1.0}), "b": ("B", {("db", "x"): 2.0})}
    draws = [_ParamDraw(name="p", base_value=1.0, sigma=0.3)]
    chains = _install(monkeypatch, arcs, draws_by_param=draws)
    MC._run_monte_carlo_multi(_req(["a", "b"], n=2), _Task(), "t")

    log = chains[0].log
    first = log.index("next(world=2)")          # world=1 is the priming call
    before = [l for l in log[:first] if l.startswith("build(")]
    assert before, (
        "no demand was built before the first in-loop advance -- item 0 was "
        "solved against whatever demand happened to be loaded"
    )


def test_every_item_gets_its_own_rebuilt_demand(monkeypatch):
    from mapper.core.monte_carlo_engine import _ParamDraw

    arcs = {
        "a": ("A", {("db", "x"): 1.0}),
        "b": ("B", {("db", "x"): 2.0}),
        "c": ("C", {("db", "x"): 3.0}),
    }
    draws = [_ParamDraw(name="p", base_value=1.0, sigma=0.3)]
    chains = _install(monkeypatch, arcs, draws_by_param=draws)
    MC._run_monte_carlo_multi(_req(["a", "b", "c"], n=1), _Task(), "t")
    # items 1..n-1 re-solve the same matrices
    assert sum(1 for l in chains[0].log if l.startswith("lci(")) == 2


def test_the_constant_foreground_path_is_unchanged(monkeypatch):
    """Nothing scored -> demands are constant and the run varies the
    background alone. This is the default before anything is tagged, and it
    must not start rebuilding demands."""
    arcs = {"a": ("A", {("db", "x"): 1.0}), "b": ("B", {("db", "x"): 2.0})}
    chains = _install(monkeypatch, arcs)          # no param, no row draws
    MC._run_monte_carlo_multi(_req(["a", "b"], n=3), _Task(), "t")
    c = chains[0]
    assert len([l for l in c.log if l.startswith("next(")]) == 1 + 3
    # Item 0's demand is never rebuilt in this path -- only item 1's swap and
    # the warm-start restore.
    assert all("empty" not in l for l in c.log)


def test_one_shared_parameter_draw_serves_every_item(monkeypatch):
    """The foreground half of the pairing.

    Drawing per item would let a shared driver take two values in the SAME
    iteration -- exactly the decorrelation paired mode removes, reintroduced
    one layer down. With N items and one parameter, N iterations must consume
    N draws, not N x items.
    """
    from mapper.core.monte_carlo_engine import _ParamDraw

    seen: list[float] = []
    real = MC.lognormal_factor

    def _spy(rng, sigma):
        f = real(rng, sigma)
        seen.append(sigma)
        return f
    monkeypatch.setattr(MC, "lognormal_factor", _spy)

    arcs = {k: (k.upper(), {("db", "x"): 1.0}) for k in ("a", "b", "c")}
    draws = [_ParamDraw(name="p", base_value=1.0, sigma=0.25)]
    _install(monkeypatch, arcs, draws_by_param=draws)
    MC._run_monte_carlo_multi(_req(["a", "b", "c"], n=4), _Task(), "t")

    assert len(seen) == 4, (
        f"expected 4 parameter draws (one per iteration, shared across 3 "
        f"items); got {len(seen)} -- the draw moved inside the item loop"
    )


# ── numerical: needs a real technosphere ────────────────────────────────────

def _bw2_ready() -> tuple[bool, str]:
    try:
        import bw2data
    except ImportError:
        return False, "bw2data not installed"
    if not [d for d in bw2data.databases if "biosphere" not in d.lower()]:
        return False, "no technosphere databases"
    if not list(bw2data.methods):
        return False, "no LCIA methods"
    return True, ""


_ok, _why = _bw2_ready()
pytestmark_numeric = pytest.mark.skipif(not _ok, reason=_why)


@pytest.fixture()
def live(live_storage):
    """Battery Circularity's A / A0 with ONE parameter scored.

    Their rows are 100% expressions, so this is the only way they carry any
    foreground uncertainty at all.
    """
    import bw2data
    from mapper.api import bom as B, dsm as D, parameters as P
    from mapper.core import parameter_storage
    from mapper.models.parameter_schemas import ParamUncertainty

    if "Battery Circularity" not in {p.name for p in bw2data.projects}:
        pytest.skip("Battery Circularity project not present")
    bw2data.projects.set_current("Battery Circularity")
    P.install_parameters(parameter_storage.load_all())
    D.hydrate_from_disk()
    table = P._table_for("Battery Circularity")
    arcs = B._proj_archetypes("Battery Circularity")
    try:
        a = next(k for k, v in arcs.items() if v.name.startswith("A -"))
        a0 = next(k for k, v in arcs.items() if v.name.startswith("A0"))
    except StopIteration:
        pytest.skip("A / A0 archetypes not present")

    name = "ev_service_distance_km"
    if name not in table.parameters:
        pytest.skip("ev_service_distance_km not present")
    prev = table.parameters[name].uncertainty
    table.parameters[name].uncertainty = ParamUncertainty(pedigree={
        "reliability": 3, "completeness": 3, "temporal correlation": 3,
        "geographical correlation": 3, "further technological correlation": 3,
    })
    method = ["EF v3.1", "climate change", "global warming potential (GWP100)"]
    if tuple(method) not in bw2data.methods:
        method = list(next(iter(bw2data.methods)))
    try:
        yield a, a0, method, name
    finally:
        table.parameters[name].uncertainty = prev   # never persisted


def _run_single(aid, method, n, seed):
    from mapper.models.schemas import MonteCarloRequest
    return MC._run_monte_carlo(
        MonteCarloRequest(archetype_id=aid, methods=[method], scope="all",
                          iterations=n, seed=seed, keep_samples=True),
        _Task(), "s")


def _run_paired(ids, method, n, seed):
    from mapper.models.schemas import MonteCarloMultiRequest
    return MC._run_monte_carlo_multi(
        MonteCarloMultiRequest(archetype_ids=ids, methods=[method], scope="all",
                               iterations=n, seed=seed, keep_samples=True),
        _Task(), "p")


@pytestmark_numeric
def test_paired_marginal_gsd2_matches_the_single_item_run(live):
    """The DIRECT measure: is the foreground present at all?

    The shared-cancels test below proves the pairing is preserved, but it
    would pass on a foreground that is correlated yet too small. This asserts
    magnitude: at the same seed and the same scoring, paired item A's spread
    must match the single-item path's. Before the fix it was 1.1099 against
    1.2015 -- two-thirds of the log-variance missing.
    """
    a, a0, method, _ = live
    n, seed = 60, 4242
    single = _run_single(a, method, n, seed)
    paired = _run_paired([a, a0], method, n, seed)

    g_single = single.distributions[0].gsd2
    g_paired = paired.items[0].distributions[0].gsd2
    assert g_paired == pytest.approx(g_single, rel=0.02), (
        f"paired GSD2 {g_paired:.4f} vs single-item {g_single:.4f} -- the "
        "foreground is missing or attenuated in the paired path"
    )


@pytestmark_numeric
def test_item_zero_is_not_special(live):
    """Step 4's failure mode, measured rather than inspected.

    If item 0's demand is pushed after the advance it keeps a deterministic
    foreground, so its marginal collapses toward the background-only spread
    while later items carry the full one.
    """
    a, a0, method, _ = live
    n, seed = 60, 4242
    paired = _run_paired([a, a0], method, n, seed)
    g0 = paired.items[0].distributions[0].gsd2
    g1 = paired.items[1].distributions[0].gsd2
    single0 = _run_single(a, method, n, seed).distributions[0].gsd2
    single1 = _run_single(a0, method, n, seed).distributions[0].gsd2

    assert g0 == pytest.approx(single0, rel=0.02), "item 0's marginal is wrong"
    assert g1 == pytest.approx(single1, rel=0.02), "item 1's marginal is wrong"


@pytestmark_numeric
def test_the_pairing_survives_the_foreground(live):
    """Advancing the world twice would show up here as a collapsed
    correlation -- measured at 0.9903 before the foreground was added."""
    a, a0, method, _ = live
    paired = _run_paired([a, a0], method, 60, 4242)
    d = paired.differences[0]
    assert d.correlation > 0.9, (
        f"correlation {d.correlation:.4f} -- the items are no longer sharing "
        "one sampled world"
    )


@pytestmark_numeric
def test_a_shared_parameter_cancels_in_the_difference(live):
    """The property that distinguishes a correct PAIRED foreground from N
    independent ones.

    ``ev_service_distance_km`` is referenced by both A and A0, so its draw
    moves both scores together and largely cancels in A - A0. Independent
    draws would leave it in, widening the difference substantially.
    """
    a, a0, method, _ = live
    paired = _run_paired([a, a0], method, 60, 4242)
    sa = np.array(paired.items[0].distributions[0].samples)
    sb = np.array(paired.items[1].distributions[0].samples)
    d = sa - sb
    # The difference must be far tighter than either marginal -- that IS the
    # cancellation.
    assert d.std() < 0.5 * sa.std(), (
        f"sd(A-A0) {d.std():.6g} against sd(A) {sa.std():.6g} -- a shared "
        "parameter is not cancelling, so the draws are not shared"
    )
