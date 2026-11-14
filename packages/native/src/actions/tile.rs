//! A tile's own actions: split it, move it, close it, give it the keys, put it in a dock. Each is one operation
//! handed to the layout (`reshape`), whose rules say yes or why not: nothing here decides.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Outcome, About};
use crate::actline::Args;
use crate::layout::tree::neighbour;
use crate::layout::{At, Dir, Op, TileSpec};

static SPLIT: ActionRow = ActionRow::new("tile.split", Touches::Shape, "a new tile beside this one (tile=, else the one with the keys): on its right unless dir= says another side. A reader's split shows the same note; kind= makes another kind")
    .args(&[
        ("dir", ArgSpec::text("the side the new tile goes on (default right)").optional().choices(&["right", "down", "left", "up"])),
        ("kind", ArgSpec::text("the new tile's kind (default this tile's when it reads notes, else reader)").optional().kind("tile-kind")),
        ("name", ArgSpec::text("the new tile's name (default its kind, numbered)").optional()),
    ])
    .keys(&[KeyRow::keys("mod+d", "split this tile: a new one on its right"), KeyRow::with("mod+shift+d", None, "split this tile: a new one below", &[("dir", Scalar::Text("down"))])])
    .menu(&[MenuRow::new("Split", "Tile", Some("mod+d")), MenuRow::with("Split below", "Tile", Some("mod+shift+d"), &[("dir", Scalar::Text("down"))])])
    .examples(&[Example { act: "tile.split dir=down tile=reader", does: "a second reader under the first, on the same note", safe: None }]);

static CLOSE: ActionRow = ActionRow::new("tile.close", Touches::Shape, "close a tile (tile=, else the one with the keys). One that holds unsaved text stays, and says so")
    .keys(&[KeyRow::keys("mod+w", "close this tile"), KeyRow::via("a press on the cross in a tile's title")])
    .menu(&[MenuRow::new("Close", "Tile", Some("mod+w"))])
    .examples(&[Example { act: "tile.close tile=reader2", does: "closes the second reader", safe: None }]);

pub(super) static FOCUS: ActionRow = ActionRow::new("tile.focus", Touches::Screen, "give a tile the keys: tile= by name, dir= the next one that way from the tile that has them, or by= stops on in reading order (negative: back; round the ends: each tile shown is a stop, a board's lanes one stop and a dock one, then the floats). The person's: an agent never moves their keys")
    .person("the person's keys are theirs: an agent never moves them · a comment on the note gets their attention (comment body=…)")
    .args(&[
        ("dir", ArgSpec::text("the next tile that way").optional().choices(&["left", "right", "up", "down"])),
        ("by", ArgSpec::number("stops on, in reading order (negative: back)").optional()),
    ])
    .keys(&[
        KeyRow::with("tab", Some("tile"), "the keys to the next tile", &[("by", Scalar::Whole(1))]),
        KeyRow::with("shift+tab", Some("tile"), "the keys to the tile before", &[("by", Scalar::Whole(-1))]),

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

static COLLAPSE: ActionRow = ActionRow::new("tile.collapse", Touches::Shape, "fold a tile (tile=, else the one with the keys) to a spine (on=true): a strip with its title where it stood, what it holds kept as it is; on=false opens it again; left out, the other way. dir=v is a spine down a row of tiles, dir=h one across a column of them; left out, the way its split runs. Only a tile beside others folds, and only where its container lets tiles fold")
    .args(&[
        ("on", ArgSpec::flag("true folds it, false opens it; left out, the other way").optional()),
        ("dir", ArgSpec::text("v: a spine down a row of tiles; h: one across a column of them (default: the way its split runs)").optional().choices(&["v", "h"])),
    ])
    .keys(&[
        KeyRow::keys("mod+shift+c", "fold this tile to a spine, or open it again"),
        KeyRow::with("minus", Some("tile"), "fold this tile to a spine", &[("on", Scalar::Flag(true))]),
        KeyRow::with("plus equal", Some("tile"), "open this tile from its spine", &[("on", Scalar::Flag(false))]),
        KeyRow::via("the fold on a tile's title; a press on a spine opens it"),
    ])
    .menu(&[MenuRow::new("Fold to a spine", "Tile", Some("mod+shift+c"))])
    .examples(&[Example { act: "tile.collapse on=true tile=tree", does: "folds the tree to a spine, keeping what is in it", safe: None }]);

static ZOOM: ActionRow = ActionRow::new("tile.zoom", Touches::Shape, "zoom a tile (tile=, else the one with the keys) to fill the window (on=true), or put it back in its place (on=false); left out, the other way. Nothing of the arrangement changes under it")
    .args(&[("on", ArgSpec::flag("true zooms, false unzooms; left out, the other way").optional())])
    .keys(&[KeyRow::keys("mod+shift+enter", "zoom this tile to the whole window, or back"), KeyRow::with("escape q", Some("zoomed"), "put the zoomed tile back in its place", &[("on", Scalar::Flag(false))])])
    .menu(&[MenuRow::new("Zoom", "Tile", Some("mod+shift+enter"))])
    .examples(&[Example { act: "tile.zoom tile=reader", does: "fills the window with the reader, or puts it back when it is zoomed", safe: None }]);

static FLOAT: ActionRow = ActionRow::new("tile.float", Touches::Shape, "pop a tile (tile=, else the one with the keys) out of the layout as a float over the others (on=true), or put a float back in the layout where the containers take it (on=false); left out, the other way. A tile already that way is left as it is")
    .args(&[("on", ArgSpec::flag("true floats it, false puts it back; left out, the other way").optional())])
    .keys(&[KeyRow::keys("mod+shift+o", "pop this tile out as a float, or put it back"), KeyRow::via("the float on a tile's title; on a float, the same press puts it back")])
    .menu(&[MenuRow::new("Float", "Tile", Some("mod+shift+o"))])
    .examples(&[Example { act: "tile.float on=true tile=backlinks", does: "pops the backlinks out as a float over the other tiles", safe: None }, Example { act: "tile.float on=false tile=backlinks", does: "puts a floating backlinks tile back in the layout", safe: None }]);

pub(super) static PLACE: ActionRow = ActionRow::new("float.place", Touches::Shape, "move or size a float (tile=: a tile popped out over the others, tile.float): dx dy step it (columns, rows), col row put its corner there, cols rows size it. Never smaller than a float is drawn, never off the window")
    .args(&[
        ("dx", ArgSpec::number("columns to move right (negative: left)").optional()), ("dy", ArgSpec::number("rows to move down (negative: up)").optional()),
        ("col", ArgSpec::number("its left column").optional()), ("row", ArgSpec::number("its top row").optional()),
        ("cols", ArgSpec::number("its width").optional()), ("rows", ArgSpec::number("its height").optional()),
    ])
    .keys(&[KeyRow::via("a float's title dragged: it follows the pointer, and let go on a tile's title, an edge of the window or a shut dock's strip it lands there (layout.move)")])
    .examples(&[Example { act: "float.place dx=4 dy=-2 tile=backlinks", does: "moves the floating backlinks four columns right and two rows up", safe: None }]);

static AGENT: ActionRow = ActionRow::new("tile.agent", Touches::Shape, "what an agent may do to a tile (tile=, else the one with the keys): policy=free (open notes in it, split, close and move it: the default), edit (write on the note it shows; no closing or moving it) or off (read it; nothing else); inherit takes the tile's own level away, so its container's and the screen's say again. Kept with the arrangement. An agent may tighten a tile, never loosen one")
    .args(&[("policy", ArgSpec::text("free, edit, off, or inherit").choices(&["free", "edit", "off", "inherit"]))])
    .keys(&[KeyRow::via("its row in the command bar, with the level typed (tile.agent policy=edit)")])
    .examples(&[Example { act: "tile.agent policy=edit tile=reader", does: "lets agents write on the reader's note but not close or move the tile", safe: None }]);

static TAB: ActionRow = ActionRow::new("tab.select", Touches::Shape, "bring another tab of a tab set to the front (tile=: a tile of the set, else the one with the keys): by= tabs on (negative: back), round the ends. The tab brought forward takes the keys when its set had them")
    .args(&[("by", ArgSpec::number("tabs on (negative: back; default 1)").optional())])
    .keys(&[
        KeyRow::with("alt+n", Some("tile"), "the next tab of this set", &[("by", Scalar::Whole(1))]),
        KeyRow::with("alt+p", Some("tile"), "the tab before", &[("by", Scalar::Whole(-1))]),
        KeyRow::via("a press on a tab"),
    ])
    .examples(&[Example { act: "tab.select by=1 tile=reader", does: "brings the tab after the reader's to the front of its set", safe: None }]);

static HOME: ActionRow = ActionRow::new("keys.home", Touches::Screen, "the last step back: give the keys to the screen's home tile when they are on another, and say there is nothing left to close when they are home. The person's: an agent never moves their keys")
    .person("the person's keys are theirs: an agent never moves them · a comment on the note gets their attention (comment body=…)")
    .keys(&[KeyRow::on("escape q", "tile", "step back: the keys to the screen's home tile")]);

static STOP: ActionRow = ActionRow::new("keys.stop", Touches::Screen, "give the keys to the tile whose title says that number: n= its place among the stops the keys go round (tile.focus by=), from 1. The person's: an agent never moves their keys")
    .person("the person's keys are theirs: an agent never moves them · a comment on the note gets their attention (comment body=…)")
    .args(&[("n", ArgSpec::number("the stop's number, from 1, as its tile's title says it"))])
    .keys(&[
        KeyRow::with("1", Some("tile"), "the keys to tile 1", &[("n", Scalar::Whole(1))]),
        KeyRow::with("2", Some("tile"), "the keys to tile 2", &[("n", Scalar::Whole(2))]),
        KeyRow::with("3", Some("tile"), "the keys to tile 3", &[("n", Scalar::Whole(3))]),
        KeyRow::with("4", Some("tile"), "the keys to tile 4", &[("n", Scalar::Whole(4))]),
        KeyRow::with("5", Some("tile"), "the keys to tile 5", &[("n", Scalar::Whole(5))]),
        KeyRow::with("6", Some("tile"), "the keys to tile 6", &[("n", Scalar::Whole(6))]),
        KeyRow::with("7", Some("tile"), "the keys to tile 7", &[("n", Scalar::Whole(7))]),
        KeyRow::with("8", Some("tile"), "the keys to tile 8", &[("n", Scalar::Whole(8))]),
        KeyRow::with("9", Some("tile"), "the keys to tile 9", &[("n", Scalar::Whole(9))]),
    ])
    .examples(&[Example { act: "keys.stop n=2", does: "the keys go to the second tile, in reading order", safe: Some(true) }]);

pub static ACTIONS: &[Action] = &[
    Action { row: &TAB, run: tab, about: About::Any }, Action { row: &HOME, run: home, about: About::Nothing }, Action { row: &STOP, run: stop, about: About::Nothing },
    Action { row: &SPLIT, run: split, about: About::Any }, Action { row: &CLOSE, run: close, about: About::Any }, Action { row: &FOCUS, run: focus, about: About::Any }, Action { row: &DOCK, run: dock, about: About::Any },
    Action { row: &COLLAPSE, run: collapse, about: About::Any }, Action { row: &ZOOM, run: zoom, about: About::Any }, Action { row: &FLOAT, run: float, about: About::Any }, Action { row: &PLACE, run: place_float, about: About::Any }, Action { row: &AGENT, run: agent, about: About::Any },
];

/// The tile an act is about: the one the dispatcher found for it (aimed at, else the one with the keys).
fn target(app: &App) -> String { app.about().unwrap_or_else(|| app.layout.focus.clone()) }

fn split(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let from = target(app);
    let own = app.spec(&from).map(|spec| spec.kind.clone()).unwrap_or_default();
    // The new tile's kind: the one named, as the service's rows know it; else this tile's when it reads notes, else
    // the kind that does.
    let reads = |kind: &str| app.kind_row(kind).and_then(crate::tiles::drawer_of).is_some_and(|drawer| drawer.notes);
    let kind = match args.text("kind") {
        Some(asked) => match app.kind_row(asked) { Some(row) => row.written().to_string(), None => return Outcome::refused(format!("no tile kind {asked} here · the kinds: {}", app.kinds().iter().map(|row| row.written()).collect::<Vec<_>>().join(", "))) },
        None if reads(&own) => app.kind_row(&own).map_or(own.clone(), |row| row.written().to_string()),
        None => match app.note_kind() { Some(row) => row.written().to_string(), None => return Outcome::refused("no tile kind here reads notes: name one with kind=") },
    };
    // The same kind, by whichever of its names each tile carries.
    let same = app.kind_row(&own).map(|row| &row.kind) == app.kind_row(&kind).map(|row| &row.kind);
    let dir = args.text("dir").and_then(Dir::read).unwrap_or(Dir::Right);
    // A tile made here is named, and its name is its id.
    let name = args.text("name").map(str::to_string).unwrap_or_else(|| app.layout.auto_name(&kind, &[]));
    let mut spec = TileSpec::new(name.clone(), kind.clone());
    // A split of a tile that is another's has the same home, and follows or holds its subject as that one does.
    if same { for field in ["source", "subject"] { if let Some(value) = app.spec(&from).and_then(|s| s.fields.get(field)).cloned() { spec.fields.insert(field.into(), value); } } }
    let note = app.note_of(&from).filter(|_| reads(&kind) && same);
    let outcome = app.reshape(&Op::Open { tile: spec, name: Some(name.clone()), loose: false, alt: false, deliberate: None, at: At::Split { target: from, dir, pair: false, weight: None }, keys: true, link: None, verb: None, select_from: Vec::new() }, by);
    if outcome.ok && let Some(note) = note { app.show(&name, &note, false); app.keep() }
    outcome
}

fn close(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let tile = target(app);
    // A terminal's program ends with its tile, as the layout's rule says of a close (`terminal.detach` closes one
    // and keeps its program).
    let program = app.ui(&tile).program.clone().filter(|_| app.is_a(&tile, About::Programs));
    // The way back the closed reader kept goes with its note.
    let trail = app.ui(&tile).history.clone();
    // The close that commits asks who keeps the note the tile shows: the layout's answer (`close_heir`, the door's
    // rule by contract), which this only carries out. A reader across an edge is another screen's, and no window
    // here holds one to show it in: the answer says where it would go.
    let closed = app.reshape(&Op::Close { tile, gone: false, heir: true }, by);
    let heir = closed.answer["heir"].as_str().and_then(|name| app.layout.named(name));
    if let (true, Some(heir), Some(note)) = (closed.ok, heir, closed.answer["note"].as_str().map(str::to_string)) {
        app.show(&heir, &note, false);
        app.ui_mut(&heir).history = trail;
        app.keep();
    }
    if closed.ok && let Some(key) = program { app.program_closed(&key) }
    closed
}

fn focus(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    // Stops on in reading order (`App::tab_stops`: the layout's tiles as the one rule groups them), round the ends.
    if app.aimed.is_none() && let Some(by_stops) = args.number("by") {
        let Some(tile) = crate::cursor::next_stop(&app.tab_stops(), &app.layout.focus, by_stops as i64) else { return Outcome::refused("no tile is shown to give the keys to") };
        return app.reshape(&Op::Focus { tile, quiet: false }, by);
    }
    let tile = match (app.aimed.clone(), args.text("dir").and_then(Dir::read)) {
        (Some(tile), _) => tile,
        (None, Some(dir)) => match neighbour(&app.layout.rects(app.area, &|_| false), &app.layout.focus, dir) { Some(next) => next, None => return Outcome::refused(format!("there is no tile {} of this one", match dir { Dir::Left => "left", Dir::Right => "right", Dir::Up => "above", Dir::Down => "below" })) },
        (None, None) => return Outcome::refused("tile.focus names a tile (tile=), a direction (dir=) or stops on (by=)"),
    };
    app.reshape(&Op::Focus { tile, quiet: false }, by)
}

fn tab(app: &mut App, args: &Args, by: &Actor) -> Outcome { app.reshape(&Op::Tab { tile: target(app), by: Some(args.number("by").map_or(1, |by| by as i64)) }, by) }

/// The last step back (the door's keys-home): the keys go to the screen's home tile, as the layout is told it
/// (`App::home`); home already, or with no home said, there is nothing left to close, and that is said.
fn home(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    match app.home().filter(|home| *home != app.layout.focus && app.shown_tiles().contains(home)) {
        Some(tile) => app.reshape(&Op::Focus { tile, quiet: false }, by),
        None => { let said = "Nothing left to close here."; app.st.notice = Some(super::Notice::info(said)); Outcome { said: said.into(), ..Outcome::done() } }
    }
}

/// The keys to a stop by its number: the place the tile's title says, among the stops Tab goes round.
fn stop(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let (stops, n) = (app.tab_stops(), args.number("n").map_or(1, |n| n.max(1.0) as usize));
    match stops.get(n - 1).cloned() { Some(tile) => app.reshape(&Op::Focus { tile, quiet: false }, by), None => Outcome::refused(format!("there is no tile {n} here: {} are shown", stops.len())) }
}

fn dock(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    // `on` here is "in a dock"; the layout's pin says the other way round (pinned in the layout).
    app.reshape(&Op::Pin { tile: target(app), on: args.flag("on").map(|on| !on), edge: args.text("edge").and_then(Dir::read), container: None }, by)
}

fn collapse(app: &mut App, args: &Args, by: &Actor) -> Outcome { app.reshape(&Op::Collapse { tile: target(app), on: args.flag("on"), dir: args.text("dir").map(str::to_string) }, by) }

fn zoom(app: &mut App, args: &Args, by: &Actor) -> Outcome { app.reshape(&Op::Zoom { tile: target(app), on: args.flag("on"), reach: None }, by) }

fn float(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let tile = target(app);
    // A tile already that way is left as it is: the operation itself is "the other way".
    if args.flag("on") == Some(app.layout.is_float(&tile)) { return Outcome::answer(serde_json::json!({ "tile": app.layout.name(&tile), "float": app.layout.is_float(&tile), "changed": false })) }
    app.reshape(&Op::Float { tile, at: None }, by)
}

fn place_float(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    app.reshape(&Op::Nudge { tile: Some(target(app)), dx: args.number("dx"), dy: args.number("dy"), col: args.number("col"), row: args.number("row"), cols: args.number("cols"), rows: args.number("rows") }, by)
}

fn agent(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    app.reshape(&Op::Agents { tile: target(app), level: args.text("policy").filter(|level| *level != "inherit").map(str::to_string) }, by)
}
