//! The window over a stand-in link that answers by wire action, as the host would: what it asks, what it does with
//! the answers, and that a press reaches the model. `live` runs the same window against a real scratch host.
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::time::Duration;

use rune::{Env, Runtime};
use serde_json::{Value, json};

use crate::client::{Link, PROTOCOL};
use crate::model::{App, Finder, Notice};
use crate::view::view;

type Asked = Rc<RefCell<Vec<Value>>>;
type Said = Rc<RefCell<VecDeque<Value>>>;
type Answers = Box<dyn FnMut(&Value) -> Result<Value, (&'static str, String)>>;

/// Answers each request where it stands; `said` is the line a test adds as the host would between answers.
struct Standin { answers: Answers, asked: Asked, said: Said }

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

fn page(id: &str, title: &str, revision: u64, text: &str) -> Value {
    let ancestors = match id { "onions" | "beans" => json!([{ "id": "plot", "title": "Plot", "hasChildren": true }]), "fork" => json!([{ "id": "plot", "title": "Plot", "hasChildren": true }, { "id": "onions", "title": "Lift the onions", "hasChildren": true }]), _ => json!([]) };
    json!({
        "blockId": id, "revision": revision, "title": title, "text": text,
        "chips": [{ "key": "type", "value": "chore" }], "properties": [{ "key": "type", "value": "chore" }, { "key": "room", "value": "north" }],
        "updated": "2026-03-01T09:30:00.000Z", "author": "user", "ancestors": ancestors,
        "parts": [
            { "kind": "prose", "markdown": "Before the rain. See [the shed](ep0ch:b/shed) and [seeds](ep0ch:p/Seed%20list)." },
            { "kind": "rows", "name": "links", "title": "On the plot", "source": "::links{query=\"type=chore\"}\n::", "query": "type=chore", "status": "live · 1 match",
              "groups": [{ "name": "Matches", "rows": [{ "text": "Water the beans", "id": "beans" }] }] },
            { "kind": "figure", "name": "graph-stat", "figure": "stat", "title": "Chores", "source": "::graph-stat\n::", "status": "live",
              "props": { "items": [{ "label": "to do", "value": "2" }, { "label": "done", "value": "5", "accent": true }] } },
            { "kind": "view", "name": "view", "title": "Every chore", "source": "::view\n::", "view": { "type": "list", "headers": ["state"],
              "rows": [{ "id": "fork", "label": "Take the fork", "cells": ["todo", { "text": "plot" }] }] } },
            { "kind": "component", "name": "button", "source": "::button{label=\"Sweep\"}" },
        ],
        "children": [{ "id": "fork", "title": "Take the fork" }],
        "backlinks": [{ "id": "plan", "title": "Plan for Saturday", "context": "Plot" }],
    })
}

/// A made-up outline: Plot › (Lift the onions › Take the fork, Water the beans), Shed. `saves`: how `update` answers.
struct Garden { app: App, asked: Asked, said: Said }

fn garden(saves: Rc<RefCell<Result<(), (&'static str, String)>>>) -> Garden {
    let (asked, said): (Asked, Said) = Default::default();
    let texts: Rc<RefCell<std::collections::HashMap<String, (u64, String)>>> = Default::default();
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
            "tree.search" => Ok(json!({ "matches": [{ "block": { "id": "beans", "revision": 1 }, "title": format!("found for {}", ask["query"].as_str().unwrap()), "path": "Plot" }] })),
            "blocks.query" => match ask["query"]["where"].as_str().unwrap() {
                "type!=chore" => Err(("invalid", "There is no != ; put NOT before the clause.".into())),
                _ => Ok(json!({ "generation": 0, "blocks": [{ "id": "beans", "title": "Water the beans", "updatedAt": "2026-03-01T09:30:00.000Z" }], "facets": [{ "key": "area", "count": 2, "values": [{ "value": "plot", "count": 2, "last": "" }] }] })),
            },
            action => Err(("failed", format!("no action {action}"))),
        }
    });
    let mut app = App::new(Box::new(Standin { answers, asked: asked.clone(), said: said.clone() }), "garden");
    app.start();
    app.settle();
    Garden { app, asked, said }
}

fn ok() -> Rc<RefCell<Result<(), (&'static str, String)>>> { Rc::new(RefCell::new(Ok(()))) }
fn listed(app: &App) -> Vec<(usize, &str)> { app.tree.iter().map(|line| (line.depth, line.row.title.as_str())).collect() }
fn last(asked: &Asked) -> Value { asked.borrow().last().unwrap().clone() }
fn actions(asked: &Asked) -> Vec<String> { asked.borrow().iter().map(|a| a["action"].as_str().unwrap().to_string()).collect() }

#[test]
fn the_window_opens_on_the_first_note_and_asks_for_no_more_than_it_shows() {
    let Garden { app, asked, .. } = garden(ok());
    assert_eq!(actions(&asked), ["ping", "blocks.read", "notes.page"]);
    assert_eq!((app.outline.as_str(), app.machine.as_str()), ("garden", "box"));
    assert_eq!(app.page.get().unwrap().title, "Plot");
    assert_eq!(listed(&app), [(0, "Plot"), (0, "Shed")], "only the top level was asked for");
    // Every read names the outline and is watched under a key of its own.
    let reads = asked.borrow();
    assert_eq!((reads[1]["outline"].as_str(), reads[1]["watch"].as_str(), reads[1]["under"].is_null()), (Some("garden"), Some("tree:"), true));
    assert_eq!((reads[2]["watch"].as_str(), reads[2]["blockId"].as_str()), (Some("page"), Some("plot")));
}

#[test]
fn a_host_on_another_protocol_is_refused_naming_the_side_to_update() {
    let (asked, said): (Asked, Said) = Default::default();
    let answers: Answers = Box::new(|_| Ok(json!({ "protocolVersion": PROTOCOL - 1 })));
    let mut app = App::new(Box::new(Standin { answers, asked, said }), "garden");
    app.start();
    app.take();
    assert!(!app.online);
    assert!(matches!(&app.notice, Some(Notice::Problem(why)) if why.contains("the outline host is older") && why.contains("ep0ch install --apply")));
}

#[test]
fn opening_a_note_unfolds_the_way_to_it_from_the_page_s_ancestors() {
    let Garden { mut app, asked, said } = garden(ok());
    app.open("fork");
    app.settle();
    assert_eq!(listed(&app), [(0, "Plot"), (1, "Lift the onions"), (2, "Take the fork"), (1, "Water the beans"), (0, "Shed")]);
    let levels: Vec<String> = asked.borrow().iter().filter(|a| a["action"] == "blocks.read").map(|a| a["watch"].as_str().unwrap().to_string()).collect();
    assert_eq!(levels.len(), 3, "the top level and the two folders above the note, each asked once: {levels:?}");
    // Folding by hand holds: a later answer for the same note doesn't unfold it again.
    app.toggle("plot");
    assert_eq!(listed(&app), [(0, "Plot"), (0, "Shed")]);
    changed(&mut app, &said, "page", 1);
    assert_eq!(listed(&app), [(0, "Plot"), (0, "Shed")]);
    app.go_back();
    app.settle();
    assert_eq!(app.page.wanted().map(String::as_str), Some("plot"));
    assert!(app.back.is_empty(), "going back isn't itself a place to go back from");
}

/// The host says a line between answers, and what follows lands.
fn host_says(app: &mut App, said: &Said, line: Value) {
    said.borrow_mut().push_back(line);
    app.settle();
}

/// The host says a watched answer moved.
fn changed(app: &mut App, said: &Said, key: &str, generation: u64) {
    host_says(app, said, json!({ "event": { "domain": "queries", "action": "queries.changed", "changes": [{ "key": key, "generation": generation }] } }));
}

#[test]
fn an_answer_only_lands_in_the_slot_that_wants_it() {
    let Garden { mut app, said, .. } = garden(ok());
    // Two notes opened before either answers: the first one's page has nowhere to land.
    let held: Vec<Value> = { app.open("onions"); app.open("shed"); said.borrow_mut().drain(..).collect() };
    for line in held.into_iter().rev() { said.borrow_mut().push_back(line) }
    app.settle();
    assert_eq!(app.page.get().unwrap().id, "shed");
    // The same for the finder: words typed on before the first answer came.
    app.find(Finder::Find, "on");
    app.finder_edit.replace_text("onions");
    app.find_changed();
    app.settle();
    assert_eq!(app.found.get().unwrap().rows[0].title, "found for onions");
}

#[test]
fn a_watched_answer_that_moved_is_read_by_its_generation_and_nothing_else_is_asked() {
    let Garden { mut app, asked, said } = garden(ok());
    let before = asked.borrow().len();
    changed(&mut app, &said, "page", 4);
    assert_eq!(asked.borrow().len(), before + 1);
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["watch"].as_str(), last(&asked)["generation"].as_u64()), (Some("notes.page"), Some("page"), Some(4)));
    changed(&mut app, &said, "tree:", 2);
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["generation"].as_u64(), last(&asked)["under"].is_null()), (Some("blocks.read"), Some(2), true));
    // A folder folded since: its level isn't shown, so its change is nothing to read.
    let quiet = asked.borrow().len();
    changed(&mut app, &said, "tree:onions", 1);
    assert_eq!(asked.borrow().len(), quiet);
    // One the host dropped past its bounds is registered again, not read by a generation it no longer keeps.
    host_says(&mut app, &said, json!({ "event": { "action": "queries.changed", "changes": [{ "key": "page", "generation": 4, "dropped": true }] } }));
    assert_eq!((last(&asked)["watch"].as_str(), last(&asked).get("generation")), (Some("page"), None));
}

#[test]
fn saving_names_the_revision_read_and_never_ends_editing() {
    let Garden { mut app, asked, .. } = garden(ok());
    app.open("onions");
    app.settle();
    app.edit();
    assert!(!app.unsaved());
    app.editor.replace_text("Lift the onions [type::chore]\nTake the fork.");
    app.save();
    let sent = last(&asked);
    assert_eq!((sent["action"].as_str(), sent["expectedRevision"].as_u64(), sent["text"].as_str(), sent["mutation"]["actorId"].as_str()),
        (Some("update"), Some(3), Some("Lift the onions [type::chore]\nTake the fork."), Some("ep0ch-native:box")));
    assert!(app.saving());
    // Typed on while the save is out, and after it lands: the editor is still there for every key.
    app.editor.replace_text("Lift the onions [type::chore]\nTake the fork. And the trug.");
    app.settle();
    let editing = app.editing.as_ref().expect("a save doesn't close the editor");
    assert_eq!((editing.revision, app.unsaved(), app.saving()), (4, true, false));
    // After its own write the page is read now, unwatched: the kept answer is the one from before the write.
    let read = asked.borrow().iter().rev().find(|a| a["action"] == "notes.page").cloned().unwrap();
    assert_eq!((read.get("watch"), app.page.get().unwrap().revision), (None, 4));
    // The next save names the new revision.
    app.save();
    assert_eq!(last(&asked)["expectedRevision"].as_u64(), Some(4));
    app.settle();
    assert!(!app.unsaved());
    app.done_editing();
    assert!(app.editing.is_none());
}

#[test]
fn nothing_drops_unsaved_text_but_discard() {
    let saves = ok();
    let Garden { mut app, .. } = garden(saves.clone());
    app.open("onions");
    app.settle();
    app.edit();
    app.editor.replace_text("Mine, typed for a while");
    // The service refuses the save: the text stays, and the notice says what to do.
    *saves.borrow_mut() = Err(("stale-revision", "Block changed since editing began: onions".into()));
    app.save();
    app.settle();
    assert!(matches!(&app.notice, Some(Notice::Problem(said)) if said.contains("changed since you opened it")));
    assert_eq!((app.editor.text.as_str(), app.saving()), ("Mine, typed for a while", false));
    // Leaving doesn't drop it, and neither does opening another note.
    app.done_editing();
    assert!(app.editing.is_some() && matches!(&app.notice, Some(Notice::Problem(said)) if said.contains("Unsaved text")));
    app.open("shed");
    assert_eq!(app.page.wanted().map(String::as_str), Some("onions"));
    assert_eq!(app.editor.text, "Mine, typed for a while");
    // Only Discard, asked for by name.
    app.discard();
    assert!(app.editing.is_none());
}

#[test]
fn a_new_note_opens_to_be_written_at_the_revision_the_service_made_it_at() {
    let Garden { mut app, asked, .. } = garden(ok());
    app.new_child();
    let made = last(&asked);
    assert_eq!((made["action"].as_str(), made["parentId"].as_str(), made["author"].as_str(), made.get("mutation")), (Some("create"), Some("plot"), Some("user"), None));
    app.settle();
    let editing = app.editing.as_ref().unwrap();
    assert_eq!((editing.note.as_str(), editing.revision), ("new", 7));
    assert_eq!(app.page.wanted().map(String::as_str), Some("new"));
    // The folder it went into is read again now.
    assert!(asked.borrow().iter().any(|a| a["action"] == "blocks.read" && a["under"] == "plot" && a.get("watch").is_none()));
}

#[test]
fn a_binned_note_s_notice_knows_what_to_bring_back() {
    let Garden { mut app, asked, .. } = garden(ok());
    app.open("onions");
    app.settle();
    app.trash();
    app.settle();
    assert_eq!(app.notice, Some(Notice::Trashed("onions".into())));
    assert_eq!(app.page.wanted().map(String::as_str), Some("plot"), "the window moves to the note above");
    app.restore();
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["blockId"].as_str()), (Some("trash.restore"), Some("onions")));
    app.settle();
    assert_eq!(app.page.wanted().map(String::as_str), Some("onions"));
}

#[test]
fn a_query_is_a_watched_read_its_facets_narrow_it_and_a_refusal_is_the_service_s_words() {
    let Garden { mut app, asked, .. } = garden(ok());
    app.find(Finder::Query, "type=chore");
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["watch"].as_str(), last(&asked)["query"]["where"].as_str()), (Some("blocks.query"), Some("found"), Some("type=chore")));
    app.settle();
    let found = app.found.get().unwrap();
    assert_eq!((found.rows[0].title.as_str(), found.rows[0].context.as_str(), found.facets[0].key.as_str()), ("Water the beans", "2026-03-01", "area"));
    app.narrow("area", "plot");
    assert_eq!(last(&asked)["query"]["where"], "type=chore area=plot");
    app.narrow("area", "plot");
    assert_eq!(app.finder_edit.text, "type=chore area=plot", "picked twice is still once");
    app.finder_edit.replace_text("type!=chore");
    app.find_changed();
    app.settle();
    assert_eq!(app.found.get().unwrap().hint, "There is no != ; put NOT before the clause.");
    assert!(app.notice.is_none(), "said where the rows would be, not as a window-wide problem");
}

#[test]
fn a_link_in_prose_opens_its_note_and_a_page_nobody_made_says_so() {
    let Garden { mut app, .. } = garden(ok());
    app.follow("ep0ch:b/shed");
    app.settle();
    assert_eq!(app.page.get().unwrap().id, "shed");
    app.follow("ep0ch:p/Seed%20list");
    assert!(matches!(&app.notice, Some(Notice::Info(said)) if said.contains("No note has that page address yet")));
    assert_eq!(app.page.wanted().map(String::as_str), Some("shed"));
}

#[test]
fn a_lost_link_is_made_again_and_everything_wanted_is_asked_for_afresh() {
    let Garden { mut app, said, .. } = garden(ok());
    app.open("fork");
    app.settle();
    host_says(&mut app, &said, crate::client::lost("the outline host closed the connection"));
    assert!(!app.online && matches!(&app.notice, Some(Notice::Problem(why)) if why.contains("the outline host closed the connection")));
    // The link made again is another garden's: what it is asked is everything this window wants, from nothing.
    let Garden { asked, said, .. } = garden(ok());
    asked.borrow_mut().clear();
    let fresh = RefCell::new(Some((asked.clone(), said)));
    let mut app = app.reconnecting(Box::new(move || {
        let (asked, said) = fresh.borrow_mut().take().expect("made once");
        Box::new(Standin { answers: Box::new(|ask| if ask["action"] == "ping" { Ok(json!({ "protocolVersion": PROTOCOL, "location": { "machine": "box" } })) } else { Err(("unavailable", "still starting".into())) }), asked, said })
    }));
    assert!(app.reconnect());
    assert!(app.online && app.notice == Some(Notice::Info("Back online.".into())));
    let again = actions(&asked);
    assert_eq!(again[0], "ping");
    assert_eq!(again.iter().filter(|a| *a == "blocks.read").count(), 3, "the top level and both unfolded folders: {again:?}");
    assert!(again.contains(&"notes.page".to_string()));
}

// ── the window itself ─────────────────────────────────────────────────────────────────────────────────────────

fn window(app: App) -> Runtime<App> {
    let mut rt = Runtime::new(app, view, (1180.0, 760.0), Env { system_dark: false, scale: 1.0 });
    // As the app runs it: answers land in `poll`, before each frame.
    rt.poll = Some(|s, _, _| s.take());
    rt.frame(0.0);
    rt
}

/// A press, then frames until what left has finished leaving.
fn press(rt: &mut Runtime<App>, key: &str) {
    let (x, y) = rt.find(key).unwrap_or_else(|| panic!("nothing on screen is keyed {key}"));
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    for _ in 0..90 { rt.frame(1.0 / 60.0); }
}

#[test]
fn the_note_draws_every_part_and_a_row_in_a_component_opens_its_note() {
    let mut rt = window(garden(ok()).app);
    for key in ["tree/plot", "tree/shed", "note-title", "part/0", "part/1", "part/2", "part/3", "part/3/fork", "part/4", "child/fork", "backlink/plan", "edit"] {
        assert!(rt.find(key).is_some(), "{key} is on screen");
    }
    assert!(rt.find("tree/onions").is_none(), "a folded folder's notes aren't asked for or built");
    press(&mut rt, "part/1/beans");
    assert_eq!(rt.state.page.get().unwrap().title, "Water the beans");
    assert!(rt.find("tree/beans").is_some() && rt.find("path").is_some(), "the tree unfolded to it, and its path is drawn");
}

#[test]
fn the_editor_s_buttons_say_what_leaving_would_do() {
    let mut rt = window(garden(ok()).app);
    press(&mut rt, "edit");
    assert_eq!(rt.state.editor.text, "Plot [type::chore]\nBefore the rain.");
    assert!(rt.find("source").is_some() && rt.find("done").is_some() && rt.find("discard").is_none() && rt.find("note-title").is_none());
    rt.update(|s, _| s.editor.replace_text("Plot, changed"));
    for _ in 0..30 { rt.frame(1.0 / 60.0); }
    assert!(rt.find("discard").is_some() && rt.find("done").is_none(), "with unsaved text the way out is Discard, by name");
    press(&mut rt, "save");
    assert!(rt.state.editing.is_some() && !rt.state.unsaved());
    press(&mut rt, "done");
    assert!(rt.state.editing.is_none() && rt.find("note-title").is_some());
}

#[test]
fn a_chip_is_a_query_for_every_note_that_carries_it_and_binning_offers_undo() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    press(&mut rt, "chip/type/chore");
    assert_eq!(last(&asked)["query"]["where"], "type=chore");
    assert!(rt.find("palette-field").is_some() && rt.find("facet/area/plot").is_some());
    press(&mut rt, "found/0");
    rt.update(|s, _| s.trash());
    for _ in 0..90 { rt.frame(1.0 / 60.0); }
    assert!(rt.find("undo-trash").is_some());
    press(&mut rt, "undo-trash");
    assert_eq!(rt.state.page.wanted().map(String::as_str), Some("beans"));
}

// ── against a real host ───────────────────────────────────────────────────────────────────────────────────────

/// The window against a scratch outline host this test starts (`bun src/host-main.ts` in a temp folder): the socket,
/// the handshake, `notes.page`, a save, and a change made by someone else arriving as a watched answer.
/// `cargo test -- --ignored live` (it needs bun and the checkout around this crate).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_the_window_reads_writes_and_hears_changes_over_the_socket() {
    use crate::client::Socket;
    use std::process::{Command, Stdio};
    let root = std::env::temp_dir().join(format!("ep0ch-native-live-{}", std::process::id()));
    let outlines = root.join("o");
    std::fs::create_dir_all(&outlines).unwrap();
    let outliner = concat!(env!("CARGO_MANIFEST_DIR"), "/../outliner");
    let mut host = Command::new("bun").arg("src/host-main.ts").current_dir(outliner)
        .env("EP0CH_OUTLINES", &outlines).env("EP0CH_DEFAULT_WS", "scratch").env("XDG_CONFIG_HOME", root.join("config"))
        .env_remove("EP0CH_SOCKET").env_remove("EP0CH_WS").stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("bun starts the host");
    let socket = outlines.join(".host/host.sock");
    let path = socket.to_str().unwrap().to_string();
    let result = std::panic::catch_unwind(|| {
        for _ in 0..200 { if socket.exists() { break } std::thread::sleep(Duration::from_millis(50)) }
        let asking = |raw: &mut Socket, request: Value| -> Value {
            raw.send(&request);
            raw.wait(request["id"].as_str().unwrap(), Duration::from_secs(20));
            let line = raw.take().into_iter().find(|l| l["id"] == request["id"]).expect("the host answers");
            assert_eq!(line["ok"], true, "{line}");
            line["result"].clone()
        };
        // The host makes the outline (a connection of its own: a connection belongs to the outline its first line names).
        asking(&mut Socket::connect(&path), json!({ "id": "a", "action": "outlines.attach", "name": "scratch", "create": true }));
        // Another client's connection: it writes the notes, and later edits one.
        let mut raw = Socket::connect(&path);
        let mut ask = |request: Value| asking(&mut raw, request);
        let shed = ask(json!({ "id": "b", "action": "create", "outline": "scratch", "parentId": null, "text": "Shed [type::place]\nWhere the tools live.", "author": "user" }));
        let chore = ask(json!({ "id": "c", "action": "create", "outline": "scratch", "parentId": shed["id"], "text": "Lift the onions [type::chore] [state::todo]", "author": "user" }));
        let plan = ask(json!({ "id": "d", "action": "create", "outline": "scratch", "parentId": null, "author": "user",
            "text": format!("Plan [type::plan]\nStart at the (({})).\n\n::links{{query=\"type=chore state=todo\" title=\"To do\"}}\n::", shed["id"].as_str().unwrap()) }));

        let mut app = App::new(Box::new(Socket::connect(&path)), "scratch");
        app.blocking = true;
        app.start();
        app.settle();
        assert!(app.online && !app.machine.is_empty(), "{:?}", app.notice);
        app.open(plan["id"].as_str().unwrap());
        app.settle();
        let page = app.page.get().expect("the page came");
        assert_eq!(page.title, "Plan");
        let todo = |app: &App| -> Vec<String> { app.page.get().unwrap().parts.iter().flat_map(|part| match part { crate::page::Part::Rows { groups, .. } => groups.iter().flat_map(|g| g.rows.iter().map(|r| r.text.clone())).collect(), _ => Vec::new() }).collect() };
        assert_eq!(todo(&app), ["Lift the onions"]);
        assert!(matches!(&page.parts[0], crate::page::Part::Prose { markdown } if markdown.contains(&format!("[Shed](ep0ch:b/{})", shed["id"].as_str().unwrap()))));

        // This window writes: saved at the revision it read, and the page it shows is the saved one.
        app.edit();
        let text = format!("{}\n\nBring the trug.", app.editor.text);
        app.editor.replace_text(text);
        app.save();
        app.settle();
        assert!(!app.unsaved() && matches!(&app.notice, Some(Notice::Info(said)) if said.starts_with("Saved")), "{:?}", app.notice);
        assert!(app.page.get().unwrap().text.ends_with("Bring the trug."));
        app.done_editing();

        // Someone else finishes the chore: no edit to the open note, yet its page is told and read again.
        ask(json!({ "id": "e", "action": "update", "outline": "scratch", "blockId": chore["id"], "text": "Lift the onions [type::chore] [state::done]", "expectedRevision": chore["revision"], "mutation": { "author": "user" } }));
        app.blocking = false;
        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(50));
            app.take();
            if todo(&app).is_empty() { break }
        }
        assert!(todo(&app).is_empty(), "the watched page moved without this window asking why");
    });
    let _ = host.kill();
    let _ = host.wait();
    let _ = std::fs::remove_dir_all(&root);
    if let Err(panic) = result { std::panic::resume_unwind(panic) }
}
