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
//!   2. Reveal the window immediately on a self-contained loading page, then poll
//!      `GET /api/health` until the backend answers (300 s timeout — the onefile
//!      cold boot is ~170 s) and swap to the backend-served UI. On genuine
//!      timeout, show a clear error dialog.
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
// Generous: the backend is a ~346 MB PyInstaller onefile that RE-EXTRACTS on
// EVERY launch — measured cold boot 168 s, warm 117 s here, so extraction (not
// just the first-run matplotlib font cache) dominates and even a warm boot is
// ~2 min. 300 s gives ample headroom over the ~170 s cold boot for slower
// machines / larger future builds, so the "backend not responding" dialog fires
// only on a GENUINE failure, not a slow-but-successful start (the false-positive
// bug: 180 s left only ~11 s of headroom). onedir + a Tauri resource is the
// deferred boot-speed fix that would drop this to ~10 s — see DESKTOP.md.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(300);

// A self-contained loading page shown immediately while the sidecar boots, so
// the user gets feedback during the ~2 min cold start instead of a blank/hidden
// window. Inline base64 data URL (no bundled file, works in dev + release).
const LOADING_DATA_URL: &str = "data:text/html;base64,PCFkb2N0eXBlIGh0bWw+PGh0bWw+PGhlYWQ+PG1ldGEgY2hhcnNldD0idXRmLTgiPjxzdHlsZT4KaHRtbCxib2R5e21hcmdpbjowO2hlaWdodDoxMDAlO2JhY2tncm91bmQ6IzBiMGYxNDtjb2xvcjojZTZlZGYzO2ZvbnQtZmFtaWx5Oi1hcHBsZS1zeXN0ZW0sQmxpbmtNYWNTeXN0ZW1Gb250LCJTZWdvZSBVSSIsc2Fucy1zZXJpZn0KLndyYXB7aGVpZ2h0OjEwMCU7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtnYXA6MThweH0KLnNwaW5uZXJ7d2lkdGg6MzRweDtoZWlnaHQ6MzRweDtib3JkZXI6M3B4IHNvbGlkICMxZjI5Mzc7Ym9yZGVyLXRvcC1jb2xvcjojMTRiOGE2O2JvcmRlci1yYWRpdXM6NTAlO2FuaW1hdGlvbjpzcGluIC45cyBsaW5lYXIgaW5maW5pdGV9CkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fQoudGl0bGV7Zm9udC1zaXplOjE3cHg7Zm9udC13ZWlnaHQ6NjAwO2xldHRlci1zcGFjaW5nOi4wMmVtfQouc3Vie2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM4Yjk3YTU7bWF4LXdpZHRoOjM0MHB4O3RleHQtYWxpZ246Y2VudGVyO2xpbmUtaGVpZ2h0OjEuNX0KPC9zdHlsZT48L2hlYWQ+PGJvZHk+PGRpdiBjbGFzcz0id3JhcCI+PGRpdiBjbGFzcz0ic3Bpbm5lciI+PC9kaXY+PGRpdiBjbGFzcz0idGl0bGUiPlN0YXJ0aW5nIE1BcHBlcuKApjwvZGl2PjxkaXYgY2xhc3M9InN1YiI+UHJlcGFyaW5nIHRoZSBiYWNrZW5kIOKAlCB0aGlzIGNhbiB0YWtlIHVwIHRvIDIgbWludXRlcyBvbiBmaXJzdCBsYXVuY2guIFRoZSB3aW5kb3cgb3BlbnMgYXV0b21hdGljYWxseSB3aGVuIGl0J3MgcmVhZHkuPC9kaXY+PC9kaXY+PC9ib2R5PjwvaHRtbD4K";

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
                // On Windows, `taskkill /F /T /PID <pid>` terminates the entire
                // process *tree* (bootloader + spawned Python interpreter) before
                // the handle is dropped. This MUST happen while the bootloader is
                // still alive so /T can walk its children; calling child.kill()
                // first (TerminateProcess) would make the PID invalid by the time
                // taskkill runs. child.kill() afterwards is a no-op if taskkill
                // already terminated the process, which is fine.
                #[cfg(target_os = "windows")]
                {
                    let pid = child.pid();
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/T", "/PID", &pid.to_string()])
                        .status();
                }
                let _ = child.kill();
            }
        }
    }
    // macOS / Linux: SIGKILL every remaining mapper-backend process by name.
    // The PyInstaller onefile spawns a process TREE — a bootloader, the real
    // uvicorn/Python child, and a detached resource-tracker that reparents to
    // launchd (ppid 1). `child.kill()` only reaps the bootloader, so the others
    // orphan. Safe: the standalone-web backend runs as `uvicorn`/`python`, NOT
    // `mapper-backend`; the Rust shell is `mapper-tauri` — neither is matched.
    // On Windows, taskkill /T above already walks and kills all descendants, so
    // no name-based sweep is needed there.
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("/usr/bin/pkill")
            .args(["-KILL", "-f", "mapper-backend"])
            .status();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // 0. Defensive: reap any stale sidecar from a previous unclean exit so
            //    the fresh spawn can't hit "address already in use" on PORT (which
            //    would make the new sidecar exit → the poll never sees health → a
            //    genuine-looking but avoidable "backend not responding" dialog).
            //    Safe: the standalone-web backend runs as uvicorn/python and the
            //    Rust shell is mapper-tauri — neither matches "mapper-backend".
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/IM", "mapper-backend.exe"])
                    .status();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = std::process::Command::new("/usr/bin/pkill")
                    .args(["-KILL", "-f", "mapper-backend"])
                    .status();
            }

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

            // 2. Show a loading page IMMEDIATELY, then poll health off the main
            //    thread and swap to the real UI once the backend answers.
            let window: WebviewWindow = app
                .get_webview_window("main")
                .expect("main window not found");
            // The window is config-hidden; reveal it now on a self-contained
            // loading page so the user gets feedback during the ~2 min cold start
            // instead of a blank/hidden window (the old design hid until health,
            // which read as "nothing is happening" for two minutes).
            if let Ok(url) = LOADING_DATA_URL.parse() {
                let _ = window.navigate(url);
            }
            let _ = window.show();
            let _ = window.set_focus();
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
                    // Timing signal for future diagnostics (INFO to the shell's
                    // stderr): how long the sidecar actually took to answer.
                    eprintln!(
                        "[shell] backend ready after {:.1}s",
                        start.elapsed().as_secs_f32()
                    );
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
                    let window = window;
                    if let Ok(url) = format!("http://localhost:{PORT}/index.html").parse() {
                        let _ = window.navigate(url);
                    }
                    // Window is already visible (loading page); just refocus.
                    let _ = window.set_focus();
                } else {
                    // Genuine failure only: 300 s elapsed with no health. The
                    // window stays on the loading page behind this dialog.
                    eprintln!(
                        "[shell] backend did NOT respond within {}s — showing failure dialog",
                        HEALTH_TIMEOUT.as_secs()
                    );
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    handle
                        .dialog()
                        .message(
                            "MApper's backend did not start within 5 minutes.\n\n\
                             Please quit and reopen MApper. If this keeps happening, \
                             see SHARING.md for setup and troubleshooting.",
                        )
                        .kind(MessageDialogKind::Error)
                        .title("MApper — backend not responding")
                        .blocking_show();
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
