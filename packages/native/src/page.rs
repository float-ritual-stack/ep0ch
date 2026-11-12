//! What the service answers, as this app reads it off the wire: a note in a list (`blocks.read`, `tree.search`,
//! `blocks.query`), and a note's page (`notes.page`, outline-core's note-page.ts). Shapes only: nothing here decides.
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

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Chip {
    pub key: String,
    pub value: String,
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
    #[serde(default)]
    pub properties: Vec<Chip>,
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
    /// Every picture the page shows: its header image, then the ones in its body, wherever a part holds one.
    pub fn pictures(&self) -> &[Picture] {
        self.pictured.get_or_init(|| {
            let mut found: Vec<Picture> = self.hero.iter().cloned().collect();
            for part in &self.parts { crate::parts::walk(part, &mut |prim| found.extend(Picture::of(prim))) }
            found
        })
    }
}
