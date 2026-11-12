//! What the window holds and how it changes.
//!
//! The screen is a function of what is wanted: the open note, the folders unfolded in the tree, the finder's words,
//! what is being typed. Each wanted thing has a slot named by its key; an answer lands in the slot whose key it
//! carries, or nowhere. So there is no "is this answer still for what's on screen?" to ask: a slot only ever holds
//! the answer to what it wants. What changes in the outline arrives the same way: the service says which watched
//! answer moved (`queries.changed`), and that slot asks again.
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use rune::{Image, ImageCache, TextEdit};
use rune_kit::shell::PaneState;
use serde_json::{Value, json};

use crate::client::{Link, PROTOCOL};
use crate::page::{Facet, NoteRow, Page, Picture};

/// What's wanted, what was asked for, and the newest answer: `get` is the answer to what's wanted now, or nothing.
pub struct Slot<K, V> {
    want: Option<K>,
    asked: Option<K>,
    held: Option<(K, V)>,
}

impl<K: PartialEq + Clone, V> Default for Slot<K, V> {
    fn default() -> Self { Slot { want: None, asked: None, held: None } }
}

impl<K: PartialEq + Clone, V> Slot<K, V> {
    pub fn want(&mut self, key: Option<K>) { self.want = key }
    pub fn wanted(&self) -> Option<&K> { self.want.as_ref() }
    /// The key to ask for, when what's wanted hasn't been asked yet.
    fn due(&mut self) -> Option<K> {
        if self.want.is_none() || self.want == self.asked { return None }
        self.asked = self.want.clone();
        self.want.clone()
    }
    /// What's wanted is asked again (the outline changed it, or the connection came back).
    fn again(&mut self) { self.asked = None }
    fn land(&mut self, key: K, value: V) { if self.want.as_ref() == Some(&key) { self.held = Some((key, value)) } }
    /// The answer to what's wanted now.
    pub fn get(&self) -> Option<&V> { self.held.as_ref().filter(|(key, _)| Some(key) == self.want.as_ref()).map(|(_, value)| value) }
    /// The newest answer, whatever it answered: what stays on screen, dimmed, while the wanted one is on its way.
    pub fn last(&self) -> Option<&V> { self.held.as_ref().map(|(_, value)| value) }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Finder {
    /// Words, ranked by the service's search.
    Find,
    /// The views' grammar (`type=letter mail=waiting`), answered with rows and the facets they carry.
    Query,
}

/// What a finder's question answered: rows, the facets the matches carry (a query's), and the service's hint or refusal.
#[derive(Clone, Debug, Default)]
pub struct Found {
    pub rows: Vec<NoteRow>,
    pub facets: Vec<Facet>,
    pub hint: String,
}

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

/// What the window says above the note. `Trashed` carries the note, so its Undo knows what to bring back.
#[derive(Clone, Debug, PartialEq)]
pub enum Notice {
    Info(String),
    Problem(String),
    Trashed(String),
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

/// What an ask was: the slot its answer lands in, or the write it was.
#[derive(Clone, Debug)]
enum Tag {
    Hello,
    Level(Option<String>),
    Page(String),
    Picture(String),
    Found(Finder, String),
    Saved { note: String, sent: String },
    Created { parent: Option<String> },
    Moved,
    Trashed { note: String, parent: Option<String> },
    Restored { note: String },
}

pub struct App {
    link: Box<dyn Link>,
    /// Makes the link again after it is lost.
    connect: Option<Box<dyn Fn() -> Box<dyn Link>>>,
    /// A headless render steps a virtual clock: each ask waits for its answer, so a frame shows what it asked for.
    pub blocking: bool,
    next: u64,
    asks: HashMap<String, Tag>,

    pub outline: String,
    pub machine: String,
    pub online: bool,

    /// The notes under each unfolded note (`None`: the top level), as the service lists them.
    levels: HashMap<Option<String>, Vec<NoteRow>>,
    asked_levels: HashSet<Option<String>>,
    pub expanded: HashSet<String>,
    /// The sidebar's lines: the unfolded tree, in order.
    pub tree: Vec<TreeLine>,

    pub page: Slot<String, Page>,
    pub back: Vec<String>,
    /// The open page's pictures, by `Picture::key`: only what it shows is kept.
    pictures: HashMap<String, Shown>,
    images: ImageCache,

    /// The editor's text, there whether or not a note is being edited, so a key always has somewhere to land.
    pub editor: TextEdit,
    pub editing: Option<Editing>,

    pub finder: Option<Finder>,
    pub finder_edit: TextEdit,
    pub found: Slot<(Finder, String), Found>,
    pub cursor: usize,

    pub notice: Option<Notice>,
    pub sidebar: PaneState,
    pub inspector: PaneState,
}

impl App {
    pub fn new(link: Box<dyn Link>, outline: &str) -> App {
        App {
            link,
            connect: None,
            blocking: false,
            next: 0,
            asks: HashMap::new(),
            outline: outline.to_string(),
            machine: String::new(),
            online: true,
            levels: HashMap::new(),
            asked_levels: HashSet::new(),
            expanded: HashSet::new(),
            tree: Vec::new(),
            page: Slot::default(),
            back: Vec::new(),
            pictures: HashMap::new(),
            // Until the window gives its waker, a decoded picture wakes nobody (a test's window is driven by hand).
            images: ImageCache::new(Arc::new(|| {})),
            editor: TextEdit::new(""),
            editing: None,
            finder: None,
            finder_edit: TextEdit::new(""),
            found: Slot::default(),
            cursor: 0,
            notice: None,
            sidebar: PaneState::new(280.0).range(180.0, 520.0),
            inspector: PaneState::new(280.0).range(220.0, 440.0),
        }
    }

    pub fn reconnecting(mut self, connect: Box<dyn Fn() -> Box<dyn Link>>) -> App {
        self.connect = Some(connect);
        self
    }

    pub fn set_waker(&mut self, waker: rune::Waker) {
        // A picture that finishes decoding wakes the window to draw it.
        self.images = ImageCache::new(waker.clone());
        self.pictures.clear();
        self.link.set_waker(waker);
    }

    // ── asking ──────────────────────────────────────────────────────────────────────────────────────────────

    fn ask(&mut self, tag: Tag, action: &str, mut request: Value) {
        self.next += 1;
        let id = format!("n{}", self.next);
        request["id"] = json!(id);
        request["action"] = json!(action);
        request["outline"] = json!(self.outline);
        self.link.send(&request);
        if self.blocking { self.link.wait(&id, Duration::from_secs(20)) }
        self.asks.insert(id, tag);
    }

    /// Asks for whatever is wanted and not yet asked: the top level and every unfolded note's children, the open
    /// note's page, the finder's question. Each is a watched read, so the service says when its answer moves.
    fn pump(&mut self) {
        let wanted: Vec<Option<String>> = std::iter::once(None).chain(self.expanded.iter().cloned().map(Some)).collect();
        for parent in wanted {
            if self.asked_levels.insert(parent.clone()) { self.ask_level(parent, Read::Watch) }
        }
        if let Some(note) = self.page.due() { self.ask_page(note, Read::Watch) }
        if let Some((kind, words)) = self.found.due() { self.ask_found(kind, words, Read::Watch) }
    }

    fn ask_level(&mut self, parent: Option<String>, read: Read) {
        let watch = watched(&format!("tree:{}", parent.as_deref().unwrap_or("")), read);
        self.ask(Tag::Level(parent.clone()), "blocks.read", merged(json!({ "under": parent, "fields": ["title", "hasChildren"] }), watch));
    }

    fn ask_page(&mut self, note: String, read: Read) {
        let watch = watched("page", read);
        self.ask(Tag::Page(note.clone()), "notes.page", merged(json!({ "blockId": note }), watch));
    }

    fn ask_found(&mut self, kind: Finder, words: String, read: Read) {
        let tag = Tag::Found(kind, words.clone());
        match kind {
            Finder::Find => self.ask(tag, "tree.search", json!({ "query": words, "limit": 30, "semantic": false })),
            Finder::Query => {
                let query = json!({ "query": { "where": words, "limit": 200, "facets": true, "facetValues": 8 }, "fields": ["title", "hasChildren", "timestamps"] });
                self.ask(tag, "blocks.query", merged(query, watched("found", read)));
            }
        }
    }

    /// The first asks: who answers, then whatever is wanted.
    pub fn start(&mut self) {
        self.ask(Tag::Hello, "ping", json!({}));
        self.pump();
    }

    /// Lands everything asked so far, and what that asked in turn: for a blocking link, whose answers are already here.
    pub fn settle(&mut self) -> bool {
        let mut any = false;
        while self.take() { any = true }
        any
    }

    /// Lands whatever the host has said. True when something landed.
    pub fn take(&mut self) -> bool {
        let said = self.link.take();
        let any = !said.is_empty();
        for line in said {
            if let Some(id) = line["id"].as_str() {
                let Some(tag) = self.asks.remove(id) else { continue };
                if line["ok"] == true { self.answered(tag, &line["result"]) } else { self.refused(tag, line["kind"].as_str().unwrap_or("failed"), line["error"].as_str().unwrap_or("refused")) }
            } else if line["event"]["action"] == "queries.changed" {
                for change in line["event"]["changes"].as_array().into_iter().flatten() { self.changed(change) }
            } else if line["link"] == "lost" {
                self.online = false;
                self.asks.clear();
                self.notice = Some(Notice::Problem(format!("Offline: {}", line["detail"].as_str().unwrap_or("the connection ended"))));
            }
        }
        self.pump();
        any
    }

    /// A watched answer moved: read it by the generation the service named. One it dropped is asked for afresh.
    fn changed(&mut self, change: &Value) {
        let read = if change["dropped"] == true { Read::Watch } else { Read::At(change["generation"].clone()) };
        match change["key"].as_str().unwrap_or("") {
            "page" => if let Some(note) = self.page.wanted().cloned() { self.ask_page(note, read) },
            "found" => if let Some((kind, words)) = self.found.wanted().cloned() { self.ask_found(kind, words, read) },
            key => if let Some(parent) = key.strip_prefix("tree:") {
                let parent = (!parent.is_empty()).then(|| parent.to_string());
                if parent.as_ref().is_none_or(|p| self.expanded.contains(p)) { self.ask_level(parent, read) }
            },
        }
    }

    /// The link is lost: make it again and ask for everything wanted (its watches ended with it). True when it came back.
    pub fn reconnect(&mut self) -> bool {
        let Some(connect) = &self.connect else { return false };
        self.link = connect();
        self.asks.clear();
        self.asked_levels.clear();
        self.page.again();
        self.found.again();
        self.online = true;
        self.notice = Some(Notice::Info("Back online.".into()));
        self.start();
        true
    }

    fn answered(&mut self, tag: Tag, result: &Value) {
        match tag {
            Tag::Hello => {
                let theirs = result["protocolVersion"].as_u64().unwrap_or(0);
                if theirs != PROTOCOL {
                    // Refuse, naming the side to update, as every client does.
                    self.online = false;
                    let behind = if theirs < PROTOCOL { "the outline host is older: run `ep0ch install --apply`" } else { "this window is older: build it again from the checkout" };
                    self.notice = Some(Notice::Problem(format!("Protocol {PROTOCOL} here, {theirs} on the host; {behind}.")));
                    return;
                }
                self.machine = result["location"]["machine"].as_str().unwrap_or("").to_string();
            }
            Tag::Level(parent) => {
                self.levels.insert(parent, rows(&result["blocks"]));
                self.unfold();
                // Nothing open yet: the window opens on the first note.
                if self.page.wanted().is_none() && let Some(first) = self.tree.first().map(|line| line.row.id.clone()) { self.show(&first) }
            }
            Tag::Page(note) => match serde_json::from_value::<Page>(result.clone()) {
                Ok(page) => {
                    // Its ancestors unfold, so the sidebar shows where it is.
                    // (Once, when it first comes: a folder folded by hand afterwards stays folded.)
                    if self.page.wanted() == Some(&note) && self.page.get().is_none() {
                        self.expanded.extend(page.ancestors.iter().map(|a| a.id.clone()));
                        self.unfold();
                    }
                    if self.page.wanted() == Some(&note) { self.want_pictures(&page) }
                    self.page.land(note, page);
                }
                Err(e) => self.notice = Some(Notice::Problem(format!("couldn't read the page: {e}"))),
            },
            Tag::Picture(key) => {
                let bytes = base64::engine::general_purpose::STANDARD.decode(result["base64"].as_str().unwrap_or(""));
                let shown = match bytes {
                    Ok(bytes) => self.decoded(bytes, result["mime"].as_str().unwrap_or("")),
                    Err(e) => Shown::Failed(format!("its bytes didn't arrive whole: {e}")),
                };
                self.pictures.insert(key, shown);
            }
            Tag::Found(kind, words) => {
                let found = match kind {
                    Finder::Find => Found { rows: result["matches"].as_array().into_iter().flatten().map(|m| NoteRow { id: text(&m["block"]["id"]), title: text(&m["title"]), has_children: false, context: text(&m["path"]) }).collect(), ..Found::default() },
                    Finder::Query => Found {
                        rows: result["blocks"].as_array().into_iter().flatten().map(|b| NoteRow { id: text(&b["id"]), title: text(&b["title"]), has_children: b["hasChildren"] == true, context: day(&text(&b["updatedAt"])) }).collect(),
                        facets: serde_json::from_value(result["facets"].clone()).unwrap_or_default(),
                        hint: text(&result["hint"]),
                    },
                };
                self.found.land((kind, words), found);
                self.cursor = 0;
            }
            Tag::Saved { note, sent } => {
                let revision = result["revision"].as_u64().unwrap_or(0);
                // Saving never ends editing: what the service holds is now what was sent, and the editor goes on.
                if let Some(e) = self.editing.as_mut().filter(|e| e.note == note) {
                    e.revision = revision;
                    e.base = sent;
                    self.notice = Some(Notice::Info(format!("Saved · revision {revision}")));
                }
                self.wrote(&[]);
            }
            Tag::Created { parent } => {
                let (id, revision) = (text(&result["id"]), result["revision"].as_u64().unwrap_or(0));
                self.wrote(&[parent]);
                self.show(&id);
                // A new note opens to be written, at the revision the service made it at.
                self.editor = focused(&text(&result["text"]));
                self.editing = Some(Editing { note: id, revision, base: text(&result["text"]) });
            }
            Tag::Moved => {
                let said = text(&result["said"]);
                if !said.is_empty() { self.notice = Some(Notice::Info(said)) }
                self.wrote(&[opt(&result["parentId"]), opt(&result["previousParentId"])]);
            }
            Tag::Trashed { note, parent } => {
                self.notice = Some(Notice::Trashed(note));
                self.wrote(&[parent.clone()]);
                match parent { Some(parent) => self.show(&parent), None => self.page.want(None) }
            }
            Tag::Restored { note } => {
                self.notice = Some(Notice::Info("Back from the Trash.".into()));
                self.wrote(&[opt(&result["parentId"])]);
                self.show(&note);
            }
        }
    }

    /// This window wrote: what it shows of the open note and of these folders is read now, not when the watch says.
    fn wrote(&mut self, parents: &[Option<String>]) {
        if let Some(note) = self.page.wanted().cloned() { self.ask_page(note, Read::Now) }
        for parent in parents {
            if parent.as_ref().is_none_or(|p| self.expanded.contains(p)) { self.ask_level(parent.clone(), Read::Now) }
        }
    }

    /// A refusal keeps what the person wrote in front of them, with the service's own words.
    fn refused(&mut self, tag: Tag, kind: &str, error: &str) {
        match tag {
            Tag::Saved { .. } if kind == "stale-revision" || kind == "conflict" => {
                self.notice = Some(Notice::Problem("Not saved: the note changed since you opened it. Your text is still here; copy it, discard to see the new note, then edit again.".into()));
            }
            // A picture the host can't read says so where the picture would be.
            Tag::Picture(key) => { self.pictures.insert(key, Shown::Failed(error.to_string())); }
            // A question the service can't read answers with its words, where the rows would be.
            Tag::Found(kind, words) => self.found.land((kind, words), Found { hint: error.to_string(), ..Found::default() }),
            _ => self.notice = Some(Notice::Problem(error.to_string())),
        }
    }

    // ── pictures ────────────────────────────────────────────────────────────────────────────────────────────

    /// The pictures `page` shows are the ones held: a file's bytes are asked of the host (`media.read`), an svg
    /// fence's text is the picture already, and what the page no longer shows is let go.
    fn want_pictures(&mut self, page: &Page) {
        let shown: HashSet<String> = page.pictures().map(Picture::key).collect();
        self.pictures.retain(|key, _| shown.contains(key));
        for picture in page.pictures() {
            let key = picture.key();
            if self.pictures.contains_key(&key) { continue }
            match (&picture.svg, &picture.path) {
                (Some(svg), _) => { let drawn = self.decoded(svg.clone().into_bytes(), "image/svg+xml"); self.pictures.insert(key, drawn); }
                (None, Some(path)) => {
                    self.pictures.insert(key.clone(), Shown::Asked);
                    self.ask(Tag::Picture(key), "media.read", json!({ "path": path }));
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

    pub fn picture(&self, picture: &Picture) -> Option<&Shown> { self.pictures.get(&picture.key()) }

    // ── the tree ────────────────────────────────────────────────────────────────────────────────────────────

    /// Rebuilds the sidebar's lines: each level's rows, and under an unfolded row its own level once it has come.
    fn unfold(&mut self) {
        fn walk(app: &App, parent: &Option<String>, depth: usize, out: &mut Vec<TreeLine>) {
            for row in app.levels.get(parent).into_iter().flatten() {
                out.push(TreeLine { depth, row: row.clone() });
                if app.expanded.contains(&row.id) { walk(app, &Some(row.id.clone()), depth + 1, out) }
            }
        }
        let mut out = Vec::new();
        walk(self, &None, 0, &mut out);
        self.tree = out;
    }

    pub fn toggle(&mut self, id: &str) {
        if !self.expanded.remove(id) { self.expanded.insert(id.to_string()); }
        // A folded note's level is forgotten, so unfolding it again asks (and watches) afresh.
        self.asked_levels.retain(|parent| parent.as_ref().is_none_or(|p| self.expanded.contains(p)));
        self.unfold();
        self.pump();
    }

    fn parent_of(&self, id: &str) -> Option<String> {
        self.levels.iter().find(|(_, rows)| rows.iter().any(|r| r.id == id)).and_then(|(parent, _)| parent.clone())
    }

    /// The note on screen is `id`.
    fn show(&mut self, id: &str) {
        self.page.want(Some(id.to_string()));
        self.finder = None;
        self.pump();
    }

    /// Opens a note, remembering where from. Unsaved text stays where it is: another note won't open over it.
    pub fn open(&mut self, id: &str) {
        if self.unsaved() && self.editing.as_ref().is_some_and(|e| e.note != id) {
            self.notice = Some(Notice::Problem("This note has unsaved text. Save it (⌘S) or discard it before opening another.".into()));
            return;
        }
        if self.editing.as_ref().is_some_and(|e| e.note != id) { self.editing = None }
        if let Some(from) = self.page.wanted().filter(|from| from.as_str() != id) { self.back.push(from.clone()) }
        self.show(id);
    }

    pub fn go_back(&mut self) {
        if let Some(id) = self.back.pop() { self.show(&id) }
    }

    /// A link in prose (outline-core's note-page.ts): `ep0ch:b/<id>` is a note; `ep0ch:p/<address>` a page nobody has made yet.
    pub fn follow(&mut self, href: &str) {
        if let Some(id) = href.strip_prefix("ep0ch:b/") { self.open(id) }
        else if href.starts_with("ep0ch:p/") { self.notice = Some(Notice::Info("No note has that page address yet.".into())) }
        else { self.notice = Some(Notice::Info(format!("A web link: {href}"))) }
    }

    /// The page to draw: the open note's, or the last one while the open note's is on its way.
    pub fn shown(&self) -> Option<&Page> { self.page.wanted().and_then(|_| self.page.get().or(self.page.last())) }
    /// The open note's page hasn't come yet.
    pub fn loading(&self) -> bool { self.page.wanted().is_some() && self.page.get().is_none() }

    // ── writing ─────────────────────────────────────────────────────────────────────────────────────────────

    fn mutation(&self) -> Value { json!({ "author": "user", "actorId": format!("ep0ch-native:{}", self.machine) }) }

    pub fn edit(&mut self) {
        let Some(p) = self.page.get() else { return };
        if self.editing.is_some() { return }
        self.editing = Some(Editing { note: p.id.clone(), revision: p.revision, base: p.text.clone() });
        self.editor = focused(&p.text);
    }

    /// The editor holds text the service doesn't.
    pub fn unsaved(&self) -> bool { self.editing.as_ref().is_some_and(|e| self.editor.text != e.base) }

    /// Leaves the editor. With unsaved text it stays, and says how to keep or drop it: closing never loses words.
    pub fn done_editing(&mut self) {
        if self.unsaved() { self.notice = Some(Notice::Problem("Unsaved text. ⌘S saves it; Discard drops it.".into())) }
        else { self.discard() }
    }

    /// Leaves the editor and drops what it holds unsaved: only ever asked for by name.
    pub fn discard(&mut self) {
        self.editing = None;
        if matches!(self.notice, Some(Notice::Problem(_))) { self.notice = None }
    }

    /// A save is out for the note being edited.
    pub fn saving(&self) -> bool { self.asks.values().any(|tag| matches!(tag, Tag::Saved { .. })) }

    pub fn save(&mut self) {
        let Some(e) = &self.editing else { return };
        if self.saving() { return }
        let (note, sent, request) = (e.note.clone(), self.editor.text.clone(), json!({ "blockId": e.note, "text": self.editor.text, "expectedRevision": e.revision, "mutation": self.mutation() }));
        self.ask(Tag::Saved { note, sent }, "update", request);
    }

    /// A new note under the open one (or at the top level), opened to be written.
    pub fn new_child(&mut self) {
        let parent = self.page.wanted().cloned();
        if let Some(p) = &parent { self.expanded.insert(p.clone()); }
        // A person's new note names no client: the store records who made a block, and a person is "user".
        self.ask(Tag::Created { parent: parent.clone() }, "create", json!({ "parentId": parent, "text": "", "author": "user" }));
    }

    /// `step`: up, down, in or out, as the service's move reads them.
    pub fn step(&mut self, step: &str) {
        let Some(p) = self.page.get() else { return };
        let request = json!({ "blockId": p.id, "expectedRevision": p.revision, "step": step, "mutation": self.mutation() });
        self.ask(Tag::Moved, "move", request);
    }

    pub fn trash(&mut self) {
        let Some(id) = self.page.wanted().cloned() else { return };
        let parent = self.shown().filter(|p| p.id == id).and_then(|p| p.ancestors.last().map(|a| a.id.clone())).or_else(|| self.parent_of(&id));
        self.editing = None;
        let request = json!({ "blockId": id, "mutation": self.mutation() });
        self.ask(Tag::Trashed { note: id, parent }, "delete", request);
    }

    pub fn restore(&mut self) {
        let Some(Notice::Trashed(note)) = self.notice.clone() else { return };
        self.ask(Tag::Restored { note: note.clone() }, "trash.restore", json!({ "blockId": note }));
    }

    // ── finding ─────────────────────────────────────────────────────────────────────────────────────────────

    pub fn find(&mut self, kind: Finder, seed: &str) {
        self.finder = Some(kind);
        self.finder_edit = focused(seed);
        self.find_changed();
    }

    /// The words changed: that question is what's wanted now. An answer to older words has no slot to land in.
    pub fn find_changed(&mut self) {
        let Some(kind) = self.finder else { return };
        let words = self.finder_edit.text.clone();
        self.found.want((kind == Finder::Query || !words.trim().is_empty()).then_some((kind, words)));
        self.pump();
    }

    pub fn finding(&self) -> bool { self.found.wanted().is_some() && self.found.get().is_none() }

    pub fn find_move(&mut self, by: isize) {
        let rows = self.found.get().map_or(0, |f| f.rows.len());
        if rows > 0 { self.cursor = (self.cursor as isize + by).rem_euclid(rows as isize) as usize }
    }

    pub fn find_open(&mut self) {
        if let Some(id) = self.found.get().and_then(|f| f.rows.get(self.cursor)).map(|r| r.id.clone()) { self.open(&id) }
    }

    /// A facet value picked: the query gains `key=value`, in the views' grammar.
    pub fn narrow(&mut self, key: &str, value: &str) {
        let term = if value.contains(' ') { format!("{key}=\"{value}\"") } else { format!("{key}={value}") };
        let now = self.finder_edit.text.trim().to_string();
        if now.split_whitespace().any(|word| word == term) { return }
        self.finder = Some(Finder::Query);
        self.finder_edit = focused(&if now.is_empty() { term } else { format!("{now} {term}") });
        self.find_changed();
    }
}

fn text(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }
fn opt(v: &Value) -> Option<String> { v.as_str().map(str::to_string) }
/// An ISO time's day, which is all a list row has room for.
fn day(iso: &str) -> String { iso.get(..10).unwrap_or(iso).to_string() }
fn rows(v: &Value) -> Vec<NoteRow> { serde_json::from_value(v.clone()).unwrap_or_default() }

/// How a read is asked for.
enum Read {
    /// Answered now and kept as a watched answer: the service says when it moves.
    Watch,
    /// The kept answer at the generation a `queries.changed` named.
    At(Value),
    /// Answered now and not kept: after this window's own write, when the kept answer is the one from before it.
    Now,
}

/// The watch fields a read carries under `key`.
fn watched(key: &str, read: Read) -> Value {
    match read {
        Read::Watch => json!({ "watch": key }),
        Read::At(generation) => json!({ "watch": key, "generation": generation }),
        Read::Now => json!({}),
    }
}

fn merged(mut request: Value, more: Value) -> Value {
    if let (Some(into), Some(from)) = (request.as_object_mut(), more.as_object()) { into.extend(from.clone()) }
    request
}

/// A field that takes the keyboard when it appears, the caret at its end.
fn focused(text: &str) -> TextEdit {
    let mut edit = TextEdit::new(text);
    edit.focused = true;
    edit
}
