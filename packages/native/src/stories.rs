//! The playground's stories, as data: each a name and the act lines that set it up, over answers a scratch host once
//! gave (`stories/recorded.json`). A story is this window, whole, in one state: a tile of each kind, the bar, a tile
//! held, a thread's card, a note's card on a hover. Nothing here draws (the window's own view does, on the playground's stage: `main.rs`), and
//! nothing here is written by hand: the recorder (`tests/live.rs`, `record_the_stories`) seeds a made-up garden on a
//! scratch host, runs each story's lines against it, and writes down every ask with its answer.
//!
//! To add a story: add it to `tests/live.rs`'s list (its name, its screen, its lines), then record again:
//! `cargo test -- --ignored record_the_stories`.
use std::sync::{Arc, LazyLock};

use serde_json::Value;

use crate::client::Recorded;
use crate::store::OutlineAt;

/// One story: where it is listed (`Tiles/Reader`: a group and a name) and what sets it up.
pub struct Story {
    pub name: &'static str,
    /// What it shows, for whoever reads the list.
    pub about: &'static str,
    /// The act lines that bring a window opened on the recording's outline to the story's state.
    pub acts: Vec<String>,
}

struct Recording { outline: String, pairs: Arc<Vec<(Value, Value)>>, stories: Vec<Story> }

/// The recording, read where the window was built (as `resolve.ts` is: the window runs from its checkout). Nothing
/// of it is compiled in: the screens and kinds it holds are a host's answers, and a window away from its checkout
/// lists no story.
static RECORDING: LazyLock<Recording> = LazyLock::new(|| {
    let read: Value = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/stories/recorded.json")).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null);
    let leak = |text: &Value| -> &'static str { Box::leak(text.as_str().unwrap_or("").to_string().into_boxed_str()) };
    let pairs = read["pairs"].as_array().into_iter().flatten().filter_map(|pair| Some((pair.get(0)?.clone(), pair.get(1)?.clone()))).collect();
    let stories = read["stories"].as_array().into_iter().flatten().map(|story| Story { name: leak(&story["name"]), about: leak(&story["about"]), acts: story["acts"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect() }).collect();
    Recording { outline: read["outline"].as_str().unwrap_or("garden").to_string(), pairs: Arc::new(pairs), stories }
});

/// Every story there is, in the order the recorder listed them.
pub fn all() -> &'static [Story] { &RECORDING.stories }

/// A link that answers as the recorded host did, and the outline it was recorded on: what a story's window is
/// opened over (`main.rs` makes the window, as it makes every window: one whose line the recording has no answer
/// for says so in its notice, as a window whose host refused would).
pub fn link() -> Recorded { Recorded::new(RECORDING.pairs.clone()) }
pub fn at() -> OutlineAt { OutlineAt { outline: RECORDING.outline.clone(), machine: String::new() } }
