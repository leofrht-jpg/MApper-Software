# Third-Party Licenses

MApper is released under the [Mozilla Public License 2.0](LICENSE). It depends
on third-party open-source software, each component remaining under its own
license. This file lists those dependencies and their licenses, fulfilling the
attribution requirements of the permissive licenses involved.

Versions reflect the versions pinned/resolved at the time of public release.
Transitive dependencies are not exhaustively listed; the authoritative,
complete trees are `mapper-backend/requirements.txt` (+ the resolved conda/pip
environment) and `mapper-frontend/package-lock.json`.

> **Note on data.** Third-party *data* (the ecoinvent database and IAM scenario
> data used by premise) is separately licensed and is **not** bundled with
> MApper. See the [Third-party data](#third-party-data) section below.

---

## Explicit acknowledgements

### Brightway2 (BSD 3-Clause)
MApper's life cycle assessment engine is built on the **Brightway2** framework.
Copyright © Chris Mutel and ETH Zürich. Licensed under the BSD 3-Clause License.
- Project: https://brightway.dev
- Components used: `brightway2`, `bw2data`, `bw2io`, `bw2calc`, `bw2analyzer`

### premise (BSD 3-Clause)
MApper's prospective LCA functionality is built on **premise** (PRospective
EnvironMental Impact ASsEssment). Copyright © Romain Sacchi et al., Paul Scherrer
Institut (PSI). Licensed under the BSD 3-Clause License.
- Project: https://github.com/polca/premise

---

## Python dependencies (backend)

| Package | Version | License |
|---|---|---|
| fastapi | 0.135.2 | MIT |
| uvicorn | 0.42.0 | BSD 3-Clause |
| pydantic | 2.12.5 | MIT |
| brightway2 | 2.4.7 | BSD 3-Clause |
| bw2data | 3.6.6 | BSD 3-Clause |
| bw2io | 0.8.12 | BSD 3-Clause |
| bw2calc | 1.8.2 | BSD 3-Clause |
| bw2analyzer | 0.10 | BSD 3-Clause |
| premise | 2.1.3 | BSD 3-Clause |
| python-multipart | 0.0.22 | Apache-2.0 |
| websockets | 16.0 | BSD 3-Clause |

`bw2calc` uses UMFPACK (via SciPy/scikit-umfpack); SuiteSparse/UMFPACK is
licensed by Timothy A. Davis under the LGPL/GPL with linking exceptions, and is
not redistributed by MApper.

## Node / JavaScript dependencies (frontend)

| Package | Version | License |
|---|---|---|
| react | 19.2.4 | MIT |
| react-dom | 19.2.4 | MIT |
| zustand | 5.0.12 | MIT |
| recharts | 3.8.1 | MIT |
| d3 | 7.9.0 | ISC |
| d3-sankey | 0.12.3 | BSD 3-Clause |
| @tanstack/react-virtual | 3.13.23 | MIT |
| lucide-react | 1.7.0 | ISC |
| react-joyride | 3.0.2 | MIT |
| jspdf | 4.2.1 | MIT |
| svg2pdf.js | 2.7.0 | MIT |

Build/development tooling (not shipped to end users) includes Vite, TypeScript,
ESLint, Tailwind CSS, Vitest, and Testing Library, each under MIT or
comparable permissive licenses. See `mapper-frontend/package-lock.json` for the
full resolved tree.

---

## Third-party data

These datasets are **separately licensed and not distributed with MApper**.
Users are responsible for obtaining valid licenses and complying with their
terms.

- **ecoinvent** — Life cycle inventory database, licensed by the ecoinvent
  Association (https://ecoinvent.org). MApper does not bundle, redistribute, or
  grant any right to ecoinvent data. Users must provide their own licensed
  ecoinvent database file.
- **IAM scenario data** — Integrated Assessment Model outputs (REMIND, IMAGE,
  MESSAGE, GCAM, TIAM-UCL, and related) used through premise are licensed by
  their respective providers. premise's prospective databases require an
  encryption key issued by the premise authors.

---

## Regenerating this list

- Python: `pip-licenses --format=markdown` (or `pip show <pkg>`) within the
  project environment.
- Node: `npx license-checker --production --summary` within `mapper-frontend/`.

If you find a dependency that is missing or misattributed here, please open an
issue or contact leo_frht@icloud.com.
