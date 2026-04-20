# MApper

**Unified LCA · MFA · pLCA · AESA for environmental sustainability**

The first desktop application integrating Life Cycle Assessment, Material Flow Analysis, prospective LCA, and Absolute Environmental Sustainability Assessment in a single workflow. Built for researchers who need system-level, time-resolved environmental impact analysis against planetary boundaries.

**Website:** [mapper.leonardoferhati.com](https://mapper.leonardoferhati.com)

## Features

- **LCA Engine** — Full brightway2 integration with ecoinvent 3.10. Multi-method LCIA with contribution analysis, treemaps, and Sankey diagrams. Multi-archetype comparison with per-stage breakdown.
- **Material Flow Analysis** — Dynamic stock modeling with Weibull survival, cohort tracking, and system-level projections. Material flow quantification grouped by material, component, stage, or archetype.
- **Prospective LCA** — premise integration for 6 IAMs (REMIND, REMIND-EU, IMAGE, MESSAGE, GCAM, TIAM-UCL) × SSP1-5 scenarios. Year-matched background databases for time-resolved impact assessment.
- **AESA** — Planetary boundary assessment with customizable sharing principles. Radar charts showing your system's position relative to the safe operating space.
- **Archetype System** — Hierarchical Bills of Materials with ecoinvent linking, folder organization, and material evolution modeling (learning rates, milestones, rebound effects).
- **Impact Assessment** — Stage-aware scope filtering (Manufacturing→inflows, Operation→stock, End of Life→outflows). Multi-indicator calculation with UMFPACK-optimized performance. Comprehensive Excel export.

## Architecture

- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **Backend:** FastAPI + Python 3.11
- **LCA engine:** brightway2 + bw2calc (UMFPACK factorization reuse)
- **MFA engine:** Custom dynamic stock model with Weibull survival
- **Prospective:** premise 2.1.3
- **Future:** Tauri v2 desktop packaging

## Quick Start

### Prerequisites

- [Miniconda](https://docs.conda.io/en/latest/miniconda.html) or Anaconda
- [Node.js 18+](https://nodejs.org)
- ecoinvent 3.10 license and `.7z` file (cutoff system model)

### Setup

```bash
git clone https://github.com/leofrht-jpg/MApper-Software.git
cd MApper
chmod +x setup.sh
./setup.sh
```

### Run

```bash
./start.sh
```

Open [http://localhost:5173](http://localhost:5173)

### First Run

1. Go to **Database Explorer** → Import your ecoinvent `.7z` file (~10 min)
2. Go to **LCA Architect** → Import archetypes or create new ones
3. Go to **MFA Modeller** → Upload stock + inflows data
4. Go to **Impact Assessment** → Set cohort mappings → Calculate

### Prospective LCA (optional)

Requires a premise encryption key:
1. Email `romain.sacchi@psi.ch` to request a key
2. Save it: `mkdir -p ~/.premise && echo 'YOUR_KEY' > ~/.premise/premise_key`
3. Go to **pLCA Developer** → Generate prospective databases

## System Requirements

| | Minimum | Recommended |
|---|---|---|
| RAM | 8 GB | 16 GB |
| Disk | 5 GB | 15 GB (with prospective DBs) |
| OS | macOS 13+, Windows 10+, Ubuntu 22.04+ |
| Python | 3.11 | 3.11 |
| Node.js | 18 | 20+ |

## Performance

- UMFPACK matrix factorization reuse: **8x speedup** over naive approach
- 26 years × 39 cohorts × 8 indicators: **~20 seconds** (was ~2.5 minutes)
- Single archetype LCA (38 materials × 8 indicators): **~4 seconds**

## Citation

If you use MApper in your research, please cite:

```
Ferhati, L. (2026). MApper: A unified platform for Life Cycle Assessment,
Material Flow Analysis, prospective LCA, and Absolute Environmental
Sustainability Assessment. https://mapper.leonardoferhati.com
```

## License

All rights reserved. © 2026 Leonardo Ferhati.

## Contact

- **Leonardo Ferhati** — [leofe@dtu.dk](mailto:leofe@dtu.dk)
- **Website** — [leonardoferhati.com](https://leonardoferhati.com)
