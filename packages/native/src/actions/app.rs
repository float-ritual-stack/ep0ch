//! What the window holds.
//!
//! `State` is what was chosen (the arrangement, each tile's own state, the bar's words, what is being typed); what
//! is shown is a function of it and of the store's answers (`note_of`, `tree_of`, `shown_of`, `wants`). `App`'s
//! state is private to `actions/`: everything else reads it (`App` derefs to `State`) and changes it by an act line.
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::PathBuf;
use std::ops::Deref;
use std::sync::Arc;

use base64::Engine;
use rune::{Image, ImageCache, TextEdit, Tx};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{Actor, Step};
use crate::client::{Link, PROTOCOL};
use crate::layout::{self, Id, Layout, Rect, TileSpec};
use crate::page::{NoteRow, Page, Picture};
use crate::screen::{self, Screen};
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
    /// The folders a tree has unfolded.
    pub unfolded: BTreeSet<String>,
    /// The note whose way from the top a tree unfolded when its page first came (once: a folder folded by hand stays folded).
    pub revealed: Option<String>,
}

static NO_UI: std::sync::LazyLock<TileUi> = std::sync::LazyLock::new(TileUi::default);

/// A window's cell, in points: the layout's rules count in cells, as the door's do.
pub const CELL: (f32, f32) = (8.0, 18.0);

/// One line of a tree: a note at its depth in the unfolded tree.
#[derive(Clone, Debug, PartialEq)]
pub struct TreeLine {
    pub depth: usize,
    pub row: NoteRow,
}

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

#[derive(Deserialize)]
struct Level {
    #[serde(default)]
    blocks: Vec<NoteRow>,
}

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
                layout: screen::default().layout().unwrap_or_default(),
                screen: screen::default(),
                tiles: HashMap::new(),
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

    /// The notes under `parent` (None: the top level), a watched read.
    pub fn level_ask(&self, parent: Option<&str>) -> Ask { Ask::watched(&self.at, "blocks.read", json!({ "under": parent, "fields": ["title", "hasChildren"] })) }

    /// A note's page, a watched read.
    pub fn page_ask(&self, note: &str) -> Ask { Ask::watched(&self.at, "notes.page", json!({ "blockId": note })) }

    /// The outline's screens, a watched read: this window says which kinds it draws, and the service says what is wrong.
    pub fn screens_ask(&self) -> Ask { Ask::watched(&self.at, "screens.list", json!({ "kinds": tiles::kinds() })) }

    fn level(&self, parent: Option<&str>) -> &[NoteRow] { self.store.read::<Level>(&self.level_ask(parent)).map_or(&[], |level| &level.blocks) }

    // ── tiles ───────────────────────────────────────────────────────────────────────────────────────────────

    /// A tile's own state.
    pub fn ui(&self, tile: &str) -> &TileUi { self.tiles.get(tile).unwrap_or(&NO_UI) }
    pub fn spec(&self, tile: &str) -> Option<&TileSpec> { self.layout.spec(tile) }
    fn row_of(&self, tile: &str) -> Option<&'static tiles::KindRow> { self.spec(tile).and_then(|spec| tiles::kind(&spec.kind)) }
    /// What a drawer is handed for a tile.
    pub fn cx<'a>(&'a self, tile: &'a str) -> Option<TileCx<'a>> {
        let spec = self.spec(tile)?;
        Some(TileCx { app: self, id: tile, name: self.layout.name(tile), spec, ui: self.ui(tile), row: tiles::kind(&spec.kind)?, focused: self.layout.focus == tile })
    }
    /// The tiles on screen, in the order the layout lists them: the tree's shown ones, then the floats.
    pub fn shown_tiles(&self) -> Vec<Id> { self.layout.tree().visible().into_iter().chain(self.layout.floats.iter().map(|f| f.spec.id.clone())).collect() }

    /// The reader an act about "the open note" means: the tile it is aimed at or the one with the keys, when that
    /// reads notes; else where the screen says opens land; else the first tile that reads notes.
    pub fn reader(&self) -> Option<Id> {
        let reads = |tile: &Id| self.row_of(tile).is_some_and(|row| row.notes);
        self.aimed.clone().filter(reads).or_else(|| Some(self.layout.focus.clone()).filter(reads))
            .or_else(|| self.screen.lands().and_then(|name| self.layout.named(name)).filter(reads))
            .or_else(|| self.layout.all().into_iter().find(reads))
    }
    /// The tree an act about "the tree" means: the one aimed at, else the first.
    pub fn tree_tile(&self) -> Option<Id> {
        let lists = |tile: &Id| self.spec(tile).is_some_and(|spec| spec.kind == "tree");
        self.aimed.clone().filter(lists).or_else(|| self.layout.all().into_iter().find(lists))
    }

    /// The note a reader shows: the one it was told, else the outline's first.
    pub fn note_of(&self, tile: &str) -> Option<String> { self.ui(tile).note.clone().or_else(|| self.level(None).first().map(|row| row.id.clone())) }
    /// The note a follower is about: its source tile's (`source: tile:<name>`), else the reader's.
    pub fn followed_by(&self, tile: &str) -> Option<String> {
        let source = self.spec(tile).and_then(|spec| spec.text("source")).and_then(|s| s.strip_prefix("tile:")).and_then(|name| self.layout.named(name));
        source.or_else(|| self.reader()).and_then(|reader| self.note_of(&reader))
    }
    /// The note a tree marks as the one open: the note of the reader its selection feeds, else the reader's.
    pub fn selected_in(&self, tile: &str) -> Option<String> {
        let fed = self.layout.select_targets(tile).into_iter().find(|to| self.row_of(to).is_some_and(|row| row.notes));
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

    /// A tree's lines: each level's rows, and under an unfolded row its own level once it has come.
    pub fn tree_of(&self, tile: &str) -> Vec<TreeLine> {
        fn walk(app: &App, unfolded: &BTreeSet<String>, parent: Option<&str>, depth: usize, out: &mut Vec<TreeLine>) {
            for row in app.level(parent) {
                out.push(TreeLine { depth, row: row.clone() });
                if unfolded.contains(&row.id) { walk(app, unfolded, Some(&row.id), depth + 1, out) }
            }
        }
        let mut out = Vec::new();
        walk(self, &self.ui(tile).unfolded, None, 0, &mut out);
        out
    }
    /// The first tree's lines.
    pub fn tree(&self) -> Vec<TreeLine> { self.tree_tile().map(|tile| self.tree_of(&tile)).unwrap_or_default() }

    /// The folder a note is listed in, among the levels that have come.
    pub fn parent_of(&self, id: &str) -> Option<String> {
        let unfolded: BTreeSet<&String> = self.tiles.values().flat_map(|ui| ui.unfolded.iter()).collect();
        std::iter::once(None).chain(unfolded.into_iter().map(Some)).find(|parent| self.level(parent.map(String::as_str)).iter().any(|row| row.id == id)).flatten().cloned()
    }

    pub fn picture(&self, picture: &Picture) -> Option<&Shown> { self.pictures.get(&picture.key()) }

    /// The editor holds text the service doesn't.
    pub fn unsaved(&self) -> bool { self.editing.as_ref().is_some_and(|e| self.editor.text != e.base) }

    /// A save is out for the note being edited.
    pub fn saving(&self) -> bool { self.store.out_for(super::draft::saved) }

    // ── screens ─────────────────────────────────────────────────────────────────────────────────────────────

    /// Every screen there is to open: the ones this window ships, then the outline's as the service lists them.
    pub fn screens(&self) -> Vec<Screen> {
        let served = self.store.read::<serde_json::Value>(&self.screens_ask()).and_then(|list| list["screens"].as_array()).map(|rows| rows.iter().map(Screen::row).collect::<Vec<_>>()).unwrap_or_default();
        let mut all: Vec<Screen> = screen::shipped().into_iter().filter(|shipped| !served.iter().any(|s| s.name == shipped.name)).collect();
        all.extend(served);
        all
    }
    /// What the service says is wrong with a tile of the screen shown, in its words.
    pub fn problems_of(&self, tile: &str) -> Vec<String> {
        let name = self.layout.name(tile);
        self.screens().iter().find(|s| s.name == self.screen.name).map(|s| s.problems_of(&name).map(|p| p.said.clone()).collect()).unwrap_or_default()
    }

    /// What the layout's rules read of a tile: its kind's facts, then what its own state says.
    pub fn facts(&self, tile: &str) -> layout::Facts {
        let spec = self.spec(tile);
        let kind = spec.map_or("tile", |spec| spec.kind.as_str()).to_string();
        let row = tiles::kind(&kind);
        // A reader that holds unsaved text holds an edit: an open lands beside it, and it isn't closed.
        let editing = self.editing.as_ref().filter(|e| e.tile == tile && self.unsaved()).map(|e| format!("an edit of {}", self.page_of(tile).map_or(e.note.as_str(), |p| p.title.as_str())));
        layout::Facts { kind, notes: row.is_some_and(|r| r.notes), lists: row.is_some_and(|r| r.lists), follower: row.is_some_and(|r| r.follower), showing: row.filter(|r| r.notes).and_then(|_| self.note_of(tile)), editing, ..layout::Facts::default() }
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
            let Some(drawer) = tiles::drawer(cx.row.drawer) else { continue };
            wants.extend((drawer.asks)(&cx).into_iter().map(|(role, ask)| Want { tile: tile.clone(), role, ask }));
        }
        wants.extend(crate::bar::asks(self).into_iter().map(|ask| Want { tile: "bar".into(), role: "rows", ask }));
        if self.online && !self.at.outline.is_empty() { wants.push(Want { tile: "screens".into(), role: "list", ask: self.screens_ask() }) }
        wants
    }

    // ── the link's life: not acts, but what the host says and when ──────────────────────────────────────────

    /// The first asks: who answers, then whatever is wanted.
    pub fn start(&mut self) {
        let at = self.at.clone();
        self.store.request(&at, "ping", json!({}), &Actor::Person, hello, Value::Null);
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
        let readers: Vec<Id> = self.shown_tiles().into_iter().filter(|tile| self.row_of(tile).is_some_and(|row| row.notes)).collect();
        let trees: Vec<Id> = self.shown_tiles().into_iter().filter(|tile| self.spec(tile).is_some_and(|spec| spec.kind == "tree")).collect();
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
            if !self.row_of(&reader).is_some_and(|row| row.notes) { continue }
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
        let readers: Vec<String> = self.shown_tiles().into_iter().filter(|tile| self.row_of(tile).is_some_and(|row| row.notes)).filter_map(|tile| self.note_of(&tile)).collect();
        for note in readers { let ask = self.page_ask(&note); self.store.refresh(&ask) }
        let unfolded: HashSet<String> = self.tiles.values().flat_map(|ui| ui.unfolded.iter().cloned()).collect();
        let mut seen: HashSet<Option<String>> = HashSet::new();
        for parent in parents {
            if !seen.insert(parent.clone()) { continue }
            if parent.as_ref().is_none_or(|p| unfolded.contains(p)) { let ask = self.level_ask(parent.as_deref()); self.store.refresh(&ask) }
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
