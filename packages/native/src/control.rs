//! The control socket: what the window shows and what it can do, for an agent. `native.sock` speaks the door's
//! control protocol (the door's src/control.ts), so the door's own client reaches it: `EP0CH_CONTROL=<native.sock>
//! ep0ch act note.trash`. One JSON object a line each way:
//!
//! - `{cmd: "act", action, args?, tile?, as?}` runs one action as the agent `as` names, through the same
//!   dispatcher as a key or a press. It takes no pointer, no focus and no selection.
//! - **A request is for one window.** A run may have several (a tile torn out is a window of its own), and each
//!   is named: `window` says which (in the request, or as `window=<name>` among an act's own words, which is how
//!   the door's client carries it); left out, it is the run's first. `peek` answers the window's name and every
//!   window there is; a name none has is refused with the ones there are.
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
use std::sync::Mutex;
use std::sync::mpsc::channel;
use std::time::Duration;

use rune::Tx;
use serde_json::{Map, Value, json};

use crate::actions::{self, Actor, App};
use crate::actline::Request;
use crate::{bar, keys, tiles};

/// Work for the UI thread.
pub type Job = Box<dyn FnOnce(&mut App, &mut Tx) + Send>;

/// The way onto a window's UI thread: the run's windows by name, or a test's own loop. `window`: the one a
/// request names (none: the run's first). Refused, with the windows there are, when none has that name.
pub trait Ui: Clone + Send + 'static {
    fn run(&self, window: Option<&str>, job: Job) -> Result<(), String>;
}

/// The windows of this run an agent can reach, in the order they opened: each its name and the way onto its UI
/// thread. The shell adds one as it opens it (`here`) and a window takes itself out as it closes (`gone`).
static WINDOWS: Mutex<Vec<(String, rune::AppHandle<App>)>> = Mutex::new(Vec::new());

/// A window is open: agents reach it by `name`.
pub fn here(name: &str, handle: rune::AppHandle<App>) {
    let mut windows = WINDOWS.lock().unwrap();
    windows.retain(|(theirs, _)| theirs != name);
    windows.push((name.to_string(), handle));
}

/// A window is closing (its `on_close`): nothing reaches it by its name any more.
pub fn gone(s: &mut App, _: &mut Tx) {
    let name = s.window();
    WINDOWS.lock().unwrap().retain(|(theirs, _)| *theirs != name);
}

/// The run's windows, as the control socket reaches them.
#[derive(Clone)]
pub struct Windows;

impl Ui for Windows {
    fn run(&self, window: Option<&str>, job: Job) -> Result<(), String> {
        let windows = WINDOWS.lock().unwrap();
        let found = match window { Some(name) => windows.iter().find(|(theirs, _)| theirs == name), None => windows.first() };
        match found {
            Some((_, handle)) => { handle.update(move |s, tx| job(s, tx)); Ok(()) }
            None => Err(format!("no window named {}: the windows are {}", window.unwrap_or("(none)"), windows.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>().join(", "))),
        }
    }
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
            Ok(mut request) => {
                let (send, answered) = channel::<Value>();
                let window = window_of(&mut request);
                match ui.run(window.as_deref(), Box::new(move |s, tx| { let _ = send.send(answer(s, tx, &request)); })) {
                    Ok(()) => answered.recv_timeout(PATIENCE).unwrap_or_else(|_| json!({ "ok": false, "error": "the window didn't answer: its UI thread is busy or gone", "kind": "busy" })),
                    Err(why) => json!({ "ok": false, "error": why, "kind": "invalid" }),
                }
            }
            Err(_) => json!({ "ok": false, "error": "bad json" }),
        };
        if writeln!(out, "{reply}").is_err() { return }
    }
}

/// The word a request names its window by.
const WINDOW: &str = "window";

/// The window a request is for, taken out of it: its own `window`, else `window=` among an act's words (the door's
/// client sends every `key=value` after the action as an argument). None: the run's first.
fn window_of(request: &mut Value) -> Option<String> {
    let named = request.get(WINDOW).and_then(Value::as_str).map(str::to_string);
    let among = request.get_mut("args").and_then(Value::as_object_mut).and_then(|args| args.remove(WINDOW)).and_then(|word| word.as_str().map(str::to_string));
    named.or(among).map(|name| name.trim().to_string()).filter(|name| !name.is_empty())
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
            crate::keys::effects(s, tx);
            if outcome.ok { json!({ "ok": true, "result": outcome.answer }) } else { json!({ "ok": false, "error": outcome.said, "kind": outcome.kind.unwrap_or("failed") }) }
        }
        other => json!({ "ok": false, "error": format!("unknown command {other}; try peek, actions or act"), "kind": "invalid" }),
    }
}

/// What the window shows, as state: nothing here needs a drawn frame, so a hidden window answers too.
pub fn peek(s: &App) -> Value {
    let person = s.person();
    let shown = s.shown_tiles();
    // Every tile of the arrangement, as its drawer says it: the ones on screen with what they ask.
    let mut tiles: Vec<Value> = s.layout.all().iter().map(|id| {
        let (name, kind) = (s.layout.name(id), s.spec(id).map_or("", |spec| spec.kind.as_str()));
        let facts = s.cx(id).and_then(|cx| tiles::drawer_of(cx.row).map(|drawer| (drawer.facts)(&cx))).unwrap_or(Value::Null);
        json!({ "id": id, "name": name, "kind": kind, "shown": shown.contains(id), "focused": s.layout.focus == *id, "facts": facts, "asks": s.store().asks_of(id), "problems": s.problems_of(id) })
    }).collect();
    if s.bar.open {
        let rows = bar::rows(s);
        tiles.push(json!({ "id": "bar", "name": "bar", "kind": "bar", "asks": s.store().asks_of("bar"),
            "facts": { "scope": s.bar.scope, "query": s.bar.edit.words(), "lit": s.bar.cursor + 1, "sources": bar::sources(s).iter().map(|source| json!({ "id": source.id, "about": source.about, "served": source.served, "main": source.main })).collect::<Vec<_>>(),
                "rows": bar::described(&rows) } }));
    }
    let page = s.shown();
    let mut text = vec![format!("{} on {}{} · screen {}", s.at.outline, if s.machine.is_empty() { "…" } else { &s.machine }, if s.online { "" } else { " (offline)" }, s.screen.name)];
    if let Some(notice) = &s.notice { text.push(format!("! {}", notice.said)) }
    if let Some(said) = &s.agent_said { text.push(format!("· {said}")) }
    text.extend(s.tree().iter().map(|row| format!("{}{} {}", "  ".repeat(row.depth), if s.subject().as_deref() == Some(row.id.as_str()) { ">" } else { " " }, row.label)));
    if let Some(page) = page {
        text.push(String::new());
        // A block being written reads as it is typed.
        text.extend(s.draft_of(&page.id).map_or(page.text.as_str(), |draft| draft.buf.words()).lines().map(str::to_string));
    }
    json!({
        "screen": {
            "screen": s.screen.name, "outline": s.at.outline, "machine": s.machine, "online": s.online,
            // Which window this is, and every window of the run: an act names one with window=.
            "window": s.window(), "windows": s.store().windows(),
            // The outlines this window left, each kept as it was, and the form open over it.
            "parked": s.parked.keys().map(|at| json!({ "outline": at.outline, "machine": at.machine })).collect::<Vec<_>>(),
            "form": s.form.as_ref().map(|form| json!({ "extension": form.extension, "said": form.said, "fields": form.fields.iter().map(|field| json!({ "name": field.name, "text": field.edit.words(), "was": field.was })).collect::<Vec<_>>() })),
            "focus": person.focus, "whereabouts": person.json(), "watches": s.store().peek(), "tiles": tiles,
            // The arrangement as it would be saved, with each container's id, and how far `layout.undo` goes back.
            "layout": s.layout.save(), "revision": s.layout.rev, "undo": s.journal.len(),
            "screens": s.screens().iter().map(|screen| json!({ "name": screen.name, "title": screen.title, "problems": screen.problems.iter().map(|p| json!({ "tile": p.tile, "said": p.said })).collect::<Vec<_>>() })).collect::<Vec<_>>(),
            // What is wrong that no one screen holds (two notes with one name), in the service's words.
            "screenProblems": s.screen_problems(),
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
    json!({ "screen": s.screen.name, "note": s.subject(), "tiles": s.layout.names.0.iter().map(|(_, name)| name.clone()).collect::<Vec<_>>(), "actions": rows, "keys": keys::rows(s), "catalogue": tiles::described(s),
        // What each installed extension adds, a row a thing, as the service lists them.
        "extensions": s.extensions().map(|listed| listed.parts().iter().map(crate::ext::Part::json).collect::<Vec<_>>()) })
}
