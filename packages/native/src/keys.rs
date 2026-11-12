//! Keys: the one table from a chord to an act line, where the person's keys are, and the one way a field passes
//! a key on.
//!
//! - **The table is read from the actions' rows** (`KeyRow.keys`, `.on`, `.args`): a chord, the layer it belongs to
//!   and the line it runs. Nothing else binds a key; a keycap on a button or a bar row is the table read backwards.
//! - **`App::person()` says where the person's keys are**: in the bar, in a draft, or on a tile. The table is asked
//!   with that layer first, then the rows that hold everywhere.
//! - **A field asks the table first** (`input`, `area`): a chord the table knows runs its line and the editor never
//!   sees it; anything else is text for the editor; what the editor leaves goes up to the window, which asks the
//!   same table.
//! - **Rune's focus follows the layout's** (`follow`, the one caller of `Tx::focus`): a press inside a tile gives it
//!   the keys by `tile.focus`, and the tile the layout names is the one Rune focuses. A tile's root is made to
//!   hold the keys by `tile`.
//! - **Esc closes one thing at a time**: `esc_steps` is the rows bound to Escape in the order their layers are
//!   tried, and the hint under the bar and the editor reads it.
use std::sync::LazyLock;

use rune::{Chord, ChordKey, El, Key, KeyEvent, Mods, TextEdit, Tx};
use rune_kit::{TextArea, TextInput};
use serde_json::{Value, json};

use crate::actions::row::KeyRow;
use crate::actions::{self, Actor, App, Field, word};

/// Where the person's keys are.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    /// The command bar is open: its line has them.
    Bar,
    /// A note is open for editing: its source has them.
    Draft,
    /// A tile has them, and nothing is typed anywhere.
    Tile,
}

impl Layer {
    pub fn name(self) -> &'static str { match self { Layer::Bar => "bar", Layer::Draft => "draft", Layer::Tile => "tile" } }
    fn named(name: &str) -> Layer {
        match name { "bar" => Layer::Bar, "draft" => Layer::Draft, "tile" => Layer::Tile, other => panic!("a key row is on {other}: the layers are bar, draft and tile") }
    }
}

/// Where the person is: one answer, read by the key table, the actor rule and `peek`.
#[derive(Clone, Debug, PartialEq)]
pub struct Whereabouts {
    pub layer: Layer,
    /// The tile that has their focus, by name: the layout's.
    pub focus: String,
    /// What they are typing in, when they are: a tile's name, or the bar.
    pub typing_in: Option<String>,
    /// Their keys are held: they type somewhere.
    pub busy: bool,
    /// What holds them, in words for a refusal.
    pub why: Option<String>,
}

impl Whereabouts {
    pub fn json(&self) -> Value {
        json!({ "layer": self.layer.name(), "focus": self.focus, "typingIn": self.typing_in, "busy": self.busy, "why": self.why, "esc": esc(self.layer).map(|bind| bind.line.clone()) })
    }
}

impl App {
    /// Where the person's keys are now: in the bar while it is open, else on the tile the layout says has them,
    /// in its draft when that tile holds one. A draft open on another tile is not where they are.
    pub fn person(&self) -> Whereabouts {
        let focus = self.layout.name(&self.layout.focus);
        if self.bar.open {
            Whereabouts { layer: Layer::Bar, focus, typing_in: Some("bar".into()), busy: true, why: Some("the person is typing in the bar".into()) }
        } else if let Some(e) = self.editing.as_ref().filter(|e| e.tile == self.layout.focus) {
            let tile = self.layout.name(&e.tile);
            Whereabouts { layer: Layer::Draft, focus, why: Some(format!("the person is in an edit on {tile}")), typing_in: Some(tile), busy: true }
        } else {
            Whereabouts { layer: Layer::Tile, focus, typing_in: None, busy: false, why: None }
        }
    }
}

/// One row of the key table: a chord (or a sequence of them), where it holds and the act line it runs.
pub struct Bind {
    pub chords: Vec<Chord>,
    /// The chord as its row wrote it.
    pub spec: String,
    /// None: everywhere.
    pub layer: Option<Layer>,
    pub line: String,
    pub action: &'static str,
    /// What these keys do, in the row's words.
    pub does: &'static str,
    /// Where the binding came from: an action's row, until a screen and the person's own file add theirs.
    pub from: &'static str,
}

impl Bind {
    /// How the chord reads here: `⌘K` on a Mac, `Ctrl+K` elsewhere.
    pub fn cap(&self) -> String { self.chords.iter().map(Chord::label).collect::<Vec<_>>().join(" ") }
    fn is_escape(&self) -> bool { self.chords.len() == 1 && self.chords[0].key() == ChordKey::Escape }
}

/// Gestures a row lists among its keys: said on its page, never bound.
const MOUSE: &[&str] = &["click", "double-click", "drag", "wheel", "hover"];

static TABLE: LazyLock<Vec<Bind>> = LazyLock::new(|| {
    let mut table = Vec::new();
    for action in actions::all() {
        for row in action.row.key_rows() {
            let KeyRow::Keys { keys, on, args, does, .. } = row else { continue };
            let line = std::iter::once(action.row.id.to_string()).chain(args.iter().map(|(k, v)| format!("{k}={}", word(&v.word())))).collect::<Vec<_>>().join(" ");
            // Alternatives are words; `g then d` is one sequence.
            let words: Vec<&str> = keys.split_whitespace().collect();
            let mut specs: Vec<Vec<&str>> = Vec::new();
            let mut joins = false;
            for w in words {
                if w == "then" { joins = true; continue }
                if joins && let Some(last) = specs.last_mut() { last.push(w) } else { specs.push(vec![w]) }
                joins = false;
            }
            for spec in specs.into_iter().filter(|spec| !spec.iter().any(|w| MOUSE.contains(w))) {
                let chords = spec.iter().map(|c| Chord::parse(c).unwrap_or_else(|e| panic!("{}'s key {c:?} doesn't read as a chord: {e}", action.row.id))).collect();
                table.push(Bind { chords, spec: spec.join(" then "), layer: on.map(Layer::named), line: line.clone(), action: action.row.id, does, from: "row" });
            }
        }
    }
    table
});

/// The whole table, in the order the actions list their keys.
pub fn table() -> &'static [Bind] { &TABLE }

/// The binding a line (or an action, by its name alone) is pressed by, if it has one.
pub fn bind_of(line: &str) -> Option<&'static Bind> {
    table().iter().find(|bind| bind.line == line).or_else(|| table().iter().find(|bind| bind.action == line && bind.line == bind.action))
}

/// The keycap of a line: how its chord reads here.
pub fn cap(line: &str) -> Option<String> { bind_of(line).map(Bind::cap) }

/// What Esc closes, a step at a time: the rows bound to Escape, in the order their layers are tried.
pub fn esc_steps() -> Vec<&'static Bind> {
    [Some(Layer::Bar), Some(Layer::Draft), Some(Layer::Tile), None].into_iter().flat_map(|layer| table().iter().filter(move |bind| bind.is_escape() && bind.layer == layer)).collect()
}

/// What Esc does where the person is: the first step of the list their layer has.
pub fn esc(layer: Layer) -> Option<&'static Bind> { esc_steps().into_iter().find(|bind| bind.layer.is_none_or(|own| own == layer)) }

/// The keys that are a layer's own, with what each does: the hint row under the bar and the editor. What Esc
/// closes there comes first.
pub fn hints(layer: Layer) -> Vec<(String, &'static str)> {
    let esc = esc(layer);
    esc.into_iter().chain(table().iter().filter(|bind| bind.layer == Some(layer) && !bind.is_escape())).map(|bind| (bind.cap(), bind.does)).collect()
}

/// The table as `peek` and the keys screen read it.
pub fn rows() -> Value {
    json!(table().iter().map(|bind| json!({ "chord": bind.spec, "line": bind.line, "layer": bind.layer.map_or("any", Layer::name), "from": bind.from })).collect::<Vec<_>>())
}

/// What this file remembers between events, and nothing else reads: the chords of a sequence pressed so far,
/// Rune's focus as it was last read, and the focus last asked of Rune (with the tiles shown then).
#[derive(Default)]
pub struct Held { seq: Vec<KeyEvent>, seen: Option<String>, asked: Option<(String, Vec<String>)> }

enum Found {
    Run(&'static Bind),
    /// The keys so far start a sequence: the table waits for the rest.
    Wait,
    No,
}

fn find(layer: Layer, seq: &[KeyEvent], tx: &Tx) -> Found {
    let fits = |bind: &&Bind| bind.chords.len() >= seq.len() && bind.chords.iter().zip(seq).all(|(chord, e)| chord.matches_tx(e, tx));
    // The layer's own rows first, then the rows that hold everywhere.
    let mut waits = false;
    for scope in [Some(layer), None] {
        for bind in table().iter().filter(|bind| bind.layer == scope).filter(fits) {
            if bind.chords.len() == seq.len() { return Found::Run(bind) }
            waits = true;
        }
    }
    if waits { Found::Wait } else { Found::No }
}

/// A key, asked of the table: true when a row took it (or it started a sequence). The window's `on_key`, and
/// every field's before its editor.
pub fn press(s: &mut App, e: &KeyEvent, tx: &mut Tx) -> bool {
    let layer = s.person().layer;
    let mut seq = std::mem::take(&mut s.held().seq);
    seq.push(e.clone());
    match find(layer, &seq, tx) {
        Found::Run(bind) => {
            s.act(&bind.line, Actor::Person);
            s.effects(tx);
            true
        }
        Found::Wait => { s.held().seq = seq; true }
        Found::No => false,
    }
}

/// A tile's root, made to hold the keys: a press anywhere inside it gives it Rune's focus (which `follow` hears),
/// and a key while it or anything in it has them is asked of the table before Rune's own focus navigation.
pub fn tile(root: El) -> El { root.focusable(true).on_key(press) }

/// The tile an element's key is under (`tile/<name>` or `tile/<name>/…`), among the tiles there are.
fn tile_of(key: &str, names: &[String]) -> Option<String> {
    let rest = key.strip_prefix("tile/")?;
    names.iter().filter(|name| rest == name.as_str() || rest.strip_prefix(name.as_str()).is_some_and(|r| r.starts_with('/'))).max_by_key(|name| name.len()).cloned()
}

/// Rune's focus and the layout's, kept one: called from `poll`, which every frame starts with. The only caller of
/// `Tx::focus`. True when the layout's focus moved.
///
/// - **Rune to layout:** when Rune's focus moved by itself into another tile (a press it answered), or a press put
///   the caret in the draft of a tile that hasn't the keys, that is the person asking: it becomes `tile.focus`.
///   The move this function asked for comes back a frame later looking the same, and is not the person.
/// - **Layout to Rune:** when the tile the layout names changed, or the tiles shown did, Rune is asked once to
///   focus it (never every frame). While a field has the keys (the bar, a draft) the field's own `TextEdit::focused`
///   says so and nothing is asked.
pub fn follow(s: &mut App, tx: &mut Tx) -> bool {
    let names: Vec<String> = s.shown_tiles().iter().map(|id| s.layout.name(id)).collect();
    let now = tx.focused().map(str::to_owned);
    let moved = now != s.held().seen;
    s.held().seen = now.clone();
    // The layout's say changed since the last frame (an act moved the keys, the bar or a draft closed): it wins, and
    // whatever Rune did with its focus meanwhile (a closing bar hands it back to where it was) is not the person.
    if let Some(asked) = wanted(s, &names) { return ask(s, asked, tx) }
    let focus = s.layout.name(&s.layout.focus);
    let echo = s.held().asked.as_ref().and_then(|(key, _)| tile_of(key, &names));
    let pressed = now.as_deref().filter(|_| moved && !s.bar.open).and_then(|key| tile_of(key, &names)).filter(|tile| *tile != focus && Some(tile) != echo.as_ref());
    // The caret is in a draft whose tile hasn't the keys: a press put it there.
    let drafted = s.editing.as_ref().filter(|e| s.editor.focused && e.tile != s.layout.focus && !s.bar.open).map(|e| s.layout.name(&e.tile));
    let Some(tile) = drafted.or(pressed) else { return false };
    let changed = s.act(&format!("tile.focus tile={}", word(&tile)), Actor::Person).ok;
    if let Some(asked) = wanted(s, &names) { ask(s, asked, tx); }
    changed
}

/// What Rune is to be asked now, when that is not what it was asked last: the tile with the keys (and the tiles
/// shown, so it is asked again when they change), or nothing while a field has them.
fn wanted(s: &mut App, names: &[String]) -> Option<Option<(String, Vec<String>)>> {
    let want = (s.person().layer == Layer::Tile).then(|| (format!("tile/{}", s.layout.name(&s.layout.focus)), names.to_vec()));
    (want != s.held().asked).then_some(want)
}

fn ask(s: &mut App, asked: Option<(String, Vec<String>)>, tx: &mut Tx) -> bool {
    if let Some((key, _)) = &asked { tx.focus(key.clone(), false) }
    s.held().asked = asked;
    false
}

/// The adapter every field's keys go through: the table first; then, in a note's source, plain Return types a line
/// (the kit's editor would submit instead); anything else is the editor's, and what it leaves goes up.
fn table_first(field: Field, lines: bool) -> impl Fn(&mut App, &KeyEvent, &mut Tx) -> bool {
    move |s, e, tx| {
        if press(s, e, tx) { return true }
        if lines && e.key == Key::Enter && e.mods == Mods::default() {
            s.field(field).insert("\n");
            s.typed(field);
            return true;
        }
        false
    }
}

/// A one-line field over `field`'s text: the kit's input, its keys through the table.
pub fn input(edit: &TextEdit, field: Field) -> TextInput {
    TextInput::new(edit).on_edit(move |s: &mut App| s.field(field)).on_change(move |s: &mut App, _| s.typed(field)).on_key(table_first(field, false))
}

/// A field of lines over `field`'s text: the kit's text area, its keys through the table.
pub fn area(edit: &TextEdit, field: Field) -> TextArea {
    TextArea::new(edit).on_edit(move |s: &mut App| s.field(field)).on_change(move |s: &mut App, _| s.typed(field)).on_key(table_first(field, true))
}
