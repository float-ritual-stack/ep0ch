//! What the service answers, as this app reads it off the wire: a list (`lists.read`, outline-core's list-row.ts)
//! and a note's page (`notes.page`, outline-core's note-page.ts). Shapes only: nothing here decides.
//! A page's body stays the data it came as: each part a primitive, drawn by its type (`parts.rs`, `tiles/prim.rs`).
use serde::Deserialize;
use serde_json::Value;

/// A note in a list, as every list names one: its id, its title as lists show it, whether anything is under it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct NoteRow {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(rename = "hasChildren", default)]
    pub has_children: bool,
    /// Where it sits or when it changed, as the list that returned it says.
    #[serde(default)]
    pub context: String,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Chip {
    pub key: String,
    pub value: String,
}

/// A row of a list, as the service lists it (outline-core's `ListRow`): what it shows and the act line a pick runs.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct ListRow {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub mark: Option<String>,
    #[serde(default)]
    pub tone: Option<String>,
    /// The section it sits in, when the list has some.
    #[serde(default)]
    pub group: Option<String>,
    /// A table's cells, one a column.
    #[serde(default)]
    pub cells: Vec<Value>,
    /// The properties it carries that the list shows on it.
    #[serde(default)]
    pub chips: Vec<Chip>,
    /// The act line a pick runs. None: a header, or a row that only copies.
    #[serde(default)]
    pub act: Option<String>,
    /// In a tree: how deep it sits, whether anything is under it, whether that is listed after it.
    #[serde(default)]
    pub depth: usize,
    #[serde(default)]
    pub folds: bool,
    #[serde(default)]
    pub open: bool,
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

fn yes() -> bool { true }

/// A named run of a list's rows (outline-core's `ListGroup`): a section, or a lane.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct ListGroup {
    pub name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub glyph: Option<String>,
    #[serde(default)]
    pub count: u64,
    /// The list said how many it holds (a group only a row names says none).
    #[serde(skip, default = "yes")]
    pub counted: bool,
    #[serde(default)]
    pub note: Option<String>,
    /// The rows in it, in order, when the list says so by id (a row may be in several); else a row names its group.
    #[serde(default)]
    pub ids: Option<Vec<String>>,
    /// The groups inside it, when it has some: each a section of its own, named by the way to it.
    #[serde(default)]
    pub groups: Vec<ListGroup>,
}

/// The list primitive (outline-core's `ListPrimitive`): rows, how they are arranged, a table's columns, the groups.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct ListView {
    #[serde(default)]
    pub rows: Vec<ListRow>,
    /// `tree`, `rows`, `table`, `lanes` or `grid`; none said is rows.
    #[serde(default)]
    pub arrange: String,
    #[serde(default)]
    pub headers: Vec<String>,
    #[serde(default)]
    pub columns: Vec<String>,
    #[serde(default)]
    pub groups: Vec<ListGroup>,
    /// What an empty list says.
    #[serde(default)]
    pub empty: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

/// One section of a list as it is drawn: its header (none for the rows that name no group) and its rows' places in `rows`.
#[derive(Clone, Debug, PartialEq)]
pub struct Section { pub head: Option<ListGroup>, pub rows: Vec<usize> }

impl ListView {
    /// The rows in the sections they are drawn in, every renderer's order (outline-core's `listSections`, and the one
    /// copy of it here: `fixtures/core-contract.json` holds what that answers, and `tests/contract.rs` asks every row).
    /// Groups that list their rows by id hold them in that order, a group inside a group a section named by the way
    /// to it; else the rows that name no group, each declared group's, then the groups only a row names.
    pub fn sections(&self) -> Vec<Section> {
        if self.groups.iter().any(|g| g.ids.is_some()) {
            fn listed(view: &ListView, groups: &[ListGroup], prefix: &str, out: &mut Vec<Section>) {
                for g in groups {
                    if !g.groups.is_empty() { listed(view, &g.groups, &format!("{prefix}{} / ", g.label), out); continue }
                    let head = ListGroup { label: format!("{prefix}{}", g.label), ..g.clone() };
                    out.push(Section { head: Some(head), rows: g.ids.iter().flatten().filter_map(|id| view.rows.iter().position(|r| r.id == *id)).collect() });
                }
            }
            let mut out = Vec::new();
            listed(self, &self.groups, "", &mut out);
            return out;
        }
        let mut out: Vec<Section> = Vec::new();
        let bare: Vec<usize> = self.rows.iter().enumerate().filter(|(_, r)| r.group.is_none()).map(|(i, _)| i).collect();
        if !bare.is_empty() { out.push(Section { head: None, rows: bare }) }
        let of = |name: &str| self.rows.iter().enumerate().filter(|(_, r)| r.group.as_deref() == Some(name)).map(|(i, _)| i).collect::<Vec<_>>();
        for g in &self.groups { out.push(Section { head: Some(g.clone()), rows: of(&g.name) }) }
        let mut named: Vec<&str> = Vec::new();
        for r in &self.rows { if let Some(g) = r.group.as_deref() && !self.groups.iter().any(|x| x.name == g) && !named.contains(&g) { named.push(g) } }
        // A group only a row names has no count of its own: its header is its name.
        for g in named { out.push(Section { head: Some(ListGroup { name: g.to_string(), label: g.to_string(), counted: false, ..ListGroup::default() }), rows: of(g) }) }
        out
    }
}

/// A list source as it says of itself (outline-core's `ListSource`, `lists.read from=sources`): its name, what it
/// lists, the parameters it reads, and whether a command bar lists it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct SourceRow {
    pub from: String,
    #[serde(default)]
    pub about: String,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub params: Vec<SourceParam>,
    /// A command bar lists it.
    #[serde(default)]
    pub bar: Option<SourceBar>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct SourceParam { pub name: String, #[serde(default)] pub about: String, /* It can't list without it. */ #[serde(default)] pub required: bool }

/// How a bar lists a source: on its main list, and whether its answer carries facets (a facet picked is a term of its question).
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct SourceBar { #[serde(default)] pub main: bool, #[serde(default)] pub facets: bool }

/// `lists.read`'s answer (outline-core's `ListAnswer`): one list, whatever it is of.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct ListAnswer {
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub list: ListView,
    /// The property keys the listed notes carry, counted: chips that narrow the question.
    #[serde(default)]
    pub facets: Vec<Facet>,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub total: Option<u64>,
    #[serde(default)]
    pub truncated: bool,
    /// A tree: the folders whose notes are listed.
    #[serde(default)]
    pub open: Vec<String>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    /// `from: sources`: each source as it says of itself.
    #[serde(default)]
    pub sources: Vec<SourceRow>,
}

/// A picture a note shows (outline-core's `PagePicture`): a file the host reads (`path`), or an svg fence's own text.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Picture {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub svg: Option<String>,
    #[serde(default)]
    pub alt: Option<String>,
    /// `fit` keeps the reading measure; `full` fills the width there is.
    #[serde(default)]
    pub width: String,
    /// Its height in terminal rows, when the note says one.
    #[serde(default)]
    pub height: Option<f32>,
    #[serde(default)]
    pub fit: Option<String>,
    /// 0 as it is … 1 black.
    #[serde(default)]
    pub dim: Option<f32>,
    #[serde(default)]
    pub problems: Vec<String>,
}

impl Picture {
    /// The picture a primitive is: a page's `picture`, or a view's `image` (its `src` a file, `size: full` the width there is).
    pub fn of(prim: &Value) -> Option<Picture> {
        match prim["type"].as_str()? {
            "picture" => Picture::deserialize(prim).ok(),
            "image" => {
                let text = |key: &str| prim[key].as_str().map(str::to_string);
                (prim["src"].is_string() || prim["svg"].is_string()).then(|| Picture {
                    path: text("src"), svg: text("svg"), alt: text("alt"), width: if prim["size"] == "full" { "full".into() } else { "fit".into() },
                    height: prim["height"].as_f64().map(|rows| rows as f32), fit: text("fit"), dim: None, problems: Vec::new(),
                })
            }
            _ => None,
        }
    }

    /// What names this picture among the ones the window holds: its file's path, or its own text.
    pub fn key(&self) -> String { self.path.clone().unwrap_or_else(|| format!("svg:{}", self.svg.as_deref().unwrap_or(""))) }
}

/// `notes.page`'s answer: everything drawn of one note.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Page {
    #[serde(rename = "blockId")]
    pub id: String,
    pub revision: u64,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub chips: Vec<Chip>,
    /// The body, in order: each a `part` primitive (outline-core's `PagePart`), read by its `type` and nothing else.
    #[serde(default)]
    pub parts: Vec<Value>,
    /// Every picture the page shows, found once an answer.
    #[serde(skip)]
    pictured: std::sync::OnceLock<Vec<Picture>>,
    /// The note's header image, drawn above the title.
    #[serde(default)]
    pub hero: Option<Picture>,
    #[serde(default)]
    pub ancestors: Vec<NoteRow>,
    /// The notes under it as the one list (outline-core's `NotePage.under`): a `list` primitive, drawn as any is.
    #[serde(default)]
    pub under: Option<Value>,
}

/// A property key the matches of a query carry, with the values it takes among them (`blocks.query` with `facets`).
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Facet {
    pub key: String,
    #[serde(default)]
    pub values: Vec<FacetValue>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct FacetValue {
    pub value: String,
    pub count: u64,
}

impl Page {
    /// Every picture the page shows: its header image, then the ones in its body, wherever a part holds one.
    pub fn pictures(&self) -> &[Picture] {
        self.pictured.get_or_init(|| {
            let mut found: Vec<Picture> = self.hero.iter().cloned().collect();
            for part in &self.parts { crate::parts::walk(part, &mut |prim| found.extend(Picture::of(prim))) }
            found
        })
    }
}
