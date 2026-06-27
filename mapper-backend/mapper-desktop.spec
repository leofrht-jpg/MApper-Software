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

# The mapper package ships JSON/CSV data (AESA boundary sets, SSP trajectories,
# LCIA registry, grid intensities, …) and its API submodules are wired through
# the router. NOTE: collect_data_files("mapper") silently returns nothing usable
# for this LOCAL (non-pip-installed) package — the data never lands in the freeze,
# which 500s grid-intensities and breaks AESA at runtime. Bundle mapper/data/**
# EXPLICITLY (walk → (src, dest) tuples) so it reliably extracts to
# _MEIPASS/mapper/data, matching the Path(__file__)-relative loads in the code.
import os as _os2

datas += collect_data_files("mapper")  # harmless; kept in case it ever resolves
hiddenimports += collect_submodules("mapper")

_mapper_data = _os2.path.join(_os2.path.dirname(_os2.path.abspath(SPEC)), "mapper", "data")
if _os2.path.isdir(_mapper_data):
    for _root, _dirs, _files in _os2.walk(_mapper_data):
        for _f in _files:
            _abs = _os2.path.join(_root, _f)
            _rel = _os2.path.relpath(_abs, _mapper_data)
            datas.append((_abs, _os2.path.join("mapper", "data", _os2.path.dirname(_rel))))
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
    "websockets", "websockets.legacy", "httptools", "uvloop",
    "anyio", "anyio._backends._asyncio",
    "scikits.umfpack",  # bw2calc's UMFPACK sparse solver (SuiteSparse)
]

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

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
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
