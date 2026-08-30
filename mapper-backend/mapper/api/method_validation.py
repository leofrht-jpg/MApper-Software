# SPDX-License-Identifier: MPL-2.0
"""One place that decides whether a method tuple is usable.

Every route that accepts ``methods: list[list[str]]`` eventually reaches
``PersistentLCARunner`` -> ``lca.switch_method(mt)``, and bw2calc's
``load_lcia_data`` does ``methods[self.method]``. An unregistered tuple
therefore surfaces as a bare ``KeyError((...))`` from deep inside a worker,
often minutes into a run, with nothing naming the cause.

Validating up front turns that into a 400 that names the offender.

NOT skip-with-warning: silently dropping an indicator returns a result the
user believes covers N indicators when it covers fewer.

This lives in the api layer, not core, because it raises ``HTTPException`` --
core must not import from ``mapper.api`` (the one-way dependency rule).
"""

from fastapi import HTTPException


def validate_methods_registered(methods: list[list[str]]) -> None:
    """Raise 400 naming any method tuple not installed in the current project."""
    import bw2data

    registered = set(bw2data.methods)
    missing = [tuple(m) for m in methods if tuple(m) not in registered]
    if not missing:
        return
    shown = ", ".join(" | ".join(m) for m in missing[:3])
    more = f" (and {len(missing) - 3} more)" if len(missing) > 3 else ""
    raise HTTPException(
        status_code=400,
        detail=(
            f"{len(missing)} selected indicator(s) are not installed in this "
            f"project: {shown}{more}. This usually means the selection was "
            f"carried over from a project or method library where they were "
            f"installed. Re-pick the indicators for the current method family."
        ),
    )
