//! Windows: a tile torn out of this window into one of its own, and a window put away. Every window of a run is an
//! `App` of its own (its arrangement, its keys, its bar, the blocks written in it) over the one store: the same
//! links, the same answers, the same 64 watches a link. The shell opens the window an act asks for
//! (`App::born`); nothing here names a renderer.
use serde_json::json;

use super::app::Ways;
use super::row::{ActionRow, Example, KeyRow, MenuRow, Touches};
use super::{About, Action, Actor, App, Notice, Outcome};
use crate::actline::Args;
use crate::draft::Recovery;
use crate::layout::Layout;
use crate::screen::{From, Screen};

pub(super) static TEAR: ActionRow = ActionRow::new("tile.tear", Touches::Shape, "take a tile (tile=, else the one with the keys) out of this window into a window of its own: the same tile on the same outline, showing what it showed, over the same store. Whether it may leave is the layout's to say, as for a tile closed: one a block is being written in stays, and so does the only one a window has")
    .keys(&[KeyRow::keys("mod+shift+t", "this tile, in a window of its own")])
    .menu(&[MenuRow::new("Tear out", "Tile", Some("mod+shift+t"))])
    .examples(&[Example { act: "tile.tear tile=reader", does: "the reader, in a window of its own", safe: None }]);

static CLOSE: ActionRow = ActionRow::new("window.close", Touches::Screen, "close this window, as its own close button does: a tile a block is being written in keeps it open, and says so. A window torn from another goes alone; the run ends with its last one")
    .person("a window is the person's to close")
    .keys(&[KeyRow::via("the window's own close button does the same")])
    .menu(&[MenuRow::new("Close window", "Window", None)]);

pub(super) static RETURN: ActionRow = ActionRow::new("tile.return", Touches::Shape, "in a window torn from another: put its tile back into the window it came from (the run's first window, else the oldest other one), showing what it shows here, and close this window. It lands along that window's right edge, where its layout takes a new tile, with the keys; a layout that takes none (a locked one) leaves the tile in a window of its own, and says so there. A tile a block is being written in stays until that is saved or closed")
    .keys(&[KeyRow::via("the title of a torn window's tile dragged out of its window, or the put-back on that title")])
    .menu(&[MenuRow::new("Put back", "Tile", None)])
    .examples(&[Example { act: "tile.return", does: "the torn window's tile is a tile of the first window again", safe: None }]);

pub static ACTIONS: &[Action] = &[Action { row: &TEAR, run: tear, about: About::Any }, Action { row: &RETURN, run: put_back, about: About::Any }, Action { row: &CLOSE, run: close, about: About::Nothing }];

impl App {
    /// A window of its own for one tile of this one: the same outline over the same store, laid out as that tile
    /// alone, showing what it showed here. What is written in it is kept in a file of its own beside this window's.
    fn beside(&self, window: &str, alone: &serde_json::Value, shown: super::TileUi, ways: Option<Ways>) -> App {
        let mut app = App::new_on(self.store.beside(window), &self.at);
        app.st.machine = self.machine.clone();
        app.st.online = self.online;
        app.st.blocking = self.blocking;
        app.st.native_menus = self.native_menus;
        app.arrangement_put(Layout::read(alone));
        app.st.screen = Screen { name: window.to_string(), title: window.to_string(), from: From::Torn, spec: None, problems: Vec::new() };
        if let Some(tile) = app.layout.all().first().cloned() { app.st.tiles.insert(tile, shown); }
        app.ways = ways;
        app.recovery = self.kept_in.as_ref().and_then(|path| own_drafts(path, window));
        app.start();
        app
    }
}

impl App {
    /// This window was torn from another: its tile can go back.
    pub fn torn(&self) -> bool { matches!(self.screen.from, From::Torn) }
    /// The action a tile let go outside this window runs: back to the window it was torn from, else into a window
    /// of its own. One answer for the act and for what the hold says of it.
    pub fn leaves_by(&self) -> &'static ActionRow { if self.torn() { &RETURN } else { &TEAR } }
}

/// A tile handed over by another window of the run lands here: a tile of this arrangement along its right edge, by
/// the layout's own rule for a new tile, showing what it showed there, with the keys. A layout that takes none
/// keeps nothing from being lost: the tile is given a window of its own again, and this window says why.
pub(super) fn arrived(app: &mut App, leaf: &serde_json::Value, ui: super::TileUi, from: &str, by: &Actor) {
    // The saved tile is read by the layout's own reader, as a tile torn out is: its kind and fields, and what the
    // layout keeps of it beside them (what agents may do to it).
    let alone = Layout::read(&json!({ "root": leaf }));
    let Some(read) = alone.all().first().and_then(|id| alone.spec(id).map(|spec| (id.clone(), spec.clone()))) else { return };
    let (kind, wanted, level) = (read.1.kind.clone(), alone.name(&read.0), alone.agents.get(&read.0).cloned());
    // Its name is its own while no tile here has it.
    let name = if app.layout.named(&wanted).is_none() { wanted.clone() } else { app.layout.auto_name(&kind, &[]) };
    let spec = crate::layout::TileSpec { id: name.clone(), ..read.1 };
    let landed = app.reshape(&crate::layout::Op::Open { tile: spec, name: Some(name.clone()), loose: true, alt: false, deliberate: None, at: crate::layout::At::Edge { dir: crate::layout::Dir::Right }, keys: true, link: None, verb: None, select_from: Vec::new() }, by);
    if landed.ok {
        // (A tile made here is named, and its name is its id.)
        app.st.tiles.insert(name.clone(), ui);
        if level.is_some() { app.reshape(&crate::layout::Op::Agents { tile: name.clone(), level }, by); }
        app.keep();
        app.st.notice = Some(Notice::info(format!("{name} is back from its own window ({from}).")));
        app.pump();
        return;
    }
    // Refused: nothing is lost. It is in a window of its own again, as it was.
    let alone = json!({ "focus": wanted, "root": leaf });
    let taken = app.store.windows();
    let window = std::iter::once(from.to_string()).chain((2..).map(|n| format!("{from}-{n}"))).find(|candidate| !taken.contains(candidate)).unwrap_or_else(|| from.to_string());
    let born = app.beside(&window, &alone, ui, app.ways.clone());
    app.born.push(born);
    app.st.notice = Some(Notice::problem(format!("{wanted} stays in a window of its own: {}", landed.said)));
}

/// Where a window that keeps no arrangement keeps what is written in it: a file of its own beside the outline's
/// arrangement (`native-<outline>.layout.json` → `native-<outline>.<window>.drafts.json`), read back by the next
/// run's first window on that outline. A window torn from another, on the outline it was torn on and on any it
/// switches to.
pub(super) fn own_drafts(arrangement: &std::path::Path, window: &str) -> Option<Recovery> {
    let stem = arrangement.file_name()?.to_str()?.strip_suffix(".layout.json")?;
    Some(Recovery::beside(&arrangement.with_file_name(format!("{stem}.{window}.layout.json"))))
}

fn tear(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let tile = app.about().unwrap_or_else(|| app.layout.focus.clone());
    let name = app.layout.name(&tile);
    let Some(alone) = app.layout.alone(&tile) else { return Outcome::refused(format!("no tile {name}")) };
    let shown = app.ui(&tile).clone();
    // It leaves this window by the layout's own rule for a tile closed (one a block is being written in stays). A
    // terminal's program goes with it: the close ends nothing.
    let closed = app.close_keeping(tile, by);
    if !closed.ok { return closed }
    // The window is called what the tile is, with a number when a window by that name is open.
    let taken = app.store.windows();
    let window = std::iter::once(name.clone()).chain((2..).map(|n| format!("{name}-{n}"))).find(|candidate| !taken.contains(candidate)).unwrap_or_else(|| name.clone());
    let born = app.beside(&window, &alone, shown, app.ways.clone());
    app.born.push(born);
    app.st.notice = Some(Notice::info(format!("{name} is in a window of its own ({window}).")));
    Outcome::answer(json!({ "window": window, "tile": name }))
}

fn put_back(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    if !app.torn() { return Outcome::refused(crate::actions::says(&crate::layout::Refusal::new("this window was torn from no other: its tiles are its own").way(crate::layout::Way::new(TEAR.id, "takes a tile into a window of its own")), by)) }
    let tile = app.about().unwrap_or_else(|| app.layout.focus.clone());
    let name = app.layout.name(&tile);
    // A tile that holds an edit stays, in the layout's own words for it.
    if let Some(why) = app.holds_edit(&tile) { return Outcome::refused(why) }
    let Some(leaf) = app.layout.alone(&tile).map(|alone| alone["root"].clone()) else { return Outcome::refused(format!("no tile {name}")) };
    let Some(to) = app.store.other_window() else { return Outcome::refused("no other window is open to take it back") };
    if !app.store.hand(&to, leaf, app.ui(&tile).clone(), by) { return Outcome::refused(format!("the window {to} is gone")) }
    // The window goes with its tile; a program in it runs on (a window that goes ends nothing its host keeps).
    app.st.closing = true;
    Outcome::answer(json!({ "tile": name, "window": to }))
}

fn close(app: &mut App, _: &Args, _: &Actor) -> Outcome {
    // A tile that holds an edit stays, in the layout's own words for it.
    if let Some(why) = app.layout.all().iter().find_map(|tile| app.holds_edit(tile)) { return Outcome::refused(why) }
    app.st.closing = true;
    Outcome::done()
}
