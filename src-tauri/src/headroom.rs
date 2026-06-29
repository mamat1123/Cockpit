use std::io::ErrorKind;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

pub const HEADROOM_PORT: u16 = 8787;

#[derive(Default)]
pub struct HeadroomManager(pub Mutex<Option<Child>>);

/// True if something accepts a TCP connection on the proxy port within `timeout`.
fn port_open(timeout: Duration) -> bool {
    let addr = match ("127.0.0.1", HEADROOM_PORT).to_socket_addrs() {
        Ok(mut it) => match it.next() {
            Some(a) => a,
            None => return false,
        },
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

/// Non-blocking liveness probe.
#[tauri::command]
pub fn headroom_status() -> bool {
    port_open(Duration::from_millis(300))
}

/// Ensure a healthy proxy exists. Idempotent: if the port is already open we do
/// nothing (covers an externally-run `headroom install` daemon). Otherwise spawn
/// `headroom proxy` through a login shell (GUI PATH lacks ~/.local/bin, ADR 0006)
/// and poll until the port opens.
#[tauri::command]
pub fn headroom_ensure(mgr: State<HeadroomManager>) -> Result<bool, String> {
    if port_open(Duration::from_millis(300)) {
        return Ok(true);
    }
    let mut guard = mgr.0.lock().unwrap();
    // Reap a dead child handle so we respawn.
    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
            *guard = None;
        }
    }
    if guard.is_none() {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        // cache mode (ADR 0010); log file feeds Plan 2's Savings attribution.
        let cmd = format!(
            "headroom proxy --port {HEADROOM_PORT} --mode cache --log-file ~/.headroom/logs/cockpit-proxy.jsonl"
        );
        let child = Command::new(&shell)
            .arg("-lc")
            .arg(&cmd)
            .spawn()
            .map_err(|e| format!("spawn headroom proxy: {e}"))?;
        *guard = Some(child);
    }
    drop(guard);

    // Poll up to 8s for the port to come up.
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        if port_open(Duration::from_millis(250)) {
            return Ok(true);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err("headroom proxy did not become reachable on 127.0.0.1:8787 within 8s".into())
}

// Silence unused import on non-test builds.
#[allow(unused_imports)]
use ErrorKind as _ErrorKind;
