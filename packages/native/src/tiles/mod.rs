//! Tiles: the drawers that draw one.
//!
//! - **A kind row** says what a tile kind is: the drawer that draws it and the fields a tile of it starts with. The
//!   service serves the rows (`screen::KindRow`, an extension's `tiles[]`); this window holds no catalogue of kinds
//!   and names none: a screen names kinds, a kind names a drawer.
//! - **A drawer** draws one answer shape, and there are four: `page` (a note's page), `list` (one list, whatever
//!   it is of), `view` (what an extension's script draws for a tile, as primitives) and `pty` (a program's screen
//!   in a terminal). It is given a `TileCx`: the store to read, its tile's spec, its kind's row and its own state, and
//!   one way out: `cx.act(line)`, an act line run in its tile (a row's own, a button's, one of this window's
//!   actions). It gets no layout to change and no socket: a drawer can ask and can say, and nothing else.
//! - **A kind this window has no drawer for** is drawn as its spec, as data, with what the service said is wrong.
pub mod diff;
pub mod list;
pub mod page;
pub mod picture;
pub mod prim;
pub mod pty;
pub mod rendered;

use rune::{El, col, row, text};
use rune_kit::{Button, ButtonVariant, ControlSize, Kit};
use serde_json::{Value, json};

use crate::actions::{App, TileUi};
use crate::layout::TileSpec;
use crate::screen::KindRow;
use crate::store::{Ask, Store};

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
    /// A press that runs `line` from this tile, as the person: about this tile when the line's action acts in a
    /// tile of its sort (`App::act_from`), unless the line names one itself. The tile pressed in has the keys from then.
    pub fn act(&self, line: impl AsRef<str>) -> impl Fn(&mut App) + Clone + 'static {
        let (line, from) = (line.as_ref().to_string(), self.name.clone());
        move |s: &mut App| { s.pressed_in(&line, &from); }
    }
}

/// One answer shape, drawn.
pub struct Drawer {
    pub id: &'static str,
    /// What it draws, as it says of itself.
    pub about: &'static str,
    /// It reads notes: an open can land in a tile it draws, and that tile has a note of its own.
    pub notes: bool,
    /// It lists notes: its rows open elsewhere.
    pub lists: bool,
    /// What its tile reads now, each as a role (`page`, `list`).
    pub asks: fn(&TileCx) -> Vec<(&'static str, Ask)>,
    pub draw: fn(&TileCx, &Kit) -> El,
    /// What `peek` says of its tile.
    pub facts: fn(&TileCx) -> Value,
    /// It takes every key itself while it has them (a terminal).
    pub takes_keys: bool,
    /// What changes what it draws, beside its answers: read into the tile's memo.
    pub version: fn(&TileCx) -> u64,
    /// What it draws over the window, anchored in its tile (a list that completes what is typed there): added to
    /// the window's overlays. `caret`: where the tile's caret is in the window, when it has one.
    pub over: Option<fn(&TileCx, Option<[f32; 4]>, &Kit, &mut Vec<El>)>,
}

pub static DRAWERS: &[&Drawer] = &[&page::DRAWER, &list::DRAWER, &rendered::DRAWER, &pty::DRAWER];

pub fn drawer(id: &str) -> Option<&'static Drawer> { DRAWERS.iter().copied().find(|drawer| drawer.id == id) }

/// The drawer a kind's row names, when this window has it.
pub fn drawer_of(row: &KindRow) -> Option<&'static Drawer> { row.drawer.as_deref().and_then(drawer) }

/// The drawers this window has, as it tells the service when it asks for screens.
pub fn drawers() -> Vec<&'static str> { DRAWERS.iter().map(|drawer| drawer.id).collect() }

/// A tile with nothing to draw yet (a reader told no note, a list about a note nobody shows): what it is, in its
/// kind's own words. The name and the description are the service's row for the kind (`KindRow`), which says what a
/// tile of it shows and so what this one waits for; nothing here words a kind, and no note is drawn in its place.
/// `ways`: what the drawer offers to fill it, under the words (`way`: a line an act).
pub fn waiting(cx: &TileCx, ways: Option<El>, k: &Kit) -> El {
    let about = Some(cx.row.about.trim()).filter(|about| !about.is_empty()).map(|about| text(about.to_string()).key(cx.key("empty/about")).font(k.ty.small).color(k.c.text_muted).wrap().max_w(460.0));
    let name = if cx.row.name.is_empty() { cx.spec.kind.clone() } else { cx.row.name.clone() };
    col().key(cx.key("empty")).w_full().h_full().center().gap(10.0).padding(28.0)
        .child(text(name).key(cx.key("empty/kind")).font(k.ty.ui).color(k.c.text_base))
        .children(about)
        .children(ways)
}

/// One thing to do next in an empty tile, as a line: the button its action's row labels, then the key this
/// window's table binds to that line and what the key does, in the row's own words. Nothing here words an action;
/// a line no key runs is its button alone. Keyed `empty/<part>` in its tile.
pub fn way(cx: &TileCx, line: &str, part: &str, k: &Kit) -> El {
    let button = Button::new(crate::actions::label(line)).variant(ButtonVariant::Outline).control_size(ControlSize::Small).on_press(cx.act(line)).build(k).key(cx.key(format!("empty/{part}")));
    let does = crate::keys::bind_of(line).map(|bind| text(format!("{} · {}", bind.cap(), bind.does)).key(cx.key(format!("empty/{part}/does"))).font(k.ty.small).color(k.c.text_faint).truncate());
    row().gap(10.0).center_y().child(button).children(does)
}

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

/// The catalogue as `actions` over the control socket lists it: each kind as the service's row says it, and each
/// drawer as it says of itself.
pub fn described(app: &App) -> Value {
    json!({
        "kinds": app.kinds().iter().map(|row| json!({ "kind": row.kind, "name": row.name, "about": row.about, "drawer": row.drawer, "fields": row.fields, "replaces": row.replaces, "extension": row.extension, "drawn": drawer_of(row).is_some() })).collect::<Vec<_>>(),
        "drawers": DRAWERS.iter().map(|drawer| json!({ "id": drawer.id, "about": drawer.about, "notes": drawer.notes, "lists": drawer.lists, "takesKeys": drawer.takes_keys })).collect::<Vec<_>>(),
        "primitives": prim::described(),
    })
}
