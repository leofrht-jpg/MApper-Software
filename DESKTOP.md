# MApper Desktop (Tauri) — architecture & deferred work

First pass at packaging MApper as a Tauri v2 desktop app. Goal of this pass: a
working `tauri dev` and a single **macOS Apple Silicon** bundle to hand to one
student. Everything else is deferred (see below).

## Architecture

```
┌─────────────────────── MApper.app (Tauri v2, Rust shell) ───────────────────┐
│  mapper-tauri/src/main.rs                                                    │
│    • spawns the backend sidecar on startup                                   │
│    • polls GET /api/health (180 s timeout)                                   │
│    • THEN navigates the webview to http://localhost:8765/index.html and      │
│      shows it (the UI is served BY the backend — see "Why" below)            │
│    • kills the WHOLE sidecar process tree on app exit (RunEvent::Exit)       │
│                                                                             │
│  WebView ── navigates to ──►  http://localhost:8765/index.html               │
│        │                       (SPA served by the backend via StaticFiles)   │
│        └── HTTP/WS (same-origin) ──►  sidecar: resources/mapper-backend/...   │
│                          (PyInstaller onedir of desktop_entry.py → uvicorn   │
│                           + FastAPI on 127.0.0.1:8765, also serving the SPA)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why the webview loads the UI from the backend (the load-bearing decision).**
On macOS the Tauri webview serves its bundled assets from the secure custom
scheme `tauri://localhost`. WKWebView treats that as a **secure context**, and a
secure context's cleartext-`http://` `fetch`/WebSocket calls are blocked as
**mixed content** — rejected *before any socket opens* (surfacing in the UI as a
network-level "Load failed", with nothing ever reaching uvicorn). This is **not**
ATS and **not** CORS: an ATS exception and switching `127.0.0.1`→`localhost` both
fail to lift it. The fix is to make the page **same-origin** with the API: the
backend serves the built SPA (`desktop_entry._mount_frontend` → FastAPI
`StaticFiles`), and once healthy the Rust shell navigates the webview to
`http://localhost:8765/index.html`. Same-origin `http`→`http` calls (and
`ws://`) are always allowed, so every `fetch` + progress WebSocket works. (The
`Info.plist` `NSAllowsLocalNetworking` key is still needed — it permits the
cleartext `http://localhost` *main-frame* load itself.)

- **Freeze tool:** PyInstaller **onedir** (was onefile — see the migration note
  below). Spec: `mapper-backend/mapper-desktop.spec`. Entry:
  `mapper-backend/desktop_entry.py` (runs `uvicorn.run(app, port=8765)`, no
  `--reload`). Output is a **directory** `dist/mapper-backend/` (entrypoint
  `mapper-backend` + `_internal/` with all `.dylib`s + `mapper/data` + `frontend`).
  It is staged (symlinks dereferenced — see below) into
  `mapper-tauri/resources/mapper-backend/` and bundled via Tauri
  `bundle.resources`; `main.rs` resolves the entrypoint under
  `BaseDirectory::Resource` and spawns it with `std::process::Command`. **No
  `externalBin`** (that only carries a single file, not the onedir tree).
- **Port:** fixed **8765** (uncommon; avoids colliding with a dev `:8000`).
  Shared by `desktop_entry.py` (default), `main.rs` (`PORT`), and the frontend
  build env (`VITE_API_BASE`). Dynamic free-port handshake is deferred.
- **Frontend base URL switch:** `client.ts` reads
  `import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'`. The Tauri
  `beforeDevCommand`/`beforeBuildCommand` set `VITE_API_BASE=http://localhost:8765`
  — which, because the desktop page is itself served from `http://localhost:8765`,
  is **same-origin** with the API. **The standalone web workflow is untouched** —
  plain `npm run dev` / `start.sh` set no env, so it still talks to `localhost:8000`
  and the `mapper` alias works unchanged.
- **Backend serves the SPA (desktop only):** `desktop_entry._mount_frontend()`
  mounts the built `mapper-frontend/dist` via FastAPI `StaticFiles` at `/` (AFTER
  the `/api` router, so API routes win). The shell navigates to **`/index.html`**,
  not `/`, because the backend's `/` route redirects to the API docs. The SPA uses
  no path-based routing, so the URL stays put. Standalone web never calls this
  (Vite serves the frontend there).
- **CORS:** unchanged/irrelevant now that the desktop calls are same-origin; the
  backend still allows `localhost:5173` (web dev) + the `tauri://` origins,
  additively.
- **Writable CWD before import (premise `/export` crash):** `desktop_entry`
  `os.chdir()`s to a per-user workspace (`~/Library/Application Support/mapper/
  workspace`) **before importing the app**. `premise/logger.py` runs
  `(Path.cwd()/"export"/"logs").mkdir(...)` at IMPORT time; launched via
  LaunchServices (double-click) the CWD is `/`, so that becomes `/export` →
  `OSError: Read-only file system` → the whole import chain crashes and the
  sidecar dies before serving anything. Anchoring CWD fixes premise and every
  other relative-path writer. (Running the inner binary directly from a shell
  hides this, because the shell's CWD is writable — a debugging trap.)
- **Bundling the local `mapper` package's data (the silent gap):**
  `collect_data_files("mapper")` returns the right files but they **never land in
  the freeze** for this LOCAL (non-pip-installed) package — so `mapper/data/**`
  (AESA boundary sets, SSP trajectories, LCIA registry, grid intensities) is
  absent at runtime → `grid-intensities` 500s and AESA breaks. The spec now walks
  `mapper/data` and appends explicit `(src, dest)` tuples (same pattern used for
  the bundled frontend). Verify after any freeze: the data must appear under
  `_MEIPASS/mapper/data/`.
- **Target:** **aarch64-apple-darwin only**. Single target, no cross-compile, no
  Intel/universal, no Windows. Frozen from the native-arm64 `map` conda env
  (verified `platform.machine() == arm64`, not Rosetta).
- **Sidecar teardown (the non-obvious part):** the PyInstaller **onedir**
  entrypoint forks the real uvicorn/Python child, and that child in turn spawns
  descendants (a multiprocessing resource-tracker) which **detach to launchd —
  `ppid 1` — almost immediately**. So `Child::kill()` (which only reaps the
  entrypoint) leaves orphaned Python/uvicorn processes holding port 8765. The
  robust fix in `kill_sidecar()` is `child.kill()` **plus a
  `pkill -KILL -f mapper-backend` sweep** that reaps every process by the
  sidecar's unique binary name regardless of reparenting. This is safe: the
  standalone-web backend runs as `uvicorn mapper.main:app` (argv has no
  `mapper-backend` substring) and the Rust shell is `mapper-tauri`, so neither
  is ever matched. Verified: graceful quit → zero surviving `mapper-backend`
  processes.

## Build (on this machine)

**The Tauri CLI here is the standalone `tauri` binary (Homebrew: `tauri-cli`,
`/opt/homebrew/bin/tauri`) — invoked as `tauri build`, NOT `cargo tauri build`.**
`cargo-tauri` is not installed, so `cargo tauri …` fails with
`no such command: tauri`; and `npm run tauri …` fails because `mapper-tauri/` is
Rust-only (no `package.json`). If the `tauri` CLI is ever missing, install it with
`cargo install tauri-cli --locked` (then invoke `cargo tauri …`) or
`brew install tauri-cli` (then `tauri …`).

Order matters: build the frontend BEFORE the freeze, because the spec bundles the
built `dist/` into the sidecar (so the backend can serve the SPA same-origin).

```bash
# Tooling on PATH (cargo for the Rust build, Homebrew tauri for the bundler):
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
conda activate map

# 1. Build the frontend with the same-origin base (gets bundled into the freeze).
( cd mapper-frontend && VITE_API_BASE=http://localhost:8765 npm run build )

# 2. Freeze the backend ONEDIR (arm64; bundles dist/ + mapper/data). Produces the
#    DIRECTORY dist/mapper-backend/ (entrypoint + _internal/), NOT a single file.
( cd mapper-backend && pyinstaller mapper-desktop.spec --noconfirm )

# 3. Stage the onedir as a Tauri resource, DEREFERENCING symlinks (cp -RL).
#    PyInstaller creates ~53 versioned-dylib symlinks; tauri-build's resource
#    walker chokes on them ("Not a directory"), so copy them as real files.
rm -rf mapper-tauri/resources/mapper-backend
mkdir -p mapper-tauri/resources
cp -RL mapper-backend/dist/mapper-backend mapper-tauri/resources/mapper-backend
#    (sanity: `find mapper-tauri/resources/mapper-backend -type l | wc -l` == 0)

# 4. Bundle .app + .dmg  (Homebrew `tauri`, NOT `cargo tauri`; targets come from
#    tauri.conf.json. bundle.resources embeds the whole onedir; main.rs spawns the
#    entrypoint from BaseDirectory::Resource. Re-runs the frontend build via
#    beforeBuildCommand, compiles Rust, produces both bundles).
( cd mapper-tauri && tauri build --target aarch64-apple-darwin )

# Output (target-triple dir because of --target):
#   mapper-tauri/target/aarch64-apple-darwin/release/bundle/macos/MApper.app
#   mapper-tauri/target/aarch64-apple-darwin/release/bundle/dmg/MApper_0.1.1_aarch64.dmg
# Dev run instead of bundling:  ( cd mapper-tauri && tauri dev )
```

## First-run / ecoinvent guard

The health endpoint deliberately does **not** touch Brightway2, so the UI loads
even with no LCA project. ecoinvent is imported from inside the app (Database
Explorer → import), never bundled. See `SHARING.md` for the student steps and
the exact bw2 project path (`~/Library/Application Support/Brightway3`).

## Onedir sidecar — boot speed (completed migration)

The sidecar was migrated **onefile → onedir** to kill the ~2-minute per-launch
self-extraction. Onefile re-extracted the whole ~346 MB archive to a fresh
`_MEIPASS` on **every** launch (measured cold **168 s** / warm **117 s** here);
onedir has **no extraction step** — cold boot dropped to **~10 s** (health-200,
measured across repeated launches). The 300 s health timeout is retained purely
as a generous ceiling for the one-time first-ever matplotlib font-cache scan on a
cold OS font cache; the false-crash-dialog fix is unaffected.

Integration pattern (**Pattern A** — resource dir + `std::process::Command`),
chosen because Tauri v2 `externalBin` carries only a single file, not the onedir
tree of entrypoint + sibling `.dylib`s:

- **Spec:** `EXE(..., exclude_binaries=True)` + `COLLECT(...)` → `dist/mapper-backend/`
  (`mapper-backend` entrypoint + `_internal/`). PyInstaller 6.x sets `_MEIPASS` to
  `_internal/`, so every `mapper/data`/frontend path resolves unchanged. datas /
  binaries / hiddenimports are byte-identical to the onefile spec.
- **Stage:** `cp -RL` into `mapper-tauri/resources/mapper-backend/` — **dereference
  symlinks** (PyInstaller emits ~53 versioned-dylib links; `tauri-build`'s resource
  walker fails on them with `Not a directory (os error 20)`). Dereferencing is
  functionally identical (dyld resolves each lib by its install-name from a real
  copy); costs ~200 MB extra on disk, recompressed by the dmg.
- **Bundle:** `bundle.resources: ["resources/mapper-backend"]` in `tauri.conf.json`
  (no more `externalBin`). If the build script ever errors at a resource file after
  a symlink→realfile change, `cargo clean -p mapper-tauri` clears stale
  build-script state.
- **Spawn:** `main.rs` resolves the entrypoint under `BaseDirectory::Resource`
  (candidate paths, `chmod +x` guard for a possibly-stripped exec bit), spawns via
  `std::process::Command` with `MAPPER_PORT` + inherited stdio, and stores the
  `std::process::Child` for teardown. The health poll (300 s), data-URL loading
  page, and `kill_sidecar` (child.kill + pkill sweep) are unchanged. The
  `tauri-plugin-shell` dependency + `shell:allow-spawn` capability were removed
  (spawning is now plain Rust, not gated by a Tauri capability).

## Deferred (NOT in this pass)

- **Code signing + notarization** (Apple Developer ID). This build is unsigned →
  the student must bypass Gatekeeper (right-click → Open, or
  `xattr -dr com.apple.quarantine`). This is a trusted local hand-off, not
  distribution; signing/notarization is the real fix.
- **Other platforms:** macOS Intel, universal binary, Windows, Linux.
- **Auto-update** (Tauri updater + a release feed).
- **Dynamic free port** — currently a fixed 8765; a port handshake (backend
  prints the chosen port on stdout; the shell reads it) avoids the rare
  port-in-use collision and is the recommended next hardening step.
- **Slimming the freeze:** excluding unused bw2io importers / premise data not
  needed by the reference workflow could cut size substantially.

## What this pass delivered

- `mapper-tauri/`: Rust shell (`Cargo.toml`, `build.rs`, `src/main.rs`),
  `capabilities/default.json`, updated `tauri.conf.json` (externalBin, hidden
  window, VITE_API_BASE wiring, app+dmg targets).
- `mapper-backend/`: `desktop_entry.py`, `mapper-desktop.spec`, `/api/health`
  endpoint, webview CORS origins.
- `mapper-frontend/src/api/client.ts`: env-driven API base URL.
- `SHARING.md` (student) + this file.
