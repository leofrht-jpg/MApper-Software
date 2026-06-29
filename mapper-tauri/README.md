# mapper-tauri

Tauri v2 desktop shell for MApper. Spawns the frozen Python backend as a
sidecar, health-polls it, then reveals the webview once the backend is ready.

## App icon (Patch 5AH)

`icons/` holds the app-icon set (bolt in a brand-teal circle with a light-green
aura, same design as the web favicon), generated from `mapper-frontend/public/favicon.svg`:

| File | Use |
|---|---|
| `icon.png` | 1024² master |
| `32x32.png` / `128x128.png` / `128x128@2x.png` | Linux / AppImage |
| `icon.ico` | Windows (multi-res 16/32/48/64/256) |
| `icon.icns` | macOS dock / app bundle |

To regenerate: `tauri icon icons/icon.png` (or re-run the `magick`/`iconutil`
steps from Patch 5AH).

## Architecture

```
Tauri shell (Rust)
  ├─ spawns  binaries/mapper-backend-<triple>[.exe]   ← PyInstaller onefile
  │            └─ uvicorn + FastAPI + Brightway2 on :8765
  │            └─ also serves the built SPA at /  (same-origin trick)
  └─ webview navigates to http://localhost:8765/index.html once healthy
```

The webview loads the SPA **from the backend** rather than from Tauri's
built-in `tauri://localhost` scheme. This sidesteps WKWebView mixed-content
blocking: a page served over `tauri://` (secure scheme) is blocked from making
cleartext-HTTP fetch/WebSocket calls to the backend. Same-origin is always
allowed.

## Sidecar binary naming

Tauri v2 appends the target triple (and `.exe` on Windows) to the
`externalBin` name automatically. Place the frozen binary at:

| Platform | Path |
|---|---|
| macOS Apple Silicon | `binaries/mapper-backend-aarch64-apple-darwin` |
| macOS Intel | `binaries/mapper-backend-x86_64-apple-darwin` |
| Windows x64 | `binaries/mapper-backend-x86_64-pc-windows-msvc.exe` |

## Building the backend sidecar (PyInstaller)

### Prerequisites (Windows)

The `map` conda environment used on macOS does not exist on Windows. Create it:

```powershell
conda create -n map python=3.11
conda activate map
# Install the scientific stack from conda-forge (binary wheels required)
conda install -c conda-forge brightway2 premise bw2io bw2calc bw2data \
    scikit-umfpack numpy scipy pandas xarray openpyxl
pip install fastapi "uvicorn[standard]" platformdirs ecoinvent_interface \
    pyinstaller
```

### Freeze

```powershell
# 1. Build the frontend first (sets VITE_API_BASE via .env.desktop)
cd mapper-frontend
npm run build:desktop
cd ../mapper-backend

# 2. Freeze
conda activate map
pyinstaller mapper-desktop.spec --noconfirm

# 3. Copy to binaries/ with the Windows target-triple suffix
copy dist\mapper-backend.exe ..\mapper-tauri\binaries\mapper-backend-x86_64-pc-windows-msvc.exe
```

### macOS (Apple Silicon)

```bash
cd mapper-frontend && npm run build:desktop && cd ../mapper-backend
conda activate map
pyinstaller mapper-desktop.spec --noconfirm
cp dist/mapper-backend ../mapper-tauri/binaries/mapper-backend-aarch64-apple-darwin
```

## Building the Tauri app

### One-time prerequisites (Windows — not yet installed on this machine)

```powershell
# 1. Install Rust via rustup (adds cargo + rustc to PATH; restart shell after)
winget install Rustlang.Rustup
# — or download and run https://win.rustup.rs

# 2. Ensure the MSVC target is present (some rustup installs default to GNU)
rustup target add x86_64-pc-windows-msvc

# 3. Install Microsoft C++ Build Tools if not already present
#    (Tauri needs the MSVC linker — install via Visual Studio or standalone tools)
#    https://visualstudio.microsoft.com/visual-cpp-build-tools/

# 4. Install the Tauri v2 CLI as a cargo subcommand (~5–10 min first time)
cargo install tauri-cli --version "^2"
# Places cargo-tauri in ~/.cargo/bin; makes `cargo tauri` resolve.
```

> **Why `cargo install tauri-cli`, not `npx tauri`.**  
> `cargo install tauri-cli` is the only form confirmed to work here.
> `npm ls -g @tauri-apps/cli` shows nothing installed, and the npm-based
> CLI is not available on this machine.

### Build

```powershell
cd mapper-tauri
cargo tauri build
```

The `beforeBuildCommand` (`npm --prefix ../mapper-frontend run build:desktop`)
runs the frontend build automatically — no separate step needed.

Outputs (Windows): `target/release/bundle/nsis/MApper_0.1.0_x64-setup.exe`
Outputs (macOS): `target/release/bundle/dmg/MApper_0.1.0.dmg`

## Process teardown

On **Windows**, `kill_sidecar()` in `src/main.rs` runs:

```
taskkill /F /T /PID <pid>
```

**before** dropping the `CommandChild` handle. `/T` walks the full process tree
(PyInstaller bootloader → spawned Python interpreter) and terminates all
descendants atomically. This must run while the bootloader PID is still live;
`child.kill()` runs afterwards as cleanup (no-op if taskkill already killed it).

On **macOS/Linux**, `child.kill()` SIGKILLs the bootloader, followed by
`/usr/bin/pkill -KILL -f mapper-backend` to sweep any orphaned Python children
(the PyInstaller onefile bootloader reparents its Python child to PID 1/launchd
on exit, so `child.kill()` alone is not sufficient).

## Deferred items

- **Auto-update** — Tauri's built-in updater is not wired. Ship updates by
  distributing a new installer.
- **onedir mode** — The onefile freeze self-extracts on every cold boot (~100 s
  first launch). Switching to onedir (bundle as a Tauri resource directory)
  would cut cold boot to ~10 s. Deferred until the packaging workflow is stable.
- **Dynamic port** — Port 8765 is hardcoded. A free-port handshake (write port
  to a temp file, Rust reads it) is a later hardening step.
- **Code signing** — NSIS installer is unsigned. Windows SmartScreen will warn
  on first launch. Sign with an EV cert for distribution.
