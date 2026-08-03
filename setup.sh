#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati
#
# Optional convenience wrapper. The documented setup path is:
#
#     conda env create -f environment.yml
#     conda activate map
#     conda install -c conda-forge scikit-umfpack=0.3.3 suitesparse   # macOS/Linux
#     ( cd mapper-frontend && npm ci )
#
# This script runs exactly those steps; it does nothing you cannot do by hand.
#
# It will NOT touch an existing `map` environment. The previous version ran
# `conda create -n map` and then pip-installed into whatever `map` already was,
# silently mutating a working environment and mixing a loose pip dependency set
# into the pinned conda one. Recreating is now opt-in via --force.
set -euo pipefail

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      echo "Usage: ./setup.sh [--force]"
      echo
      echo "Creates the 'map' conda environment from environment.yml, adds the"
      echo "sparse solver on macOS/Linux, and installs frontend packages."
      echo
      echo "  --force   remove and recreate an existing 'map' environment"
      exit 0 ;;
    *) echo "Unknown argument: $arg (try --help)"; exit 2 ;;
  esac
done

echo "=== MApper setup ==="
echo

command -v conda >/dev/null 2>&1 || {
  echo "conda not found. Install Miniconda: https://docs.conda.io/en/latest/miniconda.html"
  exit 1
}
command -v node >/dev/null 2>&1 || {
  echo "Node.js not found. Install from https://nodejs.org (v20+; CI uses 24)"
  exit 1
}

eval "$(conda shell.bash hook)"

# ── conda environment ────────────────────────────────────────────────────────
if conda env list | awk '{print $1}' | grep -qx "map"; then
  if [ "$FORCE" -eq 1 ]; then
    echo "Removing existing 'map' environment (--force)…"
    conda env remove -n map -y
    echo "Creating 'map' from environment.yml…"
    conda env create -f environment.yml
  else
    echo "A conda environment named 'map' already exists — leaving it alone."
    echo
    echo "  Update it in place:  conda env update -f environment.yml --prune"
    echo "  Recreate it:         ./setup.sh --force"
    echo
    echo "Skipping environment creation; continuing with the frontend."
  fi
else
  echo "Creating 'map' from environment.yml…"
  conda env create -f environment.yml
fi

conda activate map

# ── sparse solver (macOS/Linux only) ─────────────────────────────────────────
# Not in environment.yml because conda-forge has no win-64 build, which would
# make that file unsolvable on Windows. Prospective-LCA speed depends on it:
# without UMFPACK a run falls back to spsolve-per-call and takes tens of
# minutes instead of under a minute.
case "$(uname -s)" in
  Darwin|Linux)
    # find_spec, NOT `import scikits.umfpack`: the raw import ALWAYS fails on
    # numpy >= 1.25 (it references the removed numpy.testing.Tester and needs
    # the shim in bw2_wrapper._patch_umfpack_import). Using the import as the
    # guard made this branch run every time and reinstall into an existing
    # environment — the behaviour this script exists to avoid.
    if python -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('scikits.umfpack') else 1)" >/dev/null 2>&1; then
      echo "scikit-umfpack already present."
    else
      echo "Installing scikit-umfpack (prospective-LCA fast path)…"
      conda install -y -c conda-forge scikit-umfpack=0.3.3 suitesparse
    fi ;;
  *)
    echo "Skipping scikit-umfpack (no conda-forge build for this platform)." ;;
esac

# ── frontend ─────────────────────────────────────────────────────────────────
echo "Installing frontend packages…"
( cd mapper-frontend && npm ci )

# NOTE: start.sh is tracked in the repository and is deliberately NOT
# regenerated here. The old script overwrote it on every run, discarding any
# local edits.

echo
echo "Setup complete."
echo
echo "  Start MApper:   ./start.sh     (then open http://localhost:5173)"
echo
echo "  No ecoinvent licence? Run the demo — synthetic data, nothing to download:"
echo "      cd mapper-backend && python scripts/load_demo_project.py --verify"
echo
echo "  Real assessments need your own ecoinvent database:"
echo "      Database Explorer -> Import -> select your ecoinvent .7z"
echo
echo "  Prospective LCA additionally needs a premise key:"
echo "      mkdir -p ~/.premise && echo 'YOUR_KEY' > ~/.premise/premise_key"
