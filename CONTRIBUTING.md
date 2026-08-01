# Contributing to MApper

Thanks for your interest in contributing to MApper. This document explains how
to set up a development environment, our code style and testing expectations,
the pull request process, and the licensing terms for contributions.

MApper is developed at the **Technical University of Denmark (DTU)**, which is
the copyright holder of the project.

## Code of Conduct

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development environment

MApper has a FastAPI/Python backend and a React/TypeScript/Vite frontend.

### Prerequisites

- [Miniconda](https://docs.conda.io/en/latest/miniconda.html) or Anaconda
- [Node.js 18+](https://nodejs.org) (20+ recommended)
- Git

### Setup

```bash
git clone https://github.com/leofrht-jpg/MApper-Software.git
cd MApper-Software
conda env create -f environment.yml    # pinned env; same one CI uses
conda activate map
( cd mapper-frontend && npm ci )
./start.sh                             # runs backend + frontend for development
```

`environment.yml` is the reference environment and is what CI installs, so it is
the one to use if you want your results to match the pipeline. `./setup.sh` still
works but creates a looser env from `mapper-backend/requirements.txt`.

On macOS/Linux, add the sparse solver after creating the env — it is not in
`environment.yml` because conda-forge has no Windows build, and release builds
need it for the prospective-LCA fast path:

```bash
conda install -c conda-forge scikit-umfpack=0.3.3 suitesparse
```

- **Backend** lives in `mapper-backend/` (package `mapper`). FastAPI app entry: `mapper-backend/mapper/main.py`.
- **Frontend** lives in `mapper-frontend/` (source in `src/`).

See [INSTALL.md](INSTALL.md) for ecoinvent and premise data setup.

## Code style and testing

### Backend (Python)

- Target Python 3.11.
- Follow PEP 8; keep functions focused and typed where practical.
- Run the test suite before opening a PR:

  ```bash
  cd mapper-backend
  python -m pytest tests/
  ```

  Use `python -m pytest`, not bare `pytest`: there is no `conftest.py` and the
  backend is not pip-installed, so `import mapper` only resolves because
  `python -m` puts the working directory on `sys.path`. Bare `pytest` fails at
  collection.

  19 of the 695 tests need a real ecoinvent database and skip themselves when
  none is present, so a clean checkout runs 676.

### Frontend (TypeScript/React)

- TypeScript with the project's ESLint config.

  ```bash
  cd mapper-frontend
  npm run lint
  npm run type-check
  npm run test:run
  ```

### License headers

Every source file must carry the MPL 2.0 header (see below). New files must
include it. You can verify coverage with:

```bash
python scripts/check_license_headers.py
```

## Pull request process

1. **Open an issue first** for non-trivial changes so we can agree on the approach.
2. **Fork** the repository and create a topic branch (`feature/...` or `fix/...`).
3. Make your change with **tests** and keep the diff focused.
4. Ensure lint, type-check, and tests pass for the parts you touched.
5. Ensure all new source files carry the MPL 2.0 license header.
6. Open a PR with a clear description of the motivation and the change. Link the
   related issue.
7. A maintainer reviews; address feedback; once approved and CI is green it gets
   merged.

### Continuous integration

Every push to `main` and every PR targeting `main` runs
[`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Job | Runner | What it does |
| --- | --- | --- |
| `frontend` | ubuntu-latest, Node 24 | `npm ci`, `npm run type-check`, `npx vitest run` |
| `backend (macos-latest)` | macOS | `python -m pytest` over the whole suite |
| `backend (windows-latest)` | Windows | one pytest process per test file |

**PRs must pass CI before they can be merged.** If a job fails, fix the cause
rather than excluding the test — an environment-dependent test may be skipped
with a documented reason, but assertions should not be removed to get green.

Windows runs one process per file on purpose: a single-process run of the whole
suite dies part-way with a native access violation, because premise's GDAL/geo
stack and openpyxl's lxml/libxml2 pull conflicting native libraries into one
interpreter.

## Licensing of contributions

- MApper is licensed under the **Mozilla Public License 2.0 (MPL-2.0)**.
- **All contributions are accepted under MPL-2.0.** By submitting a contribution
  you agree that it is licensed under MPL-2.0.
- **DTU is the copyright holder** of the project. Contributions are made with the
  understanding that copyright in contributed material is handled per the CLA
  below.

### Contributor License Agreement (CLA)

> **Placeholder — CLA/DCO structure is to be finalized with DTU.**
>
> DTU intends to require a Contributor License Agreement or Developer
> Certificate of Origin (individual and/or corporate) before substantial
> contributions can be merged. The exact instrument (CLA vs DCO) and its text
> are **to be determined with DTU's Technology Transfer Office** — contact
> **Kamilla (TTO jurist)** at DTU. The agreement will confirm that you have the
> right to contribute the material and will set out the rights granted to DTU as
> copyright holder.
>
> **Maintainer note:** contributor-IP handling **must be confirmed with DTU
> before any external pull request is accepted or merged.** Until the CLA/DCO
> process is published, external contributions may be held pending. If you are
> planning a significant contribution, contact **leo_frht@icloud.com** to coordinate.

### New source file header

Add this header to the top of every new source file.

**Python:**

```python
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati
```

**TypeScript / JavaScript:**

```ts
/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */
```

## Questions

Open an issue or contact **leo_frht@icloud.com**.
