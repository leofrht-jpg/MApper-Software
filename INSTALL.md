# MApper Installation Guide

## Desktop app

Most users want the desktop app, not a source install. The steps below are the
same as in [README → Download and install](README.md#download-and-install).

The desktop installers are attached to each GitHub release. Download them from
the [latest release](https://github.com/leofrht-jpg/MApper-Software/releases/latest).
They are not code-signed, which is why each platform has a one-time step below.

**macOS (Apple silicon only)**

1. Download `MApper_<version>_aarch64.dmg` from the latest release.
2. Open it and drag **MApper** to **Applications**.
3. Run this once in Terminal, so macOS lets the unsigned app open:

   ```bash
   xattr -dr com.apple.quarantine /Applications/MApper.app
   ```

**Windows**

1. Download `MApper_<version>_x64-setup.exe` from the latest release and run it.
2. If Windows SmartScreen shows a warning, click **More info**, then **Run anyway**.

**Data you supply.** The ecoinvent database and the IAM scenario data that
premise uses for prospective databases are separately licensed and are not
included. Import ecoinvent from inside the app (**Database Explorer → Import**);
to try MApper without it, see
[Try it without ecoinvent](README.md#try-it-without-ecoinvent).

**The sparse solver differs by platform.** The macOS build links UMFPACK
through scikit-umfpack, so each prospective database is factorised once and
reused for every later solve. The Windows build falls back to SciPy's SuperLU
(the Windows installer is built without scikit-umfpack; a source install on
Windows can add it, see the Windows steps in INSTALL.md). The results are the
same to solver tolerance, but large sparse solves, such as prospective runs over
many years, are slower on Windows.

The rest of this guide covers running MApper from source.

## Prerequisites

- **Miniconda** or Anaconda ([download](https://docs.conda.io/en/latest/miniconda.html))
- **Node.js 18+** ([download](https://nodejs.org))
- **ecoinvent** licence and the EcoSpold2 release of the version and system
  model you want (for example 3.12 cut-off), unzipped — needed
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
# environment.yml because macOS and Windows need different builds (Windows steps below).
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
> numpy-2-built extensions are ABI-compatible back to numpy 1.23 (the lower
> bound the build's own metadata declares). It was reported that this build on
> numpy 1.26.4 gives bit-identical LCA scores to the no-UMFPACK path; that
> figure was not re-measured when this text was written.
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
2. Download the EcoSpold2 release for the version and system model you want
   (for example 3.12 cut-off) from ecoinvent, and unzip or extract it first.
   MApper cannot open a `.7z` or `.zip` file. The extracted folder must contain
   `datasets/` and `MasterData/`.
3. Go to **Database Explorer** → **Import** → **Import from local files**. Paste
   the full path to the `datasets` folder (the folder with the `.spold` files
   directly inside it), click **Verify**, keep or edit the proposed database
   name, and click **Import**. Alternative: **Log in with ecoinvent account**
   downloads a release directly and needs your own ecoinvent licence.
4. Wait for import (~5–10 minutes for 23,000 activities)
5. Start exploring!

*Known limitation.* The import installs no LCIA methods. EF, ReCiPe and CML are
not available in a freshly imported project (they are installed only for the
demo project). The Methods Library offers IMPACT World+ (including an ecoinvent
3.12 variant), LC-Impact and an Excel upload. Importing ecoinvent 3.12 follows
the same code path as the other versions but has no automated test yet.

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
**ecoinvent import fails:** Point MApper at the unzipped EcoSpold2 `datasets` folder (the `.spold` files directly inside it), not at a `.7z` or `.zip` file. Click **Verify** first; "No .spold files found" means the path is not that folder.
**Premise key error:** Verify key is saved in `~/.premise/premise_key` (single line, no spaces)

**Desktop app shows an old version after upgrading from v0.1.x:** This affects
upgrades from v0.1.x only. A fresh install, or an upgrade from v0.2.0 or later,
does not need this. Builds before v0.2.0 sent the app's `index.html` without a
`no-cache` header, so the webview can keep reusing the copy it cached then and
never ask the new version for its own. Settings reports the old version number.
Quit MApper, delete the webview cache, and relaunch:

- Windows: `%LOCALAPPDATA%\com.leonardoferhati.mapper\EBWebView`
- macOS: `~/Library/Caches/com.leonardoferhati.mapper`

The Windows fix was confirmed on a real machine. The macOS path is untested,
inferred from where the app's webview keeps its HTTP cache.

Your projects and databases are stored elsewhere and are not touched. You only
lose remembered view preferences, such as the last open tab.

## Contact

Leonardo Ferhati — leo_frht@icloud.com
mapper.leonardoferhati.com
