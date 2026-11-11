//! What the window holds and how it changes. The bridge's answers land here as they are: a tree of titles, a page
//! of parts, rows. The app decides what is open, expanded or being typed; the outline's meaning stays the service's.
use std::collections::{HashMap, HashSet};
use std::time::Duration;

use rune::TextEdit;
use rune_kit::shell::PaneState;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::bridge::Bridge;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct TreeRow {
    pub id: String,
    pub parent: Option<String>,
    pub depth: usize,
    pub title: String,
    #[serde(rename = "hasChildren", default)]
    pub has_children: bool,
}

/// A note in a list: a child, a query's row, a backlink, a search match.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Row {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub snippet: String,
    #[serde(default)]
    pub props: HashMap<String, String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Chip {
    pub key: String,
    pub value: String,
}

/// One row of a links group or a fields list: what it says, the note it opens (none: it opens nothing), a quiet word after it.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct PageRow {
    pub text: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Group {
    pub name: String,
    #[serde(default)]
    pub rows: Vec<PageRow>,
    #[serde(default)]
    pub empty: Option<String>,
}

/// A view's row as the service lists it: the note, its label, and a cell per column.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct ListRow {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub cells: Vec<Value>,
}

impl ListRow {
    /// A cell's words: it is text, a number, or an object with `text`.
    pub fn cell(v: &Value) -> String {
        match v {
            Value::String(s) => s.clone(),
            Value::Object(o) => o.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
            Value::Null => String::new(),
            other => other.to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ListView {
    #[serde(default)]
    pub rows: Vec<ListRow>,
    #[serde(default)]
    pub headers: Vec<String>,
    #[serde(default)]
    pub columns: Vec<String>,
}

/// What every component part carries (outline-core's note-page.ts): its name and source as written, and the service's word on its answer.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Frame {
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
    pub source: String,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// A part of a page, as `notes.page` answers it.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Part {
    Prose { markdown: String },
    /// A `::graph-*` figure: the props it draws from, answered, and the same results as Markdown.
    Figure {
        #[serde(flatten)]
        frame: Frame,
        figure: String,
        #[serde(default)]
        props: Value,
        #[serde(default)]
        markdown: Option<String>,
    },
    /// A `::view` or a query-backed table: the view's own list.
    View {
        #[serde(flatten)]
        frame: Frame,
        view: ListView,
        #[serde(default)]
        truncated: bool,
    },
    /// A `::links` and its kin, or a `::fields`: named groups of rows.
    Rows {
        #[serde(flatten)]
        frame: Frame,
        #[serde(default)]
        groups: Vec<Group>,
    },
    /// A component the service answers nothing for: its source.
    Component {
        #[serde(flatten)]
        frame: Frame,
    },
}

impl Part {
    /// Whether this part lists the note `id`: a change to it means the page should be read again.
    pub fn lists(&self, id: &str) -> bool {
        match self {
            Part::View { view, .. } => view.rows.iter().any(|r| r.id == id),
            Part::Rows { groups, .. } => groups.iter().any(|g| g.rows.iter().any(|r| r.id.as_deref() == Some(id))),
            _ => false,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Page {
    pub id: String,
    pub revision: u64,
    pub title: String,
    #[serde(default)]
    pub path: String,
    pub text: String,
    #[serde(default)]
    pub chips: Vec<Chip>,
    #[serde(default)]
    pub properties: Vec<Chip>,
    #[serde(default)]
    pub updated: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub parts: Vec<Part>,
    #[serde(default)]
    pub children: Vec<Row>,
    #[serde(default)]
    pub backlinks: Vec<Row>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Facet {
    pub key: String,
    #[serde(default)]
    pub values: Vec<FacetValue>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct FacetValue {
    pub value: String,
    pub count: u64,
}

/// The note being typed in: its source, and the revision it was read at (what a save names).
pub struct Draft {
    pub note: String,
    pub revision: u64,
    pub edit: TextEdit,
    pub saving: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Finder {
    /// Words, ranked by the service's search.
    Find,
    /// The views' grammar (`type=letter mail=waiting`), answered with rows and the facets they carry.
    Query,
}

pub struct Palette {
    pub kind: Finder,
    pub edit: TextEdit,
    pub asked: String,
    pub rows: Vec<Row>,
    pub cursor: usize,
    pub hint: String,
    pub facets: Vec<Facet>,
    pub pending: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Tone {
    Info,
    Problem,
}

/// What an ask was for, kept until its answer lands.
#[derive(Clone, Debug)]
enum Pending {
    Hello,
    Tree,
    Page { note: String },
    Save { note: String, sent: String },
    Created,
    Moved,
    Trashed { note: String, parent: Option<String> },
    Restored,
    Follow,
    Found { kind: Finder, asked: String },
}

pub struct App {
    pub bridge: Bridge,
    pub outline: String,
    pub machine: String,
    pub outlines: Vec<String>,
    pub tree: Vec<TreeRow>,
    pub expanded: HashSet<String>,
    /// Indices into `tree` of the rows whose ancestors are all open: what the sidebar lists.
    pub visible: Vec<usize>,
    pub selected: Option<String>,
    pub page: Option<Page>,
    pub loading: bool,
    pub back: Vec<String>,
    pub draft: Option<Draft>,
    pub palette: Option<Palette>,
    pub notice: Option<(Tone, String)>,
    /// The last note put in the Trash here, for the notice's undo.
    pub trashed: Option<String>,
    pub online: bool,
    pub sidebar: PaneState,
    pub inspector: PaneState,
    /// Where a key lands when its field closed in the same frame (a save answered, a palette dismissed).
    pub sink: TextEdit,
    pending: HashMap<u64, Pending>,
}

impl App {
    pub fn new(bridge: Bridge) -> App {
        App {
            bridge,
            outline: String::new(),
            machine: String::new(),
            outlines: Vec::new(),
            tree: Vec::new(),
            expanded: HashSet::new(),
            visible: Vec::new(),
            selected: None,
            page: None,
            loading: true,
            back: Vec::new(),
            draft: None,
            palette: None,
            notice: None,
            trashed: None,
            online: true,
            sidebar: PaneState::new(280.0).range(180.0, 520.0),
            inspector: PaneState::new(280.0).range(220.0, 440.0),
            sink: TextEdit::new(""),
            pending: HashMap::new(),
        }
    }

    fn ask(&mut self, ask: Value, pending: Pending) -> u64 {
        let id = self.bridge.ask(ask);
        self.pending.insert(id, pending);
        id
    }

    /// The first asks: who answers, and the tree.
    pub fn start(&mut self) {
        self.ask(json!({ "op": "hello" }), Pending::Hello);
        self.ask(json!({ "op": "tree" }), Pending::Tree);
    }

    /// Waits for everything asked so far and lands it: a headless render has no later frame to show it in. True when
    /// something landed.
    pub fn settle(&mut self) -> bool {
        let mut any = false;
        for _ in 0..8 {
            let Some(&id) = self.pending.keys().max() else { break };
            if !self.bridge.wait(id, Duration::from_secs(20)) { break }
            any |= self.take();
        }
        any
    }

    /// Lands whatever the bridge has said. True when something on screen changed.
    pub fn take(&mut self) -> bool {
        let said = self.bridge.drain();
        let any = !said.is_empty();
        for v in said {
            match v["id"].as_u64() {
                Some(id) => {
                    let Some(pending) = self.pending.remove(&id) else { continue };
                    if v["ok"] == true { self.answered(pending, v["result"].clone()) } else { self.refused(pending, v["kind"].as_str().unwrap_or("failed"), v["error"].as_str().unwrap_or("refused")) }
                }
                None => self.event(&v),
            }
        }
        any
    }

    fn event(&mut self, v: &Value) {
        match v["event"].as_str().unwrap_or("") {
            "changed" => {
                let ids: Vec<&str> = v["ids"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
                if v["structural"] == true { self.ask(json!({ "op": "tree" }), Pending::Tree); }
                let Some(open) = self.selected.clone() else { return };
                let shown = self.page.as_ref();
                // The open note, or one it lists (a child retitled, a query's row), changed: read it again.
                let touches = ids.iter().any(|id| *id == open || shown.is_some_and(|p| p.children.iter().any(|c| c.id == *id) || p.parts.iter().any(|part| part.lists(id))));
                if !touches { return }
                match &self.draft {
                    // Someone else wrote the note being typed in: the draft stays, and a save will say so.
                    Some(d) if d.note == open && !d.saving => self.notice = Some((Tone::Info, "This note changed while you were typing. Your text is kept; saving will ask the service to compare.".into())),
                    Some(_) => {}
                    None => { self.ask(json!({ "op": "page", "note": open }), Pending::Page { note: open }); }
                }
            }
            "connection" => {
                self.online = v["state"] == "restored";
                let detail = v["detail"].as_str().unwrap_or("");
                self.notice = Some(if self.online { (Tone::Info, format!("Back online: {detail}")) } else { (Tone::Problem, format!("Offline: {detail}")) });
                if self.online { self.ask(json!({ "op": "tree" }), Pending::Tree); }
            }
            "fatal" | "stderr" => {
                self.online = false;
                self.loading = false;
                self.notice = Some((Tone::Problem, v["error"].as_str().unwrap_or("the bridge failed").to_string()));
            }
            _ => {}
        }
    }

    fn answered(&mut self, pending: Pending, result: Value) {
        match pending {
            Pending::Hello => {
                self.outline = result["outline"].as_str().unwrap_or("").into();
                self.machine = result["machine"].as_str().unwrap_or("").into();
                self.outlines = serde_json::from_value(result["outlines"].clone()).unwrap_or_default();
            }
            Pending::Tree => {
                self.tree = serde_json::from_value(result["rows"].clone()).unwrap_or_default();
                self.reveal();
                if self.selected.is_none() {
                    let first = self.tree.first().map(|r| r.id.clone());
                    match first { Some(id) => self.open(&id), None => self.loading = false }
                }
            }
            Pending::Page { note } => {
                if self.selected.as_deref() != Some(note.as_str()) { return }
                match serde_json::from_value::<Page>(result) {
                    Ok(page) => { self.page = Some(page); self.loading = false }
                    Err(e) => self.problem(format!("couldn't read the page: {e}")),
                }
            }
            Pending::Save { note, sent } => {
                let Ok(page) = serde_json::from_value::<Page>(result) else { return };
                match &mut self.draft {
                    // Typed on while the save was out: the editor stays, now on the saved revision, with the newer text.
                    Some(d) if d.note == note && d.edit.text != sent => {
                        d.revision = page.revision;
                        d.saving = false;
                        self.notice = Some((Tone::Info, format!("Saved revision {} · what you typed since is not saved yet", page.revision)));
                    }
                    Some(d) if d.note == note => {
                        self.draft = None;
                        self.notice = Some((Tone::Info, format!("Saved · revision {}", page.revision)));
                    }
                    _ => {}
                }
                if self.selected.as_deref() == Some(note.as_str()) { self.page = Some(page) }
                self.ask(json!({ "op": "tree" }), Pending::Tree);
            }
            Pending::Created => {
                self.ask(json!({ "op": "tree" }), Pending::Tree);
                if let Some(id) = result["id"].as_str() {
                    let id = id.to_string();
                    self.open(&id);
                    // A new note opens to be written.
                    self.draft = Some(Draft { note: id, revision: 1, edit: focused(""), saving: false });
                }
            }
            Pending::Moved => {
                let said = result["said"].as_str().unwrap_or("");
                if !said.is_empty() { self.notice = Some((Tone::Info, said.to_string())) }
                self.ask(json!({ "op": "tree" }), Pending::Tree);
                if let Some(open) = self.selected.clone() { self.ask(json!({ "op": "page", "note": open }), Pending::Page { note: open }); }
            }
            Pending::Trashed { note, parent } => {
                self.notice = Some((Tone::Info, "Moved to the Trash.".into()));
                self.trashed = Some(note);
                self.ask(json!({ "op": "tree" }), Pending::Tree);
                match parent { Some(p) => self.open(&p), None => { self.selected = None; self.page = None } }
            }
            Pending::Restored => {
                self.notice = Some((Tone::Info, "Back from the Trash.".into()));
                if let Some(id) = self.trashed.take() { self.open(&id) }
                self.ask(json!({ "op": "tree" }), Pending::Tree);
            }
            Pending::Follow => {
                if let Some(id) = result["id"].as_str() { let id = id.to_string(); self.open(&id) }
                else if let Some(url) = result["url"].as_str() { self.notice = Some((Tone::Info, format!("A web link: {url}"))) }
            }
            Pending::Found { kind, asked } => {
                let Some(p) = &mut self.palette else { return };
                if p.kind != kind || p.edit.text != asked { return }
                p.rows = serde_json::from_value(result["rows"].clone()).unwrap_or_default();
                p.facets = serde_json::from_value(result["facets"].clone()).unwrap_or_default();
                p.hint = result["hint"].as_str().unwrap_or("").into();
                p.cursor = 0;
                p.pending = false;
                p.asked = asked;
            }
        }
    }

    /// A refusal keeps what the person wrote in front of them, with the service's own words.
    fn refused(&mut self, pending: Pending, kind: &str, error: &str) {
        match pending {
            Pending::Save { .. } => {
                if let Some(d) = &mut self.draft { d.saving = false }
                let why = if kind == "stale-revision" || kind == "conflict" { "Not saved: the note changed since you opened it. Your text is still here; copy it, cancel to see the new note, then edit again." } else { error };
                self.notice = Some((Tone::Problem, why.to_string()));
            }
            Pending::Found { kind: finder, asked } => {
                if let Some(p) = self.palette.as_mut().filter(|p| p.kind == finder && p.edit.text == asked) {
                    p.pending = false;
                    p.rows.clear();
                    p.facets.clear();
                    p.hint = error.to_string();
                }
            }
            Pending::Page { .. } | Pending::Tree | Pending::Hello => { self.loading = false; self.problem(error.to_string()) }
            _ => self.problem(error.to_string()),
        }
    }

    fn problem(&mut self, text: String) { self.notice = Some((Tone::Problem, text)) }

    // ── the tree ────────────────────────────────────────────────────────────────────────────────────────────

    fn row(&self, id: &str) -> Option<&TreeRow> { self.tree.iter().find(|r| r.id == id) }

    /// Rebuilds the listed rows: a row shows when every ancestor is open. The tree arrives in walk order, so one
    /// pass with the depth of the nearest closed ancestor does it.
    pub fn reveal(&mut self) {
        let mut closed_at: Option<usize> = None;
        self.visible.clear();
        for (i, r) in self.tree.iter().enumerate() {
            if let Some(d) = closed_at { if r.depth > d { continue } closed_at = None }
            self.visible.push(i);
            if r.has_children && !self.expanded.contains(&r.id) { closed_at = Some(r.depth) }
        }
    }

    pub fn toggle(&mut self, id: &str) {
        if !self.expanded.remove(id) { self.expanded.insert(id.to_string()); }
        self.reveal();
    }

    /// Opens a note: its ancestors unfold so the sidebar shows where it is.
    pub fn open(&mut self, id: &str) {
        if self.draft.as_ref().is_some_and(|d| d.edit.text != self.page.as_ref().map_or("", |p| p.text.as_str()) && d.note != id) {
            self.notice = Some((Tone::Problem, "This note has unsaved text. Save it (⌘S) or cancel (Esc) before opening another.".into()));
            return;
        }
        self.draft = None;
        if let Some(from) = self.selected.as_deref().filter(|s| *s != id) { self.back.push(from.to_string()); }
        let mut at = self.row(id).and_then(|r| r.parent.clone());
        while let Some(p) = at {
            at = self.row(&p).and_then(|r| r.parent.clone());
            self.expanded.insert(p);
        }
        self.reveal();
        self.selected = Some(id.to_string());
        self.loading = self.page.as_ref().is_none_or(|p| p.id != id);
        self.palette = None;
        self.ask(json!({ "op": "page", "note": id }), Pending::Page { note: id.to_string() });
    }

    pub fn go_back(&mut self) {
        if let Some(id) = self.back.pop() {
            self.open(&id);
            self.back.pop();
        }
    }

    /// A link in prose: the bridge says what it leads to.
    pub fn follow(&mut self, href: &str) { self.ask(json!({ "op": "follow", "href": href }), Pending::Follow); }

    // ── writing ─────────────────────────────────────────────────────────────────────────────────────────────

    pub fn edit(&mut self) {
        let Some(p) = &self.page else { return };
        if self.draft.is_none() { self.draft = Some(Draft { note: p.id.clone(), revision: p.revision, edit: focused(&p.text), saving: false }) }
    }

    pub fn cancel_edit(&mut self) {
        self.draft = None;
        if matches!(&self.notice, Some((Tone::Problem, _))) { self.notice = None }
        if let Some(open) = self.selected.clone() { self.ask(json!({ "op": "page", "note": open }), Pending::Page { note: open }); }
    }

    pub fn save(&mut self) {
        let Some(d) = &mut self.draft else { return };
        if d.saving { return }
        d.saving = true;
        let ask = json!({ "op": "save", "note": d.note, "revision": d.revision, "text": d.edit.text });
        let (note, sent) = (d.note.clone(), d.edit.text.clone());
        self.ask(ask, Pending::Save { note, sent });
    }

    /// A new note under the open one (or at the top level), opened to be written.
    pub fn new_child(&mut self) {
        let parent = self.selected.clone();
        if let Some(p) = &parent { self.expanded.insert(p.clone()); }
        self.ask(json!({ "op": "create", "parent": parent, "text": "" }), Pending::Created);
    }

    /// `step`: up, down, in or out, as the service's move reads them.
    pub fn step(&mut self, step: &str) {
        let Some(p) = &self.page else { return };
        let ask = json!({ "op": "move", "note": p.id, "revision": p.revision, "step": step });
        self.ask(ask, Pending::Moved);
    }

    pub fn trash(&mut self) {
        let Some(id) = self.selected.clone() else { return };
        let parent = self.row(&id).and_then(|r| r.parent.clone());
        self.draft = None;
        self.ask(json!({ "op": "trash", "note": id }), Pending::Trashed { note: id, parent });
    }

    pub fn restore(&mut self) {
        let Some(id) = self.trashed.clone() else { return };
        self.ask(json!({ "op": "restore", "note": id }), Pending::Restored);
    }

    // ── finding ─────────────────────────────────────────────────────────────────────────────────────────────

    pub fn find(&mut self, kind: Finder, seed: &str) {
        self.palette = Some(Palette { kind, edit: focused(seed), asked: String::new(), rows: Vec::new(), cursor: 0, hint: String::new(), facets: Vec::new(), pending: false });
        if !seed.is_empty() || kind == Finder::Query { self.find_changed() }
    }

    /// The words changed: ask again. Only the newest answer lands (an older one names other words).
    pub fn find_changed(&mut self) {
        let Some(p) = &mut self.palette else { return };
        let asked = p.edit.text.clone();
        if asked.trim().is_empty() && p.kind == Finder::Find { p.rows.clear(); p.hint.clear(); return }
        p.pending = true;
        let kind = p.kind;
        let ask = match kind { Finder::Find => json!({ "op": "search", "query": asked }), Finder::Query => json!({ "op": "query", "where": asked }) };
        self.ask(ask, Pending::Found { kind, asked });
    }

    pub fn find_move(&mut self, by: isize) {
        let Some(p) = &mut self.palette else { return };
        if p.rows.is_empty() { return }
        p.cursor = (p.cursor as isize + by).rem_euclid(p.rows.len() as isize) as usize;
    }

    pub fn find_open(&mut self) {
        let Some(id) = self.palette.as_ref().and_then(|p| p.rows.get(p.cursor)).map(|r| r.id.clone()) else { return };
        self.open(&id);
    }

    /// A facet value picked: the query gains `key=value`, in the views' grammar.
    pub fn narrow(&mut self, key: &str, value: &str) {
        let Some(p) = &mut self.palette else { return };
        let term = if value.contains(' ') { format!("{key}=\"{value}\"") } else { format!("{key}={value}") };
        if p.edit.text.split_whitespace().any(|w| w == term) { return }
        let text = if p.edit.text.trim().is_empty() { term } else { format!("{} {term}", p.edit.text.trim()) };
        p.edit = focused(&text);
        self.find_changed();
    }
}

/// A field that takes the keyboard when it appears, the caret at its end.
fn focused(text: &str) -> TextEdit {
    let mut edit = TextEdit::new(text);
    edit.focused = true;
    edit
}
