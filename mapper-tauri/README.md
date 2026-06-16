# mapper-tauri

Tauri v2 desktop shell for MApper (the desktop app icon + config skeleton).

## Desktop app icon (Patch 5AH)

`icons/` holds the generated app-icon set (bolt in a brand-teal circle with a
light-green aura — same design as the web favicon), produced from the
`mapper-frontend/public/favicon.svg` master via ImageMagick + `iconutil`:

- `icon.png` — 1024² master
- `32x32.png`, `128x128.png`, `128x128@2x.png` (256) — Linux/AppImage
- `icon.ico` — Windows (multi-res 16/32/48/64/256)
- `icon.icns` — macOS (dock / app bundle)

`tauri.conf.json` wires them via `bundle.icon`. To regenerate from the master:
`tauri icon icons/icon.png` (or re-run the `magick`/`iconutil` steps from
Patch 5AH).

## Status

This is the icon + config skeleton only. The Rust crate (`src/main.rs`,
`Cargo.toml`, `build.rs`, capabilities) is **not yet scaffolded** — run
`npm create tauri-app` / `tauri init` (or add `@tauri-apps/cli`) to complete the
desktop shell, keeping this `tauri.conf.json` (it already points
`frontendDist` at `../mapper-frontend/dist` and `devUrl` at the Vite dev server).
