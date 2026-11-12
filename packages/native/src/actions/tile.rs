//! A tile's own actions: split it, move it, close it, give it the keys, put it in a dock. Each is one operation
//! handed to the layout (`reshape`), whose rules say yes or why not: nothing here decides.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Outcome};
use crate::actline::Args;
use crate::layout::tree::neighbour;
use crate::layout::{At, Dir, Op, Place, TileSpec};
use crate::tiles;

static SPLIT: ActionRow = ActionRow::new("tile.split", Touches::Shape, "a new tile beside this one (tile=, else the one with the keys): on its right unless dir= says another side. A reader's split shows the same note; kind= makes another kind")
    .args(&[
        ("dir", ArgSpec::text("the side the new tile goes on (default right)").optional().choices(&["right", "down", "left", "up"])),
        ("kind", ArgSpec::text("the new tile's kind (default this tile's when it reads notes, else reader)").optional().kind("tile-kind")),
        ("name", ArgSpec::text("the new tile's name (default its kind, numbered)").optional()),
    ])
    .keys(&[KeyRow::keys("mod+d", "split this tile: a new one on its right"), KeyRow::with("mod+shift+d", None, "split this tile: a new one below", &[("dir", Scalar::Text("down"))])])
    .menu(&[MenuRow::new("Split", "Tile", Some("mod+d")), MenuRow::with("Split below", "Tile", Some("mod+shift+d"), &[("dir", Scalar::Text("down"))])])
    .examples(&[Example { act: "tile.split dir=down tile=reader", does: "a second reader under the first, on the same note", safe: None }]);

static MOVE: ActionRow = ActionRow::new("tile.move", Touches::Shape, "move a tile (tile=, else the one with the keys) beside another, into its tabs, or along an edge of the screen: to= names the tile it goes by (or screen), side= which side of it (center: into its tabs)")
    .args(&[
        ("to", ArgSpec::text("the tile it goes by, by name; screen for an edge of the whole screen").kind("tile")),
        ("side", ArgSpec::text("which side of it: left, right, top, bottom, or center for a tab beside it").choices(&["left", "right", "top", "bottom", "center"])),
    ])
    .keys(&[KeyRow::via("a drag on a tile's title, dropped on another tile")])
    .examples(&[Example { act: "tile.move side=center to=backlinks tile=tree", does: "puts the tree in a tab with the backlinks, in their dock", safe: None }]);

static CLOSE: ActionRow = ActionRow::new("tile.close", Touches::Shape, "close a tile (tile=, else the one with the keys). One that holds unsaved text stays, and says so")
    .keys(&[KeyRow::keys("mod+w", "close this tile"), KeyRow::via("a press on the cross in a tile's title")])
    .menu(&[MenuRow::new("Close", "Tile", Some("mod+w"))])
    .examples(&[Example { act: "tile.close tile=reader2", does: "closes the second reader", safe: None }]);

static FOCUS: ActionRow = ActionRow::new("tile.focus", Touches::Screen, "give a tile the keys: tile= by name, or dir= the next one that way from the tile that has them. The person's: an agent never moves their keys")
    .args(&[("dir", ArgSpec::text("the next tile that way").optional().choices(&["left", "right", "up", "down"]))])
    .keys(&[
        KeyRow::with("mod+alt+left", None, "the keys to the tile on the left", &[("dir", Scalar::Text("left"))]),
        KeyRow::with("mod+alt+right", None, "the keys to the tile on the right", &[("dir", Scalar::Text("right"))]),
        KeyRow::with("mod+alt+up", None, "the keys to the tile above", &[("dir", Scalar::Text("up"))]),
        KeyRow::with("mod+alt+down", None, "the keys to the tile below", &[("dir", Scalar::Text("down"))]),
        KeyRow::via("a press on a tile's title or its tab"),
    ])
    .examples(&[Example { act: "tile.focus tile=tree", does: "the keys go to the tree", safe: Some(true) }]);

static DOCK: ActionRow = ActionRow::new("tile.dock", Touches::Shape, "put a tile (tile=, else the one with the keys) in a dock that slides from an edge (on=true), or take it out again, back in the layout (on=false); left out, the other way. edge= says which edge; left out, the nearest")
    .args(&[
        ("on", ArgSpec::flag("true docks it, false takes it out of its dock; left out, the other way").optional()),
        ("edge", ArgSpec::text("the edge its dock slides from").optional().choices(&["left", "right", "up", "down"])),
    ])
    .keys(&[KeyRow::via("its row in the bar")])
    .examples(&[Example { act: "tile.dock edge=left tile=tree", does: "the tree goes into a dock on the left edge", safe: None }]);

pub static ACTIONS: &[Action] = &[Action { row: &SPLIT, run: split }, Action { row: &MOVE, run: move_ }, Action { row: &CLOSE, run: close }, Action { row: &FOCUS, run: focus }, Action { row: &DOCK, run: dock }];

/// The tile an act is about: the one it is aimed at, else the one with the keys.
fn target(app: &App) -> String { app.aimed.clone().unwrap_or_else(|| app.layout.focus.clone()) }

fn split(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let from = target(app);
    let own = app.spec(&from).map(|spec| spec.kind.clone()).unwrap_or_default();
    let kind = args.text("kind").map(str::to_string).unwrap_or_else(|| if tiles::kind(&own).is_some_and(|row| row.notes) { own.clone() } else { "reader".into() });
    let dir = args.text("dir").and_then(Dir::read).unwrap_or(Dir::Right);
    // A tile made here is named, and its name is its id.
    let name = args.text("name").map(str::to_string).unwrap_or_else(|| app.layout.auto_name(&kind, &[]));
    let mut spec = TileSpec::new(name.clone(), kind.clone());
    // A split of a follower follows what it followed.
    if kind == own && let Some(source) = app.spec(&from).and_then(|s| s.fields.get("source")).cloned() { spec.fields.insert("source".into(), source); spec.fields.insert("subject".into(), "follows".into()); }
    let note = app.note_of(&from).filter(|_| tiles::kind(&kind).is_some_and(|row| row.notes) && kind == own);
    let outcome = app.reshape(&Op::Open { tile: spec, name: Some(name.clone()), loose: false, alt: false, deliberate: None, at: At::Split { target: from, dir, pair: false, weight: None }, keys: true, link: None, verb: None, select_from: Vec::new() }, by);
    if outcome.ok && let Some(note) = note { app.show(&name, &note, false); app.keep() }
    outcome
}

fn move_(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let tile = target(app);
    let (to, side) = (args.text("to").unwrap_or(""), args.text("side").unwrap_or("right"));
    let dir = match side { "left" => Some(Dir::Left), "right" => Some(Dir::Right), "top" | "up" => Some(Dir::Up), "bottom" | "down" => Some(Dir::Down), _ => None };
    let place = if to == "screen" {
        let Some(dir) = dir else { return Outcome::refused("an edge of the screen is left, right, top or bottom") };
        Place::Edge { dir }
    } else {
        let Some(target) = app.layout.named(to) else { return Outcome::refused(format!("no tile {to} here: this window has {}", app.layout.names.0.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>().join(", "))) };
        match dir { Some(dir) => Place::Split { target, dir, pair: false, weight: None }, None => Place::Tabs { target, index: None, behind: false } }
    };
    app.reshape(&Op::Move { tile, to: place }, by)
}

fn close(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    app.reshape(&Op::Close { tile: target(app), gone: false }, by)
}

fn focus(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    if !by.is_person() { return Outcome::refused("the person's keys are theirs: an agent never moves them · block.mark gets their attention") }
    let tile = match (app.aimed.clone(), args.text("dir").and_then(Dir::read)) {
        (Some(tile), _) => tile,
        (None, Some(dir)) => match neighbour(&app.layout.rects(app.area, &|_| false), &app.layout.focus, dir) { Some(next) => next, None => return Outcome::refused(format!("there is no tile {} of this one", match dir { Dir::Left => "left", Dir::Right => "right", Dir::Up => "above", Dir::Down => "below" })) },
        (None, None) => return Outcome::refused("tile.focus names a tile (tile=) or a direction (dir=)"),
    };
    app.reshape(&Op::Focus { tile, quiet: false }, by)
}

fn dock(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    // `on` here is "in a dock"; the layout's pin says the other way round (pinned in the layout).
    app.reshape(&Op::Pin { tile: target(app), on: args.flag("on").map(|on| !on), edge: args.text("edge").and_then(Dir::read), container: None }, by)
}
