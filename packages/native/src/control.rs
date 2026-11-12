//! The control socket: what the window shows and what it can do, for an agent. `native.sock` speaks the door's
//! control protocol (the door's src/control.ts), so the door's own client reaches it: `EP0CH_CONTROL=<native.sock>
//! ep0ch act note.trash`. One JSON object a line each way:
//!
//! - `{cmd: "act", action, args?, tile?, as?}` runs one action as the agent `as` names, through the same
//!   dispatcher as a key or a press. It takes no pointer, no focus and no selection.
//! - `{cmd: "peek"}` answers the window's state: `{screen: {screen, focus, whereabouts, watches, tiles, …}, text}`.
//! - `{cmd: "actions"}` lists every action as its row.
//!
//! An answer is `{ok: true, result}` or `{ok: false, error, kind}`. A request runs on the UI thread (`Ui::run`);
//! the socket's thread only carries lines. Whoever can connect can do what the person can, so the socket lives in
//! a folder that is the user's alone.
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::time::Duration;

use rune::Tx;
use serde_json::{Map, Value, json};

use crate::actions::{self, Actor, App, READER};
use crate::actline::Request;
use crate::{bar, keys};

/// Work for the UI thread.
pub type Job = Box<dyn FnOnce(&mut App, &mut Tx) + Send>;

/// The way onto the UI thread: the window's handle, or a test's own loop.
pub trait Ui: Clone + Send + 'static {
    fn run(&self, job: Job);
}

impl Ui for rune::AppHandle<App> {
    fn run(&self, job: Job) { self.update(move |s, tx| job(s, tx)) }
}

/// A served control socket: gone from the folder when this is dropped.
pub struct Control {
    pub path: PathBuf,
}

impl Drop for Control {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.path); }
}

/// The agent an act is recorded as when its request names none.
const AGENT: &str = "agent";

/// How long a request waits for the UI thread before saying the window isn't answering.
const PATIENCE: Duration = Duration::from_secs(10);

/// Serves the control protocol on `path`. Refused, with why, when its folder isn't the user's alone.
pub fn serve(path: &Path, ui: impl Ui) -> Result<Control, String> {
    let dir = path.parent().ok_or_else(|| format!("{} has no folder", path.display()))?;
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).map_err(|e| format!("can't make {}: {e}", dir.display()))?;
    let mode = std::fs::metadata(dir).map_err(|e| format!("can't read {}: {e}", dir.display()))?.permissions().mode();
    if mode & 0o077 != 0 { return Err(format!("{} isn't yours alone (it needs mode 700): no control socket, so agents can't reach this window", dir.display())) }
    // A socket nobody listens on is a window that ended without saying so.
    if path.exists() && UnixStream::connect(path).is_err() { let _ = std::fs::remove_file(path); }
    let listener = UnixListener::bind(path).map_err(|e| format!("can't listen on {}: {e}", path.display()))?;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    std::thread::spawn(move || {
        for stream in listener.incoming().map_while(Result::ok) {
            let ui = ui.clone();
            std::thread::spawn(move || connection(stream, ui));
        }
    });
    Ok(Control { path: path.to_path_buf() })
}

/// One connection: a line in, a line out, until the client hangs up.
fn connection(stream: UnixStream, ui: impl Ui) {
    let Ok(mut out) = stream.try_clone() else { return };
    for line in BufReader::new(stream).lines().map_while(Result::ok) {
        if line.trim().is_empty() { continue }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(request) => {
                let (send, answered) = channel::<Value>();
                ui.run(Box::new(move |s, tx| { let _ = send.send(answer(s, tx, &request)); }));
                answered.recv_timeout(PATIENCE).unwrap_or_else(|_| json!({ "ok": false, "error": "the window didn't answer: its UI thread is busy or gone", "kind": "busy" }))
            }
            Err(_) => json!({ "ok": false, "error": "bad json" }),
        };
        if writeln!(out, "{reply}").is_err() { return }
    }
}

/// One request, answered on the UI thread.
pub fn answer(s: &mut App, tx: &mut Tx, request: &Value) -> Value {
    match request["cmd"].as_str().unwrap_or("") {
        "peek" => json!({ "ok": true, "result": peek(s) }),
        "actions" => json!({ "ok": true, "result": listed(s) }),
        "act" => {
            let Some(action) = request["action"].as_str() else { return json!({ "ok": false, "error": "act needs an action name; `actions` lists them", "kind": "invalid" }) };
            let req = Request {
                action: action.to_string(),
                tile: request["tile"].as_str().map(str::to_string),
                by: None,
                args: request["args"].as_object().cloned().unwrap_or_else(Map::new),
            };
            // An act over the socket is an agent's, always: the person's keys are in the window.
            let by = Actor::Agent(request["as"].as_str().map(str::trim).filter(|id| !id.is_empty()).unwrap_or(AGENT).to_string());
            let outcome = s.act_request(req, by);
            s.effects(tx);
            if outcome.ok { json!({ "ok": true, "result": outcome.answer }) } else { json!({ "ok": false, "error": outcome.said, "kind": outcome.kind.unwrap_or("failed") }) }
        }
        other => json!({ "ok": false, "error": format!("unknown command {other}; try peek, actions or act"), "kind": "invalid" }),
    }
}

/// What the window shows, as state: nothing here needs a drawn frame, so a hidden window answers too.
pub fn peek(s: &App) -> Value {
    let person = s.person();
    let page = s.shown();
    let tree = s.tree();
    let mut tiles = vec![
        json!({ "id": "tree", "name": "tree", "kind": "tree", "asks": s.store().asks_of("tree"),
            "facts": { "rows": tree.iter().map(|line| json!({ "id": line.row.id, "title": line.row.title, "depth": line.depth })).collect::<Vec<_>>(), "unfolded": s.unfolded, "selected": s.subject() } }),
        json!({ "id": READER, "name": READER, "kind": "reader", "asks": s.store().asks_of(READER),
            "facts": { "note": s.subject(), "title": page.map(|p| p.title.clone()), "revision": page.map(|p| p.revision), "loading": s.loading(),
                "editing": s.editing.as_ref().map(|e| json!({ "note": e.note, "revision": e.revision, "unsaved": s.unsaved() })), "back": s.back } }),
    ];
    if s.bar.open {
        let rows = bar::rows(s);
        tiles.push(json!({ "id": "bar", "name": "bar", "kind": "bar", "asks": s.store().asks_of("bar"),
            "facts": { "scope": s.bar.scope, "query": s.bar.edit.text, "lit": s.bar.cursor + 1,
                "rows": rows.iter().enumerate().map(|(i, row)| json!({ "n": i + 1, "source": row.source, "key": row.key, "label": row.label, "act": row.line })).collect::<Vec<_>>() } }));
    }
    let mut text = vec![format!("{} on {}{}", s.at.outline, if s.machine.is_empty() { "…" } else { &s.machine }, if s.online { "" } else { " (offline)" })];
    if let Some(notice) = &s.notice { text.push(format!("! {}", notice.said)) }
    if let Some(said) = &s.agent_said { text.push(format!("· {said}")) }
    text.extend(tree.iter().map(|line| format!("{}{} {}", "  ".repeat(line.depth), if s.subject().as_deref() == Some(line.row.id.as_str()) { ">" } else { " " }, line.row.title)));
    if let Some(page) = page {
        text.push(String::new());
        text.extend(if s.editing.is_some() { s.editor.text.lines().map(str::to_string).collect::<Vec<_>>() } else { page.text.lines().map(str::to_string).collect() });
    }
    json!({
        "screen": {
            "screen": "desk", "outline": s.at.outline, "machine": s.machine, "online": s.online,
            "focus": person.focus, "whereabouts": person.json(), "watches": s.store().peek(), "tiles": tiles,
            "notice": s.notice.as_ref().map(|n| json!({ "said": n.said, "undo": n.undo })), "said": s.agent_said,
            "steps": s.steps.iter().rev().take(10).rev().map(actions::Step::json).collect::<Vec<_>>(),
        },
        "text": text,
    })
}

/// Every action, as its row under the name `act` runs it by, with the keys the table binds it to.
fn listed(s: &App) -> Value {
    let rows: Vec<Value> = actions::all().map(|action| {
        let mut row = serde_json::to_value(action.row).unwrap_or_else(|_| json!({}));
        row["name"] = json!(action.row.id);
        row
    }).collect();
    json!({ "screen": "desk", "note": s.subject(), "tiles": ["tree", READER], "actions": rows, "keys": keys::rows() })
}
