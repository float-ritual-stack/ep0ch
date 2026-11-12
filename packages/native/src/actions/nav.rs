//! Going to a note: opening one, going back, following a link in prose.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Touches};
use super::{Action, Actor, App, Notice, Outcome};
use serde_json::json;

use crate::actline::Args;
use crate::keys;
use crate::layout::{self, Refusal, Request, TileSpec};

static OPEN: ActionRow = ActionRow::new("open", Touches::Tile, "open a note: the layout says in which tile (the tile it comes from when that reads notes, else where its opens land, else the first reader), and makes a new reader beside one that holds unsaved text. The reader remembers where from; the tree unfolds to it. An agent's lands without taking the person's keys")
    .args(&[("id", ArgSpec::text("the block id").kind("note"))])
    .typing()
    .keys(&[KeyRow::via("a press on a note in the tree, a row or a link"), KeyRow::via("a note picked in the bar")])
    .examples(&[Example { act: "open id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "shows that note in the reader", safe: None }]);

static BACK: ActionRow = ActionRow::new("back", Touches::Tile, "go back to the note the reader showed before its last open (each reader keeps its own way back)")
    .args(&[("steps", ArgSpec::number("how many stops at once (default 1)").optional())])
    .typing()
    .keys(&[KeyRow::keys("mod+[", "back")])
    .menu(&[MenuRow::new("Back", "Note", Some("mod+["))]);

static FOLLOW: ActionRow = ActionRow::new("link.follow", Touches::Tile, "follow a link written in a note: a note's opens it (`ep0ch:b/<id>`), a page nobody has made yet and a web address say so")
    .args(&[("ref", ArgSpec::text("the link as the page carries it: ep0ch:b/<id>, ep0ch:p/<page> or a URL"))])
    .typing()
    .keys(&[KeyRow::via("a press on a link in a note's prose")])
    .examples(&[Example { act: "link.follow ref=ep0ch:b/7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "opens the note the link names", safe: None }]);

/// An action whose note is placed by the layout: aimed at no tile, it is about none until it lands.
pub(super) fn placed(row: &ActionRow) -> bool { std::ptr::eq(row, &OPEN) }

pub static ACTIONS: &[Action] = &[Action { row: &OPEN, run: open }, Action { row: &BACK, run: back }, Action { row: &FOLLOW, run: follow }];

/// Why the one editor won't take another note: it holds unsaved text, which stays where it is.
pub(super) fn holds(app: &App, id: &str) -> Option<String> {
    if !app.unsaved() || app.editing.as_ref().is_none_or(|e| e.note == id) { return None }
    let save = keys::cap("edit.save").map_or(String::new(), |cap| format!(" ({cap})"));
    Some(format!("This note has unsaved text. Save it{save} or discard it before opening another."))
}

/// The note `id` opens: the layout says in which tile (`place`), and makes the room when it needs to (a new reader
/// beside one that is pinned or holds unsaved text). `remember`: where it came from is somewhere to go back to.
/// This is the one place an open is placed.
pub(super) fn go(app: &mut App, id: &str, by: &Actor, remember: bool) -> Outcome {
    let from = app.aimed.clone().unwrap_or_else(|| app.layout.focus.clone());
    // An open that names no tile comes from outside: an agent's lands where the screen says, else in the first
    // reader; the person's lands in the tile they are in when it reads notes.
    let aimed = app.aimed.is_some();
    let to = if !aimed && !by.is_person() { app.screen.lands().and_then(|name| app.layout.named(name)) } else { None };
    let outside = !aimed && to.is_none() && (!by.is_person() || !app.facts(&from).notes);
    let request = Request { from, note: id.to_string(), to, default: outside, ..Request::default() };
    // A tile made for it is named, and its name is its id.
    let sprout = TileSpec::new(app.layout.auto_name("reader", &[]), "reader");
    let landing = app.asked(by, |ctx| layout::place(&app.layout, &request, &sprout, ctx));
    let (name, why) = (landing.tile.clone(), landing.why.clone());
    let done = match landing.after {
        Some(Ok(done)) => done,
        Some(Err(Refusal(why))) => { if by.is_person() { app.st.notice = Some(Notice::problem(why.clone())) } return Outcome::refused(why) }
        None => return Outcome::refused(why.unwrap_or_else(|| "no reader takes this open".into())),
    };
    let Some(tile) = name.as_ref().and_then(|name| done.layout.named(name)) else { return Outcome::refused(why.unwrap_or_else(|| "no reader takes this open".into())) };
    app.arranged(done.layout, done.changed);
    // A draft with nothing unsaved ends when its tile shows another note.
    if app.editing.as_ref().is_some_and(|e| e.tile == tile && e.note != id) { app.st.editing = None }
    app.show(&tile, id, remember);
    app.keep();
    // The person's open puts the bar away; an agent's never closes what the person has open.
    if by.is_person() { app.st.bar.open = false }
    // Why it landed where it did, when that isn't where it was aimed, is said.
    if let (Some(why), true) = (&why, by.is_person()) { app.st.notice = Some(Notice::info(why.clone())) }
    Outcome { said: why.clone().unwrap_or_default(), ..Outcome::answer(json!({ "tile": name, "why": why })) }
}

fn open(app: &mut App, args: &Args, by: &Actor) -> Outcome { go(app, args.text("id").unwrap_or(""), by, true) }

fn back(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let steps = args.number("steps").map_or(1, |n| n.max(1.0) as usize);
    let Some(reader) = app.reader() else { return Outcome::refused("there is no reader to go back in") };
    let history = app.ui(&reader).history.clone();
    let Some(at) = history.len().checked_sub(steps) else { return Outcome::refused("there is nowhere to go back to") };
    let id = history[at].clone();
    if app.editing.as_ref().is_some_and(|e| e.tile == reader) && let Some(why) = holds(app, &id) { app.st.notice = Some(Notice::problem(why.clone())); return Outcome::refused(why) }
    if app.editing.as_ref().is_some_and(|e| e.tile == reader && e.note != id) { app.st.editing = None }
    // Going back isn't itself a place to go back from.
    app.show(&reader, &id, false);
    app.ui_mut(&reader).history.truncate(at);
    app.keep();
    if by.is_person() { app.st.bar.open = false }
    Outcome::done()
}

/// A link in prose (outline-core's note-page.ts): `ep0ch:b/<id>` is a note; `ep0ch:p/<address>` a page nobody has made yet.
fn follow(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let href = args.text("ref").unwrap_or("");
    if let Some(id) = href.strip_prefix("ep0ch:b/") { return go(app, id, by, true) }
    let said = if href.starts_with("ep0ch:p/") { "No note has that page address yet.".to_string() } else { format!("A web link: {href}") };
    app.st.notice = Some(Notice::info(said.clone()));
    Outcome { said, ..Outcome::done() }
}
