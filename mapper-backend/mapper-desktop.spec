# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

# PyInstaller spec for the MApper backend desktop sidecar (onefile).
#
# Freezes desktop_entry.py (uvicorn + FastAPI app) into a single binary the
# Tauri shell spawns. The heavy scientific stack (Brightway2 family + premise +
# ecoinvent_interface) has dynamic imports and bundled data files that need
# explicit collection; numpy/scipy/pandas rely on PyInstaller's built-in hooks.
#
# Build:  pyinstaller mapper-desktop.spec --noconfirm   (from mapper-backend/)
# Output: dist/mapper-backend  (rename to mapper-backend-<target-triple> for Tauri)
#   macOS: mapper-backend-aarch64-apple-darwin   (Apple Silicon)
#   Windows: mapper-backend-x86_64-pc-windows-msvc.exe

import sys as _sys

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

datas = []
binaries = []
hiddenimports = []

# Packages with no PyInstaller hook + dynamic imports / bundled data → collect all.
for pkg in [
    "brightway2", "bw2data", "bw2calc", "bw2io", "bw2analyzer",
    "bw_processing", "matrix_utils", "stats_arrays",
    "premise", "wurst", "constructive_geometries", "ecoinvent_interface",
    "fsspec", "platformdirs", "peewee", "pint", "openpyxl", "xarray", "yaml",
    # premise / bw2io data-bearing deps that ship non-.py files (VERSION, CSVs,
    # JSON schemas) read at import time — must be collected explicitly.
    "datapackage", "tableschema", "tabulator", "jsonschema",
    "jsonschema_specifications", "country_converter", "premise_gwp", "unfold",
    "sparse", "prettytable", "schema", "cryptography", "requests", "certifi",
    "frictionless",
]:
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as exc:  # noqa: BLE001 — a missing optional dep must not abort the freeze
        print(f"[spec] collect_all skipped for {pkg}: {exc}")

# Bundle the ENTIRE mapper/data/ tree in ONE datas entry (recursive). This holds
# ALL runtime reference data the frozen backend reads:
#   - aesa/boundary_sets.json, aesa/sharing_data.json, aesa/carbon_budgets.json,
#     aesa/ssp_trajectories.json, aesa/co2e_ratio/*   (AESA — aesa_engine.py)
#   - grid_intensity.json                             (system.py)
#   - lcia_methods.json                               (lcia_method_engine.py)
# Every reader resolves paths as Path(__file__).parent.parent / "data" / …, which
# PyInstaller maps to _MEIPASS/mapper/data/… when frozen — so the whole tree MUST
# land at that dest, or those endpoints 500 (AESA "Couldn't load sharing presets",
# grid-intensities, …). NOTE: collect_data_files("mapper") returns nothing usable
# for this LOCAL (non-pip-installed) package; the explicit directory entry below
# is the reliable fix. A single directory source is included recursively.
import os as _os2

datas += collect_data_files("mapper")  # harmless; returns nothing usable for the local pkg
hiddenimports += collect_submodules("mapper")

_mapper_data = _os2.path.join(_os2.path.dirname(_os2.path.abspath(SPEC)), "mapper", "data")
if _os2.path.isdir(_mapper_data):
    datas += [(_mapper_data, "mapper/data")]   # ('mapper/data', 'mapper/data') — whole tree
else:
    print(f"[spec] WARNING: mapper/data not found at {_mapper_data}")

# Bundle the BUILT frontend so the backend can serve it over http://localhost:PORT
# (same origin as the API). This is what lets the desktop webview reach the
# backend: WKWebView blocks cleartext-HTTP calls from the secure tauri:// page as
# mixed content, so the Tauri shell navigates to the backend-served copy instead
# (see desktop_entry._mount_frontend + mapper-tauri/src/main.rs). Build the
# frontend first: `cd ../mapper-frontend && VITE_API_BASE=http://localhost:8765 npm run build`.
import os as _os

_frontend_dist = _os.path.join(_os.path.dirname(_os.path.abspath(SPEC)), "..", "mapper-frontend", "dist")
if _os.path.isfile(_os.path.join(_frontend_dist, "index.html")):
    for _root, _dirs, _files in _os.walk(_frontend_dist):
        for _f in _files:
            _abs = _os.path.join(_root, _f)
            _rel = _os.path.relpath(_abs, _frontend_dist)
            # Place under "frontend/<relative path>" inside the bundle (matches
            # desktop_entry's Path(sys._MEIPASS) / "frontend").
            datas.append((_abs, _os.path.join("frontend", _os.path.dirname(_rel))))
else:
    print(f"[spec] WARNING: frontend dist not found at {_frontend_dist} — build it before freezing")

# uvicorn[standard] loads its protocol/loop implementations dynamically.
hiddenimports += collect_submodules("uvicorn")
hiddenimports += [
    "websockets", "websockets.legacy", "httptools",
    "anyio", "anyio._backends._asyncio",
]

# uvloop is a Unix-only event-loop accelerator (libuv binding).  It has no
# Windows wheels and is not importable there — including it on Windows causes
# PyInstaller to error out or the frozen binary to crash at startup.
if _sys.platform != "win32":
    hiddenimports += ["uvloop"]

# Windows asyncio event-loop backends (IocpProactor / SelectorEventLoop).
# PyInstaller typically auto-collects these, but list them explicitly as
# belt-and-suspenders — harmless on Windows, ignored on other platforms.
if _sys.platform == "win32":
    hiddenimports += [
        "asyncio.windows_events",
        "asyncio.windows_utils",
    ]

# bw2calc's UMFPACK sparse solver (SuiteSparse via scikit-umfpack). This is the
# factorisation-reuse path: WITH it, a prospective run factorises each premise db
# ONCE (≈4.5 s) and back-substitutes (≈0.035 s) for every later solve — a 26yr ×
# 25-indicator run is ≈34 s. WITHOUT it, bw2calc re-solves the full technosphere
# every call and the same run takes tens of minutes (the frozen build was doing
# exactly this — ≈54 min for 3 scenarios).
#
# The install (scikit-umfpack 0.3.3) does `from numpy.testing import Tester` at
# import, which numpy ≥1.25 removed. The RUNTIME already handles this: bw2_wrapper
# ._patch_umfpack_import() stubs `numpy.testing.Tester` BEFORE importing, so
# `_UMFPACK_OK` is True in-process (that ordering is in the app code and is
# UNCHANGED here). But the FREEZE was failing for a DIFFERENT reason: the previous
# spec guard did a BARE `import scikits.umfpack` (no shim) → ImportError → the
# extension + its SuiteSparse dylibs were never bundled ("scikits.umfpack not
# found" in the freeze log). Fix = apply the SAME shim at BUILD time so Analysis
# can import it, then bundle the compiled extension AND the SuiteSparse dylibs
# EXPLICITLY (collect_dynamic_libs / collect_all return EMPTY for this package —
# the dylibs live in $CONDA_PREFIX/lib, outside the package dir, the classic
# Apple-Silicon conda layout). This is a packaging fix only; no numpy-2 /
# scikit-umfpack-0.4.2 migration.
import glob as _glob

import numpy.testing as _nt_shim  # noqa: E402
if not hasattr(_nt_shim, "Tester"):
    class _DummyTester:  # build-time shim; mirrors bw2_wrapper._patch_umfpack_import
        def __init__(self, *a, **k):
            pass

        def test(self, *a, **k):
            pass

    _nt_shim.Tester = _DummyTester  # type: ignore[attr-defined]

try:
    import scikits.umfpack as _skumf  # noqa: F401
    _umfpack_importable = True
except Exception as _umfpack_exc:  # noqa: BLE001
    _umfpack_importable = False
    print(
        f"[spec] scikits.umfpack STILL not importable after shim "
        f"({type(_umfpack_exc).__name__}: {_umfpack_exc}) — bundling skipped, "
        "prospective runs will use the slow SuperLU fallback"
    )

if _umfpack_importable:
    hiddenimports += [
        "scikits", "scikits.umfpack", "scikits.umfpack._umfpack",
        "scikits.umfpack.umfpack", "scikits.umfpack.interface",
    ]
    # (1) The compiled extension module (.so). collect_dynamic_libs returns []
    #     for it, so add every .so under the package dir explicitly, at its
    #     package dest so Python can import it when frozen.
    _skdir = _os.path.dirname(_skumf.__file__)
    _added_exts = 0
    for _ext in _glob.glob(_os.path.join(_skdir, "*.so")):
        binaries.append((_ext, "scikits/umfpack"))
        _added_exts += 1
    # (2) The SuiteSparse dylibs the extension links via @rpath. They live in
    #     $CONDA_PREFIX/lib (outside the package), so no collector finds them.
    #     Add each @rpath-referenced soname (closure of __umfpack.*.so →
    #     libumfpack.5 → cholmod/amd/… ) so PyInstaller places them in _internal/
    #     and rewrites the @rpath. blas/lapack are openblas symlinks; include the
    #     .3 sonames cholmod references by name.
    _conda_lib = _os.path.join(_sys.prefix, "lib")
    _suitesparse_dylibs = [
        "libumfpack.5.dylib", "libamd.2.dylib", "libcholmod.3.dylib",
        "libcolamd.2.dylib", "libccolamd.2.dylib", "libcamd.2.dylib",
        "libsuitesparseconfig.5.dylib", "libmetis.dylib",
        "libblas.3.dylib", "liblapack.3.dylib",
    ]
    _added_dylibs = 0
    for _name in _suitesparse_dylibs:
        _p = _os.path.join(_conda_lib, _name)
        if _os.path.exists(_p):
            binaries.append((_p, "."))
            _added_dylibs += 1
        else:
            print(f"[spec] WARNING: SuiteSparse dylib not found: {_p}")
    print(
        f"[spec] UMFPACK bundled: {_added_exts} extension(s) + "
        f"{_added_dylibs} SuiteSparse dylibs"
    )

a = Analysis(
    ["desktop_entry.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    # matplotlib is required (bw2analyzer imports it); keep only GUI toolkits and
    # dev shells excluded. matplotlib uses the Agg backend here — no tkinter.
    excludes=["tkinter", "PyQt5", "PySide2", "PySide6", "IPython", "notebook"],
    noarchive=False,
)

pyz = PYZ(a.pure)

# ONEDIR mode (not onefile): the entrypoint EXE excludes the binaries/datas,
# and COLLECT gathers them into a directory alongside it. This ELIMINATES the
# ~2 min per-launch self-extraction of the onefile bootloader (which unpacked
# ~346 MB to a fresh _MEIPASS every start) — onedir has NO extraction step, so
# cold boot drops to ~10 s. The Tauri shell bundles the whole output directory
# as a resource and spawns the entrypoint from it (see tauri.conf.json
# bundle.resources + mapper-tauri/src/main.rs). datas/binaries/hiddenimports in
# Analysis above are IDENTICAL to the onefile spec — only the packaging changed.
#
# PyInstaller 6.x onedir layout: dist/mapper-backend/mapper-backend (entrypoint)
# + dist/mapper-backend/_internal/** (all .so/.dylib + mapper/data + frontend).
# sys._MEIPASS resolves to _internal/, so every Path(__file__)-relative reader
# (mapper/data/**, the served frontend) lands correctly with no code change.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,   # <-- onedir: binaries live beside the exe, not inside it
    name="mapper-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="mapper-backend",   # <-- output dir: dist/mapper-backend/
)
