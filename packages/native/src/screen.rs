//! A screen: a named layout with its keys, where opens land and its toolbar. What a screen is comes as data:
//! the rows `screens.list` answers (a screen note in either body, an extension's screen, each validated by the
//! service with what is wrong said for its tile), and the screens this window ships, which are files of the same
//! data (`screens/*.json`), never code.
use serde_json::Value;

use crate::layout::Layout;

/// One thing wrong with a screen, in the service's words: about one tile when it names it.
#[derive(Clone, Debug, PartialEq)]
pub struct Problem { pub tile: Option<String>, pub said: String }

/// Where a screen comes from.
#[derive(Clone, Debug, PartialEq)]
pub enum From {
    /// It ships with this window.
    Shipped,
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

/// The screens this window ships, as data.
const SHIPPED: &[&str] = &[include_str!("../screens/desk.json")];

/// The screen a window opens on when nothing says another.
pub const DEFAULT: &str = "desk";

impl Screen {
    /// A shipped screen's file.
    fn shipped(text: &str) -> Screen {
        let spec: Value = serde_json::from_str(text).expect("a shipped screen is JSON");
        Screen { name: spec["name"].as_str().expect("a shipped screen has a name").to_string(), title: spec["title"].as_str().unwrap_or_default().to_string(), from: From::Shipped, spec: Some(spec), problems: Vec::new() }
    }

    /// A row of `screens.list`.
    pub fn row(row: &Value) -> Screen {
        let text = |k: &str| row[k].as_str().unwrap_or_default().to_string();
        let from = match (row["note"]["id"].as_str(), row["extension"].as_str()) { (Some(id), _) => From::Note { id: id.to_string(), revision: row["note"]["revision"].as_u64().unwrap_or(0) }, (None, Some(ext)) => From::Extension(ext.to_string()), _ => From::Shipped };
        let problems = row["problems"].as_array().into_iter().flatten().map(|p| Problem { tile: p["tile"].as_str().map(str::to_string), said: p["said"].as_str().unwrap_or_default().to_string() }).collect();
        Screen { name: text("name"), title: text("title"), from, spec: row.get("spec").filter(|s| s.is_object()).cloned(), problems }
    }

    /// Its layout as it opens: the spec's, read from the door's saved form.
    pub fn layout(&self) -> Option<Layout> { self.spec.as_ref().and_then(|spec| spec.get("layout")).map(Layout::read) }
    /// The tile an open naming none lands in, by name.
    pub fn lands(&self) -> Option<&str> { self.spec.as_ref().and_then(|spec| spec["lands"].as_str()) }
    /// Its toolbar: act lines, one a button.
    pub fn toolbar(&self) -> Vec<String> { self.spec.as_ref().and_then(|spec| spec["toolbar"].as_array()).into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect() }
    /// What is wrong with one tile, by its name.
    pub fn problems_of<'a>(&'a self, tile: &'a str) -> impl Iterator<Item = &'a Problem> { self.problems.iter().filter(move |p| p.tile.as_deref() == Some(tile)) }
    /// The note it is saved as, and the revision read.
    pub fn note(&self) -> Option<(&str, u64)> { match &self.from { From::Note { id, revision } => Some((id, *revision)), _ => None } }
}

pub fn shipped() -> Vec<Screen> { SHIPPED.iter().map(|text| Screen::shipped(text)).collect() }

/// The screen a window opens on.
pub fn default() -> Screen { shipped().into_iter().find(|s| s.name == DEFAULT).expect("the default screen ships") }
