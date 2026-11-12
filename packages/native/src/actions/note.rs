//! Writing notes: a new one, a move among its siblings, the Trash and back. Each is the service's own write
//! (`create`, `move`, `delete`, `trash.restore`), recorded as whoever acts; what the window shows of it is read
//! again when the write answers.
use serde_json::json;

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Notice, Outcome, About, nav, word};
use crate::actline::Args;
use crate::layout::Request;
use crate::store::Reply;

static NEW: ActionRow = ActionRow::new("note.new", Touches::Nothing, "a new note under the open one (or near=<id>; with nothing open, at the top level). The person's opens to be written, at the revision the service made it at, where the screen's rule for new notes says (a float, a tab, where its opens land); an agent's is made and said, and opens nothing")
    .args(&[
        ("text", ArgSpec::text("its text: a title line, a body, [key::value] properties. The person's starts empty").optional()),
        ("near", ArgSpec::text("make it under this note (a block id) instead of the open one").optional().kind("note")),
    ])
    .keys(&[KeyRow::keys("mod+n", "a new note under the open one")])
    .menu(&[MenuRow::new("New note", "Note", Some("mod+n"))])
    .examples(&[Example { act: "note.new text=\"Seed swap\"", does: "makes a note titled Seed swap under the open one", safe: None }]);

static TRASH: ActionRow = ActionRow::new("note.trash", Touches::Draft, "move the open note (or ref=<block id>) and the notes under it to the Trash, recorded as the actor's, where note.untrash brings it back. Refused for a note with a draft open on it")
    .args(&[
        ("ref", ArgSpec::text("the note's block id; default the open note").optional().kind("note")),
        ("confirm", ArgSpec::text("the note's id (or its first 8+ characters): the same note, said twice").optional()),
    ])
    .keys(&[KeyRow::on("mod+backspace", "tile", "move the open note to the Trash")])
    .menu(&[MenuRow::new("Trash this note", "Trash", Some("mod+backspace"))])
    .examples(&[Example { act: "note.trash ref=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 confirm=7d9a1f40", does: "moves that note and the notes under it to the Trash", safe: None }]);

static UNTRASH: ActionRow = ActionRow::new("note.untrash", Touches::Nothing, "bring back the note the actor trashed last (or id=<its block id>), where it was")
    .args(&[("id", ArgSpec::text("a trashed note's block id; default the note this actor trashed last").optional().kind("note"))])
    .keys(&[KeyRow::via("Undo on the notice a trash leaves")])
    .menu(&[MenuRow::new("Undo", "Trash", None)])
    .examples(&[Example { act: "note.untrash", does: "brings back the note this actor trashed last, where it was", safe: None }]);

static MOVE: ActionRow = ActionRow::new("note.move", Touches::Nothing, "move the open note one step in its list: up or down among its siblings, in under the sibling above, out after its parent. The service's move, checked at the revision read")
    .args(&[("step", ArgSpec::text("up or down one place among its siblings, in (last under the sibling above) or out (right after its parent)").choices(&["up", "down", "in", "out"]))])
    .keys(&[
        KeyRow::with("alt+up", Some("tile"), "move the note up", &[("step", Scalar::Text("up"))]),
        KeyRow::with("alt+down", Some("tile"), "move the note down", &[("step", Scalar::Text("down"))]),
        KeyRow::with("alt+right", Some("tile"), "move the note in, under the one above", &[("step", Scalar::Text("in"))]),
        KeyRow::with("alt+left", Some("tile"), "move the note out, after its parent", &[("step", Scalar::Text("out"))]),
    ])
    .examples(&[Example { act: "note.move step=up", does: "moves the open note one place up among its siblings", safe: None }]);

pub static ACTIONS: &[Action] = &[Action { row: &NEW, run: new, about: About::Any }, Action { row: &TRASH, run: trash, about: About::Notes }, Action { row: &UNTRASH, run: untrash, about: About::Nothing }, Action { row: &MOVE, run: step, about: About::Notes }];

fn new(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    // The person's new note opens in the editor: text the editor holds unsaved stays where it is.
    if by.is_person() && let Some(why) = app.editing.as_ref().map(|e| e.tile.clone()).and_then(|tile| app.holds_edit(&tile)) {
        app.st.notice = Some(Notice::problem(why.clone()));
        return Outcome::refused(why);
    }
    // The tile it is made from: the one aimed at, else the one with the keys. The screen's rule for a new note
    // made there may be another action altogether (a board's lane makes a card).
    let from = app.about().unwrap_or_else(|| app.layout.focus.clone());
    // The screen's rule is asked once, with the kind the tile is (its row's: the service wrote the rule's kinds as it
    // serves a tile's, so no name is tried twice and none is mapped here).
    let kind = app.kind_of(&from).map(|row| row.kind.clone()).or_else(|| app.spec(&from).map(|spec| spec.kind.clone()));
    let rule = app.spec_now().and_then(|spec| spec.new_note(kind.as_deref())).cloned();
    if by.is_person() && let Some(action) = rule.as_ref().and_then(|rule| rule["action"].as_str()) {
        // The rule's action is a request as it stands (its arguments are data): run as one, from the tile it was made in.
        let given = rule.as_ref().and_then(|rule| rule["args"].as_object()).cloned().unwrap_or_default();
        return app.act_request(crate::actline::Request { action: action.to_string(), tile: Some(app.layout.name(&from)), by: None, args: given }, by.clone());
    }
    let parent = args.text("near").map(str::to_string).or_else(|| app.subject());
    if by.is_person() && let (Some(p), Some(tree)) = (&parent, app.target(About::Tree)) { app.ui_mut(&tree).unfolded.insert(p.clone()); }
    let opens = rule.as_ref().and_then(|rule| rule["opens"].as_str()).unwrap_or("float");
    let at = app.at.clone();
    app.store.write(&at, "create", json!({ "parentId": parent, "text": args.text("text").unwrap_or("") }), by, created, json!({ "parent": parent, "from": from, "opens": opens }));
    Outcome::done()
}

fn created(app: &mut App, reply: Reply) {
    let result = match reply.result { Ok(result) => result, Err(refusal) => { app.st.notice = Some(Notice::problem(refusal.error)); return } };
    let (id, revision, text) = (result["id"].as_str().unwrap_or("").to_string(), result["revision"].as_u64().unwrap_or(0), result["text"].as_str().unwrap_or("").to_string());
    let parent = reply.ctx["parent"].as_str().map(str::to_string);
    if !reply.by.is_person() {
        // An agent's new note is made and said: it takes neither the reader nor the keys.
        app.wrote(&[parent]);
        app.st.notice = Some(Notice::info(format!("{} made a note.", reply.by.label())));
        return;
    }
    // Where it opens is the layout's to say, asked as the screen's rule puts it: a float over the screen, a tab on
    // the tile it was made from, or where the screen's opens land. (This window has no drawer: its notes float.)
    let from = reply.ctx["from"].as_str().map(str::to_string).filter(|tile| app.spec(tile).is_some()).unwrap_or_else(|| app.layout.focus.clone());
    let request = match reply.ctx["opens"].as_str() {
        Some("lands") => Request { from, note: id.clone(), default: true, ..Request::default() },
        Some("tab") => Request { from, note: id.clone(), new_note: Some("tab".into()), ..Request::default() },
        _ => Request { from, note: id.clone(), new_note: Some("float".into()), ..Request::default() },
    };
    let landed = nav::land(app, request, &reply.by, true);
    let Some(tile) = landed.answer["tile"].as_str().and_then(|name| app.layout.named(name)) else {
        app.st.notice = Some(Notice::problem(format!("The note was made, and nothing here opens it: {}", landed.said)));
        app.wrote(&[parent]);
        return;
    };
    // A new note opens to be written, at the revision the service made it at.
    app.begin(tile, id, revision, text, &reply.by);
    app.keep();
    app.wrote(&[parent]);
}

fn trash(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(id) = args.text("ref").map(str::to_string).or_else(|| app.subject()) else { return Outcome::refused("no note is open to trash") };
    if let Some(confirm) = args.text("confirm") && confirm != id && !(confirm.len() >= 8 && id.starts_with(confirm)) {
        return Outcome::refused(format!("confirm={confirm} isn't the note {id}: say the same note twice"));
    }
    if app.editing.as_ref().is_some_and(|e| e.note == id) {
        let why = "This note has a draft open on it: save or close it before it goes to the Trash.".to_string();
        if by.is_person() { app.st.notice = Some(Notice::problem(why.clone())) }
        return Outcome::refused(why);
    }
    let parent = app.shown().filter(|p| p.id == id).and_then(|p| p.ancestors.last().map(|a| a.id.clone())).or_else(|| app.parent_of(&id));
    let at = app.at.clone();
    app.store.write(&at, "delete", json!({ "blockId": id }), by, trashed, json!({ "note": id, "parent": parent }));
    Outcome::done()
}

fn trashed(app: &mut App, reply: Reply) {
    if let Err(refusal) = &reply.result { app.st.notice = Some(Notice::problem(refusal.error.clone())); return }
    let (note, parent) = (reply.ctx["note"].as_str().unwrap_or("").to_string(), reply.ctx["parent"].as_str().map(str::to_string));
    app.st.trashed.insert(reply.by.id(), note.clone());
    let said = if reply.by.is_person() { "Moved to the Trash.".to_string() } else { format!("{} moved a note to the Trash.", reply.by.label()) };
    // The notice knows what to bring back: its undo is an act line.
    app.st.notice = Some(Notice { undo: Some(format!("note.untrash id={}", word(&note))), ..Notice::info(said) });
    // A note on screen is gone: each reader that showed it moves to the note above it, whoever trashed it.
    for tile in app.layout.all() {
        if app.ui(&tile).note.as_deref() == Some(note.as_str()) || (app.ui(&tile).note.is_none() && app.reads_notes(&tile) && app.note_of(&tile).as_deref() == Some(note.as_str())) { app.ui_mut(&tile).note = parent.clone() }
        if app.ui(&tile).history.contains(&note) { app.ui_mut(&tile).history.retain(|id| *id != note) }
    }
    app.wrote(&[parent]);
}

fn untrash(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(note) = args.text("id").map(str::to_string).or_else(|| app.trashed.get(&by.id()).cloned()) else { return Outcome::refused("nothing was trashed here to bring back") };
    let at = app.at.clone();
    app.store.write(&at, "trash.restore", json!({ "blockId": note }), by, restored, json!({ "note": note }));
    Outcome::done()
}

fn restored(app: &mut App, reply: Reply) {
    let result = match reply.result { Ok(result) => result, Err(refusal) => { app.st.notice = Some(Notice::problem(refusal.error)); return } };
    let note = reply.ctx["note"].as_str().unwrap_or("").to_string();
    app.st.notice = Some(Notice::info("Back from the Trash."));
    if app.trashed.get(&reply.by.id()) == Some(&note) { app.st.trashed.remove(&reply.by.id()); }
    // The person's undo goes back to the note; an agent's leaves the reader where it is.
    if reply.by.is_person() { nav::go(app, &note, &reply.by, false); }
    app.wrote(&[result["parentId"].as_str().map(str::to_string)]);
}

/// `step`: up, down, in or out, as the service's move reads them.
fn step(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some((id, revision)) = app.page().map(|p| (p.id.clone(), p.revision)) else { return Outcome::refused("no note is open to move") };
    let at = app.at.clone();
    app.store.write(&at, "move", json!({ "blockId": id, "expectedRevision": revision, "step": args.text("step") }), by, moved, json!(null));
    Outcome::done()
}

fn moved(app: &mut App, reply: Reply) {
    let result = match reply.result { Ok(result) => result, Err(refusal) => { app.st.notice = Some(Notice::problem(refusal.error)); return } };
    if let Some(said) = result["said"].as_str().filter(|said| !said.is_empty()) { app.st.notice = Some(Notice::info(said)) }
    app.wrote(&[result["parentId"].as_str().map(str::to_string), result["previousParentId"].as_str().map(str::to_string)]);
}
