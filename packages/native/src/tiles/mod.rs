//! Tiles: what a kind is, and the drawers that draw one.
//!
//! - **A kind row** says what a tile kind is: the drawer that draws it and what the layout's rules need to know of
//!   it (whether it reads notes, whether it lists them). `KINDS` is the catalogue; a screen names kinds, never code.
//! - **A drawer** draws one answer shape. It is given a `TileCx`: the store to read, its tile's spec and its own
//!   state, and two ways out, both act lines: `cx.act(line)` and `cx.emit(verb, subject)`. It gets no layout to
//!   change and no socket: a drawer can ask and can say, and nothing else.
//! - **A kind this window has no drawer for** is drawn as its spec, as data, with what the service said is wrong.
pub mod about;
pub mod page;
pub mod tree;

use rune::{El, col, text};
use rune_kit::Kit;
use serde_json::{Value, json};

use crate::actions::{Actor, App, TileUi, word};
use crate::layout::TileSpec;
use crate::store::{Ask, Store};

/// What a tile kind is.
pub struct KindRow {
    pub kind: &'static str,
    pub about: &'static str,
    /// The drawer that draws it.
    pub drawer: &'static str,
    /// It reads notes: an open can land in it.
    pub notes: bool,
    /// It lists notes: its rows open elsewhere.
    pub lists: bool,
    /// It shows what another tile's note is about, and follows it.
    pub follower: bool,
}

pub static KINDS: &[KindRow] = &[
    KindRow { kind: "tree", about: "the outline's notes, a folder a level", drawer: "tree", notes: false, lists: true, follower: false },
    KindRow { kind: "reader", about: "one note, read and written", drawer: "page", notes: true, lists: false, follower: false },
    KindRow { kind: "props", about: "the properties and the record of the note another tile shows", drawer: "about", notes: false, lists: false, follower: true },
    KindRow { kind: "backlinks", about: "the notes that link to the note another tile shows", drawer: "about", notes: false, lists: true, follower: true },
];

pub fn kind(name: &str) -> Option<&'static KindRow> { KINDS.iter().find(|row| row.kind == name) }

/// What a drawer is handed: everything it may read, and the two ways it may speak.
pub struct TileCx<'a> {
    pub app: &'a App,
    pub id: &'a str,
    /// The tile's name: how an act line addresses it, and what its elements are keyed under.
    pub name: String,
    pub spec: &'a TileSpec,
    pub ui: &'a TileUi,
    pub row: &'a KindRow,
    pub focused: bool,
}

impl TileCx<'_> {
    pub fn store(&self) -> &Store { self.app.store() }
    /// An element's key under this tile: `tile/<name>/<part>`.
    pub fn key(&self, part: impl AsRef<str>) -> String { format!("tile/{}/{}", self.name, part.as_ref()) }
    /// The act line `line`, aimed at this tile.
    pub fn line(&self, line: impl AsRef<str>) -> String { format!("{} tile={}", line.as_ref(), word(&self.name)) }
    /// A press that runs `line` in this tile, as the person.
    pub fn act(&self, line: impl AsRef<str>) -> impl Fn(&mut App) + Clone + 'static {
        let line = self.line(line);
        move |s: &mut App| { s.act(&line, Actor::Person); }
    }
    /// A press that says something happened here to a note: `open` sends it where this tile's opens land.
    pub fn emit(&self, verb: &str, subject: &str) -> impl Fn(&mut App) + Clone + 'static {
        self.act(match verb { "open" => format!("open id={}", word(subject)), other => format!("tile.emit verb={other} id={}", word(subject)) })
    }
}

/// One answer shape, drawn.
pub struct Drawer {
    pub id: &'static str,
    /// What its tile reads now, each as a role (`page`, `level`).
    pub asks: fn(&TileCx) -> Vec<(&'static str, Ask)>,
    pub draw: fn(&TileCx, &Kit) -> El,
    /// What `peek` says of its tile.
    pub facts: fn(&TileCx) -> Value,
    /// It takes every key itself while it has them (a terminal).
    pub takes_keys: bool,
    /// What changes what it draws, beside its answers: read into the tile's memo.
    pub version: fn(&TileCx) -> u64,
}

pub static DRAWERS: &[&Drawer] = &[&page::DRAWER, &tree::DRAWER, &about::DRAWER];

pub fn drawer(id: &str) -> Option<&'static Drawer> { DRAWERS.iter().copied().find(|drawer| drawer.id == id) }

/// A tile whose kind this window can't draw: its spec as data, never hidden.
pub fn as_data(spec: &TileSpec, name: &str, k: &Kit) -> El {
    let mut data = serde_json::Map::new();
    data.insert("kind".into(), json!(spec.kind));
    data.insert("name".into(), json!(name));
    data.extend(spec.fields.clone());
    col().key(format!("tile/{name}/data")).w_full().padding(12.0).gap(6.0)
        .child(text(format!("This window draws no {} tile: its spec, as it was written.", spec.kind)).font(k.ty.small).color(k.c.text_muted).wrap())
        .child(text(serde_json::to_string_pretty(&Value::Object(data)).unwrap_or_default()).font(k.ty.mono).color(k.c.text_base).wrap().selectable(true))
}

/// The catalogue as `actions` over the control socket lists it: each kind as its own row says it, and each drawer.
pub fn described() -> Value {
    json!({
        "kinds": KINDS.iter().map(|row| json!({ "kind": row.kind, "about": row.about, "drawer": row.drawer, "notes": row.notes, "lists": row.lists, "follower": row.follower })).collect::<Vec<_>>(),
        "drawers": DRAWERS.iter().map(|drawer| json!({ "id": drawer.id, "takesKeys": drawer.takes_keys })).collect::<Vec<_>>(),
    })
}

/// The kinds this window draws, as it tells the service when it asks for screens.
pub fn kinds() -> Vec<&'static str> { KINDS.iter().map(|row| row.kind).collect() }
