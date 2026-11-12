//! A screen, and what a tile's kind is: both come as data, in one watched answer (`screens.list`).
//!
//! - **A screen** is a named layout with its keys, where opens land and its toolbar: a row the service answers (a
//!   screen note in either body, an extension's screen), validated by the service with what is wrong said for its
//!   tile. This window ships none: the ones every door ships are an extension's (`extensions/screens`).
//! - **A kind row** says what a tile kind is: the drawer that draws it and the fields a tile of it starts with.
//!   The service lists the rows extensions serve; a kind is found by the name a tile carries, or a name it serves in
//!   place of, so nothing here maps one name to another or names a kind.
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
    /// The names it serves in place of (the bare names saved screens use).
    #[serde(default)]
    pub replaces: Vec<String>,
}

impl KindRow {
    /// It is the kind a tile names: by its own name, or one it serves in place of.
    pub fn is(&self, kind: &str) -> bool { self.kind == kind || self.replaces.iter().any(|old| old == kind) }
    /// The name a tile made here carries for it: the one saved screens use (the first it serves in place of), else its own.
    /// Either reads back as this row.
    pub fn saved(&self) -> &str { self.replaces.first().map_or(self.kind.as_str(), String::as_str) }
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

    /// Its layout as it opens: the spec's, read from the door's saved form.
    pub fn layout(&self) -> Option<Layout> { self.spec.as_ref().and_then(|spec| spec.get("layout")).map(Layout::read) }
    /// The tile an open naming none lands in, by name.
    pub fn lands(&self) -> Option<&str> { self.spec.as_ref().and_then(|spec| spec["lands"].as_str()) }
    /// Its spec says a window with no arrangement of its own opens on it.
    pub fn starts(&self) -> bool { self.spec.as_ref().is_some_and(|spec| spec["start"] == true) }
    /// What it is opened on, when its spec takes a target: the tile's name and the field the target's words become
    /// (`target.fills`, outline-core's `targetFilled`).
    pub fn target(&self) -> Option<(&str, &str)> { self.spec.as_ref().and_then(|spec| spec["target"]["fills"].as_str()).and_then(|fills| fills.split_once('.')) }
    /// What the screen says of a new note made while a tile of `kind` has the keys: the first of its `newNote`
    /// rules that fits (`only`, `unless`), read as outline-core's `newNoteRule` reads them. None: it has no rule
    /// for it, and a new note floats.
    pub fn new_note(&self, kind: &str) -> Option<&Value> {
        let has = |rule: &Value, key: &str| rule[key].as_array().map(|kinds| kinds.iter().any(|k| k == kind));
        self.spec.as_ref()?.get("newNote")?.as_array()?.iter().find(|rule| has(rule, "only").unwrap_or(true) && !has(rule, "unless").unwrap_or(false))
    }
    /// Its toolbar: act lines, one a button.
    pub fn toolbar(&self) -> Vec<String> { self.spec.as_ref().and_then(|spec| spec["toolbar"].as_array()).into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect() }
    /// What is wrong with one tile, by its name.
    pub fn problems_of<'a>(&'a self, tile: &'a str) -> impl Iterator<Item = &'a Problem> { self.problems.iter().filter(move |p| p.tile.as_deref() == Some(tile)) }
    /// The note it is saved as, and the revision read.
    pub fn note(&self) -> Option<(&str, u64)> { match &self.from { From::Note { id, revision } => Some((id, *revision)), _ => None } }
}
