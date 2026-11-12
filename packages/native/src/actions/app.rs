//! What the window holds.
//!
//! `State` is what was chosen (the arrangement, each tile's own state, the bar's words, what is being typed); what
//! is shown is a function of it and of the store's answers (`note_of`, `list_of`, `shown_of`, `wants`). `App`'s
//! state is private to `actions/`: everything else reads it (`App` derefs to `State`) and changes it by an act line.
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::PathBuf;
use std::ops::Deref;
use std::sync::Arc;

use base64::Engine;
use rune::{Image, ImageCache, TextEdit, Tx};
use serde_json::{Value, json};

use super::{Actor, Step};
use crate::client::{Link, PROTOCOL};
use crate::layout::{self, Id, Layout, Rect, TileSpec};
use crate::page::{ListAnswer, ListRow, Page, Picture};
use crate::screen::{KindRow, Screen, Served};
use crate::store::{Ask, AskKey, Landed, OutlineAt, Reply, Store, Want};
use crate::tiles::{self, TileCx};

/// The note being typed in. `base` is the text the service holds at `revision`: a save names that revision, and the
/// editor has something unsaved exactly when its text differs from `base`.
pub struct Editing {
    /// The tile the draft is on.
    pub tile: Id,
    pub note: String,
    pub revision: u64,
    pub base: String,
}

/// A tile's own state: what it was last told to show. Kept by the tile's id, so it outlives a move or a rename.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TileUi {
    /// A reader's note. None: the outline's first, once the top level has come.
    pub note: Option<String>,
    /// The notes a reader showed before, oldest first: where `back` goes.
    pub history: Vec<String>,
    /// The folders a list has unfolded, when it is a tree.
    pub unfolded: BTreeSet<String>,
    /// The note whose way from the top a tree unfolded when its page first came (once: a folder folded by hand stays folded).
    pub revealed: Option<String>,
    /// What a list's question was narrowed by here, a property and a value each (a facet picked): on top of its spec's.
    pub narrowed: Vec<(String, String)>,
    /// What the person chose for a list here, by the parameter's name (its sort, its group, how it is arranged): over its spec's.
    pub chosen: BTreeMap<String, String>,
    /// What a press in this tile last did, said on the part that was pressed.
    pub said: Option<Said>,
}

/// What a press did, and where it was pressed: the note and the line of the part.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Said {
    pub block: String,
    pub line: u64,
    pub words: String,
    pub ok: bool,
    /// The run it is waiting on, when the service is still running it (its id, what it is called here, who pressed):
    /// its end says the rest.
    pub run: Option<(String, String, Actor)>,
}

static NO_UI: std::sync::LazyLock<TileUi> = std::sync::LazyLock::new(TileUi::default);

/// A window's cell, in points: the layout's rules count in cells, as the door's do.
pub const CELL: (f32, f32) = (8.0, 18.0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone { Info, Problem }

/// What the window says above the note, and the act line that takes it back, when there is one.
#[derive(Clone, Debug, PartialEq)]
pub struct Notice {
    pub tone: Tone,
    pub said: String,
    pub undo: Option<String>,
}

impl Notice {
    pub fn info(said: impl Into<String>) -> Notice { Notice { tone: Tone::Info, said: said.into(), undo: None } }
    pub fn problem(said: impl Into<String>) -> Notice { Notice { tone: Tone::Problem, said: said.into(), undo: None } }
}

/// A picture as the window holds it: asked for, decoded (or decoding, on Rune's worker), or why there is none.
pub enum Shown {
    Asked,
    /// `points`: how many of its pixels make a point (a vector picture is drawn at twice its size, for a dense screen).
    Ready { image: Image, points: f32 },
    Failed(String),
}

/// The widest a picture is drawn, in points: what a vector picture is drawn to fit.
const PICTURE_POINTS: f32 = 760.0;

/// The command bar as it stands: open or not, the source it lists, what is typed, the lit row.
pub struct BarUi {
    pub open: bool,
    pub scope: String,
    pub edit: TextEdit,
    pub cursor: usize,
}

/// A place the person types: the kit's editor writes the text, through `App::field`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Field {
    /// The bar's one line.
    Bar,
    /// The note's source.
    Draft,
}

pub struct State {
    pub at: OutlineAt,
    /// The host's own name for its machine, as its hello said.
    pub machine: String,
    pub online: bool,
    /// A headless render steps a virtual clock: each ask waits for its answer, so a frame shows what it asked for.
    pub blocking: bool,

    /// The arrangement: which tiles, how they sit, which has the keys. Changed only by `layout::apply`.
    pub layout: Layout,
    /// The screen the arrangement is of.
    pub screen: Screen,
    /// Each tile's own state, by its id.
    pub tiles: HashMap<Id, TileUi>,
    /// The screen this window was asked to open on (`--screen`), until the service has listed it.
    pub asked_screen: Option<String>,
    /// The area the layout fills, in cells: the window's, as the shell last measured it.
    pub area: Rect,
    /// The arrangements before each change, oldest first: what `layout.undo` goes back through. A step that opened
    /// another screen holds the screen it left, so undone it is that screen's arrangement again.
    pub journal: Vec<(Layout, Option<Screen>)>,
    /// The tile the act being run is aimed at (`tile=`).
    pub aimed: Option<Id>,
    /// The border being dragged (its split and which border): its moves are one change to go back through.
    pub dragging: Option<(String, usize)>,
    /// The page (its note, and which of its answers) whose pictures are held, a reader.
    pub pictured: HashMap<Id, (String, u64)>,

    /// The editor's text, there whether or not a note is being edited, so a key always has somewhere to land.
    pub editor: TextEdit,
    pub editing: Option<Editing>,

    pub bar: BarUi,
    pub notice: Option<Notice>,
    /// The last act an agent ran, as the status line says it.
    pub agent_said: Option<String>,

    /// The pictures of the pages the readers show, by `Picture::key`: only what they show is kept.
    pub pictures: HashMap<String, Shown>,
    /// Every act, as it was read and how it went.
    pub steps: Vec<Step>,
    /// The note each actor trashed last: what `note.untrash` brings back.
    pub trashed: HashMap<String, String>,
    /// An element to bring into view on the next frame.
    pub reveal: Option<String>,
}

pub struct App {
    pub(in crate::actions) st: State,
    pub(in crate::actions) store: Store,
    /// Makes the link again after it is lost.
    connect: Option<Box<dyn Fn() -> Box<dyn Link>>>,
    images: ImageCache,
    /// The chords of a key sequence pressed so far: the key table's own.
    held: crate::keys::Held,
    /// Where the arrangement is kept between runs. None: nowhere (a test, a headless render).
    pub(in crate::actions) kept_in: Option<PathBuf>,
}

impl Deref for App {
    type Target = State;
    fn deref(&self) -> &State { &self.st }
}

/// The parameters of a list's request this window fills itself: the folders a tree has open, the note a list is
/// about, the question asked. They are the list request's own words (outline-core's `ListsRequest`), never a
/// property's or a kind's.
const OPEN: &str = "open";
const OF: &str = "of";
const QUERY: &str = "query";
/// The list is of: the source it names (`from`), in a tile's fields.
const FROM: &str = "from";

static NO_ROWS: Vec<ListRow> = Vec::new();

/// What a window says while the service lists no screen to open on.
const NO_SCREENS: &str = "This outline has no screens to open: the ones every door ships are an extension's, and the bar's Screens says how to get them.";

impl App {
    pub fn new(link: Box<dyn Link>, outline: &str) -> App {
        let at = OutlineAt { outline: outline.to_string(), machine: String::new() };
        let mut store = Store::new();
        store.link(&at, link);
        App {
            st: State {
                at,
                machine: String::new(),
                online: true,
                blocking: false,
                // No arrangement until the service says which screens there are: this window ships none.
                layout: Layout::default(),
                screen: Screen::nowhere(),
                tiles: HashMap::new(),
                asked_screen: None,
                area: Rect { col: 0.0, row: 0.0, cols: 147.0, rows: 40.0 },
                journal: Vec::new(),
                aimed: None,
                dragging: None,
                pictured: HashMap::new(),
                editor: TextEdit::new(""),
                editing: None,
                bar: BarUi { open: false, scope: "all".into(), edit: TextEdit::new(""), cursor: 0 },
                notice: None,
                agent_said: None,
                pictures: HashMap::new(),
                steps: Vec::new(),
                trashed: HashMap::new(),
                reveal: None,
            },
            store,
            connect: None,
            // Until the window gives its waker, a decoded picture wakes nobody (a test's window is driven by hand).
            images: ImageCache::new(Arc::new(|| {})),
            held: crate::keys::Held::default(),
            kept_in: None,
        }
    }

    /// The arrangement is kept in this file between runs, and read from it now when it is there.
    pub fn arranged_in(mut self, path: PathBuf) -> App {
        self.kept_in = Some(path);
        self.restore();
        self
    }

    pub fn reconnecting(mut self, connect: Box<dyn Fn() -> Box<dyn Link>>) -> App {
        self.connect = Some(connect);
        self
    }

    /// The screen to open on, once the service has listed it (`--screen <name>`).
    pub fn opening_on(mut self, screen: Option<String>) -> App {
        self.st.asked_screen = screen;
        self
    }

    /// A headless render: every ask waits for its answer.
    pub fn blocking(mut self, blocking: bool) -> App {
        self.st.blocking = blocking;
        self.store.blocking = blocking;
        self
    }

    pub fn set_waker(&mut self, waker: rune::Waker) {
        // A picture that finishes decoding wakes the window to draw it.
        self.images = ImageCache::new(waker.clone());
        self.st.pictures.clear();
        self.store.set_waker(waker);
    }

    pub fn store(&self) -> &Store { &self.store }

    // ── what is shown, from what was chosen and what has been answered ──────────────────────────────────────

    /// A note's page, a watched read.
    pub fn page_ask(&self, note: &str) -> Ask { Ask::watched(&self.at, "notes.page", json!({ "blockId": note })) }

    /// The outline's screens and the kinds its extensions serve, a watched read: this window names no kind of its own
    /// and says which drawers it has, and the service says what is wrong.
    pub fn screens_ask(&self) -> Ask { Ask::watched(&self.at, "screens.list", json!({ "kinds": [], "drawers": tiles::drawers() })) }

    /// What a list can be of, as the service's producers say of themselves: read once, asked again when the link is.
    pub fn sources_ask(&self) -> Ask { Ask::read(&self.at, "lists.read", json!({ "from": "sources" })) }

    fn served(&self) -> Option<&Served> { self.store.read::<Served>(&self.screens_ask()) }

    // ── kinds: what a tile's kind is, from the service's rows ───────────────────────────────────────────────

    /// The tile kinds there are, as the service lists them.
    pub fn kinds(&self) -> &[KindRow] { self.served().map_or(&[], |served| &served.kinds) }
    /// The row of the kind a tile names: by the row's own name first, then a name it serves in place of.
    pub fn kind_row(&self, kind: &str) -> Option<&KindRow> { let kinds = self.kinds(); kinds.iter().find(|row| row.kind == kind).or_else(|| kinds.iter().find(|row| row.is(kind))) }
    /// A tile's kind's row.
    pub fn kind_of(&self, tile: &str) -> Option<&KindRow> { self.spec(tile).and_then(|spec| self.kind_row(&spec.kind)) }
    /// The drawer that draws a tile, when its kind names one this window has.
    pub fn drawer_of(&self, tile: &str) -> Option<&'static tiles::Drawer> { self.kind_of(tile).and_then(tiles::drawer_of) }
    /// A tile reads notes: an open can land in it.
    pub fn reads_notes(&self, tile: &str) -> bool { self.drawer_of(tile).is_some_and(|drawer| drawer.notes) }
    /// The kind a tile made for a note is: the first the service lists whose drawer reads notes.
    pub fn note_kind(&self) -> Option<&KindRow> { self.kinds().iter().find(|row| tiles::drawer_of(row).is_some_and(|drawer| drawer.notes)) }
    /// A field of a tile: its own spec's, else what its kind's row says a tile of it starts with.
    pub fn field_of(&self, tile: &str, name: &str) -> Option<&Value> { self.spec(tile).and_then(|spec| spec.fields.get(name)).or_else(|| self.kind_of(tile).and_then(|row| row.fields.get(name))) }

    // ── tiles ───────────────────────────────────────────────────────────────────────────────────────────────

    /// A tile's own state.
    pub fn ui(&self, tile: &str) -> &TileUi { self.tiles.get(tile).unwrap_or(&NO_UI) }
    pub fn spec(&self, tile: &str) -> Option<&TileSpec> { self.layout.spec(tile) }
    /// What a drawer is handed for a tile.
    pub fn cx<'a>(&'a self, tile: &'a str) -> Option<TileCx<'a>> {
        let spec = self.spec(tile)?;
        Some(TileCx { app: self, id: tile, name: self.layout.name(tile), spec, ui: self.ui(tile), row: self.kind_row(&spec.kind)?, focused: self.layout.focus == tile })
    }
    /// The tiles on screen, in the order the layout lists them: the tree's shown ones, then the floats.
    pub fn shown_tiles(&self) -> Vec<Id> { self.layout.tree().visible().into_iter().chain(self.layout.floats.iter().map(|f| f.spec.id.clone())).collect() }

    /// The reader an act about "the open note" means: the tile it is aimed at or the one with the keys, when that
    /// reads notes; else where the screen says opens land; else the first tile that reads notes.
    pub fn reader(&self) -> Option<Id> {
        let reads = |tile: &Id| self.reads_notes(tile);
        self.aimed.clone().filter(reads).or_else(|| Some(self.layout.focus.clone()).filter(reads))
            .or_else(|| self.screen.lands().and_then(|address| self.layout.resolve(address, None, &self.screen.name).ok()).filter(reads))
            .or_else(|| self.layout.all().into_iter().find(reads))
    }
    /// A tile's list is a tree: its answer says so (a list's arrangement is the list's own word).
    pub fn is_tree(&self, tile: &str) -> bool { self.list_of(tile).is_some_and(|answer| answer.list.arrange == "tree") }
    /// The tree an act about "the tree" means: the one aimed at, else the first.
    pub fn tree_tile(&self) -> Option<Id> {
        let tree = |tile: &Id| self.is_tree(tile);
        self.aimed.clone().filter(tree).or_else(|| self.layout.all().into_iter().find(tree))
    }

    /// The note a reader shows: the one it was told, else the outline's first, as the first tree lists it.
    pub fn note_of(&self, tile: &str) -> Option<String> {
        // (A list that follows a note asks for that note first: it is never where the first note comes from.)
        self.ui(tile).note.clone().or_else(|| self.layout.all().into_iter().filter(|tile| !self.follows(tile)).find(|tile| self.is_tree(tile)).and_then(|tree| self.rows_of(&tree).first().map(|row| row.id.clone())))
    }
    /// The note a follower is about: its source tile's (`source: tile:<name>`), else the reader's.
    pub fn followed_by(&self, tile: &str) -> Option<String> { self.source_of(tile).filter(|source| self.reads_notes(source)).or_else(|| self.reader()).and_then(|reader| self.note_of(&reader)) }
    /// The note a tree marks as the one open: the note of the reader its selection feeds, else the reader's.
    pub fn selected_in(&self, tile: &str) -> Option<String> {
        let fed = self.layout.select_targets(tile).into_iter().find(|to| self.reads_notes(to));
        fed.or_else(|| self.reader()).and_then(|reader| self.note_of(&reader))
    }

    /// The note on screen for an act that names none: the reader's.
    pub fn subject(&self) -> Option<String> { self.reader().and_then(|reader| self.note_of(&reader)) }
    /// The reader's page, once it has come.
    pub fn page(&self) -> Option<&Page> { self.store.read::<Page>(&self.page_ask(&self.subject()?)) }
    /// The reader's page to draw.
    pub fn shown(&self) -> Option<&Page> { self.reader().and_then(|reader| self.shown_of(&reader)) }

    /// A tile's page, once it has come.
    pub fn page_of(&self, tile: &str) -> Option<&Page> { self.store.read::<Page>(&self.page_ask(&self.note_of(tile)?)) }
    /// The page a tile draws: its note's, or the last one while its note's is on its way.
    pub fn shown_of(&self, tile: &str) -> Option<&Page> { self.note_of(tile).and_then(|_| self.page_of(tile).or_else(|| self.store.last::<Page>(tile, "page"))) }
    pub fn loading_of(&self, tile: &str) -> bool { self.note_of(tile).is_some() && self.page_of(tile).is_none() }

    // ── lists: one list a tile, whatever it is of ───────────────────────────────────────────────────────────

    /// The parameters a list source reads, as its own row says them (a chip a parameter). None: the sources haven't come.
    fn source_params(&self, from: &str) -> Option<Vec<&str>> {
        let sources = self.store.read::<ListAnswer>(&self.sources_ask())?;
        // A source nobody lists has no parameters this window knows: its name alone is asked, and the service says why not.
        Some(sources.list.rows.iter().find(|row| row.id == from).map(|row| row.chips.iter().map(|chip| chip.key.as_str()).collect()).unwrap_or_default())
    }

    /// The question a list tile asks, in the views' grammar: its own (`query`), else the one of the list it follows
    /// (`source: tile:<name>`), narrowed by what was picked here.
    pub fn question_of(&self, tile: &str) -> String {
        let own = self.field_of(tile, QUERY).and_then(Value::as_str).map(str::to_string);
        // (One step: the list it follows asks its own question, or none.)
        let followed = || self.source_of(tile).filter(|source| source != tile && self.drawer_of(source).is_some_and(|drawer| drawer.lists)).map(|source| self.asked_of(&source));
        let mut words = own.or_else(followed).unwrap_or_default();
        for (key, value) in &self.ui(tile).narrowed {
            if !words.is_empty() { words.push(' ') }
            words.push_str(&format!("{key}={}", super::word(value)));
        }
        words
    }

    /// A list tile's own question, narrowed by what was picked in it: what a list that follows it asks too.
    fn asked_of(&self, tile: &str) -> String {
        let mut words = self.field_of(tile, QUERY).and_then(Value::as_str).unwrap_or_default().to_string();
        for (key, value) in &self.ui(tile).narrowed {
            if !words.is_empty() { words.push(' ') }
            words.push_str(&format!("{key}={}", super::word(value)));
        }
        words
    }

    /// The tile another follows (`source: tile:<name>`), by the layout's resolver.
    pub fn source_of(&self, tile: &str) -> Option<Id> {
        self.field_of(tile, "source").and_then(Value::as_str).and_then(|s| s.strip_prefix("tile:")).and_then(|address| self.layout.resolve(address, Some(tile), &self.screen.name).ok())
    }

    /// A tile follows another's note: it names its source, or its fields say its subject follows.
    pub fn follows(&self, tile: &str) -> bool { self.field_of(tile, "source").is_some() || self.field_of(tile, "subject").and_then(Value::as_str) == Some("follows") }

    /// What a list tile asks of the service: its source (`from`, a field of the tile or of its kind's row) and the
    /// parameters that source says it reads, each from what the person chose here, the tile's spec, then its kind's
    /// row. None: the tile names no source, or the sources haven't come yet.
    pub fn list_ask(&self, tile: &str) -> Option<Ask> {
        let from = self.field_of(tile, FROM)?.as_str()?;
        let ui = self.ui(tile);
        let mut params = serde_json::Map::new();
        params.insert(FROM.into(), json!(from));
        for name in self.source_params(from)? {
            let value = match name {
                OPEN => Some(json!(ui.unfolded)),
                // A list about the note another tile shows waits for that note: it asks nothing about no note.
                OF => match (self.field_of(tile, OF).cloned(), self.follows(tile)) { (Some(of), _) => Some(of), (None, true) => Some(Value::String(self.followed_by(tile)?)), (None, false) => None },
                QUERY => Some(self.question_of(tile)).filter(|words| !words.is_empty()).map(Value::String),
                other => ui.chosen.get(other).map(|chosen| json!(chosen)).or_else(|| self.field_of(tile, other).cloned()),
            };
            if let Some(value) = value { params.insert(name.to_string(), value); }
        }
        Some(Ask::watched(&self.at, "lists.read", Value::Object(params)))
    }

    /// A list tile's answer: the one for what it asks now, else the last it showed while that is on its way.
    pub fn list_of(&self, tile: &str) -> Option<&ListAnswer> { self.list_ask(tile).and_then(|ask| self.store.read::<ListAnswer>(&ask)).or_else(|| self.store.last::<ListAnswer>(tile, "list")) }
    /// A list tile's rows, in the order they are listed.
    pub fn rows_of(&self, tile: &str) -> &[ListRow] { self.list_of(tile).map_or(&NO_ROWS, |answer| &answer.list.rows) }
    /// The first tree's rows.
    pub fn tree(&self) -> &[ListRow] { match self.tree_tile() { Some(tile) => self.list_of(&tile).map_or(&NO_ROWS, |answer| &answer.list.rows), None => &NO_ROWS } }

    /// The folder a note is listed in, among the trees that have come: the row above it one level up.
    pub fn parent_of(&self, id: &str) -> Option<String> {
        self.layout.all().iter().filter(|tile| self.is_tree(tile)).find_map(|tile| {
            let rows = self.rows_of(tile);
            let at = rows.iter().position(|row| row.id == id)?;
            rows[..at].iter().rev().find(|row| row.depth + 1 == rows[at].depth).map(|row| row.id.clone())
        })
    }

    pub fn picture(&self, picture: &Picture) -> Option<&Shown> { self.pictures.get(&picture.key()) }

    /// The editor holds text the service doesn't.
    pub fn unsaved(&self) -> bool { self.editing.as_ref().is_some_and(|e| self.editor.text != e.base) }

    /// A save is out for the note being edited.
    pub fn saving(&self) -> bool { self.store.out_for(super::draft::saved) }

    // ── screens ─────────────────────────────────────────────────────────────────────────────────────────────

    /// Every screen there is to open, as the service lists them: the outline's notes and its extensions'.
    pub fn screens(&self) -> Vec<Screen> { self.served().map(|served| served.screens.iter().map(Screen::row).collect()).unwrap_or_default() }
    /// What is wrong with the screens that no one of them holds, in the service's words.
    pub fn screen_problems(&self) -> &[String] { self.served().map_or(&[], |served| &served.problems) }
    /// The screens have been listed (there may be none).
    pub fn screens_listed(&self) -> bool { self.served().is_some() }
    /// What the service says is wrong with a tile of the screen shown, in its words.
    pub fn problems_of(&self, tile: &str) -> Vec<String> {
        let name = self.layout.name(tile);
        self.screens().iter().find(|s| s.name == self.screen.name).map(|s| s.problems_of(&name).map(|p| p.said.clone()).collect()).unwrap_or_default()
    }

    /// What the layout's rules read of a tile: its kind's facts, then what its own state says.
    pub fn facts(&self, tile: &str) -> layout::Facts {
        let spec = self.spec(tile);
        let kind = spec.map_or("tile", |spec| spec.kind.as_str()).to_string();
        let drawer = self.drawer_of(tile);
        // A reader that holds unsaved text holds an edit: an open lands beside it, and it isn't closed.
        let editing = self.editing.as_ref().filter(|e| e.tile == tile && self.unsaved()).map(|e| format!("an edit of {}", self.page_of(tile).map_or(e.note.as_str(), |p| p.title.as_str())));
        // A tile that reads no notes has a home, where its own opens land when no wire or container says: the tile
        // it follows (`source: tile:`), else where the screen says opens land.
        let notes = drawer.is_some_and(|d| d.notes);
        let follows = self.source_of(tile);
        let home = if notes { None } else { follows.or_else(|| self.screen.lands().and_then(|name| self.layout.named(name))).map(|id| self.layout.name(&id)) };
        layout::Facts { kind, notes, lists: drawer.is_some_and(|d| d.lists), follower: !notes && self.follows(tile), showing: drawer.filter(|d| d.notes).and_then(|_| self.note_of(tile)), editing, home, ..layout::Facts::default() }
    }

    /// Why a tile stays on its note: it holds unsaved text. The fact is the one the layout's rules read
    /// (`Facts.editing`) and the words are the layout's, so nothing restates either.
    pub(in crate::actions) fn holds_edit(&self, tile: &str) -> Option<String> { self.facts(tile).editing.map(|_| layout::holds_edit(&self.layout.name(tile))) }

    /// Everything wanted now: what each tile on screen reads (a hidden tab asks nothing and keeps what it showed),
    /// the bar's question, and the outline's screens.
    pub fn wants(&self) -> Vec<Want> {
        let mut wants: Vec<Want> = Vec::new();
        for tile in self.shown_tiles() {
            let Some(cx) = self.cx(&tile) else { continue };
            let Some(drawer) = tiles::drawer_of(cx.row) else { continue };
            wants.extend((drawer.asks)(&cx).into_iter().map(|(role, ask)| Want { tile: tile.clone(), role, ask }));
        }
        wants.extend(crate::bar::asks(self).into_iter().map(|ask| Want { tile: "bar".into(), role: "rows", ask }));
        if self.online && !self.at.outline.is_empty() {
            wants.push(Want { tile: "screens".into(), role: "list", ask: self.screens_ask() });
            wants.push(Want { tile: "sources".into(), role: "list", ask: self.sources_ask() });
        }
        wants
    }

    // ── the link's life: not acts, but what the host says and when ──────────────────────────────────────────

    /// The first asks: who answers, then whatever is wanted.
    pub fn start(&mut self) {
        let at = self.at.clone();
        self.store.request(&at, "ping", json!({}), &Actor::Person, hello, Value::Null);
        // The window says who it is, so a script it starts can send its acts back here (`actions/script.rs`).
        self.store.register(&at);
        self.pump();
    }

    /// Asks for whatever is wanted and not yet asked.
    pub(in crate::actions) fn pump(&mut self) {
        self.follow();
        let wants = self.wants();
        self.store.want(wants);
    }

    /// What follows from a reader's page being here, done once for the note and once for each answer: the way to it
    /// unfolds in the tree that marks it, and its pictures are among the ones held.
    fn follow(&mut self) {
        self.open_first();
        let readers: Vec<Id> = self.shown_tiles().into_iter().filter(|tile| self.reads_notes(tile)).collect();
        let trees: Vec<Id> = self.shown_tiles().into_iter().filter(|tile| self.is_tree(tile)).collect();
        for tree in trees {
            let Some(note) = self.selected_in(&tree) else { continue };
            if self.ui(&tree).revealed.as_deref() == Some(note.as_str()) { continue }
            let Some(ancestors) = self.store.read::<Page>(&self.page_ask(&note)).map(|page| page.ancestors.iter().map(|a| a.id.clone()).collect::<Vec<_>>()) else { continue };
            // Its ancestors unfold, so the tree shows where it is.
            // (Once, when it first comes: a folder folded by hand afterwards stays folded.)
            let ui = self.st.tiles.entry(tree).or_default();
            ui.unfolded.extend(ancestors);
            ui.revealed = Some(note);
        }
        let mut moved = false;
        for reader in &readers {
            let Some(note) = self.note_of(reader) else { continue };
            let now = (note.clone(), self.store.epoch(&self.page_ask(&note)));
            if self.pictured.get(reader) == Some(&now) || self.page_of(reader).is_none() { continue }
            self.st.pictured.insert(reader.clone(), now);
            moved = true;
        }
        self.st.pictured.retain(|tile, _| readers.contains(tile));
        if moved { let pages: Vec<Page> = readers.iter().filter_map(|reader| self.page_of(reader).cloned()).collect(); self.want_pictures(&pages) }
    }

    /// A window with no arrangement opens on a screen once the service has listed them: the one it was asked for
    /// (`--screen`), else the one its file kept, else the one whose spec says windows start on it, else the first.
    /// The screens are the service's; which one is first is the spec's own word (`start`), never a name here.
    fn open_first(&mut self) {
        if (!self.screen.is_nowhere() && self.asked_screen.is_none()) || !self.screens_listed() { return }
        let screens = self.screens();
        let asked = self.st.asked_screen.take();
        let first = asked.as_ref().and_then(|name| screens.iter().find(|s| s.name == *name)).or_else(|| screens.iter().find(|s| s.starts())).or_else(|| screens.first()).cloned();
        match first {
            // The window opening on its screen is nobody's act: it leaves no step, and nothing to undo.
            Some(screen) => {
                if self.notice.as_ref().is_some_and(|notice| notice.said == NO_SCREENS) { self.st.notice = None }
                let opened = super::screen::lay_out(self, screen, &Actor::Person);
                if let (false, Some(asked)) = (opened.ok, &asked) { self.st.notice = Some(Notice::problem(format!("{asked}: {}", opened.said))) }
            }
            None if self.notice.is_none() => self.st.notice = Some(Notice::problem(NO_SCREENS)),
            None => {}
        }
    }

    /// Lands everything asked so far, and what that asked in turn: for a blocking link, whose answers are already here.
    pub fn settle(&mut self) -> bool {
        let mut any = false;
        while self.take() { any = true }
        any
    }

    /// Lands whatever the host has said. True when something landed.
    pub fn take(&mut self) -> bool {
        let landed = self.store.take();
        let any = !landed.is_empty();
        for one in landed {
            match one {
                Landed::Answer(key) => self.landed(&key),
                Landed::Reply(reply) => (reply.then)(self, reply),
                Landed::Call { at, call } => super::script::called(self, &at, &call),
                Landed::Ended { run, reason, message } => super::script::ended(self, &run, &reason, &message),
                Landed::Lost { detail } => {
                    self.st.online = false;
                    self.st.notice = Some(Notice::problem(format!("Offline: {detail}")));
                }
            }
        }
        // What landed may want more (a page's folders, a first note), and a watched answer that moved is read here.
        self.pump();
        any
    }

    /// An answer landed in a slot. A reader's page in a shape this window can't read is said, not left blank.
    fn landed(&mut self, key: &AskKey) {
        for reader in self.shown_tiles() {
            if !self.reads_notes(&reader) { continue }
            let Some(note) = self.note_of(&reader) else { continue };
            let ask = self.page_ask(&note);
            if ask.key() != *key || self.store.refusal(&ask).is_some() || self.page_of(&reader).is_some() { continue }
            self.st.notice = Some(Notice::problem("couldn't read the page: the host answered a shape this window doesn't know"));
        }
    }

    /// The link is lost: make it again and ask for everything wanted (its watches ended with it). True when it came back.
    pub fn reconnect(&mut self) -> bool {
        let Some(connect) = &self.connect else { return false };
        let link = connect();
        let at = self.at.clone();
        self.store.link(&at, link);
        self.st.online = true;
        self.st.notice = Some(Notice::info("Back online."));
        self.start();
        true
    }

    /// What an act asked of the next frame: an element brought into view.
    pub fn effects(&mut self, tx: &mut Tx) -> bool {
        match self.st.reveal.take() {
            Some(key) => { tx.scroll_into_view(key); true }
            None => false,
        }
    }

    // ── the kit's own hands: text typed into a field, a pane dragged by its edge ─────────────────────────────

    /// The text of a field, for the kit's editor to type into (`keys::field` is the one caller).
    pub fn field(&mut self, field: Field) -> &mut TextEdit { match field { Field::Bar => &mut self.st.bar.edit, Field::Draft => &mut self.st.editor } }

    /// A field's text changed under the kit's editor: what it asks is wanted now, and the bar's lit row is the first.
    pub fn typed(&mut self, field: Field) {
        if field == Field::Bar { self.st.bar.cursor = 0 }
        self.pump();
    }

    /// When the person last pressed a key, as the key table remembers it.
    pub fn last_key(&self) -> Option<std::time::Instant> { self.held.last_key() }

    /// The key table's memory of a sequence under way (`keys::press` is the one caller).
    pub fn held(&mut self) -> &mut crate::keys::Held { &mut self.held }

    /// The window is this large, in points (the shell is the one caller): the area the layout fills, in cells.
    pub fn resized(&mut self, width: f32, height: f32) {
        let area = Rect { col: 0.0, row: 0.0, cols: (width / CELL.0).floor().max(1.0) as f64, rows: (height / CELL.1).floor().max(1.0) as f64 };
        if area != self.st.area { self.st.area = area }
    }

    // ── what the actions share ──────────────────────────────────────────────────────────────────────────────

    pub(in crate::actions) fn steps_mut(&mut self) -> &mut Vec<Step> {
        // The newest two hundred: a record to read, not a history to keep.
        if self.st.steps.len() >= 200 { self.st.steps.drain(..100); }
        &mut self.st.steps
    }

    /// An agent's act is said on the status line, whoever looks: who, what, and why not when it was refused.
    pub(in crate::actions) fn said(&mut self, step: &Step) {
        if step.by.is_person() { return }
        self.st.agent_said = Some(if step.ok { format!("{} · {}", step.by.label(), step.action) } else { format!("{} · {} refused: {}", step.by.label(), step.action, step.said) });
    }

    /// The reader `tile` shows `id`. `remember`: the note it showed is somewhere to go back to.
    pub(in crate::actions) fn show(&mut self, tile: &str, id: &str, remember: bool) {
        let was = self.note_of(tile);
        let ui = self.st.tiles.entry(tile.to_string()).or_default();
        if remember && let Some(was) = was.filter(|was| was != id) { ui.history.push(was) }
        ui.note = Some(id.to_string());
    }

    /// A tile's own state, to change.
    pub(in crate::actions) fn ui_mut(&mut self, tile: &str) -> &mut TileUi { self.st.tiles.entry(tile.to_string()).or_default() }

    /// This window wrote: what it shows of the notes its readers have open and of these folders is read now, not
    /// when the watch says.
    pub(in crate::actions) fn wrote(&mut self, parents: &[Option<String>]) {
        let readers: Vec<String> = self.shown_tiles().into_iter().filter(|tile| self.reads_notes(tile)).filter_map(|tile| self.note_of(&tile)).collect();
        for note in readers { let ask = self.page_ask(&note); self.store.refresh(&ask) }
        // A list that shows a folder written under, or lists no folders at all (a question's matches), is read again.
        let mut seen: HashSet<AskKey> = HashSet::new();
        for tile in self.shown_tiles() {
            let Some(ask) = self.list_ask(&tile) else { continue };
            let shows = !self.is_tree(&tile) || parents.iter().any(|parent| parent.as_ref().is_none_or(|p| self.ui(&tile).unfolded.contains(p)));
            if shows && seen.insert(ask.key()) { self.store.refresh(&ask) }
        }
    }

    // ── pictures ────────────────────────────────────────────────────────────────────────────────────────────

    /// The pictures these pages show are the ones held: a file's bytes are asked of the host (`media.read`), an svg
    /// fence's text is the picture already, and what no page shows any more is let go.
    fn want_pictures(&mut self, pages: &[Page]) {
        let shown: HashSet<String> = pages.iter().flat_map(Page::pictures).map(Picture::key).collect();
        self.st.pictures.retain(|key, _| shown.contains(key));
        for picture in pages.iter().flat_map(Page::pictures) {
            let key = picture.key();
            if self.pictures.contains_key(&key) { continue }
            match (&picture.svg, &picture.path) {
                (Some(svg), _) => { let drawn = self.decoded(svg.clone().into_bytes(), "image/svg+xml"); self.st.pictures.insert(key, drawn); }
                (None, Some(path)) => {
                    self.st.pictures.insert(key.clone(), Shown::Asked);
                    let at = self.at.clone();
                    self.store.request(&at, "media.read", json!({ "path": path }), &Actor::Person, picture_read, json!({ "key": key }));
                }
                (None, None) => {}
            }
        }
    }

    /// Bytes handed to Rune's image cache, which decodes them on its worker and wakes the window when they're ready.
    fn decoded(&self, bytes: Vec<u8>, mime: &str) -> Shown {
        let vector = mime.contains("svg");
        let points = if vector { 2.0 } else { 1.0 };
        let image = self.images.load_mime(bytes, mime, PICTURE_POINTS, points);
        // A headless render has one frame: the picture is waited for, so that frame shows it.
        if self.blocking && let Err(e) = image.wait() { return Shown::Failed(format!("{e:?}")) }
        Shown::Ready { image, points }
    }
}

/// The host said who it is.
fn hello(app: &mut App, reply: Reply) {
    let result = match reply.result {
        Ok(result) => result,
        Err(refusal) => { app.st.notice = Some(Notice::problem(refusal.error)); return }
    };
    let theirs = result["protocolVersion"].as_u64().unwrap_or(0);
    if theirs != PROTOCOL {
        // Refuse, naming the side to update, as every client does.
        app.st.online = false;
        let behind = if theirs < PROTOCOL { "the outline host is older: run `ep0ch install --apply`" } else { "this window is older: build it again from the checkout" };
        app.st.notice = Some(Notice::problem(format!("Protocol {PROTOCOL} here, {theirs} on the host; {behind}.")));
        return;
    }
    app.st.machine = result["location"]["machine"].as_str().unwrap_or("").to_string();
    let person = format!("ep0ch-native:{}", app.st.machine);
    app.store.set_person(person);
}

/// A picture's bytes came, or the host's word on why not: said where the picture would be.
fn picture_read(app: &mut App, reply: Reply) {
    let Some(key) = reply.ctx["key"].as_str().map(str::to_string) else { return };
    // The page moved on while the bytes were on their way: nothing shows them.
    if !app.pictures.contains_key(&key) { return }
    let shown = match reply.result {
        Ok(result) => match base64::engine::general_purpose::STANDARD.decode(result["base64"].as_str().unwrap_or("")) {
            Ok(bytes) => app.decoded(bytes, result["mime"].as_str().unwrap_or("")),
            Err(e) => Shown::Failed(format!("its bytes didn't arrive whole: {e}")),
        },
        Err(refusal) => Shown::Failed(refusal.error),
    };
    app.st.pictures.insert(key, shown);
}
