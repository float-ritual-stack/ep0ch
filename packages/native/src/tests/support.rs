//! What the tests share: a stand-in link that answers by wire action, as the host would, and the made-up garden
//! it answers for (Plot › (Lift the onions › Take the fork, Water the beans), Shed).
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::time::Duration;

use rune::{Env, Key, KeyEvent, Mods, Runtime};
use serde_json::{Value, json};

use crate::actions::{Actor, App, Outcome};
use crate::client::{Link, PROTOCOL};
use crate::shell::view;

pub type Asked = Rc<RefCell<Vec<Value>>>;
pub type Said = Rc<RefCell<VecDeque<Value>>>;
pub type Answers = Box<dyn FnMut(&Value) -> Result<Value, (&'static str, String)>>;

/// Answers each request where it stands; `said` is the line a test adds as the host would between answers.
pub struct Standin { pub answers: Answers, pub asked: Asked, pub said: Said }

impl Link for Standin {
    fn send(&mut self, request: &Value) {
        self.asked.borrow_mut().push(request.clone());
        let line = match (self.answers)(request) {
            Ok(result) => json!({ "id": request["id"], "ok": true, "result": result }),
            Err((kind, error)) => json!({ "id": request["id"], "ok": false, "kind": kind, "error": error }),
        };
        self.said.borrow_mut().push_back(line);
    }
    fn take(&mut self) -> Vec<Value> { self.said.borrow_mut().drain(..).collect() }
    fn wait(&mut self, _: &str, _: Duration) {}
}

/// A made-up picture, as `media.read` hands one over.
pub const SUN: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#234"/><circle cx="20" cy="10" r="6" fill="#fc6"/></svg>"##;

fn page(id: &str, title: &str, revision: u64, text: &str) -> Value {
    let mut page = plain_page(id, title, revision, text);
    // The shed's page has pictures: a header image, a file, a fence's own text, and one the host can't read.
    if id == "shed" {
        page["hero"] = json!({ "path": "pictures/banner.svg", "width": "fit", "alt": "Dusk over the beds", "dim": 0.2 });
        page["parts"] = json!([
            part(id, "picture", 1, json!({}), json!({ "type": "picture", "path": "pictures/beds.svg", "width": "fit", "alt": "Four beds" })),
            part(id, "picture", 2, json!({}), json!({ "type": "picture", "svg": SUN, "width": "fit", "height": 6 })),
            part(id, "picture", 5, json!({}), json!({ "type": "picture", "path": "pictures/missing.png", "width": "fit", "alt": "The photo nobody took", "problems": ["size::huge isn't a size"] })),
        ]);
    }
    page
}

/// A part as `notes.page` frames one (outline-core's `PagePart`): where it is written, the service's word on it, its view.
pub fn part(note: &str, kind: &str, line: u64, frame: Value, view: Value) -> Value {
    let mut part = json!({ "type": "part", "kind": kind, "block": note, "span": { "start": 0, "end": 0 }, "line": line, "view": view });
    for (key, value) in frame.as_object().into_iter().flatten() { part[key.as_str()] = value.clone() }
    part
}

fn plain_page(id: &str, title: &str, revision: u64, text: &str) -> Value {
    let ancestors = match id { "onions" | "beans" => json!([{ "id": "plot", "title": "Plot", "hasChildren": true }]), "fork" => json!([{ "id": "plot", "title": "Plot", "hasChildren": true }, { "id": "onions", "title": "Lift the onions", "hasChildren": true }]), _ => json!([]) };
    json!({
        "blockId": id, "revision": revision, "title": title, "text": text,
        "chips": [{ "key": "type", "value": "chore" }], "properties": [{ "key": "type", "value": "chore" }, { "key": "room", "value": "north" }],
        "updated": "2026-03-01T09:30:00.000Z", "author": "user", "ancestors": ancestors,
        "parts": [
            part(id, "prose", 1, json!({}), json!({ "type": "markdown", "text": "Before the rain. See [the shed](ep0ch:b/shed) and [seeds](ep0ch:p/Seed%20list)." })),
            part(id, "links", 3, json!({ "name": "links", "title": "On the plot", "query": "type=chore", "status": "live · 1 match" }),
              json!({ "type": "list", "groups": [{ "name": "Matches", "label": "Matches", "count": 1 }], "rows": [{ "id": "0.0", "label": "Water the beans", "group": "Matches", "do": { "open": "beans" } }] })),
            part(id, "figure", 6, json!({ "name": "graph-stat", "figure": "stat", "title": "Chores", "status": "live" }),
              json!({ "type": "row", "children": [{ "type": "stat", "label": "to do", "value": "2" }, { "type": "stat", "label": "done", "value": "5", "tone": "accent" }] })),
            part(id, "view", 9, json!({ "name": "view", "title": "Every chore" }), json!({ "type": "list", "headers": ["state"],
              "rows": [{ "id": "fork", "label": "Take the fork", "cells": ["todo", { "text": "plot" }], "do": { "open": "fork" } }] })),
            part(id, "button", 12, json!({ "name": "button" }), json!({ "type": "button", "label": "Sow the peas", "act": "note.new" })),
            part(id, "button", 13, json!({ "name": "button", "sequence": true }), json!({ "type": "button", "label": "Tidy the shed", "act": "tidy" })),
        ],
        "children": [{ "id": "fork", "title": "Take the fork" }],
        "backlinks": [{ "id": "plan", "title": "Plan for Saturday", "context": "Plot" }],
    })
}

/// A made-up outline: Plot › (Lift the onions › Take the fork, Water the beans), Shed. `saves`: how `update` answers.
/// `screens`: the rows the host's `screens.list` answers, for a test to set (then `screens_changed`).
pub struct Garden { pub app: App, pub asked: Asked, pub said: Said, pub screens: Rc<RefCell<Value>> }

pub fn garden(saves: Rc<RefCell<Result<(), (&'static str, String)>>>) -> Garden {
    let (asked, said): (Asked, Said) = Default::default();
    let texts: Rc<RefCell<std::collections::HashMap<String, (u64, String)>>> = Default::default();
    let screens: Rc<RefCell<Value>> = Rc::new(RefCell::new(json!([])));
    let listed = screens.clone();
    let answers: Answers = Box::new(move |ask| {
        let note = ask["blockId"].as_str().unwrap_or("").to_string();
        let titled = |id: &str| match id { "plot" => "Plot", "onions" => "Lift the onions", "beans" => "Water the beans", "shed" => "Shed", "new" => "", _ => "Take the fork" }.to_string();
        match ask["action"].as_str().unwrap_or("") {
            "ping" => Ok(json!({ "status": "ready", "protocolVersion": PROTOCOL, "location": { "machine": "box" }, "outline": { "name": "garden" } })),
            "blocks.read" => Ok(json!({ "generation": 0, "blocks": match ask["under"].as_str() {
                None => json!([{ "id": "plot", "title": "Plot", "hasChildren": true }, { "id": "shed", "title": "Shed", "hasChildren": false }]),
                Some("plot") => json!([{ "id": "onions", "title": "Lift the onions", "hasChildren": true }, { "id": "beans", "title": "Water the beans", "hasChildren": false }]),
                Some("onions") => json!([{ "id": "fork", "title": "Take the fork", "hasChildren": false }]),
                _ => json!([]),
            } })),
            "notes.page" => {
                let (revision, text) = texts.borrow().get(&note).cloned().unwrap_or((3, format!("{} [type::chore]\nBefore the rain.", titled(&note))));
                Ok(page(&note, &titled(&note), revision, &text))
            }
            "update" => saves.borrow().clone().map(|()| {
                let revision = ask["expectedRevision"].as_u64().unwrap() + 1;
                texts.borrow_mut().insert(note.clone(), (revision, ask["text"].as_str().unwrap().to_string()));
                json!({ "id": note, "revision": revision })
            }),
            "create" => { texts.borrow_mut().insert("new".into(), (7, String::new())); Ok(json!({ "id": "new", "revision": 7, "text": "", "parentId": ask["parentId"] })) }
            "delete" => Ok(json!({ "id": note, "parentId": "plot" })),
            "trash.restore" => Ok(json!({ "id": note, "parentId": "plot" })),
            "move" => Ok(json!({ "outcome": "applied", "said": "moved up", "parentId": "plot", "previousParentId": "plot" })),
            "media.read" => match ask["path"].as_str().unwrap() {
                "pictures/missing.png" => Err(("failed", "pictures/missing.png isn't on the outline's machine".into())),
                path => Ok(json!({ "path": path, "mime": "image/svg+xml", "from": "file", "base64": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, SUN) })),
            },
            "screens.save" => Ok(json!({ "name": "beds", "title": "Beds", "id": "screen-note", "revision": ask["base"]["revision"].as_u64().map_or(1, |r| r + 1), "created": ask["base"].is_null() })),
            // The outline's own screens: none, until a test's host says otherwise (`host_says`).
            "screens.list" => Ok(json!({ "screens": listed.borrow().clone(), "problems": [], "anyChange": true })),
            "tree.search" => Ok(json!({ "matches": [{ "block": { "id": "beans", "revision": 1 }, "title": format!("found for {}", ask["query"].as_str().unwrap()), "path": "Plot" }] })),
            "blocks.query" => match ask["query"]["where"].as_str().unwrap() {
                "type!=chore" => Err(("invalid", "There is no != ; put NOT before the clause.".into())),
                _ => Ok(json!({ "generation": 0, "blocks": [{ "id": "beans", "title": "Water the beans", "updatedAt": "2026-03-01T09:30:00.000Z" }], "facets": [{ "key": "area", "count": 2, "values": [{ "value": "plot", "count": 2, "last": "" }] }] })),
            },
            "events.subscribe" => Ok(json!({ "subscribed": true })),
            // The service runs a button's steps and says how the run went; what it answers a script's act with is its own.
            "scripts.sequence" => match ask["line"].as_u64() { Some(13) => Ok(json!({ "extension": "button", "action": "run", "undo": "run-1", "state": "running", "written": [] })), _ => Err(("invalid", "No button on that line; read the note and press its current button".into())) },
            "scripts.answer" => Ok(json!({ "accepted": true })),
            action => Err(("failed", format!("no action {action}"))),
        }
    });
    let mut app = App::new(Box::new(Standin { answers, asked: asked.clone(), said: said.clone() }), "garden");
    app.start();
    app.settle();
    Garden { app, asked, said, screens }
}

/// The host's screens are `rows` now, and it says so: the watched `screens.list` is read again.
pub fn screens_are(g: &mut Garden, rows: Value) {
    *g.screens.borrow_mut() = rows;
    let key = watch_of(&g.asked, "screens.list", |_| true);
    let generation = g.asked.borrow().len() as u64;
    changed(&mut g.app, &g.said, &key, generation);
    // The change is told, then the answer it asked for lands.
    g.app.settle();
}

/// A screen note's row, as `screens.list` answers one.
pub fn screen_row(name: &str, layout: Value, problems: Value) -> Value {
    json!({ "name": name, "title": name, "from": "note", "note": { "id": format!("{name}-note"), "revision": 2, "form": "blocks" }, "spec": { "name": name, "title": name, "layout": layout }, "problems": problems })
}

/// Where an element is on screen, by its key: [x, y, w, h].
pub fn rect_of(rt: &Runtime<App>, key: &str) -> Option<[f32; 4]> { rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key)).map(|e| e.rect) }

/// A drag from one point to another, let go there.
pub fn drag(rt: &mut Runtime<App>, from: (f32, f32), to: (f32, f32)) {
    rt.pointer_down(from.0, from.1);
    rt.pointer_move((from.0 + to.0) / 2.0, (from.1 + to.1) / 2.0);
    rt.pointer_move(to.0, to.1);
    rt.pointer_up(to.0, to.1);
    rest(rt);
}

pub fn ok() -> Rc<RefCell<Result<(), (&'static str, String)>>> { Rc::new(RefCell::new(Ok(()))) }
pub fn listed(app: &App) -> Vec<(usize, String)> { app.tree().iter().map(|line| (line.depth, line.row.title.clone())).collect() }
pub fn last(asked: &Asked) -> Value { asked.borrow().last().unwrap().clone() }
pub fn actions(asked: &Asked) -> Vec<String> { asked.borrow().iter().map(|a| a["action"].as_str().unwrap().to_string()).collect() }


/// One act line, as the person, with everything it asked landed.
pub fn act(app: &mut App, line: &str) -> Outcome {
    let outcome = app.act(line, Actor::Person);
    app.settle();
    outcome
}

/// The note the reader shows.
pub fn open_note(app: &App) -> Option<String> { app.subject() }

/// The host says a line between answers, and what follows lands.
pub fn host_says(app: &mut App, said: &Said, line: Value) {
    said.borrow_mut().push_back(line);
    app.settle();
}

/// The watch key the newest read of `action` (with `matching` in its request) was registered under.
pub fn watch_of(asked: &Asked, action: &str, matching: impl Fn(&Value) -> bool) -> String {
    asked.borrow().iter().rev().find(|a| a["action"] == action && a.get("watch").is_some() && matching(a)).and_then(|a| a["watch"].as_str().map(str::to_string)).unwrap_or_else(|| panic!("no watched {action} was asked"))
}

/// The host says a watched answer moved.
pub fn changed(app: &mut App, said: &Said, key: &str, generation: u64) {
    host_says(app, said, json!({ "event": { "domain": "queries", "action": "queries.changed", "changes": [{ "key": key, "generation": generation }] } }));
}

// ── the window itself ─────────────────────────────────────────────────────────────────────────────────────────

pub fn window(app: App) -> Runtime<App> {
    let mut rt = Runtime::new(app, view, (1180.0, 760.0), Env { system_dark: false, scale: 1.0 });
    // As the app runs it: answers land in `poll`, before each frame, and a key nothing focused took is the table's.
    rt.poll = Some(|s, _, tx| { let landed = s.take(); s.effects(tx) | crate::keys::follow(s, tx) | landed });
    rt.on_key = Some(crate::keys::press);
    // The tiles' area is measured on the first frame, and the tiles sit in it from the next.
    for _ in 0..3 { rt.frame(0.0); }
    rt
}

/// Frames until what left has finished leaving.
pub fn rest(rt: &mut Runtime<App>) { for _ in 0..90 { rt.frame(1.0 / 60.0); } }

/// A press, then frames until what left has finished leaving.
pub fn press(rt: &mut Runtime<App>, key: &str) {
    let (x, y) = rt.find(key).unwrap_or_else(|| panic!("nothing on screen is keyed {key}"));
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rest(rt);
}

/// The primary shortcut modifier as the platform reports it: Ctrl with `cmd` set off macOS.
pub fn primary() -> Mods { Mods { cmd: true, ctrl: !cfg!(target_os = "macos"), logo: cfg!(target_os = "macos"), ..Mods::default() } }

/// A key with its modifiers, as the window gets one.
pub fn chord(rt: &mut Runtime<App>, key: Key, mods: Mods) {
    rt.key(KeyEvent { key, mods });
    rest(rt);
}

pub fn typed(rt: &mut Runtime<App>, text: &str) {
    for ch in text.chars() { rt.key(KeyEvent { key: Key::Text(ch.to_string()), mods: Mods::default() }); rt.frame(0.0); }
    rest(rt);
}
