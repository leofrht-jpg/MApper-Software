# MApper

**Unified LCA · DSM/MFA · pLCA · AESA — a single workflow for system-level, time-resolved environmental sustainability analysis.**

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](LICENSE)
[![Build](https://github.com/leofrht-jpg/MApper-Software/actions/workflows/ci.yml/badge.svg)](https://github.com/leofrht-jpg/MApper-Software/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/leofrht-jpg/MApper-Software/releases)
[![DOI](https://img.shields.io/badge/DOI-pending-lightgrey.svg)](#citation)

MApper is a desktop application that integrates **Life Cycle Assessment (LCA)**, **Dynamic Stock Modelling / Material Flow Analysis (DSM/MFA)**, **prospective LCA (pLCA)**, and **Absolute Environmental Sustainability Assessment (AESA)** in one workflow. It is built for researchers who need to evaluate the environmental impact of evolving material systems over time and against planetary boundaries.

**Website:** [mapper.leonardoferhati.com](https://mapper.leonardoferhati.com)

---

## Why MApper

These four methods are usually run in separate tools, by hand, with brittle data hand-offs between them. The integration is where the scientific value sits — and where the work disappears today.

- **LCA** tells you the impact of a product.
- **DSM/MFA** tells you how a *stock* of products and its material flows evolve over time.
- **pLCA** tells you how background impacts shift under future energy scenarios.
- **AESA** tells you whether the resulting impact is *absolutely* sustainable — i.e. within a fair share of planetary boundaries.

MApper couples all four in one **cohort-preserving** pipeline: a time-resolved material flow feeds time-matched prospective inventories, which produce year-by-year impacts, which are assessed against an assigned fair share of the planetary boundaries (Sustainability Ratios). One model, one data path, no manual stitching — every product cohort keeps its identity (fuel type, size, birth year) from LCA → pLCA → DSM/MFA → AESA. That four-method integration is MApper's reason to exist.

**Reference study:** the **Danish passenger-car fleet, 2025–2050** — a full LCA → prospective-LCA → DSM/MFA → AESA run on an evolving vehicle stock under SSP scenarios. MApper is general-purpose, though: the same pipeline applies to wind turbines, buildings, electronics, food systems, or any other evolving product system.

## Features

- **LCA Engine** — Brightway2 integration with ecoinvent 3.10. Multi-method LCIA with contribution analysis, treemaps, and Sankey diagrams; multi-archetype comparison with per-stage breakdown.
- **Dynamic Stock Modelling** — Cohort-based stock dynamics with Weibull survival and system-level projections. Material flow quantification grouped by material, component, stage, or archetype.
- **Prospective LCA** — premise integration for 6 IAMs (REMIND, REMIND-EU, IMAGE, MESSAGE, GCAM, TIAM-UCL) × SSP1–5 scenarios. Year-matched background databases.
- **AESA** — Planetary-boundary assessment with customizable sharing principles. Radar charts positioning your system relative to the safe operating space.
- **Archetype System** — Hierarchical Bills of Materials with ecoinvent linking, folder organization, and material evolution modeling (learning rates, milestones, rebound effects).
- **Impact Assessment** — Stage-aware scope filtering (Manufacturing→inflows, Operation→stock, End of Life→outflows). UMFPACK-optimized multi-indicator calculation. Comprehensive Excel export.

## Architecture

- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **Backend:** FastAPI + Python 3.11
- **LCA engine:** Brightway2 + bw2calc (UMFPACK factorization reuse)
- **DSM engine:** Cohort-based dynamic stock model with Weibull survival
- **Prospective:** premise 2.1.3
- **Desktop packaging:** Tauri v2

## Quickstart

### Prerequisites

- [Miniconda](https://docs.conda.io/en/latest/miniconda.html) or Anaconda
- [Node.js 18+](https://nodejs.org)
- An ecoinvent 3.10 license and `.7z` file (cutoff system model) — see note below

### Install & run

```bash
git clone https://github.com/leofrht-jpg/MApper-Software.git
cd MApper-Software
chmod +x setup.sh
./setup.sh        # creates the conda env, installs backend + frontend deps
./start.sh        # starts backend (FastAPI) + frontend (Vite)
```

Open [http://localhost:5173](http://localhost:5173).

### Example: first analysis

1. **Database Explorer** → import your ecoinvent `.7z` file (~10 min).
2. *(Optional)* **pLCA Developer** → generate prospective databases (requires a premise key).
3. **LCA Architect** → import or create archetypes (Bills of Materials).
4. **DSM Modeller** → upload stock + inflows data.
5. **Impact Assessment** → set cohort mappings → calculate.
6. *(Optional)* **AESA** → compare impacts against planetary boundaries.

> **Prospective LCA** requires a premise encryption key. Email `romain.sacchi@psi.ch` for a key, then `mkdir -p ~/.premise && echo 'YOUR_KEY' > ~/.premise/premise_key`.

Full instructions are in [INSTALL.md](INSTALL.md).

## System requirements

|         | Minimum                               | Recommended                  |
| ------- | ------------------------------------- | ---------------------------- |
| RAM     | 8 GB                                  | 16 GB                        |
| Disk    | 5 GB                                  | 15 GB (with prospective DBs) |
| OS      | macOS 13+, Windows 10+, Ubuntu 22.04+ |                              |
| Python  | 3.11                                  | 3.11                         |
| Node.js | 18                                    | 20+                          |

## Commercial use

**MApper is free for everyone, including for commercial use**, under the
[Mozilla Public License 2.0](LICENSE). You can use it in companies, consulting
work, and commercial research without a fee. The MPL applies file-level
copyleft: if you modify MApper's own source files and distribute them, those
modified files must remain under MPL 2.0 — but you may combine MApper with
proprietary code in a larger work.

<!-- DRAFT — DO NOT PUBLISH until the DTU secondary-employment arrangement is in
place (contact: Frida, dept. innovation). The paid-services menu below must NOT
be rendered/advertised before that arrangement exists. Keep this entire block
inside this HTML comment.

DTU may offer optional paid services around MApper for organizations that want
support beyond the open-source project:

- Training and certification — workshops and certified user/practitioner programs.
- Consulting — applied LCA/DSM/pLCA/AESA studies using MApper.
- Custom development — bespoke features, connectors, and methods.
- Support contracts — prioritized support and SLAs.
- Hosted SaaS — managed cloud deployment.
- Commercial extensions — closed-source add-ons.

Commercial-services contact (once live): leo_frht@icloud.com · /commercial page on the website.
END DRAFT -->

For general inquiries: **[leo_frht@icloud.com](mailto:leo_frht@icloud.com)**.

## Contributing

Contributions are welcome and are accepted under MPL 2.0 with DTU as the
copyright holder. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request. Security
issues: see [SECURITY.md](SECURITY.md).

## Citation

If you use MApper in your research, please cite it. A JOSS (Journal of Open
Source Software) paper is in preparation; the DOI will be added here once
published.

```bibtex
@software{ferhati_mapper_2026,
  author    = {Ferhati, Leonardo},
  title     = {MApper: A unified platform for Life Cycle Assessment,
               Dynamic Stock Modelling, prospective LCA, and Absolute
               Environmental Sustainability Assessment},
  year       = {2026},
  publisher  = {Technical University of Denmark},
  url        = {https://mapper.leonardoferhati.com},
  note       = {JOSS paper and DOI forthcoming}
}
```

> Citation placeholder — replace `note` with the JOSS DOI once the paper is published.

## Copyright and license

**© Copyright 2026 Technical University of Denmark**

- **Copyright holder:** Technical University of Denmark (DTU).
- **Lead developer:** Leonardo Ferhati.
- **License:** Mozilla Public License 2.0 (MPL-2.0). Full text in [LICENSE](LICENSE).

MApper depends on third-party open-source software, each under its own license —
see [NOTICE](NOTICE) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
The ecoinvent database and IAM scenario data are separately licensed and are
**not** distributed with MApper; users must supply their own licensed data.

## Contact

- **Project & commercial inquiries:** [leo_frht@icloud.com](mailto:leo_frht@icloud.com)
- **Website:** [mapper.leonardoferhati.com](https://mapper.leonardoferhati.com)
- **Developer:** [leonardoferhati.com](https://leonardoferhati.com)
