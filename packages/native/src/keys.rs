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
//! - **Esc closes one thing at a time**: `esc_steps` is the rows bound to Escape in the order their layers are
//!   tried, and the hint under the bar and the editor reads it.
use std::sync::LazyLock;

use rune::{Chord, ChordKey, Key, KeyEvent, Mods, TextEdit, Tx};
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
    /// Where the person's keys are now.
    pub fn person(&self) -> Whereabouts {
        let focus = self.layout.name(&self.layout.focus);
        if self.bar.open {
            Whereabouts { layer: Layer::Bar, focus, typing_in: Some("bar".into()), busy: true, why: Some("the person is typing in the bar".into()) }
        } else if let Some(e) = &self.editing {
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

/// The chords of a sequence pressed so far. The table's to hold: nothing else reads it.
#[derive(Default)]
pub struct Held(Vec<KeyEvent>);

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
    let mut seq = std::mem::take(&mut s.held().0);
    seq.push(e.clone());
    match find(layer, &seq, tx) {
        Found::Run(bind) => {
            s.act(&bind.line, Actor::Person);
            s.effects(tx);
            true
        }
        Found::Wait => { s.held().0 = seq; true }
        Found::No => false,
    }
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
