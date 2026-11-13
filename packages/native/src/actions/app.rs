//! What the window holds.
//!
//! `State` is what was chosen (the arrangement, each tile's own state, the bar's words, what is being typed); what
//! is shown is a function of it and of the store's answers (`note_of`, `list_of`, `shown_of`, `wants`). `App`'s
//! state is private to `actions/`: everything else reads it (`App` derefs to `State`) and changes it by an act line.
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::PathBuf;
use std::ops::Deref;

use base64::Engine;
use serde_json::{Value, json};

use super::{Actor, Step, About};
use crate::client::{Link, PROTOCOL, Way};
use crate::layout::{self, Id, Layout, Rect, TileSpec};
use crate::draft::{DraftSession, Kept, Recovery};
use crate::page::{Completion, ListAnswer, ListRow, Page, Picture, SourceRow};
use crate::screen::{KindRow, Screen, Served, Spec};
use crate::store::{Ask, AskKey, Landed, OutlineAt, Reply, Store, Want};
use crate::ext::{self, Extensions};
use crate::keys::Text;
use crate::tiles::picture::{Pictures, Shown};
use crate::tiles::{self, TileCx};

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
    /// The note a list about one note keeps as its subject, when it doesn't follow (`subject: follows`): the one its
    /// home showed when it first listed, as the door's links tile holds one.
    pub subject: Option<String>,
    /// What a press in this tile last did, said on the part that was pressed.
    pub said: Option<Said>,
    /// The words selected in a reader, as it shows them: what a comment made here is on.
    pub passage: Option<String>,
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

/// The command bar as it stands: open or not, the source it lists, what is typed, the lit row.
pub struct BarUi {
    pub open: bool,
    pub scope: String,
    pub edit: Text,
    pub cursor: usize,
}

/// A place the person types: the kit's editor writes the text, through `App::field`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Field {
    /// The bar's one line.
    Bar,
    /// The source of the block being written in this tile.
    Draft(Id),
    /// A field of the open form, by the name its schema gives it.
    Form(String),
}

/// A form over the window: an extension's settings, a field each as its own schema says them (`ext::Settings`), and
/// what is typed in each. The form holds only what is typed: what a field is, its choices and what it has now are
/// read from the service's answer each time it is drawn.
pub struct FormUi {
    /// The extension whose settings it is.
    pub extension: String,
    /// What the form is called: the label of the action that opened it, which saving it runs.
    pub title: String,
    pub fields: Vec<FormField>,
    /// Why the last save was refused, in the service's words: the text stays, with why.
    pub said: Option<String>,
}

/// One field of a form: its name, what is typed in it, and what it showed when the form opened.
pub struct FormField {
    pub name: String,
    pub edit: Text,
    pub was: String,
}

/// What a window keeps of an outline it has switched away from: its arrangement, each tile's own state, the way
/// back through both, and the blocks that were being written, as typed. Switched back to, it is as it was left.
pub struct Parked {
    pub(in crate::actions) machine: String,
    pub(in crate::actions) layout: Layout,
    pub(in crate::actions) screen: Screen,
    pub(in crate::actions) tiles: HashMap<Id, TileUi>,
    pub(in crate::actions) journal: Vec<(Layout, Option<Screen>)>,
    pub(in crate::actions) screen_seen: Option<(String, String)>,
    pub(in crate::actions) drafts: Vec<DraftSession>,
    pub(in crate::actions) recovered: Vec<Kept>,
    pub(in crate::actions) trashed: HashMap<String, String>,
    pub(in crate::actions) kept_in: Option<PathBuf>,
    pub(in crate::actions) recovery: Option<Recovery>,
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
    /// The tile the act being run is about, as the dispatcher found it (`App::target` with what the action wants).
    pub about: Option<Id>,
    /// The screen the arrangement was laid out from, as the service listed it then (its name and a mark of its spec),
    /// which answer of the list that was read from, and whether this window's own save is what moves it next.
    pub screen_seen: Option<(String, String)>,
    pub screens_epoch: u64,
    pub screen_wrote: bool,
    /// The border being dragged (its split and which border): its moves are one change to go back through.
    pub dragging: Option<(String, usize)>,
    /// The page (its note, and which of its answers) whose pictures are held, a reader.
    pub pictured: HashMap<Id, (String, u64)>,

    /// The blocks being written, one session each: held by the window, shown by the tile each is written in.
    pub drafts: Vec<DraftSession>,
    /// What a window left unsaved when it ended, until each is back in its block.
    pub recovered: Vec<Kept>,
    /// Where a key lands when the field it was typed in is gone: nowhere anyone reads.
    pub nowhere: Text,

    pub bar: BarUi,
    /// The form open over the window, when one is.
    pub form: Option<FormUi>,
    /// The outlines this window has switched away from, each as it was left.
    pub parked: HashMap<OutlineAt, Parked>,
    /// The window was asked to close: the shell closes it on the next frame.
    pub closing: bool,
    pub notice: Option<Notice>,
    /// The last act an agent ran, as the status line says it.
    pub agent_said: Option<String>,

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
    /// The way to an outline's host: its link, made (or made again after it is lost), and where a window keeps that
    /// outline's arrangement. Asked for the outline this window opened on and for any it switches to.
    pub(in crate::actions) ways: Option<Ways>,
    /// The windows this one asked for (a tile torn out), until the shell opens them.
    pub(in crate::actions) born: Vec<App>,
    /// Other windows' drafts files this one read when it opened: gone once what they held is back in its block.
    pub(in crate::actions) strays: Vec<PathBuf>,
    /// The pictures of the pages the readers show, by `Picture::key`: only what they show is kept.
    pictures: Pictures,
    /// The chords of a key sequence pressed so far: the key table's own.
    held: crate::keys::Held,
    /// Where the arrangement is kept between runs. None: nowhere (a test, a headless render).
    pub(in crate::actions) kept_in: Option<PathBuf>,
    /// Where what is being written is kept while it is unsaved. None: nowhere.
    pub(in crate::actions) recovery: Option<Recovery>,
}

/// How a window reaches an outline's host, by the outline's name and its machine's: every case is the rule's
/// (`client::way`), or a test's stand-in.
pub type Ways = std::rc::Rc<dyn Fn(&OutlineAt) -> Result<Way, String>>;

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
/// What the asker draws: the drawers this window has, and the kinds it draws itself (none: every kind is a served row's).
const DRAWERS: &str = "drawers";
const KINDS: &str = "kinds";
/// What the asker runs: its own actions, each as its row (`ListsRequest.actions`: what a list of the keys is made from).
const ROWS: &str = "actions";
/// Where the asker is: the screen it has open, by name (`ListsRequest.screen`: a list of the keys puts that screen's own first).
const SCREEN: &str = "screen";
/// The list is of: the source it names (`from`), in a tile's fields.
const FROM: &str = "from";

static NO_ROWS: Vec<ListRow> = Vec::new();

/// What a window says while the service lists no screen to open on.
const NO_SCREENS: &str = "This outline has no screens to open: the ones every door ships are an extension's, and the bar's Screens says how to get them.";

impl App {
    pub fn new(link: Box<dyn Link>, outline: &str) -> App { App::opened(link, OutlineAt { outline: outline.to_string(), machine: String::new() }) }

    /// A run's first window, on an outline by its name and its machine's (empty: this machine), over the link to it.
    pub fn opened(link: Box<dyn Link>, at: OutlineAt) -> App {
        let mut store = Store::new();
        store.link(&at, link);
        App::new_on(store, &at)
    }

    /// A window on an outline, over a store that has the link to it (the run's first window makes both; a window
    /// torn from another is handed that window's store).
    pub(in crate::actions) fn new_on(store: Store, at: &OutlineAt) -> App {
        let at = at.clone();
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
                about: None,
                screen_seen: None,
                screens_epoch: 0,
                screen_wrote: false,
                dragging: None,
                pictured: HashMap::new(),
                drafts: Vec::new(),
                recovered: Vec::new(),
                nowhere: Text::new(""),
                bar: BarUi { open: false, scope: "all".into(), edit: Text::new(""), cursor: 0 },
                form: None,
                parked: HashMap::new(),
                closing: false,
                notice: None,
                agent_said: None,
                steps: Vec::new(),
                trashed: HashMap::new(),
                reveal: None,
            },
            store,
            ways: None,
            born: Vec::new(),
            strays: Vec::new(),
            pictures: Pictures::default(),
            held: crate::keys::Held::default(),
            kept_in: None,
            recovery: None,
        }
    }

    /// The arrangement is kept in this file between runs, and read from it now when it is there; what is being
    /// written is kept in the file beside it while it is unsaved, and what a window left there comes back.
    pub fn arranged_in(mut self, path: PathBuf) -> App {
        let recovery = Recovery::beside(&path);
        self.st.recovered = recovery.read();
        // What a window torn from this one left unsaved when the run ended is this window's to bring back.
        for stray in recovery.strays() { self.st.recovered.extend(Recovery(stray.clone()).read()); self.strays.push(stray) }
        self.recovery = Some(recovery);
        self.kept_in = Some(path);
        self.restore();
        self
    }

    /// The way to any outline's host: how a lost link is made again, and how another outline is switched to.
    pub fn reaching(mut self, ways: Ways) -> App {
        self.ways = Some(ways);
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
        self.store.set_blocking(blocking);
        self
    }

    pub fn set_waker(&mut self, waker: crate::client::Waker) {
        // A picture that finishes decoding wakes the window to draw it.
        self.pictures.woken_by(waker.clone());
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

    /// What the outline's extensions are and add, as the service lists them (`extensions.list`): read once, and
    /// again after this window installs, removes or configures one, or the screens they serve moved.
    pub fn extensions_ask(&self) -> Ask { Ask::read(&self.at, "extensions.list", json!({})) }
    /// The extensions, once they have come.
    pub fn extensions(&self) -> Option<&Extensions> { self.store.read::<Extensions>(&self.extensions_ask()) }
    /// An installed extension's settings, as its own schema says them.
    pub fn settings_of(&self, extension: &str) -> Option<&ext::Settings> { self.extensions()?.entry(extension)?.settings.as_ref() }

    /// A rendered tile's view (`tiles.view`), a watched read: the tile's kind and its own fields, which are the script's props.
    pub fn view_ask(&self, tile: &str) -> Option<Ask> {
        let spec = self.spec(tile)?;
        Some(Ask::watched(&self.at, "tiles.view", json!({ "kind": spec.kind, "fields": spec.fields })))
    }

    // ── kinds: what a tile's kind is, from the service's rows ───────────────────────────────────────────────

    /// The tile kinds there are, as the service lists them.
    pub fn kinds(&self) -> &[KindRow] { self.served().map_or(&[], |served| &served.kinds) }
    /// The row of the kind a tile names: the row by that name, else the one the service says serves the name now
    /// (`serves`: one kind a name, whichever extension took it last, as `screens.list` resolves a screen's tiles).
    /// Which kind a name means is the service's word either way: nothing here picks among rows that claim one.
    pub fn kind_row(&self, kind: &str) -> Option<&KindRow> { let kinds = self.kinds(); kinds.iter().find(|row| row.kind == kind).or_else(|| kinds.iter().find(|row| row.serves.iter().any(|served| served == kind))) }
    /// The name the layout's rules know a kind by: the one screens write it by (its row's `role`), else its own. A
    /// policy that takes only `reader` tiles is written with that name in every door.
    pub fn known_as(&self, kind: &str) -> String { self.kind_row(kind).and_then(KindRow::role).unwrap_or(kind).to_string() }
    /// A tile's kind's row.
    pub fn kind_of(&self, tile: &str) -> Option<&KindRow> { self.spec(tile).and_then(|spec| self.kind_row(&spec.kind)) }
    /// The drawer that draws a tile, when its kind names one this window has.
    pub fn drawer_of(&self, tile: &str) -> Option<&'static tiles::Drawer> { self.kind_of(tile).and_then(tiles::drawer_of) }
    /// A tile reads notes: an open can land in it.
    pub fn reads_notes(&self, tile: &str) -> bool { self.drawer_of(tile).is_some_and(|drawer| drawer.notes) }
    /// The kind a tile made for a note is: the kind of the reader an open would have taken (a screen's readers are
    /// its own choice of kind), else the first the service lists that reads notes and serves a name, else any that reads notes.
    pub fn note_kind(&self) -> Option<&KindRow> {
        let reads = |row: &&KindRow| tiles::drawer_of(row).is_some_and(|drawer| drawer.notes);
        self.reader().and_then(|reader| self.kind_of(&reader)).or_else(|| self.kinds().iter().filter(reads).find(|row| !row.serves.is_empty())).or_else(|| self.kinds().iter().find(reads))
    }
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

    /// The tile an act is about when it names none, by what the act wants (`About`): the tile it is aimed at when
    /// that is one of the sort, else the one with the keys when that is, else (for a reader) where the screen says
    /// opens land, else the first of the sort the layout lists. The one place this is decided: the dispatcher asks
    /// it for every act (`App::about` is its answer while the act runs), and what is drawn asks it with no act running.
    pub fn target(&self, want: About) -> Option<Id> {
        let fits = |tile: &Id| self.is_a(tile, want);
        match want {
            About::Nothing | About::Placed => self.aimed.clone(),
            About::Any => self.aimed.clone().or_else(|| Some(self.layout.focus.clone()).filter(|tile| self.spec(tile).is_some())),
            _ => self.aimed.clone().filter(fits).or_else(|| Some(self.layout.focus.clone()).filter(fits))
                .or_else(|| self.landing().filter(|_| want == About::Notes))
                .or_else(|| self.layout.all().into_iter().find(fits)),
        }
    }
    /// A tile is of the sort an act wants: it reads notes, it lists, its list is a tree.
    pub fn is_a(&self, tile: &str, want: About) -> bool {
        match want {
            About::Notes => self.reads_notes(tile),
            About::Lists => self.drawer_of(tile).is_some_and(|drawer| drawer.lists),
            About::Tree => self.is_tree(tile),
            About::Drafts => self.draft_on(tile).is_some(),
            About::Nothing | About::Any | About::Placed => self.spec(tile).is_some(),
        }
    }
    /// The tile the act being run is about: what the dispatcher found for it, and checked the actor against.
    pub fn about(&self) -> Option<Id> { self.about.clone() }

    /// The reader an act about "the open note" means, and what is drawn about it reads.
    pub fn reader(&self) -> Option<Id> { self.target(About::Notes) }
    /// A list's folders unfold: its source says it reads which are open.
    pub fn unfolds(&self, tile: &str) -> bool { self.field_of(tile, FROM).and_then(Value::as_str).and_then(|from| self.source_params(from)).is_some_and(|params| params.contains(&OPEN)) }
    /// A tile's list is a tree: its answer says so (a list's arrangement is the list's own word).
    pub fn is_tree(&self, tile: &str) -> bool { self.list_of(tile).is_some_and(|answer| answer.list.arrange == "tree") }
    /// The tree an act about "the tree" means.
    pub fn tree_tile(&self) -> Option<Id> { self.target(About::Tree) }

    /// Where the screen says opens land, as a tile that reads notes: the tile `lands` names, or the last reader in
    /// the container it names (the layout's `lands` is the one reading of the word: a tile's name, else a container's key).
    pub fn landing(&self) -> Option<Id> {
        match self.layout.lands(self.spec_now().and_then(|spec| spec.lands())?)? {
            layout::Lands::Tile(tile) => Some(tile).filter(|tile| self.reads_notes(tile)),
            layout::Lands::Container(key) => self.layout.within(&key).into_iter().rev().find(|tile| self.reads_notes(tile)),
        }
    }

    /// The note a reader shows: the one it was told, else the outline's first, as the first tree lists it.
    pub fn note_of(&self, tile: &str) -> Option<String> {
        // (A list that follows a note asks for that note first: it is never where the first note comes from.)
        self.ui(tile).note.clone().or_else(|| self.layout.all().into_iter().filter(|tile| !self.attached(tile) && !self.waits_for_a_note(tile)).find(|tile| self.is_tree(tile)).and_then(|tree| self.rows_of(&tree).first().map(|row| row.id.clone())))
    }
    /// The note a follower is about: its source tile's (`source: tile:<name>`), else the reader's.
    pub fn followed_by(&self, tile: &str) -> Option<String> { self.source_of(tile).filter(|source| self.reads_notes(source)).or_else(|| self.reader()).and_then(|reader| self.note_of(&reader)) }
    /// The reader a list about a note is about the note of: the tile it names as its source, when that reads notes;
    /// else, following, the reader an act about the open note means.
    pub fn home_of(&self, tile: &str) -> Option<Id> {
        self.source_of(tile).filter(|source| self.reads_notes(source)).or_else(|| if self.follows(tile) { self.reader() } else { None })
    }
    /// The words selected in a reader are let go, in every reader: the bar had the keys and is put away, and what
    /// was selected when it opened is shown selected no longer (the runtime clears a selection when a field takes
    /// the keys, and tells no one). What the bar ran has had them by now, when it was a comment.
    pub(in crate::actions) fn unselect(&mut self) { for ui in self.st.tiles.values_mut() { ui.passage = None } }
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

    /// The list sources there are, each as it says of itself (`lists.read from=sources`). None: they haven't come.
    pub fn sources(&self) -> Option<&[SourceRow]> { self.store.read::<ListAnswer>(&self.sources_ask()).map(|answer| answer.sources.as_slice()) }

    /// The parameters a list source reads, as its own row says them. None: the sources haven't come.
    fn source_params(&self, from: &str) -> Option<Vec<&str>> {
        // A source nobody lists has no parameters this window knows: its name alone is asked, and the service says why not.
        Some(self.sources()?.iter().find(|source| source.from == from).map(|source| source.params.iter().map(|param| param.name.as_str()).collect()).unwrap_or_default())
    }

    /// A list asked of the service: `from`, and each parameter that source says it reads, as `fill` answers it by
    /// name (a tile's fields, the bar's words), else what this window says of itself (the drawers it has). The one
    /// place a `lists.read` is made: a tile's and the bar's are both it. None: the sources haven't come yet.
    pub fn ask_of(&self, from: &str, watched: bool, fill: impl Fn(&str) -> Option<Value>) -> Option<Ask> {
        let mut params = serde_json::Map::new();
        params.insert(FROM.into(), json!(from));
        for name in self.source_params(from)? {
            let own = || match name { DRAWERS => Some(json!(tiles::drawers())), KINDS => Some(json!([])), ROWS => Some(super::rows().clone()), SCREEN => Some(json!(self.screen.name)).filter(|_| !self.screen.is_nowhere()), _ => None };
            if let Some(value) = fill(name).or_else(own) { params.insert(name.to_string(), value); }
        }
        Some(if watched { Ask::watched(&self.at, "lists.read", Value::Object(params)) } else { Ask::read(&self.at, "lists.read", Value::Object(params)) })
    }

    /// The question a list tile asks, in the views' grammar: its own (`query`), else the one of the list it follows
    /// (`source: tile:<name>`), narrowed by what was picked here.
    pub fn question_of(&self, tile: &str) -> String {
        let own = self.field_of(tile, QUERY).and_then(Value::as_str).map(str::to_string);
        // (One step: the list it follows asks its own question, or none.)
        let followed = || self.source_of(tile).filter(|source| source != tile && self.drawer_of(source).is_some_and(|drawer| drawer.lists)).map(|source| self.asked_of(&source));
        self.narrowed_in(tile, own.or_else(followed).unwrap_or_default())
    }

    /// A list tile's own question, narrowed by what was picked in it: what a list that follows it asks too.
    fn asked_of(&self, tile: &str) -> String { self.narrowed_in(tile, self.field_of(tile, QUERY).and_then(Value::as_str).unwrap_or_default().to_string()) }

    /// A question narrowed by what was picked in a tile: written by the one writer of a picked value as a term
    /// (`query::narrowed`, outline-core's `selectionQuery`).
    fn narrowed_in(&self, tile: &str, words: String) -> String { crate::query::narrowed(&words, &self.ui(tile).narrowed) }

    /// The tile another follows (`source: tile:<name>`), by the layout's resolver.
    pub fn source_of(&self, tile: &str) -> Option<Id> {
        self.field_of(tile, "source").and_then(Value::as_str).and_then(|s| s.strip_prefix("tile:")).and_then(|address| self.layout.resolve(address, Some(tile), &self.screen.name).ok())
    }

    /// A tile's subject follows the note its home shows: its fields say so (`subject: follows`, its own or its
    /// kind's row's). Left unsaid, it keeps the subject it has, as it does in the door.
    pub fn follows(&self, tile: &str) -> bool { self.field_of(tile, "subject").and_then(Value::as_str) == Some("follows") }
    /// A tile is another's: it names its home (`source`), or follows.
    pub fn attached(&self, tile: &str) -> bool { self.field_of(tile, "source").is_some() || self.follows(tile) }
    /// A tile's list is about one note: its source says it can't list without one (`of`, required).
    pub fn about_a_note(&self, tile: &str) -> bool {
        let from = self.field_of(tile, FROM).and_then(Value::as_str);
        from.zip(self.sources()).and_then(|(from, sources)| sources.iter().find(|source| source.from == from)).is_some_and(|source| source.params.iter().any(|param| param.name == OF && param.required))
    }
    /// A tile's list waits for a note another tile shows: it follows, or is about one note and names none itself.
    pub fn waits_for_a_note(&self, tile: &str) -> bool { (self.follows(tile) || self.about_a_note(tile)) && self.field_of(tile, OF).is_none() }
    /// The note a list is about: the one its spec names (`of`); else, following, the one its home shows now; else,
    /// about one note, the one it holds (the one its home showed when it first listed). A list about no note: none.
    pub fn subject_of(&self, tile: &str) -> Option<String> {
        if let Some(of) = self.field_of(tile, OF).and_then(Value::as_str) { return Some(of.to_string()) }
        if self.follows(tile) { return self.followed_by(tile) }
        if self.about_a_note(tile) { return self.ui(tile).subject.clone().or_else(|| self.followed_by(tile)) }
        None
    }

    /// What a list tile asks of the service: its source (`from`, a field of the tile or of its kind's row) and the
    /// parameters that source says it reads, each from what the person chose here, the tile's spec, then its kind's
    /// row. None: the tile names no source, the sources haven't come yet, or it is about a note and none is open.
    pub fn list_ask(&self, tile: &str) -> Option<Ask> {
        let from = self.field_of(tile, FROM)?.as_str()?;
        let ui = self.ui(tile);
        // A list about the note another tile shows waits for that note: it asks nothing about no note.
        let subject = self.subject_of(tile);
        if subject.is_none() && self.waits_for_a_note(tile) { return None }
        self.ask_of(from, true, |name| match name {
            OPEN => Some(json!(ui.unfolded)),
            OF => subject.clone().map(Value::String),
            QUERY => Some(self.question_of(tile)).filter(|words| !words.is_empty()).map(Value::String),
            other => ui.chosen.get(other).map(|chosen| json!(chosen)).or_else(|| self.field_of(tile, other).cloned()),
        })
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

    // ── drafts: the blocks being written ────────────────────────────────────────────────────────────────────

    /// The draft written in a tile.
    pub fn draft_on(&self, tile: &str) -> Option<&DraftSession> { self.drafts.iter().find(|draft| draft.tile == tile) }
    /// The draft of a block's own text, whichever tile it is written in (a comment on it is another draft).
    pub fn draft_of(&self, note: &str) -> Option<&DraftSession> { self.drafts.iter().find(|draft| draft.note == note && draft.is_block()) }

    /// A save is out.
    pub fn saving(&self) -> bool { self.store.out_for(super::draft::saved) }

    /// The list that completes what is being typed in a tile's draft, while it is open: the service's answer for the
    /// text and the caret as they are now, when it found a token there and has rows or a word to say for it.
    pub fn completing(&self, tile: &str) -> Option<&Completion> {
        let draft = self.draft_on(tile)?;
        self.store.read::<Completion>(draft.completes()?).filter(|found| found.token.is_some() && (!found.rows.is_empty() || found.message.is_some()))
    }

    // ── screens ─────────────────────────────────────────────────────────────────────────────────────────────

    /// Every screen there is to open, as the service lists them: the outline's notes and its extensions'.
    pub fn screens(&self) -> Vec<Screen> { self.served().map(|served| served.screens.iter().map(Screen::row).collect()).unwrap_or_default() }
    /// What is wrong with the screens that no one of them holds, in the service's words.
    pub fn screen_problems(&self) -> &[String] { self.served().map_or(&[], |served| &served.problems) }
    /// The screens have been listed (there may be none).
    pub fn screens_listed(&self) -> bool { self.served().is_some() }
    /// The row the service lists for the screen that is open, when it lists one by that name.
    fn served_row(&self) -> Option<&Value> { self.served()?.screens.iter().find(|row| row["name"].as_str() == Some(self.screen.name.as_str())) }
    /// What the open screen says of itself now (where opens land, its toolbar, its rule for new notes): the spec the
    /// service lists for it, read each time, so a screen note changed since the window opened is followed; the
    /// spec it was opened as only while the service lists none by its name (a save on its way, a note trashed).
    pub fn spec_now(&self) -> Option<Spec<'_>> { self.served_row().and_then(|row| row.get("spec")).filter(|spec| spec.is_object()).or(self.screen.spec.as_ref()).map(Spec) }
    /// What the service says is wrong with a tile of the screen shown, in its words.
    pub fn problems_of(&self, tile: &str) -> Vec<String> {
        let name = self.layout.name(tile);
        self.served_row().map(|row| Screen::row(row).problems_of(&name).map(|p| p.said.clone()).collect()).unwrap_or_default()
    }

    /// What the layout's rules read of a tile: its kind's facts, then what its own state says.
    pub fn facts(&self, tile: &str) -> layout::Facts {
        let spec = self.spec(tile);
        let kind = spec.map_or("tile".to_string(), |spec| self.known_as(&spec.kind));
        let drawer = self.drawer_of(tile);
        // A reader a block is being written in holds an edit: an open lands beside it, and it isn't closed.
        let editing = self.draft_on(tile).map(|draft| format!("{} {}", draft.writes.what(), self.page_of(tile).map_or(draft.note.as_str(), |p| p.title.as_str())));
        // A tile that reads no notes has a home, where its own opens land when no wire or container says: the tile
        // it follows (`source: tile:`), else where the screen says opens land.
        let notes = drawer.is_some_and(|d| d.notes);
        let follows = self.source_of(tile);
        let home = if notes { None } else { follows.or_else(|| self.landing()).map(|id| self.layout.name(&id)) };
        layout::Facts { kind, notes, lists: drawer.is_some_and(|d| d.lists), follower: !notes && self.attached(tile), showing: drawer.filter(|d| d.notes).and_then(|_| self.note_of(tile)), editing, home, ..layout::Facts::default() }
    }

    /// Why a tile stays on its note: a block is being written in it. The fact is the one the layout's rules read
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
        // What completes the words being typed, for the draft with the keys.
        if let Some(draft) = self.draft_on(&self.layout.focus) && let Some(ask) = draft.completes() { wants.push(Want { tile: draft.tile.clone(), role: "complete", ask: ask.clone() }) }
        wants.extend(crate::bar::asks(self).into_iter().map(|ask| Want { tile: "bar".into(), role: "rows", ask }));
        if self.online && !self.at.outline.is_empty() {
            wants.push(Want { tile: "screens".into(), role: "list", ask: self.screens_ask() });
            wants.push(Want { tile: "sources".into(), role: "list", ask: self.sources_ask() });
            wants.push(Want { tile: "ext".into(), role: "list", ask: self.extensions_ask() });
        }
        wants
    }

    // ── the link's life: not acts, but what the host says and when ──────────────────────────────────────────

    /// The first asks: who answers, then whatever is wanted.
    pub fn start(&mut self) {
        let at = self.at.clone();
        self.store.request(&at, "ping", json!({}), &Actor::Person, hello, json!({ "outline": at.outline, "machine": at.machine }));
        // The window says who it is, so a script it starts can send its acts back here (`actions/script.rs`), and the
        // service can ask about a draft held here. A link made again holds each draft again.
        self.store.register(&at);
        self.hold_all();
        self.pump();
    }

    /// Asks for whatever is wanted and not yet asked.
    pub(in crate::actions) fn pump(&mut self) {
        self.follow();
        self.recover();
        // What completes the words being typed is asked for the text and the caret as they are now.
        let (at, focus) = (self.at.clone(), self.layout.focus.clone());
        if let Some(draft) = self.st.drafts.iter_mut().find(|draft| draft.tile == focus) { draft.complete(&at) }
        let wants = self.wants();
        self.store.want(wants);
    }

    /// What follows from a reader's page being here, done once for the note and once for each answer: the way to it
    /// unfolds in the tree that marks it, and its pictures are among the ones held.
    fn follow(&mut self) {
        self.open_first();
        self.screen_moved();
        // A list about a note that doesn't follow takes the note its home shows now as its subject, once, and keeps it.
        for tile in self.shown_tiles() {
            if !self.about_a_note(&tile) || !self.waits_for_a_note(&tile) || self.follows(&tile) || self.ui(&tile).subject.is_some() { continue }
            if let Some(note) = self.followed_by(&tile) { self.ui_mut(&tile).subject = Some(note) }
        }
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

    /// The screen this arrangement is of changed in the outline since it was laid out (another door saved it,
    /// someone edited its blocks, the window was shut meanwhile): said once, with the act that lays the window out
    /// as it is now. What the screen says of itself (`spec_now`) is followed at once; the arrangement is the
    /// person's until they reset it. Looked at when the list of screens is answered anew, never each frame.
    fn screen_moved(&mut self) {
        let epoch = self.store.epoch(&self.screens_ask());
        if epoch == self.st.screens_epoch { return }
        self.st.screens_epoch = epoch;
        // What the extensions serve moved with it (one installed, removed, or its folder changed): their list is read again.
        if epoch > 1 { let ask = self.extensions_ask(); self.store.refresh(&ask) }
        // (A save of this window's own is what moved it: that is no news.)
        let wrote = std::mem::take(&mut self.st.screen_wrote);
        let Some(now) = self.seen_of() else { return };
        let before = self.st.screen_seen.replace(now.clone());
        if before.as_ref() == Some(&now) { return }
        self.keep();
        if !wrote && before.is_some_and(|(name, _)| name == now.0) {
            self.st.notice = Some(Notice::info(format!("The screen {} changed in the outline since this arrangement was laid out. {} lays it out as it is now.", now.0, super::label("screen.reset"))));
        }
    }

    /// The open screen as the service lists it now, in a word: its name and a mark of its spec.
    fn seen_of(&self) -> Option<(String, String)> {
        let spec = self.served_row()?.get("spec").filter(|spec| spec.is_object())?;
        // (The spec as the service wrote it: the same words, the same mark, in every run.)
        Some((self.screen.name.clone(), crate::draft::version(&spec.to_string())))
    }

    /// The arrangement is of the screen as the service lists it now: what a later change is measured against.
    pub(in crate::actions) fn seen(&mut self) { self.st.screen_seen = self.seen_of() }

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
                Landed::Asked { at, ask, by } => super::draft::asked(self, &at, &ask, by),
                // (A link to an outline this window isn't on now is another window's to say, or nobody's.)
                Landed::Lost { at, detail } => if at == self.at {
                    self.st.online = false;
                    self.st.notice = Some(Notice::problem(format!("Offline: {detail}")));
                },
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
        let Some(ways) = self.ways.clone() else { return false };
        let at = self.at.clone();
        // Another window on this outline may have made it again already: the link is the store's, one an outline.
        if !self.store.linked(&at) {
            match ways(&at) { Ok(way) => self.store.link(&at, way.link), Err(_) => return false }
        }
        self.st.online = true;
        self.st.notice = Some(Notice::info("Back online."));
        self.start();
        true
    }

    /// What an act asked of the next frame: the element to bring into view, taken once (`keys::effects` is the one caller).
    pub fn revealed(&mut self) -> Option<String> { self.st.reveal.take() }

    /// The windows this one asked for, each its whole state, taken once: the shell opens them (`shell::windows` is
    /// the one caller in a run; a test draws one itself).
    pub fn born(&mut self) -> Vec<App> { std::mem::take(&mut self.born) }
    /// The name this window has among its run's (`main`, then what each torn-out one was called).
    pub fn window(&self) -> String { self.store.window() }

    // ── the kit's own hands: text typed into a field, a pane dragged by its edge ─────────────────────────────

    /// The text of a field, for the kit's editor to type into (`keys.rs` is the one caller). A field whose draft
    /// is gone types nowhere.
    pub fn field(&mut self, field: &Field) -> &mut Text {
        match field {
            Field::Bar => &mut self.st.bar.edit,
            Field::Draft(tile) => match self.st.drafts.iter().position(|draft| draft.tile == *tile) { Some(at) => &mut self.st.drafts[at].buf, None => &mut self.st.nowhere },
            Field::Form(name) => match self.st.form.as_mut().and_then(|form| form.fields.iter_mut().find(|field| field.name == *name)) { Some(field) => &mut field.edit, None => &mut self.st.nowhere },
        }
    }

    /// A field's text changed under the kit's editor: what it asks is wanted now, the bar's lit row is the first,
    /// and what a draft holds is kept as it is typed.
    pub fn typed(&mut self, field: &Field) {
        match field {
            Field::Bar => self.st.bar.cursor = 0,
            Field::Draft(tile) => self.wrote_in(tile),
            Field::Form(_) => if let Some(form) = &mut self.st.form { form.said = None },
        }
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
        // (Words selected in the note it showed are that note's: another note has none picked.)
        if was.as_deref() != Some(id) { ui.passage = None }
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
        self.pictures.keep(&shown);
        for picture in pages.iter().flat_map(Page::pictures) {
            let key = picture.key();
            if self.pictures.holds(&key) { continue }
            match (&picture.svg, &picture.path) {
                (Some(svg), _) => self.pictures.decode(key, svg.clone().into_bytes(), "image/svg+xml", self.blocking),
                (None, Some(path)) => {
                    self.pictures.asked(key.clone());
                    let at = self.at.clone();
                    self.store.request(&at, "media.read", json!({ "path": path }), &Actor::Person, picture_read, json!({ "key": key }));
                }
                (None, None) => {}
            }
        }
    }
}

/// The host said who it is.
fn hello(app: &mut App, reply: Reply) {
    // The window switched to another outline before this one's host answered: its hello is nobody's now.
    if reply.ctx["outline"] != app.at.outline.as_str() || reply.ctx["machine"] != app.at.machine.as_str() { return }
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
    let (at, person) = (app.at.clone(), format!("ep0ch-native:{}", app.st.machine));
    app.store.set_person(&at, person);
}

/// A picture's bytes came, or the host's word on why not: said where the picture would be.
fn picture_read(app: &mut App, reply: Reply) {
    let Some(key) = reply.ctx["key"].as_str().map(str::to_string) else { return };
    // The page moved on while the bytes were on their way: nothing shows them.
    if !app.pictures.holds(&key) { return }
    match reply.result {
        Ok(result) => match base64::engine::general_purpose::STANDARD.decode(result["base64"].as_str().unwrap_or("")) {
            Ok(bytes) => app.pictures.decode(key, bytes, result["mime"].as_str().unwrap_or(""), app.blocking),
            Err(e) => app.pictures.failed(key, format!("its bytes didn't arrive whole: {e}")),
        },
        Err(refusal) => app.pictures.failed(key, refusal.error),
    }
}
