# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati
"""Fail unless the FROZEN Windows sidecar folder carries UMFPACK and everything it loads.

mapper-desktop.spec (win32 branch) adds the scikits.umfpack extension and a list of
SuiteSparse and BLAS DLLs by name. This checks the result of the freeze, not the
spec's intent:

  1. the extension (``__umfpack*.pyd``) and every DLL the spec names are in the folder;
  2. every non-system DLL that any of them IMPORTS (PE import table) or FORWARDS TO
     (PE export forwarders) is also in the folder, or is a Windows system DLL.

A name list alone cannot notice a dependency the spec forgot. The forwarders matter
here: conda-forge's win-64 ``libblas.dll`` and ``liblapack.dll`` are 108 KB stubs
whose every export is forwarded to ``openblas.dll`` (the openblas build) or
``mkl_rt.3.dll`` (the mkl build). Those targets are not in the import table, so a
tool that reads only imports (PyInstaller's own scan included) does not see them.

    python scripts/verify_frozen_umfpack.py mapper-backend/dist/mapper-backend

Needs ``pefile`` (pure Python, ``pip install pefile``). Windows or any host: it only
reads files.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pefile

#: The DLLs mapper-desktop.spec's win32 branch bundles (keep in step with it).
REQUIRED = [
    "umfpack.dll", "cholmod.dll", "amd.dll", "colamd.dll", "camd.dll", "ccolamd.dll",
    "suitesparseconfig.dll", "libblas.dll", "liblapack.dll",
]

#: Imports that Windows or the C runtime provide; not expected in the folder.
SYSTEM = re.compile(
    r"^(api-ms-win-.*|ext-ms-win-.*|kernel32|user32|advapi32|shell32|ole32|oleaut32|ws2_32|"
    r"bcrypt|crypt32|ntdll|msvcrt|ucrtbase|rpcrt4|gdi32|comdlg32|shlwapi|version)\.dll$",
    re.IGNORECASE,
)
#: The Visual C++ runtime. Not a Windows system DLL (the Visual C++ Redistributable ships it), so
#: whether the folder carries its own copy is REPORTED, not failed: a machine without the
#: redistributable would need it, one with it does not.
RUNTIME = re.compile(r"^(vcruntime140(_1)?|msvcp140(_1|_2|_atomic_wait|_codecvt_ids)?|vcomp140|concrt140)\.dll$", re.IGNORECASE)


def imports_of(path: Path) -> list[str]:
    pe = pefile.PE(str(path), fast_load=True)
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]])
    names = [e.dll.decode("ascii", "replace").lower() for e in getattr(pe, "DIRECTORY_ENTRY_IMPORT", [])]
    # Export forwarders: "openblas.dll.dgemm_" or "openblas.dgemm_" -> openblas.dll
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXPORT"]])
    for sym in getattr(getattr(pe, "DIRECTORY_ENTRY_EXPORT", None), "symbols", []):
        if sym.forwarder:
            mod = sym.forwarder.decode("ascii", "replace").lower().rsplit(".", 1)[0]
            names.append(mod if mod.endswith(".dll") else mod + ".dll")
    pe.close()
    return sorted(set(names))


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    root = Path(argv[1])
    if not root.is_dir():
        print(f"not a folder: {root}")
        return 1

    present: dict[str, Path] = {}
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in (".dll", ".pyd"):
            present.setdefault(p.name.lower(), p)

    failures: list[str] = []
    pyds = sorted(p for n, p in present.items() if n.startswith("__umfpack") and n.endswith(".pyd"))
    if not pyds:
        failures.append("the scikits.umfpack extension (__umfpack*.pyd) is not in the frozen folder")
    for name in REQUIRED:
        p = present.get(name)
        if p is None:
            failures.append(f"missing from the frozen folder: {name}")
        else:
            print(f"ok   {name:24s} {p.relative_to(root)}  ({p.stat().st_size:,} bytes)")
    for p in pyds:
        print(f"ok   {p.name:24s} {p.relative_to(root)}  ({p.stat().st_size:,} bytes)")

    # Import closure of the extension and of every required DLL that is present.
    seen: set[str] = set()
    runtime_needed: dict[str, bool] = {}
    todo = [p for p in pyds] + [present[n] for n in REQUIRED if n in present]
    while todo:
        p = todo.pop()
        if p.name.lower() in seen:
            continue
        seen.add(p.name.lower())
        try:
            deps = imports_of(p)
        except pefile.PEFormatError as e:
            failures.append(f"{p.name} is not a readable PE file: {e}")
            continue
        for dep in deps:
            if SYSTEM.match(dep):
                continue
            if RUNTIME.match(dep):
                runtime_needed[dep] = dep in present
                continue
            q = present.get(dep)
            if q is None:
                failures.append(f"{p.name} imports {dep}, which is not in the frozen folder")
            else:
                todo.append(q)
    print(f"checked the import closure of {len(seen)} binaries")
    for dep, bundled in sorted(runtime_needed.items()):
        print(f"{'ok  ' if bundled else 'note'} {dep}: {'bundled in the folder' if bundled else 'NOT in the folder (needs the Visual C++ Redistributable on the target machine)'}")

    if failures:
        print("\nFROZEN BUILD IS INCOMPLETE:")
        for f in sorted(set(failures)):
            print(f"  {f}")
        return 1
    print("\nthe frozen folder carries UMFPACK and its DLL closure")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
