/// <reference types="vite/client" />

// Injected by Vite `define` from package.json version (see vite.config.ts).
declare const __APP_VERSION__: string
// Sidecar origin baked in per build mode by vite.config.ts — the desktop
// build points at :8765, dev at :8000. VITE_API_BASE overrides both.
declare const __API_ORIGIN_DEFAULT__: string
