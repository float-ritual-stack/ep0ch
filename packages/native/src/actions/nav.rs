//! Going to a note: opening one, going back, following a link in prose.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Touches};
use super::{Action, Actor, App, Notice, Outcome};
use crate::actline::Args;
use crate::keys;

static OPEN: ActionRow = ActionRow::new("open", Touches::Tile, "show a note in the reader, remembering where from; the tree unfolds to it. Refused while the reader holds unsaved text for another note. An agent's lands without taking the person's keys, and never while they type in the reader")
    .args(&[("id", ArgSpec::text("the block id").kind("note"))])
    .typing()
    .keys(&[KeyRow::via("a press on a note in the tree, a row or a link"), KeyRow::via("a note picked in the bar")])
    .examples(&[Example { act: "open id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "shows that note in the reader", safe: None }]);

static BACK: ActionRow = ActionRow::new("back", Touches::Tile, "go back to the note the reader showed before the last open")
    .args(&[("steps", ArgSpec::number("how many stops at once (default 1)").optional())])
    .typing()
    .keys(&[KeyRow::keys("mod+[", "back")])
    .menu(&[MenuRow::new("Back", "Note", Some("mod+["))]);

static FOLLOW: ActionRow = ActionRow::new("link.follow", Touches::Tile, "follow a link written in a note: a note's opens it (`ep0ch:b/<id>`), a page nobody has made yet and a web address say so")
    .args(&[("ref", ArgSpec::text("the link as the page carries it: ep0ch:b/<id>, ep0ch:p/<page> or a URL"))])
    .typing()
    .keys(&[KeyRow::via("a press on a link in a note's prose")])
    .examples(&[Example { act: "link.follow ref=ep0ch:b/7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "opens the note the link names", safe: None }]);

pub static ACTIONS: &[Action] = &[Action { row: &OPEN, run: open }, Action { row: &BACK, run: back }, Action { row: &FOLLOW, run: follow }];

/// Why the reader won't take another note: it holds unsaved text, which stays where it is.
pub(super) fn holds(app: &App, id: &str) -> Option<String> {
    if !app.unsaved() || app.editing.as_ref().is_none_or(|e| e.note == id) { return None }
    let save = keys::cap("edit.save").map_or(String::new(), |cap| format!(" ({cap})"));
    Some(format!("This note has unsaved text. Save it{save} or discard it before opening another."))
}

/// The reader shows `id`. `from`: where it came from is somewhere to go back to.
pub(super) fn go(app: &mut App, id: &str, by: &Actor, remember: bool) -> Outcome {
    if let Some(why) = holds(app, id) {
        app.st.notice = Some(Notice::problem(why.clone()));
        return Outcome::refused(why);
    }
    if app.editing.as_ref().is_some_and(|e| e.note != id) { app.st.editing = None }
    if remember && let Some(from) = app.subject().filter(|from| from != id) { app.st.back.push(from) }
    app.show(id);
    // The person's open puts the bar away; an agent's never closes what the person has open.
    if by.is_person() { app.st.bar.open = false }
    Outcome::done()
}

fn open(app: &mut App, args: &Args, by: &Actor) -> Outcome { go(app, args.text("id").unwrap_or(""), by, true) }

fn back(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let steps = args.number("steps").map_or(1, |n| n.max(1.0) as usize);
    let Some(at) = app.back.len().checked_sub(steps) else { return Outcome::refused("there is nowhere to go back to") };
    let id = app.back[at].clone();
    let outcome = go(app, &id, by, false);
    // Going back isn't itself a place to go back from.
    if outcome.ok { app.st.back.truncate(at) }
    outcome
}

/// A link in prose (outline-core's note-page.ts): `ep0ch:b/<id>` is a note; `ep0ch:p/<address>` a page nobody has made yet.
fn follow(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let href = args.text("ref").unwrap_or("");
    if let Some(id) = href.strip_prefix("ep0ch:b/") { return go(app, id, by, true) }
    let said = if href.starts_with("ep0ch:p/") { "No note has that page address yet.".to_string() } else { format!("A web link: {href}") };
    app.st.notice = Some(Notice::info(said.clone()));
    Outcome { said, ..Outcome::done() }
}
