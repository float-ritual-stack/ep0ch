//! Going to a note: opening one, going back, following a link in prose.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Touches};
use super::{Action, Actor, App, Notice, Outcome, About};
use serde_json::json;

use crate::actline::Args;
use crate::layout::{self, Refusal, Request, TileSpec};

static OPEN: ActionRow = ActionRow::new("open", Touches::Tile, "open a note: the layout says in which tile (the tile it comes from when that reads notes, else where its opens land, else the first reader), and makes a new reader beside one a block is being written in. The reader remembers where from; the tree unfolds to it. An agent's lands without taking the person's keys")
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

// (An open's note is placed by the layout: aimed at no tile, it is about none until it lands. A link is followed
// in the note it is written in: it is about that reader, as going back is.)
pub static ACTIONS: &[Action] = &[Action { row: &OPEN, run: open, about: About::Placed }, Action { row: &BACK, run: back, about: About::Notes }, Action { row: &FOLLOW, run: follow, about: About::Notes }];

/// The note `id` opens. This says only who asks and from where: from the tile the act is aimed at, else (the
/// person's) the tile with their keys; an agent's that names no tile comes from outside every tile. Where it lands is
/// the layout's (`land`).
pub(super) fn go(app: &mut App, id: &str, by: &Actor, remember: bool) -> Outcome {
    let from = app.aimed.clone().unwrap_or_else(|| app.layout.focus.clone());
    land(app, Request { from, note: id.to_string(), default: app.aimed.is_none() && !app.stands(by), ..Request::default() }, by, remember)
}

/// An open, placed: the layout says in which tile (`place`), and makes the room when it needs to (a new reader
/// beside one that is pinned or has a block being written in it, a float or a tab for a new note). `remember`: where it came
/// from is somewhere to go back to. This is the one place an open is placed; the tile it landed in is answered.
pub(super) fn land(app: &mut App, request: Request, by: &Actor, remember: bool) -> Outcome {
    let id = request.note.clone();
    // A tile made for it is named, and its name is its id: a tile of the kind the service says reads notes.
    let Some(kind) = app.note_kind().map(|row| row.written().to_string()) else { return Outcome::refused("no tile kind here reads notes: the service lists none") };
    let sprout = TileSpec::new(app.layout.auto_name(&kind, &[]), kind);
    let landing = app.asked(by, |ctx| layout::place(&app.layout, &request, &sprout, ctx));
    let (name, why) = (landing.tile.clone(), landing.why.clone());
    let done = match landing.after {
        Some(Ok(done)) => done,
        Some(Err(Refusal(why))) => { if app.stands(by) { app.st.notice = Some(Notice::problem(why.clone())) } return Outcome::refused(why) }
        None => return Outcome::refused(why.unwrap_or_else(|| "no reader takes this open".into())),
    };
    let Some(tile) = name.as_ref().and_then(|name| done.layout.named(name)) else { return Outcome::refused(why.unwrap_or_else(|| "no reader takes this open".into())) };
    app.arranged(done.layout, done.changed);
    // (A tile a block is being written in is never where this lands: the layout's rule puts the open beside it.)
    app.show(&tile, &id, remember);
    app.keep();
    // The person's open puts the bar away; an agent's never closes what the person has open.
    if app.stands(by) { app.st.bar.open = false }
    // Why it landed where it did, when that isn't where it was aimed, is said.
    if let (Some(why), true) = (&why, app.stands(by)) { app.st.notice = Some(Notice::info(why.clone())) }
    Outcome { said: why.clone().unwrap_or_default(), ..Outcome::answer(json!({ "tile": name, "why": why })) }
}

fn open(app: &mut App, args: &Args, by: &Actor) -> Outcome { go(app, args.text("id").unwrap_or(""), by, true) }

fn back(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let steps = args.number("steps").map_or(1, |n| n.max(1.0) as usize);
    let Some(reader) = app.about() else { return Outcome::refused("there is no reader to go back in") };
    let history = app.ui(&reader).history.clone();
    let Some(at) = history.len().checked_sub(steps) else { return Outcome::refused("there is nowhere to go back to") };
    let id = history[at].clone();
    // A reader a block is being written in stays on its note: the fact the layout's own rules read, in its words.
    if let Some(why) = app.holds_edit(&reader) { if app.stands(by) { app.st.notice = Some(Notice::problem(why.clone())) } return Outcome::refused(why) }
    // Going back isn't itself a place to go back from.
    app.show(&reader, &id, false);
    app.ui_mut(&reader).history.truncate(at);
    app.keep();
    if app.stands(by) { app.st.bar.open = false }
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
