# MApper

**Unified LCA · MFA · pLCA · AESA for environmental sustainability**

> v0.1.0-alpha · Research Preview

MApper integrates Life Cycle Assessment, Material Flow Analysis, prospective LCA, and Absolute Environmental Sustainability Assessment in a single workflow. It targets researchers needing system-level, time-resolved environmental impact analysis against planetary boundaries.

---

## Core Capabilities

**LCA Engine** — Full Brightway2 integration with ecoinvent. Multi-method LCIA with contribution analysis, treemaps, and Sankey diagrams.

**Material Flow Analysis** — Dynamic stock modeling with Weibull survival, cohort tracking, and system-level projections.

**Prospective LCA** — premise-powered scenario generation. Year-matched background databases for time-resolved impact assessment.

**AESA** — Absolute Environmental Sustainability Assessment. Four integrated methodologies working together in a unified workflow.

**Archetype System** — Hierarchical Bills of Materials with ecoinvent linking, scaling factors, and material evolution modeling.

**Foreground Evolution** — Model technological change through learning rates, milestone-based shifts, and rebound effects in use phase.

## How It Works

1. **Import** — Import ecoinvent databases, define archetypes with linked BOMs
2. **Model** — Run MFA simulations, set technological learning rates, generate prospective databases
3. **Assess** — Calculate impacts across manufacturing, operation, end-of-life; compare against planetary boundaries

## Tech Stack

| Layer | Stack |
|-------|-------|
| Backend | Python · FastAPI · Brightway2 · premise |
| Frontend | React · TypeScript · Vite · Recharts · Zustand |
| Desktop | Tauri (planned) |

## Research Philosophy

Methods are transparent and auditable. Results are reproducible. Compatible with ecoinvent cut-off, consequential, and APOS system models.

- 4 methodologies
- Unlimited system size
- 0 cloud dependencies

## Author

**Leonardo Ferhati** — PhD Candidate, System Analysis for Absolute Sustainability of Electric Vehicles

- [mapper.leonardoferhati.com](https://mapper.leonardoferhati.com)
- [leoferhati.com](https://leoferhati.com)
