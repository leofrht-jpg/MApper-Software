"""The per-file CI loop is the isolation sweep. It must not be deleted.

Twenty-one module-level registries persist across tests and nothing clears
them; ``tests/conftest.py`` clears exactly one (the parameter table), after
three fixtures were found passing on a predecessor's leftovers. The other
twenty are not cleared because the standalone sweep proves none is leaned on
-- and that proof is only worth something if the sweep keeps running.

It does run: the Windows backend job executes one pytest process per test file
on every push and PR. That is structurally the sweep -- fresh interpreter per
file, no leakage possible, names the failing file. It is what caught the third
leaky fixture while a full-suite run passed locally.

The risk is not that it stops working. It is that it gets collapsed into a
single-process run as a tidy-up -- the loop's comment historically gave only
the native-library reason, so someone fixing that reason would have had every
justification to remove it, silently retiring the isolation guarantee with no
test failing. This guard makes that impossible.

If it ever goes red, the failing file is named in the job output, and that is
the signal to revisit clearing the other twenty registries.
"""
from __future__ import annotations

import pathlib

import pytest

WORKFLOW = (
    pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"
)


@pytest.mark.skipif(not WORKFLOW.exists(), reason=f"workflow not found at {WORKFLOW}")
def test_ci_still_runs_one_process_per_test_file():
    text = WORKFLOW.read_text(encoding="utf-8")

    assert "one process per file" in text, (
        "The per-file CI step is gone. It is the standalone isolation sweep: "
        "the only thing proving no test depends on another's leftover "
        "module-level registry state. If the native-library reason for it was "
        "fixed, the isolation reason still stands -- see the comment in ci.yml."
    )
    # The loop body itself, not just the step name.
    assert "foreach ($f in $files)" in text, (
        "The per-file loop body is gone even though the step name survives."
    )
    assert "python -m pytest \"tests/$($f.Name)\"" in text, (
        "The loop no longer invokes pytest per file."
    )


@pytest.mark.skipif(not WORKFLOW.exists(), reason=f"workflow not found at {WORKFLOW}")
def test_the_loop_documents_the_isolation_reason():
    """Both reasons must be written down.

    The comment carried only the native-library reason for its whole life,
    which is exactly why removing the loop would have looked safe.
    """
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "TEST ISOLATION" in text, (
        "ci.yml no longer records that the per-file loop is an isolation "
        "guard, so the next person to fix the native-library issue will read "
        "it as a dead workaround."
    )


def test_the_conftest_clears_the_parameter_registry():
    """The one registry that is cleared, and the reason, stay put."""
    conftest = pathlib.Path(__file__).with_name("conftest.py")
    assert conftest.exists(), "tests/conftest.py is gone"
    text = conftest.read_text(encoding="utf-8")
    assert "_tables.clear()" in text
    # Both sides of the yield: a predecessor must not supply this test's table,
    # and this test must not supply a successor's.
    assert text.count("_tables.clear()") >= 2, (
        "the registry must be cleared on BOTH setup and teardown"
    )
