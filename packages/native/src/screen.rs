//! A screen, and what a tile's kind is: both come as data, in one watched answer (`screens.list`).
//!
//! - **A screen** is a named layout with its keys, where opens land and its toolbar: a row the service answers (a
//!   screen note in either body, an extension's screen), validated by the service with what is wrong said for its
//!   tile. This window ships none: the ones every door ships are an extension's (`extensions/screens`).
//! - **A kind row** says what a tile kind is: the drawer that draws it and the fields a tile of it starts with.
//!   The service lists the rows extensions serve and resolves every tile's kind as it lists the screens, so a kind
//!   is found by the name a tile carries, exactly; which kind a bare name means now is the row's own word (`serves`).
//!   Nothing here maps one name to another or names a kind.
//! - **What a screen says of itself** (where opens land, its toolbar, its rule for new notes, what it opens on) is
//!   read from its spec by `Spec`, the one reader: outline-core's `newNoteRule` and `targetFilled`, held to them by
//!   `fixtures/core-contract.json`.
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::layout::Layout;

/// One thing wrong with a screen, in the service's words: about one tile when it names it.
#[derive(Clone, Debug, PartialEq)]
pub struct Problem { pub tile: Option<String>, pub said: String }

/// Where a screen comes from.
#[derive(Clone, Debug, PartialEq)]
pub enum From {
    /// No screen is open yet: the service hasn't said which there are.
    Nowhere,
    /// A note in the outline, at the revision read.
    Note { id: String, revision: u64 },
    Extension(String),
    /// No screen's: a tile torn out of another window into one of its own.
    Torn,
}

/// A screen as served: its spec as data, and what the service found wrong with it.
#[derive(Clone, Debug, PartialEq)]
pub struct Screen {
    pub name: String,
    pub title: String,
    pub from: From,
    /// Its `ScreenSpec` as data. None: it doesn't read as one, and its problems say why.
    pub spec: Option<Value>,
    pub problems: Vec<Problem>,
}

/// What a tile kind is, as the service's row says it (`screens.list`'s `kinds`, an extension's `tiles[]`).
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct KindRow {
    /// The name a tile carries (`<extension>.<kind>`).
    pub kind: String,
    #[serde(default)]
    pub extension: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub about: String,
    /// The drawer that draws it. None: the service draws it another way (a script, a program), which this window doesn't yet.
    #[serde(default)]
    pub drawer: Option<String>,
    /// What a tile of it starts with: its drawer reads these where the tile's own spec says nothing.
    #[serde(default)]
    pub fields: Map<String, Value>,
    /// The names it says it takes the place of (the bare names saved screens use), as its extension wrote them.
    #[serde(default)]
    pub replaces: Vec<String>,
    /// Of those, the names it serves now: the service gives a name to one kind, the last to take it.
    #[serde(default)]
    pub serves: Vec<String>,
}

impl KindRow {
    /// The name screens write a tile of it by, and so a tile's role (as `screens.list` serves one): the first name it
    /// takes the place of. None: it is written by its own name.
    pub fn role(&self) -> Option<&str> { self.replaces.first().map(String::as_str) }
    /// The name a tile of it is written by, in a screen and in one made here: its role, else its own name. The
    /// service says which kind that name means (`serves`), so a tile written by it finds this row while it serves it.
    pub fn written(&self) -> &str { self.role().unwrap_or(self.kind.as_str()) }
}

/// A screen's spec (outline-core's `ScreenSpec`, as data), read: the one reader of what a screen says of itself.
#[derive(Clone, Copy, Debug)]
pub struct Spec<'a>(pub &'a Value);

impl<'a> Spec<'a> {
    /// Where an open naming no tile lands: a tile's name, or a container's key (the layout's `lands` reads it).
    pub fn lands(&self) -> Option<&'a str> { self.0["lands"].as_str() }
    /// Where the keys go back to when nothing else takes them (the spec's `home`): a tile's name, or a container's key.
    pub fn home(&self) -> Option<&'a str> { self.0["home"].as_str() }
    /// A window with no arrangement of its own opens on it.
    pub fn starts(&self) -> bool { self.0["start"] == true }
    /// Its toolbar: act lines, one a button.
    pub fn toolbar(&self) -> Vec<String> { self.0["toolbar"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect() }
    /// Its own keys (outline-core's `KeyBinding`): each a key by the name screens write it (`L`, `ctrl+l`, `esc`),
    /// the action it runs with its arguments, the tile it runs in, and the kinds it holds or doesn't hold on.
    pub fn keys(&self) -> impl Iterator<Item = &'a Value> { self.0["keys"].as_array().into_iter().flatten() }
    /// What it is opened on, when it takes a target: the argument a target fills, and the tile's field it becomes.
    pub fn target(&self) -> Option<(&'a str, &'a str)> { self.0["target"]["arg"].as_str().zip(self.0["target"]["fills"].as_str()) }
    /// The rule for a new note made while a tile of `kind` has the keys (none: no tile has them): the first of its
    /// `newNote` rules that fits, as outline-core's `newNoteRule` picks it (`only` names the kind; `unless` doesn't,
    /// or no tile has the keys). The kinds are the ones tiles carry: the service resolved them as it did the tiles'.
    /// None: it has no rule for it, and a new note floats.
    pub fn new_note(&self, kind: Option<&str>) -> Option<&'a Value> { self.0.get("newNote")?.as_array()?.iter().find(|rule| holds_on(rule, kind)) }
    /// The spec opened on `words`: the tile its target names carries them in the field it says (outline-core's
    /// `targetFilled`), in its layout or among its floats. No words, no target, or no such tile: the spec as it is.
    pub fn filled(&self, arg: &str, words: &str) -> Value {
        let mut spec = self.0.clone();
        let Some((takes, fills)) = self.target() else { return spec };
        let Some((tile, field)) = fills.split_once('.') else { return spec };
        if takes != arg || words.trim().is_empty() { return spec }
        fn fill(node: &mut Value, tile: &str, field: &str, words: &str) {
            if node["t"] == "leaf" && node["name"] == tile { node[field] = Value::String(words.to_string()) }
            for key in ["kids", "tabs"] { if let Some(kids) = node.get_mut(key).and_then(Value::as_array_mut) { for kid in kids { fill(kid, tile, field, words) } } }
            for key in ["kid", "a", "b"] { if let Some(kid) = node.get_mut(key).filter(|kid| kid.is_object()) { fill(kid, tile, field, words) } }
        }
        if let Some(root) = spec.get_mut("layout").and_then(|layout| layout.get_mut("root")) { fill(root, tile, field, words.trim()) }
        for float in spec.get_mut("layout").and_then(|layout| layout.get_mut("floats")).and_then(Value::as_array_mut).into_iter().flatten() { if let Some(leaf) = float.get_mut("tile") { fill(leaf, tile, field, words.trim()) } }
        spec
    }
}

/// Whether a rule of a screen (a new-note rule, one of its keys) holds while a tile of `kind` has the keys (none: no
/// tile has them): `only` names the kind; `unless` doesn't. The one reading of both words, whatever the rule is.
pub fn holds_on(rule: &Value, kind: Option<&str>) -> bool {
    let names = |key: &str| rule.get(key).and_then(Value::as_array).map(|kinds| kind.is_some_and(|kind| kinds.iter().any(|k| k == kind)));
    names("only").unwrap_or(true) && !names("unless").unwrap_or(false)
}

/// The kinds a rule says it holds on and off, as it wrote them (`only` whenever it says one, `unless` when it names
/// any): what `peek` says of a key beside its chord.
pub fn kinds_said(rule: &Value) -> Vec<(&'static str, &Value)> {
    ["only", "unless"].into_iter().filter_map(|key| rule.get(key).filter(|kinds| kinds.as_array().is_some_and(|kinds| key == "only" || !kinds.is_empty())).map(|kinds| (key, kinds))).collect()
}

/// `screens.list`'s answer, as this window reads it: the screens' rows as data, and the kinds extensions serve.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Served {
    #[serde(default)]
    pub screens: Vec<Value>,
    #[serde(default)]
    pub kinds: Vec<KindRow>,
    #[serde(default)]
    pub problems: Vec<String>,
}

impl Screen {
    /// No screen: what a window shows until the service has listed some.
    pub fn nowhere() -> Screen { Screen { name: String::new(), title: String::new(), from: From::Nowhere, spec: None, problems: Vec::new() } }
    pub fn is_nowhere(&self) -> bool { self.from == From::Nowhere }

    /// A row of `screens.list`.
    pub fn row(row: &Value) -> Screen {
        let text = |k: &str| row[k].as_str().unwrap_or_default().to_string();
        let from = match (row["note"]["id"].as_str(), row["extension"].as_str()) { (Some(id), _) => From::Note { id: id.to_string(), revision: row["note"]["revision"].as_u64().unwrap_or(0) }, (None, ext) => From::Extension(ext.unwrap_or_default().to_string()) };
        let problems = row["problems"].as_array().into_iter().flatten().map(|p| Problem { tile: p["tile"].as_str().map(str::to_string), said: p["said"].as_str().unwrap_or_default().to_string() }).collect();
        Screen { name: text("name"), title: text("title"), from, spec: row.get("spec").filter(|s| s.is_object()).cloned(), problems }
    }

    /// Its spec as it was served or opened, read.
    pub fn read(&self) -> Option<Spec<'_>> { self.spec.as_ref().map(Spec) }
    /// Its layout as it opens: the spec's, read from the door's saved form.
    pub fn layout(&self) -> Option<Layout> { self.spec.as_ref().and_then(|spec| spec.get("layout")).map(Layout::read) }
    /// Its spec says a window with no arrangement of its own opens on it.
    pub fn starts(&self) -> bool { self.read().is_some_and(|spec| spec.starts()) }
    /// What is wrong with one tile, by its name.
    pub fn problems_of<'a>(&'a self, tile: &'a str) -> impl Iterator<Item = &'a Problem> { self.problems.iter().filter(move |p| p.tile.as_deref() == Some(tile)) }
    /// The note it is saved as, and the revision read.
    pub fn note(&self) -> Option<(&str, u64)> { match &self.from { From::Note { id, revision } => Some((id, *revision)), _ => None } }
}
