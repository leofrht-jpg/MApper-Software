# Releasing MApper

How a MApper release is cut, written from what was actually done for **0.3.1**
(tag `v0.3.1` on `ce405d9`, published 2026-10-23). Where a step comes from
memory rather than from a record in this repository or on GitHub, it is marked
**(unverified)**.

Sources:
- [DESKTOP.md](DESKTOP.md) for the macOS build and install detail.
- `build-logs/2026-10-22_0.3.1_ce405d9.md`, the record of the build that was
  released.
- `.github/workflows/ci.yml` and `.github/workflows/release-windows.yml`.
- The GitHub API records of the v0.3.1 tag, release, assets and workflow run.
- The `main protection` ruleset.

A release has eight parts, in this order:
1. Version bump PR
2. macOS build
3. Tag
4. Draft release
5. Windows installer
6. Publish
7. Zenodo
8. Website

## 0. Merging into `main`

`main` is protected by the repository ruleset **main protection**:

- Changes reach `main` only through a pull request. Deletion and force-push are
  blocked.
- Three status checks are required: `frontend`, `backend (macos-latest)` and
  `backend (windows-latest)`.
- The checks are **strict**: a branch must be up to date with `main` before it
  can merge.

Consequences:

- **Merge one PR at a time.** After each merge, bring the next PR up to date by
  merging `main` into its branch (a merge, not a rebase, and never a
  force-push), push, and wait for its checks again.
- **Merge only when all three jobs are green on the PR's exact current head.**
  Check the head SHA and the check runs of that SHA at the moment of merging,
  not an earlier run.
- Version strings change only in a dedicated version PR (step 1).

## 1. Version bump PR

Every site below must carry the same version.
`mapper-backend/tests/test_version_single_source.py` and the frontend fixtures
catch most of a miss, but not the README badge, CITATION.cff or the CHANGELOG.

| file | what |
|---|---|
| `mapper-tauri/tauri.conf.json` | `"version"`. This names the DMG and the installer. |
| `mapper-tauri/Cargo.toml` | `version` under `[package]` |
| `mapper-tauri/Cargo.lock` | The `version` of the `[[package]] name = "mapper-tauri"` entry **only**. Several `objc2-*` crates are also at `0.3.2`, so a blind search-and-replace corrupts the lockfile. |
| `mapper-frontend/package.json` | `"version"` |
| `mapper-frontend/package-lock.json` | The two root entries: the top-level `"version"` and `packages[""].version`. |
| `mapper-backend/pyproject.toml` | `version`. This is the single source the backend serves. |
| `mapper-backend/mapper/__init__.py` | The literal fallback returned by `_detect_version()` |
| `mapper-backend/tests/test_version_single_source.py` | The two asserted literals |
| `mapper-frontend/tests/logsPanelFeedback.test.tsx`, `logsRevealSavedFile.test.tsx` | The `LogsPanel version="..."` fixtures |
| `README.md` | The version badge |
| `CITATION.cff` | `version`, and `date-released` set to the release date. The concept DOI `10.5281/zenodo.22246255` never changes: it always resolves to the latest version. |
| `CHANGELOG.md` | Rename the `[x.y.z] (unreleased)` heading to `[x.y.z] — YYYY-MM-DD` |

The 0.3.1 version commit (`496df7d`) touched exactly these 13 files.

Between releases the version is already set to the next number, with
"(unreleased)" in the CHANGELOG (for example #184). This keeps test builds
distinguishable from the last release. `date-released` stays at the last
release until release time.

## 2. macOS build (Apple silicon)

Built locally on an Apple-silicon Mac from the native-arm64 `map` conda env;
the full commands are in DESKTOP.md → Build. Build from `main` at the exact
commit that will be tagged, with `origin/main` fetched and the tree clean.
Nothing may be merged during the build.

1. **Clear stale bytecode** in `mapper-backend` (`find . -name __pycache__ -type d -prune -exec rm -rf {} +`). A version bump can leave a `.py` the same size, and the freeze would pick up the old `.pyc`.
2. **Build the frontend with `npm run build:desktop`, not `npm run build`.**
   `build:desktop` bakes in the same-origin `localhost:8765` API base. A plain
   build points at `:8000`, and the packaged app then reaches no backend.
3. **PyInstaller freeze:** `pyinstaller mapper-desktop.spec --noconfirm --clean`.
   The log must say UMFPACK was bundled ("1 extension(s) + 10 SuiteSparse
   dylibs"). For 0.3.1 it also reported `pyproject.toml` bundled.
4. **Stage with `cp -RL`** into `mapper-tauri/resources/mapper-backend`,
   dereferencing symlinks. The staged tree must contain 0 symlinks.
5. **Finder test before `tauri build`:**
   `osascript -e 'tell application "Finder" to get name of startup disk'`.
   It must answer (for 0.3.1: `Macintosh HD`). The DMG step drives Finder
   through AppleScript, so this checks the automation permission before the
   bundler gets there **(the reason is unverified; the step is in the 0.3.1
   log)**.
6. **`tauri build --target aarch64-apple-darwin`.** Use the Homebrew `tauri`
   CLI, not `cargo tauri`.
7. **Port grep at four stages.** Count matching lines with
   `grep -rh 8765 | wc -l` in:
   1. the frontend `dist/`
   2. the frozen `dist/mapper-backend`
   3. the staged resource
   4. the bundled `MApper.app`

   None may be zero. For 0.3.1 the counts were 1, 240, 240, 240.
8. **Record a build log** under `build-logs/` with:
   - the commit and the merged PRs it contains
   - the step results and the port table
   - the executable name and the `Info.plist` version
   - the DMG path, byte size and SHA-256
   - the frozen-sidecar checks (run the built sidecar on another port, e.g.
     `MAPPER_PORT=8799`, and make real HTTP requests)

Rules that hold throughout:

- **Never touch `~/Library/WebKit/com.leonardoferhati.mapper`.** It is the
  app's `localStorage`, not a cache. Only `~/Library/Caches/com.leonardoferhati.mapper`
  may be cleared (DESKTOP.md → "Installing a build").
- **Run `cargo clean -p mapper-tauri` only for the stale-path error**, when the
  build script fails on a resource file after a symlink-to-real-file change.
  Never run it routinely.
- When installing over `/Applications` for testing, quit the app with
  `osascript`. For 0.3.1 the previous app and the Caches folder were moved to
  the Trash rather than deleted, and `pkill -f` was avoided.

## 3. Tag the exact commit that was built

Tag the commit recorded in the build log, not whatever `main` is by then. For
0.3.1 this was an annotated tag `v0.3.1` ("MApper 0.3.1") on `ce405d9`. Push
the tag. The push starts `release-windows.yml` (it triggers on `v*` tags).

## 4. Create the GitHub release as a DRAFT, straight away

`release-windows.yml` builds the installer and then waits for a release to
exist for the tag: 30 attempts × 20 s, about 10 minutes. A draft counts. If no
release appears in that window, the job fails after the build and the
installer is attached to nowhere.

So, right after pushing the tag:

- Create the release for the tag **as a draft**.
- Attach `MApper_<version>_aarch64.dmg` to it.

For 0.3.1, from the GitHub records:
- The release was created at 04:03:58Z.
- The Windows run started at 04:04:01Z.
- The DMG was attached at 04:06:42Z.

## 5. Windows installer (CI)

`release-windows.yml`, on `windows-latest`:
- builds the frontend with `build:desktop` and checks for `localhost:8765` in
  the bundle;
- clears `__pycache__` and freezes;
- stages the sidecar;
- runs `tauri build --bundles nsis`;
- uploads `MApper_<version>_x64-setup.exe` to the tag's release (`--clobber`).

Before building, it fails on any drift from the pins in `environment.yml`
(`scripts/verify_pins.py`). It also uploads the installer as a workflow
artifact, even if the release upload fails. A failed run can be repeated
without moving the tag: **Run workflow** with the existing tag as input.

For 0.3.1 the run took 23 minutes and attached the installer at 04:26:21Z.

**Miniforge pin.** Both `ci.yml` (backend job, Windows only) and
`release-windows.yml` pin `miniforge-version: 26.7.2-1`. Miniforge 26.9.4-0
made `conda init --all` fail on the Windows runner ("needs sudo" on
`Scripts\conda.exe`, exit 1) on runner image `windows-2025-vs2026`
20261021.278.1 (#188).
- macOS CI stays on `latest`.
- Unpin when a newer Miniforge passes on the Windows runner: change the pin in
  a PR and let the Windows CI job prove it.
- Change both files together, so CI tests what the release build uses.

## 6. Publish, only when both assets are attached and verified

Publish the draft only when:

- both `MApper_<version>_aarch64.dmg` and `MApper_<version>_x64-setup.exe` are
  attached;
- the DMG's SHA-256 matches the build log (GitHub shows a `sha256:` digest per
  asset);
- the installer size and hash match the Windows run's log ("bytes", "sha256").

Publishing is the irreversible step: it is what Zenodo archives (next step).

For 0.3.1 the release was published at 04:38:24Z, 35 minutes after the draft
was created.

## 7. Zenodo

Publishing a GitHub release makes the Zenodo GitHub integration archive it
and mint a **version DOI**. The concept DOI `10.5281/zenodo.22246255` (README
badge, CITATION.cff, BibTeX) then resolves to the new version without any edit.
After publishing, check:

- a new version record exists on Zenodo;
- its version and files match the release;
- the concept DOI resolves to it.

**(unverified: Zenodo was not reachable while this was written; the
integration and the check are recorded from memory)**

## 8. Website

The website repository (`MApper - Website`, outside this repo) derives both
download URLs from one tag in `lib/release.ts`. **(unverified: that repository
was not available while this was written)**

1. Bump the tag in `lib/release.ts` only after both assets exist on the
   published release. An earlier bump leaves a broken download link.
2. Sizes shown on the site: the macOS DMG in decimal MB, the Windows installer
   in MiB. For 0.3.1: 442,285,312 bytes = 442.3 MB, and 414,394,751 bytes =
   395.2 MiB.
3. Deploy the site.
4. Clean-machine check: download both installers from the site on a machine
   that has never had MApper. Install with the steps in README → Download and
   install, and confirm the app starts and reports the new version in Settings.
