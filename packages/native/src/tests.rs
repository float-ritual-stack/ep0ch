//! The window against a stand-in bridge: what it asks, what it does with the answers, and that a press reaches
//! the model. The bridge itself is tested against a scratch host in `test/bridge.test.ts`.
use std::cell::RefCell;
use std::rc::Rc;

use rune::{Env, Runtime};
use serde_json::{Value, json};

use crate::bridge::Bridge;
use crate::model::{App, Finder, Tone};
use crate::view::view;

type Asked = Rc<RefCell<Vec<Value>>>;

fn page(id: &str, title: &str, revision: u64) -> Value {
    json!({
        "id": id, "revision": revision, "title": title, "path": "Plot", "text": format!("{title} [type::chore]\nBefore the rain."),
        "chips": [{ "key": "type", "value": "chore" }], "properties": [{ "key": "type", "value": "chore" }],
        "updated": "2026-03-01T09:30:00.000Z", "author": "user",
        "parts": [
            { "kind": "prose", "markdown": "Before the rain. See [the shed](ep0ch:b/shed)." },
            { "kind": "component", "name": "links", "title": "On the plot", "source": "::links{query=\"type=chore\"}\n::", "query": "type=chore",
              "rows": [{ "id": "beans", "title": "Water the beans", "props": { "type": "chore" } }] },
        ],
        "children": [{ "id": "fork", "title": "Take the fork" }],
        "backlinks": [{ "id": "plan", "title": "Plan for Saturday", "context": "Plot" }],
    })
}

/// A made-up outline: Plot › (Lift the onions › Take the fork, Water the beans), Shed. `save` answers as `saves` says.
fn outline(saves: Rc<RefCell<Result<(), (String, String)>>>) -> (App, Asked) {
    let asked: Asked = Rc::default();
    let log = asked.clone();
    let bridge = Bridge::fake(Box::new(move |ask| {
        log.borrow_mut().push(ask.clone());
        let note = ask["note"].as_str().unwrap_or("");
        match ask["op"].as_str().unwrap_or("") {
            "hello" => Ok(json!({ "outline": "garden", "machine": "box", "outlines": ["garden"] })),
            "tree" => Ok(json!({ "rows": [
                { "id": "plot", "parent": null, "depth": 0, "title": "Plot", "hasChildren": true },
                { "id": "onions", "parent": "plot", "depth": 1, "title": "Lift the onions", "hasChildren": true },
                { "id": "fork", "parent": "onions", "depth": 2, "title": "Take the fork", "hasChildren": false },
                { "id": "beans", "parent": "plot", "depth": 1, "title": "Water the beans", "hasChildren": false },
                { "id": "shed", "parent": null, "depth": 0, "title": "Shed", "hasChildren": false },
            ] })),
            "page" => Ok(page(note, match note { "plot" => "Plot", "onions" => "Lift the onions", "beans" => "Water the beans", "shed" => "Shed", _ => "Take the fork" }, 3)),
            "save" => saves.borrow().clone().map(|()| page(note, "Lift the onions", ask["revision"].as_u64().unwrap() + 1)),
            "follow" => Ok(json!({ "id": ask["href"].as_str().unwrap().trim_start_matches("ep0ch:b/") })),
            "search" => Ok(json!({ "rows": [{ "id": "beans", "title": format!("found for {}", ask["query"].as_str().unwrap()) }] })),
            "query" => Ok(json!({ "rows": [{ "id": "beans", "title": "Water the beans" }], "hint": "", "facets": [{ "key": "area", "count": 2, "values": [{ "value": "plot", "count": 2 }] }] })),
            op => Err(("failed".into(), format!("no op {op}"))),
        }
    }));
    let mut app = App::new(bridge);
    app.start();
    app.take();
    app.take();
    (app, asked)
}

fn ok() -> Rc<RefCell<Result<(), (String, String)>>> { Rc::new(RefCell::new(Ok(()))) }

fn listed(app: &App) -> Vec<&str> { app.visible.iter().map(|&i| app.tree[i].title.as_str()).collect() }

fn ops(asked: &Asked) -> Vec<String> { asked.borrow().iter().map(|a| a["op"].as_str().unwrap().to_string()).collect() }

#[test]
fn the_window_opens_on_the_first_note_with_the_tree_folded() {
    let (app, asked) = outline(ok());
    assert_eq!(ops(&asked), ["hello", "tree", "page"]);
    assert_eq!(app.outline, "garden");
    assert_eq!(app.page.as_ref().unwrap().title, "Plot");
    assert_eq!(listed(&app), ["Plot", "Shed"], "a row shows only when every ancestor is open");
}

#[test]
fn opening_a_note_unfolds_the_way_to_it() {
    let (mut app, _) = outline(ok());
    app.open("fork");
    app.take();
    assert_eq!(listed(&app), ["Plot", "Lift the onions", "Take the fork", "Water the beans", "Shed"]);
    app.toggle("plot");
    assert_eq!(listed(&app), ["Plot", "Shed"]);
    app.go_back();
    app.take();
    assert_eq!(app.selected.as_deref(), Some("plot"));
    assert!(app.back.is_empty(), "going back isn't itself a place to go back from");
}

#[test]
fn a_save_sends_the_revision_that_was_read_and_closes_the_editor() {
    let (mut app, asked) = outline(ok());
    app.open("onions");
    app.take();
    app.edit();
    app.draft.as_mut().unwrap().edit.replace_text("Lift the onions [type::chore]\nTake the fork.");
    app.save();
    let sent = asked.borrow().last().unwrap().clone();
    assert_eq!((sent["op"].as_str(), sent["revision"].as_u64(), sent["text"].as_str()), (Some("save"), Some(3), Some("Lift the onions [type::chore]\nTake the fork.")));
    app.take();
    assert!(app.draft.is_none());
    assert_eq!(app.page.as_ref().unwrap().revision, 4);
}

#[test]
fn a_refused_save_keeps_what_was_typed() {
    let saves = ok();
    let (mut app, _) = outline(saves.clone());
    app.open("onions");
    app.take();
    app.edit();
    app.draft.as_mut().unwrap().edit.replace_text("Mine, typed for a while");
    *saves.borrow_mut() = Err(("stale-revision".into(), "Block changed since editing began: onions".into()));
    app.save();
    app.take();
    let draft = app.draft.as_ref().expect("the editor stays open");
    assert_eq!(draft.edit.text, "Mine, typed for a while");
    assert!(!draft.saving, "and can be saved again");
    assert!(matches!(&app.notice, Some((Tone::Problem, said)) if said.contains("changed since you opened it")));
    // Another note can't replace the unsaved text either.
    app.open("shed");
    assert_eq!(app.selected.as_deref(), Some("onions"));
    assert!(app.draft.is_some());
}

#[test]
fn typing_on_while_a_save_is_out_stays_in_the_editor_on_the_saved_revision() {
    let (mut app, _) = outline(ok());
    app.open("onions");
    app.take();
    app.edit();
    app.draft.as_mut().unwrap().edit.replace_text("First");
    app.save();
    app.draft.as_mut().unwrap().edit.replace_text("First, and more");
    app.take();
    let draft = app.draft.as_ref().expect("the newer text is still being written");
    assert_eq!((draft.edit.text.as_str(), draft.revision, draft.saving), ("First, and more", 4, false));
}

#[test]
fn a_change_to_the_open_note_reads_it_again_but_never_replaces_a_draft() {
    let (mut app, asked) = outline(ok());
    app.open("onions");
    app.take();
    // Someone else edits a note the page lists: the page is read again.
    app.bridge.say(json!({ "event": "changed", "ids": ["fork"], "structural": false }));
    app.take();
    assert_eq!(asked.borrow().last().unwrap()["op"], "page");
    // A note nothing on screen shows changes: nothing is asked.
    let quiet = asked.borrow().len();
    app.bridge.say(json!({ "event": "changed", "ids": ["shed"], "structural": false }));
    app.take();
    assert_eq!(asked.borrow().len(), quiet);
    // With the editor open the draft stays, and the change is said.
    app.take();
    app.edit();
    app.draft.as_mut().unwrap().edit.replace_text("Mine");
    app.bridge.say(json!({ "event": "changed", "ids": ["onions"], "structural": false }));
    app.take();
    assert_eq!(asked.borrow().len(), quiet, "the note isn't read over the draft");
    assert_eq!(app.draft.as_ref().unwrap().edit.text, "Mine");
    assert!(matches!(&app.notice, Some((Tone::Info, said)) if said.contains("changed while you were typing")));
    // A new note anywhere is a new row: the tree is asked again.
    app.bridge.say(json!({ "event": "changed", "ids": ["new"], "structural": true }));
    app.take();
    assert_eq!(asked.borrow().last().unwrap()["op"], "tree");
}

#[test]
fn only_the_newest_words_answer_lands_in_the_finder() {
    let (mut app, _) = outline(ok());
    app.find(Finder::Find, "on");
    // The person types on before the first answer is taken: that answer names older words.
    app.palette.as_mut().unwrap().edit.replace_text("onions");
    app.find_changed();
    app.take();
    assert_eq!(app.palette.as_ref().unwrap().rows[0].title, "found for onions");
}

#[test]
fn a_facet_value_narrows_the_query_in_the_views_grammar() {
    let (mut app, asked) = outline(ok());
    app.find(Finder::Query, "type=chore");
    app.take();
    assert_eq!(app.palette.as_ref().unwrap().facets[0].key, "area");
    app.narrow("area", "plot");
    assert_eq!(asked.borrow().last().unwrap()["where"], "type=chore area=plot");
    app.narrow("area", "plot");
    assert_eq!(app.palette.as_ref().unwrap().edit.text, "type=chore area=plot", "picked twice is still once");
    app.find_open();
    app.take();
    assert_eq!(app.selected.as_deref(), Some("beans"));
    assert!(app.palette.is_none());
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
fn the_note_draws_its_parts_and_a_row_in_a_component_opens_its_note() {
    let (app, _) = outline(ok());
    let mut rt = window(app);
    for key in ["tree/plot", "tree/shed", "note-title", "part/0", "part/1", "child/fork", "backlink/plan", "edit"] {
        assert!(rt.find(key).is_some(), "{key} is on screen");
    }
    assert!(rt.find("tree/onions").is_none(), "a folded row isn't built");
    press(&mut rt, "part/1/beans");
    assert_eq!(rt.state.selected.as_deref(), Some("beans"));
    assert_eq!(rt.state.page.as_ref().unwrap().title, "Water the beans");
    assert!(rt.find("tree/beans").is_some(), "and the tree unfolded to it");
}

#[test]
fn edit_swaps_the_note_for_its_source_and_cancel_brings_it_back() {
    let (app, _) = outline(ok());
    let mut rt = window(app);
    press(&mut rt, "edit");
    assert_eq!(rt.state.draft.as_ref().unwrap().edit.text, "Plot [type::chore]\nBefore the rain.");
    assert!(rt.find("source").is_some() && rt.find("save").is_some() && rt.find("note-title").is_none());
    press(&mut rt, "cancel");
    assert!(rt.state.draft.is_none() && rt.find("note-title").is_some());
}

#[test]
fn a_chip_is_a_query_for_every_note_that_carries_it() {
    let (app, asked) = outline(ok());
    let mut rt = window(app);
    press(&mut rt, "chip/type/chore");
    assert_eq!(asked.borrow().last().unwrap()["where"], "type=chore");
    assert!(rt.find("palette-field").is_some() && rt.find("facet/area/plot").is_some());
}
