//! Keys: the one table from a chord to an act line, where the person's keys are, and the one way a field passes
//! a key on.
//!
//! - **The table is read from the actions' rows** (`KeyRow.keys`, `.on`, `.args`): a chord, the layer it belongs to
//!   and the line it runs. Nothing else binds a key; a keycap on a button or a bar row is the table read backwards.
//! - **`App::person()` says where the person's keys are**: in the bar, in a draft (in its completion list while that
//!   is open: `complete` with rows to choose from, `said` with only a word to say), in a terminal tile's program, or
//!   on a tile (`selection` while words of the note it reads are picked there: the keys that act on them, the
//!   door's `a` then a letter, are that layer's, and the tile's own still hold under it). The table is asked with that layer first, then the layer under it (a completion list is
//!   open over a draft), then the rows that hold everywhere.
//! - **A program takes every key but its layer's own** (`program`: the chord that leaves it, a paste, the
//!   scrollback). The rows that hold everywhere are not asked while the person is in one: `mod+k` is the program's
//!   there, as every key is, and what the table leaves is sent to it (`term_key`, `App::keyed`).
//! - **The open screen's own keys come before the rows'** (`ScreenBind`, its spec's `keys` as the service lists
//!   them): each runs its action as the person while a tile has the keys, never while something is typed, and
//!   only on the kinds it says. `peek` lists them with the rows (`from: screen`). A key is named there as screens
//!   name keys (`L`, `ctrl+l`, `esc`), read as a chord by `chord_named`.
//! - **A field asks the table first** (`input`, `area`): a chord the table knows runs its line and the editor never
//!   sees it; anything else is text for the editor; what the editor leaves goes up to the window, which asks the
//!   same table.
//! - **A field's text is `Text`**: the kit's editor behind a type of this file's, so the window's state holds what
//!   is typed (its words, its caret, its selection, its way back) and names no renderer.
//! - **Rune's focus follows the layout's** (`follow`, the one caller of `Tx::focus`): a press inside a tile gives it
//!   the keys by `tile.focus`, and the tile the layout names is the one Rune focuses. A tile's root is made to
//!   hold the keys by `tile`.
//! - **A tile held by its title is a layer of its own** (`moving`): Escape lets go of it with nothing moved. While
//!   the pointer holds it Rune ends the drag on Escape itself and the shell says the same act; held by an act
//!   line (a scene, an agent's look at the zones), the key is this layer's row.
//! - **Esc closes one thing at a time**: `esc_steps` is the rows bound to Escape in the order their layers are
//!   tried, and the hint under the bar and the editor reads it.
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use rune::{Chord, ChordKey, El, Key, KeyEvent, Mods, Span, TextEdit, TextStyle, Tx, col, text_input};
use rune_kit::{Kit, TextInput};
use serde_json::{Value, json};

use crate::actions::row::KeyRow;
use crate::actions::{self, Actor, App, Field, word};
use crate::actline;

/// Where the person's keys are.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    /// The command bar is open: its line has them.
    Bar,
    /// A form is open over the window: its fields have them.
    Form,
    /// A tile is held by its title: the one key of this layer lets go of it, and the rows that hold everywhere still do.
    Moving,
    /// A block is open for editing, and the list that completes what is being typed is open over it with rows to
    /// choose from.
    Complete,
    /// That list is open with nothing to choose from, only the service's word (no such page yet): Escape puts it
    /// away, and every other key is the draft's.
    Said,
    /// A block is open for editing: its source has them.
    Draft,
    /// A terminal tile's program has them: every key but this layer's own rows is sent to it.
    Program,
    /// A reader has them and words of its note are picked there: the keys that act on those words are this layer's,
    /// over the tile's own.
    Selection,
    /// A tile has them, and nothing is typed anywhere.
    Tile,
    /// The tile with the keys lists rows and they are a tree's: the keys that fold and unfold the row the cursor
    /// is on, over the list's own. (Named `branches`, as the next two are `rows` and `page`: a layer is named by
    /// what is drawn there, never by a kind of tile a screen ships.)
    Tree,
    /// The tile with the keys lists rows: the keys that move its cursor and open the row it is on.
    List,
    /// The tile with the keys reads a note: the keys that move through its page and its way back.
    Reader,
    /// A notice is up over the tiles: Escape takes it away before anything under it.
    Noticed,
    /// A tile fills the window: Escape puts it back in its place.
    Zoomed,
    /// The tile with the keys is in a dock slid open over the others: Escape shuts the dock.
    Docked,
}

impl Layer {
    pub fn name(self) -> &'static str { match self { Layer::Bar => "bar", Layer::Form => "form", Layer::Moving => "moving", Layer::Complete => "complete", Layer::Said => "said", Layer::Draft => "draft", Layer::Program => "program", Layer::Selection => "selection", Layer::Tile => "tile", Layer::Tree => "branches", Layer::List => "rows", Layer::Reader => "page", Layer::Noticed => "noticed", Layer::Zoomed => "zoomed", Layer::Docked => "docked" } }
    fn named(name: &str) -> Layer {
        match name { "bar" => Layer::Bar, "form" => Layer::Form, "moving" => Layer::Moving, "complete" => Layer::Complete, "said" => Layer::Said, "draft" => Layer::Draft, "program" => Layer::Program, "selection" => Layer::Selection, "tile" => Layer::Tile, "branches" => Layer::Tree, "rows" => Layer::List, "page" => Layer::Reader, "noticed" => Layer::Noticed, "zoomed" => Layer::Zoomed, "docked" => Layer::Docked, other => panic!("a key row is on {other}: the layers are bar, form, moving, complete, said, draft, program, selection, branches, rows, page, noticed, zoomed, docked and tile") }
    }
    /// The layers a key is asked of, the person's own first: a completion list is open over a draft, whose keys still
    /// hold, a list with rows has every key of one that only says something, and words picked in a reader leave
    /// the tile's own keys as they were. (What the tile with the keys adds over `tile` is the person's own to say:
    /// `Whereabouts::stack`.)
    fn stack(self) -> &'static [Layer] { match self { Layer::Complete => &[Layer::Complete, Layer::Said, Layer::Draft], Layer::Said => &[Layer::Said, Layer::Draft], Layer::Bar => &[Layer::Bar], Layer::Form => &[Layer::Form], Layer::Moving => &[Layer::Moving], Layer::Draft => &[Layer::Draft], Layer::Program => &[Layer::Program], Layer::Selection => &[Layer::Selection, Layer::Tile], Layer::Tile => &[Layer::Tile], Layer::Tree => &[Layer::Tree], Layer::List => &[Layer::List], Layer::Reader => &[Layer::Reader], Layer::Noticed => &[Layer::Noticed], Layer::Zoomed => &[Layer::Zoomed], Layer::Docked => &[Layer::Docked] } }
    /// The rows that hold everywhere hold here too. Not in a program: every key that is not its layer's own is the
    /// program's.
    fn open(self) -> bool { self != Layer::Program }
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
    /// How long since their last key. None: no key yet.
    pub idle: Option<Duration>,
    /// The tile with their focus takes every key itself (a terminal whose program they are in): nothing typed is
    /// the window's but the keys of the layer.
    pub takes_keys: bool,
    /// What the tile with the keys adds to the keys while nothing is typed, the nearest first (`App::tile_layers`):
    /// the keys of what it draws (a tree's, a list's, a reader's), then what Escape steps back out of (a notice, a
    /// zoom, an open dock). Empty while something else has the keys.
    pub on: Vec<Layer>,
}

/// How long the person has been away from the keys before an agent changes what they look at (the door's
/// `SHELL_IDLE_MS`).
pub const IDLE: Duration = Duration::from_secs(2);

impl Whereabouts {
    pub fn json(&self) -> Value {
        json!({ "layer": self.layer.name(), "layers": self.stack().into_iter().map(Layer::name).collect::<Vec<_>>(), "focus": self.focus, "typingIn": self.typing_in, "busy": self.busy, "why": self.why, "idle": self.idle.map(|idle| idle.as_secs_f64()), "takesKeys": self.takes_keys, "esc": esc_in(&self.stack(), self.layer.open()).map(|bind| bind.line.clone()) })
    }

    /// The layers a key is asked of where the person is, their own first: the layer's own stack, with what the tile
    /// with the keys adds (`on`) asked before the keys every tile has.
    pub fn stack(&self) -> Vec<Layer> {
        let own = self.layer.stack();
        match own.split_last() { Some((Layer::Tile, over)) => over.iter().chain(&self.on).copied().chain([Layer::Tile]).collect(), _ => own.to_vec() }
    }
}

impl App {
    /// Where the person's keys are now: in the bar while it is open, else on the tile the layout says has them,
    /// in its draft when that tile holds one (in the draft's completion list while that is open), in its program
    /// when it is a terminal's they have not stepped out of (`App::in_program`). A draft open on another tile is
    /// not where they are.
    pub fn person(&self) -> Whereabouts {
        let focus = self.layout.name(&self.layout.focus);
        let idle = self.last_key().map(|at| at.elapsed());
        if self.bar.open {
            Whereabouts { layer: Layer::Bar, focus, idle, typing_in: Some("bar".into()), busy: true, why: Some("the person is typing in the bar".into()), takes_keys: false, on: Vec::new() }
        } else if self.form.is_some() {
            Whereabouts { layer: Layer::Form, focus, idle, typing_in: Some("form".into()), busy: true, why: Some("the person is filling in a form".into()), takes_keys: false, on: Vec::new() }
        } else if self.moving.is_some() {
            // A tile is held by its title: Escape lets go of it. Nothing is typed, and no agent is held back for it.
            Whereabouts { layer: Layer::Moving, focus, idle, typing_in: None, busy: false, why: None, takes_keys: false, on: Vec::new() }
        } else if let Some(draft) = self.draft_on(&self.layout.focus) {
            let (tile, layer) = (self.layout.name(&draft.tile), self.writing(&draft.tile));
            Whereabouts { layer, focus, idle, why: Some(format!("the person is in an edit on {tile}")), typing_in: Some(tile), busy: true, takes_keys: false, on: Vec::new() }
        } else if self.in_program().is_some() {
            // The tile with the keys is a terminal's, its program runs and they have not stepped out of it: every
            // key is the program's, and the tile is where they type.
            Whereabouts { layer: Layer::Program, idle, why: Some(format!("the person is typing in {focus}")), typing_in: Some(focus.clone()), focus, busy: true, takes_keys: true, on: Vec::new() }
        } else {
            // Words picked in the reader with the keys: the keys that act on them hold. Nothing is typed, and
            // nothing of the person's is held: an agent's act is ruled as on any tile.
            let layer = if self.ui(&self.layout.focus).passage.is_some() { Layer::Selection } else { Layer::Tile };
            Whereabouts { layer, focus, idle, typing_in: None, busy: false, why: None, takes_keys: false, on: self.tile_layers() }
        }
    }

    /// What the tile with the keys adds to them, the nearest first: the keys of what it draws (a tree's over a
    /// list's; a reader's), then each thing Escape steps back out of, innermost first (the notice over the tiles,
    /// a tile that fills the window, a dock slid open with the keys in it). Read by `person` alone.
    fn tile_layers(&self) -> Vec<Layer> {
        let tile = &self.layout.focus;
        let docked = crate::layout::tree::dock_of(self.layout.tree(), tile).and_then(|path| self.layout.tree().at(&path)).is_some_and(|dock| matches!(dock, crate::layout::tree::Node::Dock { open: true, .. }));
        [(self.is_a(tile, actions::About::Tree), Layer::Tree), (self.is_a(tile, actions::About::Lists), Layer::List), (self.is_a(tile, actions::About::Notes), Layer::Reader), (self.notice.is_some(), Layer::Noticed), (self.layout.zoom.is_some(), Layer::Zoomed), (docked, Layer::Docked)]
            .into_iter().filter_map(|(holds, layer)| holds.then_some(layer)).collect()
    }

    /// What is offered by press where words are picked in `tile`: the act lines the keys of that layer run (the
    /// rows that say they are the keys of words picked in a reader), each once, in the table's order. None while
    /// no words are picked there. The row of buttons by a selection reads this, and names no layer itself.
    pub fn offered(&self, tile: &str) -> Vec<&'static str> {
        let mut lines: Vec<&'static str> = Vec::new();
        if self.ui(tile).passage.is_none() { return lines }
        for bind in table().iter().filter(|bind| bind.layer == Some(Layer::Selection)) { if !lines.contains(&bind.line.as_str()) { lines.push(bind.line.as_str()) } }
        lines
    }

    /// The layer the keys are in while a block is written in `tile`: its completion list while that is open, else
    /// the draft's own. The list's own keys are for choosing: one with nothing to choose from keeps only the key
    /// that puts it away. `person` and the hint row under the block's field both read this.
    pub fn writing(&self, tile: &str) -> Layer {
        match self.completing(tile) { Some(found) if !found.rows.is_empty() => Layer::Complete, Some(_) => Layer::Said, None => Layer::Draft }
    }
}

/// One row of the key table: a chord (or a sequence of them), where it holds and the act line it runs.
pub struct Bind {
    pub chords: Vec<Chord>,
    /// The chord as its row wrote it.
    pub spec: String,
    /// Every key of its row, as the row wrote them (`j down`: this chord and the others that run the same line):
    /// what a list of the rows says for it (the keys screen lists a row once).
    pub row: &'static str,
    /// None: everywhere.
    pub layer: Option<Layer>,
    pub line: String,
    pub action: &'static str,
    /// What these keys do, in the row's words.
    pub does: &'static str,
    /// Where the binding came from: an action's row. (A screen's own are `ScreenBind`s; the person's own file isn't read yet.)
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
                table.push(Bind { chords, spec: spec.join(" then "), row: keys, layer: on.map(Layer::named), line: line.clone(), action: action.row.id, does, from: "row" });
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

/// The keycap of the key that runs an act whole: the row of `action` whose arguments the act has (the most
/// particular one, the first of those), as its chord reads here. What a refusal's way out is said by (`actions::says`):
/// the key a refusal names is the key the table binds.
pub fn cap_of(action: &str, args: &[(String, Value)]) -> Option<String> {
    let said = |v: &Value| match v { Value::String(s) => s.clone(), other => other.to_string() };
    let mut best: Option<(usize, &Bind)> = None;
    for bind in table().iter().filter(|bind| bind.action == action) {
        let Ok(req) = actline::parse(&bind.line) else { continue };
        if !req.args.iter().all(|(k, v)| args.iter().any(|(key, value)| key == k && said(value) == said(v))) { continue }
        if best.is_none_or(|(n, _)| req.args.len() > n) { best = Some((req.args.len(), bind)) }
    }
    best.map(|(_, bind)| bind.cap())
}

/// The keycap of a line: how its chord reads here.
pub fn cap(line: &str) -> Option<String> { bind_of(line).map(Bind::cap) }

/// What Esc closes, a step at a time: the rows bound to Escape, in the order their layers are tried.
pub fn esc_steps() -> Vec<&'static Bind> {
    [Some(Layer::Bar), Some(Layer::Form), Some(Layer::Moving), Some(Layer::Complete), Some(Layer::Said), Some(Layer::Draft), Some(Layer::Program), Some(Layer::Selection), Some(Layer::Tree), Some(Layer::List), Some(Layer::Reader), Some(Layer::Noticed), Some(Layer::Zoomed), Some(Layer::Docked), Some(Layer::Tile), None].into_iter().flat_map(|layer| table().iter().filter(move |bind| bind.is_escape() && bind.layer == layer)).collect()
}

/// What Esc does where the person is: the first step of the list their layer has, or a layer under it.
pub fn esc(layer: Layer) -> Option<&'static Bind> { esc_in(layer.stack(), layer.open()) }

/// What Esc does with the keys in `stack` (`Whereabouts::stack`): the row the table would run, the nearest layer's.
pub fn esc_in(stack: &[Layer], open: bool) -> Option<&'static Bind> {
    stack.iter().copied().map(Some).chain(open.then_some(None)).find_map(|scope| table().iter().find(|bind| bind.is_escape() && bind.layer == scope))
}

/// The keys that are a layer's own, with what each does: the hint row under the bar, a form and the editor. What
/// Esc closes there comes first. A layer with no key of its own but the one that leaves it (a completion list
/// with nothing to choose from) lists the keys of the layer under it, which still hold.
pub fn hints(layer: Layer) -> Vec<(String, &'static str)> {
    let own = |layer: Layer| table().iter().filter(move |bind| bind.layer == Some(layer) && !bind.is_escape());
    let shown = layer.stack().iter().copied().find(|layer| own(*layer).next().is_some()).unwrap_or(layer);
    esc(layer).into_iter().chain(own(shown)).map(|bind| (bind.cap(), bind.does)).collect()
}


/// One line of the hint row under the tiles: the keys that run one act (each chord its row lists, as it reads here)
/// and what they do, in the row's words.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Hint { pub caps: Vec<String>, pub does: &'static str, pub line: &'static str }

/// Binds as the hint row's lines: one a line an act, its chords together, in the table's order.
fn lines<'a>(binds: impl Iterator<Item = &'a &'static Bind>, from: usize) -> Vec<Hint> {
    let mut out: Vec<Hint> = Vec::new();
    for bind in binds {
        let cap = bind.chords[from.min(bind.chords.len() - 1)..].iter().map(Chord::label).collect::<Vec<_>>().join(" ");
        match out.iter_mut().find(|hint| hint.line == bind.line) { Some(hint) => { if !hint.caps.contains(&cap) { hint.caps.push(cap) } } None => out.push(Hint { caps: vec![cap], does: bind.does, line: &bind.line }) }
    }
    out
}

impl App {
    /// What the hint row under the tiles says: the keys that matter where the person's are. While a sequence is
    /// begun (`a` over picked words), every row it can still become, by the keys left to press. Else the keys of what the tile
    /// with the keys draws (its tree's and its list's, or its reader's), then what Escape steps back out of here,
    /// then the keys that move between tiles: all read from the table, in its order, and nothing is worded here.
    /// Empty while the keys are somewhere that says its own (the bar, a form, a block being written, a program).
    pub fn hinted(&self) -> Vec<Hint> {
        let held = self.held_now();
        if !held.waits.is_empty() { return lines(held.waits.iter(), held.seq.len()) }
        let person = self.person();
        if !matches!(person.layer, Layer::Tile | Layer::Selection) { return Vec::new() }
        // What the tile draws has keys of its own: those are the ones that matter in it. A tile with none of its own
        // says the keys every tile has. A chord a nearer layer took is that layer's, and is said once.
        let stack = person.stack();
        let own: Vec<Layer> = stack.iter().copied().filter(|layer| *layer != Layer::Tile && table().iter().any(|bind| bind.layer == Some(*layer) && !bind.is_escape())).collect();
        let shown = if own.is_empty() { vec![Layer::Tile] } else { own };
        let mut rows: Vec<&'static Bind> = Vec::new();
        for bind in shown.iter().flat_map(|layer| table().iter().filter(move |bind| bind.layer == Some(*layer) && !bind.is_escape())) { if !rows.iter().any(|taken| taken.spec == bind.spec) { rows.push(bind) } }
        let esc: Vec<&'static Bind> = esc_in(&stack, true).into_iter().collect();
        lines(rows.iter().chain(esc.iter()), 0)
    }
}

/// A key the open screen binds, as its spec writes it (outline-core's `KeyBinding`): the request it runs is
/// already read, and never written as a line to be read again.
pub struct ScreenBind {
    /// The key as the screen wrote it, in the names screens use (`L`, `ctrl+l`, `esc`).
    pub spec: String,
    /// The chord it is here, or why it is none.
    pub chord: Result<Chord, String>,
    pub request: actline::Request,
    /// The binding as the screen wrote it: the kinds of tile it holds on and off are the spec's to read (`screen::holds_on`).
    rule: Value,
}

impl ScreenBind {
    fn read(bind: &Value) -> Option<ScreenBind> {
        let (spec, action) = (bind["key"].as_str()?, bind["action"].as_str()?);
        Some(ScreenBind {
            spec: spec.to_string(), chord: chord_named(spec).ok_or_else(|| format!("{spec} is no key here")),
            request: actline::Request { action: action.to_string(), tile: bind["tile"].as_str().map(str::to_string), by: None, args: bind["args"].as_object().cloned().unwrap_or_default() },
            rule: bind.clone(),
        })
    }
    /// It holds while a tile of `kind` has the keys.
    fn holds(&self, kind: Option<&str>) -> bool { crate::screen::holds_on(&self.rule, kind) }
}

/// A key as a screen names it (outline-core's `isKeyName`: `l`, `L`, `,`, `ctrl+l`, `alt+c`, `esc`, `pgup`,
/// `alt+left`), read as a chord: a capital is Shift with its letter, with modifiers before it too, and the two
/// pages are named in full here. Held to the names there are by `core-contract.json`. None: no chord here is that
/// key (a modifier alone, Hyper), and it is listed and never pressed.
pub fn chord_named(key: &str) -> Option<Chord> {
    let (mods, last) = match key.rsplit_once('+') { Some((mods, last)) if !last.is_empty() => (Some(mods), last), _ => (None, key) };
    let mut chars = last.chars();
    let name = match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_uppercase() => format!("shift+{}", c.to_lowercase()),
        _ => match last { "pgup" => "pageup".to_string(), "pgdn" => "pagedown".to_string(), other => other.to_string() },
    };
    Chord::parse(&match mods { Some(mods) => format!("{mods}+{name}"), None => name }).ok()
}

/// The open screen's own keys, in the order it lists them.
pub fn screen_binds(s: &App) -> Vec<ScreenBind> { s.spec_now().map(|spec| spec.keys().filter_map(ScreenBind::read).collect()).unwrap_or_default() }

/// The keys as `peek` and the keys screen read them: the open screen's own first (they are asked first, while a
/// tile has the keys), then the table's rows.
pub fn rows(s: &App) -> Value {
    let screen = screen_binds(s).into_iter().map(|bind| {
        let mut row = json!({ "chord": bind.spec, "line": bind.request.line(), "layer": Layer::Tile.name(), "from": "screen" });
        for (word, kinds) in crate::screen::kinds_said(&bind.rule) { row[word] = kinds.clone() }
        if let Err(why) = &bind.chord { row["problem"] = json!(why) }
        row
    });
    json!(screen.chain(table().iter().map(|bind| json!({ "chord": bind.spec, "keys": bind.row, "line": bind.line, "layer": bind.layer.map_or("any", Layer::name), "from": bind.from }))).collect::<Vec<_>>())
}

/// What this file remembers between events, and nothing else reads: the chords of a sequence pressed so far,
/// Rune's focus as it was last read, and the focus last asked of Rune (with the tiles shown then).
#[derive(Default)]
/// (`waits`: the rows the keys pressed so far begin, while the table waits for the rest of a sequence, which the
/// hint row under the tiles lists in place of the tile's own keys.)
pub struct Held { seq: Vec<KeyEvent>, waits: Vec<&'static Bind>, seen: Option<String>, asked: Option<(String, Vec<String>)>, last: Option<Instant> }

impl Held {
    /// When the person last pressed a key.
    pub fn last_key(&self) -> Option<Instant> { self.last }
}

enum Found {
    Run(&'static Bind),
    /// The keys so far start a sequence: the table waits for the rest, which is one of these rows'.
    Wait(Vec<&'static Bind>),
    No,
}

fn find(stack: &[Layer], open: bool, seq: &[KeyEvent], tx: &Tx) -> Found {
    let fits = |bind: &&Bind| bind.chords.len() >= seq.len() && bind.chords.iter().zip(seq).all(|(chord, e)| chord.matches_tx(e, tx));
    // The layer's own rows first, then the layer's under it, then the rows that hold everywhere (where they do).
    let mut waits = Vec::new();
    for scope in stack.iter().copied().map(Some).chain(open.then_some(None)) {
        for bind in table().iter().filter(|bind| bind.layer == scope).filter(fits) {
            if bind.chords.len() == seq.len() { return Found::Run(bind) }
            waits.push(bind);
        }
    }
    if waits.is_empty() { Found::No } else { Found::Wait(waits) }
}

/// A key, asked of the table: true when a row took it (or it started a sequence). The window's `on_key`, and
/// every field's before its editor.
pub fn press(s: &mut App, e: &KeyEvent, tx: &mut Tx) -> bool {
    s.held().last = Some(Instant::now());
    let person = s.person();
    let (layer, stack) = (person.layer, person.stack());
    let mut seq = std::mem::take(&mut s.held().seq);
    s.held().waits.clear();
    // The open screen's own keys first, while a tile has the keys and no sequence is begun: on the kinds each says.
    if matches!(layer, Layer::Tile | Layer::Selection) && seq.is_empty() {
        let kind = s.spec(&s.layout.focus).map(|spec| spec.kind.clone());
        if let Some(bind) = screen_binds(s).into_iter().find(|bind| bind.holds(kind.as_deref()) && bind.chord.as_ref().is_ok_and(|chord| chord.matches_tx(e, tx))) {
            s.act_request(bind.request, Actor::Person);
            effects(s, tx);
            return true;
        }
    }
    seq.push(e.clone());
    match find(&stack, layer.open(), &seq, tx) {
        Found::Run(bind) => {
            s.act(&bind.line, Actor::Person);
            effects(s, tx);
            true
        }
        Found::Wait(waits) => { s.held().seq = seq; s.held().waits = waits; true }
        // In a program, a key the table has no row for is the program's: it is sent, and never goes on to the
        // window. What the program shows for it is drawn as it is, not eased in.
        // (A key no program is sent, one with the platform's own command key, goes on to the window: ⌘C copies the
        // words selected on a Mac, where no program is sent a ⌘ key.)
        Found::No if layer == Layer::Program => match term_key(e) {
            Some(key) => { s.keyed(key); tx.instant(); true }
            None => false,
        },
        Found::No => false,
    }
}

/// A key as a program is sent one (`pty::Key`): its name as terminals name keys, the text it types, and what was
/// held with it. None: a key no program is sent (a key with the platform's own command key and no Control).
fn term_key(e: &KeyEvent) -> Option<crate::pty::Key> {
    let named = |name: &str| (name.to_string(), None);
    let (name, text) = match &e.key {
        // Control held may arrive as the control character itself: sent as it is.
        Key::Text(text) if !text.is_empty() && text.chars().all(char::is_control) => (String::new(), Some(text.clone())),
        Key::Text(text) => (text.to_lowercase(), Some(text.clone())),
        // Control held with a letter arrives as a command off macOS.
        Key::Command(letter) if e.mods.ctrl => (letter.to_string(), None),
        Key::Command(_) => return None,
        Key::Enter => named("enter"),
        Key::Tab => named("tab"),
        Key::Backspace => named("backspace"),
        Key::Escape => named("escape"),
        Key::Up => named("up"),
        Key::Down => named("down"),
        Key::Left => named("left"),
        Key::Right => named("right"),
        Key::Home => named("home"),
        Key::End => named("end"),
        Key::PageUp => named("pageup"),
        Key::PageDown => named("pagedown"),
        Key::Delete => named("delete"),
        Key::Insert => named("insert"),
        Key::Function(number) => (format!("f{number}"), None),
        _ => return None,
    };
    Some(crate::pty::Key { name, text, ctrl: e.mods.ctrl, alt: e.mods.alt, shift: e.mods.shift })
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
    let pressed = now.as_deref().filter(|_| moved && !s.bar.open && s.form.is_none()).and_then(|key| tile_of(key, &names)).filter(|tile| *tile != focus && Some(tile) != echo.as_ref());
    // The caret is in a draft whose tile hasn't the keys: a press put it there.
    let drafted = s.drafts.iter().find(|draft| draft.buf.takes_keys() && draft.tile != s.layout.focus && !s.bar.open).map(|draft| s.layout.name(&draft.tile));
    let Some(tile) = drafted.or(pressed) else { return false };
    let changed = s.act(&format!("tile.focus tile={}", word(&tile)), Actor::Person).ok;
    if let Some(asked) = wanted(s, &names) { ask(s, asked, tx); }
    changed
}

/// What Rune is to be asked now, when that is not what it was asked last: the tile with the keys (and the tiles
/// shown, so it is asked again when they change), or nothing while a field has them.
fn wanted(s: &mut App, names: &[String]) -> Option<Option<(String, Vec<String>)>> {
    // (A terminal's program is typed into through its tile: the tile holds Rune's focus while the person is in it.)
    let want = matches!(s.person().layer, Layer::Tile | Layer::Selection | Layer::Program | Layer::Moving).then(|| (format!("tile/{}", s.layout.name(&s.layout.focus)), names.to_vec()));
    (want != s.held().asked).then_some(want)
}

fn ask(s: &mut App, asked: Option<(String, Vec<String>)>, tx: &mut Tx) -> bool {
    if let Some((key, _)) = &asked { tx.focus(key.clone(), false) }
    s.held().asked = asked;
    false
}

/// The adapter every field's keys go through: the table first; then, in a block's source, plain Return types a line
/// (the kit's editor would submit instead); anything else is the editor's, and what it leaves goes up.
fn table_first(field: Field, lines: bool) -> impl Fn(&mut App, &KeyEvent, &mut Tx) -> bool {
    move |s, e, tx| {
        if press(s, e, tx) { return true }
        if lines && e.key == Key::Enter && e.mods == Mods::default() {
            s.field(&field).insert("\n");
            s.typed(&field);
            return true;
        }
        false
    }
}

/// A one-line field over `field`'s text: the kit's input, its keys through the table.
pub fn input(text: &Text, field: Field) -> TextInput {
    let (edits, typed) = (field.clone(), field.clone());
    TextInput::new(&text.0).on_edit(move |s: &mut App| &mut s.field(&edits).0).on_change(move |s: &mut App, _| s.typed(&typed)).on_key(table_first(field, false))
}

/// A field of lines over a draft's text, on `tile`: the block's source, a comment, a reply. Its keys go through the
/// table, and a paste into it is the window's to take (`App::pasted`), before the editor: the words go in with
/// their line ends made plain, as one step. That is why it is Rune's own text field in the kit's text area's frame
/// (its fill, its ring, its line height, built from the kit's tokens) and not the kit's `TextArea`: the kit hands a
/// field's keys and changes over, and no paste. `named`: what it is called and what it says while empty; `rows`:
/// how tall it is with nothing in it. `lit`: the ranges of its words (bytes) to draw on `ground`: what somebody
/// else just wrote there.
pub fn area(text: &Text, tile: &str, named: (&str, &str), rows: usize, lit: &[std::ops::Range<usize>], ground: rune::Color, k: &Kit) -> El {
    let c = &k.c;
    let field = Field::Draft(tile.to_string());
    let (edits, typed, pasted) = (field.clone(), field.clone(), tile.to_string());
    let style = TextStyle { line_height: (13.0f32 * 1.35 * 2.0).round() / 2.0, ..k.ty.ui };
    let mut input = text_input(&text.0, style)
        .key("input")
        .w_full()
        .color(c.text_base)
        .placeholder(named.1, c.text_faint)
        .caret(c.text_base, k.selection())
        .label(named.0)
        .on_edit(move |s: &mut App| &mut s.field(&edits).0)
        .on_input_change(move |s: &mut App, _| s.typed(&typed))
        .on_input_key(table_first(field, true))
        // A paste, however it was asked for (the platform's chord, the field's own menu): the window's, never the editor's.
        .on_input_paste(move |s: &mut App, content: &rune::ClipboardContent, _| { s.pasted(&pasted, content.text()); true });
    if !lit.is_empty() { input = input.spans(lit.iter().map(|range| Span { bg: Some(ground), ..Span::new(range.start, range.end) }).collect::<Vec<_>>()) }
    let frame = col().role("textbox").padding(8.0).w_full().min_h((rows.max(1) as f32 * style.line_px() + 16.0).max(80.0)).child(input).radius(k.radius.md).fill(c.bg_base).token_motion(k.motion.control);
    if text.0.focused { return frame.outline(1.0, -1.0, c.border_focus) }
    k.shadow_layers(k.elevation.input()).fold(frame, El::box_shadow).hover(c.hover)
}

/// A field's text as its editor holds it (the kit's `TextEdit`: the words, the caret, the selection, the way back),
/// kept behind this file: the window's state holds one for the bar and one for each block being written and names no
/// renderer's type. The model reads its words and where the caret is, types into it, and replaces ranges of it;
/// only the two field builders above reach the editor itself. Offsets are bytes of its words.
#[derive(Clone, Default, PartialEq, Hash)]
pub struct Text(TextEdit);

impl Text {
    pub fn new(words: &str) -> Text { Text(TextEdit::new(words)) }
    /// A field that takes the keyboard when it appears, the caret at its end.
    pub fn focused(words: &str) -> Text { let mut edit = TextEdit::new(words); edit.focused = true; Text(edit) }
    pub fn words(&self) -> &str { &self.0.text }
    /// The field takes what is typed.
    pub fn takes_keys(&self) -> bool { self.0.focused }
    pub fn give_keys(&mut self, on: bool) { self.0.focused = on }
    /// Words typed where the caret is.
    pub fn insert(&mut self, words: &str) { self.0.insert(words) }
    /// Every word replaced, as a paste over everything would.
    pub fn replace(&mut self, words: impl Into<String>) { self.0.replace_text(words) }
    /// An input method has a composition open in it: marked text at the caret that is not part of its words yet.
    pub fn composing(&self) -> bool { self.0.is_composing() }
    /// The selection's two ends: where it started and where the caret is (the same place with nothing selected).
    pub fn ends(&self) -> (usize, usize) { let len = self.0.text.len(); (self.0.anchor.min(len), self.0.focus.min(len)) }
    /// The caret, and the selection's other end, put here.
    pub fn select(&mut self, anchor: usize, caret: usize) { self.0.set_selection(anchor, caret) }
    /// Ranges of the words replaced (apart, in order), as one step of the field's own way back, by somebody who is not
    /// typing in it: the caret and the selection's other end go where `moved` says each is after, and nothing else
    /// of the editor's (whether it takes the keys, what is being composed) is touched.
    pub fn splice(&mut self, edits: &[(usize, usize, &str)], moved: impl Fn(usize) -> usize) {
        let (anchor, caret) = self.ends();
        let (anchor, caret) = (moved(anchor), moved(caret));
        self.0.undo_group(|edit| {
            for (start, end, with) in edits.iter().rev() { edit.set_selection(*start, *end); edit.insert(with); }
            edit.set_selection(anchor, caret);
        });
    }
}

/// What an act asked of the next frame, done: an element brought into view, the window closed, the clipboard read
/// for a paste into a program or into a block being written, and written with the words an extension's action
/// handed back for it, and a reader's page scrolled. True when something moved.
pub fn effects(s: &mut App, tx: &mut Tx) -> bool {
    if s.closing { tx.close_window() }
    // A paste asked for with no words of its own is the clipboard's: read here, where the window's hands are, and
    // handed to the tile the person was in when they asked (its program, or the block being written there).
    if let Some(tile) = s.pasting() { tx.read_clipboard(move |s: &mut App, content: &rune::ClipboardContent, _: &mut Tx| s.pasted(&tile, content.text())) }
    // Words an extension's action handed back for the person's clipboard (`extensions.act`'s answer) are copied here.
    if let Some(words) = s.copying() { tx.copy(words) }
    // A reader scrolled by a key or an act (`scroll`): its page's own scroll, by pages or to an end.
    let scrolled = match s.scrolled() {
        Some((key, crate::actions::Scroll::Pages(pages))) => { tx.scroll_page(key, pages); true }
        Some((key, crate::actions::Scroll::Top)) => { tx.scroll_to_y(key, 0.0); true }
        Some((key, crate::actions::Scroll::End)) => { tx.scroll_to_bottom(key); true }
        None => false,
    };
    match s.revealed() { Some(key) => { tx.scroll_into_view(key); true } None => scrolled }
}
