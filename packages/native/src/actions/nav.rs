//! Going to a note: opening one, going back, following a link in prose.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Notice, Outcome, About, Scroll};
use crate::cursor::{self, Step};
use serde_json::json;

use crate::actline::Args;
use crate::layout::{self, Destination, Refusal, Request, TileSpec};

pub(super) static OPEN: ActionRow = ActionRow::new("open", Touches::Tile, "open a note: the layout says in which tile (the tile it comes from when that reads notes, else where its opens land, else the first reader), and makes a new reader beside one a block is being written in. The reader remembers where from; the tree unfolds to it. An agent's lands without taking the person's keys")
    .args(&[("id", ArgSpec::text("the block id").kind("note"))])
    .typing()
    .keys(&[KeyRow::via("a press on a note in the tree, a row or a link"), KeyRow::via("a note picked in the bar")])
    .examples(&[Example { act: "open id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "shows that note in the reader", safe: None }]);

static BACK: ActionRow = ActionRow::new("back", Touches::Tile, "go back to the note the reader showed before its last open (each reader keeps its own way back)")
    .args(&[("steps", ArgSpec::number("how many stops at once (default 1)").optional())])
    .typing()
    .keys(&[KeyRow::keys("mod+[", "back"), KeyRow::on("alt+left backspace", "page", "back to the note before")])
    .menu(&[MenuRow::new("Back", "Note", Some("mod+["))]);

static FORWARD: ActionRow = ActionRow::new("forward", Touches::Tile, "go forward again to the note the reader went back from (each reader keeps its own way; a new open forgets it)")
    .args(&[("steps", ArgSpec::number("how many stops at once (default 1)").optional())])
    .typing()
    .keys(&[KeyRow::on("alt+right", "page", "forward again")])
    .menu(&[MenuRow::new("Forward", "Note", Some("alt+right"))]);

static UP: ActionRow = ActionRow::new("up", Touches::Tile, "open the note the reader's note is under, in that reader (the way back remembers where from)")
    .typing()
    .keys(&[KeyRow::on("u", "page", "the note this one is under")])
    .menu(&[MenuRow::new("Up to its parent", "Note", Some("u"))]);

static READING: ActionRow = ActionRow::new("reading.step", Touches::Tile, "move a reader's reading line (tile=, else the reader with the keys): by= parts of its page (1 the next, -1 the one before). The reading line is the part of the page the keys are on: it is shown beside the part, brought into view when it moves, and never moved by scrolling. The person's place: an agent moves the one of a reader they are not on")
    .args(&[("by", ArgSpec::number("1 the next part, -1 the one before (default 1)").optional())])
    .keys(&[
        KeyRow::with("j down", Some("page"), "the next part of the page", &[("by", Scalar::Whole(1))]),
        KeyRow::with("k up", Some("page"), "the part before", &[("by", Scalar::Whole(-1))]),
    ])
    .examples(&[Example { act: "reading.step by=1 tile=reader", does: "moves the reader's reading line to the next part of its page", safe: Some(true) }]);

static SCROLL: ActionRow = ActionRow::new("scroll", Touches::Tile, "scroll a reader's page (tile=, else the reader with the keys) without moving its reading line: by= pages (negative: up; a window scrolls by what its view shows, where the terminal door counts rows), or to= top or end")
    .args(&[("by", ArgSpec::number("pages to scroll down (negative: up)").optional()), ("to", ArgSpec::text("top or end").optional().choices(&["top", "end"]))])
    .keys(&[
        KeyRow::with("pagedown space", Some("page"), "a page down", &[("by", Scalar::Whole(1))]),
        KeyRow::with("pageup", Some("page"), "a page up", &[("by", Scalar::Whole(-1))]),
        KeyRow::with("home", Some("page"), "the top of the page", &[("to", Scalar::Text("top"))]),
        KeyRow::with("end shift+g", Some("page"), "the end of the page", &[("to", Scalar::Text("end"))]),
    ])
    .examples(&[Example { act: "scroll by=1 tile=reader", does: "scrolls the reader's page one page down", safe: Some(true) }]);

static FOLLOW: ActionRow = ActionRow::new("link.follow", Touches::Tile, "follow a link written in a note: a note's opens it (`ep0ch:b/<id>`), a page nobody has made yet and a web address say so")
    .args(&[("ref", ArgSpec::text("the link as the page carries it: ep0ch:b/<id>, ep0ch:p/<page> or a URL"))])
    .typing()
    .keys(&[KeyRow::via("a press on a link in a note's prose")])
    .examples(&[Example { act: "link.follow ref=ep0ch:b/7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "opens the note the link names", safe: None }]);

// (An open's note is placed by the layout: aimed at no tile, it is about none until it lands. A link is followed
// in the note it is written in: it is about that reader, as going back is.)
pub static ACTIONS: &[Action] = &[
    Action { row: &OPEN, run: open, about: About::Placed }, Action { row: &BACK, run: back, about: About::Notes }, Action { row: &FORWARD, run: forward, about: About::Notes }, Action { row: &UP, run: up, about: About::Notes },
    Action { row: &FOLLOW, run: follow, about: About::Notes }, Action { row: &READING, run: reading, about: About::Notes }, Action { row: &SCROLL, run: scroll, about: About::Notes },
];

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
        Some(Err(why)) => { let why = super::says(&why, by); if app.stands(by) { app.st.notice = Some(Notice::problem(why.clone())) } return Outcome::refused(why) }
        // It lands nowhere: the layout's reason, with the ways out it names.
        None => return Outcome::refused(match &landing.placement.destination { Destination::None { reason, ways, .. } => super::says(&Refusal::new(why.unwrap_or_else(|| reason.clone())).ways(ways.clone()), by), _ => why.unwrap_or_else(|| "no reader takes this open".into()) }),
    };
    let Some(tile) = name.as_ref().and_then(|name| done.layout.named(name)) else { return Outcome::refused(why.unwrap_or_else(|| "no reader takes this open".into())) };
    // What placement remembers of this open, as the door's desk notes it: the tile made in a keyed container is
    // one of that container's and where its next open lands; a reader made beside one that is written in, or
    // beside one the layout says takes its opens beside it, takes the next open aimed there too.
    let plan = &landing.placement;
    // The tile made for this open: the one the note is read in, or the spine a reader's old note stays in.
    let spine = landing.keeps.as_ref().and_then(|keeps| done.layout.named(keeps));
    let made = if landing.new { Some(tile.clone()) } else { spine.clone() };
    let prior = spine.as_ref().and_then(|_| app.ui(&tile).note.clone());
    let aimed = request.to.clone().unwrap_or_else(|| request.from.clone());
    let editing = landing.new && app.facts(&aimed).editing.is_some();
    let into = request.container.clone().or_else(|| match &plan.destination { Destination::New { at: layout::At::In { key, .. } } => Some(key.clone()), _ => None }).or_else(|| plan.keep.as_ref().and_then(|(kept, _)| app.memory.into_of(kept).map(str::to_string)));
    if let (Some(made), Some(key)) = (&made, &into) { app.st.memory.opened_into(key).ids.push(made.clone()) }
    if let (Some(made), Destination::New { at: layout::At::In { key, .. } }) = (&made, &plan.destination) { app.st.memory.opened_into(key).active = Some(made.clone()) }
    if editing { app.st.memory.go_beside(&aimed, &tile) }
    if let Some(beside) = &plan.beside_of { app.st.memory.go_beside(beside, &tile) }
    app.arranged(done.layout, done.changed);
    // A reader's old note stays in the spine made for it: the spine is told that note (it would show none).
    if let (Some(spine), Some(prior)) = (&spine, &prior) { app.show(spine, prior, false) }
    // (A tile a block is being written in is never where this lands: the layout's rule puts the open beside it.)
    app.show(&tile, &id, remember);
    app.keep();
    // The person's open puts the bar away; an agent's never closes what the person has open.
    if app.stands(by) { app.st.bar.open = false }
    // Why it landed where it did, when that isn't where it was aimed, is said, with the way to undo the reason
    // where the layout names one and this window has it (`says`).
    let why = why.map(|why| super::says(&Refusal::new(why).ways(landing.placement.ways.clone()), by));
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
    // Going back isn't itself a place to go back from: it is somewhere to go forward to again, each stop passed
    // over and the note left, nearest last.
    let passed: Vec<String> = app.note_of(&reader).into_iter().chain(history[at + 1..].iter().rev().cloned()).collect();
    app.show(&reader, &id, false);
    let ui = app.ui_mut(&reader);
    ui.history.truncate(at);
    ui.ahead.extend(passed);
    app.keep();
    if app.stands(by) { app.st.bar.open = false }
    Outcome::done()
}

/// Forward again: the note the reader went back from, and the one it leaves is somewhere to go back to.
fn forward(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let steps = args.number("steps").map_or(1, |n| n.max(1.0) as usize);
    let Some(reader) = app.about() else { return Outcome::refused("there is no reader to go forward in") };
    let ahead = app.ui(&reader).ahead.clone();
    let Some(at) = ahead.len().checked_sub(steps) else { return Outcome::refused("there is nowhere to go forward to: nothing was gone back from") };
    if let Some(why) = app.holds_edit(&reader) { if app.stands(by) { app.st.notice = Some(Notice::problem(why.clone())) } return Outcome::refused(why) }
    let passed: Vec<String> = app.note_of(&reader).into_iter().chain(ahead[at + 1..].iter().rev().cloned()).collect();
    app.show(&reader, &ahead[at], false);
    let ui = app.ui_mut(&reader);
    ui.ahead.truncate(at);
    ui.history.extend(passed);
    app.keep();
    if app.stands(by) { app.st.bar.open = false }
    Outcome::done()
}

/// The note the reader's note is under: the last of the way to it, as its page says (`ancestors`), opened in that
/// reader by the one open.
fn up(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let Some(reader) = app.about() else { return Outcome::refused("there is no reader to go up in") };
    let Some(parent) = app.shown_of(&reader).and_then(|page| page.ancestors.last()).map(|above| above.id.clone()) else { return Outcome::refused(format!("the note {} shows is under no other", app.layout.name(&reader))) };
    let outer = app.st.aimed.replace(reader);
    let went = go(app, &parent, by, true);
    app.st.aimed = outer;
    went
}

/// A reader's reading line moved through the parts of its page: the same step a list's cursor takes
/// (`cursor::stepped`), over the parts the service framed. The part it lands on is brought into view.
fn reading(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let Some(reader) = app.about() else { return Outcome::refused("there is no reader to move a reading line in") };
    let n = app.shown_of(&reader).map_or(0, |page| page.parts.len());
    if n == 0 { return Outcome::refused(format!("{} shows no page to move through", app.layout.name(&reader))) }
    let step = Step::By(args.number("by").map_or(1, |by| by as i64));
    let to = cursor::stepped(step, app.ui(&reader).reading.map_or(-1, |at| at as i64), n, 0.0).max(0) as usize;
    let name = app.layout.name(&reader);
    app.ui_mut(&reader).reading = Some(to);
    app.st.reveal = Some(format!("tile/{name}/reading/{to}"));
    Outcome::answer(json!({ "tile": name, "reading": to + 1, "of": n }))
}

/// A reader's page scrolled, its reading line left where it is: asked of the next frame, where the window's hands
/// are (`keys::effects`).
fn scroll(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let Some(reader) = app.about() else { return Outcome::refused("there is no reader to scroll") };
    let how = match (args.text("to"), args.number("by")) { (Some("top"), _) => Scroll::Top, (Some(_), _) => Scroll::End, (None, by) => Scroll::Pages(by.map_or(1, |by| by as i32)) };
    app.st.scroll = Some((format!("tile/{}/scroll", app.layout.name(&reader)), how));
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
