//! What the service answers, as this app reads it off the wire: a note in a list (`blocks.read`, `tree.search`,
//! `blocks.query`), and a note's page (`notes.page`, outline-core's note-page.ts). Shapes only: nothing here decides.
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
    /// What names this picture among the ones the window holds: its file's path, or its own text.
    pub fn key(&self) -> String { self.path.clone().unwrap_or_else(|| format!("svg:{}", self.svg.as_deref().unwrap_or(""))) }
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
    /// A picture where it stands in the note.
    Picture {
        #[serde(flatten)]
        picture: Picture,
    },
    /// A component the service answers nothing for: its source.
    Component {
        #[serde(flatten)]
        frame: Frame,
    },
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
    #[serde(default)]
    pub properties: Vec<Chip>,
    #[serde(default)]
    pub parts: Vec<Part>,
    /// The note's header image, drawn above the title.
    #[serde(default)]
    pub hero: Option<Picture>,
    #[serde(default)]
    pub ancestors: Vec<NoteRow>,
    #[serde(default)]
    pub children: Vec<NoteRow>,
    #[serde(default)]
    pub backlinks: Vec<NoteRow>,
    #[serde(default)]
    pub updated: String,
    #[serde(default)]
    pub author: String,
}

/// A property key the matches of a query carry, with the values it takes among them (`blocks.query` with `facets`).
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

impl Page {
    /// Every picture the page shows: its header image, then the ones in its body.
    pub fn pictures(&self) -> impl Iterator<Item = &Picture> {
        self.hero.iter().chain(self.parts.iter().filter_map(|part| match part { Part::Picture { picture } => Some(picture), _ => None }))
    }
}
