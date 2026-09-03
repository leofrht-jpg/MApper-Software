# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Moving MApper's own per-project storage alongside a Brightway project.

``duplicate_project`` / ``export_project`` / ``import_project`` used to carry
only ``bw2data.projects.dir``. Everything MApper models lives outside that
directory, keyed by project name under ``user_data_dir("mapper")``, so a
duplicated project arrived with its databases and none of its modelling, and an
exported ``.mapperproj.tar.gz`` — the reproducibility artifact — round-tripped
cleanly while silently dropping the DSM systems, BOMs, sharing configuration and
parameter table. Nothing signalled the loss.

Five roots are project-keyed. ``aesa`` covers saved sessions too (they live in
``aesa/{project}/sessions/``), and ``mfa`` is the pre-rename legacy root that
``dsm_storage._migrate_legacy_storage`` still reads.

**Ids are copied verbatim.** Every registry is ``dict[project][id]`` and every
path is ``{project}/…``, so ids are already namespaced by project and reuse
across projects collides with nothing. Minting fresh ones is the dangerous
option: cohort mappings reference archetype ids and AESA configurations
reference DSM system ids, so re-keying would orphan exactly the way a
re-import once orphaned the WP5 mapping.
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

# Format version of the ``__mapper__`` tree written into an export archive.
# Bump when the layout changes in a way an importer must know about.
ARCHIVE_FORMAT = 1

# Directory carrying MApper storage inside an export archive. It sits INSIDE
# the project directory, not beside it, and that is load-bearing: the importer
# shipped before this feature picks ``roots[0]`` from the archive's top level,
# and with a sibling present it can pick the storage tree AS the project. Nested
# it is invisible to that code path — an older build copies it into the bw2
# project directory as an inert subdirectory and imports the project fine.
ARCHIVE_DIR = "__mapper__"
MANIFEST_NAME = "manifest.json"

_UNSAFE_PROJECT = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_project(project: str) -> str:
    """Mirror of the per-module sanitiser. All five use the same expression."""
    cleaned = _UNSAFE_PROJECT.sub("_", (project or "").strip())
    return cleaned or "default"


class ProjectStorageCollision(ValueError):
    """Two distinct project names map onto one storage directory."""


def storage_roots() -> dict[str, Path]:
    """``{label: root}`` resolved at call time.

    Read from the modules rather than captured at import, so a test that
    monkeypatches ``dsm_storage.STORAGE_DIR`` is honoured here too.
    """
    from mapper.core import (
        aesa_storage,
        dsm_storage,
        parameter_storage,
        plca_storage,
    )

    return {
        "dsm": Path(dsm_storage.STORAGE_DIR),
        # Saved sessions live under this root as `{project}/sessions/`.
        "aesa": Path(aesa_storage.STORAGE_DIR),
        "parameters": Path(parameter_storage.STORAGE_DIR),
        "plca": Path(plca_storage.STORAGE_DIR),
        "mfa": Path(dsm_storage._LEGACY_STORAGE_DIR),
    }


def _count(d: Path) -> int:
    return sum(1 for p in d.rglob("*") if p.is_file()) if d.exists() else 0


def describe(project: str) -> dict[str, int]:
    """File count per root for ``project``. Roots with nothing are omitted."""
    safe = _safe_project(project)
    out: dict[str, int] = {}
    for label, root in storage_roots().items():
        n = _count(root / safe)
        if n:
            out[label] = n
    return out


def _assert_no_collision(src: str, dst: str) -> None:
    """Refuse when two distinct names sanitise to one directory.

    ``_safe_project`` maps ``[<>:"/\\|?*]`` to ``_``, so ``My/Project`` and
    ``My_Project`` share a directory. Copying is where that first destroys
    data — the destination write would land on top of an unrelated project's
    storage — so it fails loudly here instead. Deliberately NOT a redesign of
    the naming scheme; that is a wider change and this is the point where the
    ambiguity becomes dangerous.
    """
    if src != dst and _safe_project(src) == _safe_project(dst):
        raise ProjectStorageCollision(
            f"Project names {src!r} and {dst!r} both map to the storage "
            f"directory {_safe_project(dst)!r}. Rename one so their storage "
            f"does not overlap."
        )


def _restamp_validation_reports(dsm_project_dir: Path, dst: str) -> int:
    """Point copied archetypes' validation reports at their new project.

    Cosmetic — nothing reads ``ValidationReport.project_name`` for logic, it is
    shown in the validation panel — but a copy displaying the source project's
    name is the kind of detail that misleads someone months later.
    """
    arc_dir = dsm_project_dir / "archetypes"
    if not arc_dir.exists():
        return 0
    n = 0
    for f in sorted(arc_dir.glob("*.json")):
        try:
            payload = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        items = payload if isinstance(payload, list) else [payload]
        touched = False
        for it in items:
            report = it.get("validation_report") if isinstance(it, dict) else None
            if isinstance(report, dict) and report.get("project_name") != dst:
                report["project_name"] = dst
                touched = True
        if touched:
            f.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            n += 1
    return n


def _copy_tree(src_dir: Path, dst_dir: Path) -> None:
    if dst_dir.exists():
        shutil.rmtree(dst_dir)
    dst_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src_dir, dst_dir)


def copy_project_storage(src: str, dst: str) -> dict[str, int]:
    """Copy every project-keyed root from ``src`` to ``dst``, ids verbatim.

    Returns ``{label: files copied}``. Absent roots are skipped, so a project
    with no AESA configurations simply has no ``aesa`` entry.
    """
    _assert_no_collision(src, dst)
    s, d = _safe_project(src), _safe_project(dst)
    copied: dict[str, int] = {}
    for label, root in storage_roots().items():
        src_dir = root / s
        if not src_dir.exists():
            continue
        dst_dir = root / d
        _copy_tree(src_dir, dst_dir)
        if label in ("dsm", "mfa"):
            _restamp_validation_reports(dst_dir, dst)
        copied[label] = _count(dst_dir)
    return copied


def delete_project_storage(project: str, other_projects) -> dict[str, int]:
    """Remove every project-keyed root for ``project``.

    The mirror of the copy gap. ``delete_project`` removed the Brightway
    project and left MApper's storage behind, so a deleted project's DSM
    systems, archetypes, AESA configurations and parameter tables stayed on
    disk indefinitely -- and would be silently re-adopted by any later project
    whose name sanitised to the same directory.

    ``other_projects`` is the set of names that still exist. The collision
    guard is the reverse of the copy's: deleting is refused when a SURVIVING
    project shares this storage directory, because the delete would take out
    data that is still in use. `My/Project` and `My_Project` are one directory,
    so removing either would otherwise destroy the other's modelling.

    Returns ``{label: files removed}``; roots with nothing are omitted.
    """
    safe = _safe_project(project)
    clash = sorted(o for o in other_projects
                   if o != project and _safe_project(o) == safe)
    if clash:
        raise ProjectStorageCollision(
            f"Refusing to delete storage for {project!r}: the surviving "
            f"project(s) {clash!r} share the storage directory {safe!r}. "
            f"Their modelling would be destroyed. Rename one first."
        )

    removed: dict[str, int] = {}
    for label, root in storage_roots().items():
        d = root / safe
        if not d.exists():
            continue
        n = _count(d)
        shutil.rmtree(d)
        if n:
            removed[label] = n
    return removed


# Modes for a project export.
#   "modelling" — MApper's own storage only. The DEFAULT, because a full export
#     bundles licensed ecoinvent content (unshareable) and, at WP5's 38 GB,
#     buffers a tarball no process should hold.
#   "full" — everything, including the bw2 project directory. Carries a
#     licensed-content marker in the manifest AND in the filename so a recipient
#     cannot mistake it for something redistributable.
EXPORT_MODES = ("modelling", "full")

# A premise-generated database cannot be obtained by licensing ecoinvent: it is
# derived by running premise against an IAM scenario. Listed separately so a
# recipient can see what they must regenerate rather than acquire.
_PREMISE_MARKER = "_premise_"

#: Databases MApper GENERATES rather than licenses, mapped to the script that
#: rebuilds them. Distinct from premise on the one axis a recipient cares
#: about: a premise database has to be regenerated by running premise against
#: an IAM scenario, whereas these ship with a build script in the repo, so
#: "you are missing this" comes with the command that fixes it. Telling a
#: recipient a database is absent without telling them how to rebuild it is
#: how a modelling-only export becomes unusable.
_GENERATED_DATABASES: dict[str, str] = {
    "mapper-tailpipe": "mapper-backend/scripts/build_tailpipe_db.py",
}


def database_inventory(project: str, archetypes) -> dict:
    """What a recipient needs in order to resolve this project's links.

    Records database NAMES with per-database link counts, not just an ecoinvent
    version. Resolution is by ``(database, code)``, so "ecoinvent 3.10 cutoff"
    will not match a link stored against ``ecoinvent-3.10-cutoff`` -- a version
    string alone is not actionable. Counting links per name also shows which
    databases actually matter to this project versus merely being installed.
    """
    linked: dict[str, int] = {}

    def _walk(node):
        act = getattr(node, "ecoinvent_activity", None)
        if act is not None and getattr(act, "database", None):
            linked[act.database] = linked.get(act.database, 0) + 1
        for c in (getattr(node, "children", None) or []):
            _walk(c)

    for arc in (archetypes or {}).values():
        for root in getattr(arc, "bom", []) or []:
            _walk(root)

    installed: list[str] = []
    try:
        import bw2data

        installed = [str(d) for d in bw2data.databases]
    except Exception:
        pass

    premise = sorted(d for d in installed if _PREMISE_MARKER in d)
    generated = sorted(d for d in installed if d in _GENERATED_DATABASES)
    base = sorted(
        d
        for d in installed
        if _PREMISE_MARKER not in d and d not in _GENERATED_DATABASES
    )

    # Every generated database the project actually LINKS to needs its build
    # command in the manifest, whether or not it happens to be installed on
    # the machine doing the export -- the recipient is the one who needs it,
    # and a link into an absent database is exactly the case that matters.
    regenerate = {
        name: script
        for name, script in _GENERATED_DATABASES.items()
        if name in generated or name in linked
    }

    return {
        # name -> number of BOM links resolved against it
        "linked": dict(sorted(linked.items(), key=lambda kv: -kv[1])),
        "installed_base": base,
        # Separate: not obtainable by licensing ecoinvent.
        "installed_premise": premise,
        "premise_count": len(premise),
        # Separate again: obtainable by running the script named below.
        "installed_generated": generated,
        "regenerate_with": dict(sorted(regenerate.items())),
    }


def write_archive_storage(
    tf, project: str, arc_prefix: str,
    mode: str = "modelling", databases: dict | None = None,
) -> dict:
    """Add ``{arc_prefix}/__mapper__/…`` to an open tarfile; return the manifest.

    The manifest is what makes an archive self-describing: its presence says the
    writer supported MApper storage at all, and its counts say what was in it.
    Without it an importer cannot tell "exported before this feature existed"
    from "exported by a project that genuinely had no DSM systems".
    """
    safe = _safe_project(project)
    roots_written: dict[str, int] = {}
    for label, root in storage_roots().items():
        src_dir = root / safe
        if not src_dir.exists():
            continue
        n = _count(src_dir)
        if not n:
            continue
        tf.add(str(src_dir), arcname=f"{arc_prefix}/{ARCHIVE_DIR}/{label}/{safe}")
        roots_written[label] = n

    manifest = {
        "format": ARCHIVE_FORMAT,
        "project": project,
        "mode": mode,
        # True only for a full export. The marker rides in the manifest AND the
        # filename, because a recipient reads the filename first.
        "contains_licensed_content": mode == "full",
        "databases": databases or {},
        "storage_dir_name": safe,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "roots": roots_written,
        "total_files": sum(roots_written.values()),
    }
    try:
        from mapper import __version__ as _v
        manifest["mapper_version"] = _v
    except Exception:
        pass

    import io as _io
    import tarfile as _tarfile

    blob = json.dumps(manifest, indent=2).encode("utf-8")
    info = _tarfile.TarInfo(f"{arc_prefix}/{ARCHIVE_DIR}/{MANIFEST_NAME}")
    info.size = len(blob)
    tf.addfile(info, _io.BytesIO(blob))
    return manifest


def read_archive_manifest(project_root: Path) -> dict | None:
    """Manifest from an extracted archive, or ``None`` for an old archive."""
    f = project_root / ARCHIVE_DIR / MANIFEST_NAME
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def install_archive_storage(project_root: Path, dst: str) -> dict[str, int]:
    """Install an extracted ``__mapper__`` tree under the project name ``dst``.

    A no-op returning ``{}`` when the archive predates the format, which is the
    old-archive path and must stay silent rather than failing.
    """
    staged = project_root / ARCHIVE_DIR
    if not staged.exists():
        return {}
    d = _safe_project(dst)
    installed: dict[str, int] = {}
    roots = storage_roots()
    for label_dir in sorted(p for p in staged.iterdir() if p.is_dir()):
        label = label_dir.name
        root = roots.get(label)
        if root is None:
            # An archive from a newer build carrying a root this one does not
            # know. Skipping is the safe read: never invent a location.
            continue
        inner = [p for p in label_dir.iterdir() if p.is_dir()]
        if not inner:
            continue
        _copy_tree(inner[0], root / d)
        if label in ("dsm", "mfa"):
            _restamp_validation_reports(root / d, dst)
        installed[label] = _count(root / d)
    return installed
