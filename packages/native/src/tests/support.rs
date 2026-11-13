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
              json!({ "type": "list", "groups": [{ "name": "Matches", "label": "Matches", "count": 1 }], "rows": [{ "id": "beans", "label": "Water the beans", "group": "Matches", "do": { "open": "beans" }, "act": opens("beans") }] })),
            part(id, "figure", 6, json!({ "name": "graph-stat", "figure": "stat", "title": "Chores", "status": "live" }),
              json!({ "type": "row", "children": [{ "type": "stat", "label": "to do", "value": "2" }, { "type": "stat", "label": "done", "value": "5", "tone": "accent" }] })),
            part(id, "view", 9, json!({ "name": "view", "title": "Every chore" }), json!({ "type": "list", "headers": ["state"],
              "rows": [{ "id": "fork", "label": "Take the fork", "cells": ["todo", { "text": "plot" }], "do": { "open": "fork" }, "act": opens("fork") }] })),
            part(id, "button", 12, json!({ "name": "button" }), json!({ "type": "button", "label": "Sow the peas", "act": "note.new" })),
            part(id, "button", 13, json!({ "name": "button", "sequence": true }), json!({ "type": "button", "label": "Tidy the shed", "act": "tidy" })),
        ],
        "children": [{ "id": "fork", "title": "Take the fork" }],
        // The notes under it, as the one list (outline-core's `NotePage.under`): a row says the act line a pick runs.
        "under": { "type": "list", "title": "Under this note · 1", "rows": [{ "id": "fork", "label": "Take the fork", "do": { "open": "fork" }, "act": opens("fork") }], "filter": false, "enter": false },
    })
}

/// A made-up outline: Plot › (Lift the onions › Take the fork, Water the beans), Shed. `saves`: how `update` answers.
/// `screens`: the rows the host's `screens.list` answers beside the shipped ones, for a test to set (then
/// `screens_are`). `shipped`: whether the screens extension is installed there.
pub struct Garden { pub app: App, pub asked: Asked, pub said: Said, pub screens: Rc<RefCell<Value>>, pub shipped: Rc<std::cell::Cell<bool>>, pub elsewhere: Elsewhere }

/// What the hosts of the other outlines a window switched to were asked and said, by the outline's name: a link each.
pub type Elsewhere = Rc<RefCell<std::collections::HashMap<String, (Asked, Said)>>>;

/// The outlines the stand-in host says there are (`outlines.known`): the garden's own, one more on this machine, and
/// one on a machine it holds a forward to.
pub fn known() -> Value { json!({ "outlines": [{ "name": "allotment" }, { "name": "garden", "here": true }, { "name": "orchard", "machine": "shed-box" }] }) }

/// The made-up extension the stand-in host has: installed or not, and its one setting.
#[derive(Clone)]
struct Waiting { installed: Rc<std::cell::Cell<bool>>, warn: Rc<std::cell::Cell<Option<i64>>> }

impl Waiting {
    fn settings(&self) -> Value {
        let mut field = json!({ "name": "warn-days", "type": "integer", "description": "A wait longer than this many days is drawn as a warning", "default": 3, "state": "default" });
        if let Some(days) = self.warn.get() { field["value"] = json!(days); field["state"] = json!("set") }
        json!({ "file": "extensions/waiting/config.json", "exists": self.warn.get().is_some(), "state": if self.warn.get().is_some() { "set" } else { "default" }, "fields": [field], "secrets": [], "config": {} })
    }
    /// `extensions.list`, as far as a window reads it.
    fn listed(&self) -> Value {
        let screen = json!({ "name": "waiting", "title": "waiting on others" });
        let tile = json!({ "kind": "waiting.list", "name": "Outbox waiting", "description": "the outbox items still waiting for an answer", "render": "waiting" });
        let compost = json!({ "id": "compost", "name": "Compost", "state": "active", "screens": [], "tiles": [], "bar": [], "actions": [{ "id": "turn", "name": "ext.compost.turn", "label": "Turn the heap", "description": "Turns the heap and says when" }] });
        let waiting = json!({ "id": "waiting", "name": "Waiting", "state": "active", "settings": self.settings(), "screens": [screen], "tiles": [tile], "actions": [], "bar": [] });
        if self.installed.get() { json!({ "extensions": [compost, waiting], "available": [{ "id": "moon", "name": "Moon" }] }) } else { json!({ "extensions": [compost], "available": [{ "id": "moon", "name": "Moon" }, { "id": "waiting", "name": "Waiting" }] }) }
    }
    /// Its screen and its kind, as `screens.list` serves them while it is installed.
    fn served(&self) -> (Vec<Value>, Vec<Value>) {
        if !self.installed.get() { return (Vec::new(), Vec::new()) }
        let layout = json!({ "focus": "waiting", "root": { "t": "split", "dir": "row", "weights": [0.5, 0.5], "kids": [
            { "t": "leaf", "kind": "waiting.list", "role": "waiting", "name": "waiting", "wires": [{ "verb": "select", "to": "reader" }] }, { "t": "leaf", "kind": "screens.reader", "role": "reader", "name": "reader" }] } });
        (vec![json!({ "name": "waiting", "title": "waiting on others", "from": "extension", "extension": "waiting", "spec": { "name": "waiting", "title": "waiting on others", "lands": "reader", "layout": layout }, "problems": [] })],
         vec![json!({ "kind": "waiting.list", "extension": "waiting", "name": "Outbox waiting", "about": "the outbox items still waiting for an answer", "drawer": "view", "replaces": ["waiting"], "serves": ["waiting"] })])
    }
    /// `tiles.view` for its kind: one ask waiting two days, a warning once its setting says a day is long.
    fn view(&self, kind: &str) -> Result<Value, (&'static str, String)> {
        if !self.installed.get() || !["waiting.list", "waiting"].contains(&kind) { return Err(("not-found", format!("no extension here serves a {kind} tile · the bar's Extensions lists what is installed and what can be"))) }
        let mut row = json!({ "id": "beans", "label": "  2d which shelf do the jars go on?", "group": "ada", "do": { "open": "beans" }, "act": opens("beans") });
        if self.warn.get().is_some_and(|days| days < 2) { row["tone"] = json!("warn") }
        let title = "outbox · 1 waiting on 1 person";
        Ok(json!({ "kind": "waiting.list", "extension": "waiting", "title": title, "anyChange": true,
            "view": { "type": "list", "title": title, "groups": [{ "name": "ada", "label": "Ada · 1 waiting · longest 2d", "count": 1 }], "rows": [row], "empty": "Nobody owes you an answer." } }))
    }
    /// The bar's Extensions (`lists.read from=extensions`), as the service lists them: a row a thing to do with one.
    fn rows(&self, words: &str) -> Value {
        let run = |id: &str, label: &str, group: &str, act: String| json!({ "id": id, "label": label, "group": group, "mark": "waiting", "act": act });
        let mut rows = vec![json!({ "id": "compost", "label": "Compost", "group": "installed", "mark": "compost" })];
        if self.installed.get() {
            rows.push(json!({ "id": "waiting", "label": "Waiting", "group": "installed", "mark": "waiting", "do": { "open": "shed" }, "act": opens("shed") }));
            rows.push(run("settings:waiting", "Settings of Waiting", "settings", "extensions.configure id=\"waiting\"".into()));
            if !words.is_empty() { rows.push(run("remove:waiting:keep", "Remove Waiting", "remove", "extensions.uninstall id=\"waiting\" demo=\"keep\"".into())) }
        } else {
            rows.push(run("install:waiting", "Install Waiting", "available", "extensions.install id=\"waiting\"".into()));
        }
        let rows: Vec<Value> = rows.into_iter().filter(|row| words.is_empty() || format!("{} {}", row["label"].as_str().unwrap(), row["mark"].as_str().unwrap()).to_lowercase().contains(&words.to_lowercase())).collect();
        json!({ "type": "list", "arrange": "rows", "rows": rows, "empty": "No extension matches." })
    }
}

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
fn list(ask: &Value, titled: &dyn Fn(&str) -> String, screens: &Value, shipped: bool, waiting: &Waiting) -> Result<Value, (&'static str, String)> {
    let from = ask["from"].as_str().unwrap_or("");
    let words = ask["query"].as_str().unwrap_or("");
    let note = |id: &str, label: &str, detail: &str| json!({ "id": id, "label": label, "detail": detail, "do": { "open": id }, "act": opens(id) });
    let answer = |list: Value| Ok(json!({ "from": from, "list": list, "anyChange": true }));
    match from {
        // Each source as it says of itself (the outliner's own test wrote them down): what a window reads.
        "sources" => Ok(json!({ "from": from, "list": { "type": "list", "arrange": "table", "rows": [] }, "sources": served()["sources"], "anyChange": true })),
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
        // The lists about one note (the outliner's about-producers.ts): a row's own presses are cells with the act
        // line each runs, and what it shows under itself is its `view`.
        "threads" | "proposals" | "revisions" if ask["of"].as_str().is_none() => Err(("invalid", format!("lists.read from={from} is about one note: name it with of=<a block id>"))),
        "threads" => {
            let of = ask["of"].as_str().unwrap();
            let thread = format!("thread-{of}");
            answer(json!({ "type": "list", "arrange": "rows", "title": "Comments · 1 open", "groups": [{ "name": "open", "label": "Open", "count": 1 }], "empty": "No comments on this note yet.", "rows": [{
                "id": thread, "label": "Which rain?", "detail": "you · 2031-04-01 09:00 · 1 reply · on “Before the rain.”", "group": "open",
                "cells": [{ "text": "Reply", "act": format!("reply thread=\"{thread}\"") }, { "text": "Resolve", "act": format!("resolve thread=\"{thread}\"") }],
                "view": { "type": "box", "children": [{ "type": "text", "tone": "dim", "text": "“Before the rain.”" }, { "type": "text", "strong": true, "text": "you · 2031-04-01 09:00" }, { "type": "blockdown", "text": "Which rain?" }, { "type": "text", "strong": true, "text": "compost-agent · 2031-04-01 09:05" }, { "type": "blockdown", "text": "Friday's." }] },
            }] }))
        }
        "proposals" => {
            let proposal = format!("proposal-{}", ask["of"].as_str().unwrap());
            answer(json!({ "type": "list", "arrange": "rows", "title": "Proposals · 1", "empty": "No edits are waiting beside this note.", "rows": [{
                "id": proposal, "label": "An edit from tidy-agent", "detail": "2031-04-01 09:00 · not applied: the person was typing there",
                "cells": [{ "text": "Apply", "act": format!("proposal.apply id=\"{proposal}\"") }, { "text": "Dismiss", "act": format!("proposal.dismiss id=\"{proposal}\"") }],
                "view": { "type": "diff", "from": "the note now", "to": "with the edit", "added": 1, "removed": 1, "lines": [{ "op": "skip", "text": "line 2 of 2" }, { "op": "del", "text": "Before the rain." }, { "op": "add", "text": "Before Friday's rain." }] },
            }] }))
        }
        "revisions" => {
            let open: Vec<&str> = ask["open"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            let mut earlier = json!({ "id": "2", "label": "Revision 2", "detail": "2031-03-30 18:00 by tidy-agent · 2 lines · Take the fork", "folds": true, "cells": [{ "text": "Restore", "act": format!("revision.restore of=\"{}\" revision=\"2\"", ask["of"].as_str().unwrap()) }] });
            if open.contains(&"2") {
                earlier["open"] = json!(true);
                earlier["view"] = json!({ "type": "diff", "from": "revision 2", "to": "the note now (revision 3)", "added": 1, "removed": 1, "lines": [{ "op": "same", "text": "Take the fork [type::chore]" }, { "op": "del", "text": "After the rain." }, { "op": "add", "text": "Before the rain." }] });
            }
            Ok(json!({ "from": from, "list": { "type": "list", "arrange": "rows", "title": "Revisions · 2 kept", "rows": [{ "id": "3", "label": "Revision 3 · the note now", "detail": "2031-04-01 09:00 by you · 2 lines" }, earlier] }, "open": open.iter().filter(|id| **id == "2").collect::<Vec<_>>(), "anyChange": true }))
        }
        // The asker's own actions, as the ways to press them (about-producers.ts): a row a key row of a row handed
        // over, its line written by the one writer.
        "actions" => {
            let Some(handed) = ask["actions"].as_array() else { return Err(("invalid", "lists.read from=actions lists the asker's own actions: hand them over as actions=[<each action's row>]".into())) };
            let mut rows: Vec<Value> = Vec::new();
            // The keys of the screen the asker has open come first, as its spec has them (the outliner's `actions` producer).
            let open = screens.as_array().into_iter().flatten().find(|s| ask["screen"].as_str().is_some_and(|name| s["name"] == name));
            for (n, key) in open.and_then(|s| s["spec"]["keys"].as_array()).into_iter().flatten().enumerate() {
                let mut args: Vec<String> = key["args"].as_object().into_iter().flatten().map(|(k, v)| format!("{k}=\"{}\"", v.as_str().map_or_else(|| v.to_string(), str::to_string))).collect();
                if let Some(tile) = key["tile"].as_str() { args.push(format!("tile=\"{tile}\"")) }
                let line = std::iter::once(key["action"].as_str().unwrap_or("").to_string()).chain(args).collect::<Vec<_>>().join(" ");
                rows.push(json!({ "id": format!("this screen#{n}"), "label": key["key"], "detail": key["says"], "mark": key["action"], "group": "this screen", "cells": [key["key"], line, "this screen", key["says"]], "act": line }));
            }
            for action in handed {
                let id = action["id"].as_str().unwrap_or("");
                for (n, way) in action["keys"].as_array().into_iter().flatten().enumerate() {
                    let Some(keys) = way["keys"].as_str() else { continue };
                    let args: Vec<String> = way["args"].as_object().into_iter().flatten().map(|(k, v)| format!("{k}=\"{}\"", v.as_str().map_or_else(|| v.to_string(), str::to_string))).collect();
                    let line = std::iter::once(id.to_string()).chain(args).collect::<Vec<_>>().join(" ");
                    let place = way["on"].as_str().unwrap_or("everywhere");
                    rows.push(json!({ "id": format!("{id}#{n}"), "label": keys, "detail": way["does"], "mark": id, "group": place, "cells": [keys, line, place, way["does"]], "act": line }));
                }
            }
            answer(json!({ "type": "list", "arrange": "table", "columns": ["keys", "act", "where", "does"], "headers": ["keys", "act", "where", "does"], "rows": rows, "title": "Keys" }))
        }
        "components" => {
            let open: Vec<&str> = ask["open"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            let mut stat = json!({ "id": "graph-stat", "label": "Stat tiles", "detail": "`::graph-stat` on a line of its own", "mark": "graph-stat", "group": "figures", "folds": true });
            if open.contains(&"graph-stat") {
                stat["open"] = json!(true);
                stat["view"] = json!({ "type": "box", "children": [{ "type": "blockdown", "text": "A row of numbers, each over its label." }, { "type": "box", "title": "As written", "children": [{ "type": "source", "text": "::graph-stat\nbeds: 4\n::" }] },
                    { "type": "box", "title": "As drawn", "children": [part("plot", "figure", 1, json!({ "name": "graph-stat", "figure": "stat" }), json!({ "type": "row", "children": [{ "type": "stat", "label": "beds", "value": "4" }] })),
                        // (An example may list notes: a list under a row of the list it is shown in.)
                        part("plot", "links", 5, json!({ "name": "links", "title": "The beds" }), json!({ "type": "list", "rows": [{ "id": "beans", "label": "Water the beans", "act": opens("beans") }] }))] }] });
            }
            Ok(json!({ "from": from, "list": { "type": "list", "arrange": "rows", "title": "Components · 2", "groups": [{ "name": "layout", "label": "layout", "count": 1 }, { "name": "figures", "label": "figures", "count": 1 }],
                "rows": [{ "id": "callout", "label": "Callouts", "detail": "`> [!type]` at the start of a quote", "mark": "callout", "group": "layout", "folds": true }, stat] }, "open": open.iter().filter(|id| **id == "graph-stat").collect::<Vec<_>>(), "anyChange": true }))
        }
        "extensions" => answer(waiting.rows(words)),
        "outlines" => answer(json!({ "type": "list", "arrange": "rows", "empty": "No outline by that name: this lists the ones there are and makes none.", "rows": known()["outlines"].as_array().unwrap().iter().filter(|o| words.is_empty() || o["name"].as_str().unwrap().contains(words)).map(|o| {
            let (name, machine) = (o["name"].as_str().unwrap(), o["machine"].as_str());
            json!({ "id": machine.map_or(name.to_string(), |m| format!("{m}/{name}")), "label": name, "detail": machine.map_or("on this machine".to_string(), |m| format!("on {m}")), "act": match machine { Some(m) => format!("outline.switch name=\"{name}\" machine=\"{m}\""), None => format!("outline.switch name=\"{name}\"") } })
        }).collect::<Vec<_>>() })),
        other => Err(("invalid", format!("lists.read lists children, search, query, lanes, facets, links, properties, activity, clients, screens (from=sources says what each reads), not \"{other}\""))),
    }
}

/// `completion.rows` for a text and a cursor (a UTF-16 offset), as the stand-in host answers it: a `[[` left open
/// before the cursor on its line is a token, and the garden's pages whose names hold what was typed are its rows.
fn completion(text: &str, cursor: usize) -> Value {
    let units: Vec<u16> = text.encode_utf16().collect();
    let before = String::from_utf16_lossy(&units[..cursor.min(units.len())]);
    let line = before.rsplit('\n').next().unwrap_or("");
    let Some(open) = line.rfind("[[").filter(|open| !line[*open..].contains("]]")) else { return json!({ "answers": [], "picks": {}, "token": null, "rows": [] }) };
    let query = &line[open + 2..];
    let start = cursor - line[open..].encode_utf16().count();
    let pages = [("Seed list", "seed-list", "a page"), ("Shed", "shed", "a page"), ("Sowing calendar", "sowing-calendar", "a page")];
    let rows: Vec<Value> = pages.iter().filter(|(title, _, _)| title.to_lowercase().contains(&query.to_lowercase())).enumerate().map(|(n, (title, address, detail))| json!({ "id": n.to_string(), "label": title, "detail": detail, "kind": "page", "from": "pages", "insert": format!("[[{address}]]"), "pick": format!("pick-{address}") })).collect();
    let message = if rows.is_empty() { json!("no page by that name yet") } else { Value::Null };
    json!({ "answers": [], "picks": {}, "token": { "kind": "page", "start": start, "end": cursor, "query": query }, "rows": rows, "heading": "pages", "message": message, "pickKey": "[[" })
}

pub fn garden(saves: Rc<RefCell<Result<(), (&'static str, String)>>>) -> Garden { garden_on(saves, true) }

/// The garden on a host with the screens extension installed, or (`shipped: false`) without it.
pub fn garden_on(saves: Rc<RefCell<Result<(), (&'static str, String)>>>, with_screens: bool) -> Garden { garden_with(saves, with_screens, None) }

/// The garden, in a window that keeps its arrangement (and what is being written) in `kept` between runs.
pub fn garden_kept(saves: Rc<RefCell<Result<(), (&'static str, String)>>>, kept: &std::path::Path) -> Garden { garden_with(saves, true, Some(kept)) }

/// A stand-in host for one outline: the link to it, and what a test reads and says on it.
struct Host { link: Standin, asked: Asked, said: Said, screens: Rc<RefCell<Value>>, shipped: Rc<std::cell::Cell<bool>> }

fn host(saves: Rc<RefCell<Result<(), (&'static str, String)>>>, with_screens: bool, outline: &'static str) -> Host {
    let (asked, said): (Asked, Said) = Default::default();
    let texts: Rc<RefCell<std::collections::HashMap<String, (u64, String)>>> = Default::default();
    let screens: Rc<RefCell<Value>> = Rc::new(RefCell::new(json!([])));
    let listed = screens.clone();
    let shipped = Rc::new(std::cell::Cell::new(with_screens));
    let installed = shipped.clone();
    let waiting = Waiting { installed: Rc::new(std::cell::Cell::new(false)), warn: Rc::new(std::cell::Cell::new(None)) };
    let answers: Answers = Box::new(move |ask| {
        let note = ask["blockId"].as_str().unwrap_or("").to_string();
        let titled = |id: &str| match id { "plot" => "Plot", "onions" => "Lift the onions", "beans" => "Water the beans", "shed" => "Shed", "new" => "", _ => "Take the fork" }.to_string();
        match ask["action"].as_str().unwrap_or("") {
            "ping" => Ok(json!({ "status": "ready", "protocolVersion": PROTOCOL, "location": { "machine": "box" }, "outline": { "name": outline } })),
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
            // screens: none, until a test's host says otherwise (`screens_are`); then what the made-up extension
            // serves while it is installed.
            "screens.list" => {
                let (theirs, kinds) = waiting.served();
                let mut screens = if shipped.get() { served()["screens"].as_array().cloned().unwrap_or_default() } else { Vec::new() };
                screens.extend(listed.borrow().as_array().cloned().unwrap_or_default());
                screens.extend(theirs);
                let mut all = if shipped.get() { served()["kinds"].as_array().cloned().unwrap_or_default() } else { Vec::new() };
                all.extend(kinds);
                Ok(json!({ "screens": screens, "kinds": all, "problems": [], "anyChange": true }))
            }
            "lists.read" => list(ask, &titled, &listed.borrow(), shipped.get(), &waiting),
            // The extensions, as the service lists, installs, removes and configures them: its own words on each.
            "extensions.list" => Ok(waiting.listed()),
            "extensions.install" => match ask["extension"].as_str() {
                Some("waiting") => { waiting.installed.set(true); Ok(json!({ "id": "waiting", "page": "shed", "lines": ["copied it into this outline's extensions", "wrote its page and 2 demo notes under Extensions"] })) }
                other => Err(("not-found", format!("no extension {} in the repo", other.unwrap_or("")))),
            },
            "extensions.uninstall" => { waiting.installed.set(false); Ok(json!({ "id": "waiting", "removed": true, "settingsKept": true, "demo": { "trashed": 0, "kept": [], "left": 2 }, "lines": ["removed its folder", "kept its 2 demo notes under its page", "kept its settings for a reinstall"] })) }
            "extensions.configure" => {
                // Checked against its schema, as the service does: a whole number of days, one at least.
                if let Some(days) = ask["set"].get("warn-days") { match days.as_i64().filter(|days| *days >= 1) { Some(days) => waiting.warn.set(Some(days)), None => return Err(("invalid", "config.json: config doesn't match the config schema in extension.json (warn-days must be >= 1)".into())) } }
                if ask["unset"].as_array().is_some_and(|names| names.iter().any(|name| name == "warn-days")) { waiting.warn.set(None) }
                Ok(json!({ "id": "waiting", "settings": waiting.settings() }))
            }
            "extensions.act" => Ok(json!({ "extension": ask["extension"], "action": ask["extensionAction"], "message": "turned the heap" })),
            "tiles.view" => waiting.view(ask["kind"].as_str().unwrap_or("")),
            "outlines.known" => Ok(known()),
            "events.subscribe" => Ok(json!({ "subscribed": true })),
            // The service runs a button's steps and says how the run went; what it answers a script's act with is its own.
            "scripts.sequence" => match ask["line"].as_u64() { Some(13) => Ok(json!({ "extension": "button", "action": "run", "undo": "run-1", "state": "running", "written": [] })), _ => Err(("invalid", "No button on that line; read the note and press its current button".into())) },
            "scripts.answer" => Ok(json!({ "accepted": true })),
            // A draft is held while it is written, renewed, and let go; what the service asks of it is a line a test says.
            "drafts.hold" => Ok(json!({ "holdId": format!("hold-{note}"), "blockId": note, "clientId": ask["clientId"], "revision": ask["revision"], "leaseMs": ask["leaseMs"] })),
            "drafts.heartbeat" | "drafts.touch" => Ok(json!({ "holdId": ask["holdId"] })),
            "drafts.release" => Ok(json!({ "released": true })),
            "drafts.answer" => Ok(json!({ "accepted": true })),
            "draft.patch" => Ok(json!({ "outcome": "applied", "edits": [{ "blockId": note, "route": "saved", "revision": ask["revision"].as_u64().map_or(1, |r| r + 1) }] })),
            // What completes the words at the cursor, as the service answers a text and a cursor: here, the garden's
            // two pages for a `[[` left open, and no token anywhere else.
            "completion.rows" => Ok(completion(ask["text"].as_str().unwrap_or(""), ask["cursor"].as_u64().unwrap_or(0) as usize)),
            "completion.picked" => Ok(json!({})),
            // What is written about a note: a comment and a reply (the host says who wrote each), a thread's
            // lifecycle, a proposal applied or dismissed, and a revision's text.
            "annotations.batch" => match ask["operations"][0]["input"]["passage"]["quote"].as_str() {
                Some("words nobody wrote") => Err(("not-found", "Comment quote or context was not found; read the current source and select it again (nearest: Before the rain.)".into())),
                _ => Ok(json!({ "annotations": [{ "block": { "id": "thread-new" }, "body": ask["operations"][0]["input"]["body"] }], "deduplicated": false })),
            },
            "annotations.reply" => Ok(json!({ "annotations": [{ "block": { "id": "reply-new" }, "body": ask["input"]["body"] }], "deduplicated": false })),
            "annotations.lifecycle" => Ok(json!({ "block": { "id": ask["input"]["annotationId"] }, "lifecycle": ask["input"]["lifecycle"] })),
            "draft.proposal.apply" => match ask["proposalId"].as_str() {
                Some("proposal-gone") => Err(("invalid", "This proposal's passage is no longer in the note; it isn't applied".into())),
                _ => Ok(json!({ "outcome": "applied", "edits": [{ "blockId": "plot", "route": "saved", "revision": 4 }] })),
            },
            "draft.proposal.dismiss" => Ok(json!({ "dismissed": true, "proposalId": ask["proposalId"] })),
            "block.revisions" => match ask["revision"].as_u64() {
                Some(2) => Ok(json!({ "revision": 2, "savedAt": "2031-03-30T18:00:00.000Z", "author": "agent", "actorId": "tidy-agent", "chars": 30, "lines": 2, "firstLine": "Take the fork", "text": format!("{} [type::chore]\nAfter the rain.", titled(&note)) })),
                Some(other) => Err(("failed", format!("Revision {other} of {note} isn't kept (the note is at revision 3; ep0ch revisions lists the ones kept)"))),
                None => Ok(json!({ "blockId": note, "revision": 3, "revisions": [] })),
            },
            action => Err(("failed", format!("no action {action}"))),
        }
    });
    Host { link: Standin { answers, asked: asked.clone(), said: said.clone() }, asked, said, screens, shipped: installed }
}

fn garden_with(saves: Rc<RefCell<Result<(), (&'static str, String)>>>, with_screens: bool, kept: Option<&std::path::Path>) -> Garden {
    let Host { link, asked, said, screens, shipped } = host(saves, with_screens, "garden");
    let elsewhere: Elsewhere = Default::default();
    let (links, beside) = (elsewhere.clone(), kept.map(std::path::Path::to_path_buf));
    // The way to any other outline is another stand-in host, as the rule would find one: the same made-up notes
    // under another name, on a link of its own. One on a machine nobody reaches says so.
    let ways: crate::actions::Ways = Rc::new(move |at: &crate::store::OutlineAt| {
        if !at.machine.is_empty() { return Err(format!("can't reach the outline host on {}: no route to it from here", at.machine)) }
        let name: &'static str = Box::leak(at.outline.clone().into_boxed_str());
        let there = host(ok(), true, name);
        links.borrow_mut().insert(at.outline.clone(), (there.asked.clone(), there.said.clone()));
        Ok(crate::client::Way { link: Box::new(there.link), kept: beside.as_ref().map(|path| path.with_file_name(format!("native-{}.layout.json", at.outline))) })
    });
    let mut app = App::new(Box::new(link), "garden").reaching(ways);
    if let Some(kept) = kept { app = app.arranged_in(kept.to_path_buf()) }
    app.start();
    app.settle();
    Garden { app, asked, said, screens, shipped, elsewhere }
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

/// The block being written (the first there is), as its session.
pub fn draft(app: &App) -> Option<&crate::draft::DraftSession> { app.drafts.first() }
/// What is typed in it.
pub fn words(app: &App) -> &str { draft(app).map_or("", |draft| draft.buf.words()) }
/// Some block being written holds text the service doesn't.
pub fn unsaved(app: &App) -> bool { app.drafts.iter().any(|draft| draft.unsaved()) }
/// Everything in the block being written replaced, as a paste over all of it would: through the field, as the kit's editor does.
pub fn write(app: &mut App, text: &str) {
    let field = crate::actions::Field::Draft(draft(app).expect("a block is being written").tile.clone());
    app.field(&field).replace(text);
    app.typed(&field);
}

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
    rt.poll = Some(|s, _, tx| { let landed = s.take(); crate::keys::effects(s, tx) | crate::keys::follow(s, tx) | landed });
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
