# MApper Installation Guide

## Prerequisites

- **Miniconda** or Anaconda ([download](https://docs.conda.io/en/latest/miniconda.html))
- **Node.js 18+** ([download](https://nodejs.org))
- **ecoinvent 3.10** licence and `.7z` file (cutoff system model) — needed
  for real assessments only. To try MApper without one, see
  [Try it without ecoinvent](README.md#try-it-without-ecoinvent).
- **Git** ([download](https://git-scm.com))

## Quick Start (macOS / Linux)

```bash
git clone https://github.com/leofrht-jpg/MApper-Software.git
cd MApper-Software

conda env create -f environment.yml   # pinned environment; the one CI uses
conda activate map

# The sparse solver that makes prospective LCA fast. Kept out of
# environment.yml because conda-forge publishes no Windows build.
conda install -c conda-forge scikit-umfpack=0.3.3 suitesparse

( cd mapper-frontend && npm ci )

./start.sh
```

`./setup.sh` runs exactly these steps in one command. It leaves an existing
`map` environment untouched; pass `--force` to recreate it.

Then open http://localhost:5173

## Quick Start (Windows)

```bat
git clone https://github.com/leofrht-jpg/MApper-Software.git
cd MApper-Software

conda env create -f environment.yml
conda activate map

cd mapper-frontend && npm ci && cd ..

setup.bat        REM writes start.bat (not tracked in the repo)
start.bat
```

`setup.bat` runs the same steps in one command and additionally writes
`start.bat`. It leaves an existing `map` environment untouched; pass `--force`
to recreate it.

> `scikit-umfpack` is not installed on Windows — conda-forge has no win-64
> build. Windows uses the `spsolve` fallback: correct, but slower for
> prospective LCA.

## First Run

1. Open MApper in your browser (http://localhost:5173)
2. Go to **Database Explorer** → Import your ecoinvent `.7z` file
3. Wait for import (~5–10 minutes for 23,000 activities)
4. Start exploring!

## Optional: Premise Key (for Prospective LCA)

To generate prospective databases, you need an encryption key:
1. Email romain.sacchi@psi.ch to request a key
2. In MApper, go to **Settings → Premise** and paste the key, or write it manually: `mkdir -p ~/.premise && echo 'YOUR_KEY' > ~/.premise/premise_key`
3. Go to **pLCA Developer** in MApper to generate future databases

## System Requirements

|         | Minimum                                   | Recommended                    |
| ------- | ----------------------------------------- | ------------------------------ |
| RAM     | 8 GB                                      | 16 GB                          |
| Disk    | 5 GB                                      | 15 GB (with prospective DBs)   |
| OS      | macOS 13+, Windows 10+, Ubuntu 22.04+     |                                |
| Python  | 3.11                                      | 3.11                           |
| Node.js | 18                                        | 20+                            |

## Troubleshooting

**Port already in use:** Kill existing processes: `lsof -ti :8000 | xargs kill`
**ecoinvent import fails:** Use the cutoff `.7z` file (not lci or lcia variants)
**Premise key error:** Verify key is saved in `~/.premise/premise_key` (single line, no spaces)

## Contact

Leonardo Ferhati — leo_frht@icloud.com
mapper.leonardoferhati.com
