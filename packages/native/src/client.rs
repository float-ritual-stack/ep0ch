//! The outline host's socket, as this app speaks it: one JSON object a line each way (outline-core's protocol.ts).
//! A request is `{id, action, outline, …}`; an answer is `{id, ok, result}` or `{id, ok: false, error, kind}`; between
//! answers the host says which watched answers changed (`{event: {action: "queries.changed", changes}}`).
//!
//! `Link` is the seam: the window is the same over a socket, and over a stand-in that answers where it stands.
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

include!(concat!(env!("OUT_DIR"), "/protocol.rs"));

/// What a `Link` says of itself between the host's lines: the connection ended (`detail` says how).
pub fn lost(detail: impl Into<String>) -> Value { json!({ "link": "lost", "detail": detail.into() }) }

pub trait Link {
    /// Sends one request line (it carries its own `id`).
    fn send(&mut self, request: &Value);
    /// Every line that has arrived, oldest first.
    fn take(&mut self) -> Vec<Value>;
    /// Waits until the answer to `id` has arrived (left for `take`), the link is lost, or `timeout` passes.
    fn wait(&mut self, id: &str, timeout: Duration);
    /// Called from another thread whenever a line arrives, so an idle window wakes to take it.
    fn set_waker(&mut self, _waker: rune::Waker) {}
}

type Inbox = Arc<(Mutex<VecDeque<Value>>, Condvar)>;
type Wake = Arc<Mutex<Option<rune::Waker>>>;

/// A connection to an outline host's socket. A reader thread queues the host's lines and wakes the window.
pub struct Socket {
    stream: Option<UnixStream>,
    inbox: Inbox,
    wake: Wake,
}

impl Socket {
    /// Connects to the host at `path`. One that can't says so as its first line, like any later loss.
    pub fn connect(path: &str) -> Socket {
        let inbox: Inbox = Arc::default();
        let wake: Wake = Arc::default();
        let stream = match UnixStream::connect(path).and_then(|stream| Ok((stream.try_clone()?, stream))) {
            Ok((read, write)) => {
                let (inbox, wake) = (inbox.clone(), wake.clone());
                std::thread::spawn(move || {
                    let deliver = |line: Value| {
                        inbox.0.lock().unwrap().push_back(line);
                        inbox.1.notify_all();
                        let waker = wake.lock().unwrap().clone();
                        if let Some(waker) = waker { waker() }
                    };
                    for line in BufReader::new(read).lines().map_while(Result::ok) {
                        if let Ok(value) = serde_json::from_str::<Value>(&line) { deliver(value) }
                    }
                    deliver(lost("the outline host closed the connection"));
                });
                Some(write)
            }
            Err(e) => {
                inbox.0.lock().unwrap().push_back(lost(format!("no outline host answers at {path}: {e}")));
                None
            }
        };
        Socket { stream, inbox, wake }
    }
}

impl Link for Socket {
    fn send(&mut self, request: &Value) {
        let sent = match &mut self.stream {
            Some(stream) => writeln!(stream, "{request}").and_then(|()| stream.flush()).map_err(|e| e.to_string()),
            None => Err("not connected".to_string()),
        };
        // A request that never left is answered here, so whoever asked hears about it the way it hears any refusal.
        if let Err(error) = sent {
            self.inbox.0.lock().unwrap().push_back(json!({ "id": request["id"], "ok": false, "kind": "unavailable", "error": format!("the request wasn't sent: {error}") }));
        }
    }

    fn take(&mut self) -> Vec<Value> { self.inbox.0.lock().unwrap().drain(..).collect() }

    fn wait(&mut self, id: &str, timeout: Duration) {
        let until = Instant::now() + timeout;
        let mut inbox = self.inbox.0.lock().unwrap();
        while !inbox.iter().any(|line| line["id"] == id || line["link"] == "lost") {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() { return }
            inbox = self.inbox.1.wait_timeout(inbox, left).unwrap().0;
        }
    }

    fn set_waker(&mut self, waker: rune::Waker) { *self.wake.lock().unwrap() = Some(waker) }
}

/// A link that is only ever lost: what the window has when no outline could be named, so it can say why.
pub struct Nowhere(pub Option<String>);

impl Link for Nowhere {
    fn send(&mut self, _: &Value) {}
    fn take(&mut self) -> Vec<Value> { self.0.take().map(lost).into_iter().collect() }
    fn wait(&mut self, _: &str, _: Duration) {}
}

/// Where the outline is: its host's socket and its name, and where this window serves its control socket
/// (`native.sock` beside the outline's `door.sock`), when the door's rule said.
#[derive(Clone)]
pub struct Place {
    pub socket: String,
    pub outline: String,
    pub control: Option<String>,
}

fn flag(args: &[String], name: &str) -> Option<String> { args.iter().position(|a| a == name).and_then(|at| args.get(at + 1)).cloned() }

fn bun(args: &[String]) -> Result<Value, String> {
    let bun = std::env::var("EP0CH_BUN").unwrap_or_else(|_| "bun".to_string());
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/resolve.ts");
    let out = std::process::Command::new(&bun).arg(script).args(args).output().map_err(|e| format!("can't run {bun} {script}: {e}"))?;
    let said = String::from_utf8_lossy(&out.stdout);
    said.lines().last().and_then(|line| serde_json::from_str(line).ok()).ok_or_else(|| format!("{script} said nothing to read: {}", String::from_utf8_lossy(&out.stderr).trim()))
}

/// Where the outline is, by the door's own rule (`resolve.ts`, run once with bun): which outline (`--ws`, then
/// `EP0CH_WS`, then the nearest `.ep0ch`), which host (`--machine` first, then `EP0CH_SOCKET`, then this machine's)
/// and where the window's control socket goes. Nothing is decided here: every case is the rule's, so the window
/// opens what the door would and is found where the door's client looks.
fn resolve(args: &[String]) -> Result<Place, String> {
    let answer = bun(args)?;
    match (answer["socket"].as_str(), answer["outline"].as_str()) {
        (Some(socket), Some(outline)) => Ok(Place { socket: socket.to_string(), outline: outline.to_string(), control: answer["control"].as_str().map(str::to_string) }),
        _ => Err(answer["error"].as_str().unwrap_or("no outline is named here").to_string()),
    }
}

/// Where the outline is, asked once a run: the window's first state and its control socket both read it.
pub fn place(args: &[String]) -> Result<Place, String> {
    static PLACE: std::sync::OnceLock<Result<Place, String>> = std::sync::OnceLock::new();
    PLACE.get_or_init(|| resolve(args)).clone()
}

/// Where this window serves its control socket: `--control <path>`, then `EP0CH_NATIVE_CONTROL`, then
/// `native.sock` beside the outline's `door.sock` (`resolve.ts` says where that is). None: nowhere is named, and
/// the window runs without one.
pub fn control(args: &[String]) -> Option<String> {
    if let Some(path) = flag(args, "--control").or_else(|| std::env::var("EP0CH_NATIVE_CONTROL").ok()).filter(|path| !path.is_empty()) { return Some(path) }
    place(args).ok()?.control
}
