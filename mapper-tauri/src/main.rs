// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

// Prevent a second console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! MApper desktop shell (Tauri v2).
//!
//! Lifecycle:
//!   1. On startup, spawn the frozen Python backend as a sidecar on a fixed
//!      localhost port (8765, matching `desktop_entry.py` / the frontend's
//!      `VITE_API_BASE`).
//!   2. Poll `GET /api/health` until the backend answers (180 s timeout), THEN
//!      reveal the webview window (which starts hidden) so the user never sees a
//!      half-loaded UI racing the backend. On timeout, show a clear error dialog.
//!   3. On app exit, kill the sidecar so no `uvicorn` process is orphaned.
//!
//! The "needs an ecoinvent-backed Brightway2 project" first-run guidance is a
//! UI concern (the Database Explorer's import flow + SHARING.md) — the health
//! endpoint deliberately does NOT touch Brightway2, so UI-only work (AESA setup,
//! config) loads even before any LCA project exists.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewWindow};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Fixed sidecar port for the desktop MVP (see DESKTOP.md for the dynamic-port
/// hardening note). Must match `desktop_entry.py`'s default and the frontend's
/// build-time `VITE_API_BASE`.
const PORT: u16 = 8765;
// Generous: the backend is a ~345 MB PyInstaller onefile that self-extracts on
// every launch, and the FIRST-ever launch also builds matplotlib's font cache —
// a cold boot measured ~100 s here. Warm boots are faster. (onedir + a Tauri
// resource is the deferred boot-speed fix — see DESKTOP.md.)
const HEALTH_TIMEOUT: Duration = Duration::from_secs(180);

/// Holds the spawned backend child so it can be killed on exit.
struct SidecarHandle(Mutex<Option<CommandChild>>);

/// Minimal dependency-free health probe: a raw HTTP/1.0 GET to /api/health.
/// Returns true only on a 200 response (uvicorn binds the port slightly before
/// it is ready, so a bare TCP connect is not enough).
fn health_ok(port: u16) -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};

    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(900)));
    let req = b"GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(req).is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    buf.contains(" 200")
}

fn kill_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarHandle>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
    // The PyInstaller onefile spawns a process TREE — a bootloader, the real
    // uvicorn/Python child, and a detached resource-tracker that reparents to
    // launchd (ppid 1). `child.kill()` only reaps the bootloader, so the others
    // orphan. SIGKILL every remaining process by the sidecar's unique binary
    // name to guarantee no orphan. Safe: the standalone-web backend runs as
    // `uvicorn` / `python`, NOT `mapper-backend`, so it is never matched; the
    // Rust shell is `mapper-tauri`, also not matched.
    let _ = std::process::Command::new("/usr/bin/pkill")
        .args(["-KILL", "-f", "mapper-backend"])
        .status();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // 1. Spawn the backend sidecar on the fixed port.
            let command = app
                .shell()
                .sidecar("mapper-backend")
                .expect("failed to create the backend sidecar command")
                .env("MAPPER_PORT", PORT.to_string());
            let (mut rx, child) = command
                .spawn()
                .expect("failed to spawn the backend sidecar");
            app.manage(SidecarHandle(Mutex::new(Some(child))));

            // Forward sidecar stdout/stderr to the shell's stderr for debugging.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                            eprint!("[backend] {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Error(err) => eprintln!("[backend] error: {err}"),
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[backend] terminated: {payload:?}");
                        }
                        _ => {}
                    }
                }
            });

            // 2. Poll health off the main thread, then reveal the (hidden) window.
            let window: WebviewWindow = app
                .get_webview_window("main")
                .expect("main window not found");
            std::thread::spawn(move || {
                let start = Instant::now();
                let mut ready = false;
                while start.elapsed() < HEALTH_TIMEOUT {
                    if health_ok(PORT) {
                        ready = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(400));
                }

                if ready {
                    // Load the UI FROM THE BACKEND over http://localhost:PORT.
                    //
                    // The webview's bundled page is served from Tauri's secure
                    // custom scheme (tauri://localhost on macOS). WKWebView treats
                    // that as a secure context and BLOCKS its cleartext-HTTP
                    // fetch/WebSocket calls to the backend as mixed content — the
                    // request is rejected before any socket opens, surfacing as
                    // "Load failed" in the UI (this is NOT ATS or CORS; an ATS
                    // exception and using `localhost` both fail to lift it). By
                    // navigating to the backend-served copy of the same SPA, the
                    // page origin becomes identical to the API origin, so every
                    // fetch + WebSocket is same-origin and always allowed. The
                    // backend serves the frontend via StaticFiles (desktop_entry).
                    // Navigate to /index.html (not /), because the backend's "/"
                    // route redirects to the API docs; /index.html is the SPA entry
                    // served by StaticFiles. The SPA uses no path-based routing, so
                    // the URL stays put and every asset/API/WS call is same-origin.
                    let mut window = window;
                    if let Ok(url) = format!("http://localhost:{PORT}/index.html").parse() {
                        let _ = window.navigate(url);
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    handle
                        .dialog()
                        .message(
                            "MApper's backend did not start within 3 minutes.\n\n\
                             Please quit and reopen MApper. If this keeps happening, \
                             see SHARING.md for setup and troubleshooting.",
                        )
                        .kind(MessageDialogKind::Error)
                        .title("MApper — backend not responding")
                        .blocking_show();
                    // Reveal anyway so the user isn't stuck on a blank screen; the
                    // UI surfaces backend-down state via its own error handling.
                    let _ = window.show();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the MApper desktop app")
        .run(|app, event| {
            // 3. Terminate the sidecar on exit — no orphaned uvicorn process.
            if let RunEvent::Exit = event {
                kill_sidecar(app);
            }
        });
}
