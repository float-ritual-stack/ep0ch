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

static TEAR: ActionRow = ActionRow::new("tile.tear", Touches::Shape, "take a tile (tile=, else the one with the keys) out of this window into a window of its own: the same tile on the same outline, showing what it showed, over the same store. Whether it may leave is the layout's to say, as for a tile closed: one a block is being written in stays, and so does the only one a window has")
    .keys(&[KeyRow::keys("mod+shift+t", "this tile, in a window of its own")])
    .menu(&[MenuRow::new("Tear out", "Tile", Some("mod+shift+t"))])
    .examples(&[Example { act: "tile.tear tile=reader", does: "the reader, in a window of its own", safe: None }]);

static CLOSE: ActionRow = ActionRow::new("window.close", Touches::Screen, "close this window, as its own close button does: a tile a block is being written in keeps it open, and says so. A window torn from another goes alone; the run ends with its last one")
    .person("a window is the person's to close")
    .keys(&[KeyRow::via("the window's own close button does the same")])
    .menu(&[MenuRow::new("Close window", "Window", None)]);

pub static ACTIONS: &[Action] = &[Action { row: &TEAR, run: tear, about: About::Any }, Action { row: &CLOSE, run: close, about: About::Nothing }];

impl App {
    /// A window of its own for one tile of this one: the same outline over the same store, laid out as that tile
    /// alone, showing what it showed here. What is written in it is kept in a file of its own beside this window's.
    fn beside(&self, window: &str, alone: &serde_json::Value, shown: super::TileUi, ways: Option<Ways>) -> App {
        let mut app = App::new_on(self.store.beside(window), &self.at);
        app.st.machine = self.machine.clone();
        app.st.online = self.online;
        app.st.blocking = self.blocking;
        app.arrangement_put(Layout::read(alone));
        app.st.screen = Screen { name: window.to_string(), title: window.to_string(), from: From::Torn, spec: None, problems: Vec::new() };
        if let Some(tile) = app.layout.all().first().cloned() { app.st.tiles.insert(tile, shown); }
        app.ways = ways;
        app.recovery = self.kept_in.as_ref().and_then(|path| own_drafts(path, window));
        app.start();
        app
    }
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

fn close(app: &mut App, _: &Args, _: &Actor) -> Outcome {
    // A tile that holds an edit stays, in the layout's own words for it.
    if let Some(why) = app.layout.all().iter().find_map(|tile| app.holds_edit(tile)) { return Outcome::refused(why) }
    app.st.closing = true;
    Outcome::done()
}
