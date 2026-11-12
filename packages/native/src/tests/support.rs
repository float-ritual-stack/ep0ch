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
        "chips": [{ "key": "type", "value": "chore" }], "ancestors": ancestors,
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
    })
}

/// A made-up outline: Plot › (Lift the onions › Take the fork, Water the beans), Shed. `saves`: how `update` answers.
/// `screens`: the rows the host's `screens.list` answers beside the shipped ones, for a test to set (then
/// `screens_are`). `shipped`: whether the screens extension is installed there.
pub struct Garden { pub app: App, pub asked: Asked, pub said: Said, pub screens: Rc<RefCell<Value>>, pub shipped: Rc<std::cell::Cell<bool>> }

/// What the service answers with the screens extension installed: its screens, its kind rows and the list sources.
pub fn served() -> Value { serde_json::from_str(include_str!("../../../outline-core/fixtures/served-screens.json")).expect("the served fixture is JSON") }

/// The garden's notes under a parent (None: the top), as a tree lists them.
fn under(parent: Option<&str>) -> &'static [(&'static str, &'static str, bool)] {
    match parent {
        None => &[("plot", "Plot", true), ("shed", "Shed", false)],
        Some("plot") => &[("onions", "Lift the onions", true), ("beans", "Water the beans", false)],
        Some("onions") => &[("fork", "Take the fork", false)],
        _ => &[],
    }
}

fn opens(id: &str) -> String { format!("open id=\"{id}\"") }

/// `lists.read`, as the host would answer it for the garden: a row says what it shows and the act line a pick runs.
fn list(ask: &Value, titled: &dyn Fn(&str) -> String, screens: &Value, shipped: bool) -> Result<Value, (&'static str, String)> {
    let from = ask["from"].as_str().unwrap_or("");
    let words = ask["query"].as_str().unwrap_or("");
    let note = |id: &str, label: &str, detail: &str| json!({ "id": id, "label": label, "detail": detail, "do": { "open": id }, "act": opens(id) });
    let answer = |list: Value| Ok(json!({ "from": from, "list": list, "anyChange": true }));
    match from {
        "sources" => answer(json!({ "type": "list", "arrange": "table", "rows": served()["sources"] })),
        "children" => {
            let open: Vec<&str> = ask["open"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            fn walk(parent: Option<&str>, depth: usize, open: &[&str], rows: &mut Vec<Value>, answered: &mut Vec<String>) {
                for (id, title, folds) in under(parent) {
                    let unfolded = *folds && open.contains(id);
                    rows.push(json!({ "id": id, "label": title, "depth": depth, "folds": folds, "open": unfolded, "do": { "open": id }, "act": opens(id) }));
                    if unfolded { answered.push(id.to_string()); walk(Some(id), depth + 1, open, rows, answered) }
                }
            }
            let (mut rows, mut answered) = (Vec::new(), Vec::new());
            walk(ask["of"].as_str(), 0, &open, &mut rows, &mut answered);
            Ok(json!({ "from": from, "list": { "type": "list", "arrange": "tree", "rows": rows, "empty": "No notes yet." }, "open": answered, "anyChange": true }))
        }
        "search" if words.trim().is_empty() => answer(json!({ "type": "list", "arrange": "rows", "rows": [], "empty": "Type to search." })),
        "search" => answer(json!({ "type": "list", "arrange": "rows", "rows": [note("beans", &format!("found for {words}"), "Plot")] })),
        "query" | "lanes" | "facets" if words == "type!=chore" => Err(("invalid", "There is no != ; put NOT before the clause.".into())),
        // A long list: every row is listed, and a window builds only the ones in view.
        "query" if words == "type=seed" => answer(json!({ "type": "list", "arrange": "rows", "rows": (0..600).map(|i| note(&format!("seed{i}"), &format!("Seed packet {i}"), "2026-03-01")).collect::<Vec<_>>() })),
        "query" | "lanes" => {
            let mut beans = note("beans", "Water the beans", "2026-03-01");
            beans["chips"] = json!([{ "key": "type", "value": "chore" }, { "key": "area", "value": "plot" }]);
            let mut onions = note("onions", "Lift the onions", "2026-03-02");
            onions["chips"] = json!([{ "key": "type", "value": "chore" }, { "key": "area", "value": "bed" }]);
            let columns: Vec<&str> = ask["columns"].as_str().map(|c| c.split_whitespace().collect()).unwrap_or_default();
            for row in [&mut beans, &mut onions] { if !columns.is_empty() { row["cells"] = json!(columns.iter().map(|c| if *c == "title" { row["label"].clone() } else { row["chips"].as_array().unwrap().iter().find(|chip| chip["key"] == *c).map_or(json!(""), |chip| chip["value"].clone()) }).collect::<Vec<_>>()) } }
            // Narrowed by a property, only the notes that carry it are left: the question is the tile's own words.
            let rows: Vec<Value> = [beans, onions].into_iter().filter(|row| !words.contains("area=") || row["chips"].as_array().unwrap().iter().any(|chip| words.contains(&format!("area={}", chip["value"].as_str().unwrap())))).collect();
            let group = ask["group"].as_str();
            let groups = group.map(|key| { let mut seen: Vec<Value> = Vec::new(); for row in &rows { let value = row["chips"].as_array().unwrap().iter().find(|chip| chip["key"] == key).map_or(json!(""), |chip| chip["value"].clone()); match seen.iter_mut().find(|g| g["name"] == value) { Some(g) => { g["ids"].as_array_mut().unwrap().push(row["id"].clone()); g["count"] = json!(g["ids"].as_array().unwrap().len()) } None => seen.push(json!({ "name": value, "label": value, "count": 1, "ids": [row["id"]] })) } } seen });
            let arrange = if from == "lanes" { "lanes" } else { ask["arrange"].as_str().unwrap_or(if columns.is_empty() { "rows" } else { "table" }) };
            let mut list = json!({ "type": "list", "arrange": arrange, "rows": rows, "empty": "Nothing matches." });
            if !columns.is_empty() { list["columns"] = json!(columns); list["headers"] = json!(columns) }
            if let Some(groups) = groups { list["groups"] = json!(groups) }
            let mut out = json!({ "from": from, "list": list, "facets": [{ "key": "area", "count": 2, "values": [{ "value": "plot", "count": 1 }, { "value": "bed", "count": 1 }] }], "anyChange": true });
            if let Some(sort) = ask["sort"].as_str() { out["sort"] = json!(sort) }
            if let Some(group) = group { out["group"] = json!(group) }
            Ok(out)
        }
        "facets" => answer(json!({ "type": "list", "arrange": "rows", "groups": [{ "name": "area", "label": "area", "count": 2 }],
            "rows": [{ "id": "area=plot", "label": "plot", "detail": "1", "group": "area", "act": "facets.set key=\"area\" value=\"plot\"" }, { "id": "area=bed", "label": "bed", "detail": "1", "group": "area", "act": "facets.set key=\"area\" value=\"bed\"" }] })),
        "links" => match ask["of"].as_str() {
            None => Err(("invalid", "lists.read from=links is about one note: name it with of=<a block id>".into())),
            Some(_) => answer(json!({ "type": "list", "arrange": "rows", "title": "Linked from · 1", "rows": [note("plan", "Plan for Saturday", "Plot")], "empty": "No note links here." })),
        },
        "properties" => match ask["of"].as_str() {
            None => Err(("invalid", "lists.read from=properties is about one note: name it with of=<a block id>".into())),
            Some(of) => answer(json!({ "type": "list", "arrange": "table", "columns": ["property", "value"], "headers": ["property", "value"], "title": titled(of),
                "groups": [{ "name": "properties", "label": "Properties", "count": 2 }, { "name": "record", "label": "Record", "count": 2 }],
                "rows": [
                    { "id": "type=chore#0", "label": "type", "detail": "chore", "cells": ["type", "chore"], "group": "properties", "act": "bar.open scope=\"query\" query=\"type=chore\"" },
                    { "id": "room=north#0", "label": "room", "detail": "north", "cells": ["room", "north"], "group": "properties", "act": "bar.open scope=\"query\" query=\"room=north\"" },
                    { "id": "record:revision", "label": "revision", "detail": "3", "cells": ["revision", "3"], "group": "record" },
                    { "id": "record:id", "label": "id", "detail": of, "cells": ["id", of], "group": "record" },
                ] })),
        },
        "activity" => answer(json!({ "type": "list", "arrange": "rows", "rows": [note("beans", "Water the beans", "compost-agent · text · 2026-03-01 09:30")], "empty": "Nothing has changed yet." })),
        "clients" => answer(json!({ "type": "list", "arrange": "rows", "rows": [{ "id": "potting-bench", "label": "potting-bench", "detail": "door · box" }], "empty": "Nobody else is here." })),
        "screens" => {
            let mut all = if shipped { served()["screens"].as_array().cloned().unwrap_or_default() } else { Vec::new() };
            all.extend(screens.as_array().cloned().unwrap_or_default());
            let rows: Vec<Value> = all.iter().filter(|s| s["spec"].is_object()).filter(|s| words.is_empty() || s["name"].as_str().unwrap_or("").contains(words)).map(|s| json!({ "id": s["name"], "label": s["title"], "detail": "a screen", "act": format!("screen.open name=\"{}\"", s["name"].as_str().unwrap()) })).collect();
            answer(json!({ "type": "list", "arrange": "rows", "rows": rows, "empty": "No screens here: the screens extension adds the ones every door ships (extensions.install id=screens)." }))
        }
        other => Err(("invalid", format!("lists.read lists children, search, query, lanes, facets, links, properties, activity, clients, screens (from=sources says what each reads), not \"{other}\""))),
    }
}

pub fn garden(saves: Rc<RefCell<Result<(), (&'static str, String)>>>) -> Garden { garden_on(saves, true) }

/// The garden on a host with the screens extension installed, or (`shipped: false`) without it.
pub fn garden_on(saves: Rc<RefCell<Result<(), (&'static str, String)>>>, with_screens: bool) -> Garden {
    let (asked, said): (Asked, Said) = Default::default();
    let texts: Rc<RefCell<std::collections::HashMap<String, (u64, String)>>> = Default::default();
    let screens: Rc<RefCell<Value>> = Rc::new(RefCell::new(json!([])));
    let listed = screens.clone();
    let shipped = Rc::new(std::cell::Cell::new(with_screens));
    let installed = shipped.clone();
    let answers: Answers = Box::new(move |ask| {
        let note = ask["blockId"].as_str().unwrap_or("").to_string();
        let titled = |id: &str| match id { "plot" => "Plot", "onions" => "Lift the onions", "beans" => "Water the beans", "shed" => "Shed", "new" => "", _ => "Take the fork" }.to_string();
        match ask["action"].as_str().unwrap_or("") {
            "ping" => Ok(json!({ "status": "ready", "protocolVersion": PROTOCOL, "location": { "machine": "box" }, "outline": { "name": "garden" } })),
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
            // The screens and kinds every door ships, as the service answers them with the screens extension
            // installed (outline-core's fixture, written by the outliner's own test), then the outline's own
            // screens: none, until a test's host says otherwise (`screens_are`).
            "screens.list" => {
                let mut screens = if shipped.get() { served()["screens"].as_array().cloned().unwrap_or_default() } else { Vec::new() };
                screens.extend(listed.borrow().as_array().cloned().unwrap_or_default());
                Ok(json!({ "screens": screens, "kinds": if shipped.get() { served()["kinds"].clone() } else { json!([]) }, "problems": [], "anyChange": true }))
            }
            "lists.read" => list(ask, &titled, &listed.borrow(), shipped.get()),
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
    Garden { app, asked, said, screens, shipped: installed }
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
pub fn listed(app: &App) -> Vec<(usize, String)> { app.tree().iter().map(|row| (row.depth, row.label.clone())).collect() }
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
