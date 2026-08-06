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

REM The sparse solver that makes prospective LCA fast. conda-forge ships only
REM 0.4.2 for win-64, and its metadata carries the numpy it was built against
REM (numpy>=2.3.5) on top of the real ABI floor (numpy>=1.23) — so the normal
REM solve demands numpy 2 and conflicts with the pinned numpy 1.26.4.
REM Install it with --no-deps, pinning the exact build. See the note below.
conda install -c conda-forge suitesparse
conda install --no-deps https://conda.anaconda.org/conda-forge/win-64/scikit-umfpack-0.4.2-py311hb8cab9b_2.conda

cd mapper-frontend && npm ci && cd ..

setup.bat        REM writes start.bat (not tracked in the repo)
start.bat
```

`setup.bat` runs the same steps in one command and additionally writes
`start.bat`. It leaves an existing `map` environment untouched; pass `--force`
to recreate it.

> **Why `--no-deps` for `scikit-umfpack` on Windows.** conda-forge publishes
> only 0.4.2 for win-64 (there is no 0.3.3 win-64 build), and its metadata
> declares both the real ABI floor, `numpy >=1.23,<3`, and the numpy it was
> built against, `numpy >=2.3.5`. conda intersects the two, so a plain
> `conda install scikit-umfpack` insists on numpy 2 and conflicts with the
> pinned `numpy=1.26.4`. The second constraint is a packaging artifact —
> numpy-2-built extensions are ABI-compatible back to numpy 1.23, and this
> build was verified on numpy 1.26.4 to produce **bit-identical** LCA scores.
> The `--no-deps` install is therefore correct, not a workaround to be tidied
> away later.
>
> Do **not** raise numpy to 2.x to make the solve succeed: `bw2data 3.6.6`
> uses the removed `np.NaN`, `brightway2 2.4.7` declares `numpy <2`, and
> `premise 2.1.3` hard-pins `numpy <2.0.0`.
>
> Verify with:
>
> ```bat
> python -c "from mapper.core.bw2_wrapper import _UMFPACK_OK; print(_UMFPACK_OK)"
> ```
>
> Skipping it is supported: MApper falls back to `spsolve` per call, which is
> correct but turns a sub-minute prospective run into tens of minutes.

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
