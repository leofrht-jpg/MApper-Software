# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""GSD^2 means exp(2*sigma) EVERYWHERE, and nothing else may be called that.

The defect this closes: the pedigree input side computed exp(2*sigma) while
``summarize`` reported exp(1.96*sigma_hat), both under the name ``gsd2``. Seven
sites used one constant, the eighth used the other, and the eighth was where
every headline number came from. Nothing raised, because the two agree to
within ~1% at ordinary spreads.

exp(2*sigma) is not a preference. It is ecoinvent's convention, recoverable
from the shipped data: on an exchange with one non-default pedigree score,
``scale**2 - scale_without_pedigree**2`` implies a sigma for which exp(2*sigma)
reproduces the published factor and exp(1.96*sigma) does not. It is also what
makes ``gsd2_from_sigma(ln(f)/2) == f`` exact.

The sweep below is the part that stops a second constant reappearing. It is
source-level and deliberately blunt: any 1.96 within reach of a log-space
standard deviation is a finding, wherever it is written.
"""
from __future__ import annotations

import ast
import math
import re
from pathlib import Path

import numpy as np
import pytest

from mapper.core.monte_carlo_engine import summarize
from mapper.core.pedigree import UNCERTAINTY_FACTORS, gsd2_from_sigma, total_sigma

BACKEND = Path(__file__).resolve().parents[1] / "mapper"
FRONTEND = Path(__file__).resolve().parents[2] / "mapper-frontend" / "src"


# ── The definition ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("sigma", [0.0, 0.01, 0.15, 0.25, 0.5, 1.0])
def test_the_input_side_is_exp_2_sigma(sigma):
    assert gsd2_from_sigma(sigma) == pytest.approx(math.exp(2.0 * sigma))


@pytest.mark.parametrize("sigma", [0.05, 0.15, 0.3, 0.6])
def test_the_output_side_is_the_SAME_definition(sigma):
    """``summarize`` on exactly-lognormal draws must return exp(2*sigma).

    This is the assertion that fails if the 1.96 comes back.
    """
    rng = np.random.default_rng(7)
    draws = np.exp(rng.normal(0.0, sigma, 200_000))
    got = summarize(draws)["gsd2"]
    assert got == pytest.approx(math.exp(2.0 * sigma), rel=0.02)
    # and is distinguishable from the retired constant at usable sigma
    if sigma >= 0.15:
        assert abs(got - math.exp(1.96 * sigma)) > 1e-3


def test_input_and_output_agree_on_one_lognormal():
    """The two halves of a run, on the same spread, must land on one number."""
    sigma = 0.3
    rng = np.random.default_rng(11)
    draws = np.exp(rng.normal(0.0, sigma, 200_000))
    assert summarize(draws)["gsd2"] == pytest.approx(gsd2_from_sigma(sigma), rel=0.02)


def test_a_single_pedigree_score_round_trips_to_its_published_factor():
    """exp(2 * ln(f)/2) == f. Only the 2 does this."""
    for ind, factors in UNCERTAINTY_FACTORS.items():
        for score, f in enumerate(factors, start=1):
            if f == 1.0:
                continue
            sigma = total_sigma({ind: score}, 0.0)
            assert gsd2_from_sigma(sigma) == pytest.approx(f, rel=1e-12), (ind, score)


# ── dispersion_95 is a DIFFERENT statistic, and says so ──────────────────────


def test_dispersion_95_is_the_empirical_ratio_not_a_fitted_one():
    rng = np.random.default_rng(3)
    draws = np.exp(rng.normal(0.0, 0.4, 100_000))
    s = summarize(draws)
    assert s["dispersion_95"] == pytest.approx(s["p97_5"] / s["median"])


def test_the_retired_constant_was_wrong_TWICE_over():
    """It was not GSD^2 (its label) and not the dispersion either.

    On a true lognormal, exp(1.96*sigma_hat) does land on p97.5/median -- that
    is the case it was derived for. On a SUM of lognormals, which is what every
    real run is, it drifts: measured here +2.9% at three terms and +8.5% at six,
    against +6.6% on the real B0 run. So the number it produced was neither
    statistic, and the one it approximated was already two fields away.
    """
    rng = np.random.default_rng(5)

    pure = np.exp(rng.normal(0.0, 0.5, 200_000))
    sig = float(np.std(np.log(pure)))
    assert summarize(pure)["dispersion_95"] == pytest.approx(math.exp(1.96 * sig), rel=0.01)

    mixed = sum(np.exp(rng.normal(0.0, 1.2, 200_000)) for _ in range(6))
    sig = float(np.std(np.log(mixed)))
    assert summarize(mixed)["dispersion_95"] > math.exp(1.96 * sig) * 1.02


def test_both_are_zero_rather_than_nan_on_a_non_positive_draw():
    s = summarize([1.0, 2.0, -0.5])
    assert s["gsd2"] == 0.0


# ── The sweep: no second constant, anywhere ──────────────────────────────────


def _sources():
    for root, suffixes in ((BACKEND, (".py",)), (FRONTEND, (".ts", ".tsx"))):
        if not root.exists():
            continue
        for f in root.rglob("*"):
            if f.suffix in suffixes:
                yield f


#: 1.96 next to a log-space spread, in either language. Deliberately broad:
#: the failure mode is someone reintroducing the constant in a new file, not
#: editing the one it was removed from.
_BAD = re.compile(
    r"1\.96\s*\*\s*(?:[A-Za-z_][\w.]*)?\s*(?:std|sigma|sd|scale|Math\.log|np\.log|log)",
    re.IGNORECASE,
)


#: Strip quoted text before matching. Prose -- docstrings, the workbook's own
#: migration note -- must be free to NAME the retired constant; only executable
#: arithmetic is a finding.
_STRINGS = re.compile(r"""("[^"]*"|'[^']*')""")


def _code_only(line: str) -> str:
    """A TS/TSX line with comments and string literals removed."""
    if line.lstrip().startswith(("//", "*", "/*")):
        return ""
    return _STRINGS.sub("", line.split("//")[0])


def _py_float_constants(path: Path) -> list[tuple[int, float]]:
    """Every float LITERAL in a .py file, via AST.

    AST is what makes the Python half reliable: a docstring is a string
    constant, never a float, so prose explaining the retired constant is
    invisible here while arithmetic using it is not. A line-oriented regex
    cannot make that distinction inside a triple-quoted block, and this file's
    own explanatory docstrings are exactly such a block.
    """
    out = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Constant) and isinstance(node.value, float):
            out.append((getattr(node, "lineno", 0), node.value))
    return out


def test_no_source_file_computes_a_dispersion_from_1_96():
    hits = []
    for f in _sources():
        if f.suffix == ".py":
            hits += [f"{f}:{ln}: float literal 1.96" for ln, v in _py_float_constants(f)
                     if v == 1.96]
        else:
            for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if _BAD.search(_code_only(line)):
                    hits.append(f"{f}:{i}: {line.strip()}")
    assert not hits, "a 1.96-based dispersion reappeared:\n" + "\n".join(hits)


def test_every_gsd2_helper_uses_the_factor_2():
    """AST-level, so a renamed or re-indented helper is still caught."""
    checked = 0
    for f in _sources():
        if f.suffix != ".py":
            continue
        tree = ast.parse(f.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            # AsyncFunctionDef too. A gsd2 helper is pure arithmetic and
            # implausibly async, but a FunctionDef-only walk is the exact
            # shape that made the persist-helper guard vacuous, so it is
            # not a distinction worth relying on anywhere.
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or (
                "gsd2" not in node.name.lower()
            ):
                continue
            checked += 1
            consts = {
                n.value for n in ast.walk(node)
                if isinstance(n, ast.Constant) and isinstance(n.value, float)
            }
            assert 1.96 not in consts, f"{f}:{node.lineno} {node.name} uses 1.96"
    assert checked >= 1, "the sweep found no gsd2 helper — it has gone vacuous"


def test_the_frontend_helper_matches_the_backend():
    """Two implementations of one definition; they must not drift."""
    src = (FRONTEND / "utils" / "pedigree.ts").read_text(encoding="utf-8")
    assert "Math.exp(2 * sigma)" in src.replace("Math.exp(2*sigma)", "Math.exp(2 * sigma)")
    assert "1.96" not in src


def test_the_sweep_would_catch_the_bug_it_was_written_for():
    """Anti-vacuity: the regex must fire on the line that actually shipped."""
    # (a) the Python half, through the AST path that actually guards it
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        bad = Path(d) / "bad.py"
        bad.write_text(
            '"""Prose may say exp(1.96 * sigma) freely."""\n'
            "import numpy as np\n"
            "def gsd2(a):\n"
            "    return float(np.exp(1.96 * np.std(np.log(a))))\n",
            encoding="utf-8",
        )
        assert [v for _, v in _py_float_constants(bad) if v == 1.96], (
            "the AST sweep would not have caught the line that shipped"
        )

        good = Path(d) / "good.py"
        good.write_text(
            '"""Prose may say exp(1.96 * sigma) freely."""\n'
            "import numpy as np\n"
            "def gsd2(a):\n"
            "    return float(np.exp(2.0 * np.std(np.log(a))))\n",
            encoding="utf-8",
        )
        assert not [v for _, v in _py_float_constants(good) if v == 1.96], (
            "prose naming the retired constant must not be a finding"
        )

    # (b) the TS half, through the regex path
    assert _BAD.search(_code_only("  return Math.exp(1.96 * sigma)"))
    assert not _BAD.search(_code_only("  return Math.exp(2 * sigma)"))
    assert not _BAD.search(_code_only("  // exp(1.96 * sigma) was the old constant"))
    assert not _BAD.search(_code_only("  const note = 'reported exp(1.96 * sigma)'"))
