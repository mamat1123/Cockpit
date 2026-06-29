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
        // token mode (ADR 0010, revised): the owner is on a Claude *subscription*, so the
        // binding constraint is the token-based rate-limit window, not per-token USD — token
        // mode compresses prompts to cut tokens (extends rate-limit headroom + context),
        // which is the saving that matters here. cache mode's cheaper-input benefit is a
        // pay-per-token concern that doesn't apply. CCR (headroom_retrieve) lets Claude pull
        // back full detail when the compressed view isn't enough. log file feeds Savings.
        let cmd = format!(
            "exec headroom proxy --port {HEADROOM_PORT} --mode token --log-file ~/.headroom/logs/cockpit-proxy.jsonl"
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
    Err(format!("headroom proxy did not become reachable on 127.0.0.1:{HEADROOM_PORT} within 8s"))
}

/// Kill the managed proxy child (called on app exit so we don't orphan it).
pub fn shutdown(app: &tauri::AppHandle) {
    use tauri::Manager;
    let mgr = app.state::<HeadroomManager>();
    let child = mgr.0.lock().unwrap().take();
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}
