//! A tile's menu: everything there is to do with a tile, and with what the pointer was on in it, as rows.
//!
//! - **The rows are the actions' own.** Each is a `menu` row of an action that acts in a tile of this one's sort
//!   (its label, its group, the arguments it runs with), and before them what the pointer was on says of itself: a
//!   list's row its own act and its own presses (the service's lines, as a pick runs them), a link the action that
//!   follows it, words picked the actions the key table offers for them. Nothing is worded here.
//! - **One model, drawn by what the platform has.** Where the window has menus of the platform's own (macOS,
//!   Windows: Rune's `Tx::popup_menu`) the rows are that menu, at the pointer; everywhere, and whenever it is asked
//!   with words to filter by, they are a source of the bar (typed into, filtered, picked by key). `keys::effects`
//!   opens the first; `bar.rs` lists the second. Both run a picked row through `App::menu_run`.
//! - **An agent's `tile.menu` draws nothing**: it is answered the rows as data, each with why it would be refused.
use serde_json::{Value, json};

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{About, Action, Actor, App, Outcome, rule, tile, word};
use crate::actline::{self, Args};
use crate::layout::Id;
use crate::page::ListRow;

static MENU: ActionRow = ActionRow::new("tile.menu", Touches::Nothing, "a tile's menu (tile=, else the one with the keys): everything there is to do with it, each row an action's own menu row, and first what the pointer was on there (a list's row, a link, the words picked). The person's opens it, at at= when a right-click says where, and gives the tile the keys; q= opens it as a list to type in, with those words typed. An agent's opens nothing: it is answered the rows, each with the act it runs and why it would be refused")
    .args(&[
        ("at", ArgSpec::text("col,row: the cell of the window (from 0, a fraction is a place inside one) the person's menu opens at; default under the tile's title").optional()),
        ("q", ArgSpec::text("only the rows that match these words, by label, group and act line; the person's menu opens as a list with them typed").optional()),
    ])
    .keys(&[KeyRow::keys("mod+.", "this tile's menu"), KeyRow::via("a right-click in a tile; the three dots on its title")])
    .menu(&[MenuRow::new("Menu", "Tile", Some("mod+."))])
    .examples(&[Example { act: "tile.menu tile=reader", does: "answers an agent the reader's menu rows; opens the menu under the reader's title for the person", safe: Some(true) }]);

static POINT: ActionRow = ActionRow::new("tile.point", Touches::Nothing, "say what in a tile (tile=, else the one with the keys) the pointer is on, for the menu a right-click opens next: a list's row (row=, by the row's id) or a link in a note's prose (link=). With neither, nothing. The person's: an agent names what it acts on in the act itself")
    .person("what the pointer is on is the person's: an agent's tile.menu answers a tile's rows, and it runs a row's own act line itself")
    .args(&[
        ("row", ArgSpec::text("the row of the tile's list the pointer is on, by its id").optional()),
        ("link", ArgSpec::text("the link the pointer is on, as the page carries it").optional()),
    ])
    .keys(&[KeyRow::via("a right-click on a row of a list or on a link in a note")])
    .examples(&[Example { act: "tile.point row=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 tile=tree", does: "the tree's next menu is about that row first", safe: Some(true) }]);

static COPY: ActionRow = ActionRow::new("note.copy-ref", Touches::Nothing, "copy the address of the note a reader shows (tile=, else the reader an act about the open note means), or of ref=: kind=id its full id, kind=link its web link as the service says it (notes.address). The person's copy goes to the clipboard and the notice says what was copied; an agent's is answered and the clipboard is left alone")
    .args(&[
        ("kind", ArgSpec::text("id (default): the full id; link: the web link").optional().choices(&["id", "link"])),
        ("ref", ArgSpec::text("the note's block id; default the note the tile shows").optional().kind("note")),
    ])
    .keys(&[KeyRow::with("mod+shift+y", None, "copy the open note's id", &[("kind", Scalar::Text("id"))]), KeyRow::via("the Copy rows of a tile's menu")])
    .menu(&[MenuRow::with("Copy note id", "Copy", Some("mod+shift+y"), &[("kind", Scalar::Text("id"))]), MenuRow::with("Copy note web link", "Copy", None, &[("kind", Scalar::Text("link"))])])
    .examples(&[Example { act: "note.copy-ref kind=link", does: "copies the open note's web link", safe: Some(true) }]);

static GLANCE: ActionRow = ActionRow::new("glance", Touches::Nothing, "show the note a row of a list (tile=, row= by the row's id) opens, in a card beside the row, without opening it: its title and how it starts, as the service answers its page. With no row=, the card is put away. The person's: it follows their pointer, resting on a row")
    .person("the card follows the person's pointer: an agent reads a note from the service itself, and opens one here with open id=…")
    .args(&[("row", ArgSpec::text("the row whose note to show, by its id; left out, the card is put away").optional())])
    .keys(&[KeyRow::via("the pointer resting on a row of a list tile; it goes when the pointer leaves the row")])
    .examples(&[Example { act: "glance row=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 tile=tree", does: "shows that note in a card beside its row of the tree", safe: Some(true) }]);

pub static ACTIONS: &[Action] = &[Action { row: &MENU, run: menu, about: About::Any }, Action { row: &POINT, run: point, about: About::Any }, Action { row: &COPY, run: copy, about: About::Notes }, Action { row: &GLANCE, run: glance, about: About::Lists }];

/// The row whose note is shown in a card beside it: which list tile, and which of its rows.
#[derive(Clone, Debug, PartialEq)]
pub struct Glance { pub tile: Id, pub row: String }

/// What the pointer was on in a tile when its menu was asked for.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Pointed { pub row: Option<String>, pub link: Option<String> }

/// One row of a tile's menu: the act line it runs from its tile, and what it shows.
#[derive(Clone, Debug, PartialEq)]
pub struct MenuItem {
    pub line: String,
    pub label: String,
    pub group: String,
    pub keycap: Option<String>,
    /// Why whoever asked can't run it now.
    pub refused: Option<String>,
}

impl MenuItem {
    fn json(&self) -> Value { json!({ "label": self.label, "group": self.group, "key": self.keycap, "act": self.line, "refused": self.refused }) }
}

/// The menu the person has open: its tile, what the pointer was on, and where it opens.
#[derive(Clone, Debug, PartialEq)]
pub struct Menu {
    pub tile: Id,
    pub on: Pointed,
    /// Where in the window, in points, when a right-click said. None: under the tile's title.
    pub at: Option<(f32, f32)>,
    /// The platform's own menu is still to be opened for it (`keys::effects` takes this once).
    pub(in crate::actions) unshown: bool,
}

/// What the row under the pointer is called as a group, a link, and words picked: the three things a menu is about
/// before its tile. (The rest of a menu's groups are the action rows' own.)
const ROW: &str = "Row";
const LINK: &str = "Link";
const PICKED: &str = "Selection";

impl App {
    /// A tile's menu as rows, for `by`: what the pointer was on first (`on`), then every action's menu rows that
    /// can run as they are in a tile of this sort, under the groups the rows name, in the order the actions list them.
    pub fn menu_rows(&self, tile: &str, on: &Pointed, by: &Actor) -> Vec<MenuItem> {
        let (name, person, stands) = (self.layout.name(tile), self.person(), self.stands(by));
        let item = |line: String, label: Option<String>, group: &str| {
            let action = actline::parse(&line).ok().and_then(|req| super::find(&req.action));
            MenuItem { label: label.unwrap_or_else(|| super::label(&line)), keycap: crate::keys::cap(&line), group: group.to_string(), refused: action.and_then(|action| rule(action.row, by, stands, &person, &name).err()), line }
        };
        let mut items: Vec<MenuItem> = Vec::new();
        // A link: the action that follows one, as its row calls it.
        if let Some(link) = &on.link { items.push(item(format!("{} ref={}", super::nav::FOLLOW.id, word(link)), None, LINK)) }
        // A list's row: what a pick runs and each press of its own, in the service's lines and the service's words.
        if let Some(row) = on.row.as_ref().and_then(|id| self.rows_of(tile).iter().find(|row| row.id == *id)) {
            if let Some(act) = &row.act { items.push(item(act.clone(), None, ROW)) }
            for cell in &row.cells { if let Some(act) = ListRow::cell_act(cell) { items.push(item(act.to_string(), Some(ListRow::cell(cell)), ROW)) } }
        }
        // Words picked in the tile: what the key table offers for them.
        for line in self.offered(tile) { items.push(item(line.to_string(), None, PICKED)) }
        // Every action that acts in a tile of this sort, by its own menu rows: the ones that run as they are.
        let mut groups: Vec<&str> = Vec::new();
        let mut rows: Vec<MenuItem> = Vec::new();
        for action in super::all().filter(|action| !matches!(action.about, About::Nothing | About::Placed) && self.is_a(tile, action.about)) {
            for menu in action.row.menu.iter().filter(|menu| action.row.required().all(|name| menu.args().get(name).is_some())) {
                let line = std::iter::once(action.row.id.to_string()).chain(menu.args().iter().map(|(k, v)| format!("{k}={}", word(&v.word())))).collect::<Vec<_>>().join(" ");
                if items.iter().chain(rows.iter()).any(|item| item.line == line) { continue }
                if !groups.contains(&menu.group) { groups.push(menu.group) }
                rows.push(item(line, Some(menu.label.to_string()), menu.group));
            }
        }
        for group in groups { items.extend(rows.iter().filter(|row| row.group == group).cloned()) }
        items
    }

    /// The open menu's rows, for the person.
    pub fn menu_open(&self) -> Option<(&Menu, Vec<MenuItem>)> { self.menu.as_ref().map(|menu| (menu, self.menu_rows(&menu.tile, &menu.on, &Actor::Person))) }

    /// The menu the platform is to open now, taken once: its rows, and where (a point of the window, else the key of
    /// the tile's title). `keys::effects` is the one caller.
    pub fn menu_to_show(&mut self) -> Option<(Vec<MenuItem>, Result<(f32, f32), String>)> {
        if !self.st.menu.as_ref().is_some_and(|menu| menu.unshown) { return None }
        let (menu, rows) = self.menu_open().map(|(menu, rows)| (menu.clone(), rows))?;
        if let Some(open) = self.st.menu.as_mut() { open.unshown = false }
        Some((rows, menu.at.ok_or_else(|| format!("tile/{}/bar", self.layout.name(&menu.tile)))))
    }

    /// A row of the open menu picked (`n` from 0, among the rows as they were shown), or the menu put away with
    /// nothing picked: the menu closes, and the row's line runs from its tile as the person.
    pub fn menu_picked(&mut self, n: Option<usize>) {
        let Some((menu, rows)) = self.menu_open().map(|(menu, rows)| (menu.clone(), rows)) else { return };
        self.st.menu = None;
        if let Some(row) = n.and_then(|n| rows.get(n)) { self.menu_run(&row.line.clone(), &menu.tile) }
    }

    /// Runs a menu row's line from the tile the menu is of, as the person: about that tile when its action acts in
    /// a tile of its sort, as a press in the tile is (`App::act_in`). The one way a menu's row runs.
    pub fn menu_run(&mut self, line: &str, tile: &str) {
        let from = self.layout.name(tile);
        self.act_in(line, &from, Actor::Person);
    }

    /// The window has menus of the platform's own (Rune's `popup_menu_supported`, said once where the window is
    /// made): a right-click's menu is one of those. Without, and for a menu asked with words, it is the bar's list.
    pub fn with_native_menus(mut self, native: bool) -> App { self.st.native_menus = native; self }
}

impl App {
    /// What a glance at a row asks: the page of the note the row is keyed by, read once (never watched: the card is
    /// gone before the note changes). A row that is no note's is refused by the service, and shows no card.
    pub fn glance_ask(&self) -> Option<crate::store::Ask> { self.glance.as_ref().map(|glance| crate::store::Ask::read(&self.at, "notes.page", json!({ "blockId": glance.row }))) }

    /// The row of `tile` glanced at, with its note's page when the service has answered it.
    pub fn glanced(&self, tile: &str) -> Option<(&str, Option<&crate::page::Page>)> {
        let glance = self.glance.as_ref().filter(|glance| glance.tile == tile)?;
        Some((glance.row.as_str(), self.glance_ask().and_then(|ask| self.store.read::<crate::page::Page>(&ask))))
    }
}

fn glance(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let Some(tile) = app.about() else { return Outcome::refused("there is no list to glance at a row of") };
    app.st.glance = match args.text("row") {
        Some(row) if app.rows_of(&tile).iter().any(|listed| listed.id == row) => Some(Glance { tile, row: row.to_string() }),
        Some(row) => return Outcome::refused(format!("{} lists no row {row}", app.layout.name(&tile))),
        None => None,
    };
    Outcome::done()
}

/// Whether a row matches the words typed, as the bar matches an action's row: every word in its label, its group
/// or its line.
pub fn matches(item: &MenuItem, words: &str) -> bool {
    let hay = format!("{} {} {}", item.label, item.group, item.line).to_lowercase();
    words.to_lowercase().split_whitespace().all(|word| hay.contains(word))
}

fn menu(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let tile = app.about().unwrap_or_else(|| app.layout.focus.clone());
    let name = app.layout.name(&tile);
    let words = args.text("q").unwrap_or("");
    if !app.stands(by) {
        let rows: Vec<MenuItem> = app.menu_rows(&tile, &Pointed::default(), by).into_iter().filter(|item| matches(item, words)).collect();
        return Outcome::answer(json!({ "tile": name, "of": rows.len(), "rows": rows.iter().map(MenuItem::json).collect::<Vec<_>>() }));
    }
    // Where a right-click said: a cell of the window, as the door names a place (a fraction is inside the cell).
    let at = match args.text("at") {
        None => None,
        Some(at) => match at.split_once(',').and_then(|(col, row)| Some((col.trim().parse::<f32>().ok()?, row.trim().parse::<f32>().ok()?))) {
            Some((col, row)) => Some((col * super::CELL.0, row * super::CELL.1)),
            None => return Outcome::refused(format!("at={at} is no place: col,row, the cell of the window from 0 (at=40,12)")),
        },
    };
    // The tile has the keys from here, as after any press in it. What the pointer was on is this menu's alone: a
    // menu asked for by key or from the title is about its tile.
    if tile != app.layout.focus { app.act_request(actline::Request { action: tile::FOCUS.id.to_string(), tile: Some(name.clone()), by: None, args: Default::default() }, Actor::Person); }
    let on = app.ui_mut(&tile).pointed.take().filter(|_| at.is_some()).unwrap_or_default();
    let native = app.native_menus && args.text("q").is_none();
    app.st.menu = Some(Menu { tile, on, at, unshown: native });
    if !native {
        // The bar on the menu's rows: typed into, filtered and picked as any list of the bar's is.
        app.st.bar.open = true;
        app.st.bar.scope = crate::bar::MENU.into();
        app.st.bar.edit = super::draft::focused(words);
        app.st.bar.cursor = 0;
    }
    Outcome::done()
}

fn point(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = app.about().unwrap_or_else(|| app.layout.focus.clone());
    let on = Pointed { row: args.text("row").map(str::to_string), link: args.text("link").map(str::to_string) };
    app.ui_mut(&tile).pointed = Some(on).filter(|on| *on != Pointed::default());
    Outcome::done()
}

/// How the notice names what was copied, a kind.
fn what(kind: &str) -> &'static str { if kind == "link" { "the note's web link" } else { "the note's id" } }

fn copy(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let kind = args.text("kind").unwrap_or("id").to_string();
    let Some(id) = args.text("ref").map(str::to_string).or_else(|| app.about().and_then(|tile| app.note_of(&tile))) else { return Outcome::refused("no note here to copy the address of: open one, or name it with ref=") };
    if kind == "link" {
        // The web link is the service's to say (`notes.address`): the person's lands on their clipboard when it
        // comes; an agent is answered what to ask, and asks the service the same thing itself.
        let ask = json!({ "action": "notes.address", "blockId": id });
        if !app.stands(by) { return Outcome::answer(json!({ "id": id, "kind": kind, "clipboard": false, "ask": ask })) }
        let at = app.at.clone();
        app.store.request(&at, "notes.address", json!({ "blockId": id }), by, addressed, json!({ "id": id }));
        return Outcome::answer(json!({ "id": id, "kind": kind, "asked": ask }));
    }
    delivered(app, by, &id, &kind, id.clone())
}

/// A copy, delivered: the person's to their clipboard (the window's hands write it on the next frame) with a notice
/// that says what it was; an agent's answered, the clipboard untouched.
fn delivered(app: &mut App, by: &Actor, id: &str, kind: &str, text: String) -> Outcome {
    let clipboard = app.stands(by) && by.is_person();
    if clipboard {
        app.st.copying = Some(text.clone());
        app.st.notice = Some(super::Notice::info(format!("Copied {}: {text}", what(kind))));
    }
    Outcome { said: format!("copied {}", what(kind)), ..Outcome::answer(json!({ "id": id, "kind": kind, "text": text, "clipboard": clipboard })) }
}

/// The service said where the note is on the web, or that it is nowhere there.
fn addressed(app: &mut App, reply: crate::store::Reply) {
    let id = reply.ctx["id"].as_str().unwrap_or("").to_string();
    match reply.result.map(|result| result["link"].as_str().map(str::to_string)) {
        Ok(Some(link)) => { delivered(app, &reply.by, &id, "link", link); }
        Ok(None) => app.st.notice = Some(super::Notice::problem("The outline's host gives no web link for this note: nothing serves its notes on the web yet.")),
        Err(refusal) => app.st.notice = Some(super::Notice::problem(refusal.error)),
    }
}
