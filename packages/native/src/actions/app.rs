//! What the window holds.
//!
//! `State` is what was chosen (the note opened, the folders unfolded, the bar's words, what is being typed); what
//! is shown is a function of it and of the store's answers (`subject`, `tree`, `shown`, `wants`). `App`'s state is
//! private to `actions/`: everything else reads it (`App` derefs to `State`) and changes it by an act line.
use std::collections::{BTreeSet, HashMap, HashSet};
use std::ops::Deref;
use std::sync::Arc;

use base64::Engine;
use rune::{Image, ImageCache, TextEdit, Tx};
use rune_kit::shell::PaneState;
use serde::Deserialize;
use serde_json::{Value, json};

use super::{Actor, Step};
use crate::client::{Link, PROTOCOL};
use crate::page::{NoteRow, Page, Picture};
use crate::store::{Ask, AskKey, Landed, OutlineAt, Reply, Store, Want};

/// The note being typed in. `base` is the text the service holds at `revision`: a save names that revision, and the
/// editor has something unsaved exactly when its text differs from `base`.
pub struct Editing {
    pub note: String,
    pub revision: u64,
    pub base: String,
}

/// One line of the sidebar: a note at its depth in the unfolded tree.
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

    /// The note opened. None: the outline's first note, once the top level has come.
    pub note: Option<String>,
    pub back: Vec<String>,
    /// The folders unfolded in the tree.
    pub unfolded: BTreeSet<String>,
    /// The note whose way from the top was unfolded when its page first came (once: a folder folded by hand stays folded).
    pub revealed: Option<String>,
    /// The page (its note, and which of its answers) whose pictures are the ones held.
    pub pictured: Option<(String, u64)>,

    /// The editor's text, there whether or not a note is being edited, so a key always has somewhere to land.
    pub editor: TextEdit,
    pub editing: Option<Editing>,

    pub bar: BarUi,
    pub notice: Option<Notice>,
    /// The last act an agent ran, as the status line says it.
    pub agent_said: Option<String>,
    pub sidebar: PaneState,
    pub inspector: PaneState,

    /// The open page's pictures, by `Picture::key`: only what it shows is kept.
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
                note: None,
                back: Vec::new(),
                unfolded: BTreeSet::new(),
                revealed: None,
                pictured: None,
                editor: TextEdit::new(""),
                editing: None,
                bar: BarUi { open: false, scope: "all".into(), edit: TextEdit::new(""), cursor: 0 },
                notice: None,
                agent_said: None,
                sidebar: PaneState::new(280.0).range(180.0, 520.0),
                inspector: PaneState::new(280.0).range(220.0, 440.0),
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
        }
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

    fn level(&self, parent: Option<&str>) -> &[NoteRow] { self.store.read::<Level>(&self.level_ask(parent)).map_or(&[], |level| &level.blocks) }

    /// The note on screen: the one opened, else the outline's first.
    pub fn subject(&self) -> Option<String> { self.note.clone().or_else(|| self.level(None).first().map(|row| row.id.clone())) }

    /// The open note's page, once it has come.
    pub fn page(&self) -> Option<&Page> { self.store.read::<Page>(&self.page_ask(&self.subject()?)) }

    /// The page to draw: the open note's, or the last one while the open note's is on its way.
    pub fn shown(&self) -> Option<&Page> { self.subject().and_then(|_| self.page().or_else(|| self.store.last::<Page>(super::READER, "page"))) }

    /// The open note's page hasn't come yet.
    pub fn loading(&self) -> bool { self.subject().is_some() && self.page().is_none() }

    /// The sidebar's lines: each level's rows, and under an unfolded row its own level once it has come.
    pub fn tree(&self) -> Vec<TreeLine> {
        fn walk(app: &App, parent: Option<&str>, depth: usize, out: &mut Vec<TreeLine>) {
            for row in app.level(parent) {
                out.push(TreeLine { depth, row: row.clone() });
                if app.unfolded.contains(&row.id) { walk(app, Some(&row.id), depth + 1, out) }
            }
        }
        let mut out = Vec::new();
        walk(self, None, 0, &mut out);
        out
    }

    /// The folder a note is listed in, among the levels that have come.
    pub fn parent_of(&self, id: &str) -> Option<String> {
        std::iter::once(None).chain(self.unfolded.iter().map(Some)).find(|parent| self.level(parent.map(String::as_str)).iter().any(|row| row.id == id)).flatten().cloned()
    }

    pub fn picture(&self, picture: &Picture) -> Option<&Shown> { self.pictures.get(&picture.key()) }

    /// The editor holds text the service doesn't.
    pub fn unsaved(&self) -> bool { self.editing.as_ref().is_some_and(|e| self.editor.text != e.base) }

    /// A save is out for the note being edited.
    pub fn saving(&self) -> bool { self.store.out_for(super::draft::saved) }

    /// Everything wanted now: the top level and every unfolded folder for the tree, the open note's page for the
    /// reader, and the bar's question.
    pub fn wants(&self) -> Vec<Want> {
        let mut wants: Vec<Want> = std::iter::once(None).chain(self.unfolded.iter().map(|id| Some(id.as_str()))).map(|parent| Want { tile: "tree".into(), role: "level", ask: self.level_ask(parent) }).collect();
        if let Some(note) = self.subject() { wants.push(Want { tile: super::READER.into(), role: "page", ask: self.page_ask(&note) }) }
        wants.extend(crate::bar::asks(self).into_iter().map(|ask| Want { tile: "bar".into(), role: "rows", ask }));
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

    /// What follows from the open note's page being here, done once for the note and once for each answer: the way
    /// to it unfolds in the tree, and its pictures are the ones held.
    fn follow(&mut self) {
        let Some(note) = self.subject() else { return };
        let ask = self.page_ask(&note);
        let now = (note.clone(), self.store.epoch(&ask));
        if self.pictured.as_ref() == Some(&now) && self.revealed.as_deref() == Some(note.as_str()) { return }
        let Some(page) = self.page().cloned() else { return };
        // Its ancestors unfold, so the sidebar shows where it is.
        // (Once, when it first comes: a folder folded by hand afterwards stays folded.)
        if self.revealed.as_deref() != Some(note.as_str()) {
            self.st.unfolded.extend(page.ancestors.iter().map(|a| a.id.clone()));
            self.st.revealed = Some(note);
        }
        self.want_pictures(&page);
        self.st.pictured = Some(now);
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

    /// An answer landed in a slot. The open note's page in a shape this window can't read is said, not left blank.
    fn landed(&mut self, key: &AskKey) {
        let Some(note) = self.subject() else { return };
        let ask = self.page_ask(&note);
        if ask.key() != *key || self.store.refusal(&ask).is_some() || self.page().is_some() { return }
        self.st.notice = Some(Notice::problem("couldn't read the page: the host answered a shape this window doesn't know"));
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

    /// The key table's memory of a sequence under way (`keys::press` is the one caller).
    pub fn held(&mut self) -> &mut crate::keys::Held { &mut self.held }

    /// The sidebar's pane, for the kit's split view to drag (false: the inspector's).
    pub fn pane(&mut self, sidebar: bool) -> &mut PaneState { if sidebar { &mut self.st.sidebar } else { &mut self.st.inspector } }

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

    /// The note on screen is `id`.
    pub(in crate::actions) fn show(&mut self, id: &str) {
        self.st.note = Some(id.to_string());
    }

    /// This window wrote: what it shows of the open note and of these folders is read now, not when the watch says.
    pub(in crate::actions) fn wrote(&mut self, parents: &[Option<String>]) {
        if let Some(note) = self.subject() { let ask = self.page_ask(&note); self.store.refresh(&ask) }
        let mut seen: HashSet<Option<String>> = HashSet::new();
        for parent in parents {
            if !seen.insert(parent.clone()) { continue }
            if parent.as_ref().is_none_or(|p| self.unfolded.contains(p)) { let ask = self.level_ask(parent.as_deref()); self.store.refresh(&ask) }
        }
    }

    // ── pictures ────────────────────────────────────────────────────────────────────────────────────────────

    /// The pictures `page` shows are the ones held: a file's bytes are asked of the host (`media.read`), an svg
    /// fence's text is the picture already, and what the page no longer shows is let go.
    fn want_pictures(&mut self, page: &Page) {
        let shown: HashSet<String> = page.pictures().map(Picture::key).collect();
        self.st.pictures.retain(|key, _| shown.contains(key));
        for picture in page.pictures() {
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
